// src/stores/vbCableStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stored = vi.hoisted(() => new Map<string, unknown>());
const getSetting = vi.hoisted(() => vi.fn(async (key: string, fallback: unknown) => (stored.has(key) ? stored.get(key) : fallback)));
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting,
      setSetting: async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; },
    }),
  },
}));
const report = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock('../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/diagnostics/report')>()),
  reportError: report.error,
  reportWarning: report.warning,
}));

type Invoke = (channel: string, data?: unknown) => Promise<unknown>;
const invoke = vi.fn<Invoke>();

/** A fresh module per test: `load()` remembers its first run. */
async function fresh() {
  vi.resetModules();
  const store = await import('./vbCableStore');
  const audio = (await import('./audioStore')).default;
  const syncDevices = vi.fn(async () => {});
  audio.setState({ syncDevices } as never);
  return { ...store, syncDevices };
}

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  report.error.mockClear();
  report.warning.mockClear();
  invoke.mockReset();
  invoke.mockImplementation(async (channel) => (channel === 'get-distribution-channel' ? 'website' : { ok: true }));
  (window as unknown as { electron: { invoke: Invoke } }).electron = { invoke };
});

describe('vbCableStore.load', () => {
  it('reads the channel and the seen flag once, however often it is asked', async () => {
    const { useVbCableStore } = await fresh();
    await Promise.all([useVbCableStore.getState().load(), useVbCableStore.getState().load()]);
    expect(useVbCableStore.getState()).toMatchObject({ channel: 'website', introSeen: false });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('assumes the Store build when the channel cannot be read, so no install is offered', async () => {
    invoke.mockRejectedValue(new Error('IPC down'));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    expect(useVbCableStore.getState().channel).toBe('store');
    expect(report.warning).toHaveBeenCalledTimes(1);
  });

  it('assumes seen when the flag cannot be read', async () => {
    getSetting.mockRejectedValueOnce(new Error('storage'));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    expect(useVbCableStore.getState().introSeen).toBe(true);
  });

  it('remembers a seen introduction', async () => {
    stored.set('audio.vbCableIntroSeen', true);
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    expect(useVbCableStore.getState().introSeen).toBe(true);
  });
});

describe('vbCableStore.install', () => {
  it('runs while the IPC is out, succeeds on ok, and re-reads the devices', async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementation((channel) => (channel === 'install-vbcable' ? new Promise((r) => { finish = r; }) : Promise.resolve('website')));
    const { useVbCableStore, syncDevices } = await fresh();
    await useVbCableStore.getState().load();
    const done = useVbCableStore.getState().install();
    expect(useVbCableStore.getState().attempt).toBe('running');
    finish({ ok: true });
    await done;
    expect(useVbCableStore.getState().attempt).toBe('succeeded');
    expect(syncDevices).toHaveBeenCalledTimes(1);
  });

  it('starts one install however often it is clicked', async () => {
    invoke.mockImplementation((channel) => (channel === 'install-vbcable' ? new Promise(() => {}) : Promise.resolve('website')));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    void useVbCableStore.getState().install();
    void useVbCableStore.getState().install();
    expect(invoke.mock.calls.filter(([c]) => c === 'install-vbcable')).toHaveLength(1);
  });

  it('records a failure, but not a declined administrator prompt', async () => {
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    invoke.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
    await useVbCableStore.getState().install();
    expect(useVbCableStore.getState().attempt).toBe('failed');
    expect(report.error).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ ok: false, reason: 'not-detected' });
    await useVbCableStore.getState().install();
    expect(report.error).toHaveBeenCalledTimes(1);
  });

  it('never installs in the Store build', async () => {
    invoke.mockImplementation(async (channel) => (channel === 'get-distribution-channel' ? 'store' : { ok: true }));
    const { useVbCableStore } = await fresh();
    await useVbCableStore.getState().load();
    await useVbCableStore.getState().install();
    expect(invoke.mock.calls.filter(([c]) => c === 'install-vbcable')).toHaveLength(0);
    expect(useVbCableStore.getState().attempt).toBe('none');
  });
});

describe('vbCableStore flags', () => {
  it('persists the introduction as seen, and dismisses the ready notice for this session only', async () => {
    const { useVbCableStore } = await fresh();
    useVbCableStore.getState().markIntroSeen();
    useVbCableStore.getState().dismissReady();
    expect(useVbCableStore.getState()).toMatchObject({ introSeen: true, readyDismissed: true });
    await vi.waitFor(() => expect(stored.get('audio.vbCableIntroSeen')).toBe(true));
    expect(stored.has('audio.vbCableReadyDismissed')).toBe(false);
  });
});
