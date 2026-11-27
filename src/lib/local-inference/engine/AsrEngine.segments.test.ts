import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

const SEGMENT_MODELS = ['whisper-base-webgpu', 'qwen3-asr-0.6b-webgpu', 'granite-speech', 'cohere-transcribe-webgpu', 'voxtral-mini-3b-webgpu', 'sensevoice-int8'];

describe('AsrEngine: the turn detector\'s segment port', () => {
  let restore: () => void;
  let channel: MessageChannel;

  beforeEach(() => {
    restore = installMockWorker();
    channel = new MessageChannel();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ variantKey: 'q4f16', dtype: 'q4f16', files: [] });
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'package-metadata.json': 'blob:meta', 'model.onnx': 'blob:m' });
    vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) }) as any));
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    channel.port1.close();
    channel.port2.close();
  });

  async function initMessage(engine: AsrEngine, modelId: string, segmentPort?: MessagePort) {
    engine.init(modelId, 'ja', undefined, segmentPort).catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    return worker.postMessage.mock.calls[0] as [Record<string, unknown>, Transferable[]?];
  }

  async function readyEngine(modelId = 'whisper-base-webgpu') {
    const engine = new AsrEngine();
    const initP = engine.init(modelId, 'ja', undefined, channel.port1);
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    return { engine, worker };
  }

  it.each(SEGMENT_MODELS)('%s gets the segment port, transferred, and no VAD config', async (modelId) => {
    const engine = new AsrEngine();
    const [message, transfer] = await initMessage(engine, modelId, channel.port1);
    expect(message.segmentPort).toBe(channel.port1);
    expect(transfer).toEqual([channel.port1]);
    expect(message).not.toHaveProperty('vadConfig');
    expect(message).not.toHaveProperty('vadModelUrl');
    expect(message).not.toHaveProperty('turnPort');
    expect(message.type).toBe('init');
    if (modelId !== 'sensevoice-int8') expect(message.language).toBe('ja');
    engine.dispose();
  });

  it('Granite carries its task and target language beside the port', async () => {
    const engine = new AsrEngine();
    engine.init('granite-speech', 'ja', { task: 'translate', targetLanguage: 'en' }, channel.port1).catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ task: 'translate', targetLanguage: 'en', segmentPort: channel.port1 });
    engine.dispose();
  });

  it.each(SEGMENT_MODELS)('%s without a segment port does not start', async (modelId) => {
    const engine = new AsrEngine();
    await expect(engine.init(modelId, 'ja')).rejects.toThrow(/takes its segments from a turn detector: no segment port/);
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('sherpa-onnx given a port gets it, transferred, and no VAD config: its worker then runs no VAD', async () => {
    const engine = new AsrEngine();
    const [message, transfer] = await initMessage(engine, 'sensevoice-int8', channel.port1);
    expect(message.segmentPort).toBe(channel.port1);
    expect(transfer).toEqual([channel.port1]);
    expect(message).not.toHaveProperty('vadConfig');
    expect(message.asrEngine).toBe('sensevoice');
    // The leg's language goes with it: SenseVoice left to decide wrote Japanese in Chinese characters.
    expect(message.language).toBe('ja');
    engine.dispose();
  });

  it("a ready sherpa-onnx engine given a port posts {type:'stop', epoch}; the answers reach onDrained and onResult", async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8', 'ja', undefined, channel.port1);
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.postMessage.mockClear();
    engine.stop(2);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'stop', epoch: 2 });
    const onDrained = vi.fn();
    const onResult = vi.fn();
    engine.onDrained = onDrained;
    engine.onResult = onResult;
    worker.emit({ type: 'drained', epoch: 2, seq: 5 });
    worker.emit({ type: 'result', text: 'こんにちは', startSample: 160, durationMs: 900, recognitionTimeMs: 12, endedBy: 'silence', epoch: 2, seq: 4 });
    expect(onDrained).toHaveBeenCalledExactlyOnceWith(5);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'こんにちは', startSample: 160, endedBy: 'silence', epoch: 2 }));
  });

  it('drained reaches onDrained with its seq', async () => {
    const { engine, worker } = await readyEngine();
    const onDrained = vi.fn();
    engine.onDrained = onDrained;
    worker.emit({ type: 'drained', epoch: 0, seq: 7 });
    expect(onDrained).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("stop posts {type:'stop', epoch}, and only once ready", async () => {
    const engine = new AsrEngine();
    engine.stop(1);
    expect(MockWorker.instances).toHaveLength(0);
    const { engine: ready, worker } = await readyEngine();
    worker.postMessage.mockClear();
    ready.stop(3);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'stop', epoch: 3 });
  });

  it('press and epoch come with the result and with a partial', async () => {
    const { engine, worker } = await readyEngine('cohere-transcribe-webgpu');
    const onResult = vi.fn();
    const onPartial = vi.fn();
    engine.onResult = onResult;
    engine.onPartialResult = onPartial;
    worker.emit({ type: 'partial', text: 'こん', press: 2, epoch: 1 });
    worker.emit({ type: 'partial', text: 'こんに' });
    worker.emit({ type: 'result', text: 'こんにちは', startSample: 160, durationMs: 900, recognitionTimeMs: 12, endedBy: 'release', press: 2, epoch: 1 });
    worker.emit({ type: 'result', text: 'plain', durationMs: 1, recognitionTimeMs: 1 });
    expect(onPartial).toHaveBeenNthCalledWith(1, 'こん', { press: 2, epoch: 1 });
    expect(onPartial).toHaveBeenNthCalledWith(2, 'こんに', {});
    expect(onResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'こんにちは', startSample: 160, endedBy: 'release', press: 2, epoch: 1 }));
    expect(onResult.mock.calls[1][0]).not.toHaveProperty('press');
    expect(onResult.mock.calls[1][0]).not.toHaveProperty('epoch');
  });
});
