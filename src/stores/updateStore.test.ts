import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The status handler is Electron's: the listeners register only there.
vi.mock('../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/environment')>()),
  isElectron: () => true,
}));

import { registerRunPhase } from '../app/runPhase';
import useUpdateStore from './updateStore';

describe('updateStore', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      status: 'idle',
      newVersion: null,
      changelog: null,
      downloadProgress: 0,
      downloadSpeed: 0,
      downloadTransferred: 0,
      downloadTotal: 0,
      errorMessage: null,
      downloadUrl: null,
      supportsAutoUpdate: true,
      appImageUrl: null,
      debUrl: null,
      releasePageUrl: null,
      bannerDismissed: false,
      dialogOpen: false,
      errorFrom: null,
    });
  });

  // NOTE: These tests do not verify the store's *initial* defaults (the
  // singleton makes that awkward without `vi.resetModules()` + re-import).
  // beforeEach above sets the fields explicitly to the documented baseline,
  // so these tests serve as a schema-level guard — they fail if a field is
  // removed or its type drifts.

  it('retains supportsAutoUpdate=true after baseline reset (Windows-like default)', () => {
    expect(useUpdateStore.getState().supportsAutoUpdate).toBe(true);
  });

  it('retains appImageUrl, debUrl, releasePageUrl as null after baseline reset', () => {
    const s = useUpdateStore.getState();
    expect(s.appImageUrl).toBeNull();
    expect(s.debUrl).toBeNull();
    expect(s.releasePageUrl).toBeNull();
  });

  it('accepts setState writes to the new fields', () => {
    useUpdateStore.setState({
      supportsAutoUpdate: false,
      appImageUrl: 'https://example.com/app.AppImage',
      debUrl: 'https://example.com/app.deb',
      releasePageUrl: 'https://example.com/release',
    });
    const s = useUpdateStore.getState();
    expect(s.supportsAutoUpdate).toBe(false);
    expect(s.appImageUrl).toBe('https://example.com/app.AppImage');
    expect(s.debUrl).toBe('https://example.com/app.deb');
    expect(s.releasePageUrl).toBe('https://example.com/release');
  });

  it('an error status stays until the next check (spec 2026-10-05 §4: the Help link shows it, not a timer)', () => {
    vi.useFakeTimers();
    useUpdateStore.setState({ status: 'error', errorMessage: 'offline' });
    vi.advanceTimersByTime(10_000);
    expect(useUpdateStore.getState().status).toBe('error');
    vi.useRealTimers();
  });

  // Ruling 9: the banner keeps a way back after a failed download or install, so the store
  // remembers which status the error interrupted — in memory, until any other status.
  describe('errorFrom', () => {
    let status: (data: Record<string, unknown>) => void = () => {};
    beforeEach(() => {
      (window as unknown as { electron: unknown }).electron = {
        receive: vi.fn((channel: string, fn: (data: Record<string, unknown>) => void) => { if (channel === 'update-status') status = fn; }),
        removeListener: vi.fn(),
        invoke: vi.fn(),
      };
      useUpdateStore.getState().initListeners();
    });
    afterEach(() => {
      useUpdateStore.getState().cleanupListeners();
      delete (window as unknown as { electron?: unknown }).electron;
    });

    it('is the status an error interrupted, kept through a repeated error, and cleared by any other status', () => {
      status({ status: 'downloading' });
      status({ status: 'error', message: 'net::ERR' });
      expect(useUpdateStore.getState()).toMatchObject({ status: 'error', errorFrom: 'downloading' });
      // electron-updater reports one failure twice (the rejected download and its 'error' event).
      status({ status: 'error', message: 'net::ERR' });
      expect(useUpdateStore.getState().errorFrom).toBe('downloading');
      status({ status: 'available', version: '0.43.0' });
      expect(useUpdateStore.getState().errorFrom).toBeNull();
      status({ status: 'downloaded' });
      status({ status: 'error', message: 'install failed' });
      expect(useUpdateStore.getState().errorFrom).toBe('downloaded');
      status({ status: 'checking' });
      expect(useUpdateStore.getState().errorFrom).toBeNull();
      status({ status: 'error', message: 'offline' });
      expect(useUpdateStore.getState().errorFrom).toBe('checking');
      status({ status: 'not-available' });
      expect(useUpdateStore.getState().errorFrom).toBeNull();
    });

    it('is null for an error that interrupted nothing it names', () => {
      status({ status: 'error', message: 'No update available to download' });
      expect(useUpdateStore.getState()).toMatchObject({ status: 'error', errorFrom: null });
    });
  });
});

