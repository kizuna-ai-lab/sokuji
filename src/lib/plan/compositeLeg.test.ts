// src/lib/plan/compositeLeg.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AdapterStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { recordEvents } from '../contract/events';
import { runScenario, scenarioNames, type AdapterHarness } from '../contract/testing/scenarios';
import type { LegName } from '../conversation/types';
import type { SharedSettings } from '../run/types';
import { buildPlan, startComposite } from './composite';
import { CompositeLeg } from './compositeLeg';
import { unitFor } from './read';
import { planOf, stubProvider, stubSpeechUnit, stubTextUnit, textAndSpeechPlan, type StubCalls } from './testing';
import type { PlanConfigs, PlannedUnit, RunPlan } from './types';

const SPEAKS: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The calls of a list, by name. */
const named = (calls: StubCalls) => calls.map((c) => c[0]);
const only = (calls: StubCalls, what: string) => calls.filter((c) => c[0] === what);

interface Options {
  context?: SessionContext;
  text?: Parameters<typeof stubTextUnit>[1];
  voice?: Parameters<typeof stubSpeechUnit>[1];
  leg?: LegName;
}

/** A leg over a stub text unit and a stub speech unit, started; the text unit's events and the voice are at hand. */
function leg(o: Options = {}) {
  const calls: StubCalls = [];
  const text = stubTextUnit(calls, o.text);
  const voice = stubSpeechUnit(calls, o.voice);
  const plan = textAndSpeechPlan(text.planned, voice.planned);
  const configs: PlanConfigs = new Map<PlannedUnit, unknown>([[text.planned, { unit: 'text' }], [voice.planned, { unit: 'voice' }]]);
  const controller = new AbortController();
  const credentials = (unit: PlannedUnit) => (unit === text.planned ? { key: 'text' } : { key: 'voice' });
  const request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> = { context: o.context ?? SPEAKS, config: configs, credentials, clock: createVirtualClock(0), signal: controller.signal };
  const rec = recordEvents();
  const starting = o.leg ? startComposite(plan, request, rec.events, o.leg) : startComposite(plan, request, rec.events);
  return { calls, text, voice, plan, request, controller, rec, starting, emit: () => text.starts[0].events, said: () => rec.log.map((e) => e.kind) };
}

/** A translation segment said whole and closed. */
function translate(events: AdapterEvents, ref: number, text: string, language?: string) {
  events.segmentOpened({ ref, side: 'translation' });
  events.segmentText({ ref, text, stableLen: text.length, ...(language ? { language } : {}) });
  events.segmentClosed({ ref });
}

describe('startComposite over a text unit and a speech unit: what can start', () => {
  it('rejects with plan_unsupported for any other shape of two units, and starts neither', async () => {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls);
    const voice = stubSpeechUnit(calls);
    const other = stubTextUnit(calls);
    const shapes: RunPlan[] = [
      // Two text units.
      { units: [text.planned, other.planned], byStage: { transcription: text.planned, translation: text.planned, speech: other.planned } },
      // Transcription and translation on different units.
      { units: [text.planned, voice.planned], byStage: { transcription: text.planned, translation: voice.planned, speech: voice.planned } },
      // Three units.
      { units: [text.planned, other.planned, voice.planned], byStage: { transcription: text.planned, translation: other.planned, speech: voice.planned } },
    ];
    for (const plan of shapes) {
      const started = startComposite(plan, { context: SPEAKS, config: new Map(), credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal }, recordEvents().events);
      await expect(started).rejects.toBeInstanceOf(AdapterStartError);
      await expect(started).rejects.toMatchObject({ code: 'plan_unsupported' });
    }
    expect(calls).toEqual([]);
  });
});

