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

// Default to pretending we're running inside Electron so the IPC-guarded
// actions (enterSubtitleMode, exitSubtitleMode) follow their real-environment
// paths. Individual tests flip `isElectronFlag` to false to exercise the
// extension's session-gated path (see the "per-surface entry gating" block).
let isElectronFlag = true;
vi.mock('../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/environment')>();
  return {
    ...actual,
    isElectron: () => isElectronFlag,
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
    useSettingsStore.setState({ subtitleModeActive: false, subtitleFullscreen: false });
    isElectronFlag = true;
  });

  // Issue #324: the Electron subtitle window carries its own Start control
  // and must be enterable before a session exists. This mirrors
  // SubtitleEnterButton's `canEnter` gating (subtitleEnterGate.ts) — the
  // button being enabled and the store refusing entry was exactly the bug
  // this pair of tests guards against.
  describe('per-surface entry gating (subtitleEnterGate)', () => {
    it('enters on Electron with no active session', async () => {
      isElectronFlag = true;
      useSessionStore.setState({ isSessionActive: false } as any);
      await useSettingsStore.getState().enterSubtitleMode();
      expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
    });

    it('stays a no-op on the extension with no active session', async () => {
      isElectronFlag = false;
      useSessionStore.setState({ isSessionActive: false } as any);
      await useSettingsStore.getState().enterSubtitleMode();
      expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
    });
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

  it('enterSubtitleMode is concurrency-safe (TOCTOU)', async () => {
    // Regression: two concurrent enter() calls (e.g. double-click) both
    // pass the subtitleModeActive guard, then both await the surface and
    // both fire the subtitle:enter IPC. On the Electron path the main
    // process snapshots normalBoundsSnapshot on every call, and the
    // second invocation captures the *already-shrunk* subtitle bounds —
    // exit would then restore the window to subtitle size. Same bug
    // class as the one fixed in 8f9aea85.
    useSessionStore.setState({ isSessionActive: true } as any);
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockClear();
    const enter = useSettingsStore.getState().enterSubtitleMode;
    await Promise.all([enter(), enter()]);
    const enterCalls = invokeMock.mock.calls.filter(
      (c: any[]) => c[0] === 'subtitle:enter',
    );
    expect(enterCalls.length).toBe(1);
    expect(useSettingsStore.getState().subtitleModeActive).toBe(true);
  });

  it('exitSubtitleMode is concurrency-safe', async () => {
    useSettingsStore.setState({ subtitleModeActive: true });
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockClear();
    const exit = useSettingsStore.getState().exitSubtitleMode;
    await Promise.all([exit(), exit()]);
    const exitCalls = invokeMock.mock.calls.filter(
      (c: any[]) => c[0] === 'subtitle:exit',
    );
    expect(exitCalls.length).toBe(1);
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('enterSubtitleMode rolls back the flag and re-throws if surface.enter() rejects', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockImplementationOnce(async (channel: string) => {
      if (channel === 'subtitle:enter') throw new Error('boom');
      return { ok: true };
    });
    await expect(useSettingsStore.getState().enterSubtitleMode()).rejects.toThrow(/boom/);
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('setSubtitleFullscreen(true) sets the flag and invokes subtitle:set-fullscreen', async () => {
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockClear();
    await useSettingsStore.getState().setSubtitleFullscreen(true);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('subtitle:set-fullscreen', true);
  });

  it('setSubtitleFullscreen rolls back the flag if the surface rejects', async () => {
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockImplementationOnce(async (channel: string) => {
      if (channel === 'subtitle:set-fullscreen') throw new Error('boom');
      return { ok: true };
    });
    await useSettingsStore.getState().setSubtitleFullscreen(true);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('enterSubtitleMode resets subtitleFullscreen to false (always start windowed)', async () => {
    useSessionStore.setState({ isSessionActive: true } as any);
    useSettingsStore.setState({ subtitleFullscreen: true });
    await useSettingsStore.getState().enterSubtitleMode();
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('exitSubtitleMode resets subtitleFullscreen to false', async () => {
    useSettingsStore.setState({ subtitleModeActive: true, subtitleFullscreen: true });
    await useSettingsStore.getState().exitSubtitleMode();
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('__notifySubtitleSurfaceExited resets subtitleFullscreen (external exit)', () => {
    useSettingsStore.setState({ subtitleModeActive: true, subtitleFullscreen: true });
    useSettingsStore.getState().__notifySubtitleSurfaceExited();
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(false);
  });

  it('__syncSubtitleFullscreen sets state only and does not call the surface', () => {
    const invokeMock = (window as any).electron.invoke;
    invokeMock.mockClear();
    useSettingsStore.getState().__syncSubtitleFullscreen(true);
    expect(useSettingsStore.getState().subtitleFullscreen).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  // NOTE: setSubtitleFontSize / setSubtitleBgOpacity / etc. moved to subtitleStore in Task 5.
  // Their clamping behavior is covered by subtitleStore tests.
});
