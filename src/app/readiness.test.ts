import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createVirtualClock } from '../lib/contract/clock';
import type { PlannedUnit, RunPlan } from '../lib/plan/types';
import { unitsOf } from '../lib/plan/wholeUnit';
import type { AnyProvider } from '../lib/provider/types';
import type { RunState } from '../lib/session/types';
import { fakeProvider } from '../providers/fake/provider';
import { FAKE_DEFAULTS } from '../providers/fake/settings';
import { useProviderStore } from '../stores/providerStore';
import { useLineUpStore } from '../stores/lineUpStore';
import { runsOn } from '../stores/lineUpStore.testing';
import { driveReadiness, NETWORK_READINESS_DELAY_MS, READINESS_DELAY_MS } from './readiness';
import { readinessPlan } from './session';

// The providers offered here, as the app's plan reads them (`readinessPlan`): those `setupStore` loads, unless a case
// offers others.
const offered = vi.hoisted(() => ({ list: [] as Array<{ id: string }> }));
vi.mock('../providers/registry', () => ({ presentProviders: () => offered.list }));

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
  offered.list = providers;
  runsOn(providers[0]?.id ?? null);
  useProviderStore.setState({
    entries: Object.fromEntries(providers.map((p) => [p.id, { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } }])),
    readiness: {},
    legs: ['speaker'],
  });
}

/** A plan of two providers, built by hand: `a` transcribes and translates, `b` speaks. */
function planOfTwo(a: AnyProvider, b: AnyProvider): RunPlan {
  const ua: PlannedUnit = { provider: a, unit: unitsOf(a)[0], stages: ['transcription', 'translation'] };
  const ub: PlannedUnit = { provider: b, unit: unitsOf(b)[0], stages: ['speech'] };
  return { units: [ua, ub], byStage: { transcription: ua, translation: ua, speech: ub } };
}

function idleRunner(): { state: StoreApi<RunState> } {
  return { state: createStore<RunState>(() => ({ phase: 'idle' })) };
}

const realRefresh = useProviderStore.getState().refreshReadiness;