describe('startComposite over a text unit and a speech unit: order (spec §7.4)', () => {
  it('creates the speech session and opens it, then starts the text unit; each with its own config and credentials', async () => {
    const h = leg();
    await h.starting;
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'text.start']);
    const [voice] = h.voice.voices;
    expect(voice.request).toMatchObject({ leg: 'speaker', context: SPEAKS, config: { unit: 'voice' }, credentials: { key: 'voice' } });
    expect(voice.request.clock).toBe(h.request.clock);
    expect(voice.request.signal).toBe(h.request.signal);
    expect(voice.request.counts).toBeInstanceOf(Map);
    const [text] = h.text.starts;
    expect(text.request).toMatchObject({ config: { unit: 'text' }, credentials: { key: 'text' }, clock: h.request.clock, signal: h.request.signal });
  });

  it('hands the text unit a context that does not speak, and the speech unit the one that does', async () => {
    const h = leg();
    await h.starting;
    expect(h.text.starts[0].request.context).toEqual({ ...SPEAKS, speech: false });
    expect(h.voice.voices[0].request.context).toEqual(SPEAKS);
  });

  it('names the leg it was told to the speech unit', async () => {
    const h = leg({ leg: 'participant' });
    await h.starting;
    expect(h.voice.voices[0].request.leg).toBe('participant');
  });

  it("does not await the speech session's open", async () => {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls);
    const voice = stubSpeechUnit(calls);
    const never = new Promise<void>(() => {});
    const unit = { ...voice.planned.unit, startSpeech: vi.fn(() => ({ open: () => never, speak: () => {}, endUtterance: () => {}, setOn: () => {}, close: () => {} })) };
    const planned: PlannedUnit = { ...voice.planned, unit };
    const plan = textAndSpeechPlan(text.planned, planned);
    const session = await startComposite(plan, { context: SPEAKS, config: new Map(), credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal }, recordEvents().events);
    expect(session).toBeDefined();
  });

  it('stops the text session first, then closes the speech session, before its first await', async () => {
    const h = leg();
    const session = await h.starting;
    h.calls.length = 0;
    const stopping = session.stop();
    expect(named(h.calls)).toEqual(['text.stop', 'voice.close']);
    await stopping;
    expect(named(h.calls)).toEqual(['text.stop', 'voice.close']);
  });

  it('closes the speech session once, however often it is stopped', async () => {
    const h = leg();
    const session = await h.starting;
    await session.stop();
    await session.stop();
    expect(only(h.calls, 'voice.close')).toHaveLength(1);
  });

  it("closes the speech session and rejects with the text unit's own error when the text unit fails to start", async () => {
    const error = new AdapterStartError('No such key.', 'invalid_key');
    const h = leg({ text: { fails: error } });
    await expect(h.starting).rejects.toBe(error);
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'text.start', 'voice.close']);
    expect(h.rec.log).toEqual([]);
  });

  it('closes the speech session when the start is cancelled while the text unit opens', async () => {
    const h = leg({ text: { held: true } });
    h.controller.abort(new Error('cancelled'));
    await expect(h.starting).rejects.toThrow('cancelled');
    expect(only(h.calls, 'voice.close')).toHaveLength(1);
  });
});

