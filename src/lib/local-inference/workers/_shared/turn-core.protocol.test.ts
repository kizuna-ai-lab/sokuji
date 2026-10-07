import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTurnWorker, type TurnCoreDeps, type TurnWorkerScope } from './turn-core';
import { SMART_TURN_FILE, type TurnPredictAnswer, type TurnWorkerOutbound } from './turn-protocol';

class FakeTensor {
  constructor(public type: string, public data: Float32Array, public dims: number[]) {}
}

function harness(over: Partial<TurnCoreDeps> = {}) {
  const run = vi.fn(async (_feeds: Record<string, FakeTensor>) => ({ logits: { data: Float32Array.of(0.8) } }));
  const release = vi.fn(async () => {});
  const create = vi.fn(async (_bytes: Uint8Array, _options: unknown) => ({ run, release }));
  const env = { wasm: {} as Record<string, unknown> };
  const posted: TurnWorkerOutbound[] = [];
  const scope: TurnWorkerScope = { onmessage: null, postMessage: (m) => { posted.push(m); } };
  installTurnWorker(
    { InferenceSession: { create }, Tensor: FakeTensor, env, device: 'wasm', prepare: async () => {}, ...over },
    scope,
  );
  const send = (data: unknown) => scope.onmessage!({ data } as MessageEvent);
  return { run, release, create, env, posted, send };
}

const INIT = { type: 'init', fileUrls: { [SMART_TURN_FILE]: 'blob:model' }, ortWasmBaseUrl: 'http://x/wasm/ort/', numThreads: 1 };
/** Each prediction runs the real 8 s feature extraction. */
const SLOW = { timeout: 5000 };

const channels: MessageChannel[] = [];

function connect(h: ReturnType<typeof harness>, id: number) {
  const channel = new MessageChannel();
  channels.push(channel);
  const answers: TurnPredictAnswer[] = [];
  channel.port1.onmessage = (e: MessageEvent<TurnPredictAnswer>) => { answers.push(e.data); };
  h.send({ type: 'connect', id, port: channel.port2 });
  const predict = (requestId: number) => channel.port1.postMessage({
    type: 'predict', id: requestId, window: Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 7)),
  });
  return { answers, predict };
}

async function loaded(h: ReturnType<typeof harness>) {
  h.send(INIT);
  await vi.waitFor(() => expect(h.posted).toContainEqual(expect.objectContaining({ type: 'ready' })));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const c of channels.splice(0)) { c.port1.close(); c.port2.close(); }
});

describe('the Smart Turn worker', () => {
  it('loads the model from its blob URL on its device and says ready', async () => {
    const h = harness();
    await loaded(h);
    expect(h.posted).toEqual([{ type: 'ready', loadTimeMs: expect.any(Number), device: 'wasm' }]);
    expect(fetch).toHaveBeenCalledWith('blob:model');
    expect(h.create).toHaveBeenCalledWith(expect.any(Uint8Array), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    expect(h.env.wasm).toEqual({ wasmPaths: 'http://x/wasm/ort/', numThreads: 1 });
  });

  it('reports a missing model file as a load error', async () => {
    const h = harness();
    h.send({ ...INIT, fileUrls: {} });
    await vi.waitFor(() => expect(h.posted).toEqual([{ type: 'error', error: expect.stringContaining(SMART_TURN_FILE) }]));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('reports an entry that cannot run as a load error', async () => {
    const h = harness({ prepare: async () => { throw new Error('no WebGPU adapter'); } });
    h.send(INIT);
    await vi.waitFor(() => expect(h.posted).toEqual([{ type: 'error', error: 'no WebGPU adapter' }]));
  });

  it("answers a prediction with the model's probability, from [1, 80, 800] features", async () => {
    const h = harness();
    await loaded(h);
    const a = connect(h, 1);
    a.predict(7);
    await vi.waitFor(() => expect(a.answers).toHaveLength(1), SLOW);
    expect(a.answers[0]).toEqual({ id: 7, probability: expect.closeTo(0.8, 5) });
    const input = h.run.mock.calls[0][0].input_features;
    expect(input.dims).toEqual([1, 80, 800]);
    expect(input.data).toHaveLength(64_000);
  });

  it('answers each leg on its own port', async () => {
    const h = harness();
    await loaded(h);
    const a = connect(h, 1);
    const b = connect(h, 2);
    a.predict(1);
    b.predict(1);
    await vi.waitFor(() => expect([a.answers.length, b.answers.length]).toEqual([1, 1]), SLOW);
    expect(a.answers[0].id).toBe(1);
    expect(b.answers[0].id).toBe(1);
  });

  it('runs one prediction at a time', async () => {
    const h = harness();
    await loaded(h);
    let finish!: () => void;
    h.run.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ logits: { data: Float32Array.of(0.9) } });
    }));
    const a = connect(h, 1);
    a.predict(1);
    a.predict(2);
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1), SLOW);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.run).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(a.answers.map((x) => x.id)).toEqual([1, 2]), SLOW);
  });

  it('answers a failed run with its error', async () => {
    const h = harness();
    await loaded(h);
    h.run.mockRejectedValueOnce(new Error('bad input'));
    const a = connect(h, 1);
    a.predict(3);
    await vi.waitFor(() => expect(a.answers).toEqual([{ id: 3, error: 'bad input' }]), SLOW);
  });

  it('stops answering a port once it is disconnected', async () => {
    const h = harness();
    await loaded(h);
    const a = connect(h, 4);
    h.send({ type: 'disconnect', id: 4 });
    a.predict(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(a.answers).toEqual([]);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('releases the session on dispose', async () => {
    const h = harness();
    await loaded(h);
    h.send({ type: 'dispose' });
    await vi.waitFor(() => expect(h.posted).toContainEqual({ type: 'disposed' }));
    expect(h.release).toHaveBeenCalled();
  });
});