beforeEach(() => {
  offered.list = [];
  runsOn(null);
  useLineUpStore.setState({ lineUp: null, stored: false });
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, stages: {}, stageIds: {}, legs: ['speaker'], refreshReadiness: realRefresh });
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
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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

  it('an edit\'s check is skipped when a check was asked for meanwhile: a Validate already moved the readiness', async () => {
    const { provider } = makeProbe('probe', 'own-key');
    setupStore(provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('probe')).toBe(1);

    useProviderStore.setState({ readiness: { probe: { state: 'unknown' } } }); // an edit: 800 ms armed
    clock.advance(300);
    useProviderStore.setState({ readiness: { probe: { state: 'checking' } } }); // a Validate press
    clock.advance(NETWORK_READINESS_DELAY_MS);
    await flush();
    expect(calls('probe')).toBe(1);

    detach();
  });

  it('a store change before the immediate check does not delay it', async () => {
    const { provider } = makeProbe('probe', 'own-key');
    setupStore(provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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
    const detach = driveReadiness({ runner, providers: () => [o1.provider, o2.provider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('o1')).toBe(1);

    runsOn('o2');
    clock.advance(0);
    await flush();
    expect(calls('o2')).toBe(1);

    detach();
  });

  it("a pending edit's check does not fire for the provider selected next", async () => {
    const o1 = makeProbe('o1', 'own-key');
    const o2 = makeProbe('o2', 'own-key');
    setupStore(o1.provider, o2.provider);
    const ready = { state: 'ready' as const, models: [] };
    useProviderStore.setState({ readiness: { o2: ready } });
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [o1.provider, o2.provider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('o1')).toBe(1);

    useProviderStore.setState({ readiness: { o1: { state: 'unknown' }, o2: ready } }); // an edit to o1: 800 ms armed
    clock.advance(300);
    runsOn('o2');
    clock.advance(NETWORK_READINESS_DELAY_MS);
    await flush();
    expect(calls('o2')).toBe(0);
    expect(calls('o1')).toBe(1);

    detach();
  });

  it('a pending at-once check does not check a local provider early', async () => {
    const n = makeProbe('n', 'own-key');
    const l = makeProbe('l', 'local');
    setupStore(n.provider, l.provider);
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [n.provider, l.provider], plan: readinessPlan, auth: () => auth, clock });

    runsOn('l'); // the same turn: n's at-once check is still pending
    clock.advance(0);
    await flush();
    expect(calls('l')).toBe(0);

    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(calls('l')).toBe(1);
    expect(calls('n')).toBe(0);

    detach();
  });

  it('an answer found without a check is not asked for again', async () => {
    // The real refreshReadiness, counted: a missing key answers synchronously, with no check.
    const refresh = vi.fn(realRefresh);
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: { ...FAKE_DEFAULTS, requireKey: true }, credentials: { apiKey: '' }, pair: { source: 'en', target: 'ja' } } },
      readiness: {},
      refreshReadiness: refresh,
    });
    offered.list = [fakeProvider];
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [fakeProvider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useProviderStore.getState().readiness.fake).toMatchObject({ state: 'not-ready', code: 'credentials_missing' });

    clock.advance(NETWORK_READINESS_DELAY_MS * 3);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);

    detach();
  });

  it('coming back through a provider not yet loaded checks the first one at once again', async () => {
    const y = makeProbe('y', 'own-key');
    const x = makeProbe('x', 'own-key');
    setupStore(y.provider); // x is never loaded
    offered.list = [y.provider, x.provider];
    const { calls } = spyRefresh();
    const runner = idleRunner();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [y.provider, x.provider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('y')).toBe(1);

    runsOn('x');
    useProviderStore.setState({ readiness: { y: { state: 'unknown' } } });
    runsOn('y');
    clock.advance(0);
    await flush();
    expect(calls('y')).toBe(2);

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
    const detach = driveReadiness({ runner, providers: () => [m.provider, m2.provider, o.provider], plan: readinessPlan, auth: () => auth, clock, watchSignIn });

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
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [provider], plan: readinessPlan, auth: () => auth, clock: createVirtualClock(0), watchSignIn: () => off });

    expect(off).not.toHaveBeenCalled();
    detach();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('waits for idle: a reset while starting is not checked until the runner is idle again', async () => {
    const { provider, check } = makeProbe();
    setupStore(provider);
    const runnerStore = createStore<RunState>(() => ({ phase: 'starting', participantSpeech: false, step: 'checking' }));
    const runner = { state: runnerStore };
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

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
    const detach = driveReadiness({ runner, providers: () => [provider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    runnerStore.setState({ phase: 'starting', participantSpeech: false, step: 'checking' });
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
    const detach = driveReadiness({ runner, providers: () => [probe1.provider, probe2.provider], plan: readinessPlan, auth: () => auth, clock });

    expect(probe1.off).not.toHaveBeenCalled();

    runsOn('probe2');
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

describe('driveReadiness over a plan of two providers', () => {
  const ready = { state: 'ready' as const, models: [] };

  it('checks both, each under its own timing', async () => {
    const a = makeProbe('a', 'own-key');
    const b = makeProbe('b', 'local');
    setupStore(a.provider, b.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [a.provider, b.provider], plan: () => two, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('a')).toBe(1);
    expect(calls('b')).toBe(0);

    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(calls('a')).toBe(1);
    expect(calls('b')).toBe(1);

    detach();
  });

  it('a key edit on one re-checks only that one, after NETWORK_READINESS_DELAY_MS', async () => {
    const a = makeProbe('a', 'own-key');
    const b = makeProbe('b', 'own-key');
    setupStore(a.provider, b.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [a.provider, b.provider], plan: () => two, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    useProviderStore.setState({ readiness: { a: ready, b: ready } });
    expect(calls('a')).toBe(1);
    expect(calls('b')).toBe(1);

    useProviderStore.setState({ readiness: { a: ready, b: { state: 'unknown' } } }); // an edit to b's key
    clock.advance(NETWORK_READINESS_DELAY_MS - 1);
    await flush();
    expect(calls('b')).toBe(1);

    clock.advance(1);
    await flush();
    expect(calls('b')).toBe(2);
    expect(calls('a')).toBe(1);

    detach();
  });

  it("one provider's answer arriving does not push out the other's pending check", async () => {
    const a = makeProbe('a', 'own-key');
    const b = makeProbe('b', 'local');
    setupStore(a.provider, b.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [a.provider, b.provider], plan: () => two, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('a')).toBe(1);

    // a's answer lands halfway through b's delay: a store update that is none of b's.
    clock.advance(READINESS_DELAY_MS / 2);
    useProviderStore.setState((st) => ({ readiness: { ...st.readiness, a: ready } }));

    clock.advance(READINESS_DELAY_MS / 2);
    await flush();
    expect(calls('b')).toBe(1);

    detach();
  });

  it("an edit to one provider still pushes its own pending check out, and not the other's", async () => {
    const a = makeProbe('a', 'own-key');
    const b = makeProbe('b', 'own-key');
    setupStore(a.provider, b.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [a.provider, b.provider], plan: () => two, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    useProviderStore.setState({ readiness: { a: ready, b: ready } });

    // Both are edited; then a is edited again, 300ms later.
    useProviderStore.setState({ readiness: { a: { state: 'unknown' }, b: { state: 'unknown' } } });
    clock.advance(300);
    useProviderStore.setState((st) => ({ readiness: { ...st.readiness, a: { state: 'unknown' } } }));

    clock.advance(NETWORK_READINESS_DELAY_MS - 300);
    await flush();
    expect(calls('b')).toBe(2); // b's own delay, from its own edit
    expect(calls('a')).toBe(1); // a's was pushed out by its second edit

    clock.advance(300);
    await flush();
    expect(calls('a')).toBe(2);

    detach();
  });

  it("a sign-in flip forgets every loaded managed provider's readiness, and checks each managed one of the plan at once", async () => {
    const m1 = makeProbe('m1', 'managed');
    const m2 = makeProbe('m2', 'managed');
    const m3 = makeProbe('m3', 'managed');
    setupStore(m1.provider, m2.provider, m3.provider);
    useProviderStore.setState({ readiness: { m1: ready, m2: ready, m3: ready } });
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    let flipped: (() => void) | undefined;
    const watchSignIn = (fn: () => void) => { flipped = fn; return () => {}; };
    const two = planOfTwo(m1.provider, m2.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [m1.provider, m2.provider, m3.provider], plan: () => two, auth: () => auth, clock, watchSignIn });

    flipped!();
    const { readiness } = useProviderStore.getState();
    expect(readiness.m1).toEqual({ state: 'unknown' });
    expect(readiness.m2).toEqual({ state: 'unknown' });
    expect(readiness.m3).toEqual({ state: 'unknown' });

    clock.advance(0);
    await flush();
    expect(calls('m1')).toBe(1);
    expect(calls('m2')).toBe(1);
    expect(calls('m3')).toBe(0); // not in the plan

    detach();
  });

  it('a sign-out during a run checks nothing until the run is over, then re-checks every managed one of the plan (Review Focus 5)', async () => {
    const m1 = makeProbe('m1', 'managed');
    const m2 = makeProbe('m2', 'managed');
    setupStore(m1.provider, m2.provider);
    useProviderStore.setState({ readiness: { m1: ready, m2: ready } });
    const { calls } = spyRefresh();
    const runnerStore = createStore<RunState>(() => ({ phase: 'idle' }));
    const clock = createVirtualClock(0);
    let flipped: (() => void) | undefined;
    const watchSignIn = (fn: () => void) => { flipped = fn; return () => {}; };
    const two = planOfTwo(m1.provider, m2.provider);
    const detach = driveReadiness({ runner: { state: runnerStore }, providers: () => [m1.provider, m2.provider], plan: () => two, auth: () => auth, clock, watchSignIn });

    runnerStore.setState({ phase: 'running', participantSpeech: false, since: 0, legs: {} });
    flipped!();
    expect(useProviderStore.getState().readiness.m1).toEqual({ state: 'unknown' });
    expect(useProviderStore.getState().readiness.m2).toEqual({ state: 'unknown' });
    clock.advance(10_000);
    await flush();
    expect(calls('m1')).toBe(0);
    expect(calls('m2')).toBe(0);

    runnerStore.setState({ phase: 'stopping', participantSpeech: false });
    clock.advance(10_000);
    await flush();
    expect(calls('m1')).toBe(0);

    runnerStore.setState({ phase: 'idle' });
    clock.advance(NETWORK_READINESS_DELAY_MS - 1);
    await flush();
    expect(calls('m1')).toBe(0);
    expect(calls('m2')).toBe(0);

    clock.advance(1);
    await flush();
    expect(calls('m1')).toBe(1);
    expect(calls('m2')).toBe(1);

    detach();
  });

  it('holds an input change seen mid-run, and checks only the stale one once idle', async () => {
    const a = makeProbe('a', 'local');
    const b = makeProbe('b', 'local');
    setupStore(a.provider, b.provider);
    const { calls } = spyRefresh();
    const runnerStore = createStore<RunState>(() => ({ phase: 'idle' }));
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: { state: runnerStore }, providers: () => [a.provider, b.provider], plan: () => two, auth: () => auth, clock });

    clock.advance(READINESS_DELAY_MS);
    await flush();
    useProviderStore.setState({ readiness: { a: ready, b: ready } });
    expect(calls('a')).toBe(1);
    expect(calls('b')).toBe(1);

    runnerStore.setState({ phase: 'starting', participantSpeech: false, step: 'checking' });
    b.fire();
    clock.advance(1000);
    await flush();
    expect(calls('b')).toBe(1); // seen mid-run, held

    runnerStore.setState({ phase: 'idle' });
    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(calls('b')).toBe(2);
    expect(calls('a')).toBe(1);

    detach();
  });

  it('stops watching a provider that leaves the plan, and every one on detach', async () => {
    const a = makeProbe('a', 'local');
    const b = makeProbe('b', 'local');
    const c = makeProbe('c', 'local');
    setupStore(a.provider, b.provider, c.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    let current = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [a.provider, b.provider, c.provider], plan: () => current, auth: () => auth, clock });

    current = planOfTwo(a.provider, c.provider);
    useProviderStore.setState({ legs: ['speaker'] }); // a notification: the driver reads the plan again
    expect(a.off).not.toHaveBeenCalled();
    expect(b.off).toHaveBeenCalledTimes(1);
    expect(c.off).not.toHaveBeenCalled();

    // The timer armed for b when it joined went with it: past both delays, a and c were checked and b never was.
    clock.advance(Math.max(READINESS_DELAY_MS, NETWORK_READINESS_DELAY_MS));
    await flush();
    expect(calls('b')).toBe(0);
    expect(calls('a')).toBe(1);
    expect(calls('c')).toBe(1);

    detach();
    expect(a.off).toHaveBeenCalledTimes(1);
    expect(b.off).toHaveBeenCalledTimes(1);
    expect(c.off).toHaveBeenCalledTimes(1);
  });

  // A local provider's check runs whatever it knows, so a dropped timer that still fired would check it once it is back.
  it('a local provider leaves the plan with a timer armed, then rejoins while ready: it is checked once, by the new timer only', async () => {
    const a = makeProbe('a', 'local');
    const b = makeProbe('b', 'local');
    const c = makeProbe('c', 'local');
    setupStore(a.provider, b.provider, c.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    let current = planOfTwo(a.provider, b.provider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [a.provider, b.provider, c.provider], plan: () => current, auth: () => auth, clock });
    // Ready once the driver has read the plan: learning which stages each serves forgot what was known before.
    useProviderStore.setState({ readiness: { a: ready, b: ready, c: ready } });

    b.fire(); // its own inputs changed: a check armed for READINESS_DELAY_MS from now
    clock.advance(50);
    current = planOfTwo(a.provider, c.provider);
    useProviderStore.setState({ legs: ['speaker'] }); // b leaves the plan with its timer armed
    clock.advance(50);
    current = planOfTwo(a.provider, b.provider);
    useProviderStore.setState({ legs: ['speaker'] }); // b rejoins, still ready: rejoining arms nothing by itself

    clock.advance(READINESS_DELAY_MS); // past the time the dropped timer was armed for
    await flush();
    expect(calls('b')).toBe(0);

    b.fire(); // the new timer, through the watch b got back when it rejoined
    clock.advance(READINESS_DELAY_MS - 1);
    await flush();
    expect(calls('b')).toBe(0);

    clock.advance(1);
    await flush();
    expect(calls('b')).toBe(1);

    clock.advance(10_000);
    await flush();
    expect(calls('b')).toBe(1);

    detach();
  });
});

describe("readinessPlan: the plan the app's driver checks", () => {
  it('checks the first provider offered when the selection is not offered here: the fallback the plan uses (ruling 22)', async () => {
    const first = makeProbe('first', 'own-key');
    const second = makeProbe('second', 'own-key');
    setupStore(first.provider);
    offered.list = [first.provider, second.provider];
    runsOn('not_offered_here');
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [first.provider, second.provider], plan: readinessPlan, auth: () => auth, clock });

    clock.advance(0);
    await flush();
    expect(calls('first')).toBe(1);
    expect(calls('second')).toBe(0);

    detach();
  });

  it('is none while nothing is selected, even with the first offered provider loaded', () => {
    const first = makeProbe('first', 'own-key');
    setupStore(first.provider);
    offered.list = [first.provider];
    runsOn(null);
    expect(readinessPlan()).toBeNull();
  });
});

describe('the stages each provider serves', () => {
  const stagesAsked = (check: { mock: { calls: unknown[][] } }) => check.mock.calls.map((call) => (call[2] as { stages?: readonly string[] }).stages);
  const ready = { state: 'ready' as const, models: [] };

  it("are kept in the store from the plan, and reach each provider's check", async () => {
    const a = makeProbe('a');
    const b = makeProbe('b');
    setupStore(a.provider, b.provider);
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider as unknown as AnyProvider, b.provider as unknown as AnyProvider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [], plan: () => two, auth: () => auth, clock });
    expect(useProviderStore.getState().stages).toEqual({ a: ['transcription', 'translation'], b: ['speech'] });
    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(stagesAsked(a.check)).toEqual([['transcription', 'translation']]);
    expect(stagesAsked(b.check)).toEqual([['speech']]);
    detach();
  });

  // A provider that runs a stage in more than one way (the local one: Bing or a model) reads which from the ids.
  it("the stored line-up's ids of those stages are kept beside them, reach the check, and a change of one checks its provider again", async () => {
    const a = makeProbe('a');
    const b = makeProbe('b');
    setupStore(a.provider, b.provider);
    useLineUpStore.setState({ lineUp: { transcription: 'a', translation: 'bing', speech: 'b', summarisation: null }, stored: true, unstoredProvider: null });
    const clock = createVirtualClock(0);
    const two = planOfTwo(a.provider as unknown as AnyProvider, b.provider as unknown as AnyProvider);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [], plan: () => two, auth: () => auth, clock });
    expect(useProviderStore.getState().stageIds).toEqual({ a: { transcription: 'a', translation: 'bing' }, b: { speech: 'b' } });
    clock.advance(READINESS_DELAY_MS);
    await flush();
    const idsAsked = (check: { mock: { calls: unknown[][] } }) => check.mock.calls.map((call) => (call[2] as { stageIds?: unknown }).stageIds);
    expect(idsAsked(a.check)).toEqual([{ transcription: 'a', translation: 'bing' }]);
    expect(idsAsked(b.check)).toEqual([{ speech: 'b' }]);

    // The same stages, another id for one of them: `a` is asked again, `b` is not.
    useLineUpStore.setState({ lineUp: { transcription: 'a', translation: 'a', speech: 'b', summarisation: null } });
    expect(useProviderStore.getState().readiness.a).toEqual({ state: 'unknown' });
    expect(useProviderStore.getState().readiness.b).toMatchObject({ state: 'ready' });
    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(idsAsked(a.check)).toEqual([{ transcription: 'a', translation: 'bing' }, { transcription: 'a', translation: 'a' }]);
    expect(b.check).toHaveBeenCalledTimes(1);
    detach();
  });

  it('a provider that serves every stage is told none: its check reads all it can serve, as before', async () => {
    const a = makeProbe('a');
    setupStore(a.provider);
    const clock = createVirtualClock(0);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [], plan: readinessPlan, auth: () => auth, clock });
    expect(useProviderStore.getState().stages).toEqual({});
    clock.advance(READINESS_DELAY_MS);
    await flush();
    expect(stagesAsked(a.check)).toEqual([undefined]);
    detach();
  });

  it('a change of the stages a provider serves checks it again, and not the provider whose stages stand', async () => {
    const a = makeProbe('a', 'own-key');
    const b = makeProbe('b', 'own-key');
    const c = makeProbe('c', 'own-key');
    setupStore(a.provider, b.provider, c.provider);
    const { calls } = spyRefresh();
    const clock = createVirtualClock(0);
    const [pa, pb, pc] = [a, b, c].map((probe) => probe.provider as unknown as AnyProvider);
    // `a` transcribes and translates throughout; the voice goes from `b` to `c`, then `a` takes every stage.
    let plan: RunPlan = planOfTwo(pa, pb);
    const detach = driveReadiness({ runner: idleRunner(), providers: () => [], plan: () => plan, auth: () => auth, clock });
    clock.advance(0);
    await flush();
    expect([calls('a'), calls('b'), calls('c')]).toEqual([1, 1, 0]);
    useProviderStore.setState({ readiness: { a: ready, b: ready } });

    plan = planOfTwo(pa, pc);
    useProviderStore.setState({}); // the plan moved: any store change has the driver read it again
    // `a` serves the same stages: its answer stands. `c` has just joined.
    expect(useProviderStore.getState().readiness.a).toBe(ready);
    clock.advance(NETWORK_READINESS_DELAY_MS);
    await flush();
    expect([calls('a'), calls('b'), calls('c')]).toEqual([1, 1, 1]);
    // `b` left the plan: it keeps what it was last told, and its answer.
    expect(useProviderStore.getState().stages).toEqual({ a: ['transcription', 'translation'], b: ['speech'], c: ['speech'] });
    expect(useProviderStore.getState().readiness.b).toBe(ready);
    useProviderStore.setState({ readiness: { ...useProviderStore.getState().readiness, c: ready } });

    const whole: PlannedUnit = { provider: pa, unit: unitsOf(pa)[0], stages: ['transcription', 'translation', 'speech'] };
    plan = { units: [whole], byStage: { transcription: whole, translation: whole, speech: whole } };
    useProviderStore.setState({});
    expect(useProviderStore.getState().readiness.a).toEqual({ state: 'unknown' });
    clock.advance(NETWORK_READINESS_DELAY_MS);
    await flush();
    expect(calls('a')).toBe(2);
    expect(useProviderStore.getState().stages).toEqual({ b: ['speech'], c: ['speech'] });
    detach();
  });
});