describe('startComposite over a text unit and a speech unit: the text unit\'s events', () => {
  it('passes every event on unchanged', async () => {
    const h = leg();
    await h.starting;
    const e = h.emit();
    const payloads = {
      segmentOpened: { ref: 1, side: 'source' as const, person: 'A' },
      segmentText: { ref: 1, text: 'Hello.', heard: { pieces: [], stableLen: 6 } },
      segmentClosed: { ref: 1 },
      reconnecting: { attempt: 1 },
      reconnected: { attempts: 1 },
      degraded: { code: 'tts_degraded' as const, message: 'm' },
      loading: { stage: 'model', done: 1, total: 2 },
      busy: true,
      frame: { direction: 'in' as const, type: 'stt.tokens' },
      closed: { reason: 'server' },
    };
    e.segmentOpened(payloads.segmentOpened);
    e.segmentText(payloads.segmentText);
    e.segmentClosed(payloads.segmentClosed);
    e.reconnecting(payloads.reconnecting);
    e.reconnected(payloads.reconnected as never);
    e.degraded(payloads.degraded);
    e.loading(payloads.loading);
    e.busy(payloads.busy);
    e.frame(payloads.frame);
    e.closed(payloads.closed);
    expect(h.said()).toEqual(Object.keys(payloads));
    h.rec.log.forEach((entry) => expect(entry.payload).toBe(payloads[entry.kind as keyof typeof payloads]));
  });

  it('passes a failure on unchanged, and closes the speech session', async () => {
    const h = leg();
    await h.starting;
    const failure = { message: 'gone', code: 'network' };
    h.emit().failed(failure);
    expect(h.rec.log).toEqual([{ kind: 'failed', payload: failure }]);
    expect(only(h.calls, 'voice.close')).toHaveLength(1);
  });

  it('drops audio and ranges the text unit emits, and reports them once as a frame', async () => {
    const h = leg();
    await h.starting;
    h.emit().audio({ pcm: new Int16Array(4), ref: 2 });
    h.emit().speechRanges({ ref: 2, ranges: [] });
    h.emit().audio({ pcm: new Int16Array(4), ref: 2 });
    expect(h.rec.log).toEqual([{ kind: 'frame', payload: { direction: 'in', type: 'composite.unexpected_audio', payload: { event: 'audio' } } }]);
  });
});

