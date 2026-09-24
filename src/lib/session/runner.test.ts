import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, StartRequest } from '../contract/adapter';
import type { Leg } from '../conversation/types';
import type { Punctuator } from '../conversation/fillIn';
import type { AnyProvider, Readiness } from '../provider/types';
import { createVirtualClock } from '../contract/clock';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS, type FakeSettings } from '../../providers/fake/settings';
import { RUN_NOTICE_CODES } from './codes';
import type { OpenSource, Source } from './source';
import type { FramePort, PlaybackPort } from './ports';
import { createRunner } from './runner';
import type { RunEnd, RunNotice, RunShape } from './types';

// A bare spy: `describeCause`/`reportWarning` stay real (many assertions below
// read a message `describeCause` built), only `reportError` is observable —
// F6's "a start that fails is recorded with its cause" test needs to see it.
const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Options {
  shape?: Partial<RunShape>;
  settings?: Partial<FakeSettings>;
  openSource?: OpenSource;
  ready?: Readiness;
  ensureReady?: () => Promise<Readiness>;
  onRunEnded?: (legs: readonly Leg[]) => void;
  punctuate?: Punctuator;
  playback?: Partial<PlaybackPort>;
  /** Runs alongside the normal tracking; throwing here exercises a throwing analytics port. */
  track?: (event: string, properties: unknown) => void;
  frames?: FramePort;
}

function setup(o: Options = {}) {
  const clock = createVirtualClock(0);
  const sources: FakeSource[] = [];
  // `Object.assign`, not a spread, so `playback`'s declared type stays the
  // plain mock shape below (with `.mockClear()` etc.) instead of widening to
  // a union with `Partial<PlaybackPort>`'s plain function types.
  const playback = { audio: vi.fn(), held: vi.fn(), clear: vi.fn() };
  Object.assign(playback, o.playback);
  const tracked: Array<[string, unknown]> = [];
  const shape: RunShape = {
    provider: fakeProvider as AnyProvider,
    settings: { ...FAKE_DEFAULTS, ...o.settings },
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs: ['speaker'],
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } },
    auth: { signedIn: false, getToken: async () => null },
    ...o.shape,
  };
  let runs = 0;
  const persistIfUnchanged = vi.fn();
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: o.ensureReady ?? (async () => o.ready ?? { state: 'ready', models: [] }),
    persistIfUnchanged,
    openSource: o.openSource ?? (async () => {
      const source = createFakeSource(clock);
      sources.push(source);
      return source;
    }),
    playback,
    analytics: { track: (event, properties) => { o.track?.(event, properties); tracked.push([event, properties]); } },
    frames: o.frames,
    punctuate: o.punctuate,
    newSessionId: () => `run${++runs}`,
    onRunEnded: o.onRunEnded,
    timeoutMs: 1000,
  });
  const events = (name: string) => tracked.filter(([e]) => e === name).map(([, p]) => p);
  return { clock, runner, sources, playback, events, shape, persistIfUnchanged };
}

