import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ServiceFactory (required — settingsStore calls it during updateLocalNative)
const mockSetSetting = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: mockSetSetting,
      getSetting: vi.fn(),
    })),
  },
}));

// Mock modelManifest (required — settingsStore imports it at module level)
vi.mock('../lib/local-inference/modelManifest', async () => {
  const actual = await vi.importActual('../lib/local-inference/modelManifest');
  return { ...actual };
});

// Import after mocking
const { default: useSettingsStore, createLocalNativeSessionConfig } = await import('./settingsStore');
const { useNativeModelStore } = await import('./nativeModelStore');

describe('translationVariant pin reaches the session config (download/load agree)', () => {
  it('is undefined (automatic) by default — empty per-model map', () => {
    expect(useSettingsStore.getState().localNative.translationVariantByModel).toEqual({});
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();
  });

  it('forwards the active model\'s chosen quant as config.translationVariant', async () => {
    await useSettingsStore.getState().updateLocalNative({
      translationModel: 'hy-mt2-7b', translationVariantByModel: { 'hy-mt2-7b': 'fp8' },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBe('fp8');
  });

  it('a quant chosen for a NON-active model does not affect the active config', async () => {
    await useSettingsStore.getState().updateLocalNative({
      translationModel: 'qwen2.5-0.5b', translationVariantByModel: { 'hy-mt2-7b': 'fp8' },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();   // active model has no entry
  });
});

describe('ttsVariant pin reaches the session config (download/load agree)', () => {
  // Same generic translationVariantByModel map as ASR/translation (Task 10) — keyed
  // by the RESOLVED tts model id. Unlike translationModelId (a straight passthrough
  // of the settings choice), resolving the tts model id needs a real catalog entry
  // — createLocalNativeSessionConfig here is the settingsStore back-compat wrapper,
  // which delegates to LocalNativeProviderConfig.buildSessionConfig and reads the
  // catalog from nativeModelStore itself (not a param), so seed it via setState.
  const ttsCatalog = {
    'qwen3-tts-1.7b': {
      id: 'qwen3-tts-1.7b', name: 'Qwen3 TTS 1.7B', languages: ['en'], recommended: true,
      tiers: [], order: 0, repo: 'qwen3-tts-1.7b', kind: 'tts' as const,
    },
  };

  beforeEach(() => {
    useNativeModelStore.setState({ catalog: ttsCatalog });
  });

  it('is undefined (automatic) with an empty per-model map', async () => {
    // The store is a shared singleton mutated by the sibling describe block above
    // (this file's tests run sequentially against one store instance) — reset the
    // map explicitly rather than assume a pristine store.
    await useSettingsStore.getState().updateLocalNative({ translationVariantByModel: {} });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.ttsVariant).toBeUndefined();
  });

  it('forwards the active TTS model\'s chosen quant as config.ttsVariant', async () => {
    await useSettingsStore.getState().updateLocalNative({
      ttsModel: 'qwen3-tts-1.7b', targetLanguage: 'en',
      translationVariantByModel: { 'qwen3-tts-1.7b': 'bf16' },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.ttsVariant).toBe('bf16');
  });

  it('a quant chosen for a NON-active TTS model does not affect the active config', async () => {
    await useSettingsStore.getState().updateLocalNative({
      ttsModel: '', targetLanguage: 'en',   // Auto resolves to qwen3-tts-1.7b (only 'en' entry)
      translationVariantByModel: { 'some-other-tts': 'bf16' },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.ttsVariant).toBeUndefined();   // resolved model has no entry
  });
});