describe('startComposite over a text unit and a speech unit: speech', () => {
  it('feeds each stable stretch of a translation to the speech session, then the end of the utterance', async () => {
    const h = leg();
    await h.starting;
    const e = h.emit();
    e.segmentOpened({ ref: 1, side: 'source' });
    e.segmentText({ ref: 1, text: 'Hello, world.' });
    e.segmentClosed({ ref: 1 });
    e.segmentOpened({ ref: 2, side: 'translation' });
    e.segmentText({ ref: 2, text: 'こんにちは、世', stableLen: 6 });
    e.segmentText({ ref: 2, text: 'こんにちは、世界。', stableLen: 9 });
    e.segmentClosed({ ref: 2 });
    expect(h.calls.filter((c) => c[0] === 'voice.speak' || c[0] === 'voice.endUtterance')).toEqual([
      ['voice.speak', 'speaker', 2, 'こんにちは、', [0, 6], 'ja', undefined],
      ['voice.speak', 'speaker', 2, '世界。', [6, 9], 'ja', undefined],
      ['voice.endUtterance', 'speaker', 2],
    ]);
  });

  it('does not read a translation in a language that is not the leg\'s target, and still ends its utterance', async () => {
    const h = leg();
    await h.starting;
    translate(h.emit(), 2, 'It is fine.', 'en');
    expect(only(h.calls, 'voice.speak')).toEqual([]);
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2]]);
  });

  it("passes the speech session's audio and ranges on as the leg's own, the segment's text first", async () => {
    const h = leg({ voice: { answers: true } });
    await h.starting;
    translate(h.emit(), 2, 'こんにちは。');
    const [voice] = h.voice.voices;
    voice.audio(2);
    voice.events.speechRanges({ ref: 2, ranges: [{ index: 1, range: [3, 6] }] });
    expect(h.said()).toEqual(['segmentOpened', 'segmentText', 'audio', 'segmentClosed', 'audio', 'speechRanges']);
    const audio = h.rec.log.filter((e) => e.kind === 'audio').map((e) => e.payload);
    expect(audio[0]).toEqual({ pcm: expect.any(Int16Array), ref: 2, range: [0, 6] });
    expect(audio[1]).toEqual({ pcm: expect.any(Int16Array), ref: 2 });
    expect(h.rec.log[5].payload).toEqual({ ref: 2, ranges: [{ index: 1, range: [3, 6] }] });
    expect(voice.request.counts.get(2)).toBe(2);
  });

  it("passes the speech session's frames on", async () => {
    const h = leg();
    await h.starting;
    const frame = { direction: 'out' as const, type: 'tts.start' };
    h.voice.voices[0].events.frame(frame);
    expect(h.rec.log).toEqual([{ kind: 'frame', payload: { ...frame, runStage: 'speech' } }]);
  });

  it('switches the speech session with setSpeech, and goes on feeding it while speech is off', async () => {
    const h = leg();
    const session = await h.starting;
    session.setSpeech!(false);
    translate(h.emit(), 2, 'こんにちは。');
    session.setSpeech!(true);
    expect(named(h.calls).slice(3)).toEqual(['voice.setOn', 'voice.speak', 'voice.endUtterance', 'voice.setOn']);
    expect(only(h.calls, 'voice.setOn').map((c) => c[2])).toEqual([false, true]);
  });

  it('recycles the speech session before it passes on a reconnect, and does not forget an open translation', async () => {
    const h = leg();
    await h.starting;
    const e = h.emit();
    e.segmentOpened({ ref: 2, side: 'translation' });
    e.segmentText({ ref: 2, text: 'こんにちは、世', stableLen: 6 });
    h.calls.length = 0;
    const order: string[] = [];
    h.calls.push = ((...c: unknown[][]) => { order.push(...c.map((x) => String(x[0]))); return 0; }) as never;
    h.rec.log.push = ((...entries: Array<{ kind: string }>) => { order.push(...entries.map((x) => x.kind)); return 0; }) as never;
    e.reconnecting({ attempt: 1 });
    e.reconnected();
    e.segmentText({ ref: 2, text: 'こんにちは、世界。', stableLen: 9 });
    expect(order).toEqual(['reconnecting', 'voice.recycle', 'reconnected', 'segmentText', 'voice.speak']);
  });

  it('passes on a reconnect when the speech session has no recycle', async () => {
    const h = leg({ voice: { recycles: false } });
    await h.starting;
    h.emit().reconnected();
    expect(h.said()).toEqual(['reconnected']);
  });

  it("passes the speech session's degradation on, with its code", async () => {
    const h = leg();
    await h.starting;
    const degraded = { code: 'tts_degraded' as const, message: 'The voice is gone.', reason: 'tts_408' };
    h.voice.voices[0].events.degraded(degraded);
    expect(h.rec.log).toEqual([{ kind: 'degraded', payload: { ...degraded, runStage: 'speech' } }]);
  });

  it('goes on without speech when the speech unit cannot start: one tts_degraded once the leg is open, and subtitles as before', async () => {
    const cause = new Error('no model');
    const h = leg({ voice: { fails: cause }, text: { held: true } });
    await flush();
    expect(h.rec.log).toEqual([]);
    h.text.starts[0].open();
    const session = await h.starting;
    expect(h.rec.log).toEqual([{ kind: 'degraded', payload: { code: 'tts_degraded', message: expect.stringContaining('no model'), cause, runStage: 'speech' } }]);
    translate(h.emit(), 2, 'こんにちは。');
    session.setSpeech!(false);
    h.emit().reconnected();
    await session.stop();
    expect(h.said()).toEqual(['degraded', 'segmentOpened', 'segmentText', 'segmentClosed', 'reconnected']);
    expect(named(h.calls)).toEqual(['voice.start', 'text.start', 'text.stop']);
  });

  it('closes a speech session whose open rejects, says tts_degraded once, and asks nothing more of it', async () => {
    const cause = new Error('refused');
    const h = leg({ voice: { openFails: cause } });
    const session = await h.starting;
    await flush();
    expect(h.rec.log).toEqual([{ kind: 'degraded', payload: { code: 'tts_degraded', message: expect.stringContaining('refused'), cause, runStage: 'speech' } }]);
    translate(h.emit(), 2, 'こんにちは。');
    session.setSpeech!(false);
    h.emit().reconnected();
    await session.stop();
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'text.start', 'voice.close', 'text.stop']);
  });

  it('says nothing of a speech unit that could not start when the text unit fails to start too', async () => {
    const error = new Error('refused');
    const h = leg({ voice: { fails: new Error('no model') }, text: { fails: error } });
    await expect(h.starting).rejects.toBe(error);
    expect(h.rec.log).toEqual([]);
  });

  it("a two-unit plan files a speech failure under the speech unit's provider", async () => {
    const h = leg({ text: { provider: { id: 'fake' } }, voice: { provider: { id: 'fake_voice' } } });
    await h.starting;
    h.voice.voices[0].events.degraded({ code: 'tts_stopped', message: 'The voice is gone.' });
    h.voice.voices[0].events.frame({ direction: 'in', type: 'voice.note', payload: {} });
    const [degraded, frame] = h.rec.log;
    // The run files an error under the unit of the stage the event names (`providerOf` in `session/run.ts`).
    for (const e of [degraded, frame]) expect(e.payload).toMatchObject({ runStage: 'speech' });
    expect(unitFor(h.plan, (degraded.payload as { runStage: 'speech' }).runStage).provider.id).toBe('fake_voice');
  });

  it("leaves the text unit's own events untagged", async () => {
    const h = leg();
    await h.starting;
    h.emit().degraded({ code: 'tts_degraded', message: 'm' });
    expect(h.rec.log).toEqual([{ kind: 'degraded', payload: { code: 'tts_degraded', message: 'm' } }]);
  });

  it('holds what the speech session says of itself while the text unit opens, and says it once the leg is open', async () => {
    const h = leg({ text: { held: true } });
    await flush();
    // A voice with no key says so as it opens, before the text unit has.
    const noKey = { code: 'tts_degraded' as const, message: 'No key for speech.' };
    const lost = { code: 'tts_stopped' as const, message: 'The voice is gone.', reason: 'tts_408' };
    h.voice.voices[0].events.degraded(noKey);
    h.voice.voices[0].events.degraded(lost);
    expect(h.rec.log).toEqual([]);
    h.text.starts[0].open();
    await h.starting;
    expect(h.rec.log).toEqual([{ kind: 'degraded', payload: { ...noKey, runStage: 'speech' } }, { kind: 'degraded', payload: { ...lost, runStage: 'speech' } }]);
    // Once open, a degradation passes on at once, and the held ones are not said again.
    h.voice.voices[0].events.degraded(lost);
    expect(h.said()).toEqual(['degraded', 'degraded', 'degraded']);
  });

  it('says nothing of what the speech session said of itself when the text unit fails to start', async () => {
    const error = new Error('refused');
    const h = leg({ text: { held: true } });
    await flush();
    h.voice.voices[0].events.degraded({ code: 'tts_degraded', message: 'No key for speech.' });
    h.text.starts[0].refuse(error);
    await expect(h.starting).rejects.toBe(error);
    expect(h.rec.log).toEqual([]);
  });

  it('a voice whose open rejects while the text unit is still starting says so only once the leg is open', async () => {
    const cause = new Error('refused');
    const h = leg({ voice: { openFails: cause }, text: { held: true } });
    await flush();
    // The voice is already closed, and nothing has been said of it: the start can still fail.
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'text.start', 'voice.close']);
    expect(h.rec.log).toEqual([]);
    h.text.starts[0].open();
    const session = await h.starting;
    await flush();
    const lost = { kind: 'degraded', payload: { code: 'tts_degraded', message: expect.stringContaining('refused'), cause, runStage: 'speech' } };
    expect(h.rec.log).toEqual([lost]);
    // Said once: nothing more of the voice follows, whatever the leg goes on to do.
    translate(h.emit(), 2, 'こんにちは。');
    await session.stop();
    expect(h.rec.log.filter((e) => e.kind === 'degraded')).toEqual([lost]);
    expect(only(h.calls, 'voice.close')).toHaveLength(1);
  });

  it('a voice whose open rejects while the text unit is still starting says nothing when the text unit then fails to start', async () => {
    const error = new Error('no connection');
    const h = leg({ voice: { openFails: new Error('refused') }, text: { held: true } });
    await flush();
    expect(h.rec.log).toEqual([]);
    h.text.starts[0].refuse(error);
    await expect(h.starting).rejects.toBe(error);
    await flush();
    expect(h.rec.log).toEqual([]);
    expect(only(h.calls, 'voice.close')).toHaveLength(1);
  });

  it('reads text that came after its segment closed, then ends the utterance again, and passes nothing of it on', async () => {
    const h = leg();
    await h.starting;
    translate(h.emit(), 2, 'こんにちは');
    h.emit().lateSpeech!({ ref: 2, text: '。', span: [5, 6], language: 'ja' });
    expect(h.calls.filter((c) => c[0] === 'voice.speak' || c[0] === 'voice.endUtterance')).toEqual([
      ['voice.speak', 'speaker', 2, 'こんにちは', [0, 5], 'ja', undefined],
      ['voice.endUtterance', 'speaker', 2],
      ['voice.speak', 'speaker', 2, '。', [5, 6], 'ja', undefined],
      ['voice.endUtterance', 'speaker', 2],
    ]);
    expect(h.said()).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
  });

  it('does not read late text in a language that is not the leg\'s target, and still ends its utterance; nothing once stopped', async () => {
    const h = leg();
    const session = await h.starting;
    h.emit().lateSpeech!({ ref: 2, text: 'Fine.', span: [0, 5], language: 'en' });
    expect(h.calls.filter((c) => c[0] === 'voice.speak' || c[0] === 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2]]);
    await session.stop();
    h.emit().lateSpeech!({ ref: 2, text: '。', span: [5, 6], language: 'ja' });
    expect(only(h.calls, 'voice.speak')).toEqual([]);
  });

  it('starts no speech session for a leg that does not speak', async () => {
    const h = leg({ context: { ...SPEAKS, speech: false } });
    const session = await h.starting;
    translate(h.emit(), 2, 'こんにちは。');
    session.setSpeech?.(true);
    await session.stop();
    expect(named(h.calls)).toEqual(['text.start', 'text.stop']);
    expect(h.said()).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
  });
});

