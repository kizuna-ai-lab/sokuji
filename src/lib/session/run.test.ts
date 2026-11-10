import { describe, it, expect } from 'vitest';
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { DropInfo } from '../contract/reconnect';
import type { LegName } from '../conversation/types';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import type { NetworkPort } from './ports';
import { FLAP_WINDOW_MS } from './reconnect';
import type { NetworkType } from './reconnectEvents';
import { apiErrorType } from './run';
import { noticeText } from '../view/noticeText';
import { createRunner } from './runner';
import type { LeaseContext, RunShape, SessionHooks } from './types';

const DROP: DropInfo = { cause: 'close', closeCode: 1006, retryable: true, managed: true };
const RESTORED = { attempts: 2, credentialsReissued: true, reissueMs: 120, budgetShared: false };

/**
 * A run (spec 2026-11-05 reconnect §4.3, §4.5) over sessions that do nothing but keep their events: the test
 * drives each leg's `reconnecting` / `reconnected` / `failed` by hand. `both` starts the legs through
 * `startBoth`, `shared` makes its two sessions say they share one connection, `lease` keeps the lease's
 * context so a test can end it, and `network` is the port's answers (absent: no port).
 */
function setup(o: {
  legs?: RunShape['legs'];
  both?: boolean;
  shared?: boolean;
  lease?: boolean;
  network?: { online: boolean | undefined; type: NetworkType };
  /** Before `startBoth` resolves: what a leg says while the other still opens. */
  early?: (events: Record<LegName, AdapterEvents>) => void;
} = {}) {
  const clock = createVirtualClock(0);
  const kept: Partial<Record<LegName, AdapterEvents>> = {};
  const restored: LegName[] = [];
  const throwing = new Set<LegName>();
  const session = (leg: LegName, shared = false): AdapterSession => ({
    info: { transport: 'fake', ...(shared ? { shared: true } : {}) },
    appendAudio: () => {},
    appendText: () => {},
    beginTurn: () => {},
    endTurn: () => {},
    cancelTurn: () => {},
    networkRestored: () => {
      if (throwing.has(leg)) throw new Error('networkRestored broke');
      restored.push(leg);
    },
    stop: async () => {},
  });
  const start = async (request: StartRequest<unknown, unknown>, events: AdapterEvents): Promise<AdapterSession> => {
    const leg: LegName = request.context.direction.source === 'en' ? 'speaker' : 'participant';
    kept[leg] = events;
    return session(leg);
  };
  let lease: LeaseContext | null = null;
  const hooks: SessionHooks<unknown, unknown, unknown> = {
    ...(o.both ? {
      startBoth: async (_requests, events) => {
        kept.speaker = events.speaker;
        kept.participant = events.participant;
        o.early?.(events);
        return { speaker: session('speaker', o.shared), participant: session('participant', o.shared) };
      },
    } : {}),
    ...(o.lease ? {
      acquire: async (_shape, _s, ctx) => {
        lease = ctx;
        return { credentials: () => ({}), release: async () => {} };
      },
    } : {}),
  };
  const listeners = new Set<() => void>();
  const network: NetworkPort | undefined = o.network ? {
    online: () => o.network!.online,
    type: () => o.network!.type,
    onOnline: (fn) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  } : undefined;
  const tracked: Array<[string, unknown]> = [];
  const shape: RunShape = {
    provider: { ...fakeProvider, start, session: hooks } as unknown as AnyProvider,
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs: o.legs ?? (o.both ? ['speaker', 'participant'] : ['speaker']),
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: {
      pauses: { sourceSeconds: 1, translationSeconds: 1 },
      reversed: () => false,
      segmentation: { mode: 'off', sentencesPerRow: 0 },
    },
    auth: { signedIn: false, getToken: async () => null },
  };
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: { audio: () => [], held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track: (event, properties) => { tracked.push([event, properties]); } },
    ...(network ? { network } : {}),
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  const events = (leg: LegName = 'speaker'): AdapterEvents => kept[leg]!;
  const tracks = (name: string) => tracked.filter(([e]) => e === name).map(([, p]) => p);
  const order = (...names: string[]) => tracked.filter(([e]) => names.includes(e)).map(([e]) => e);
  const notices = (leg: LegName = 'speaker') => runner.conversation.get(leg)!.snapshot().notices;
  const goOnline = () => { for (const fn of [...listeners]) fn(); };
  return { clock, runner, events, tracks, order, notices, restored, throwing, listeners, goOnline, lease: () => lease! };
}

