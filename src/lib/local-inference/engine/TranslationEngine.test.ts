import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranslationEngine } from './TranslationEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

async function initReady(engine: TranslationEngine, model = 'opus-mt-ja-en') {
  const initP = engine.init('ja', 'en', model);
  await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
  const worker = MockWorker.last();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  worker.emit({ type: 'ready', loadTimeMs: 3, device: 'wasm' });
  await initP;
  return worker;
}

describe('TranslationEngine (characterization)', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restore = installMockWorker();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'default' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'config.json': 'blob:c' });
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); });

  it('resolves init on ready and revokes blob URLs once', async () => {
    const engine = new TranslationEngine();
    await initReady(engine);
    expect(engine.ready).toBe(true);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('translate() correlates the result by id', async () => {
    const engine = new TranslationEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();
    const p = engine.translate('こんにちは', 'sys', true);
    // capture the id the engine assigned
    const sent = worker.postMessage.mock.calls[0][0] as any;
    expect(sent.type).toBe('translate');
    worker.emit({ type: 'result', id: sent.id, sourceText: 'こんにちは', translatedText: 'hello', inferenceTimeMs: 12 });
    await expect(p).resolves.toEqual(expect.objectContaining({ translatedText: 'hello', inferenceTimeMs: 12 }));
  });

  it('an id-scoped error rejects only that request', async () => {
    const engine = new TranslationEngine();
    const worker = await initReady(engine);
    worker.postMessage.mockClear();
    const p = engine.translate('x', 'sys', false);
    const sent = worker.postMessage.mock.calls[0][0] as any;
    worker.emit({ type: 'error', id: sent.id, error: 'translate failed' });
    await expect(p).rejects.toThrow('translate failed');
  });

  it('dispose rejects all pending translate() promises and posts dispose', async () => {
    const engine = new TranslationEngine();
    const worker = await initReady(engine);
    const p1 = engine.translate('a', 's', false);
    const p2 = engine.translate('b', 's', false);
    engine.dispose();
    await expect(p1).rejects.toThrow(/disposed/i);
    await expect(p2).rejects.toThrow(/disposed/i);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects init and revokes on a pre-ready error', async () => {
    const engine = new TranslationEngine();
    const onError = vi.fn(); engine.onError = onError;
    const initP = engine.init('ja', 'en', 'opus-mt-ja-en');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    MockWorker.last().emit({ type: 'error', error: 'model load failed' });
    await expect(initP).rejects.toThrow('model load failed');
    expect(onError).toHaveBeenCalledWith('model load failed');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
