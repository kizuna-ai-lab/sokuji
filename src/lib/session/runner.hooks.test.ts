import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError, LegStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { LegName } from '../conversation/types';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { DEGRADED_DEDUPE_MS } from '../conversation/Conversation';
import type { FramePort } from './ports';
import { createRunner } from './runner';
import type { Source } from './source';
import type { RunNotice, RunShape, SessionHooks } from './types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function withHooks(session: SessionHooks<unknown, unknown, unknown>, patch: Partial<AnyProvider> = {}): AnyProvider {
  return { ...fakeProvider, ...patch, session } as AnyProvider;
}

function setup(provider: AnyProvider, legs: RunShape['legs'] = ['speaker'], openSource?: (leg: LegName) => Source, track: (event: string, props?: unknown) => void = () => {}, frames?: FramePort) {
  const clock = createVirtualClock(0);
  const sources: FakeSource[] = [];
  const persistIfUnchanged = vi.fn();
  const shape: RunShape = {
    provider,
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs,
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
    persistIfUnchanged,
    openSource: async (leg) => { const s = openSource ? openSource(leg) : createFakeSource(clock); sources.push(s as FakeSource); return s; },
    playback: { audio: () => {}, held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track },
    frames,
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  return { clock, runner, sources, persistIfUnchanged, shape };
}

describe('runner — prepare', () => {
  it("applies prepare's override to this run's build", async () => {
    const { runner, clock } = setup(withHooks({ prepare: async () => ({ override: { script: 'cjk' } }) }));
    await runner.start();
    clock.advance(600);
    expect(runner.conversation.snapshot()[0].segments[0].text).toBe('今日は');
  });

  it("writes prepare's persist patch through persistIfUnchanged, against the run's snapshot", async () => {
    const provider = withHooks({ prepare: async () => ({ persist: { script: 'long' } }) });
    const { runner, persistIfUnchanged, shape } = setup(provider);
    await runner.start();
    expect(persistIfUnchanged).toHaveBeenCalledWith(provider, shape.settings, { script: 'long' });
  });

  it("records prepare's notice on the first leg", async () => {
    const { runner } = setup(withHooks({ prepare: async () => ({ notice: { code: 'voice_fallback', message: 'built-in voice' } }) }));
    await runner.start();
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'warning', code: 'voice_fallback', message: 'built-in voice' })]);
  });

  it("records prepare's notice on the speaker leg only, when both legs run (F5)", async () => {
    const { runner } = setup(withHooks({ prepare: async () => ({ notice: { code: 'voice_fallback', message: 'built-in voice' } }) }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ code: 'voice_fallback' })]);
    expect(runner.conversation.snapshot()[1].notices).toEqual([]);
  });

  it("applies prepare's override to the build while persisting the run's own snapshot, when both are returned together (F5)", async () => {
    const provider = withHooks({ prepare: async () => ({ override: { script: 'cjk' }, persist: { script: 'long' } }) });
    const { runner, clock, persistIfUnchanged, shape } = setup(provider);
    await runner.start();
    clock.advance(600);
    expect(runner.conversation.snapshot()[0].segments[0].text).toBe('今日は');
    expect(persistIfUnchanged).toHaveBeenCalledWith(provider, shape.settings, { script: 'long' });
  });
});

describe('runner — admit', () => {
  it('hands admit the configs actually built, one per leg', async () => {
    const admit = vi.fn(() => true as const);
    const { runner } = setup(withHooks({ admit }), ['speaker', 'participant']);
    await runner.start();
    expect(admit).toHaveBeenCalledWith({ speaker: expect.objectContaining({ script: expect.anything() }), participant: expect.objectContaining({ script: expect.anything() }) });
  });

  it('refuses a start admit refuses, opening nothing', async () => {
    const { runner, sources } = setup(withHooks({ admit: () => ({ refused: 'one leg only' }) }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'admit_refused', message: 'one leg only' } } });
    expect(sources).toHaveLength(0);
  });
});