describe('startComposite over a text unit and a speech unit: after the end', () => {
  it('asks nothing more of the speech session, and passes nothing of it on, once stopped', async () => {
    const h = leg({ voice: { answers: true } });
    const session = await h.starting;
    const e = h.emit();
    e.segmentOpened({ ref: 2, side: 'translation' });
    e.segmentText({ ref: 2, text: 'こんにちは、世', stableLen: 6 });
    await session.stop();
    h.calls.length = 0;
    h.rec.log.length = 0;
    e.segmentClosed({ ref: 2 });
    session.setSpeech!(false);
    const [voice] = h.voice.voices;
    voice.audio(2);
    voice.events.frame({ direction: 'in', type: 'tts.late' });
    voice.events.degraded({ code: 'tts_degraded', message: 'late' });
    expect(h.calls).toEqual([]);
    expect(h.said()).toEqual(['segmentClosed']);
  });

  it('passes on a frame the speech session says while it closes at a stop, and nothing while it closes after a failure', async () => {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls);
    const voice = stubSpeechUnit(calls);
    const sayOnClose = (planned: PlannedUnit): PlannedUnit => ({
      ...planned,
      unit: {
        ...planned.unit,
        startSpeech: (request, events) => {
          const inner = planned.unit.startSpeech!(request, events);
          return { ...inner, close: () => { events.frame({ direction: 'out', type: 'tts.end' }); inner.close(); } };
        },
      },
    });
    const plan = textAndSpeechPlan(text.planned, sayOnClose(voice.planned));
    const start = (rec: ReturnType<typeof recordEvents>) =>
      startComposite(plan, { context: SPEAKS, config: new Map(), credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal }, rec.events);
    const stopped = recordEvents();
    await (await start(stopped)).stop();
    expect(stopped.log.map((e) => e.kind)).toEqual(['frame']);
    const failed = recordEvents();
    await start(failed);
    text.starts[1].events.failed({ message: 'gone' });
    expect(failed.log.map((e) => e.kind)).toEqual(['failed']);
  });
});

