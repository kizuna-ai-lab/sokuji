import { describe, it, expect, vi } from 'vitest';

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