describe('runner — acquire', () => {
  it("gives each leg its own credentials, and releases the lease after the legs have closed", async () => {
    const order: string[] = [];
    const seen: Record<string, unknown> = {};
    const provider = withHooks(
      {
        acquire: async () => ({
          credentials: (leg) => ({ minted: leg }),
          release: async () => { order.push('lease released'); },
        }),
      },
      {
        async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
          const leg = request.context.direction.source === 'en' ? 'speaker' : 'participant';
          seen[leg] = request.credentials;
          const inner = await fakeProvider.start(request as StartRequest<never, never>, events);
          return { ...inner, info: inner.info, appendAudio: () => {}, appendText: () => {}, beginTurn: () => {}, endTurn: () => {}, cancelTurn: () => {},
            stop: async () => { order.push(`${leg} closed`); await inner.stop(); } } as AdapterSession;
        },
      },
    );
    const { runner } = setup(provider, ['speaker', 'participant']);
    await runner.start();
    expect(seen).toEqual({ speaker: { minted: 'speaker' }, participant: { minted: 'participant' } });
    await runner.stop();
    expect(order[order.length - 1]).toBe('lease released');
    expect(order.slice(0, 2).sort()).toEqual(['participant closed', 'speaker closed']);
  });

  it("ends the run when the lease ends it, and records the notice on the leg (F4)", async () => {
    let endLease!: (notice: RunNotice) => void;
    const provider = withHooks({
      acquire: async (_shape, _s, ctx) => {
        endLease = ctx.end;
        return { credentials: () => ({}), release: async () => {} };
      },
    });
    const { runner } = setup(provider);
    await runner.start();
    endLease({ code: 'balance_exhausted', message: 'balance exhausted' });
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'balance_exhausted', message: 'balance exhausted' } } });
    expect(runner.conversation.snapshot()[0].notices).toEqual([
      expect.objectContaining({ severity: 'error', code: 'balance_exhausted', message: 'balance exhausted' }),
    ]);
  });

  it('releases a lease that arrives after the start was cancelled', async () => {
    let grant!: () => void;
    const release = vi.fn(async () => {});
    const provider = withHooks({
      acquire: () => new Promise((resolve) => { grant = () => resolve({ credentials: () => ({}), release }); }),
    });
    const { runner } = setup(provider);
    const starting = runner.start();
    await flush();
    // `close()` now waits (bounded) for the still-pending `acquire()` before it
    // unwinds (F3), so `grant()` must run before `stop()` is awaited, or the
    // wait would need the timeout instead of settling on its own.
    const stopping = runner.stop();
    grant();
    await stopping;
    await starting;
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases once a lease that arrives after pagehide abandoned the start', async () => {
    let grant!: () => void;
    const release = vi.fn(async () => {});
    const provider = withHooks({
      acquire: () => new Promise((resolve) => { grant = () => resolve({ credentials: () => ({}), release }); }),
    });
    const { runner } = setup(provider);
    const starting = runner.start();
    await flush();
    runner.abandon();
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(release).not.toHaveBeenCalled();
    grant();
    await starting;
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("starts a live lease's release before abandon() returns: pagehide's session-end goes out before the page can go", async () => {
    const release = vi.fn(async () => {});
    const provider = withHooks({ acquire: async () => ({ credentials: () => ({}), release }) });
    const { runner } = setup(provider);
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    runner.abandon();
    expect(release).toHaveBeenCalledTimes(1);
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("hands acquire the run's clock", async () => {
    let seen: unknown;
    const provider = withHooks({
      acquire: async (_s, _v, ctx) => {
        seen = ctx.clock;
        return { credentials: () => ({}), release: async () => {} };
      },
    });
    const { runner, clock } = setup(provider);
    await runner.start();
    expect(seen).toBe(clock);
  });
});

describe('runner — startBoth (D23)', () => {
  it('hands both legs to startBoth at once, each on its own source', async () => {
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => ({
      speaker: await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker),
      participant: await fakeProvider.start(requests.participant as StartRequest<never, never>, events.participant),
    }));
    const { runner, sources, clock } = setup(withHooks({ startBoth }), ['speaker', 'participant']);
    await runner.start();
    expect(startBoth).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(2);
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
    clock.advance(600);
    expect(runner.conversation.snapshot().map((l) => l.segments.length)).toEqual([1, 1]);
  });

  it('opens a single leg the ordinary way', async () => {
    const startBoth = vi.fn();
    const { runner } = setup(withHooks({ startBoth }));
    await runner.start();
    expect(startBoth).not.toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
  });

  it("names the leg startBoth says failed, with that leg's own code", async () => {
    const startBoth = vi.fn(async () => {
      throw new LegStartError('participant', new AdapterStartError('no loopback', 'network', { detail: 'denied' }));
    });
    const { runner } = setup(withHooks({ startBoth }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({
      phase: 'idle',
      lastEnd: { reason: 'start-failed', notice: { code: 'network', leg: 'participant', params: { detail: 'denied' } } },
    });
  });

  it("a startBoth failure that names no leg is the first leg's, as before", async () => {
    const startBoth = vi.fn(async () => {
      throw new Error('boom');
    });
    const { runner } = setup(withHooks({ startBoth }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({
      phase: 'idle',
      lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', leg: 'speaker' } },
    });
  });

  it("hands startBoth each leg's own request, with no track in either (Stage 2 Palabra, ruling 16)", async () => {
    const clock = createVirtualClock(0);
    let requestsSeen!: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>;
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => {
      requestsSeen = requests;
      return {
        speaker: await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker),
        participant: await fakeProvider.start(requests.participant as StartRequest<never, never>, events.participant),
      };
    });
    const { runner } = setup(
      withHooks({ startBoth }),
      ['speaker', 'participant'],
      // Captures that still carry their device tracks: nothing reads them.
      (leg) => Object.assign(createFakeSource(clock), { track: { id: `${leg}-track` } as unknown as MediaStreamTrack }),
    );
    await runner.start();
    expect(requestsSeen.speaker.context.direction).not.toEqual(requestsSeen.participant.context.direction);
    for (const leg of ['speaker', 'participant'] as const) expect(requestsSeen[leg]).not.toHaveProperty('input');
  });

  // Split Both opens two sockets; the faster one can hear the server before
  // the slower one has opened. Its `reconnecting` must still stand once
  // startBoth settles: the leg becomes live on its own `reconnected`.
  it('a leg that reports reconnecting before startBoth settles is shown reconnecting, then live on its reconnected', async () => {
    let fast!: AdapterEvents;
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => {
      const speaker = await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker);
      fast = events.speaker;
      fast.reconnecting();
      const participant = await fakeProvider.start(requests.participant as StartRequest<never, never>, events.participant);
      return { speaker, participant };
    });
    const { runner } = setup(withHooks({ startBoth }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'reconnecting', participant: 'live' } });
    fast.reconnected();
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
  });

  it("a leg that fails before startBoth settles ends the run once: its own notice and api_error, no start failure", async () => {
    const track = vi.fn();
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => {
      const speaker = await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker);
      // The fast leg's server refuses the key while the slow leg still opens.
      events.speaker.failed({ code: 'auth', message: '[Soniox 401] Invalid API key' });
      const signal = requests.participant.signal;
      try {
        // The slow leg's open hears the run's abort and rejects with it, as Soniox's core does.
        await new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      } catch (error) {
        // Split Both stops the leg that did start, and blames no leg for an abort.
        await speaker.stop();
        throw error;
      }
      throw new Error('unreachable');
    });
    const { runner } = setup(withHooks({ startBoth }), ['speaker', 'participant'], undefined, track);
    await runner.start();
    await flush();
    expect(runner.state.getState()).toMatchObject({
      phase: 'idle',
      lastEnd: { reason: 'leg-failed', notice: { code: 'auth', leg: 'speaker' } },
    });
    const [speakerLeg, participantLeg] = runner.conversation.snapshot();
    expect(speakerLeg.notices).toEqual([expect.objectContaining({ severity: 'error', code: 'auth' })]);
    expect(participantLeg.notices).toEqual([]);
    const events = track.mock.calls.map(([event]) => event);
    expect(events.filter((e) => e === 'api_error')).toHaveLength(1);
    expect(track).toHaveBeenCalledWith('api_error', expect.objectContaining({ error_code: 'auth', channel: 'speaker' }));
    expect(events).not.toContain('error_occurred');
  });
});

