import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, SessionContext, StartRequest } from '../../lib/contract/adapter';
import { AdapterStartError, LegStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import type { LegName } from '../../lib/conversation/types';
import type { AnyProvider, SharedSettings } from '../../lib/provider/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { fakeLeasedProvider, type FakeLeasedConfig, type FakeLeasedCredentials } from './leased';
import { FAKE_LEASED_DEFAULTS, migrateFakeLeasedSettings, type FakeLeasedSettings } from './settings';
import { createFakeSource } from './source';

const signedOut = { signedIn: false, getToken: async () => null };
const signedIn = { signedIn: true, userId: 'u1', getToken: async () => 't' };
const s = (patch: Partial<FakeLeasedSettings> = {}): FakeLeasedSettings => ({ ...FAKE_LEASED_DEFAULTS, ...patch });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const session = fakeLeasedProvider.session!;
const live = () => new AbortController().signal;

/** A frozen shape for the hooks that only pass it through. */
const shapeFor = (settings: FakeLeasedSettings): RunShape => ({
  provider: fakeLeasedProvider as AnyProvider,
  settings,
  credentials: {},
  pair: { source: 'en', target: 'ja' },
  legs: ['speaker', 'participant'],
  turnMode: 'auto',
  textOnly: false,
  participantSpeech: false,
  keepReplayAudio: true,
  shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: signedIn,
});

// fake/provider.test.ts's literal; the participant's direction (ja → en) is the reversed one.
const shared: SharedSettings = {
  instructions: () => '',
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (direction) => direction.source === 'ja',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
const contexts: Record<LegName, SessionContext> = {
  speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
  participant: { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' },
};

/** Both legs' requests and recorded events, each leg built from its own settings. */
function bothLegs(speakerSettings: FakeLeasedSettings, participantSettings: FakeLeasedSettings = speakerSettings) {
  const clock = createVirtualClock(0);
  const settingsFor: Record<LegName, FakeLeasedSettings> = { speaker: speakerSettings, participant: participantSettings };
  const request = (leg: LegName): StartRequest<FakeLeasedConfig, FakeLeasedCredentials> => {
    const config = fakeLeasedProvider.build(contexts[leg], settingsFor[leg], shared);
    if ('refused' in config) throw new Error(config.refused);
    return { context: contexts[leg], config, credentials: { leg }, clock, signal: live() };
  };
  const speaker = recordEvents();
  const participant = recordEvents();
  return {
    clock,
    requests: { speaker: request('speaker'), participant: request('participant') },
    events: { speaker: speaker.events, participant: participant.events } as Record<LegName, AdapterEvents>,
    logs: { speaker: speaker.log, participant: participant.log },
  };
}

/** The end-to-end case's runner over the leased fake, on these legs and settings. */
function leasedRunner(settings: FakeLeasedSettings, legs: RunShape['legs']) {
  const clock = createVirtualClock(0);
  const shape: RunShape = { ...shapeFor(settings), legs };
  const runner = createRunner({
    clock, platform: 'electron', readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: { audio: () => {}, held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track: () => {} },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  return { clock, runner };
}

describe('the leased fake', () => {
  it('is managed, with no credential field', () => {
    expect(fakeLeasedProvider.kind).toBe('managed');
    expect(fakeLeasedProvider.credentials.keys).toEqual([]);
    expect(fakeLeasedProvider.credentials.fields(s())).toEqual([]);
  });

  it('reads from the sign-in: signed out it is missing with sign_in_required; signed in it reads', () => {
    expect(fakeLeasedProvider.credentials.read({}, signedOut)).toEqual({ missing: 'Sign in to use the leased fake.', code: 'sign_in_required' });
    expect(fakeLeasedProvider.credentials.read({}, signedIn)).not.toHaveProperty('missing');
  });

  it('prepare answers with the fallback notice only when asked', async () => {
    await expect(session.prepare!(shapeFor(s()), s(), live())).resolves.toEqual({});
    await expect(session.prepare!(shapeFor(s({ prepareFallback: true })), s({ prepareFallback: true }), live())).resolves.toEqual({
      notice: { code: 'voice_fallback', message: 'The leased fake used its fallback voice (knob).' },
    });
  });

  it('acquire gives each leg its own credentials and releases once', async () => {
    const clock = createVirtualClock(0);
    // Counts the lease timer's cancels: a second release that did its work again would cancel twice.
    const cancelled = vi.fn();
    const counting = {
      now: () => clock.now(),
      setTimeout: (fn: () => void, ms: number) => {
        const cancel = clock.setTimeout(fn, ms);
        return () => { cancelled(); cancel(); };
      },
    };
    const lease = await session.acquire!(shapeFor(s({ leaseEndsAfterMs: 1000 })), s({ leaseEndsAfterMs: 1000 }), { signal: live(), clock: counting, end: vi.fn(), frame: vi.fn() });
    expect(lease.credentials('speaker')).toEqual({ leg: 'speaker' });
    expect(lease.credentials('participant')).toEqual({ leg: 'participant' });
    await lease.release();
    expect(cancelled).toHaveBeenCalledTimes(1);
    await expect(lease.release()).resolves.toBeUndefined();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("acquire ends the run on the run's clock with budget_exhausted, and not once released", async () => {
    const clock = createVirtualClock(0);
    const end = vi.fn();
    await session.acquire!(shapeFor(s({ leaseEndsAfterMs: 1000 })), s({ leaseEndsAfterMs: 1000 }), { signal: live(), clock, end, frame: vi.fn() });
    clock.advance(999);
    expect(end).not.toHaveBeenCalled();
    clock.advance(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith({ code: 'budget_exhausted', message: 'Lease ended by the leased fake (knob).' });

    const released = vi.fn();
    const second = await session.acquire!(shapeFor(s({ leaseEndsAfterMs: 1000 })), s({ leaseEndsAfterMs: 1000 }), { signal: live(), clock, end: released, frame: vi.fn() });
    await second.release();
    clock.advance(2000);
    expect(released).not.toHaveBeenCalled();
  });

  it('acquire refuses a cancelled start', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(session.acquire!(shapeFor(s()), s(), { signal: controller.signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() })).rejects.toThrow('cancelled');
  });

  it('acquire refuses with insufficient_balance when asked (the parked coded refusal)', async () => {
    const refusing = session.acquire!(shapeFor(s({ acquireRefused: true })), s({ acquireRefused: true }), { signal: live(), clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() });
    await expect(refusing).rejects.toBeInstanceOf(AdapterStartError);
    await expect(refusing).rejects.toMatchObject({ code: 'insufficient_balance', message: 'The leased fake refused the lease (knob).' });
  });

  it('its lease carries a budget when it ends, and none when it never does', async () => {
    const clock = createVirtualClock(500);
    const ending = await session.acquire!(shapeFor(s({ leaseEndsAfterMs: 3000 })), s({ leaseEndsAfterMs: 3000 }), { signal: live(), clock, end: vi.fn(), frame: vi.fn() });
    expect(ending.budget).toEqual({ totalMs: 3000, endsAt: 3500 });
    const endless = await session.acquire!(shapeFor(s({ leaseEndsAfterMs: 0 })), s({ leaseEndsAfterMs: 0 }), { signal: live(), clock, end: vi.fn(), frame: vi.fn() });
    expect(endless.budget).toBeUndefined();
  });

  it('acquire says so in the Logs', async () => {
    const frame = vi.fn();
    await session.acquire!(shapeFor(s({ leaseEndsAfterMs: 3000 })), s({ leaseEndsAfterMs: 3000 }), { signal: live(), clock: createVirtualClock(0), end: vi.fn(), frame });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenCalledWith({ direction: 'in', type: 'lease.acquired', payload: { endsAfterMs: 3000 } });
  });

  it('its floor is the knob for a text-only start, twice it when the speaker speaks', () => {
    const knob = s({ minimumBalanceMicroUsd: 1000 });
    expect(session.minimumBalance!({ legs: ['speaker'], textOnly: true, participantSpeech: false }, knob)).toBe(1000);
    expect(session.minimumBalance!({ legs: ['speaker'], textOnly: false, participantSpeech: false }, knob)).toBe(2000);
    expect(session.minimumBalance!({ legs: ['participant'], textOnly: false, participantSpeech: false }, knob)).toBe(1000);
    expect(session.minimumBalance!({ legs: ['speaker'], textOnly: false, participantSpeech: false }, s({ minimumBalanceMicroUsd: 0 }))).toBe(0);
  });

  it('startBoth, shared: stopping either leg stops both', async () => {
    const { clock, requests, events, logs } = bothLegs(s({ sharedBoth: true }));
    const sessions = await session.startBoth!(requests, events);
    await sessions.speaker.stop();
    const before = logs.participant.length;
    clock.advance(10_000);
    expect(logs.participant).toHaveLength(before);
  });

  it('startBoth, split: the legs stay apart', async () => {
    const { clock, requests, events, logs } = bothLegs(s({ sharedBoth: false }));
    const sessions = await session.startBoth!(requests, events);
    await sessions.speaker.stop();
    const before = logs.participant.length;
    clock.advance(10_000);
    expect(logs.participant.length).toBeGreaterThan(before);
  });

  it('startBoth opens nothing when a leg fails: the leg that did start is stopped, and the failure is thrown', async () => {
    const { clock, requests, events, logs } = bothLegs(s(), s({ startThrows: true }));
    expect(requests.participant.config.faults?.startThrows).toBe('The fake failed to start (fault knob).');
    await expect(session.startBoth!(requests, events)).rejects.toThrow('The fake failed to start (fault knob).');
    clock.advance(10_000);
    expect(logs.speaker).toEqual([]);
    const fresh1 = bothLegs(s(), s({ startThrows: true }));
    await expect(session.startBoth!(fresh1.requests, fresh1.events)).rejects.toBeInstanceOf(LegStartError);
    const fresh2 = bothLegs(s(), s({ startThrows: true }));
    await expect(session.startBoth!(fresh2.requests, fresh2.events)).rejects.toMatchObject({ leg: 'participant' });
  });

  it("startBoth throws the start failure even when stopping the leg that did start fails too", async () => {
    const { clock, requests, events } = bothLegs(s(), s({ startThrows: true }));
    // A clock whose timers cannot be cancelled: the speaker's session schedules
    // its script on it, so its `stop()` rejects.
    requests.speaker.clock = {
      now: () => clock.now(),
      setTimeout: (fn, ms) => {
        clock.setTimeout(fn, ms);
        return () => { throw new Error('The stop failed too.'); };
      },
    };
    await expect(session.startBoth!(requests, events)).rejects.toThrow('The fake failed to start (fault knob).');
  });

  it('runs end to end through the runner', async () => {
    const clock = createVirtualClock(0);
    const shape: RunShape = {
      provider: fakeLeasedProvider as AnyProvider,
      settings: s({ prepareFallback: true, leaseEndsAfterMs: 3000 }),
      credentials: {},
      pair: { source: 'en', target: 'ja' },
      legs: ['speaker'],
      turnMode: 'auto',
      textOnly: false,
      participantSpeech: false,
      keepReplayAudio: true,
      shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
      auth: signedIn,
    };
    const runner = createRunner({
      clock, platform: 'electron', readShape: () => shape,
      ensureReady: async () => ({ state: 'ready', models: [] }),
      persistIfUnchanged: () => {},
      openSource: async () => createFakeSource(clock),
      playback: { audio: () => {}, held: () => {}, clear: () => {}, live: () => {} },
      analytics: { track: () => {} },
      newSessionId: () => 'run1',
      timeoutMs: 1000,
    });

    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ code: 'voice_fallback' })]);

    clock.advance(3000);
    // The lease's `end` closes the run asynchronously.
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } });
  });

  it("runs both legs end to end through the runner: the lease's end is recorded once, on the speaker's leg", async () => {
    const { clock, runner } = leasedRunner(s({ leaseEndsAfterMs: 3000, sharedBoth: true }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'running', budget: { totalMs: 3000, endsAt: 3000 } });
    clock.advance(3000);
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } });
    const [speaker, participant] = runner.conversation.snapshot();
    expect(speaker.notices.filter((n) => n.code === 'budget_exhausted')).toHaveLength(1);
    expect(participant.notices.filter((n) => n.code === 'budget_exhausted')).toEqual([]);
  });

  it("a refused lease fails its start through the runner, with the words' code", async () => {
    const { runner } = leasedRunner(s({ acquireRefused: true }), ['speaker']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'insufficient_balance' } } });
  });
});

describe('migrateFakeLeasedSettings', () => {
  it("keeps valid stored knobs, and replaces each bad one with the leased fake's default", () => {
    // A literal, not a `FakeLeasedSettings`: an interface type has no index signature, so it would not pass as a stored record.
    // Every knob off its default, so a fallback shows.
    const valid = { ...FAKE_LEASED_DEFAULTS, prepareFallback: true, leaseEndsAfterMs: 2500, sharedBoth: false, acquireRefused: true, minimumBalanceMicroUsd: 1234 };
    expect(migrateFakeLeasedSettings(valid)).toEqual(valid);
    const bad = [
      ['leaseEndsAfterMs', -1], ['leaseEndsAfterMs', 'x'], ['sharedBoth', 'yes'], ['prepareFallback', 1],
      ['acquireRefused', 'yes'], ['minimumBalanceMicroUsd', -5], ['minimumBalanceMicroUsd', 'x'],
    ] as const;
    for (const [key, value] of bad) {
      expect(migrateFakeLeasedSettings({ ...valid, [key]: value }), `${key}: ${String(value)}`).toEqual({ ...valid, [key]: FAKE_LEASED_DEFAULTS[key] });
    }
  });
});