// Squirrel on Windows applies the package itself and reports no byte counts:
// the main process sends `{ status: 'downloading', indeterminate: true }`.
describe('indeterminate download', () => {
  const listen = () => {
    const handlers: Record<string, (d: any) => void> = {};
    (window as any).electron = {
      receive: (ch: string, h: (d: any) => void) => { handlers[ch] = h; },
      removeListener: () => {},
      invoke: async () => {},
    };
    useUpdateStore.getState().initListeners();
    return handlers;
  };
  afterEach(() => {
    useUpdateStore.getState().cleanupListeners();
    delete (window as any).electron;
  });

  it('records an indeterminate downloading status and clears it with the next status', () => {
    const handlers = listen();
    handlers['update-status']({ status: 'downloading', indeterminate: true });
    expect(useUpdateStore.getState()).toMatchObject({ status: 'downloading', downloadIndeterminate: true });
    handlers['update-status']({ status: 'downloaded' });
    expect(useUpdateStore.getState()).toMatchObject({ status: 'downloaded', downloadIndeterminate: false });
  });

  it('treats a byte-counted download as determinate', () => {
    const handlers = listen();
    handlers['update-status']({ status: 'downloading' });
    expect(useUpdateStore.getState().downloadIndeterminate).toBe(false);
  });
});

// The update's notes open with the news of an update, unless a session would be covered by them.
describe("the update's notes open when an update is found", () => {
  let status: (data: Record<string, unknown>) => void = () => {};
  beforeEach(() => {
    registerRunPhase(() => 'idle');
    useUpdateStore.setState({ status: 'idle', dialogOpen: false, bannerDismissed: false, errorFrom: null, lastCheckBy: 'auto' });
    (window as unknown as { electron: unknown }).electron = {
      receive: vi.fn((channel: string, fn: (data: Record<string, unknown>) => void) => { if (channel === 'update-status') status = fn; }),
      removeListener: vi.fn(),
      invoke: vi.fn(),
    };
    useUpdateStore.getState().initListeners();
  });
  afterEach(() => {
    useUpdateStore.getState().cleanupListeners();
    delete (window as unknown as { electron?: unknown }).electron;
    registerRunPhase(() => 'idle');
    vi.useRealTimers();
  });

  it("opens them for the app's own check after launch, while no session is on", () => {
    status({ status: 'checking' });
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState()).toMatchObject({ status: 'available', dialogOpen: true, lastCheckBy: 'auto' });
  });

  it("leaves them closed for the app's own check while a session is starting, running or stopping", () => {
    for (const phase of ['starting', 'running', 'stopping'] as const) {
      useUpdateStore.setState({ status: 'idle', dialogOpen: false });
      registerRunPhase(() => phase);
      status({ status: 'checking' });
      status({ status: 'available', version: '0.52.0' });
      expect(useUpdateStore.getState()).toMatchObject({ status: 'available', dialogOpen: false });
    }
  });

  it('opens them for a check the user asked for, also during a session', () => {
    vi.useFakeTimers();
    registerRunPhase(() => 'running');
    useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState().lastCheckBy).toBe('user');
    // The main process announces the check it was asked for: still the user's.
    status({ status: 'checking' });
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState()).toMatchObject({ dialogOpen: true, lastCheckBy: 'auto' });
  });

  it("an update announced with no check before it, after a check the user asked for ended, is the app's own", () => {
    vi.useFakeTimers();
    useUpdateStore.getState().checkForUpdates();
    status({ status: 'not-available' });
    registerRunPhase(() => 'running');
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
  });

  it('a check the user asked for that never answers is forgotten with its timeout', () => {
    vi.useFakeTimers();
    useUpdateStore.getState().checkForUpdates();
    vi.advanceTimersByTime(15_000);
    expect(useUpdateStore.getState()).toMatchObject({ status: 'idle', lastCheckBy: 'auto' });
  });

  it("a later check of the app's own is its own again", () => {
    vi.useFakeTimers();
    useUpdateStore.getState().checkForUpdates();
    status({ status: 'not-available' });
    registerRunPhase(() => 'running');
    status({ status: 'checking' });
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState()).toMatchObject({ dialogOpen: false, lastCheckBy: 'auto' });
  });

  it("opens them during a session for a check the main process says the user asked for (the Help menu)", () => {
    registerRunPhase(() => 'running');
    status({ status: 'checking', by: 'user' });
    expect(useUpdateStore.getState().lastCheckBy).toBe('user');
    // The check announcing itself afterwards does not make it the app's own.
    status({ status: 'checking' });
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("an earlier check's timeout does not end a later check the user asked for", () => {
    vi.useFakeTimers();
    registerRunPhase(() => 'running');
    useUpdateStore.getState().checkForUpdates();
    status({ status: 'not-available' });
    vi.advanceTimersByTime(10_000);
    useUpdateStore.getState().checkForUpdates();
    // The first check's 15 s are up while the second is still unanswered.
    vi.advanceTimersByTime(5_000);
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', lastCheckBy: 'user' });
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("an earlier check's timeout does not end a later check asked for from the Help menu", () => {
    vi.useFakeTimers();
    registerRunPhase(() => 'running');
    useUpdateStore.getState().checkForUpdates();
    status({ status: 'not-available' });
    vi.advanceTimersByTime(10_000);
    status({ status: 'checking', by: 'user' });
    vi.advanceTimersByTime(5_000);
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', lastCheckBy: 'user' });
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it('does not open them again for an update already announced, once closed', () => {
    status({ status: 'available', version: '0.52.0' });
    useUpdateStore.getState().closeDialog();
    status({ status: 'available', version: '0.52.0' });
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
  });
});
