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
const { default: useSettingsStore } = await import('./settingsStore');

describe('translationDevice setting', () => {
  it('defaults to auto', () => {
    expect(useSettingsStore.getState().localNative.translationDevice).toBe('auto');
  });
  it('is updatable', async () => {
    await useSettingsStore.getState().updateLocalNative({ translationDevice: 'cuda' });
    expect(useSettingsStore.getState().localNative.translationDevice).toBe('cuda');
  });
});
