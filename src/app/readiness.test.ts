import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createVirtualClock } from '../lib/contract/clock';
import type { RunState } from '../lib/session/types';
import { fakeProvider } from '../providers/fake/provider';
import { useProviderStore } from '../stores/providerStore';
import { driveLocalReadiness, READINESS_DELAY_MS } from './readiness';

// `driveLocalReadiness` reads `useProviderStore` (a real store) and calls its
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

/** A `kind: 'local'` provider whose `check` and `watchReadiness` are spies. */
function makeProbe(id = 'probe', kind: 'local' | 'own-key' = 'local') {
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

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'] });
});

describe('driveLocalReadiness', () => {
  it('checks a loaded local provider whose readiness is unknown, once, READINESS_DELAY_MS after it starts', async () => {
    const { provider, check } = makeProbe();
    setupStore(provider);
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveLocalReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

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
    const detach = driveLocalReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

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

  it('leaves a networked provider alone: no check, no watch', async () => {
    const { provider, check, off } = makeProbe('probe', 'own-key');
    setupStore(provider);
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveLocalReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

    clock.advance(10_000);
    await flush();
    expect(check).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled(); // never watched, so never unwatched either

    detach();
  });

  it('waits for idle: a reset while starting is not checked until the runner is idle again', async () => {
    const { provider, check } = makeProbe();
    setupStore(provider);
    const runnerStore = createStore<RunState>(() => ({ phase: 'starting', step: 'checking' }));
    const runner = { state: runnerStore };
    const clock = createVirtualClock(0);
    const detach = driveLocalReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

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
    const detach = driveLocalReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

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
    const detach = driveLocalReadiness({ runner, providers: () => [provider], auth: () => auth, clock });

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
    const detach = driveLocalReadiness({ runner, providers: () => [probe1.provider, probe2.provider], auth: () => auth, clock });

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