describe('runner — starting', () => {
  it('starts every leg it was asked for, goes running, and folds the script into the conversation', async () => {
    const { runner, clock, events } = setup({ shape: { legs: ['speaker', 'participant'] } });
    await runner.start();
    expect(runner.state.getState()).toEqual({ phase: 'running', since: 0, legs: { speaker: 'live', participant: 'live' } });
    clock.advance(600);
    const legs = runner.conversation.snapshot();
    expect(legs.map((l) => l.leg)).toEqual(['speaker', 'participant']);
    expect(legs[0].segments[0]).toMatchObject({ side: 'source', text: 'Hello' });
    expect(legs[1].languages).toEqual({ source: 'ja', target: 'en' });
    expect(events('translation_session_start')).toEqual([expect.objectContaining({
      session_id: 'run1', provider: 'fake', source_language: 'en', target_language: 'ja',
      channels: ['speaker', 'participant'], transport: 'fake', platform: 'electron', translation_model: 'fake',
    })]);
    expect(events('session_control_clicked')).toEqual([{ action: 'start', method: 'button' }]);
  });

  it('hands playback every piece of translated audio, attributed to its segment', async () => {
    const { runner, clock, playback } = setup();
    await runner.start();
    clock.advance(5000);
    // The first exchange's translation (ref 2) speaks in three chunks.
    expect(playback.audio.mock.calls.filter(([leg, ref]) => leg === 'speaker' && ref === 2)).toHaveLength(3);
  });

  it('refuses a start the build refuses, opening nothing', async () => {
    const { runner, sources, events } = setup({ settings: { buildRefused: true } });
    await runner.start();
    expect(runner.state.getState()).toEqual({
      phase: 'idle',
      lastEnd: { reason: 'refused', notice: { code: 'fake_build_refused', message: 'The fake refuses to build (fault knob).', params: { knob: 'buildRefused' }, leg: 'speaker' } },
    });
    expect(sources).toHaveLength(0);
    expect(events('translation_session_start')).toEqual([]);
    expect(events('error_occurred')).toEqual([]);
  });

  it('refuses the participant leg of an auto source before checking anything (D20)', async () => {
    const { runner } = setup({ shape: { legs: ['speaker', 'participant'], pair: { source: 'auto', target: 'en' } } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'participant_unsupported' } } });
  });

  it('refuses a provider that is not ready, with its reason', async () => {
    const { runner } = setup({ ready: { state: 'not-ready', reason: 'model not downloaded' } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'not_ready', message: 'model not downloaded' } } });
  });

  it('refuses when the credentials the settings ask for are missing', async () => {
    const { runner } = setup({ settings: { requireKey: true } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'credentials_missing' } } });
  });

  it("names the runner's own refusals in snake_case", async () => {
    const { runner } = setup({ ready: { state: 'not-ready', reason: 'model not downloaded' } });
    await runner.start();
    expect(RUN_NOTICE_CODES).toContain((runner.state.getState() as { lastEnd?: RunEnd }).lastEnd?.notice?.code);
  });

  it("hands every frame an adapter reports to the frames port, with its leg", async () => {
    const frames: Array<[string, unknown]> = [];
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
        const session = await fakeProvider.start(request as never, events);
        events.frame({ direction: 'in', type: 'fake.hello', payload: { n: 1 } });
        return session;
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider }, frames: { frame: (leg, frame) => frames.push([leg, frame]) } });
    await runner.start();
    expect(frames).toEqual([['speaker', { direction: 'in', type: 'fake.hello', payload: { n: 1 } }]]);
  });

  it('keeps a throwing frames port away from the adapter', async () => {
    reportErrorSpy.mockClear();
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
        const session = await fakeProvider.start(request as never, events);
        events.frame({ direction: 'out', type: 'fake.one' });
        events.frame({ direction: 'out', type: 'fake.two' });
        return session;
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider }, frames: { frame: () => { throw new Error('sink gone'); } } });
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    // One report per failing streak, not one per frame.
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('frames.frame'))).toHaveLength(1);
  });

  it("fails the start when one leg's source will not open, and closes the leg that did (D22)", async () => {
    const clock = createVirtualClock(0);
    const opened: FakeSource[] = [];
    const { runner, events } = setup({
      shape: { legs: ['speaker', 'participant'] },
      openSource: async (leg) => {
        if (leg === 'participant') throw new Error('permission denied');
        const source = createFakeSource(clock);
        opened.push(source);
        return source;
      },
    });
    await runner.start();
    await flush();
    expect(runner.state.getState()).toEqual({
      phase: 'idle',
      lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'permission denied', leg: 'participant' } },
    });
    expect(opened).toHaveLength(1);
    expect(opened.every((s) => s.stopped)).toBe(true);
    expect(events('error_occurred')).toEqual([expect.objectContaining({ error_message: 'permission denied', provider: 'fake' })]);
  });

  it('fails the start when the adapter throws, and closes the source it opened', async () => {
    const { runner, sources } = setup({ settings: { startThrows: true } });
    await runner.start();
    await flush();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'start-failed', notice: { message: 'The fake failed to start (fault knob).', leg: 'speaker' } } });
    expect(sources).toHaveLength(1);
    expect(sources[0].stopped).toBe(true);
  });

  it('fails the start when a source ends while its leg is still opening (D22)', async () => {
    const { runner, clock, sources, events } = setup({ settings: { startDelayMs: 2000 } });
    const starting = runner.start();
    await flush();
    sources[0].end('unplugged');
    await starting;
    await flush();
    expect(runner.state.getState()).toMatchObject({
      phase: 'idle',
      lastEnd: { reason: 'source-ended', notice: { code: 'source_ended', leg: 'speaker' } },
    });
    expect(events('translation_session_start')).toEqual([]);
    expect(sources.every((s) => s.stopped)).toBe(true);
    clock.advance(10_000);
  });

  it('a startBoth provider whose participant source will not open fails the start naming the leg', async () => {
    const sourceClock = createVirtualClock(0);
    const startBoth = vi.fn();
    const provider = { ...fakeProvider, session: { startBoth } } as unknown as AnyProvider;
    const { runner } = setup({
      shape: { legs: ['speaker', 'participant'], provider },
      openSource: async (leg) => {
        if (leg === 'participant') throw new Error('permission denied');
        return createFakeSource(sourceClock);
      },
    });
    await runner.start();
    expect(runner.state.getState()).toEqual({
      phase: 'idle',
      lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'permission denied', leg: 'participant' } },
    });
    expect(startBoth).not.toHaveBeenCalled();
  });
});

