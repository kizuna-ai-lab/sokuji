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

  // A <select> fires change on every arrow-key step, so writes overlap: a
  // refused write must not roll back over a newer pick.
  it('a refused write does not roll back over a newer pick', async () => {
    useSettingsStore.setState({ theme: 'dark' });
    let refuse!: () => void;
    setSetting.mockImplementationOnce(() => new Promise((resolve) => { refuse = () => resolve({ success: false, error: 'disk full' }); }));
    const first = useSettingsStore.getState().setTheme('light');
    const second = useSettingsStore.getState().setTheme('system');
    await second;
    refuse();
    await first;
    expect(useSettingsStore.getState().theme).toBe('system');
  });

  // While the settings cannot be read, the app runs on defaults; the store
  // says so, so the appearance applies those defaults (and a later pick)
  // instead of waiting for a load that will never report.
  it('a load that fails is marked as failed', async () => {
    expect(useSettingsStore.getState().settingsLoadFailed).toBe(false);
    stored = new Proxy({}, { has() { throw new Error('storage unavailable'); } });
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().settingsLoadFailed).toBe(true);
  });
});
