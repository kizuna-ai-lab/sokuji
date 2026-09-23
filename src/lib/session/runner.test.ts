import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents } from '../contract/adapter';
import type { Leg } from '../conversation/types';
import type { Punctuator } from '../conversation/fillIn';
import type { AnyProvider, Readiness } from '../provider/types';
import { createVirtualClock } from '../contract/clock';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS, type FakeSettings } from '../../providers/fake/settings';
import type { OpenSource } from './source';
import type { PlaybackPort } from './ports';
import { createRunner } from './runner';
import type { RunShape } from './types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Options {
  shape?: Partial<RunShape>;
  settings?: Partial<FakeSettings>;
  openSource?: OpenSource;
  ready?: Readiness;
  onRunEnded?: (legs: readonly Leg[]) => void;
  punctuate?: Punctuator;
  playback?: Partial<PlaybackPort>;
}

function setup(o: Options = {}) {
  const clock = createVirtualClock(0);
  const sources: FakeSource[] = [];
  const playback = { audio: vi.fn(), closed: vi.fn(), held: vi.fn(), clear: vi.fn(), ...o.playback };
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
    ensureReady: async () => o.ready ?? { state: 'ready', models: [] },
    persistIfUnchanged,
    openSource: o.openSource ?? (async () => {
      const source = createFakeSource(clock);
      sources.push(source);
      return source;
    }),
    playback,
    analytics: { track: (event, properties) => { tracked.push([event, properties]); } },
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

  it('hands playback the translated audio and every closed segment', async () => {
    const { runner, clock, playback } = setup();
    await runner.start();
    clock.advance(5000);
    expect(playback.audio).toHaveBeenCalledWith('speaker', 2, expect.any(Int16Array));
    expect(playback.closed).toHaveBeenCalledWith('speaker', 1);
  });

  it('refuses a start the build refuses, opening nothing', async () => {
    const { runner, sources, events } = setup({ settings: { buildRefused: true } });
    await runner.start();
    expect(runner.state.getState()).toEqual({
      phase: 'idle',
      lastEnd: { reason: 'refused', notice: { code: 'build-refused', message: 'The fake refuses to build (fault knob).', leg: 'speaker' } },
    });
    expect(sources).toHaveLength(0);
    expect(events('translation_session_start')).toEqual([]);
    expect(events('error_occurred')).toEqual([]);
  });

  it('refuses the participant leg of an auto source before checking anything (D20)', async () => {
    const { runner } = setup({ shape: { legs: ['speaker', 'participant'], pair: { source: 'auto', target: 'en' } } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'participant-unsupported' } } });
  });

  it('refuses a provider that is not ready, with its reason', async () => {
    const { runner } = setup({ ready: { state: 'not-ready', reason: 'model not downloaded' } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'not-ready', message: 'model not downloaded' } } });
  });

  it('refuses when the credentials the settings ask for are missing', async () => {
    const { runner } = setup({ settings: { requireKey: true } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'credentials-missing' } } });
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
      lastEnd: { reason: 'start-failed', notice: { code: 'start-failed', message: 'permission denied', leg: 'participant' } },
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
      lastEnd: { reason: 'start-failed', notice: { code: 'start-failed', message: 'permission denied', leg: 'participant' } },
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
        acquire: async (_shape: RunShape, _s: unknown, ctx: { signal: AbortSignal; end(message: string): void }) => {
          ctx.signal.addEventListener('abort', () => ctx.end('lease cut'));
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
        return { ...session, stop: () => new Promise<void>(() => {}) };
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
    const { runner } = setup({ playback: { clear: vi.fn(() => { throw new Error('playback clear failed'); }) } });
    await runner.start();
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
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

  it('records a degraded source on its leg and keeps running', async () => {
    const { runner, sources } = setup();
    await runner.start();
    sources[0].degrade('fell back to system audio');
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'warning', code: 'source_degraded', message: 'fell back to system audio' })]);
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
