import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createVirtualClock } from '../lib/contract/clock';
import type { RunState } from '../lib/session/types';
import { fakeProvider } from '../providers/fake/provider';
import { useProviderStore } from '../stores/providerStore';
import { driveReadiness, NETWORK_READINESS_DELAY_MS, READINESS_DELAY_MS } from './readiness';

// `driveReadiness` reads `useProviderStore` (a real store) and calls its
// `refreshReadiness`, which never reaches `ServiceFactory` for these tests
// (no `load`/`updateSettings`/`setCredential`/`setPair` call happens here) —
// mocked anyway, as `appShape.test.ts` does, since importing the store module
// resolves `ServiceFactory` at the top.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

const auth = { signedIn: false, getToken: async () => null };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A provider (`kind: 'local'` by default) whose `check` and `watchReadiness` are spies. */
function makeProbe(id = 'probe', kind: 'local' | 'own-key' | 'managed' = 'local') {
  const check = vi.fn(async () => ({ ok: true as const }));
  const off = vi.fn();
  let changed: (() => void) | undefined;
  const provider = {
    ...fakeProvider,
    id,
    kind,
    credentials: { keys: [], fields: () => [], read: () => ({}) },
    check,
    watchReadiness: (fn: () => void) => { changed = fn; return off; },
  };
  return { provider, check, off, fire: () => changed?.() };
}

function setupStore(...providers: Array<{ id: string }>) {
  useProviderStore.setState({
    entries: Object.fromEntries(providers.map((p) => [p.id, { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } }])),
    readiness: {},
    selected: providers[0]?.id ?? null,
    legs: ['speaker'],
  });
}

function idleRunner(): { state: StoreApi<RunState> } {
  return { state: createStore<RunState>(() => ({ phase: 'idle' })) };
}

const realRefresh = useProviderStore.getState().refreshReadiness;

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'], refreshReadiness: realRefresh });
});

/**
 * The store's `refreshReadiness`, spied: a network provider's ready answer is
 * kept for the same inputs, so the probe's `check` alone would not show a
 * second request. `calls(id)` counts the requests for that provider.
 */
function spyRefresh() {
  const refresh = vi.fn(async (_p: { id: string }, _auth: unknown) => ({ state: 'ready' as const, models: [] }));
  useProviderStore.setState({ refreshReadiness: refresh });
  const calls = (id: string) => refresh.mock.calls.filter(([p]) => p.id === id).length;
  return { refresh, calls };
}