describe('CompositeLeg: a voice is not started for a leg that has ended', () => {
  /** A leg whose voice the caller opens itself, as both legs started together have theirs opened. */
  function made() {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls);
    const voice = stubSpeechUnit(calls);
    const request = { context: SPEAKS, config: new Map<PlannedUnit, unknown>(), credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal };
    const rec = recordEvents();
    return { calls, rec, leg: new CompositeLeg('speaker', text.planned, voice.planned, request, rec.events) };
  }

  it('starts the voice of a leg that goes on', () => {
    const h = made();
    h.leg.openVoice(new Map());
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open']);
    expect(h.leg.speaks).toBe(true);
  });

  it.each([
    ['its text session failed', (leg: CompositeLeg) => leg.textEvents.failed({ message: 'gone' })],
    ['its text session closed', (leg: CompositeLeg) => leg.textEvents.closed({ reason: 'server' })],
    ['it was cut', (leg: CompositeLeg) => leg.cut()],
  ] as const)('starts none once %s, and says nothing of it', (_what, end) => {
    const h = made();
    end(h.leg);
    const said = h.rec.log.length;
    h.leg.openVoice(new Map());
    h.leg.opened();
    expect(h.calls).toEqual([]);
    expect(h.leg.speaks).toBe(false);
    expect(h.rec.log).toHaveLength(said);
  });
});

