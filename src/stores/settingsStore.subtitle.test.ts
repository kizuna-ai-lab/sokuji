// src/stores/settingsStore.subtitle.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: any) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Import after mocking
const { default: useSettingsStore } = await import('./settingsStore');
const { default: useSessionStore } = await import('./sessionStore');

describe('settingsStore subtitle actions', () => {
  beforeEach(() => {
    useSettingsStore.setState({ subtitleModeActive: false });
  });

  it('enterSubtitleMode is a no-op when session is not active', async () => {
    useSessionStore.setState({ isSessionActive: false } as any);
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('enterSubtitleMode sets the flag when session is active', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
  });

  it('enterSubtitleMode is idempotent', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    await useSettingsStore.getState().enterSubtitleMode();
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
  });

  it('exitSubtitleMode resets the flag', async () => {
    useSettingsStore.setState({ subtitleModeActive: true });
    await useSettingsStore.getState().exitSubtitleMode();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('setSubtitleFontSize clamps to 16-48', async () => {
    await useSettingsStore.getState().setSubtitleFontSize(8);
    expect(useSettingsStore.getState().subtitle.fontSize).toBe(16);
    await useSettingsStore.getState().setSubtitleFontSize(100);
    expect(useSettingsStore.getState().subtitle.fontSize).toBe(48);
  });

  it('setSubtitleBgOpacity clamps to 0-100', async () => {
    await useSettingsStore.getState().setSubtitleBgOpacity(-5);
    expect(useSettingsStore.getState().subtitle.bgOpacity).toBe(0);
    await useSettingsStore.getState().setSubtitleBgOpacity(150);
    expect(useSettingsStore.getState().subtitle.bgOpacity).toBe(100);
  });
});