describe('runner — stopping', () => {
  it('a stop during a slow start cancels it: nothing stays open, nothing plays', async () => {
    const { runner, clock, sources, playback, events } = setup({ settings: { startDelayMs: 2000 } });
    const starting = runner.start();
    await flush();
    expect(runner.state.getState()).toEqual({ phase: 'starting', step: 'opening' });
    await runner.stop();
    await starting;
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(sources.every((s) => s.stopped)).toBe(true);
    clock.advance(10_000);
    expect(playback.audio).not.toHaveBeenCalled();
    expect(events('session_control_clicked')).toEqual([{ action: 'start', method: 'button' }, { action: 'cancel', method: 'button' }]);
    expect(events('translation_session_start')).toEqual([]);
  });

  it('stop is idempotent: every call returns the same promise', async () => {
    const { runner, events } = setup();
    await runner.start();
    const a = runner.stop();
    const b = runner.stop('keyboard');
    expect(a).toBe(b);
    await a;
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(events('session_control_clicked')).toEqual([{ action: 'start', method: 'button' }, { action: 'stop', method: 'button' }]);
  });

  it('a start while stopping does nothing', async () => {
    const { runner, sources } = setup();
    await runner.start();
    const stopping = runner.stop();
    await runner.start();
    await stopping;
    expect(sources).toHaveLength(1);
  });

  it('finalizes open segments, reports the end, and hands the final legs to onRunEnded', async () => {
    const onRunEnded = vi.fn();
    const { runner, clock, events } = setup({ onRunEnded });
    await runner.start();
    clock.advance(600);
    await runner.stop();
    const legs = runner.conversation.snapshot();
    expect(legs[0].segments[0].final).toBe(true);
    expect(onRunEnded).toHaveBeenCalledWith(legs);
    expect(events('translation_session_end')).toEqual([{ session_id: 'run1', duration: 600, provider: 'fake' }]);
    expect(events('connection_status')).toEqual([
      { status: 'connected', provider: 'fake' },
      { status: 'disconnected', provider: 'fake', duration_ms: 600 },
    ]);
  });

  it('reports no session end and calls no onRunEnded after a refused start', async () => {
    const onRunEnded = vi.fn();
    const { runner, events } = setup({ onRunEnded, settings: { buildRefused: true } });
    await runner.start();
    expect(onRunEnded).not.toHaveBeenCalled();
    expect(events('translation_session_end')).toEqual([]);
  });

  it('a subscriber that stops the run while it is stopping gets the same promise, and the run ends once', async () => {
    const onRunEnded = vi.fn();
    const { runner, events } = setup({ onRunEnded });
    const inner: Promise<void>[] = [];
    runner.state.subscribe((s) => {
      if (s.phase === 'stopping' && inner.length === 0) inner.push(runner.stop());
    });
    await runner.start();
    const a = runner.stop();
    await a;
    expect(inner[0]).toBe(a);
    expect(onRunEnded).toHaveBeenCalledTimes(1);
    expect(events('translation_session_end')).toHaveLength(1);
  });

  it('a lease that ends the run from its abort listener does not end it twice', async () => {
    const provider = {
      ...fakeProvider,
      session: {
        acquire: async (_shape: RunShape, _s: unknown, ctx: { signal: AbortSignal; end(notice: RunNotice): void }) => {
          ctx.signal.addEventListener('abort', () => ctx.end({ code: 'lease_cut', message: 'lease cut' }));
          return { credentials: () => ({}), release: async () => {} };
        },
      },
    } as unknown as AnyProvider;
    const { runner, events } = setup({ shape: { provider } });
    await runner.start();
    await runner.stop();
    expect(events('translation_session_end')).toHaveLength(1);
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'user' } });
  });

  it('stop clears playback before the legs finish closing', async () => {
    const provider = {
      ...fakeProvider,
      start: async (request: any, events: any) => {
        const session = await fakeProvider.start(request, events);
        // Spreading a `FakeSession` instance would drop its prototype
        // methods (only `info` is an own property); delegate explicitly so
        // every call still reaches the real session, only `stop` hangs.
        return {
          info: session.info,
          appendAudio: (pcm: Int16Array) => session.appendAudio(pcm),
          appendText: (text: string) => session.appendText(text),
          beginTurn: () => session.beginTurn(),
          endTurn: () => session.endTurn(),
          cancelTurn: () => session.cancelTurn(),
          stop: () => new Promise<void>(() => {}),
        };
      },
    } as unknown as AnyProvider;
    const { runner, clock, playback } = setup({ shape: { provider } });
    await runner.start();
    const stopping = runner.stop();
    await flush();
    expect(playback.clear).toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('stopping');
    clock.advance(1000);
    await stopping;
    expect(runner.state.getState().phase).toBe('idle');
  });

  it('a playback port that throws still returns the runner to idle, and it starts again', async () => {
    const { runner, clock, sources, playback } = setup({ playback: { clear: vi.fn(() => { throw new Error('playback clear failed'); }) } });
    await runner.start();
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    // A throwing port must not skip `run.close()`: the first run's source
    // and adapter session must still be stopped, or the run keeps streaming
    // and playing behind the runner's back.
    expect(sources).toHaveLength(1);
    expect(sources.every((s) => s.stopped)).toBe(true);
    playback.audio.mockClear();
    clock.advance(20_000);
    expect(playback.audio).not.toHaveBeenCalled();
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
  });

  it('a subscriber that throws when the phase becomes idle still resolves stop()', async () => {
    const { runner } = setup();
    runner.state.subscribe((s) => {
      if (s.phase === 'idle') throw new Error('subscriber boom');
    });
    await runner.start();
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
  });

  it('a subscriber that throws when the phase becomes stopping cannot keep the run open', async () => {
    const { runner, clock, sources, playback } = setup();
    runner.state.subscribe((s) => {
      if (s.phase === 'stopping') throw new Error('subscriber boom');
    });
    await runner.start();
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    expect(sources).toHaveLength(1);
    expect(sources.every((s) => s.stopped)).toBe(true);
    playback.audio.mockClear();
    clock.advance(20_000);
    expect(playback.audio).not.toHaveBeenCalled();
  });

  it('an onRunEnded that hangs does not keep the runner stopping', async () => {
    const { runner, clock } = setup({ onRunEnded: () => new Promise<void>(() => {}) });
    await runner.start();
    const stopping = runner.stop();
    await flush();
    clock.advance(1000);
    await stopping;
    expect(runner.state.getState().phase).toBe('idle');
  });

  it("waits for a leg still opening before it unwinds, so nothing is released after the run went idle", async () => {
    const order: string[] = [];
    let openParticipant!: () => void;
    const quietSource = (leg: string): Source => ({
      onPcm: () => () => {}, onEnded: () => () => {}, onDegraded: () => () => {},
      stop: async () => { order.push(`${leg} source stopped`); },
    });
    const openSource: OpenSource = async (leg) => {
      if (leg === 'participant') await new Promise<void>((resolve) => { openParticipant = resolve; });
      return quietSource(leg);
    };
    const provider = { ...fakeProvider, start: async () => { throw new Error('the speaker leg failed'); } } as unknown as AnyProvider;
    const { runner } = setup({ openSource, shape: { provider, legs: ['speaker', 'participant'] } });
    runner.state.subscribe((s) => { if (s.phase === 'idle') order.push('idle'); });
    const started = runner.start();
    await flush();
    openParticipant();
    await started;
    // The stack is LIFO (`stack.ts`): the speaker source is pushed first (its
    // open settles well before `flush()` returns), the participant source is
    // pushed last (its push waits on `openParticipant()`), so it unwinds
    // first. The property under test is that both precede 'idle', not which
    // of the two comes first.
    expect(order).toEqual(['participant source stopped', 'speaker source stopped', 'idle']);
  });
});

