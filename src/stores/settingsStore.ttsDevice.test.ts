import { describe, it, expect, vi } from 'vitest';
import { Provider } from '../types/Provider';

// LOCAL_NATIVE is registered in ProviderConfigFactory only under Electron;
// createSessionConfig dispatches through the registry, so the descriptor must
// be present for these session-config assertions.
vi.mock('../utils/environment', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, isElectron: () => true };
});

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

describe('ttsDevice setting', () => {
  it('defaults to auto', () => {
    expect(useSettingsStore.getState().localNative.ttsDevice).toBe('auto');
  });
  it('is updatable', async () => {
    await useSettingsStore.getState().updateLocalNative({ ttsDevice: 'cuda' });
    expect(useSettingsStore.getState().localNative.ttsDevice).toBe('cuda');
  });
  it('local_native session config carries the ttsDevice override', () => {
    useSettingsStore.setState({
      provider: Provider.LOCAL_NATIVE,
      localNative: {
        ...useSettingsStore.getState().localNative,
        ttsDevice: 'cpu',
      },
    } as any);
    const config = useSettingsStore.getState().createSessionConfig('sys');
    expect((config as any).ttsDevice).toBe('cpu');
  });
});
