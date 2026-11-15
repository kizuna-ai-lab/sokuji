/**
 * One settings page (settings page plan, ruling 4): `settings.common.uiMode`
 * stays stored and is still read, but nothing writes it any more.
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
});

describe('the old Quick or Advanced choice', () => {
  it('is still read from storage', async () => {
    stored['settings.common.uiMode'] = 'advanced';
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().uiMode).toBe('advanced');
  });

  it('has no writer left, and loading writes nothing to it', async () => {
    expect('setUIMode' in useSettingsStore.getState()).toBe(false);
    await useSettingsStore.getState().loadSettings();
    expect(setSetting.mock.calls.some((call) => (call as unknown[])[0] === 'settings.common.uiMode')).toBe(false);
  });
});
