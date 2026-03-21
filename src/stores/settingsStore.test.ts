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
      vi.useFakeTimers();
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

      // Fast-forward timer (in case any setTimeout is still present)
      vi.advanceTimersByTime(200);

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