describe('runner — a lease after the sources (Stage 2 Kizuna Soniox, rulings 7, 8, 9)', () => {
  const lease = () => ({ credentials: () => ({}), release: async () => {} });

  it('opens every source, then acquires the lease, then starts the adapters', async () => {
    const order: string[] = [];
    const clock = createVirtualClock(0);
    const provider = withHooks(
      { acquire: async () => { order.push('acquire'); return lease(); } },
      {
        async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
          order.push('start');
          return fakeProvider.start(request as StartRequest<never, never>, events);
        },
      },
    );
    const { runner } = setup(provider, ['speaker', 'participant'], (leg) => { order.push(`source ${leg}`); return createFakeSource(clock); });
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    expect(order).toEqual(['source speaker', 'source participant', 'acquire', 'start', 'start']);
  });

  it('a source that fails mints no lease: the start fails naming its leg, and reaches api_error on that leg with no code', async () => {
    const acquire = vi.fn(async () => lease());
    const track = vi.fn();
    const { runner } = setup(withHooks({ acquire }), ['speaker', 'participant'], (leg) => {
      if (leg === 'participant') throw new Error('LOOPBACK_DENIED');
      return createFakeSource(createVirtualClock(0));
    }, track);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', leg: 'participant' } } });
    expect(acquire).not.toHaveBeenCalled();
    const apiErrors = track.mock.calls.filter(([event]) => event === 'api_error').map(([, props]) => props);
    expect(apiErrors).toEqual([expect.objectContaining({ provider: 'fake', error_type: 'server', channel: 'participant' })]);
    expect(apiErrors[0]).not.toHaveProperty('error_code');
  });

  it('a refused lease fails the start with its code, starts no adapter, and leaves the last conversation on screen', async () => {
    let refuse = false;
    const start = vi.fn((request: StartRequest<unknown, unknown>, events: AdapterEvents) => fakeProvider.start(request as StartRequest<never, never>, events));
    const provider = withHooks(
      { acquire: async () => { if (refuse) throw new AdapterStartError('no balance', 'insufficient_balance'); return lease(); } },
      { start },
    );
    const track = vi.fn();
    const { runner, clock } = setup(provider, ['speaker'], undefined, track);
    await runner.start();
    clock.advance(600);
    await runner.stop();
    const before = runner.conversation.snapshot();
    expect(before[0].segments.length).toBeGreaterThan(0);

    refuse = true;
    start.mockClear();
    track.mockClear();
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'insufficient_balance', message: 'no balance' } } });
    expect(start).not.toHaveBeenCalled();
    expect(runner.conversation.snapshot()).toEqual(before);
    // Ruling 8: a refused lease reaches api_error beside error_occurred, as the old onConnectFailed tracked every connect failure.
    expect(track).toHaveBeenCalledWith('error_occurred', expect.objectContaining({ error_type: 'session_start', provider: 'fake' }));
    expect(track).toHaveBeenCalledWith('api_error', { provider: 'fake', error_message: 'no balance', error_code: 'insufficient_balance', error_type: 'server', channel: 'speaker' });
  });

  it("files a lease's frames under the first leg", async () => {
    const frames: FramePort = { frame: vi.fn() };
    const frame = { direction: 'in' as const, type: 'session.lease_acquired', payload: { roles: ['mix_stt'] } };
    const provider = withHooks({ acquire: async (_shape, _s, ctx) => { ctx.frame(frame); return lease(); } });
    const { runner } = setup(provider, ['speaker', 'participant'], undefined, undefined, frames);
    await runner.start();
    expect(frames.frame).toHaveBeenCalledWith('speaker', frame);
  });

  it("a lease's end is each leg's session.stopped, after the lease's own release frame (Stage 2 session end, ruling 2 (i))", async () => {
    let endLease!: (notice: RunNotice) => void;
    const seen: Array<[string, string, unknown]> = [];
    const provider = withHooks({
      acquire: async (_shape, _s, ctx) => {
        endLease = ctx.end;
        return { credentials: () => ({}), release: async () => { ctx.frame({ direction: 'out', type: 'session.end' }); } };
      },
    });
    const { runner, clock } = setup(provider, ['speaker', 'participant'], undefined, undefined, { frame: (leg, f) => { seen.push([leg, f.type, f.payload]); } });
    await runner.start();
    clock.advance(30_000);
    endLease({ code: 'budget_exhausted', message: 'Session budget exhausted' });
    await flush();
    expect(seen).toEqual([
      ['speaker', 'session.end', undefined],
      ['speaker', 'session.stopped', { reason: 'lease-ended', code: 'budget_exhausted', state: 'live', elapsedMs: 30_000 }],
      ['participant', 'session.stopped', { reason: 'lease-ended', code: 'budget_exhausted', state: 'live', elapsedMs: 30_000 }],
    ]);
  });

  it("puts a lease's budget in the running state, and keeps it through a leg's change", async () => {
    let events!: AdapterEvents;
    const provider = withHooks(
      { acquire: async () => ({ ...lease(), budget: { totalMs: 60_000, endsAt: 60_000 } }) },
      {
        async start(request: StartRequest<unknown, unknown>, e: AdapterEvents) {
          events = e;
          return fakeProvider.start(request as StartRequest<never, never>, e);
        },
      },
    );
    const { runner } = setup(provider);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'running', budget: { totalMs: 60_000, endsAt: 60_000 } });
    events.reconnecting();
    expect(runner.state.getState()).toMatchObject({ legs: { speaker: 'reconnecting' }, budget: { totalMs: 60_000, endsAt: 60_000 } });
  });

  it('a run with no lease has no budget', async () => {
    const { runner } = setup(fakeProvider);
    await runner.start();
    expect(runner.state.getState()).not.toHaveProperty('budget');
  });

  it("records a lease's end once, on the first leg, when both legs run (ruling 7), and tracks it once as api_error (ruling 8)", async () => {
    let endLease!: (notice: RunNotice, o?: { expected?: boolean }) => void;
    const provider = withHooks({ acquire: async (_shape, _s, ctx) => { endLease = ctx.end; return lease(); } });
    const track = vi.fn();
    const { runner } = setup(provider, ['speaker', 'participant'], undefined, track);
    await runner.start();
    endLease({ code: 'budget_exhausted', message: 'Session budget exhausted' });
    await flush();
    const [speaker, participant] = runner.conversation.snapshot();
    expect(speaker.notices).toEqual([expect.objectContaining({ severity: 'error', code: 'budget_exhausted' })]);
    expect(participant.notices).toEqual([]);
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } });
    // The old client's props (`ManagedSonioxSession.ts:166-173`): the code, a stable English message, the leg that announced it.
    expect(track.mock.calls.filter(([event]) => event === 'api_error')).toEqual([
      ['api_error', { provider: 'fake', error_message: 'Session budget exhausted', error_code: 'budget_exhausted', error_type: 'server', channel: 'speaker' }],
    ]);
  });

  it('an expected lease end — the normal end of a managed segment — tracks no api_error', async () => {
    let endLease!: (notice: RunNotice, o?: { expected?: boolean }) => void;
    const provider = withHooks({ acquire: async (_shape, _s, ctx) => { endLease = ctx.end; return lease(); } });
    const track = vi.fn();
    const { runner } = setup(provider, ['speaker'], undefined, track);
    await runner.start();
    endLease({ code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, { expected: true });
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'segment_ended' } } });
    expect(track.mock.calls.map(([event]) => event)).not.toContain('api_error');
  });

  it("tracks every adapter degradation as api_error — its reason as the code, else its code — once per leg and code in L1's window (ruling 8)", async () => {
    let events!: AdapterEvents;
    const provider = withHooks({}, {
      async start(request: StartRequest<unknown, unknown>, e: AdapterEvents) {
        events = e;
        return fakeProvider.start(request as StartRequest<never, never>, e);
      },
    });
    const track = vi.fn();
    const { runner, clock } = setup(provider, ['speaker'], undefined, track);
    await runner.start();
    const apiErrors = () => track.mock.calls.filter(([event]) => event === 'api_error').map(([, props]) => props);
    events.degraded({ code: 'tts_stopped', message: 'Soniox TTS 408: Request timeout', reason: 'tts_408' });
    expect(apiErrors()).toEqual([{ provider: 'fake', error_message: 'Soniox TTS 408: Request timeout', error_code: 'tts_408', error_type: 'server', channel: 'speaker' }]);
    // The same code inside L1's window is the same episode to the user: not tracked again.
    events.degraded({ code: 'tts_stopped', message: 'Soniox TTS 400: Invalid voice', reason: 'tts_400' });
    expect(apiErrors()).toHaveLength(1);
    clock.advance(DEGRADED_DEDUPE_MS);
    events.degraded({ code: 'tts_stopped', message: 'Soniox TTS 400: Invalid voice', reason: 'tts_400' });
    expect(apiErrors()).toHaveLength(2);
    // No reason: the code is the analytics code (LocalInference's, the adapter's own `tts_degraded`).
    events.degraded({ code: 'tts_degraded', message: 'No TTS key was issued for this leg: it runs text-only.' });
    expect(apiErrors()[2]).toEqual({ provider: 'fake', error_message: 'No TTS key was issued for this leg: it runs text-only.', error_code: 'tts_degraded', error_type: 'server', channel: 'speaker' });
  });

  it("keys the degradation window per leg, as L1's is: the same code on the other leg is its own episode", async () => {
    const events: Partial<Record<LegName, AdapterEvents>> = {};
    const provider = withHooks({}, {
      async start(request: StartRequest<unknown, unknown>, e: AdapterEvents) {
        events[request.context.direction.source === 'en' ? 'speaker' : 'participant'] = e;
        return fakeProvider.start(request as StartRequest<never, never>, e);
      },
    });
    const track = vi.fn();
    const { runner } = setup(provider, ['speaker', 'participant'], undefined, track);
    await runner.start();
    const apiErrors = () => track.mock.calls.filter(([event]) => event === 'api_error').map(([, props]) => props);
    events.speaker!.degraded({ code: 'tts_stopped', message: 'Soniox TTS 408: Request timeout', reason: 'tts_408' });
    events.participant!.degraded({ code: 'tts_stopped', message: 'Soniox TTS 408: Request timeout', reason: 'tts_408' });
    expect(apiErrors()).toEqual([
      expect.objectContaining({ error_code: 'tts_408', channel: 'speaker' }),
      expect.objectContaining({ error_code: 'tts_408', channel: 'participant' }),
    ]);
    events.participant!.degraded({ code: 'tts_stopped', message: 'Soniox TTS 400: Invalid voice', reason: 'tts_400' });
    expect(apiErrors()).toHaveLength(2);
  });

  // The lease's release slot is reserved beneath the sources, so a lease run
  // unwinds its sessions, then its sources — the microphone, the system audio,
  // the tab — and only then the lease (spec: "released after they have
  // closed"): no capture stays open while `session-end` goes out.
  /** A lease run whose sessions, sources and lease record their release, in order; `failing` names a leg whose adapter refuses to start. */
  function recordingUnwind(legs: RunShape['legs'], o: { together?: boolean; failing?: LegName } = {}) {
    const order: string[] = [];
    const start = async (request: StartRequest<unknown, unknown>, events: AdapterEvents): Promise<AdapterSession> => {
      const leg: LegName = request.context.direction.source === 'en' ? 'speaker' : 'participant';
      if (leg === o.failing) throw new Error(`The ${leg} adapter refused to start.`);
      const inner = await fakeProvider.start(request as StartRequest<never, never>, events);
      return {
        info: inner.info, appendAudio: () => {}, appendText: () => {}, beginTurn: () => {}, endTurn: () => {}, cancelTurn: () => {},
        stop: async () => { order.push(`${leg} session`); await inner.stop(); },
      };
    };
    const provider = withHooks(
      {
        acquire: async () => ({ credentials: () => ({}), release: async () => { order.push('lease'); } }),
        ...(o.together ? {
          startBoth: async (requests: Record<LegName, StartRequest<unknown, unknown>>, events: Record<LegName, AdapterEvents>) => ({
            speaker: await start(requests.speaker, events.speaker),
            participant: await start(requests.participant, events.participant),
          }),
        } : {}),
      },
      { start },
    );
    const { runner } = setup(provider, legs, (leg) => {
      const source = createFakeSource(createVirtualClock(0));
      return { ...source, stop: async () => { order.push(`${leg} source`); await source.stop(); } };
    });
    /** Each release's kind, in order: `session`, `source` or `lease`. */
    const kinds = () => order.map((entry) => entry.split(' ').pop());
    return { runner, order, kinds };
  }

  it.each([
    ['one leg', ['speaker'] as const, false, ['session', 'source', 'lease']],
    ['both legs, each opened alone', ['speaker', 'participant'] as const, false, ['session', 'session', 'source', 'source', 'lease']],
    ['both legs through startBoth', ['speaker', 'participant'] as const, true, ['session', 'session', 'source', 'source', 'lease']],
  ])('on Stop, a lease run (%s) closes its sessions, then its sources, then releases the lease', async (_name, legs, together, expected) => {
    const { runner, kinds } = recordingUnwind(legs, { together });
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    await runner.stop();
    expect(kinds()).toEqual(expected);
  });

  it('a start that fails after acquire unwinds the same way: the session that opened, then the sources, then the lease', async () => {
    const { runner, order, kinds } = recordingUnwind(['speaker', 'participant'], { failing: 'participant' });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { leg: 'participant' } } });
    expect(order[0]).toBe('speaker session');
    expect(kinds()).toEqual(['session', 'source', 'source', 'lease']);
  });

  it("releases at once a lease granted after the run unwound past open's bound", async () => {
    let grant!: () => void;
    const release = vi.fn(async () => {});
    const provider = withHooks({
      acquire: () => new Promise((resolve) => { grant = () => resolve({ credentials: () => ({}), release }); }),
    });
    const { runner, clock } = setup(provider);
    const starting = runner.start();
    await flush();
    const stopping = runner.stop();
    await flush();
    // `close()` waits for `open()` only up to `timeoutMs`, then unwinds without the lease.
    clock.advance(1000);
    await stopping;
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(release).not.toHaveBeenCalled();
    grant();
    await starting;
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  // Choice 3: only a lease or `startBoth` moves the hand-over after the
  // sources. These pin both sides of that line by the one thing it
  // changes a user can see — whether a failing source clears the screen.
  /** Runs both legs once and stops, then starts again with the participant's source failing; answers the conversation before and after. */
  async function failingRestart(provider: AnyProvider) {
    let failing = false;
    let runClock!: ReturnType<typeof createVirtualClock>;
    const { runner, clock } = setup(provider, ['speaker', 'participant'], (leg) => {
      if (failing && leg === 'participant') throw new Error('LOOPBACK_DENIED');
      return createFakeSource(runClock);
    });
    runClock = clock;
    await runner.start();
    clock.advance(600);
    await runner.stop();
    const before = runner.conversation.snapshot();
    expect(before[0].segments.length).toBeGreaterThan(0);
    failing = true;
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { leg: 'participant' } } });
    return { before, after: runner.conversation.snapshot() };
  }

  it.each([
    ['the fake (no hooks)', fakeProvider],
    ["an admit-only provider (LocalInference's hooks)", withHooks({ admit: () => true })],
  ])('%s hands its legs over before its sources, as before: a failing source replaces the last conversation', async (_name, provider) => {
    const { after } = await failingRestart(provider);
    expect(after[0].segments).toEqual([]);
  });

  it("a startBoth provider keeps the last conversation when a source fails (choice 3's stated departure)", async () => {
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => ({
      speaker: await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker),
      participant: await fakeProvider.start(requests.participant as StartRequest<never, never>, events.participant),
    }));
    const { before, after } = await failingRestart(withHooks({ startBoth }));
    expect(after).toEqual(before);
    // The first run's call only: the restart's failing source stopped it before `startBoth`.
    expect(startBoth).toHaveBeenCalledTimes(1);
  });
});
