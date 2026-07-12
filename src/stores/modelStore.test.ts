import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    pickBestModel: actual.pickBestModel,
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

describe('getParticipantModelStatus', () => {
  // Reusable model fixtures
  const sensevoice = { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en', 'zh'], multilingual: true };
  const whisperEn = { id: 'whisper-en', type: 'asr', languages: ['en'], multilingual: false };
  const opusMtEnJa = { id: 'opus-mt-en-ja', type: 'translation', languages: ['en', 'ja'], sourceLang: 'en', targetLang: 'ja' };
  const opusMtJaEn = { id: 'opus-mt-ja-en', type: 'translation', languages: ['ja', 'en'], sourceLang: 'ja', targetLang: 'en' };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no models. Tests override per-type as needed.
    mockGetManifestByType.mockReturnValue([]);
  });

  // Helper: set up getManifestByType to return models by type
  function setupManifest(models: any[]) {
    mockGetManifestByType.mockImplementation((type: string) =>
      models.filter(m => m.type === type)
    );
  }

  it('returns available status when current ASR supports target lang and translation model exists', () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded' },
    });
    setupManifest([sensevoice, opusMtEnJa]);

    const status = useModelStore.getState().getParticipantModelStatus('ja', 'en', 'sensevoice-int8');

    expect(status.asrAvailable).toBe(true);
    expect(status.asrModelId).toBe('sensevoice-int8');
    expect(status.asrFallback).toBe(false);
    expect(status.translationAvailable).toBe(true);
    expect(status.translationModelId).toBe('opus-mt-en-ja');
  });

  it('falls back to alternative ASR when current model does not support target lang', () => {
    useModelStore.setState({
      modelStatuses: { 'whisper-en': 'downloaded', 'sensevoice-int8': 'downloaded', 'opus-mt-ja-en': 'downloaded' },
    });
    setupManifest([whisperEn, sensevoice, opusMtJaEn]);

    // sourceLang='en', targetLang='ja' → participant source='ja', needs ASR for 'ja'
    const status = useModelStore.getState().getParticipantModelStatus('en', 'ja', 'whisper-en');

    expect(status.asrAvailable).toBe(true);
    expect(status.asrModelId).toBe('sensevoice-int8');
    expect(status.asrFallback).toBe(true);
    expect(status.asrOriginalModelId).toBe('whisper-en');
  });

  it('returns asrAvailable=false when no ASR model supports participant source lang', () => {
    useModelStore.setState({
      modelStatuses: { 'whisper-en': 'downloaded' },
    });
    setupManifest([whisperEn]);

    const status = useModelStore.getState().getParticipantModelStatus('en', 'ja', 'whisper-en');

    expect(status.asrAvailable).toBe(false);
    expect(status.asrModelId).toBeNull();
  });

  it('returns translationAvailable=false when no translation model supports reverse direction', () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded' },
    });
    setupManifest([sensevoice]); // no translation models at all

    const status = useModelStore.getState().getParticipantModelStatus('ja', 'en', 'sensevoice-int8');

    expect(status.asrAvailable).toBe(true);
    expect(status.translationAvailable).toBe(false);
    expect(status.translationModelId).toBeNull();
  });

  it('returns translationAvailable=false when reverse translation model exists but not downloaded', () => {
    useModelStore.setState({
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'not_downloaded' },
    });
    setupManifest([sensevoice, opusMtEnJa]);

    const status = useModelStore.getState().getParticipantModelStatus('ja', 'en', 'sensevoice-int8');

    expect(status.asrAvailable).toBe(true);
    expect(status.translationAvailable).toBe(false);
    expect(status.translationModelId).toBeNull();
  });
});