describe('apiErrorType', () => {
  it("names the five types as themselves, Qwen's passing request rate (throttled) as rate_limit, and anything else as server", () => {
    for (const type of ['auth', 'rate_limit', 'network', 'server', 'client'] as const) expect(apiErrorType(type)).toBe(type);
    expect(apiErrorType('throttled')).toBe('rate_limit');
    expect(apiErrorType('connection_lost')).toBe('server');
    expect(apiErrorType(undefined)).toBe('server');
  });
});

describe('run — the leg state while it reconnects (spec §4.3)', () => {
  it('reconnecting sets the leg to reconnecting with attempt and since; a second attempt updates attempt only', async () => {
    const { runner, clock, events } = setup();
    await runner.start();
    clock.advance(1000);
    events().reconnecting({ attempt: 1, drop: DROP });
    expect(runner.state.getState()).toEqual({
      phase: 'running', participantSpeech: false, since: 0,
      legs: { speaker: 'reconnecting' }, reconnect: { speaker: { attempt: 1, since: 1000 } },
    });
    clock.advance(250);
    events().reconnecting({ attempt: 2 });
    expect(runner.state.getState()).toMatchObject({ legs: { speaker: 'reconnecting' }, reconnect: { speaker: { attempt: 2, since: 1000 } } });
  });

  it('reconnected drops the attempt from the state: the running state no longer carries it', async () => {
    const { runner, clock, events } = setup();
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(400);
    events().reconnected(RESTORED);
    expect(runner.state.getState()).toEqual({ phase: 'running', participantSpeech: false, since: 0, legs: { speaker: 'live' } });
  });

  it('split Both: only the leg that dropped carries an attempt', async () => {
    const { runner, events } = setup({ both: true });
    await runner.start();
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    expect(runner.state.getState()).toMatchObject({ legs: { speaker: 'live', participant: 'reconnecting' }, reconnect: { participant: { attempt: 1, since: 0 } } });
    expect((runner.state.getState() as { reconnect?: object }).reconnect).not.toHaveProperty('speaker');
  });

  it('a leg reconnecting before startBoth settles shows its attempt once the run is running', async () => {
    const { runner } = setup({ both: true, early: (events) => events.speaker.reconnecting({ attempt: 1, drop: DROP }) });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'reconnecting', participant: 'live' }, reconnect: { speaker: { attempt: 1, since: 0 } } });
  });

  it('a payload-less reconnecting (Gemini, OpenAI) sets the leg reconnecting with no attempt; its reconnected adds no notice and sends none of the new events', async () => {
    const { runner, clock, events, tracks, notices } = setup({ network: { online: true, type: 'wifi' } });
    await runner.start();
    events().reconnecting();
    expect(runner.state.getState()).toEqual({ phase: 'running', participantSpeech: false, since: 0, legs: { speaker: 'reconnecting' } });
    clock.advance(400);
    events().reconnected();
    expect(runner.state.getState()).toMatchObject({ legs: { speaker: 'live' } });
    expect(notices()).toEqual([]);
    expect(tracks('connection_status')).toContainEqual({ status: 'reconnecting', provider: 'fake', channel: 'speaker' });
    expect([...tracks('connection_dropped'), ...tracks('connection_reconnected')]).toEqual([]);
  });
});