describe('runner — legs end together (D21)', () => {
  it('ends the session when one leg fails, closing every leg', async () => {
    const { runner, clock, sources, events } = setup({ shape: { legs: ['speaker', 'participant'] }, settings: { failAfterMs: 1000 } });
    await runner.start();
    clock.advance(1000);
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'fake failure' } } });
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'error', message: 'fake failure' })]);
    expect(events('api_error')).toHaveLength(1);
    expect(events('api_error')[0]).toMatchObject({ provider: 'fake', error_message: 'fake failure', error_type: 'server' });
  });

  it('ends the session when a source ends, and records why on its leg', async () => {
    const { runner, sources } = setup({ shape: { legs: ['speaker', 'participant'] } });
    await runner.start();
    sources[0].end('unplugged');
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'source-ended', notice: { code: 'source_ended', leg: 'speaker' } } });
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ code: 'source_ended' })]);
    expect(sources[1].stopped).toBe(true);
  });

  it("records a degraded source on its leg with the source's code, throttled, and keeps running", async () => {
    const { runner, sources } = setup();
    await runner.start();
    sources[0].degrade('fell back to system audio', 'app_capture_lost_using_system_audio');
    sources[0].degrade('fell back again', 'app_capture_lost_using_system_audio');
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].notices).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'app_capture_lost_using_system_audio', message: 'fell back to system audio' }),
    ]);
  });
});