describe("startComposite over a text unit and a speech unit: the text session's own", () => {
  it('passes audio, text and the turn calls to the text session, and answers with its info', async () => {
    const h = leg();
    const session = await h.starting;
    h.calls.length = 0;
    const pcm = new Int16Array(8);
    session.appendAudio(pcm);
    session.appendText('typed');
    session.beginTurn();
    session.endTurn();
    session.cancelTurn();
    expect(h.calls).toEqual([['text.appendAudio', pcm], ['text.appendText', 'typed'], ['text.beginTurn'], ['text.endTurn'], ['text.cancelTurn']]);
    expect(session.info).toBe(h.text.starts[0].session.info);
  });

  it('has agentText and networkRestored only when the text session has them, and they are the text session\'s', async () => {
    const without = await leg().starting;
    expect(without.agentText).toBeUndefined();
    expect(without.networkRestored).toBeUndefined();
    const agentText = vi.fn(() => true);
    const networkRestored = vi.fn();
    const session = await leg({ text: { session: { agentText, networkRestored } } }).starting;
    expect(session.agentText!('こんにちは', true)).toBe(true);
    expect(agentText).toHaveBeenCalledWith('こんにちは', true);
    session.networkRestored!();
    expect(networkRestored).toHaveBeenCalledTimes(1);
  });
});

describe('buildPlan over several units', () => {
  const shared = { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, speaks: true } as unknown as SharedSettings;
  const units = (context: SessionContext) => {
    const builds = [vi.fn(() => ({})), vi.fn(() => ({}))];
    const text: PlannedUnit = { ...planOf(stubProvider('soniox', { build: builds[0] })).units[0], stages: ['transcription', 'translation'] };
    const voice: PlannedUnit = { ...planOf(stubProvider('edge', { build: builds[1] })).units[0], stages: ['speech'] };
    buildPlan(textAndSpeechPlan(text, voice), context, { accounts: { soniox: { settings: 's', credentials: {} }, edge: { settings: 'e', credentials: {} } } }, shared);
    return builds;
  };

  it('builds a unit that does not serve speech with a context that does not speak, and the speech unit with the leg\'s own', () => {
    const [text, voice] = units(SPEAKS);
    expect(text).toHaveBeenCalledWith({ ...SPEAKS, speech: false }, 's', shared);
    expect(voice).toHaveBeenCalledWith(SPEAKS, 'e', shared);
  });

  it('builds every unit without speech for a leg that does not speak', () => {
    const silent = { ...SPEAKS, speech: false };
    const [text, voice] = units(silent);
    expect(text).toHaveBeenCalledWith(silent, 's', shared);
    expect(voice).toHaveBeenCalledWith(silent, 'e', shared);
  });

  it('hands a unit that serves every stage the context itself', () => {
    const build = vi.fn(() => ({}));
    buildPlan(planOf(stubProvider('soniox', { build })), SPEAKS, { accounts: { soniox: { settings: 's', credentials: {} } } }, shared);
    expect(build.mock.calls[0][0 as never]).toBe(SPEAKS);
  });
});

