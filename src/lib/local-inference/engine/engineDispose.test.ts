import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { StreamingAsrEngine } from './StreamingAsrEngine';
import { TranslationEngine } from './TranslationEngine';
import { TtsEngine } from './TtsEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';
import * as voiceStorage from '../voiceStorage';

/**
 * A load aborted before its worker exists (ruling 6): `dispose()` while
 * `init()` still awaits its model files rejects that `init()` and creates no
 * worker — without the check, `init()` would go on to build the worker and
 * load the whole model for a session nobody is waiting for.
 */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('engine init aborted by dispose()', () => {
  let restore: () => void;
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let releaseFiles: ((urls: Record<string, string>) => void) | undefined;
  const files = { 'package-metadata.json': 'blob:meta', 'model.onnx': 'blob:m' };

  beforeEach(() => {
    restore = installMockWorker();
    releaseFiles = undefined;
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'q4' } as any);
    // The model files stay pending until the test releases them.
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockImplementation(
      () => new Promise((resolve) => { releaseFiles = resolve; }),
    );
    revokeSpy = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) }) as any));
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const cases: Array<[string, () => { dispose(): void; init: () => Promise<unknown> }]> = [
    ['AsrEngine', () => { const e = new AsrEngine(); return { dispose: () => e.dispose(), init: () => e.init('sensevoice-int8', undefined, 'ja') }; }],
    ['StreamingAsrEngine', () => { const e = new StreamingAsrEngine(); return { dispose: () => e.dispose(), init: () => e.init('voxtral-mini-4b-webgpu') }; }],
    ['TranslationEngine', () => { const e = new TranslationEngine(); return { dispose: () => e.dispose(), init: () => e.init('ja', 'en', 'opus-mt-ja-en') }; }],
    ['TtsEngine', () => { const e = new TtsEngine(); return { dispose: () => e.dispose(), init: () => e.init('supertonic-3') }; }],
  ];

  for (const [name, make] of cases) {
    it(`${name}: rejects the pending init and creates no worker`, async () => {
      const engine = make();
      const initP = engine.init();
      initP.catch(() => {}); // asserted below, after the worker count
      await vi.waitFor(() => expect(releaseFiles).toBeTypeOf('function'));
      engine.dispose();
      releaseFiles!({ ...files });
      await flush();
      expect(MockWorker.instances).toHaveLength(0);
      await expect(initP).rejects.toThrow('disposed');
      // The object URLs the aborted load was handed are not leaked.
      expect(revokeSpy).toHaveBeenCalledWith(expect.objectContaining({ 'model.onnx': 'blob:m' }));
    });
  }
});
