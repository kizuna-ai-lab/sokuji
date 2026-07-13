import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtsEngine } from './TtsEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';
import * as voiceStorage from '../voiceStorage';
import { EdgeTtsConnection } from '../../edge-tts/EdgeTtsConnection';

const SUPERTONIC_BLOBS = {
  'onnx/duration_predictor.onnx': 'blob:dp', 'onnx/text_encoder.onnx': 'blob:te',
  'onnx/vector_estimator.onnx': 'blob:ve', 'onnx/vocoder.onnx': 'blob:vc',
  'onnx/tts.json': 'blob:tts', 'onnx/unicode_indexer.json': 'blob:idx',
  'voice_styles/F1.json': 'blob:f1',
};

async function initReady(engine: TtsEngine) {
  const initP = engine.init('supertonic-3');
  await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
  const worker = MockWorker.last();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  worker.emit({ type: 'ready', numSpeakers: 1, sampleRate: 24000, loadTimeMs: 5 });
  await initP;
  return worker;
}

describe('TtsEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue(SUPERTONIC_BLOBS as any);
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([]);
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('resolves init on ready and revokes blob URLs once', async () => {
    const engine = new TtsEngine();
    await initReady(engine);
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('generate() resolves on the result message', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();
    const samples = new Float32Array([0.1, 0.2]);
    const p = engine.generate('hi', 0, 1.0);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'generate' }));
    worker.emit({ type: 'result', samples, sampleRate: 24000, generationTimeMs: 20 });
    await expect(p).resolves.toEqual(expect.objectContaining({ sampleRate: 24000 }));
  });

  // generateStream() is TtsEngine's *only* streaming path today, and it is
  // unconditionally backed by EdgeTtsConnection (a real WebSocket client) —
  // it does not branch on the currently loaded model's engine. It first
  // round-trips a 'decode-ready' handshake through `worker.addEventListener`
  // (not `worker.onmessage`, so `MockWorker#emit` can't drive it directly),
  // then hands the actual synthesis off to EdgeTtsConnection. To pin the
  // observable audio-chunk/audio-done routing without opening a real socket,
  // we invoke the captured 'message' listener manually for the handshake and
  // stub out EdgeTtsConnection so `generate()` resolves without networking.
  it('generateStream() forwards audio-chunk to onChunk and resolves on audio-done', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    const edgeGenerateSpy = vi.spyOn(EdgeTtsConnection.prototype, 'generate').mockResolvedValue(undefined);

    const chunks: Float32Array[] = [];
    const p = engine.generateStream('hi', 0, 1.0, undefined, (s) => chunks.push(s));

    // The decode-ready handshake is posted and awaited synchronously before
    // the first `await` inside generateStream(), so it's already recorded.
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'decode-start' });
    const messageListenerCall = worker.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === 'message',
    );
    expect(messageListenerCall).toBeDefined();
    const handler = messageListenerCall![1] as (e: MessageEvent) => void;
    handler({ data: { type: 'decode-ready' } } as MessageEvent);

    // Let the post-handshake continuation run (sets pendingStream, calls
    // EdgeTtsConnection.generate — mocked, so it settles without a socket).
    await vi.waitFor(() => expect(edgeGenerateSpy).toHaveBeenCalledTimes(1));

    worker.emit({ type: 'audio-chunk', samples: new Float32Array([1]), sampleRate: 24000 });
    worker.emit({ type: 'audio-done', generationTimeMs: 30 });
    await expect(p).resolves.toEqual(expect.objectContaining({ generationTimeMs: 30 }));
    expect(chunks.length).toBe(1);
  });

  it('dispose rejects a pending generate and posts dispose', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    const p = engine.generate('hi', 0, 1.0);
    engine.dispose();
    await expect(p).rejects.toThrow(/disposed/i);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.ready).toBe(false);
  });

  it('a pre-ready error rejects init and revokes', async () => {
    const engine = new TtsEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('supertonic-3');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'tts load failed' });
    await expect(initP).rejects.toThrow('tts load failed');
    expect(onError).toHaveBeenCalledWith('tts load failed');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  // TtsEngine holds only one in-flight slot: `pendingGenerate`/`pendingStream`
  // are single-entry fields, not queues. `generate()` and `generateStream()`
  // both guard on them at the very top of the (async) method body — before
  // any `await` — with `throw new Error('A generation request is already in
  // progress')`. Because the method is `async`, that synchronous throw is
  // wrapped into a rejected Promise rather than thrown to the caller
  // directly, so callers observe it as a rejection. This is exactly the
  // single-slot behavior the Task 10 refactor must preserve.
  it('generate() rejects a second concurrent call while one is already pending', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();

    const firstP = engine.generate('first', 0, 1.0); // left unsettled on purpose
    await expect(engine.generate('second', 0, 1.0))
      .rejects.toThrow('A generation request is already in progress');

    // Only the first call reached the worker — the second was rejected
    // before ever posting a message.
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    // Settle the still-pending first request so it doesn't leak into other tests.
    worker.emit({ type: 'result', samples: new Float32Array(), sampleRate: 24000, generationTimeMs: 1 });
    await expect(firstP).resolves.toEqual(expect.objectContaining({ sampleRate: 24000 }));
  });

  it('generateStream() rejects while a generate() call is already pending', async () => {
    const engine = new TtsEngine();
    const worker = await initReady(engine);

    const pendingGenerateP = engine.generate('hi', 0, 1.0); // left unsettled on purpose
    await expect(engine.generateStream('hi', 0, 1.0))
      .rejects.toThrow('A generation request is already in progress');

    // The guard fires before the decode-start handshake, so generateStream()
    // never touches the worker or EdgeTtsConnection.
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'decode-start' });

    worker.emit({ type: 'result', samples: new Float32Array(), sampleRate: 24000, generationTimeMs: 1 });
    await pendingGenerateP;
  });
});
