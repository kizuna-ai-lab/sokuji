import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { TurnRuntime } from './TurnRuntime';
import { MockWorker } from '../local-inference/engine/testing/mockWorker';
import { ModelManager } from '../local-inference/ModelManager';
import { checkWebGPU } from '../../utils/webgpu';
import { createTurnWorker } from './createTurnWorker';
import { reportWarning } from '../diagnostics/report';

vi.mock('./createTurnWorker', () => ({ createTurnWorker: vi.fn() }));
vi.mock('../../utils/webgpu', () => ({ checkWebGPU: vi.fn() }));
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportWarning: vi.fn(),
}));

const FILES = { 'smart-turn-v3.2-gpu.onnx': 'blob:smart-turn' };
const ports: MessagePort[] = [];
const priorMemory = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');

const sent = (worker: MockWorker) => worker.postMessage.mock.calls as Array<[any, Transferable[]?]>;

async function nthWorker(n: number): Promise<MockWorker> {
  await vi.waitFor(() => expect(MockWorker.instances.length).toBeGreaterThanOrEqual(n));
  const worker = MockWorker.instances[n - 1];
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  return worker;
}

/** The connect messages a worker was sent; their ports are closed after the test. */
function connects(worker: MockWorker) {
  const found = sent(worker).filter(([m]) => m.type === 'connect');
  for (const [m] of found) if (!ports.includes(m.port)) ports.push(m.port);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  MockWorker.reset();
  (createTurnWorker as unknown as Mock).mockImplementation((backend: string) => new MockWorker(backend) as unknown as Worker);
  (checkWebGPU as unknown as Mock).mockResolvedValue({ available: true });
  vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
  vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue(FILES);
  vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorMemory) Object.defineProperty(navigator, 'deviceMemory', priorMemory);
  else delete (navigator as any).deviceMemory;
  for (const port of ports.splice(0)) port.close();
});

async function connected(runtime: TurnRuntime) {
  const connection = await runtime.connect();
  expect(connection).not.toBeNull();
  ports.push(connection!.port);
  return connection!;
}

