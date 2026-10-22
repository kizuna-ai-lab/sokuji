/**
 * `settings.common.theme` (spec 2026-10-22 §4): three values, default dark
 * (R1), an unknown stored value falls to the default, a refused write rolls
 * the state back like every other common setting.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<object>()),
  isElectron: () => true,
  isExtension: () => false,
}));

const setSetting = vi.fn(async (): Promise<unknown> => ({ success: true }));
let stored: Record<string, unknown> = {};
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      getSetting: vi.fn(async (key: string, fallback: unknown) => (key in stored ? stored[key] : fallback)),
      setSetting: (...args: unknown[]) => setSetting(...(args as [])),
    })),
  },
}));

const { default: useSettingsStore } = await import('./settingsStore');

beforeEach(() => {
  stored = {};
  setSetting.mockClear();
  setSetting.mockImplementation(async () => ({ success: true }));
});

describe('the appearance setting', () => {
  it('defaults to dark', () => {
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('loads a stored light', async () => {
    stored['settings.common.theme'] = 'light';
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('an unknown stored value loads as dark', async () => {
    useSettingsStore.setState({ theme: 'light' });
    stored['settings.common.theme'] = 'sepia';
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('setTheme writes settings.common.theme and keeps the value', async () => {
    await useSettingsStore.getState().setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(setSetting).toHaveBeenCalledWith('settings.common.theme', 'system');
  });

  it('setTheme rolls back when the write fails', async () => {
    useSettingsStore.setState({ theme: 'dark' });
    setSetting.mockResolvedValueOnce({ success: false, error: 'disk full' });
    await useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });
});
