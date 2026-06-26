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
  it('is undefined (automatic) by default', () => {
    expect(useSettingsStore.getState().localNative.translationVariant).toBeUndefined();
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();
  });

  it('a pinned variant is forwarded as config.translationVariant for load select_variant(pin)', async () => {
    await useSettingsStore.getState().updateLocalNative({
      translationModel: 'hy-mt2-7b', translationVariant: 'fp8',
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    // Load's _h_translate_init pins on config.translationVariant; it MUST equal the variant
    // the download fetched (fp8), else local_files_only load of the recommended repo fails.
    expect(cfg.translationVariant).toBe('fp8');
  });

  it('clearing the pin (undefined) returns the config to automatic', async () => {
    await useSettingsStore.getState().updateLocalNative({ translationVariant: undefined });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();
  });
});
