import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, SHOW_SETTINGS_SESSION_KEY, readShowSettingsFromSession } from './layoutStore';

beforeEach(() => {
  sessionStorage.clear();
  useLayoutStore.setState({ showSettings: false });
});

describe('layoutStore', () => {
  it('persists showSettings to sessionStorage the way MainLayout did', () => {
    useLayoutStore.getState().setShowSettings(true);
    expect(useLayoutStore.getState().showSettings).toBe(true);
    expect(sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY)).toBe('true');
    useLayoutStore.getState().setShowSettings(false);
    expect(sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY)).toBe('false');
  });

  it('initialises from sessionStorage', () => {
    sessionStorage.setItem(SHOW_SETTINGS_SESSION_KEY, 'true');
    expect(readShowSettingsFromSession()).toBe(true);
    sessionStorage.removeItem(SHOW_SETTINGS_SESSION_KEY);
    expect(readShowSettingsFromSession()).toBe(false);
  });
});
