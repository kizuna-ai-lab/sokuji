import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

describe('AsrEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    // sensevoice-int8 → default sherpa path, which fetches package-metadata.json
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'int8' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({
      'package-metadata.json': 'blob:meta',
      'sense.onnx': 'blob:model',
    });
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) }) as any));
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('resolves init with loadTimeMs on ready and revokes blob URLs once', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8');
    // Let the pre-worker awaits (isModelReady, getModelBlobUrls, metadata fetch) settle.
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled()); // init posted
    worker.emit({ type: 'ready', loadTimeMs: 7 });
    await expect(initP).resolves.toEqual({ loadTimeMs: 7 });
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('delivers status/speech_start/partial/result via callbacks after ready', async () => {
    const engine = new AsrEngine();
    const onStatus = vi.fn(); const onSpeechStart = vi.fn();
    const onPartial = vi.fn(); const onResult = vi.fn();
    engine.onStatus = onStatus; engine.onSpeechStart = onSpeechStart;
    engine.onPartialResult = onPartial; engine.onResult = onResult;
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.emit({ type: 'status', message: 'loading' });
    worker.emit({ type: 'speech_start' });
    worker.emit({ type: 'partial', text: 'he' });
    worker.emit({ type: 'result', text: 'hello', durationMs: 10, recognitionTimeMs: 5 });
    expect(onStatus).toHaveBeenCalledWith('loading');
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(onPartial).toHaveBeenCalledWith('he');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', durationMs: 10, recognitionTimeMs: 5 }));
  });

  it('rejects init and revokes on a pre-ready error, firing onError', async () => {
    const engine = new AsrEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'bad model' });
    await expect(initP).rejects.toThrow('bad model');
    expect(onError).toHaveBeenCalledWith('bad model');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('feedAudio posts an audio message (transferring the buffer) only when ready', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    const before = new Int16Array([1, 2, 3]);
    engine.feedAudio(before, 24000);            // not ready yet → ignored
    const audioCallsBeforeReady = worker.postMessage.mock.calls.filter(
      ([msg]: [{ type: string }]) => msg?.type === 'audio',
    ).length;
    expect(audioCallsBeforeReady).toBe(0);
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.postMessage.mockClear();
    const samples = new Int16Array([4, 5, 6]);
    engine.feedAudio(samples, 24000);
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: 'audio', samples, sampleRate: 24000 },
      [samples.buffer],
    );
  });

  it('dispose posts dispose, terminates, and resets ready', async () => {
    const engine = new AsrEngine();
    const initP = engine.init('sensevoice-int8');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    engine.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(engine.ready).toBe(false);
  });
});