describe('runner — capture carry-over', () => {
  /** The fake provider, with every request it starts recorded. */
  function recordingInputs() {
    const inputs: Array<MediaStreamTrack | undefined> = [];
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<never, never>, events: AdapterEvents) {
        inputs.push(request.input);
        return fakeProvider.start(request, events);
      },
    } as unknown as AnyProvider;
    return { inputs, provider };
  }

  it("hands the adapter the source's track, and builds the request once the source has opened", async () => {
    const track = { kind: 'audio' } as MediaStreamTrack;
    const { inputs, provider } = recordingInputs();
    const { runner } = setup({
      shape: { provider },
      openSource: async () => Object.assign(createFakeSource(createVirtualClock(0)), { track }),
    });
    await runner.start();
    expect(inputs).toEqual([track]);
  });

  it('builds a request without input when the source has no track', async () => {
    const { inputs, provider } = recordingInputs();
    const { runner } = setup({ shape: { provider } });
    await runner.start();
    expect(inputs).toEqual([undefined]);
  });

  it('keeps capturing when the adapter throws on audio, and reports it once per failing streak', async () => {
    let appended = 0;
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<never, never>, events: AdapterEvents) {
        const session = await fakeProvider.start(request, events);
        // Spreading a `FakeSession` instance would drop its prototype
        // methods; delegate explicitly, only `appendAudio` throws.
        return {
          info: session.info,
          appendAudio: () => { appended += 1; throw new Error('socket closed'); },
          appendText: (text: string) => session.appendText(text),
          beginTurn: () => session.beginTurn(),
          endTurn: () => session.endTurn(),
          cancelTurn: () => session.cancelTurn(),
          stop: () => session.stop(),
        };
      },
    } as unknown as AnyProvider;
    const { runner, clock } = setup({ shape: { provider } });
    reportErrorSpy.mockClear();
    await runner.start();
    clock.advance(500);
    expect(appended).toBeGreaterThanOrEqual(4);
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('socket closed'))).toHaveLength(1);
  });
});