describe('run — the reconnect analytics (spec §4.5)', () => {
  it('connection_status reconnecting is sent once per drop', async () => {
    const { runner, clock, events, tracks } = setup();
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    events().reconnecting({ attempt: 2 });
    events().reconnecting({ attempt: 3 });
    expect(tracks('connection_status').filter((p) => (p as { status: string }).status === 'reconnecting')).toEqual([
      { status: 'reconnecting', provider: 'fake', channel: 'speaker' },
    ]);
    clock.advance(1000);
    events().reconnected(RESTORED);
    events().reconnecting({ attempt: 1, drop: DROP });
    expect(tracks('connection_status').filter((p) => (p as { status: string }).status === 'reconnecting')).toHaveLength(2);
  });

  it('connection_dropped carries drop_index 1 then 2, session_elapsed_ms, since_last_reconnect_ms on the second, online and network from the port', async () => {
    const { runner, clock, events, tracks } = setup({ network: { online: true, type: 'wifi' } });
    await runner.start();
    clock.advance(1000);
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(500);
    events().reconnected(RESTORED);
    clock.advance(2500);
    events().reconnecting({ attempt: 1, drop: { cause: 'error', errorCode: 'socket_error', retryable: true, managed: true } });
    expect(tracks('connection_dropped')).toEqual([
      {
        session_id: 'run1', provider: 'fake', managed: true, channel: 'speaker', cause: 'close', close_code: 1006, retryable: true,
        session_elapsed_ms: 1000, drop_index: 1, online: true, client: 'desktop', network: 'wifi',
      },
      {
        session_id: 'run1', provider: 'fake', managed: true, channel: 'speaker', cause: 'error', error_code: 'socket_error', retryable: true,
        session_elapsed_ms: 4000, drop_index: 2, since_last_reconnect_ms: 2500, online: true, client: 'desktop', network: 'wifi',
      },
    ]);
  });

  it('a port that cannot tell online sends no online and network unknown; with no port, neither', async () => {
    const unsure = setup({ network: { online: undefined, type: 'unknown' } });
    await unsure.runner.start();
    unsure.events().reconnecting({ attempt: 1, drop: DROP });
    expect(unsure.tracks('connection_dropped')[0]).not.toHaveProperty('online');
    expect(unsure.tracks('connection_dropped')[0]).toMatchObject({ network: 'unknown' });

    const none = setup();
    await none.runner.start();
    none.events().reconnecting({ attempt: 1, drop: DROP });
    expect(none.tracks('connection_dropped')[0]).not.toHaveProperty('online');
    expect(none.tracks('connection_dropped')[0]).not.toHaveProperty('network');
  });

  it('since_last_reconnect_ms counts from this leg\'s last reconnected, and drop_index across the run', async () => {
    const { runner, clock, events, tracks } = setup({ both: true });
    await runner.start();
    events('speaker').reconnecting({ attempt: 1, drop: DROP });
    clock.advance(500);
    events('speaker').reconnected(RESTORED);
    clock.advance(1000);
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    expect(tracks('connection_dropped')).toEqual([
      expect.objectContaining({ channel: 'speaker', drop_index: 1 }),
      expect.objectContaining({ channel: 'participant', drop_index: 2 }),
    ]);
    // The participant's connection never reconnected before.
    expect(tracks('connection_dropped')[1]).not.toHaveProperty('since_last_reconnect_ms');
  });

  it('shared Both: one drop reaches both legs, which both show reconnecting, and is sent once with channel shared', async () => {
    const { runner, clock, events, tracks } = setup({ both: true, shared: true });
    await runner.start();
    clock.advance(1000);
    events('speaker').reconnecting({ attempt: 1, drop: DROP });
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    expect(runner.state.getState()).toMatchObject({
      legs: { speaker: 'reconnecting', participant: 'reconnecting' },
      reconnect: { speaker: { attempt: 1, since: 1000 }, participant: { attempt: 1, since: 1000 } },
    });
    expect(tracks('connection_dropped')).toEqual([expect.objectContaining({ channel: 'shared', drop_index: 1 })]);
    // `connection_status` stays per leg, as today.
    expect(tracks('connection_status').filter((p) => (p as { status: string }).status === 'reconnecting')).toEqual([
      { status: 'reconnecting', provider: 'fake', channel: 'speaker' },
      { status: 'reconnecting', provider: 'fake', channel: 'participant' },
    ]);
  });

  it('reconnected makes the leg live, adds one info notice connection_restored to that leg, and sends connection_reconnected with down_ms', async () => {
    const { runner, clock, events, tracks, notices } = setup({ both: true, network: { online: true, type: 'cellular' } });
    await runner.start();
    clock.advance(1000);
    events('speaker').reconnecting({ attempt: 1, drop: DROP });
    clock.advance(1800);
    events('speaker').reconnected(RESTORED);
    expect(runner.state.getState()).toMatchObject({ legs: { speaker: 'live', participant: 'live' } });
    expect(notices('speaker')).toEqual([expect.objectContaining({ severity: 'info', code: 'connection_restored', message: 'Connection lost and restored' })]);
    expect(notices('participant')).toEqual([]);
    expect(tracks('connection_reconnected')).toEqual([{
      session_id: 'run1', provider: 'fake', managed: true, channel: 'speaker', down_ms: 1800, attempts: 2,
      credentials_reissued: true, reissue_ms: 120, drop_index: 1, budget_shared: false, client: 'desktop', network: 'cellular',
    }]);
  });

  it('a flap burst shows the notice once per leg: a reconnect within FLAP_WINDOW_MS of the one before adds none, its analytics still sent', async () => {
    const { runner, clock, events, tracks, notices } = setup({ both: true, shared: true });
    await runner.start();
    const flap = (afterMs: number) => {
      clock.advance(afterMs);
      events('speaker').reconnecting({ attempt: 1, drop: DROP });
      events('participant').reconnecting({ attempt: 1, drop: DROP });
      clock.advance(200);
      events('speaker').reconnected(RESTORED);
      events('participant').reconnected(RESTORED);
    };
    flap(1000);
    // Each 3 s after the reconnect before it, then 10 s after: still inside the window.
    flap(3000);
    flap(3000);
    flap(FLAP_WINDOW_MS - 200);
    expect(notices('speaker')).toHaveLength(1);
    expect(notices('participant')).toHaveLength(1);
    expect(tracks('connection_reconnected')).toHaveLength(4);
    // Past the window: a reconnect of its own, told again.
    flap(FLAP_WINDOW_MS);
    expect(notices('speaker')).toHaveLength(2);
    expect(notices('participant')).toHaveLength(2);
    expect(tracks('connection_reconnected')).toHaveLength(5);
  });

  it('shared Both: both legs show the notice, and connection_reconnected is sent once with channel shared', async () => {
    const { runner, clock, events, tracks, notices } = setup({ both: true, shared: true });
    await runner.start();
    events('speaker').reconnecting({ attempt: 1, drop: DROP });
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    clock.advance(700);
    events('speaker').reconnected(RESTORED);
    events('participant').reconnected(RESTORED);
    expect(notices('speaker')).toEqual([expect.objectContaining({ code: 'connection_restored' })]);
    expect(notices('participant')).toEqual([expect.objectContaining({ code: 'connection_restored' })]);
    expect(tracks('connection_reconnected')).toEqual([expect.objectContaining({ channel: 'shared', down_ms: 700, drop_index: 1 })]);
  });

  it('failed with giveUp sends connection_reconnect_failed then api_error, and ends the run as leg-failed', async () => {
    const { runner, clock, events, tracks, order } = setup();
    await runner.start();
    clock.advance(1000);
    events().reconnecting({ attempt: 1, drop: DROP });
    events().reconnecting({ attempt: 2 });
    clock.advance(30_000);
    events().failed({ message: 'The connection was lost.', code: 'connection_lost', giveUp: { attempts: 9, reason: 'timeout', errorCode: '1006' } });
    expect(tracks('connection_reconnect_failed')).toEqual([{
      session_id: 'run1', provider: 'fake', managed: true, channel: 'speaker', down_ms: 30_000, attempts: 9,
      reason: 'timeout', error_code: '1006', drop_index: 1, client: 'desktop',
    }]);
    expect(order('connection_reconnect_failed', 'api_error')).toEqual(['connection_reconnect_failed', 'api_error']);
    await runner.settled();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'connection_lost', leg: 'speaker' } } });
    // Ended by the give-up: nothing more for the drop at the end.
    expect(tracks('connection_reconnect_failed')).toHaveLength(1);
  });

  it('a refusal give-up carries its refusal_code', async () => {
    const { runner, events, tracks } = setup();
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    events().failed({ message: 'Sign in again.', code: 'sign_in_required', giveUp: { attempts: 1, reason: 'refused', errorCode: 'sign_in_required', refusalCode: 'sign_in_required' } });
    expect(tracks('connection_reconnect_failed')).toEqual([expect.objectContaining({ reason: 'refused', error_code: 'sign_in_required', refusal_code: 'sign_in_required', attempts: 1 })]);
  });

  it('a refusal give-up puts its notice params on the run\'s notice (a frozen organization named mid-session)', async () => {
    const { runner, events } = setup();
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    events().failed({ message: 'Frozen.', code: 'org_wallet_frozen', giveUp: { attempts: 1, reason: 'refused', refusalCode: 'org_wallet_frozen', params: { organization: 'Acme', role: 'owner' } } });
    await runner.settled();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'org_wallet_frozen', params: { organization: 'Acme', role: 'owner' } } } });
  });

  it('a removed member\'s give-up ends the run with the membership-ended notice, named, not a lost connection', async () => {
    const { runner, events } = setup();
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    events().failed({ message: 'Removed.', code: 'not_org_member', giveUp: { attempts: 1, reason: 'refused', refusalCode: 'not_org_member', params: { organization: 'Acme', role: 'member' } } });
    await runner.settled();
    const state = runner.state.getState();
    expect(state).toMatchObject({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'not_org_member', params: { organization: 'Acme', role: 'member' } } } });
    const notice = (state as unknown as { lastEnd: { notice: Parameters<typeof noticeText>[1] } }).lastEnd.notice;
    expect(noticeText(((_key: string, o: Record<string, unknown>) => String(o.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(o[n]))) as never, notice)).toBe("You're no longer in Acme.");
  });

  it('failed with a non-retryable drop sends connection_dropped retryable false, and no connection_reconnect_failed', async () => {
    const { runner, clock, events, tracks } = setup();
    await runner.start();
    clock.advance(2000);
    events().failed({ message: 'The key was refused.', code: 'auth', drop: { cause: 'close', closeCode: 1008, errorCode: '401', retryable: false, managed: false } });
    expect(tracks('connection_dropped')).toEqual([{
      session_id: 'run1', provider: 'fake', managed: false, channel: 'speaker', cause: 'close', close_code: 1008, error_code: '401',
      retryable: false, session_elapsed_ms: 2000, drop_index: 1, client: 'desktop',
    }]);
    expect(tracks('connection_reconnect_failed')).toEqual([]);
    expect(tracks('api_error')).toEqual([expect.objectContaining({ error_code: 'auth', channel: 'speaker' })]);
  });

  it('the session-cap give-up (no reconnecting before it) sends its drop as retryable, then connection_reconnect_failed down no time', async () => {
    const { runner, clock, events, tracks, order } = setup();
    await runner.start();
    clock.advance(3000);
    events().failed({ message: 'Connection lost', code: 'connection_lost', drop: DROP, giveUp: { attempts: 0, reason: 'session_cap' } });
    expect(tracks('connection_dropped')).toEqual([expect.objectContaining({ retryable: true, drop_index: 1, session_elapsed_ms: 3000 })]);
    expect(tracks('connection_reconnect_failed')).toEqual([{
      session_id: 'run1', provider: 'fake', managed: true, channel: 'speaker', down_ms: 0, attempts: 0,
      reason: 'session_cap', drop_index: 1, client: 'desktop',
    }]);
    expect(order('connection_dropped', 'connection_reconnect_failed', 'api_error')).toEqual(['connection_dropped', 'connection_reconnect_failed', 'api_error']);
    await runner.settled();
    expect(tracks('translation_session_end')[0]).toMatchObject({ reconnect_failed: true });
  });

  it('a failed carrying the drop of a reconnect already open sends no second connection_dropped', async () => {
    const { runner, clock, events, tracks } = setup();
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(2000);
    events().failed({ message: 'lost', code: 'connection_lost', drop: DROP, giveUp: { attempts: 4, reason: 'timeout' } });
    expect(tracks('connection_dropped')).toHaveLength(1);
    expect(tracks('connection_reconnect_failed')).toEqual([expect.objectContaining({ drop_index: 1, down_ms: 2000, attempts: 4 })]);
  });

  it("shared Both: the participant's give-up arriving first acts for the connection, once", async () => {
    const { runner, clock, events, tracks } = setup({ both: true, shared: true });
    await runner.start();
    events('speaker').reconnecting({ attempt: 1, drop: DROP });
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    clock.advance(30_000);
    const failure = { message: 'lost', code: 'connection_lost', giveUp: { attempts: 9, reason: 'timeout' as const } };
    events('participant').failed(failure);
    events('speaker').failed(failure);
    await runner.settled();
    expect(tracks('connection_reconnect_failed')).toEqual([expect.objectContaining({ channel: 'shared', reason: 'timeout', down_ms: 30_000, drop_index: 1 })]);
    expect(tracks('translation_session_end')[0]).toMatchObject({ reconnect_failed: true });
  });

  it("shared Both: the participant's non-retryable failure arriving first sends the drop once", async () => {
    const { runner, events, tracks } = setup({ both: true, shared: true });
    await runner.start();
    const failure = { message: 'The key was refused.', code: 'auth', drop: { cause: 'close' as const, closeCode: 1008, retryable: false, managed: false } };
    events('participant').failed(failure);
    events('speaker').failed(failure);
    await runner.settled();
    expect(tracks('connection_dropped')).toEqual([expect.objectContaining({ channel: 'shared', retryable: false, drop_index: 1 })]);
  });

  it('Stop during reconnecting sends connection_reconnect_failed reason stopped and no api_error', async () => {
    const { runner, clock, events, tracks } = setup();
    await runner.start();
    clock.advance(1000);
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(1250);
    events().reconnecting({ attempt: 3 });
    await runner.stop();
    expect(tracks('connection_reconnect_failed')).toEqual([{
      session_id: 'run1', provider: 'fake', managed: true, channel: 'speaker', down_ms: 1250, attempts: 3,
      reason: 'stopped', drop_index: 1, client: 'desktop',
    }]);
    expect(tracks('api_error')).toEqual([]);
  });

  it('a lease end during reconnecting sends reason lease_ended', async () => {
    const { runner, clock, events, tracks, lease } = setup({ lease: true });
    await runner.start();
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(4000);
    lease().end({ code: 'budget_exhausted', message: 'The granted time is used up.' });
    await runner.settled();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended' } });
    expect(tracks('connection_reconnect_failed')).toEqual([expect.objectContaining({ reason: 'lease_ended', down_ms: 4000, attempts: 1, drop_index: 1 })]);
  });

  it('split Both: the leg still reconnecting when the other fails is cut as stopped', async () => {
    const { runner, events, tracks } = setup({ both: true });
    await runner.start();
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    events('speaker').failed({ message: 'Quota spent.', code: 'quota_exceeded' });
    await runner.settled();
    expect(tracks('connection_reconnect_failed')).toEqual([expect.objectContaining({ channel: 'participant', reason: 'stopped' })]);
  });

  it('a stop during a payload-less reconnect sends no connection_reconnect_failed', async () => {
    const { runner, events, tracks } = setup();
    await runner.start();
    events().reconnecting();
    await runner.stop();
    expect(tracks('connection_reconnect_failed')).toEqual([]);
  });
});

