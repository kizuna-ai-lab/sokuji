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

// Mock estimateModelMemoryByDevice so we can control memory budget checks
const mockEstimateMemory = vi.fn().mockReturnValue({ vramMb: 0, ramMb: 0 });
vi.mock('../lib/local-inference/modelManifest', async () => {
  const actual = await vi.importActual('../lib/local-inference/modelManifest');
  return {
    ...actual,
    estimateModelMemoryByDevice: (...args: any[]) => mockEstimateMemory(...args),
  };
});

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

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unexpected');
    expect(result.config.sourceLanguage).toBe('en');
    expect(result.config.targetLanguage).toBe('ja');
    expect(result.config.asrModelId).toBe('sensevoice-int8');
    expect(result.config.translationModelId).toBe('opus-mt-en-ja');
    expect(result.config.ttsModelId).toBeUndefined();
    expect(result.status.translationAvailable).toBe(true);

    vi.restoreAllMocks();
  });

  it('returns no_asr when no ASR model is available', async () => {
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
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unexpected');
    expect(result.reason).toBe('no_asr');

    vi.restoreAllMocks();
  });

  it('returns memory_exceeded when VRAM budget is exceeded', async () => {
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

    const { useModelStore } = await import('./modelStore');
    vi.spyOn(useModelStore, 'getState').mockReturnValue({
      ...useModelStore.getState(),
      getParticipantModelStatus: () => ({
        asrAvailable: true,
        asrModelId: 'sensevoice-int8',
        asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8',
        translationAvailable: true,
        translationModelId: 'opus-mt-en-ja',
      }),
    });

    // Set VRAM budget via localStorage override, then simulate models exceeding it
    localStorage.setItem('debug:vram-budget', '4096');
    mockEstimateMemory.mockReturnValue({ vramMb: 8000, ramMb: 0 });

    const result = createParticipantLocalInferenceConfig(baseConfig);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unexpected');
    expect(result.reason).toBe('memory_exceeded');
    expect(result.detail).toContain('VRAM');
    expect(result.detail).toContain('8000MB');

    localStorage.removeItem('debug:vram-budget');
    mockEstimateMemory.mockReturnValue({ vramMb: 0, ramMb: 0 });
    vi.restoreAllMocks();
  });

  describe('Volcengine AST 2.0 custom vocabulary', () => {
    const volcBase = {
      appId: 'app-id',
      accessToken: 'token',
      sourceLanguage: 'zh' as const,
      targetLanguage: 'en' as const,
      turnDetectionMode: 'Auto' as const,
    };

    it('omits all three corpus fields when values are empty strings', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '',
          replacementTableId: '',
          glossaryTableId: '',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect(config.provider).toBe('volcengine_ast2');
      expect((config as any).hotWordTableId).toBeUndefined();
      expect((config as any).replacementTableId).toBeUndefined();
      expect((config as any).glossaryTableId).toBeUndefined();
    });

    it('omits fields that contain only whitespace', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '   ',
          replacementTableId: '\t\n',
          glossaryTableId: ' ',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect((config as any).hotWordTableId).toBeUndefined();
      expect((config as any).replacementTableId).toBeUndefined();
      expect((config as any).glossaryTableId).toBeUndefined();
    });

    it('trims and passes through set IDs; leaves others undefined', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '  hot-abc  ',
          replacementTableId: '',
          glossaryTableId: 'gloss-1',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect((config as any).hotWordTableId).toBe('hot-abc');
      expect((config as any).replacementTableId).toBeUndefined();
      expect((config as any).glossaryTableId).toBe('gloss-1');
    });

    it('trims all three when all are set', () => {
      useSettingsStore.setState({
        provider: Provider.VOLCENGINE_AST2,
        volcengineAST2: {
          ...volcBase,
          hotWordTableId: '\thot-1\t',
          replacementTableId: ' rep-2 ',
          glossaryTableId: 'gloss-3',
        },
      } as any);

      const config = useSettingsStore.getState().createSessionConfig('sys');
      expect((config as any).hotWordTableId).toBe('hot-1');
      expect((config as any).replacementTableId).toBe('rep-2');
      expect((config as any).glossaryTableId).toBe('gloss-3');
    });
  });
});