describe('runner — the conversation', () => {
  it('outlives the run until the next start replaces it', async () => {
    const { runner, clock } = setup();
    await runner.start();
    clock.advance(5000);
    await runner.stop();
    expect(runner.conversation.snapshot()[0].segments.length).toBeGreaterThan(0);
    await runner.start();
    expect(runner.conversation.snapshot()[0].session).toBe('run2');
    expect(runner.conversation.snapshot()[0].segments).toEqual([]);
  });

  it('records the provider and the models its run described on the conversation', async () => {
    const { runner } = setup();
    expect(runner.conversation.info).toBeNull();
    await runner.start();
    // The fake describes every stage as 'fake' (`src/providers/fake/provider.ts`).
    expect(runner.conversation.info).toEqual({ provider: 'fake', models: { asrModel: 'fake', translationModel: 'fake', ttsModel: 'fake' } });
  });

  it('keeps no replay audio when keepReplayAudio is off', async () => {
    const { runner, clock } = setup({ shape: { keepReplayAudio: false } });
    await runner.start();
    clock.advance(5000);
    const speech = runner.conversation.snapshot()[0].segments.flatMap((s) => s.speech);
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.every((s) => s.pcm.length === 0)).toBe(true);
  });

  it('discards events from a run that has ended', async () => {
    let late: ((e: { ref: number; side: 'source' }) => void) | undefined;
    const provider = {
      ...fakeProvider,
      start: async (_request: unknown, events: { segmentOpened(e: { ref: number; side: 'source' }): void }) => {
        late = (e) => events.segmentOpened(e);
        return { appendAudio() {}, appendText() {}, beginTurn() {}, endTurn() {}, cancelTurn() {}, async stop() {}, info: {} };
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider } });
    await runner.start();
    await runner.stop();
    late!({ ref: 9, side: 'source' });
    expect(runner.conversation.snapshot()[0].segments).toEqual([]);
  });

  it('an event arriving while fill-in settles is discarded', async () => {
    let captured: AdapterEvents | undefined;
    const provider = {
      ...fakeProvider,
      start: async (_request: unknown, events: AdapterEvents) => {
        captured = events;
        events.segmentOpened({ ref: 1, side: 'source' });
        events.segmentText({ ref: 1, text: 'no terminal punctuation' });
        events.segmentClosed({ ref: 1 });
        return { appendAudio() {}, appendText() {}, beginTurn() {}, endTurn() {}, cancelTurn() {}, async stop() {}, info: {} };
      },
    } as unknown as AnyProvider;
    const { runner, clock } = setup({ shape: { provider }, punctuate: () => new Promise<string | null>(() => {}) });
    await runner.start();
    const stopping = runner.stop();
    await flush();
    captured!.segmentOpened({ ref: 7, side: 'source' });
    clock.advance(1000);
    await stopping;
    expect(runner.conversation.snapshot()[0].segments.some((s) => s.ref === 7)).toBe(false);
  });
});

describe('runner — guarded ports (F1)', () => {
  it('a playback port that throws on audio does not reach the adapter', async () => {
    const audio = vi.fn(() => { throw new Error('sink gone'); });
    const { runner, clock } = setup({ playback: { audio } });
    await runner.start();
    // The exchange's first translated audio lands at 1300 ms: its block starts
    // at 500, and the translation's audio 800 ms into the block.
    clock.advance(1500);
    expect(audio).toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].segments.map((s) => s.side)).toEqual(['source', 'translation']);
  });

  it('an analytics port that throws neither fails a start nor skips onRunEnded', async () => {
    const onRunEnded = vi.fn();
    const { runner } = setup({ onRunEnded, track: () => { throw new Error('posthog'); } });
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    expect(onRunEnded).toHaveBeenCalledTimes(1);
  });

  it('reports a playback port that keeps throwing on audio once, not once per chunk', async () => {
    const audio = vi.fn(() => { throw new Error('sink gone'); });
    const { runner, clock } = setup({ playback: { audio } });
    reportErrorSpy.mockClear();
    await runner.start();
    clock.advance(10_000);
    expect(audio.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('playback.audio'))).toHaveLength(1);
  });

  it('reports it again once it has recovered and fails anew', async () => {
    let calls = 0;
    const audio = vi.fn(() => {
      calls += 1;
      if (calls === 1 || calls === 3) throw new Error('sink gone');
    });
    const { runner, clock } = setup({ playback: { audio } });
    reportErrorSpy.mockClear();
    await runner.start();
    clock.advance(10_000);
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('playback.audio'))).toHaveLength(2);
  });
});