describe('startComposite over a text unit and a speech unit: conformance', () => {
  /** One scenario's units: fresh stubs, the text unit's start held until the scenario opens it. */
  interface Scenario { plan: RunPlan; text: ReturnType<typeof stubTextUnit>; voice: ReturnType<typeof stubSpeechUnit> }
  let now: Scenario;
  const events = () => now.text.starts[now.text.starts.length - 1].events;
  /** The text session's own ending: once it has said so, or was stopped, the stub text unit says nothing more. */
  let over = false;
  /** The text unit's segment counter: an exchange after a reconnect goes on from it. */
  let ref = 0;
  const say = (emit: (e: AdapterEvents) => void) => { if (!over) emit(events()); };
  const harness: AdapterHarness<Scenario, undefined> = {
    adapter: { start: (request, sink) => startComposite(request.config.plan, { ...request, config: new Map(), credentials: () => undefined }, sink) },
    config: () => {
      over = false;
      ref = 0;
      const text = stubTextUnit([], { held: true, session: { stop: async () => { over = true; }, networkRestored: () => {} } });
      const voice = stubSpeechUnit([], { answers: true });
      now = { plan: textAndSpeechPlan(text.planned, voice.planned), text, voice };
      return now;
    },
    credentials: undefined,
    opening: () => [{ run: () => now.text.starts[0].open() }],
    exchange: [
      { run: () => say((e) => {
        const source = ++ref;
        const translation = ++ref;
        e.segmentOpened({ ref: source, side: 'source' });
        e.segmentText({ ref: source, text: 'Hello.' });
        e.segmentClosed({ ref: source });
        e.segmentOpened({ ref: translation, side: 'translation' });
        e.segmentText({ ref: translation, text: 'こんにちは。', stableLen: 3 });
        e.segmentText({ ref: translation, text: 'こんにちは。', stableLen: 6 });
        e.segmentClosed({ ref: translation });
      }) },
      // The voice's fill-in, where the leg speaks.
      { run: () => { if (!over) now.voice.voices[0]?.events.speechRanges({ ref, ranges: [{ index: 0, range: [0, 2] }, { index: 1, range: [3, 6] }] }); } },
    ],
    serverClose: [{ run: () => say((e) => { over = true; e.closed({ reason: 'server' }); }) }],
    refuse: [{ run: () => now.text.starts[0].refuse(new AdapterStartError('Refused.', 'invalid_key')) }],
    reconnect: [{ run: () => say((e) => { e.reconnecting({ attempt: 1 }); e.reconnected(); }) }],
  };

  it('runs every scenario but typed text', () => {
    expect(scenarioNames(harness)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close', 'reconnect']);
  });

  it.each(scenarioNames(harness))('%s', async (name) => {
    const report = await runScenario(harness, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('the exchange is spoken: the scenario that speaks emits audio for the translation', async () => {
    const rec = recordEvents();
    const scenario = harness.config(SPEAKS, 'open-stop');
    const starting = harness.adapter.start({ context: SPEAKS, config: scenario, credentials: undefined, clock: createVirtualClock(0), signal: new AbortController().signal }, rec.events);
    scenario.text.starts[0].open();
    const session: AdapterSession = await starting;
    for (const step of harness.exchange) if ('run' in step) await step.run({ session, clock: createVirtualClock(0), log: [] });
    expect(rec.log.filter((e) => e.kind === 'audio')).toHaveLength(2);
    expect(rec.log.filter((e) => e.kind === 'speechRanges')).toHaveLength(1);
  });
});
