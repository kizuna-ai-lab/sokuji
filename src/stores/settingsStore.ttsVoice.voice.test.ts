// src/stores/settingsStore.ttsVoice.voice.test.ts (mirror settingsStore.ttsDevice.test.ts mocks)
import { describe, it, expect, vi } from 'vitest';
import { Provider } from '../types/Provider';
// LOCAL_NATIVE is registered in ProviderConfigFactory only under Electron;
// createSessionConfig dispatches through the registry, so the descriptor must
// be present for the session-config assertion.
vi.mock('../utils/environment', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, isElectron: () => true };
});
const mockSetSetting = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: vi.fn(() => ({ setSetting: mockSetSetting, getSetting: vi.fn() })) } }));
vi.mock('../lib/local-inference/modelManifest', async () => ({ ...(await vi.importActual('../lib/local-inference/modelManifest')) }));
const { default: useSettingsStore } = await import('./settingsStore');

describe('ttsVoice setting', () => {
  it('defaults to empty string', () => {
    expect(useSettingsStore.getState().localNative.ttsVoice).toBe('');
  });
  it('is updatable', async () => {
    await useSettingsStore.getState().updateLocalNative({ ttsVoice: 'builtin:Bella' });
    expect(useSettingsStore.getState().localNative.ttsVoice).toBe('builtin:Bella');
  });
  it('session config carries ttsVoice verbatim', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, localNative: { ...useSettingsStore.getState().localNative, ttsVoice: 'custom:3' } } as any);
    expect((useSettingsStore.getState().createSessionConfig('sys') as any).ttsVoice).toBe('custom:3');
  });
});