describe('run — the network coming back (spec §4.2)', () => {
  it('an online event calls networkRestored on each live session; none after the run ends', async () => {
    const { runner, restored, listeners, goOnline } = setup({ both: true, network: { online: true, type: 'unknown' } });
    await runner.start();
    goOnline();
    expect(restored).toEqual(['speaker', 'participant']);
    await runner.stop();
    expect(listeners.size).toBe(0);
    goOnline();
    expect(restored).toEqual(['speaker', 'participant']);
  });

  it('shared Both: the one connection hears it once, through the speaker', async () => {
    const { runner, restored, goOnline } = setup({ both: true, shared: true, network: { online: true, type: 'unknown' } });
    await runner.start();
    goOnline();
    expect(restored).toEqual(['speaker']);
  });

  it('a session whose networkRestored throws does not keep the other from hearing it', async () => {
    const { runner, restored, throwing, goOnline } = setup({ both: true, network: { online: true, type: 'unknown' } });
    await runner.start();
    throwing.add('speaker');
    expect(() => goOnline()).not.toThrow();
    expect(restored).toEqual(['participant']);
  });
});

describe('run — the session totals', () => {
  const end = (tracks: (name: string) => unknown[]) => tracks('translation_session_end')[0];

  it('translation_session_end carries reconnect_count, reconnect_down_ms, reconnect_failed', async () => {
    const { runner, clock, events, tracks } = setup();
    await runner.start();
    clock.advance(1000);
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(600);
    events().reconnected(RESTORED);
    clock.advance(3000);
    events().reconnecting({ attempt: 1, drop: DROP });
    clock.advance(900);
    events().reconnected(RESTORED);
    await runner.stop();
    expect(end(tracks)).toEqual({ session_id: 'run1', duration: 5500, provider: 'fake', reconnect_count: 2, reconnect_down_ms: 1500, reconnect_failed: false });
  });

  it('a run that ended because reconnecting gave up says so; one stopped while reconnecting does not', async () => {
    const gaveUp = setup();
    await gaveUp.runner.start();
    gaveUp.events().reconnecting({ attempt: 1, drop: DROP });
    gaveUp.events().failed({ message: 'lost', code: 'connection_lost', giveUp: { attempts: 9, reason: 'timeout' } });
    await gaveUp.runner.settled();
    expect(end(gaveUp.tracks)).toMatchObject({ reconnect_count: 0, reconnect_down_ms: 0, reconnect_failed: true });

    const stopped = setup();
    await stopped.runner.start();
    stopped.events().reconnecting({ attempt: 1, drop: DROP });
    await stopped.runner.stop();
    expect(end(stopped.tracks)).toMatchObject({ reconnect_failed: false });
  });

  it('payload-less reconnects count too, and their failure while reconnecting is a give-up', async () => {
    const { runner, clock, events, tracks } = setup();
    await runner.start();
    events().reconnecting();
    clock.advance(400);
    events().reconnected();
    events().reconnecting();
    events().failed({ message: 'The Gemini connection was lost and could not be restored.', code: 'connection_lost' });
    await runner.settled();
    expect(end(tracks)).toMatchObject({ reconnect_count: 1, reconnect_down_ms: 400, reconnect_failed: true });
  });

  it('a failure that was not a reconnect is no give-up', async () => {
    const { runner, events, tracks } = setup();
    await runner.start();
    events().failed({ message: 'The key was refused.', code: 'auth', drop: { cause: 'close', closeCode: 1008, retryable: false, managed: false } });
    await runner.settled();
    expect(end(tracks)).toMatchObject({ reconnect_count: 0, reconnect_down_ms: 0, reconnect_failed: false });
  });

  it('shared Both counts one reconnect of the one connection once', async () => {
    const { runner, clock, events, tracks } = setup({ both: true, shared: true });
    await runner.start();
    events('speaker').reconnecting({ attempt: 1, drop: DROP });
    events('participant').reconnecting({ attempt: 1, drop: DROP });
    clock.advance(500);
    events('speaker').reconnected(RESTORED);
    events('participant').reconnected(RESTORED);
    await runner.stop();
    expect(end(tracks)).toMatchObject({ reconnect_count: 1, reconnect_down_ms: 500, reconnect_failed: false });
  });
});
