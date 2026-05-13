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

// Pretend we're running inside Electron so the IPC-guarded actions
// (enterSubtitleMode, exit*, toggle*) follow their real-environment paths.
vi.mock('../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/environment')>();
  return {
    ...actual,
    isElectron: () => true,
  };
});

// Provide a window.electron stub so the IPC-guarded actions can run.
// The renderer code only calls invoke() — return resolved promises with
// the shape each handler is expected to deliver.
beforeEach(() => {
  (window as any).electron = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'subtitle:enter') {
        return { ok: true, bounds: { x: 0, y: 0, width: 800, height: 200 } };
      }
      return { ok: true };
    }),
    receive: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
    send: () => {},
  };
});

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

  // NOTE: setSubtitleFontSize / setSubtitleBgOpacity / etc. moved to subtitleStore in Task 5.
  // Their clamping behavior is covered by subtitleStore tests.
});