describe('runner — a refused start', () => {
  it('goes straight back to idle: no stopping phase, and playback is left alone', async () => {
    const { runner, playback } = setup({ settings: { buildRefused: true } });
    const phases: string[] = [];
    runner.state.subscribe((s) => { phases.push(s.phase); });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused' } });
    expect(phases).not.toContain('stopping');
    expect(playback.clear).not.toHaveBeenCalled();
  });
});

describe('runner — subscriber isolation (F2)', () => {
  it('a subscriber that throws does not keep a later subscriber from hearing each phase', async () => {
    const { runner } = setup();
    runner.state.subscribe(() => { throw new Error('buggy surface'); });
    const seen: string[] = [];
    runner.state.subscribe((s) => { seen.push(s.phase); });
    await runner.start();
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    // Distinct phases in order; 'starting' is announced once per step (only
    // 'checking' and 'opening' for the default fake, with no `prepare` hook).
    const distinct = seen.filter((phase, i) => phase !== seen[i - 1]);
    expect(distinct).toEqual(['starting', 'running', 'stopping', 'idle']);
  });
});

describe('runner — a leg still opening waits for the lease (F3)', () => {
  it('a leg still opening when Stop lands is closed before the lease is released, and before stop() resolves', async () => {
    const order: string[] = [];
    const provider = {
      ...fakeProvider,
      session: {
        acquire: async () => ({ credentials: () => ({}), release: async () => { order.push('lease released'); } }),
      },
      // Ignores the signal: the delay is on the run's clock, unrelated to the abort.
      async start(request: StartRequest<never, never>, events: AdapterEvents) {
        await new Promise<void>((resolve) => { request.clock.setTimeout(resolve, 500); });
        const inner = await fakeProvider.start({ ...request, signal: new AbortController().signal }, events);
        return {
          ...inner, info: inner.info, appendAudio: () => {}, appendText: () => {}, beginTurn: () => {}, endTurn: () => {}, cancelTurn: () => {},
          stop: async () => { order.push('leg closed'); },
        };
      },
    } as unknown as AnyProvider;
    const { runner, clock } = setup({ shape: { provider } });
    const starting = runner.start();
    await flush();
    const stopping = runner.stop();
    // Nothing left to release is clock-gated yet: let it run to completion
    // (real microtasks only). Before the fix, `close()` unwinds right away —
    // with only the lease and the source's own entries on the stack, since the
    // leg's own session hasn't been deferred yet — so the lease is *already*
    // released here, before the leg has even finished opening.
    await flush();
    clock.advance(500);
    await flush();
    await stopping;
    expect(order).toEqual(['leg closed', 'lease released']);
    await starting;
  });
});

describe('runner — cancel at each starting step (F5)', () => {
  it('a stop during checking (a slow readiness check) cancels the start', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => { land = resolve; });
    const { runner, sources, events } = setup({ ensureReady: () => gate.then((): Readiness => ({ state: 'ready', models: [] })) });
    const starting = runner.start();
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'starting', step: 'checking' });
    const stopping = runner.stop();
    land();
    await stopping;
    await starting;
    await flush();
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(sources).toHaveLength(0);
    expect(events('translation_session_start')).toEqual([]);
  });

  it('a stop during preparing (a slow prepare hook) cancels the start', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => { land = resolve; });
    const provider = { ...fakeProvider, session: { prepare: () => gate.then(() => ({})) } } as unknown as AnyProvider;
    const { runner, sources, events } = setup({ shape: { provider } });
    const starting = runner.start();
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'starting', step: 'preparing' });
    const stopping = runner.stop();
    land();
    await stopping;
    await starting;
    await flush();
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(sources).toHaveLength(0);
    expect(events('translation_session_start')).toEqual([]);
  });

  it('a stop during acquire (a slow lease) cancels the start and still releases the lease', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => { land = resolve; });
    let released = false;
    const provider = {
      ...fakeProvider,
      session: { acquire: () => gate.then(() => ({ credentials: () => ({}), release: async () => { released = true; } })) },
    } as unknown as AnyProvider;
    const { runner, sources, events } = setup({ shape: { provider } });
    const starting = runner.start();
    await flush();
    // No distinct 'acquire' step exists on `RunState`; the visible step is
    // still whatever ran last ('checking', since this provider has no `prepare`).
    expect(runner.state.getState()).toMatchObject({ phase: 'starting', step: 'checking' });
    const stopping = runner.stop();
    land();
    await stopping;
    await starting;
    await flush();
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(sources).toHaveLength(0);
    expect(events('translation_session_start')).toEqual([]);
    expect(released).toBe(true);
  });

  // The 'opening' step is already covered by "a stop during a slow start
  // cancels it" above (runner — stopping); not duplicated here.

  it('a leg failing while the other leg is still opening ends the start and closes both (D22)', async () => {
    let failSpeaker!: () => void;
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<never, never>, ev: AdapterEvents) {
        if (request.context.direction.source === 'en') {
          const inner = await fakeProvider.start(request, ev);
          failSpeaker = () => ev.failed({ message: 'boom', code: 'network' });
          return inner;
        }
        return new Promise<never>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason));
        });
      },
    } as unknown as AnyProvider;
    const { runner, sources, events } = setup({ shape: { legs: ['speaker', 'participant'], provider } });
    const starting = runner.start();
    await flush();
    failSpeaker();
    await starting;
    await flush();
    expect(runner.state.getState()).toMatchObject({
      phase: 'idle',
      lastEnd: { reason: 'leg-failed', notice: { code: 'network', message: 'boom', leg: 'speaker' } },
    });
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(events('translation_session_start')).toEqual([]);
  });
});

