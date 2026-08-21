import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelManager } from '../lib/local-inference/ModelManager';
import { ModelImportError } from '../lib/local-inference/modelImport';
import { directionKey } from '../lib/local-inference/selection/types';

// modelStore now statically imports settingsStore (for `resolve`/`applyPrunes`
// to read and write localInference.selections) — stub the persistence layer
// settingsStore's updateProviderSlice touches, same as settingsStore.test.ts.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

// Mock modelManifest functions
const mockGetManifestEntry = vi.fn();
const mockGetAsrModelsForLanguage = vi.fn();
const mockGetTranslationModel = vi.fn();
const mockGetManifestByType = vi.fn();

vi.mock('../lib/local-inference/modelManifest', async () => {
  // Pull the pure readiness/compat predicates from the real module so the store
  // exercises real logic; keep the data-lookup functions mocked.
  const actual = await vi.importActual<any>('../lib/local-inference/modelManifest');
  return {
    MODEL_MANIFEST: [],
    getManifestEntry: (...args: any[]) => mockGetManifestEntry(...args),
    getManifestByType: (...args: any[]) => mockGetManifestByType(...args),
    getAsrModelsForLanguage: (...args: any[]) => mockGetAsrModelsForLanguage(...args),
    getTranslationModel: (...args: any[]) => mockGetTranslationModel(...args),
    getTtsModelsForLanguage: vi.fn(() => []),
    isTranslationModelCompatible: vi.fn(() => true),
    modelUsable: actual.modelUsable,
    isAstCompatible: actual.isAstCompatible,
    // resolve()'s candidates.wasm.ts pulls these two directly (not through
    // modelUsable) so a note can say WHICH half failed. Real implementations —
    // they're pure and only need the (mocked) manifest entry + device inputs.
    deviceReady: actual.deviceReady,
    getModelSizeMb: actual.getModelSizeMb,
  };
});

const mockEstimateStorageUsedBytes = vi.fn();
const mockGetMetadata = vi.fn();

vi.mock('../lib/local-inference/modelStorage', () => ({
  init: vi.fn(),
  getModelStatus: vi.fn(),
  clearAll: vi.fn(),
  estimateStorageUsedBytes: (...args: any[]) => mockEstimateStorageUsedBytes(...args),
  getMetadata: (...args: any[]) => mockGetMetadata(...args),
}));

vi.mock('../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

vi.mock('../utils/webgpu', () => ({
  checkWebGPU: vi.fn().mockResolvedValue(false),
}));

const { useModelStore } = await import('./modelStore');
const { default: useSettingsStore } = await import('./settingsStore');

describe('ensureSelectionReady', () => {
  // Every non-cloud candidate needs a `variants` entry — resolve()'s
  // candidates.wasm.ts sizes each one via the real getModelSizeMb(), which
  // reads entry.variants[selectedKey].files.
  const noSize = { default: { files: [] } };
  const sensevoice = { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en'], multilingual: true, variants: noSize };
  const opusEnJa = { id: 'opus-mt-en-ja', type: 'translation', languages: ['en', 'ja'], variants: noSize };
  const piperJa = { id: 'piper-ja', type: 'tts', languages: ['ja'], multilingual: false, variants: noSize };
  const piperEn = { id: 'piper-en', type: 'tts', languages: ['en'], multilingual: false, variants: noSize };
  const all = [sensevoice, opusEnJa, piperJa, piperEn];

  beforeEach(() => {
    vi.clearAllMocks();
    // Skip the IndexedDB scan — readiness logic is what we're exercising here.
    useModelStore.setState({ initialized: true, webgpuAvailable: false });
    // No direction has an explicit selection — resolve() reads live off
    // useSettingsStore, so a leftover selection from another describe block
    // would silently change what these tests are exercising.
    useSettingsStore.getState().updateLocalInference({ selections: {} });
    mockGetManifestEntry.mockImplementation((id: string) => all.find(m => m.id === id));
    mockGetManifestByType.mockImplementation((type: string) => all.filter(m => m.type === type));
  });

  it('reports ready with no corrections when the flat selection already matches the resolved direction', async () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded', 'piper-ja': 'downloaded' },
    });

    const result = await useModelStore.getState().ensureSelectionReady({
      sourceLanguage: 'en', targetLanguage: 'ja',
      asrModel: 'sensevoice-int8', translationModel: 'opus-mt-en-ja', ttsModel: 'piper-ja',
    });

    expect(result.ready).toBe(true);
    expect(result.corrections).toBeNull();
  });

  it('corrects a stale flat TTS field to what the resolver actually picked', async () => {
    useModelStore.setState({
      // piper-en is downloaded but wrong language for targetLanguage 'ja' —
      // resolve()'s TTS pool excludes it entirely, so auto-pick lands on piper-ja.
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded', 'piper-ja': 'downloaded', 'piper-en': 'downloaded' },
    });

    const result = await useModelStore.getState().ensureSelectionReady({
      sourceLanguage: 'en', targetLanguage: 'ja',
      asrModel: 'sensevoice-int8', translationModel: 'opus-mt-en-ja', ttsModel: 'piper-en',
    });

    expect(result.corrections?.ttsModel).toBe('piper-ja');
    expect(result.ready).toBe(true);
  });

  it('is not ready when nothing downloaded can resolve ASR or translation', async () => {
    useModelStore.setState({ modelStatuses: {} });

    const result = await useModelStore.getState().ensureSelectionReady({
      sourceLanguage: 'en', targetLanguage: 'ja',
      asrModel: '', translationModel: '', ttsModel: '',
    });

    expect(result.ready).toBe(false);
  });
});