describe('TurnRuntime', () => {
  it('loads on WebGPU and hands the turn worker the other end of the port once the model is ready', async () => {
    const runtime = new TurnRuntime();
    const connection = await connected(runtime);
    const worker = await nthWorker(1);
    expect(createTurnWorker).toHaveBeenCalledWith('webgpu');
    expect(sent(worker)[0][0]).toEqual({
      type: 'init', fileUrls: FILES, ortWasmBaseUrl: expect.stringMatching(/\/wasm\/ort\/$/), numThreads: 1,
    });
    expect(connects(worker)).toEqual([]);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(1));
    const [message, transfer] = connects(worker)[0];
    expect(message).toMatchObject({ type: 'connect', id: expect.any(Number) });
    expect(transfer).toEqual([message.port]);
    expect(message.port).not.toBe(connection.port);
  });

  it('falls back to WASM when the WebGPU load fails, without a warning', async () => {
    const runtime = new TurnRuntime();
    await connected(runtime);
    (await nthWorker(1)).emit({ type: 'error', error: 'no adapter' });
    const cpu = await nthWorker(2);
    expect(createTurnWorker).toHaveBeenLastCalledWith('wasm');
    cpu.emit({ type: 'ready', loadTimeMs: 40, device: 'wasm' });
    await vi.waitFor(() => expect(connects(cpu)).toHaveLength(1));
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it('starts on WASM when there is no WebGPU', async () => {
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: false });
    await connected(new TurnRuntime());
    await nthWorker(1);
    expect(createTurnWorker).toHaveBeenCalledWith('wasm');
  });

  it('reports a load that fails on WASM too, and the port goes unanswered', async () => {
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: false });
    await connected(new TurnRuntime());
    const worker = await nthWorker(1);
    worker.emit({ type: 'error', error: 'out of memory' });
    await vi.waitFor(() => expect(reportWarning).toHaveBeenCalledWith(
      'SmartTurn',
      'Smart Turn could not load; turns end on silence: out of memory',
      expect.objectContaining({ dedupeKey: 'smart-turn:load' }),
    ));
    expect(connects(worker)).toEqual([]);
    expect(MockWorker.instances).toHaveLength(1);
  });

  it('connects nothing without the model on disk', async () => {
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(false);
    expect(await new TurnRuntime().connect()).toBeNull();
    expect(createTurnWorker).not.toHaveBeenCalled();
  });

  it('connects on a device that reports little memory', async () => {
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
    await connected(new TurnRuntime());
    await nthWorker(1);
  });

  it('serves two connections from one worker', async () => {
    const runtime = new TurnRuntime();
    await connected(runtime);
    await connected(runtime);
    const worker = await nthWorker(1);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(2));
    expect(MockWorker.instances).toHaveLength(1);
    expect(sent(worker).filter(([m]) => m.type === 'init')).toHaveLength(1);
    const ids = connects(worker).map(([m]) => m.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('disconnects a released connection and disposes the worker with the last one', async () => {
    const runtime = new TurnRuntime();
    const a = await connected(runtime);
    const b = await connected(runtime);
    const worker = await nthWorker(1);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(2));
    const firstId = connects(worker)[0][0].id;
    a.release();
    expect(sent(worker).map(([m]) => m)).toContainEqual({ type: 'disconnect', id: firstId });
    expect(worker.terminate).not.toHaveBeenCalled();
    b.release();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('never hands the worker a connection released while the model loads', async () => {
    const runtime = new TurnRuntime();
    const connection = await connected(runtime);
    const worker = await nthWorker(1);
    connection.release();
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalled());
    expect(connects(worker)).toEqual([]);
  });

  it('reports a worker that dies after loading, and loads the next connection on WASM', async () => {
    const runtime = new TurnRuntime();
    await connected(runtime);
    const gpu = await nthWorker(1);
    gpu.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(gpu)).toHaveLength(1));
    gpu.emitError('device lost');
    expect(reportWarning).toHaveBeenCalledWith(
      'SmartTurn',
      'Smart Turn stopped; turns end on silence: device lost',
      expect.objectContaining({ dedupeKey: 'smart-turn:crash' }),
    );
    expect(gpu.terminate).toHaveBeenCalled();
    await connected(runtime);
    await nthWorker(2);
    expect(createTurnWorker).toHaveBeenLastCalledWith('wasm');
  });

  it('forgets the connections a crashed worker held, so they never reach its replacement', async () => {
    const runtime = new TurnRuntime();
    const a = await connected(runtime);
    const gpu = await nthWorker(1);
    gpu.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(gpu)).toHaveLength(1));
    gpu.emitError('device lost');
    const b = await connected(runtime);
    const cpu = await nthWorker(2);
    cpu.emit({ type: 'ready', loadTimeMs: 40, device: 'wasm' });
    await vi.waitFor(() => expect(connects(cpu)).toHaveLength(1));
    a.release();
    expect(sent(cpu).filter(([m]) => m.type === 'disconnect')).toEqual([]);
    expect(cpu.terminate).not.toHaveBeenCalled();
    b.release();
    expect(cpu.terminate).toHaveBeenCalled();
  });

  it('releasing twice posts one disconnect', async () => {
    const runtime = new TurnRuntime();
    const a = await connected(runtime);
    const b = await connected(runtime);
    const worker = await nthWorker(1);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(2));
    a.release();
    expect(() => a.release()).not.toThrow();
    expect(sent(worker).filter(([m]) => m.type === 'disconnect')).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    b.release();
    expect(() => b.release()).not.toThrow();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('connects nothing when the disk check throws', async () => {
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockRejectedValue(new Error('idb'));
    expect(await new TurnRuntime().connect()).toBeNull();
    expect(createTurnWorker).not.toHaveBeenCalled();
  });
});