describe('runner — small corrections (F6)', () => {
  it('captures the session duration when the stop lands, not after teardown finishes', async () => {
    const provider = {
      ...fakeProvider,
      start: async (request: any, events: any) => {
        const session = await fakeProvider.start(request, events);
        return {
          info: session.info,
          appendAudio: (pcm: Int16Array) => session.appendAudio(pcm),
          appendText: (text: string) => session.appendText(text),
          beginTurn: () => session.beginTurn(),
          endTurn: () => session.endTurn(),
          cancelTurn: () => session.cancelTurn(),
          // Hangs; the stack's own release timeout is what ends it, consuming clock time.
          stop: () => new Promise<void>(() => {}),
        };
      },
    } as unknown as AnyProvider;
    const { runner, clock, events } = setup({ shape: { provider } });
    await runner.start();
    clock.advance(600);
    const stopping = runner.stop();
    await flush();
    clock.advance(1000); // fires the stack's release timeout — teardown time that must not count
    await stopping;
    expect(events('translation_session_end')).toEqual([{ session_id: 'run1', duration: 600, provider: 'fake' }]);
  });

  it('redacts the adapter failure message before tracking api_error', async () => {
    let ev!: AdapterEvents;
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<never, never>, events: AdapterEvents) { ev = events; return fakeProvider.start(request, events); },
    } as unknown as AnyProvider;
    const { runner, events: tracked } = setup({ shape: { provider } });
    await runner.start();
    ev.failed({ message: 'rejected: sk-1234567890abcdef', code: 'auth' });
    await flush();
    const apiError = tracked('api_error')[0] as { error_message: string };
    expect(apiError.error_message).not.toContain('sk-1234567890abcdef');
    expect(apiError.error_message).toContain('[REDACTED]');
  });

  it('records a start failure with its cause, next to error_occurred', async () => {
    reportErrorSpy.mockClear();
    const { runner } = setup({ settings: { startThrows: true } });
    await runner.start();
    await flush();
    expect(reportErrorSpy).toHaveBeenCalledWith(
      'SessionRunner',
      'The session did not start: The fake failed to start (fault knob).',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
  });
});

describe('runner — one clip per speech entry', () => {
  it("hands playback as many clips for each segment as L1 kept speech entries for it", async () => {
    const { runner, clock, playback } = setup();
    await runner.start();
    clock.advance(10_000);
    const clips = new Map<string, number>();
    for (const [leg, ref] of playback.audio.mock.calls) clips.set(`${leg}:${ref}`, (clips.get(`${leg}:${ref}`) ?? 0) + 1);
    const spoken = runner.conversation.snapshot()[0].segments.filter((s) => s.speech.length > 0);
    expect(spoken.length).toBeGreaterThan(0);
    for (const segment of spoken) expect(clips.get(`speaker:${segment.ref}`)).toBe(segment.speech.length);
    expect([...clips.keys()].sort()).toEqual(spoken.map((s) => `speaker:${s.ref}`).sort());
  });
});
