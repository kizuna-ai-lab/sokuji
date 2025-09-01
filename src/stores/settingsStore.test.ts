import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Provider } from '../types/Provider';

// Mock ServiceFactory first
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn(),
      getSetting: vi.fn(),
    })),
  },
}));

// Import after mocking
const { useSettingsStore } = await import('./settingsStore');
const { ServiceFactory } = await import('../services/ServiceFactory');

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
    it('should trigger auto-validation when switching to non-KizunaAI provider', async () => {
      vi.useFakeTimers();
      const store = useSettingsStore.getState();
      
      // Mock validateApiKey
      const validateSpy = vi.spyOn(store, 'validateApiKey').mockImplementation(async () => {
        useSettingsStore.setState({ isValidating: true });
        // Simulate validation
        useSettingsStore.setState({ 
          isValidating: false, 
          isValidated: true,
          validationError: null,
        });
      });

      // Switch to Gemini
      await store.setProvider(Provider.GEMINI);
      
      // Fast-forward timer
      vi.advanceTimersByTime(100);
      
      // Check that validateApiKey was called
      expect(validateSpy).toHaveBeenCalled();
      
      // Check that provider was updated
      expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
    });

    it('should NOT trigger auto-validation when switching to KizunaAI provider', async () => {
      vi.useFakeTimers();
      const store = useSettingsStore.getState();
      
      // Mock validateApiKey
      const validateSpy = vi.spyOn(store, 'validateApiKey').mockImplementation(async () => {
        useSettingsStore.setState({ isValidating: true });
        // Simulate validation
        useSettingsStore.setState({ 
          isValidating: false, 
          isValidated: true,
          validationError: null,
        });
      });

      // Switch to KizunaAI
      await store.setProvider(Provider.KIZUNA_AI);
      
      // Fast-forward timer
      vi.advanceTimersByTime(100);
      
      // Check that validateApiKey was NOT called (handled by SettingsInitializer)
      expect(validateSpy).not.toHaveBeenCalled();
      
      // Check that provider was updated
      expect(useSettingsStore.getState().provider).toBe(Provider.KIZUNA_AI);
    });

    it('should clear cache when switching providers', async () => {
      const store = useSettingsStore.getState();
      
      // Set some cache data
      useSettingsStore.setState({ 
        cacheTimestamp: Date.now(),
        isValidated: true,
      });

      // Mock clearCache
      const clearCacheSpy = vi.spyOn(store, 'clearCache');

      // Switch provider
      await store.setProvider(Provider.GEMINI);
      
      // Check that cache was cleared
      expect(clearCacheSpy).toHaveBeenCalled();
    });

    it('should persist provider change to settings service', async () => {
      const store = useSettingsStore.getState();
      const settingsService = ServiceFactory.getSettingsService();
      
      // Switch provider
      await store.setProvider(Provider.COMET_API);
      
      // Check that settings service was called
      expect(settingsService.setSetting).toHaveBeenCalledWith(
        'settings.common.provider',
        Provider.COMET_API
      );
    });
  });

  describe('Cache Management', () => {
    it('should clear cache and reset validation state', () => {
      // Set initial state with cache
      useSettingsStore.setState({
        cacheTimestamp: Date.now(),
        isValidated: true,
        validationError: 'some error',
      });

      // Clear cache
      const store = useSettingsStore.getState();
      store.clearCache();

      // Check state was reset
      const state = useSettingsStore.getState();
      expect(state.cacheTimestamp).toBeNull();
      expect(state.isValidated).toBe(false);
      expect(state.validationError).toBeNull();
    });
  });
});