import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { driveReadiness, READINESS_DELAY_MS } from '../../app/readiness';
import { createVirtualClock } from '../../lib/contract/clock';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import type { RunState } from '../../lib/session/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { useProviderStore } from '../../stores/providerStore';
import { localNativeProvider } from './provider';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

// The provider store resolves ServiceFactory at import; nothing here persists.
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// The native model store's bundle IPC and the sidecar's start gate on isElectron().
vi.mock('../../utils/environment', async () => {
  const actual = await vi.importActual<typeof import('../../utils/environment')>('../../utils/environment');
  return { ...actual, isElectron: () => true };
});

const auth = { signedIn: false, getToken: async () => null };
const flush = () => new Promise((r) => setTimeout(r, 0));
const realRefresh = useProviderStore.getState().refreshReadiness;

function idleRunner(): { state: StoreApi<RunState> } {
  return { state: createStore<RunState>(() => ({ phase: 'idle' })) };
}

/** The main process: the engine bundle in `state`, and a `native-host:start` that fails unless it is ready, as it does with no engine. */
function mainProcess(state: 'mismatch' | 'absent' | 'ready') {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'sidecar-bundle:status') {
      return { ok: true, sku: 'linux-x64', state, installedVersion: null, requiredVersion: '0.4.0', stagedBytes: 0, devVenvPresent: false };
    }
    if (channel === 'native-host:start') return state === 'ready' ? { ok: true, port: 9 } : { ok: false, error: 'the inference engine is not installed' };
    return { ok: false };
  });
  (window as unknown as { electron?: unknown }).electron = { invoke };
  return (channel: string) => invoke.mock.calls.filter(([c]) => c === channel).length;
}

/** The sidecar's socket: every model it is asked about is absent, and a download never finishes. */
class FakeSidecarSocket {
  static OPEN = 1;
  static last: FakeSidecarSocket | null = null;
  readyState = 1;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSidecarSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    const msg = JSON.parse(data) as { type: string; id: number; models?: string[] };
    if (msg.type !== 'model_status') return;
    const statuses = Object.fromEntries((msg.models ?? []).map((m) => [m, 'absent']));
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'model_status_result', id: msg.id, statuses }) }));
  }
  close() {}
}

const ASR_A: NativeModelInfo = {
  id: 'asr-a', name: 'ASR A', kind: 'asr', languages: ['ja'], recommended: true, order: 0, repo: 'org/asr-a',
  tiers: [{ tier: 'cpu', backend: 'native_asr', available: true }],
};

beforeEach(() => {
  useNativeModelStore.setState({ sidecarStatus: 'idle', bundleStatus: 'unknown', catalog: {}, statuses: {} });
  useProviderStore.setState({
    entries: { local_native: { settings: LOCAL_NATIVE_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    readiness: {},
    selected: 'local_native',
    legs: ['speaker'],
    refreshReadiness: realRefresh,
  });
});

afterEach(() => {
  // The store's sidecar connection outlives a test: drop it, so the next one connects again.
  FakeSidecarSocket.last?.onclose?.();
  FakeSidecarSocket.last = null;
  vi.unstubAllGlobals();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('Local Native under the readiness driver', () => {
  it.each([
    ['mismatch', 'native_engine_update_required'],
    ['absent', 'native_engine_required'],
  ] as const)('an engine that cannot start (%s) is checked once more, not on every window (#578)', async (state, code) => {
    const calls = mainProcess(state);
    const refresh = vi.fn(realRefresh);
    useProviderStore.setState({ refreshReadiness: refresh });
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [localNativeProvider], auth: () => auth, clock });

    for (let i = 0; i < 12; i++) {
      clock.advance(READINESS_DELAY_MS);
      await flush();
    }

    expect(useProviderStore.getState().readiness.local_native).toMatchObject({ state: 'not-ready', code });
    // The first check, and the one its settled change (idle → unavailable) asks for.
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(2);
    expect(calls('sidecar-bundle:status')).toBeLessThanOrEqual(2);
    expect(calls('native-host:start')).toBeLessThanOrEqual(2);

    detach();
  });

  it('a download started schedules no check, and keeps its status through the next window (#578)', async () => {
    mainProcess('ready');
    vi.stubGlobal('WebSocket', FakeSidecarSocket);
    useNativeModelStore.setState({ sidecarStatus: 'ready', bundleStatus: 'ready', catalog: { 'asr-a': ASR_A } });
    const refresh = vi.fn(realRefresh);
    useProviderStore.setState({ refreshReadiness: refresh });
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [localNativeProvider], auth: () => auth, clock });

    // The first check, and the one asr-a's status landing asks for.
    for (let i = 0; i < 4; i++) {
      clock.advance(READINESS_DELAY_MS);
      await flush();
    }
    expect(useNativeModelStore.getState().statuses['asr-a']).toBe('absent');
    const checks = refresh.mock.calls.length;

    void useNativeModelStore.getState().download('asr-a');
    clock.advance(READINESS_DELAY_MS);
    await flush();

    expect(useNativeModelStore.getState().statuses['asr-a']).toBe('downloading');
    expect(refresh.mock.calls.length).toBe(checks);

    detach();
  });
});