describe('importModel', () => {
  const mockImportModelFiles = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ modelStatuses: {}, downloads: {}, downloadErrors: {}, modelVariants: {} });
    vi.mocked(ModelManager.getInstance).mockReturnValue({
      importModelFiles: mockImportModelFiles,
    } as any);
    mockEstimateStorageUsedBytes.mockResolvedValue(0);
  });

  const oneFile = () => [new File([new Uint8Array([1, 2, 3])], 'config.json')];

  it('marks the model downloaded and records its variant on a successful import', async () => {
    mockImportModelFiles.mockResolvedValue('q4f16');

    await useModelStore.getState().importModel('voxtral-mini-4b-webgpu', oneFile());

    const s = useModelStore.getState();
    expect(s.modelStatuses['voxtral-mini-4b-webgpu']).toBe('downloaded');
    expect(s.modelVariants['voxtral-mini-4b-webgpu']).toBe('q4f16');
    expect(s.downloads['voxtral-mini-4b-webgpu']).toBeUndefined();
    expect(s.downloadErrors['voxtral-mini-4b-webgpu']).toBeUndefined();
  });

  it('records an error with the missing-file list when the import is incomplete', async () => {
    mockImportModelFiles.mockRejectedValue(new ModelImportError(['onnx/decoder.onnx_data']));

    await expect(
      useModelStore.getState().importModel('voxtral-mini-4b-webgpu', oneFile()),
    ).rejects.toBeInstanceOf(ModelImportError);

    const s = useModelStore.getState();
    expect(s.modelStatuses['voxtral-mini-4b-webgpu']).toBe('error');
    expect(s.downloadErrors['voxtral-mini-4b-webgpu']).toMatch(/onnx\/decoder\.onnx_data/);
    expect(s.downloads['voxtral-mini-4b-webgpu']).toBeUndefined();
  });

  it('keeps the model downloaded even if the storage estimate fails afterward', async () => {
    // The import itself succeeded and the files are persisted; a cosmetic
    // storage-estimate failure must NOT flip the model into an error state.
    mockImportModelFiles.mockResolvedValue('q4');
    mockEstimateStorageUsedBytes.mockRejectedValue(new Error('estimate boom'));

    await useModelStore.getState().importModel('voxtral-mini-4b-webgpu', oneFile());

    const s = useModelStore.getState();
    expect(s.modelStatuses['voxtral-mini-4b-webgpu']).toBe('downloaded');
    expect(s.modelVariants['voxtral-mini-4b-webgpu']).toBe('q4');
    expect(s.downloadErrors['voxtral-mini-4b-webgpu']).toBeUndefined();
    expect(s.downloads['voxtral-mini-4b-webgpu']).toBeUndefined();
  });
});

describe('initialize resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ initialized: false, initError: null });
  });

  it('records initError and stays uninitialized when storage open fails', async () => {
    mockEstimateStorageUsedBytes.mockRejectedValue(
      new DOMException('The requested version (2) is less than the existing version (3).', 'VersionError'),
    );
    await useModelStore.getState().initialize();
    expect(useModelStore.getState().initialized).toBe(false);
    expect(useModelStore.getState().initError).toMatch(/version/i);
  });

  it('retry succeeds once the failure cause is gone', async () => {
    mockEstimateStorageUsedBytes.mockRejectedValueOnce(new Error('boom'));
    await useModelStore.getState().initialize();
    expect(useModelStore.getState().initError).toBe('boom');
    expect(useModelStore.getState().initialized).toBe(false);

    mockEstimateStorageUsedBytes.mockResolvedValue(0);
    await useModelStore.getState().initialize();
    expect(useModelStore.getState().initialized).toBe(true);
    expect(useModelStore.getState().initError).toBeNull();
  });
});

describe('modelStore.resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Empty manifest by default — later describe blocks in this file leave
    // mockGetManifestByType wired to their own fixtures, and clearAllMocks
    // doesn't reset implementations.
    mockGetManifestByType.mockReturnValue([]);
    // applyPrunes reaches the real settingsStore via a dynamic import — reset
    // it so a leftover selection from another describe block can't leak in.
    useSettingsStore.getState().updateLocalInference({ selections: {} });
  });

  it('resolves a direction from the manifest and current download statuses', () => {
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: false });
    const r = useModelStore.getState().resolve('ja', 'en', {});
    // Nothing downloaded: every local stage is unresolvable.
    expect(r.asr).toBeNull();
    expect(r.notes.some((n) => n.stage === 'asr' && n.reason === 'no-candidate')).toBe(true);
  });

  it('does not mutate the selections object it is given', () => {
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: false });
    const dir = directionKey('ja', 'en');
    const selections = {
      [dir]: { asr: { modelId: 'x' }, translation: { modelId: 'y' }, tts: { modelId: '' } },
    };
    const before = JSON.stringify(selections);
    useModelStore.getState().resolve('ja', 'en', selections);
    expect(JSON.stringify(selections)).toBe(before);
  });

  it('applyPrunes clears only the named stages and drops an all-auto direction', async () => {
    const dir = directionKey('ja', 'en');
    await useSettingsStore.getState().updateLocalInference({
      selections: {
        [dir]: { asr: { modelId: 'gone' }, translation: { modelId: 'kept' }, tts: { modelId: '' } },
      },
    });
    await useModelStore.getState().applyPrunes([{ direction: dir, stage: 'asr' }]);
    expect(useSettingsStore.getState().localInference.selections[dir]).toEqual({
      asr: { modelId: '' }, translation: { modelId: 'kept' }, tts: { modelId: '' },
    });

    await useModelStore.getState().applyPrunes([{ direction: dir, stage: 'translation' }]);
    expect(useSettingsStore.getState().localInference.selections[dir]).toBeUndefined();
  });
});
