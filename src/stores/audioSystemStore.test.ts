import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/environment')>();
  return {
    ...actual,
    isElectron: () => true,
  };
});

// Import after mocking, following settingsStore.subtitle.test.ts's convention.
const { default: useAudioSystemStore } = await import('./audioSystemStore');
const { default: useAudioStore } = await import('./audioStore');

function mockElectron(overrides: Partial<Record<string, any>> = {}) {
  const receivedHandlers: Record<string, (...args: any[]) => void> = {};
  (window as any).electron = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'get-audio-status') return null;
      return { success: true };
    }),
    receive: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      receivedHandlers[channel] = handler;
    }),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    send: vi.fn(),
    ...overrides,
  };
  return { receivedHandlers, electron: (window as any).electron };
}

describe('audioSystemStore', () => {
  beforeEach(() => {
    useAudioSystemStore.setState({
      status: 'unknown',
      platform: null,
      reason: null,
      message: null,
      dismissed: false,
      retrying: false,
      repairing: false,
      repairFailed: false,
    });
    useAudioSystemStore.getState().cleanupListeners();
  });

  it('initListeners registers a push listener and pulls the current status once', () => {
    const { electron } = mockElectron();
    useAudioSystemStore.getState().initListeners();
    expect(electron.receive).toHaveBeenCalledWith('audio-status', expect.any(Function));
    expect(electron.invoke).toHaveBeenCalledWith('get-audio-status');
  });

  it('hydration pull (get-audio-status) applies status without un-dismissing an already-dismissed banner', async () => {
    mockElectron({
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'get-audio-status') {
          return { ok: false, platform: 'linux', reason: 'pactl-missing', message: 'pactl not found' };
        }
        return { success: true };
      }),
    });
    useAudioSystemStore.setState({ dismissed: true });

    useAudioSystemStore.getState().initListeners();
    // Let the pending invoke('get-audio-status') promise resolve.
    await Promise.resolve();
    await Promise.resolve();

    const s = useAudioSystemStore.getState();
    expect(s.status).toBe('unavailable');
    expect(s.reason).toBe('pactl-missing');
    // Regression: hydrating the same still-unresolved failure must not
    // silently re-open a banner the user already closed.
    expect(s.dismissed).toBe(true);
  });

  it('a live audio-status push re-surfaces the banner even if previously dismissed', () => {
    const { receivedHandlers } = mockElectron();
    useAudioSystemStore.setState({ dismissed: true });

    useAudioSystemStore.getState().initListeners();
    receivedHandlers['audio-status']({ ok: false, platform: 'linux', reason: 'pactl-missing', message: 'pactl not found' });

    const s = useAudioSystemStore.getState();
    expect(s.status).toBe('unavailable');
    expect(s.dismissed).toBe(false);
  });

  it('a live audio-status push reporting ok leaves dismissed untouched', () => {
    const { receivedHandlers } = mockElectron();
    useAudioSystemStore.setState({ dismissed: true });

    useAudioSystemStore.getState().initListeners();
    receivedHandlers['audio-status']({ ok: true, platform: 'linux' });

    const s = useAudioSystemStore.getState();
    expect(s.status).toBe('ok');
    expect(s.dismissed).toBe(true);
  });

  // The device list is read at startup, while the virtual device was missing.
  // When a repair or a retry brings it back, nothing else reads the list
  // again, so the translation reached the repaired device only after a restart.
  it('re-reads the device list when the virtual device comes back', () => {
    const syncDevices = vi.fn(async () => {});
    useAudioStore.setState({ syncDevices });
    const { receivedHandlers } = mockElectron();
    useAudioSystemStore.setState({ status: 'unavailable', reason: 'mac-driver-not-loaded' });

    useAudioSystemStore.getState().initListeners();
    receivedHandlers['audio-status']({ ok: true, platform: 'darwin' });

    expect(syncDevices).toHaveBeenCalledTimes(1);
    // The audio system came back: devices marked unusable while it was down are tried again.
    expect(syncDevices).toHaveBeenCalledWith({ retryUnusable: true });
  });

  it('leaves the device list alone when the status is first learned or did not change', () => {
    const syncDevices = vi.fn(async () => {});
    useAudioStore.setState({ syncDevices });
    const { receivedHandlers } = mockElectron();

    useAudioSystemStore.getState().initListeners();
    receivedHandlers['audio-status']({ ok: true, platform: 'darwin' });
    receivedHandlers['audio-status']({ ok: true, platform: 'darwin' });
    receivedHandlers['audio-status']({ ok: false, platform: 'darwin', reason: 'mac-driver-not-loaded' });

    expect(syncDevices).not.toHaveBeenCalled();
  });

  it('dismiss() sets dismissed to true', () => {
    mockElectron();
    useAudioSystemStore.getState().dismiss();
    expect(useAudioSystemStore.getState().dismissed).toBe(true);
  });

  it('retry() swallows a rejected create-virtual-speaker invoke instead of throwing', async () => {
    mockElectron({
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'create-virtual-speaker') throw new Error('IPC failed');
        return null;
      }),
    });

    await expect(useAudioSystemStore.getState().retry()).resolves.toBeUndefined();
    expect(useAudioSystemStore.getState().retrying).toBe(false);
  });

  it('retry() is a no-op while already retrying', async () => {
    const { electron } = mockElectron();
    useAudioSystemStore.setState({ retrying: true });
    await useAudioSystemStore.getState().retry();
    expect(electron.invoke).not.toHaveBeenCalledWith('create-virtual-speaker');
  });

  // macOS: the driver is installed but was never loaded; the main process
  // re-signs it behind an administrator prompt. Success arrives as a live
  // audio-status push, like retry's.
  it('repair() asks the main process to repair the driver, with the dialog prompt', async () => {
    const { electron } = mockElectron({ invoke: vi.fn(async () => ({ ok: true })) });
    await useAudioSystemStore.getState().repair('Allow Sokuji to repair');
    expect(electron.invoke).toHaveBeenCalledWith('repair-virtual-audio', { prompt: 'Allow Sokuji to repair' });
    expect(useAudioSystemStore.getState().repairing).toBe(false);
    expect(useAudioSystemStore.getState().repairFailed).toBe(false);
  });

  it('repair() cancelled at the password dialog is not a failure', async () => {
    mockElectron({ invoke: vi.fn(async () => ({ ok: false, cancelled: true })) });
    await useAudioSystemStore.getState().repair('p');
    expect(useAudioSystemStore.getState().repairFailed).toBe(false);
  });

  it('repair() that did not bring the device back is marked failed', async () => {
    mockElectron({ invoke: vi.fn(async () => ({ ok: false, cancelled: false, error: 'not registered' })) });
    await useAudioSystemStore.getState().repair('p');
    expect(useAudioSystemStore.getState().repairFailed).toBe(true);
    expect(useAudioSystemStore.getState().repairing).toBe(false);
  });

  it('repair() swallows a rejected invoke and marks it failed', async () => {
    mockElectron({ invoke: vi.fn(async () => { throw new Error('IPC broke'); }) });
    await expect(useAudioSystemStore.getState().repair('p')).resolves.toBeUndefined();
    expect(useAudioSystemStore.getState().repairFailed).toBe(true);
  });

  it('repair() is a no-op while already repairing', async () => {
    const { electron } = mockElectron();
    useAudioSystemStore.setState({ repairing: true });
    await useAudioSystemStore.getState().repair('p');
    expect(electron.invoke).not.toHaveBeenCalledWith('repair-virtual-audio', expect.anything());
  });
});