describe('rememberModels / recallModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ modelPreferences: {} });
    // Manifest entries persist even when a download is deleted, so recall's
    // readiness check (modelUsable) can resolve every remembered id. These
    // fixtures are plain local models (no cloud/webgpu), so usability reduces
    // to the modelStatuses download state the individual tests drive.
    mockGetManifestEntry.mockImplementation((id: string) => ({ id, type: 'asr', languages: [] }));
  });

  it('remembers and recalls models for a language pair', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');
    const recalled = useModelStore.getState().recallModels('ja', 'en');

    expect(recalled).toEqual({
      asrModel: 'sensevoice-int8',
      translationModel: 'opus-mt-ja-en',
      ttsModel: 'piper-en',
    });
  });

  it('returns null when no record exists', () => {
    const recalled = useModelStore.getState().recallModels('ja', 'en');
    expect(recalled).toBeNull();
  });

  it('treats different directions as separate keys', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'opus-mt-en-ja': 'downloaded',
        'piper-en': 'downloaded',
        'piper-ja': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');
    useModelStore.getState().rememberModels('en', 'ja', 'sensevoice-int8', 'opus-mt-en-ja', 'piper-ja');

    const jaEn = useModelStore.getState().recallModels('ja', 'en');
    const enJa = useModelStore.getState().recallModels('en', 'ja');

    expect(jaEn!.translationModel).toBe('opus-mt-ja-en');
    expect(enJa!.translationModel).toBe('opus-mt-en-ja');
    expect(jaEn!.ttsModel).toBe('piper-en');
    expect(enJa!.ttsModel).toBe('piper-ja');
  });

  it('degrades per-field when a model is deleted', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');

    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'not_downloaded',
      },
    });

    const recalled = useModelStore.getState().recallModels('ja', 'en');

    expect(recalled).not.toBeNull();
    expect(recalled!.asrModel).toBe('sensevoice-int8');
    expect(recalled!.translationModel).toBe('opus-mt-ja-en');
    expect(recalled!.ttsModel).toBe('');
  });

  it('degrades all fields when all models deleted', () => {
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'piper-en': 'downloaded',
      },
    });

    useModelStore.getState().rememberModels('ja', 'en', 'sensevoice-int8', 'opus-mt-ja-en', 'piper-en');

    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'not_downloaded',
        'opus-mt-ja-en': 'not_downloaded',
        'piper-en': 'not_downloaded',
      },
    });

    const recalled = useModelStore.getState().recallModels('ja', 'en');
    expect(recalled).not.toBeNull();
    expect(recalled!.asrModel).toBe('');
    expect(recalled!.translationModel).toBe('');
    expect(recalled!.ttsModel).toBe('');
  });
});

describe('autoSelectModels device gating', () => {
  // A downloaded webgpu ASR model must NOT be auto-selected when webgpu is
  // unavailable — otherwise autoSelect hands the session a model isProviderReady
  // then rejects (dead-end selection). This gate now flows through modelUsable,
  // matching isProviderReady / getParticipantModelStatus.
  const webgpuAsr = { id: 'voxtral-webgpu', type: 'asr', languages: ['en'], multilingual: true, requiredDevice: 'webgpu' };
  const plainAsr = { id: 'sensevoice-int8', type: 'asr', languages: ['en'], multilingual: true };

  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ modelPreferences: {}, webgpuAvailable: false });
    mockGetManifestEntry.mockImplementation((id: string) =>
      [webgpuAsr, plainAsr].find(m => m.id === id),
    );
    mockGetManifestByType.mockImplementation((type: string) =>
      [webgpuAsr, plainAsr].filter(m => m.type === type),
    );
  });

  it('skips a downloaded webgpu ASR model when webgpu is unavailable', () => {
    useModelStore.setState({
      modelStatuses: { 'voxtral-webgpu': 'downloaded', 'sensevoice-int8': 'downloaded' },
    });

    const updates = useModelStore.getState().autoSelectModels('en', 'ja', 'voxtral-webgpu', '', '');

    expect(updates?.asrModel).toBe('sensevoice-int8');
  });

  it('keeps a webgpu ASR model when webgpu is available', () => {
    useModelStore.setState({
      webgpuAvailable: true,
      modelStatuses: { 'voxtral-webgpu': 'downloaded', 'sensevoice-int8': 'downloaded' },
    });

    const updates = useModelStore.getState().autoSelectModels('en', 'ja', 'voxtral-webgpu', '', '');

    // Current model is usable → no ASR correction emitted.
    expect(updates?.asrModel).toBeUndefined();
  });
});

describe('ensureSelectionReady', () => {
  const sensevoice = { id: 'sensevoice-int8', type: 'asr', languages: ['ja', 'en'], multilingual: true };
  const opusEnJa = { id: 'opus-mt-en-ja', type: 'translation', languages: ['en', 'ja'] };
  const piperJa = { id: 'piper-ja', type: 'tts', languages: ['ja'], multilingual: false };
  const piperEn = { id: 'piper-en', type: 'tts', languages: ['en'], multilingual: false };
  const all = [sensevoice, opusEnJa, piperJa, piperEn];

  beforeEach(() => {
    vi.clearAllMocks();
    // Skip the IndexedDB scan — readiness logic is what we're exercising here.
    useModelStore.setState({ initialized: true, modelPreferences: {}, webgpuAvailable: false });
    mockGetManifestEntry.mockImplementation((id: string) => all.find(m => m.id === id));
    mockGetManifestByType.mockImplementation((type: string) => all.filter(m => m.type === type));
  });

  it('reports ready with no corrections when the selection is already valid', async () => {
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

  it('corrects a stale TTS selection and judges readiness against the correction', async () => {
    useModelStore.setState({
      // piper-en is downloaded but wrong language; piper-ja is the valid one.
      modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-ja': 'downloaded', 'piper-ja': 'downloaded', 'piper-en': 'downloaded' },
    });

    const result = await useModelStore.getState().ensureSelectionReady({
      sourceLanguage: 'en', targetLanguage: 'ja',
      asrModel: 'sensevoice-int8', translationModel: 'opus-mt-en-ja', ttsModel: 'piper-en',
    });

    expect(result.corrections?.ttsModel).toBe('piper-ja');
    expect(result.ready).toBe(true);
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
