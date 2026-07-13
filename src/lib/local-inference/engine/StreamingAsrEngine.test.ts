import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingAsrEngine } from './StreamingAsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

describe('StreamingAsrEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    // voxtral-mini-4b-webgpu → voxtral-webgpu module worker path, no metadata fetch.
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'q4' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'model.onnx': 'blob:m' });
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('resolves init on ready and revokes blob URLs once', async () => {
    const engine = new StreamingAsrEngine();
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: 'ready', loadTimeMs: 9 });
    await expect(initP).resolves.toEqual({ loadTimeMs: 9 });
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('delivers partial and final results via callbacks', async () => {
    const engine = new StreamingAsrEngine();
    const onPartial = vi.fn(); const onResult = vi.fn();
    engine.onPartialResult = onPartial; engine.onResult = onResult;
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.emit({ type: 'partial', text: 'wor' });
    worker.emit({ type: 'result', text: 'world', durationMs: 8, recognitionTimeMs: 4 });
    expect(onPartial).toHaveBeenCalledWith('wor');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'world', durationMs: 8, recognitionTimeMs: 4 }));
  });

  it('rejects init and revokes on a pre-ready error', async () => {
    const engine = new StreamingAsrEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    // Wait for postMessage: the cleanup-revoking onmessage wrapper is only
    // installed after the isModelReady/getModelBlobUrls/getModelVariantInfo
    // awaits resolve, right before postMessage is sent. An error emitted
    // before that point hits the original (unwrapped) handler and still
    // rejects + fires onError, but does NOT revoke — so we wait here to
    // characterize the (wrapped) revoke-on-error path.
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: 'error', error: 'stream fail' });
    await expect(initP).rejects.toThrow('stream fail');
    expect(onError).toHaveBeenCalledWith('stream fail');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('feedAudio and flush post only when ready', async () => {
    const engine = new StreamingAsrEngine();
    const initP = engine.init('voxtral-mini-4b-webgpu');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();

    // Not ready yet — feedAudio/flush must be silently ignored.
    engine.feedAudio(new Int16Array([9]), 24000);
    engine.flush();
    const preReadyCalls = worker.postMessage.mock.calls.filter(
      ([msg]: [{ type: string }]) => msg?.type === 'audio' || msg?.type === 'flush',
    );
    expect(preReadyCalls).toHaveLength(0);

    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await initP;
    worker.postMessage.mockClear();
    const samples = new Int16Array([1, 2]);
    engine.feedAudio(samples, 24000);
    engine.flush();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'audio', samples, sampleRate: 24000 }, [samples.buffer]);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'flush' });
  });

  it('dispose posts dispose, terminates, resets ready', async () => {
    const engine = new StreamingAsrEngine();
    const initP = engine.init('voxtral-mini-4b-webgpu');
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