describe('driveReadiness', () => {
  it('checks a loaded local provider whose readiness is unknown, once, READINESS_DELAY_MS after it starts', async () => {
    const { provider, check } = makeProbe();
    setupStore(provider);
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(READINESS_DELAY_MS - 1);
    await flush();
    expect(check).not.toHaveBeenCalled();

    clock.advance(1);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
    expect(useProviderStore.getState().readiness.probe).toEqual({ state: 'ready', models: [] });

    detach();
  });

  it('is one check for a burst: three readiness resets within 100ms only push the delay out', async () => {
    const { provider, check } = makeProbe();
    setupStore(provider);
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } });
    clock.advance(30);
    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } });
    clock.advance(30);
    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } });
    clock.advance(40); // 100ms since the first reset in this burst; none of it reached the delay
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    clock.advance(READINESS_DELAY_MS - 40);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);

    detach();
  });

  it('checks an own-key provider at once when it is selected and loaded', async () => {
    const { provider } = makeProbe('probe', 'own-key');
    setupStore(provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('probe')).toBe(1);

    detach();
  });

  it('an edit waits for a pause: each reset pushes the check out', async () => {
    const { provider } = makeProbe('probe', 'own-key');
    setupStore(provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('probe')).toBe(1);

    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } });
    clock.advance(300);
    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } });
    clock.advance(300);
    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } });
    clock.advance(NETWORK_READINESS_DELAY_MS - 1);
    await flush();
    expect(calls('probe')).toBe(1);

    clock.advance(1);
    await flush();
    expect(calls('probe')).toBe(2);

    detach();
  });

  it('a store change before the immediate check does not delay it', async () => {
    const { provider } = makeProbe('probe', 'own-key');
    setupStore(provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    useProviderStore.setState({ legs: ['speaker'] }); // a notification that changes nothing
    clock.advance(0);
    await flush();
    expect(calls('probe')).toBe(1);

    detach();
  });

  it('switching to another loaded own-key provider checks it at once', async () => {
    const o1 = makeProbe('o1', 'own-key');
    const o2 = makeProbe('o2', 'own-key');
    setupStore(o1.provider, o2.provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [o1.provider, o2.provider], auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('o1')).toBe(1);

    useProviderStore.setState({ selected: 'o2' });
    clock.advance(0);
    await flush();
    expect(calls('o2')).toBe(1);

    detach();
  });

  it("a sign-in flip forgets every loaded managed provider's readiness, and checks the selected one at once", async () => {
    const m = makeProbe('m', 'managed');
    const m2 = makeProbe('m2', 'managed');
    const o = makeProbe('o', 'own-key');
    setupStore(m.provider, m2.provider, o.provider);
    const ready = { state: 'ready' as const, models: [] };
    useProviderStore.setState({ readiness: { m: ready, m2: ready, o: ready } });
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    let flipped: (() => void) | undefined;
    const watchSignIn = (fn: () => void) => { flipped = fn; return () => {}; };
    const detach = driveReadiness({ runner, providers: () => [m.provider, m2.provider, o.provider], auth: () => auth, clock, watchSignIn });

    flipped!();
    const { readiness } = useProviderStore.getState();
    expect(readiness.m).toEqual({ state: 'unknown' });
    expect(readiness.m2).toEqual({ state: 'unknown' });
    expect(readiness.o).toEqual(ready);

    clock.advance(0);
    await flush();
    expect(calls('m')).toBe(1);
    expect(calls('m2')).toBe(0);
    expect(calls('o')).toBe(0);

    detach();
  });

  it('stops watching the sign-in on detach', () => {
    const { provider } = makeProbe('probe', 'managed');
    setupStore(provider);
    spyRefresh();
    const off = vi.fn();
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [provider], auth: () => auth, clock: createVirtualClock(0), watchSignIn: () => off });

    expect(off).not.toHaveBeenCalled();
    detach();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('waits for idle: a reset while starting is not checked until the runner is idle again', async () => {
    const { provider, check } = makeProbe();
    setupStore(provider);
    const runnerStore = createStore<RunState>(() => ({ phase: 'starting', step: 'checking' }));
    const runner = { state: runnerStore };
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(1000);
    await flush();
    expect(check).not.toHaveBeenCalled();

    runnerStore.setState({ phase: 'idle' });
    clock.advance(READINESS_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    clock.advance(1);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    detach();
  });

  it("re-checks when the provider's own inputs change, even when ready", async () => {
    const { provider, check, fire } = makeProbe();
    setupStore(provider);
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    fire();
    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);

    detach();
  });

  it('holds an input change seen mid-run until the runner is idle again, then checks once', async () => {
    const { provider, check, fire } = makeProbe();
    setupStore(provider);
    const runnerStore = createStore<RunState>(() => ({ phase: 'idle' }));
    const runner = { state: runnerStore };
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    runnerStore.setState({ phase: 'starting', step: 'checking' });
    fire();
    clock.advance(1000);
    await flush();
    expect(check).toHaveBeenCalledTimes(1); // still just once: seen mid-run, held

    runnerStore.setState({ phase: 'idle' });
    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);

    detach();
  });

  it('follows the selection and stops on detach', async () => {
    const probe1 = makeProbe('probe1');
    const probe2 = makeProbe('probe2');
    setupStore(probe1.provider, probe2.provider);
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [probe1.provider, probe2.provider], auth: () => auth, clock });

    expect(probe1.off).not.toHaveBeenCalled();

    useProviderStore.setState({ selected: 'probe2' });
    expect(probe1.off).toHaveBeenCalledTimes(1);
    expect(probe2.off).not.toHaveBeenCalled();

    detach();
    expect(probe2.off).toHaveBeenCalledTimes(1);

    useProviderStore.setState({ readiness: { probe2: { state: 'unknown' } } });
    clock.advance(10_000);
    await flush();
    expect(probe2.check).not.toHaveBeenCalled();
  });
});
