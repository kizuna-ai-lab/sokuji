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
  // AST-capable ASR fixture (mirrors granite-speech's shape): appears in both
  // the ASR pool (a plain, autoEligible ASR candidate) and, via astLanguages,
  // the translation pool as an explicit-only (autoEligible: false) candidate
  // — see candidates.wasm.ts. Listed AFTER sensevoice in `all` so ASR
  // auto-selection's stable tie-break (equal recommended/sortOrder/size)
  // picks sensevoice-int8, not this one — required to reproduce the hazard
  // (explicit translation pick != auto-resolved ASR pick).
  const astAsr = {
    id: 'ast-asr', type: 'asr', languages: ['en'], multilingual: false,
    astLanguages: { transcribe: ['en'], translate: ['ja'] }, variants: noSize,
  };
  const all = [sensevoice, opusEnJa, piperJa, piperEn, astAsr];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Skip the IndexedDB scan — readiness logic is what we're exercising here.
    useModelStore.setState({ initialized: true, webgpuAvailable: false });
    // ensureSelectionReady() now reads the language pair and selections off
    // useSettingsStore itself (no snapshot is passed in) — a leftover value
    // from another describe block would silently change what these tests are
    // exercising, so every field it reads is reset here.
    await useSettingsStore.getState().updateLocalInference({
      selections: {}, sourceLanguage: 'en', targetLanguage: 'ja',
    });
    mockGetManifestEntry.mockImplementation((id: string) => all.find(m => m.id === id));
    mockGetManifestByType.mockImplementation((type: string) => all.filter(m => m.type === type));
  });

  it('reports ready when the explicit selection resolves cleanly', async () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded', 'piper-ja': 'downloaded' },
    });
    await useSettingsStore.getState().updateLocalInference({
      selections: {
        [directionKey('en', 'ja')]: {
          asr: { modelId: 'sensevoice-int8' }, translation: { modelId: 'opus-mt-en-ja' }, tts: { modelId: 'piper-ja' },
        },
      },
    });

    const result = await useModelStore.getState().ensureSelectionReady();

    expect(result.ready).toBe(true);
  });

  it('an explicit but language-incompatible TTS choice auto-falls-back to a compatible candidate', async () => {
    useModelStore.setState({
      // piper-en is downloaded but wrong language for targetLanguage 'ja' —
      // resolve()'s TTS pool excludes it entirely, so auto-pick lands on piper-ja.
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded', 'piper-ja': 'downloaded', 'piper-en': 'downloaded' },
    });
    await useSettingsStore.getState().updateLocalInference({
      selections: {
        [directionKey('en', 'ja')]: {
          asr: { modelId: 'sensevoice-int8' }, translation: { modelId: 'opus-mt-en-ja' }, tts: { modelId: 'piper-en' },
        },
      },
    });

    const result = await useModelStore.getState().ensureSelectionReady();

    expect(result.ready).toBe(true);
    // The stale explicit choice is left untouched in storage (only a dead id
    // is pruned) — resolve() is the single source of what actually gets used,
    // and it falls back past the language-incompatible pick to piper-ja.
    const resolved = useModelStore.getState().resolve(
      'en', 'ja', useSettingsStore.getState().localInference.selections);
    expect(resolved.tts?.modelId).toBe('piper-ja');
  });

  it('is not ready when nothing downloaded can resolve ASR or translation', async () => {
    useModelStore.setState({ modelStatuses: {} });

    const result = await useModelStore.getState().ensureSelectionReady();

    expect(result.ready).toBe(false);
  });

  it('is ready even when TTS cannot resolve — a missing voice degrades to subtitles, it never blocks Start', async () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded' },
    });
    await useSettingsStore.getState().updateLocalInference({
      selections: {
        [directionKey('en', 'ja')]: {
          asr: { modelId: 'sensevoice-int8' }, translation: { modelId: 'opus-mt-en-ja' }, tts: { modelId: '' },
        },
      },
    });

    const result = await useModelStore.getState().ensureSelectionReady();

    expect(result.ready).toBe(true);
    expect(result.notes.some((n) => n.stage === 'tts')).toBe(true);
  });

  it('includes participant-direction notes without letting them affect readiness', async () => {
    // piper-en (the participant direction's TTS target, en) is never
    // downloaded in this test — its ASR and translation both resolve via the
    // multilingual sensevoice-int8 / mocked-compatible opus-mt-en-ja, but its
    // TTS stage has no ready candidate. That must surface as a note without
    // affecting readiness, exactly like the speaker-TTS case above.
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded', 'piper-ja': 'downloaded' },
    });
    await useSettingsStore.getState().updateLocalInference({
      selections: {
        [directionKey('en', 'ja')]: {
          asr: { modelId: 'sensevoice-int8' }, translation: { modelId: 'opus-mt-en-ja' }, tts: { modelId: 'piper-ja' },
        },
      },
    });

    const result = await useModelStore.getState().ensureSelectionReady();

    expect(result.ready).toBe(true);
    expect(result.notes.some((n) => n.direction === 'ja→en' && n.stage === 'tts')).toBe(true);
  });

  // Task 1 (external review, PR #436): ensureSelectionReady used to gate on
  // the RAW resolve() output, while buildSessionConfig separately applied
  // the AST cross-stage guard (astGuard.ts) afterward — so a hazardous
  // explicit pick (an AST-capable ASR model chosen as the translation stage,
  // not matching the resolved ASR) could read `ready: true` here while the
  // guard downgraded the built session's translationModelId to auto (or
  // null) at Start. These pin the guard being applied to the SPEAKER
  // direction BEFORE `ready`/`notes` are computed.
  describe('AST cross-stage guard applied before readiness (Task 1)', () => {
    const dir = directionKey('en', 'ja');
    // ast-asr is downloaded and, picked explicitly for TRANSLATION, resolves
    // successfully on its own — but auto-ASR (nothing explicit for asr) ties
    // out to sensevoice-int8 (see the `all` fixture's ordering comment), not
    // ast-asr. That mismatch is exactly the hazard guardAstCrossStage exists
    // to catch.
    const hazardSelections = {
      [dir]: { asr: { modelId: '' }, translation: { modelId: 'ast-asr' }, tts: { modelId: '' } },
    };

    it('is not ready when the masked-back-to-auto translation has no downloaded ordinary model to fall back to', async () => {
      useModelStore.setState({
        modelStatuses: { 'sensevoice-int8': 'downloaded', 'ast-asr': 'downloaded' }, // opus-mt-en-ja NOT downloaded
      });
      await useSettingsStore.getState().updateLocalInference({ selections: hazardSelections });

      // Sanity: the raw (unguarded) resolve() reproduces the hazard — this is
      // the exact bug the guard exists to close off from the readiness gate.
      const raw = useModelStore.getState().resolve('en', 'ja', hazardSelections);
      expect(raw.translation?.modelId).toBe('ast-asr');
      expect(raw.asr?.modelId).not.toBe('ast-asr');

      const result = await useModelStore.getState().ensureSelectionReady();

      expect(result.ready).toBe(false);
    });

    it('is ready — and the guarded resolution feeding buildSessionConfig uses the downloaded ordinary model — once one is downloaded', async () => {
      useModelStore.setState({
        modelStatuses: {
          'sensevoice-int8': 'downloaded', 'ast-asr': 'downloaded', 'opus-mt-en-ja': 'downloaded',
        },
      });
      await useSettingsStore.getState().updateLocalInference({ selections: hazardSelections });

      const result = await useModelStore.getState().ensureSelectionReady();

      expect(result.ready).toBe(true);
      // buildSessionConfig (LocalInferenceProviderConfig.ts) applies the same
      // guard over this same resolve() call — pinning that the masked
      // translation stage lands on the downloaded ordinary model, not on
      // ast-asr or null, is what makes `ready: true` here trustworthy.
      const guardedTranslationId = result.notes.find((n) => n.stage === 'translation' && n.from === 'ast-asr')?.to;
      expect(guardedTranslationId).toBe('opus-mt-en-ja');
    });

    it('emits a note naming the masked pick and its replacement, without dropping the note when there is no replacement', async () => {
      useModelStore.setState({
        modelStatuses: { 'sensevoice-int8': 'downloaded', 'ast-asr': 'downloaded' },
      });
      await useSettingsStore.getState().updateLocalInference({ selections: hazardSelections });

      const result = await useModelStore.getState().ensureSelectionReady();

      const note = result.notes.find((n) => n.stage === 'translation' && n.from === 'ast-asr');
      expect(note).toMatchObject({
        direction: dir, stage: 'translation', from: 'ast-asr', to: null, reason: 'lang-incompatible',
      });
    });
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
  beforeEach(async () => {
    vi.clearAllMocks();
    // Empty manifest by default — later describe blocks in this file leave
    // mockGetManifestByType wired to their own fixtures, and clearAllMocks
    // doesn't reset implementations.
    mockGetManifestByType.mockReturnValue([]);
    // applyPrunes reaches the real settingsStore via a dynamic import — reset
    // it so a leftover selection from another describe block can't leak in.
    // Awaited: updateLocalInference persists asynchronously (updateProviderSlice),
    // so an unawaited call here can still be in flight when the next test's
    // assertions run.
    await useSettingsStore.getState().updateLocalInference({ selections: {} });
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
