import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The status handler is Electron's: the listeners register only there.
vi.mock('../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/environment')>()),
  isElectron: () => true,
}));

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
