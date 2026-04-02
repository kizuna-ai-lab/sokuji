import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Provider } from '../types/Provider';

// Mock ServiceFactory first
const mockSetSetting = vi.fn().mockResolvedValue(undefined);
const mockGetSetting = vi.fn();
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: mockSetSetting,
      getSetting: mockGetSetting,
    })),
  },
}));

// Import after mocking
const { default: useSettingsStore } = await import('./settingsStore');

describe('settingsStore', () => {
  beforeEach(() => {
    // Reset the store before each test
    useSettingsStore.setState({
      provider: Provider.OPENAI,
      isValidated: false,
      isValidating: false,
      validationError: null,
      cacheTimestamp: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Provider Switching', () => {
    it('should set provider and clear cache without calling validateApiKey', async () => {
      // setProvider no longer calls validateApiKey directly —
      // validation is delegated to SettingsInitializer which reacts to provider changes.
      const store = useSettingsStore.getState();

      // Set some cache data first
      useSettingsStore.setState({
        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
        availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
        isApiKeyValid: true,
      });

      // Switch to Gemini
      await store.setProvider(Provider.GEMINI);

      // Provider should be updated
      expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);

      // Cache should be cleared (availableModels reset, validationCache empty)
      const state = useSettingsStore.getState();
      expect(state.availableModels).toEqual([]);
      expect(state.isApiKeyValid).toBeNull();
    });

    it('should NOT trigger auto-validation when switching to KizunaAI provider', async () => {
      const store = useSettingsStore.getState();

      // Mock validateApiKey
      const validateSpy = vi.spyOn(store, 'validateApiKey').mockImplementation(async () => {
        useSettingsStore.setState({ isValidating: true });
        useSettingsStore.setState({
          isValidating: false,
          isValidated: true,
          validationError: null,
        });
      });

      // Switch to KizunaAI
      await store.setProvider(Provider.KIZUNA_AI);

      // validateApiKey should NOT be called from setProvider (handled by SettingsInitializer)
      expect(validateSpy).not.toHaveBeenCalled();

      // Provider should be updated
      expect(useSettingsStore.getState().provider).toBe(Provider.KIZUNA_AI);
    });

    it('should clear cache when switching providers', async () => {
      // Set some cache data
      useSettingsStore.setState({
        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
        availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
        isApiKeyValid: true,
      });

      // Switch provider
      await useSettingsStore.getState().setProvider(Provider.GEMINI);

      // Verify cache was cleared by checking state (not spy)
      const state = useSettingsStore.getState();
      expect(state.validationCache.size).toBe(0);
      expect(state.availableModels).toEqual([]);
      expect(state.isApiKeyValid).toBeNull();
    });

    it('should persist provider change to settings service', async () => {
      // Switch provider
      await useSettingsStore.getState().setProvider(Provider.OPENAI_COMPATIBLE);

      // Check that settings service was called
      expect(mockSetSetting).toHaveBeenCalledWith(
        'settings.common.provider',
        Provider.OPENAI_COMPATIBLE
      );
    });
  });

  describe('Cache Management', () => {
    it('should clear cache and reset validation state', () => {
      // Set initial state with cache
      useSettingsStore.setState({
        validationCache: new Map([['test', { validation: { valid: true, message: '' }, models: [], timestamp: Date.now() }]]),
        availableModels: [{ id: 'test', type: 'realtime' as const, created: 0 }],
        isApiKeyValid: true,
      });

      // Clear cache
      useSettingsStore.getState().clearCache();

      // Check state was reset
      const state = useSettingsStore.getState();
      expect(state.validationCache.size).toBe(0);
      expect(state.availableModels).toEqual([]);
      expect(state.isApiKeyValid).toBeNull();
    });
  });
});

describe('createParticipantLocalInferenceConfig', () => {
  it('swaps languages and resolves reverse models', async () => {
    const { createParticipantLocalInferenceConfig } = await import('./settingsStore');

    const baseConfig = {
      provider: 'local_inference' as const,
      model: 'local-asr-translate',
      instructions: '',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      asrModelId: 'sensevoice-int8',
      translationModelId: 'opus-mt-ja-en',
      ttsModelId: 'piper-en',
      ttsSpeakerId: 0,
      ttsSpeed: 1.0,
    };

    // Mock getParticipantModelStatus on the model store
    const { useModelStore } = await import('./modelStore');
    const originalState = useModelStore.getState();
    vi.spyOn(useModelStore, 'getState').mockReturnValue({
      ...originalState,
      getParticipantModelStatus: () => ({
        asrAvailable: true,
        asrModelId: 'sensevoice-int8',
        asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8',
        translationAvailable: true,
        translationModelId: 'opus-mt-en-ja',
      }),
    });

    const result = createParticipantLocalInferenceConfig(baseConfig);

    expect(result).not.toBeNull();
    expect(result!.config.sourceLanguage).toBe('en');
    expect(result!.config.targetLanguage).toBe('ja');
    expect(result!.config.asrModelId).toBe('sensevoice-int8');
    expect(result!.config.translationModelId).toBe('opus-mt-en-ja');
    expect(result!.config.ttsModelId).toBeUndefined();
    expect(result!.status.translationAvailable).toBe(true);

    vi.restoreAllMocks();
  });

  it('returns null when no ASR model is available', async () => {
    const { createParticipantLocalInferenceConfig } = await import('./settingsStore');

    const baseConfig = {
      provider: 'local_inference' as const,
      model: 'local-asr-translate',
      instructions: '',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      asrModelId: 'whisper-en',
      translationModelId: 'opus-mt-en-ja',
      ttsModelId: 'piper-ja',
      ttsSpeakerId: 0,
      ttsSpeed: 1.0,
    };

    const { useModelStore } = await import('./modelStore');
    vi.spyOn(useModelStore, 'getState').mockReturnValue({
      ...useModelStore.getState(),
      getParticipantModelStatus: () => ({
        asrAvailable: false,
        asrModelId: null,
        asrFallback: false,
        asrOriginalModelId: 'whisper-en',
        translationAvailable: false,
        translationModelId: null,
      }),
    });

    const result = createParticipantLocalInferenceConfig(baseConfig);
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });
});
