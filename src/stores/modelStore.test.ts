import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modelManifest functions
const mockGetManifestEntry = vi.fn();
const mockGetAsrModelsForLanguage = vi.fn();
const mockGetTranslationModel = vi.fn();
const mockGetManifestByType = vi.fn();

vi.mock('../lib/local-inference/modelManifest', () => ({
  MODEL_MANIFEST: [],
  getManifestEntry: (...args: any[]) => mockGetManifestEntry(...args),
  getManifestByType: (...args: any[]) => mockGetManifestByType(...args),
  getAsrModelsForLanguage: (...args: any[]) => mockGetAsrModelsForLanguage(...args),
  getTranslationModel: (...args: any[]) => mockGetTranslationModel(...args),
  getTtsModelsForLanguage: vi.fn(() => []),
  isTranslationModelCompatible: vi.fn(() => true),
}));

vi.mock('../lib/local-inference/modelStorage', () => ({
  init: vi.fn(),
  getModelStatus: vi.fn(),
  clearAll: vi.fn(),
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
