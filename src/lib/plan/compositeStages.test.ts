// src/lib/plan/compositeStages.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterStartError, LegStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { checkConformance, recordConformance } from '../contract/conformance';
import { recordEvents } from '../contract/events';
import { runScenario, scenarioNames, type AdapterHarness } from '../contract/testing/scenarios';
import type { TranslationEvents, TranslationSession } from '../contract/translation';
import type { LegName } from '../conversation/types';
import { createJobTranslator } from '../translation/jobTranslator';
import { startComposite } from './composite';
import { startCompositeBoth } from './compositeBoth';
import { separateStages } from './compositeStages';
import { separatePlan, stubSpeechUnit, stubStartBoth, stubTextUnit, stubTranslationUnit, textAndSpeechPlan, type StubCalls } from './testing';
import type { PlanConfigs, PlannedUnit, RunPlan } from './types';

const SPEAKS: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const named = (calls: StubCalls) => calls.map((c) => c[0]);
const only = (calls: StubCalls, what: string) => calls.filter((c) => c[0] === what);

interface Options {
  context?: SessionContext;
  text?: Parameters<typeof stubTextUnit>[1];
  translation?: Parameters<typeof stubTranslationUnit>[1];
  voice?: Parameters<typeof stubSpeechUnit>[1];
  leg?: LegName;
}

/** A leg over a stub unit that transcribes, a stub unit that translates and a stub unit that speaks, started. */
function leg(o: Options = {}) {
  const calls: StubCalls = [];
  const text = stubTextUnit(calls, o.text);
  const translation = stubTranslationUnit(calls, o.translation);
  const voice = stubSpeechUnit(calls, o.voice);
  const plan = separatePlan(text.planned, translation.planned, voice.planned);
  const kind = (unit: PlannedUnit) => (unit === plan.byStage.transcription ? 'text' : unit === translation.planned ? 'translation' : 'voice');
  const configs: PlanConfigs = new Map<PlannedUnit, unknown>(plan.units.map((unit) => [unit, { unit: kind(unit) }]));
  const controller = new AbortController();
  const request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> = { context: o.context ?? SPEAKS, config: configs, credentials: (unit) => ({ key: kind(unit) }), clock: createVirtualClock(0), signal: controller.signal };
  const rec = recordEvents();
  const starting = o.leg ? startComposite(plan, request, rec.events, o.leg) : startComposite(plan, request, rec.events);
  return {
    calls, text, translation, voice, plan, request, controller, rec, starting,
    /** What the unit that transcribes emits through. */
    heard: () => text.starts[0].events,
    /** What the unit that translates emits through. */
    translated: () => translation.sessions[0].events,
    said: () => rec.log.map((e) => e.kind),
    of: (kind: string) => rec.log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>),
  };
}

/** A source segment said whole and closed, by the unit that transcribes. */
function hear(events: AdapterEvents, ref: number, text: string, origin?: string) {
  events.segmentOpened({ ref, side: 'source', ...(origin ? { origin } : {}) });
  events.segmentText({ ref, text });
  events.segmentClosed({ ref, ...(origin ? { origin } : {}) });
}

/** A translation segment said whole and closed, by the unit that translates. */
function translate(events: TranslationEvents, ref: number, origin: string, text: string) {
  events.translationOpened({ ref, origin });
  events.translationText({ ref, text, stableLen: text.length });
  events.translationClosed({ ref });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('separateStages: the plans whose transcription and translation are apart', () => {
  const text = stubTextUnit();
  const translation = stubTranslationUnit();
  const voice = stubSpeechUnit();

  it('takes a unit that transcribes, a unit that translates and a unit that speaks', () => {
    const plan = separatePlan(text.planned, translation.planned, voice.planned);
    expect(separateStages(plan)).toEqual({ transcription: plan.byStage.transcription, translation: translation.planned, speech: voice.planned });
  });

  it('takes one unit that both translates and speaks beside the unit that transcribes', () => {
    const both: PlannedUnit = { ...translation.planned, unit: { ...translation.planned.unit, startSpeech: voice.planned.unit.startSpeech }, stages: ['translation', 'speech'] };
    const alone: PlannedUnit = { ...text.planned, stages: ['transcription'] };
    const plan: RunPlan = { units: [alone, both], byStage: { transcription: alone, translation: both, speech: both } };
    expect(separateStages(plan)).toEqual({ transcription: alone, translation: both, speech: both });
  });

  it('takes no other plan', () => {
    const other = stubTextUnit();
    const alone: PlannedUnit = { ...text.planned, stages: ['transcription'] };
    const plans: RunPlan[] = [
      // A text unit and a speech unit: the other wiring.
      textAndSpeechPlan(text.planned, voice.planned),
      // Translation by a unit that is started as an adapter.
      { units: [alone, other.planned, voice.planned], byStage: { transcription: alone, translation: other.planned, speech: voice.planned } },
      // Translation by a unit that only speaks.
      { units: [alone, voice.planned], byStage: { transcription: alone, translation: voice.planned, speech: voice.planned } },
      // Speech by the unit that transcribes.
      { units: [alone, translation.planned], byStage: { transcription: alone, translation: translation.planned, speech: alone } },
      // Transcription by a unit that is not started as an adapter.
      { units: [translation.planned, voice.planned], byStage: { transcription: voice.planned, translation: translation.planned, speech: voice.planned } },
      // A unit in the list that serves no stage.
      { units: [alone, translation.planned, voice.planned, other.planned], byStage: { transcription: alone, translation: translation.planned, speech: voice.planned } },
    ];
    for (const plan of plans) expect(separateStages(plan)).toBeNull();
  });
});

describe('a leg of three units: order (spec §7.4)', () => {
  it('opens speech without waiting, then translation, then transcription; each with its own config and credentials', async () => {
    const h = leg();
    await h.starting;
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'translation.open', 'text.start']);
    expect(h.voice.voices[0].request).toMatchObject({ leg: 'speaker', context: SPEAKS, config: { unit: 'voice' }, credentials: { key: 'voice' } });
    const { request } = h.translation.sessions[0];
    expect(request).toMatchObject({ leg: 'speaker', config: { unit: 'translation' }, credentials: { key: 'translation' } });
    expect(request.context).toEqual({ ...SPEAKS, speech: false });
    expect(request.clock).toBe(h.request.clock);
    expect(h.text.starts[0].request).toMatchObject({ config: { unit: 'text' }, credentials: { key: 'text' } });
    expect(h.text.starts[0].request.context).toEqual({ ...SPEAKS, speech: false });
  });

  it('hands the units that translate and transcribe a signal of the leg\'s own, which the run\'s cancels', async () => {
    const h = leg();
    await h.starting;
    const signals = [h.translation.sessions[0].request.signal, h.text.starts[0].request.signal];
    expect(signals.map((s) => s.aborted)).toEqual([false, false]);
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    expect(signals.map((s) => s.reason)).toEqual([reason, reason]);
  });

  it('names the leg it was told to the units that translate and speak', async () => {
    const h = leg({ leg: 'participant' });
    await h.starting;
    expect(h.translation.sessions[0].request.leg).toBe('participant');
    expect(h.voice.voices[0].request.leg).toBe('participant');
  });

  it('waits for the translation to open before the transcription starts', async () => {
    const h = leg({ translation: { held: true } });
    await flush();
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'translation.open']);
    h.translation.sessions[0].open();
    await h.starting;
    expect(named(h.calls)).toContain('text.start');
  });

  it('starts no voice on a leg that does not speak', async () => {
    const h = leg({ context: { ...SPEAKS, speech: false } });
    await h.starting;
    expect(named(h.calls)).toEqual(['translation.start', 'translation.open', 'text.start']);
  });

  it('stops transcription first, then translation, then closes speech, all before its first await', async () => {
    const h = leg();
    const session = await h.starting;
    h.calls.length = 0;
    const stopping = session.stop();
    expect(named(h.calls)).toEqual(['text.stop', 'translation.stop', 'voice.close']);
    await stopping;
    expect(named(h.calls)).toEqual(['text.stop', 'translation.stop', 'voice.close']);
  });

  it('a stop still hears both stops when the voice throws as it closes: the transcription\'s rejection is the one handed on, and the leg is over', async () => {
    const stuck = new Error('stuck');
    const h = leg({ text: { session: { stop: () => Promise.reject(stuck) } }, voice: { closeFails: new Error('voice stuck') } });
    const session = await h.starting;
    h.calls.length = 0;
    await expect(session.stop()).rejects.toBe(stuck);
    expect(named(h.calls)).toEqual(['translation.stop', 'voice.close']);
    // Over: not even a frame passes on.
    h.translated().frame({ direction: 'out', type: 'translation.late' });
    expect(h.rec.log).toEqual([]);
  });

  it('a stop whose voice alone throws rejects with that, once the two stops have settled', async () => {
    const stuck = new Error('voice stuck');
    const h = leg({ voice: { closeFails: stuck } });
    const session = await h.starting;
    await expect(session.stop()).rejects.toBe(stuck);
    expect(named(h.calls)).toEqual(expect.arrayContaining(['text.stop', 'translation.stop', 'voice.close']));
  });

  it('a stop rejects with what the transcription said, after everything was still closed', async () => {
    const stuck = new Error('stuck');
    const h = leg({ text: { session: { stop: () => Promise.reject(stuck) } } });
    const session = await h.starting;
    await expect(session.stop()).rejects.toBe(stuck);
    expect(named(h.calls)).toEqual(expect.arrayContaining(['translation.stop', 'voice.close']));
  });
});

describe('a leg of three units: the source reaches the translation', () => {
  it('hands each snapshot of a source over: nothing stable until the unit says so, all of it at the close', async () => {
    const h = leg();
    await h.starting;
    const e = h.heard();
    e.segmentOpened({ ref: 1, side: 'source', origin: 'u1' });
    e.segmentText({ ref: 1, text: 'Hello. How' });
    e.segmentText({ ref: 1, text: 'Hello. How are', heard: { pieces: [], stableLen: 6 }, language: 'en' });
    // A snapshot that states no `heard` keeps what was said to be stable.
    e.segmentText({ ref: 1, text: 'Hello. How are you' });
    e.segmentClosed({ ref: 1, origin: 'u1' });
    expect(h.translation.sessions[0].sources).toEqual([
      { origin: 'u1', text: 'Hello. How', stableLen: 0, closed: false },
      { origin: 'u1', text: 'Hello. How are', stableLen: 6, closed: false, language: 'en' },
      { origin: 'u1', text: 'Hello. How are you', stableLen: 6, closed: false, language: 'en' },
      { origin: 'u1', text: 'Hello. How are you', stableLen: 18, closed: true, language: 'en' },
    ]);
  });

  it('holds a stable length to the text it came with', async () => {
    const h = leg();
    await h.starting;
    const e = h.heard();
    e.segmentOpened({ ref: 1, side: 'source', origin: 'u1' });
    e.segmentText({ ref: 1, text: 'Hello', heard: { pieces: [], stableLen: 9 } });
    e.segmentText({ ref: 1, text: 'Hel' });
    expect(h.translation.sessions[0].sources.map((s) => s.stableLen)).toEqual([5, 3]);
  });

  it('hands the source over after it is on its row: a translation that answers at once finds its source', async () => {
    const h = leg();
    await h.starting;
    const order: string[] = [];
    const real = h.rec.log.push.bind(h.rec.log);
    h.rec.log.push = (...entries) => { order.push(...entries.map((x) => x.kind)); return real(...entries); };
    hear(h.heard(), 1, 'Hello.', 'u1');
    expect(order).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
    expect(named(h.calls).slice(-2)).toEqual(['translation.source', 'translation.source']);
  });

  it('states an origin for a source whose unit states none, on the row and to the translation alike', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 7, 'Hello.');
    const [opened] = h.of('segmentOpened');
    expect(opened).toEqual({ ref: 1, side: 'source', origin: 'composite-1' });
    expect(h.of('segmentClosed')).toEqual([{ ref: 1, origin: 'composite-1' }]);
    expect(h.translation.sessions[0].sources.map((s) => s.origin)).toEqual(['composite-1', 'composite-1']);
  });

  it('an origin it states can never be one a unit states: a unit\'s origin that looks like one is told apart', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 7, 'Hello.');
    hear(h.heard(), 8, 'Bye.', 'composite-1');
    hear(h.heard(), 9, 'Again.', 'composite-=composite-1');
    const rows = h.of('segmentOpened').map((e) => e.origin);
    expect(rows).toEqual(['composite-1', 'composite-=composite-1', 'composite-=composite-=composite-1']);
    expect(h.of('segmentClosed').map((e) => e.origin)).toEqual(rows);
    // The translation is handed each under the origin its row has: three sources, none taken for another.
    expect(h.translation.sessions[0].sources.filter((s) => s.closed).map((s) => s.origin)).toEqual(rows);
  });

  it('typed text, audio, the turns and agent text are the transcription session\'s', async () => {
    const agentText = vi.fn(() => true);
    const h = leg({ text: { session: { agentText } } });
    const session = await h.starting;
    h.calls.length = 0;
    const pcm = new Int16Array(4);
    session.appendAudio(pcm);
    session.appendText('typed');
    session.beginTurn();
    session.endTurn();
    session.cancelTurn();
    expect(session.agentText!('said', true)).toBe(true);
    expect(h.calls).toEqual([['text.appendAudio', pcm], ['text.appendText', 'typed'], ['text.beginTurn'], ['text.endTurn'], ['text.cancelTurn']]);
    expect(agentText).toHaveBeenCalledWith('said', true);
    expect(session.info).toBe(h.text.starts[0].session.info);
  });
});

describe('a leg of three units: one numbering of the leg\'s rows (spec §4.4)', () => {
  it('gives every segment a ref of the leg, whatever each unit calls its own', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    translate(h.translated(), 1, 'u1', 'こんにちは。');
    hear(h.heard(), 2, 'Bye.', 'u2');
    translate(h.translated(), 2, 'u2', 'さようなら。');
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'u1' },
      { ref: 2, side: 'translation', origin: 'u1' },
      { ref: 3, side: 'source', origin: 'u2' },
      { ref: 4, side: 'translation', origin: 'u2' },
    ]);
    expect(h.of('segmentText').map((e) => [e.ref, e.text])).toEqual([[1, 'Hello.'], [2, 'こんにちは。'], [3, 'Bye.'], [4, 'さようなら。']]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 1, origin: 'u1' }, { ref: 2, origin: 'u1' }, { ref: 3, origin: 'u2' }, { ref: 4, origin: 'u2' }]);
  });

  it('keeps a unit\'s ref on its row: a text that revises a closed source goes to the same row, and not to the translation again', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 5, 'Helo.', 'u1');
    translate(h.translated(), 9, 'u1', 'こんにちは。');
    const handed = h.translation.sessions[0].sources.length;
    h.heard().segmentText({ ref: 5, text: 'Hello.' });
    expect(h.of('segmentText').map((e) => [e.ref, e.text])).toEqual([[1, 'Helo.'], [2, 'こんにちは。'], [1, 'Hello.']]);
    expect(h.translation.sessions[0].sources).toHaveLength(handed);
  });

  it('the voice reads a translation by the leg\'s ref, and its audio and ranges come back on that row', async () => {
    const h = leg({ voice: { answers: true } });
    await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    translate(h.translated(), 1, 'u1', 'こんにちは。');
    expect(only(h.calls, 'voice.speak')).toEqual([['voice.speak', 'speaker', 2, 'こんにちは。', [0, 6], 'ja', undefined]]);
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2]]);
    h.voice.voices[0].events.speechRanges({ ref: 2, ranges: [{ index: 0, range: [0, 6] }] });
    expect(h.of('audio')).toEqual([expect.objectContaining({ ref: 2, range: [0, 6] })]);
    expect(h.of('speechRanges')).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 6] }] }]);
    // One counter of audio entries per row, by the leg's ref.
    expect(h.voice.voices[0].request.counts).toEqual(new Map([[2, 1]]));
  });

  it('a translation that grows is spoken as it becomes stable, in the language it states', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 1, 'Hello there.', 'u1');
    const e = h.translated();
    e.translationOpened({ ref: 1, origin: 'u1' });
    e.translationText({ ref: 1, text: 'こん', stableLen: 0 });
    e.translationText({ ref: 1, text: 'こんにちは', stableLen: 2, language: 'ja' });
    e.translationText({ ref: 1, text: 'こんにちは。', stableLen: 6 });
    e.translationClosed({ ref: 1 });
    expect(h.of('segmentText').slice(1)).toEqual([
      { ref: 2, text: 'こん', stableLen: 0 },
      { ref: 2, text: 'こんにちは', stableLen: 2, language: 'ja' },
      { ref: 2, text: 'こんにちは。', stableLen: 6 },
    ]);
    expect(only(h.calls, 'voice.speak').map((c) => c.slice(2, 5))).toEqual([[2, 'こん', [0, 2]], [2, 'にちは。', [2, 6]]]);
  });

  it('several translations of one source each get a row of their own under its origin, and are read in order', async () => {
    const h = leg();
    await h.starting;
    h.heard().segmentOpened({ ref: 1, side: 'source', origin: 'u1' });
    h.heard().segmentText({ ref: 1, text: 'One. Two', heard: { pieces: [], stableLen: 8 } });
    translate(h.translated(), 1, 'u1', 'いち。');
    h.heard().segmentText({ ref: 1, text: 'One. Two.' });
    h.heard().segmentClosed({ ref: 1, origin: 'u1' });
    translate(h.translated(), 2, 'u1', 'に。');
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'u1' },
      { ref: 2, side: 'translation', origin: 'u1' },
      { ref: 3, side: 'translation', origin: 'u1' },
    ]);
    expect(only(h.calls, 'voice.speak').map((c) => c.slice(2, 4))).toEqual([[2, 'いち。'], [3, 'に。']]);
  });

  it('forgets a translation\'s ref once it closed: whatever its unit says of it afterwards is nobody\'s row', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    translate(h.translated(), 1, 'u1', 'こんにちは。');
    const said = h.rec.log.length;
    h.translated().translationText({ ref: 1, text: 'こんにちは。', stableLen: 6 });
    h.translated().translationClosed({ ref: 1 });
    h.translated().translationClosed({ ref: 5 });
    expect(h.rec.log).toHaveLength(said);
    // A source's ref is kept: its unit may revise a closed row.
    h.heard().segmentText({ ref: 1, text: 'Hello!' });
    expect(h.of('segmentText').slice(-1)).toEqual([{ ref: 1, text: 'Hello!' }]);
  });

  it('a speaker corrected while the source is open is corrected on the translations it already has, and stated on those that come', async () => {
    const h = leg();
    await h.starting;
    h.heard().segmentOpened({ ref: 1, side: 'source', origin: 'u1', person: 'A' });
    h.heard().segmentText({ ref: 1, text: 'One. Two', heard: { pieces: [], stableLen: 8 } });
    translate(h.translated(), 1, 'u1', 'いち。');
    expect(h.of('segmentOpened')[1]).toEqual({ ref: 2, side: 'translation', origin: 'u1', person: 'A' });
    const said = h.of('segmentText').length;
    h.heard().segmentText({ ref: 1, text: 'One. Two.', person: 'B' });
    // The source's own text first, then the translation said again as it was, with who spoke it.
    expect(h.of('segmentText').slice(said)).toEqual([
      { ref: 1, text: 'One. Two.', person: 'B' },
      { ref: 2, text: 'いち。', stableLen: 3, person: 'B' },
    ]);
    // The same speaker again says nothing twice.
    h.heard().segmentText({ ref: 1, text: 'One. Two.', person: 'B' });
    expect(h.of('segmentText')).toHaveLength(said + 3);
    h.heard().segmentClosed({ ref: 1, origin: 'u1' });
    translate(h.translated(), 2, 'u1', 'に。');
    expect(h.of('segmentOpened')[2]).toEqual({ ref: 3, side: 'translation', origin: 'u1', person: 'B' });
    expect(h.of('segmentText').slice(-1)).toEqual([{ ref: 3, text: 'に。', stableLen: 2, person: 'B' }]);
    // Nothing is read twice for it.
    expect(only(h.calls, 'voice.speak').map((c) => c.slice(2, 4))).toEqual([[2, 'いち。'], [3, 'に。']]);
  });

  it('a translation says who spoke its source, when the unit that transcribes tells people apart', async () => {
    const h = leg();
    await h.starting;
    h.heard().segmentOpened({ ref: 1, side: 'source', origin: 'u1', person: 'A' });
    h.heard().segmentText({ ref: 1, text: 'Hello.', person: 'B' });
    h.heard().segmentClosed({ ref: 1, origin: 'u1' });
    translate(h.translated(), 1, 'u1', 'こんにちは。');
    expect(h.of('segmentOpened')[1]).toEqual({ ref: 2, side: 'translation', origin: 'u1', person: 'B' });
  });
});

describe('a leg of three units: a unit that transcribes emits no translation', () => {
  it('throws in a development or test build, where the break is the developer\'s to see', async () => {
    const h = leg();
    await h.starting;
    expect(() => h.heard().segmentOpened({ ref: 1, side: 'translation' })).toThrow(/emitted a translation/);
    expect(() => h.heard().lateSpeech!({ ref: 1, text: 'x', span: [0, 1], language: 'ja' })).toThrow(/emitted a translation/);
  });

  it('elsewhere drops the segment and all that follows for it, and says so once in the Logs', async () => {
    vi.stubEnv('DEV', false);
    const h = leg();
    await h.starting;
    const e = h.heard();
    e.segmentOpened({ ref: 1, side: 'translation', origin: 'u1' });
    e.segmentText({ ref: 1, text: 'こんにちは。', stableLen: 6 });
    e.segmentClosed({ ref: 1, origin: 'u1' });
    e.lateSpeech!({ ref: 1, text: 'x', span: [6, 7], language: 'ja' });
    e.segmentOpened({ ref: 2, side: 'translation' });
    expect(h.rec.log).toEqual([{ kind: 'frame', payload: { direction: 'in', type: 'composite.unexpected_translation', payload: { event: 'segmentOpened' }, runStage: 'transcription' } }]);
    expect(only(h.calls, 'voice.speak')).toEqual([]);
    expect(only(h.calls, 'translation.source')).toEqual([]);
  });

  it('its audio is dropped and said once in the Logs, as a text unit\'s is', async () => {
    const h = leg();
    await h.starting;
    h.heard().audio({ pcm: new Int16Array(2), ref: 1 });
    h.heard().speechRanges({ ref: 1, ranges: [] });
    expect(h.rec.log).toEqual([{ kind: 'frame', payload: { direction: 'in', type: 'composite.unexpected_audio', payload: { event: 'audio' } } }]);
  });
});

describe('a leg of three units: failure (spec §7.5)', () => {
  it('the translation failing fails the leg: transcription is stopped, speech closed, and nothing follows', async () => {
    const h = leg({ voice: { answers: true } });
    await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    h.calls.length = 0;
    const cause = new Error('gone');
    h.translated().failed({ message: 'The model is gone.', code: 'model_lost', cause });
    expect(named(h.calls)).toEqual(['text.stop', 'translation.stop', 'voice.close']);
    expect(h.rec.log.slice(-1)).toEqual([{ kind: 'failed', payload: { message: 'The model is gone.', code: 'model_lost', cause, runStage: 'translation' } }]);
    const said = h.rec.log.length;
    // Whatever any unit says afterwards is dropped.
    hear(h.heard(), 2, 'More.', 'u2');
    h.heard().degraded({ code: 'tts_degraded', message: 'late' });
    h.heard().failed({ message: 'stopped' });
    translate(h.translated(), 1, 'u1', 'こんにちは。');
    h.translated().failed({ message: 'again' });
    h.voice.voices[0].audio(2);
    expect(h.rec.log).toHaveLength(said);
    expect(only(h.calls, 'translation.source')).toEqual([]);
  });

  it('a transcription stop that throws or rejects while the leg fails is not the leg\'s failure', async () => {
    const h = leg({ text: { session: { stop: () => Promise.reject(new Error('stuck')) } } });
    await h.starting;
    h.translated().failed({ message: 'The model is gone.' });
    await flush();
    expect(h.said().filter((k) => k === 'failed')).toHaveLength(1);
  });

  it('the transcription failing or closing fails the leg as today: translation is stopped and speech closed', async () => {
    for (const ending of ['failed', 'closed'] as const) {
      const h = leg();
      await h.starting;
      h.calls.length = 0;
      if (ending === 'failed') h.heard().failed({ message: 'socket' });
      else h.heard().closed({ reason: 'server' });
      expect(named(h.calls)).toEqual(['translation.stop', 'voice.close']);
      expect(h.rec.log.slice(-1)).toEqual([ending === 'failed'
        ? { kind: 'failed', payload: { message: 'socket', runStage: 'transcription' } }
        : { kind: 'closed', payload: { reason: 'server' } }]);
      const said = h.rec.log.length;
      translate(h.translated(), 1, 'u1', 'late');
      h.translated().degraded({ code: 'translation_failed', message: 'late' });
      expect(h.rec.log).toHaveLength(said);
    }
  });

  it('a job that fails degrades the leg and names its stage; the leg goes on', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    h.translated().degraded({ code: 'translation_failed', message: 'A sentence could not be translated.', reason: 'http_500' });
    hear(h.heard(), 2, 'Bye.', 'u2');
    translate(h.translated(), 1, 'u2', 'さようなら。');
    expect(h.of('degraded')).toEqual([{ code: 'translation_failed', message: 'A sentence could not be translated.', reason: 'http_500', runStage: 'translation' }]);
    expect(h.of('segmentOpened').map((e) => [e.side, e.origin])).toEqual([['source', 'u1'], ['source', 'u2'], ['translation', 'u2']]);
    expect(h.said()).not.toContain('failed');
  });

  it('a translation that cannot open fails the start: speech is closed and transcription never starts', async () => {
    const refused = new AdapterStartError('No model for this pair.', 'translation_unavailable');
    const h = leg({ translation: { openFails: refused } });
    await expect(h.starting).rejects.toBe(refused);
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'translation.open', 'translation.stop', 'voice.close']);
    expect(h.rec.log).toEqual([]);
  });

  it('a voice that throws as it is closed does not take the place of the refusal', async () => {
    const refused = new AdapterStartError('No model for this pair.', 'translation_unavailable');
    const h = leg({ translation: { openFails: refused }, voice: { closeFails: new Error('voice stuck') } });
    await expect(h.starting).rejects.toBe(refused);
    expect(named(h.calls).slice(-2)).toEqual(['translation.stop', 'voice.close']);
  });

  it('a translation unit that throws as it starts fails the start the same way', async () => {
    const broken = new Error('no worker');
    const h = leg({ translation: { fails: broken } });
    await expect(h.starting).rejects.toBe(broken);
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'voice.close']);
  });

  it('a transcription that cannot start fails the start with its own error: translation is stopped and speech closed', async () => {
    const refused = new AdapterStartError('Bad key.', 'invalid_key');
    const h = leg({ text: { fails: refused } });
    await expect(h.starting).rejects.toBe(refused);
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'translation.open', 'text.start', 'translation.stop', 'voice.close']);
  });

  it('a translation that fails while the leg is still starting fails the start, not a leg that never opened', async () => {
    const h = leg({ text: { held: true } });
    await flush();
    h.translated().failed({ message: 'The model is gone.', code: 'model_lost' });
    // At once: the transcription's start is cancelled, not waited for.
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ message: 'The model is gone.', code: 'model_lost' });
    expect(h.text.starts[0].request.signal.aborted).toBe(true);
    expect(h.said()).not.toContain('failed');
    expect(named(h.calls).slice(-2)).toEqual(['translation.stop', 'voice.close']);
  });

  it('a transcription that opens after the start was given up is stopped, and one that then rejects changes nothing', async () => {
    const h = leg({ text: { deaf: true } });
    await flush();
    const cause = new Error('gone');
    h.translated().failed({ message: 'The model is gone.', cause });
    await expect(h.starting).rejects.toBe(cause);
    expect(named(h.calls)).not.toContain('text.stop');
    h.text.starts[0].open();
    await flush();
    expect(named(h.calls).slice(-1)).toEqual(['text.stop']);
    // Whatever it says is nobody's.
    hear(h.heard(), 1, 'Hello.', 'u1');
    expect(h.rec.log).toEqual([]);

    const other = leg({ text: { deaf: true } });
    await flush();
    other.translated().failed({ message: 'The model is gone.', cause });
    other.text.starts[0].refuse(new Error('socket'));
    await expect(other.starting).rejects.toBe(cause);
  });

  it('a translation that fails while it is still opening fails the start at once', async () => {
    const h = leg({ translation: { held: true } });
    await flush();
    h.translated().failed({ message: 'The model is gone.', code: 'model_lost' });
    await expect(h.starting).rejects.toMatchObject({ message: 'The model is gone.', code: 'model_lost' });
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'translation.open', 'translation.stop', 'voice.close']);
  });

  it('a run cancelled while the translation opens rejects the start with the run\'s reason: nothing is started after it', async () => {
    const h = leg({ translation: { held: true } });
    await flush();
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(named(h.calls)).toEqual(['voice.start', 'voice.open', 'translation.start', 'translation.open', 'translation.stop', 'voice.close']);
    // The open comes through late: still no transcription.
    h.translation.sessions[0].open();
    await flush();
    expect(named(h.calls)).not.toContain('text.start');
  });

  it('a run that was cancelled before the leg starts nothing but the voice it closes', async () => {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls);
    const translation = stubTranslationUnit(calls);
    const voice = stubSpeechUnit(calls);
    const plan = separatePlan(text.planned, translation.planned, voice.planned);
    const cancelled = new AbortController();
    const reason = new Error('cancelled');
    cancelled.abort(reason);
    const starting = startComposite(plan, { context: SPEAKS, config: new Map(), credentials: () => undefined, clock: createVirtualClock(0), signal: cancelled.signal }, recordEvents().events);
    await expect(starting).rejects.toBe(reason);
    expect(named(calls)).toEqual(['voice.start', 'voice.open', 'voice.close']);
  });

  it('speech lost degrades the leg and names its stage; the subtitles go on', async () => {
    const h = leg();
    await h.starting;
    h.voice.voices[0].events.degraded({ code: 'tts_degraded', message: 'The voice is gone.' });
    h.voice.voices[0].events.frame({ direction: 'in', type: 'voice.closed' });
    expect(h.rec.log).toEqual([
      { kind: 'degraded', payload: { code: 'tts_degraded', message: 'The voice is gone.', runStage: 'speech' } },
      { kind: 'frame', payload: { direction: 'in', type: 'voice.closed', runStage: 'speech' } },
    ]);
    hear(h.heard(), 1, 'Hello.', 'u1');
    expect(h.said()).toContain('segmentOpened');
  });

  it('a speech unit that cannot start is said once the leg is open, with its stage', async () => {
    const h = leg({ voice: { fails: new Error('no voice') } });
    await h.starting;
    expect(h.of('degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded', runStage: 'speech' })]);
  });
});

describe('a leg of three units: every lifecycle event says its stage', () => {
  it('tags what the transcription and the translation say of themselves, and leaves the payload otherwise as it was', async () => {
    const h = leg();
    await h.starting;
    h.heard().degraded({ code: 'transcription_failed', message: 'One utterance was lost.' });
    h.heard().loading({ stage: 'asr', done: 1, total: 2 });
    h.heard().frame({ direction: 'in', type: 'stt.token', payload: { n: 1 } });
    h.translated().loading({ stage: 'model', done: 1, total: 2 });
    h.translated().frame({ direction: 'out', type: 'translation.job' });
    h.heard().busy(true);
    expect(h.rec.log).toEqual([
      { kind: 'degraded', payload: { code: 'transcription_failed', message: 'One utterance was lost.', runStage: 'transcription' } },
      { kind: 'loading', payload: { stage: 'asr', done: 1, total: 2, runStage: 'transcription' } },
      { kind: 'frame', payload: { direction: 'in', type: 'stt.token', payload: { n: 1 }, runStage: 'transcription' } },
      { kind: 'loading', payload: { stage: 'model', done: 1, total: 2, runStage: 'translation' } },
      { kind: 'frame', payload: { direction: 'out', type: 'translation.job', runStage: 'translation' } },
      { kind: 'busy', payload: true },
    ]);
  });

  it('says what the translation loads while the leg is still starting', async () => {
    const h = leg({ translation: { held: true } });
    await flush();
    h.translated().loading({ stage: 'model', done: 0, total: 1 });
    expect(h.of('loading')).toEqual([{ stage: 'model', done: 0, total: 1, runStage: 'translation' }]);
    h.translation.sessions[0].open();
    await h.starting;
  });
});

describe('a leg of three units: the transcription reconnects', () => {
  it('reconnecting and reconnected are the leg\'s, as the transcription says them; the voice is let go on the return', async () => {
    const h = leg();
    await h.starting;
    h.calls.length = 0;
    h.heard().reconnecting({ attempt: 1 });
    h.heard().reconnected();
    expect(h.rec.log).toEqual([{ kind: 'reconnecting', payload: { attempt: 1 } }, { kind: 'reconnected', payload: undefined }]);
    expect(named(h.calls)).toEqual(['voice.recycle']);
  });

  it('a source still open when the connection drops reaches the translation as closed, once, with what was heard', async () => {
    const h = leg();
    await h.starting;
    const e = h.heard();
    e.segmentOpened({ ref: 1, side: 'source', origin: 'u1' });
    e.segmentText({ ref: 1, text: 'Hello. How are', heard: { pieces: [], stableLen: 6 } });
    e.reconnecting({ attempt: 1 });
    expect(h.translation.sessions[0].sources.slice(-1)).toEqual([{ origin: 'u1', text: 'Hello. How are', stableLen: 14, closed: true }]);
    const handed = h.translation.sessions[0].sources.length;
    // The unit closes it as it stands, or goes on with it: either way the translation has had its last word of it.
    e.segmentText({ ref: 1, text: 'Hello. How are you' });
    e.segmentClosed({ ref: 1, origin: 'u1' });
    e.reconnected();
    expect(h.translation.sessions[0].sources).toHaveLength(handed);
    // The row is the unit's: it closes when the unit closes it, with the text the unit last said.
    expect(h.of('segmentText').slice(-1)).toEqual([{ ref: 1, text: 'Hello. How are you' }]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 1, origin: 'u1' }]);
  });

  it('says no reconnecting once the translation has failed on what it was handed then', async () => {
    const h: ReturnType<typeof leg> = leg({ translation: { session: { source: (snapshot) => { if (snapshot.closed) h.translated().failed({ message: 'The model is gone.' }); } } } });
    await h.starting;
    h.heard().segmentOpened({ ref: 1, side: 'source', origin: 'u1' });
    h.heard().segmentText({ ref: 1, text: 'Hello. How are' });
    h.heard().reconnecting({ attempt: 1 });
    expect(h.said().slice(-1)).toEqual(['failed']);
    expect(h.said()).not.toContain('reconnecting');
  });

  it('a source the unit closed before it said reconnecting is handed over once, at its close', async () => {
    const h = leg();
    await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    const handed = h.translation.sessions[0].sources.length;
    h.heard().reconnecting({ attempt: 1 });
    expect(h.translation.sessions[0].sources).toHaveLength(handed);
  });

  it('a source that opens after the return is translated as any other', async () => {
    const h = leg();
    await h.starting;
    h.heard().reconnecting({ attempt: 1 });
    h.heard().reconnected();
    hear(h.heard(), 2, 'Back.', 'u2');
    expect(h.translation.sessions[0].sources.slice(-1)).toEqual([{ origin: 'u2', text: 'Back.', stableLen: 5, closed: true }]);
  });
});

describe('a leg of three units: stopping', () => {
  it('says nothing of a translation that answers after the stop, but a frame the ending says of itself', async () => {
    let settle!: () => void;
    const stopped = new Promise<void>((resolve) => { settle = resolve; });
    const h = leg({ translation: { session: { stop: () => stopped } }, voice: { answers: true } });
    const session = await h.starting;
    hear(h.heard(), 1, 'Hello.', 'u1');
    const said = h.rec.log.length;
    const stopping = session.stop();
    translate(h.translated(), 1, 'u1', 'こんにちは。');
    h.translated().degraded({ code: 'translation_failed', message: 'late' });
    h.translated().failed({ message: 'late' });
    h.translated().frame({ direction: 'out', type: 'translation.bye' });
    expect(h.rec.log.slice(said)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'translation.bye', runStage: 'translation' } }]);
    settle();
    await stopping;
    h.translated().frame({ direction: 'out', type: 'translation.late' });
    expect(h.rec.log).toHaveLength(said + 1);
    expect(only(h.calls, 'voice.speak')).toEqual([]);
  });

  it('hands the translation nothing more once stopped', async () => {
    const h = leg();
    const session = await h.starting;
    await session.stop();
    hear(h.heard(), 1, 'Hello.', 'u1');
    expect(only(h.calls, 'translation.source')).toEqual([]);
  });

  it('switches the voice, and not the translation, when speech is switched', async () => {
    const h = leg();
    const session = await h.starting;
    h.calls.length = 0;
    session.setSpeech!(false);
    expect(h.calls).toEqual([['voice.setOn', 'speaker', false]]);
  });
});

describe('startCompositeBoth over three units: each leg on its own', () => {
  const CONTEXTS: Record<LegName, SessionContext> = {
    speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
    participant: { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' },
  };

  function both(o: { text?: Parameters<typeof stubTextUnit>[1]; translation?: Parameters<typeof stubTranslationUnit>[1]; failing?: LegName } = {}) {
    const calls: StubCalls = [];
    const startBoth = stubStartBoth(calls);
    const refused = new AdapterStartError('Bad key.', 'invalid_key');
    const text = stubTextUnit(calls, { ...o.text, provider: { session: { startBoth: startBoth.startBoth } } });
    // The start of one leg rejects, where a test says which; the other's resolves.
    const start = text.planned.unit.start!;
    const failing: PlannedUnit = { ...text.planned, unit: { ...text.planned.unit, start: (request, events) => (request.context.direction.source === CONTEXTS[o.failing!].direction.source ? Promise.reject(refused) : start(request, events)) } };
    const translation = stubTranslationUnit(calls, o.translation);
    const voice = stubSpeechUnit(calls, { answers: true });
    const plan = separatePlan(o.failing ? failing : text.planned, translation.planned, voice.planned);
    const clock = createVirtualClock(0);
    const signal = new AbortController().signal;
    const rec = { speaker: recordConformance(), participant: recordConformance() };
    const request = (name: LegName): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> => ({ context: CONTEXTS[name], config: new Map(plan.units.map((unit) => [unit, { leg: name }])), credentials: () => ({ leg: name }), clock, signal });
    const starting = startCompositeBoth(plan, { speaker: request('speaker'), participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events });
    const textOf = (name: LegName) => text.starts.find((s) => s.request.context.direction.source === CONTEXTS[name].direction.source)!;
    const translationOf = (name: LegName) => translation.sessions.find((s) => s.request.leg === name)!;
    const of = (name: LegName, kind: string) => rec[name].log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
    return { calls, startBoth, text, translation, voice, rec, starting, textOf, translationOf, of, refused };
  }

  it('starts a transcription, a translation and a voice per leg, each in the leg\'s direction, and not the provider\'s start of both', async () => {
    const h = both();
    const sessions = await h.starting;
    expect(named(h.calls)).not.toContain('text.startBoth');
    expect(h.text.starts).toHaveLength(2);
    expect(h.translation.sessions.map((s) => [s.request.leg, s.request.context.direction]).sort()).toEqual([
      ['participant', { source: 'ja', target: 'en' }],
      ['speaker', { source: 'en', target: 'ja' }],
    ]);
    expect(h.voice.voices.map((v) => v.request.leg).sort()).toEqual(['participant', 'speaker']);
    expect(h.textOf('speaker').request.config).toEqual({ leg: 'speaker' });
    expect(h.translationOf('participant').request.config).toEqual({ leg: 'participant' });
    // The legs share no connection, and say so.
    expect(sessions.speaker.info.shared).not.toBe(true);
    expect(h.voice.voices[0].request.counts).not.toBe(h.voice.voices[1].request.counts);
  });

  it('numbers each leg\'s rows on its own, and each leg\'s voice reads its own translations', async () => {
    const h = both();
    await h.starting;
    hear(h.textOf('speaker').events, 1, 'Hello.', 'u1');
    hear(h.textOf('participant').events, 1, 'はい。', 'u1');
    translate(h.translationOf('participant').events, 1, 'u1', 'Yes.');
    translate(h.translationOf('speaker').events, 1, 'u1', 'こんにちは。');
    expect(h.of('speaker', 'segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'translation', origin: 'u1' }]);
    expect(h.of('participant', 'segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'translation', origin: 'u1' }]);
    expect(only(h.calls, 'voice.speak')).toEqual([
      ['voice.speak', 'participant', 2, 'Yes.', [0, 4], 'en', undefined],
      ['voice.speak', 'speaker', 2, 'こんにちは。', [0, 6], 'ja', undefined],
    ]);
    expect(h.of('speaker', 'audio')).toEqual([expect.objectContaining({ ref: 2 })]);
    expect(h.of('participant', 'audio')).toEqual([expect.objectContaining({ ref: 2 })]);
    for (const name of ['speaker', 'participant'] as const) expect(checkConformance(h.rec[name].log, CONTEXTS[name])).toEqual([]);
  });

  it('a leg\'s stop ends that leg alone', async () => {
    const h = both();
    const sessions = await h.starting;
    h.calls.length = 0;
    await sessions.participant.stop();
    expect(h.calls).toEqual([['text.stop'], ['translation.stop', 'participant'], ['voice.close', 'participant']]);
    hear(h.textOf('speaker').events, 1, 'Hello.', 'u1');
    expect(h.of('speaker', 'segmentOpened')).toHaveLength(1);
  });

  it('a leg that cannot start fails the start naming it, and the leg that did start is stopped', async () => {
    const h = both({ failing: 'participant' });
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LegStartError);
    expect(error).toMatchObject({ leg: 'participant', cause: h.refused });
    expect(only(h.calls, 'text.stop')).toHaveLength(1);
    expect(only(h.calls, 'translation.stop').map((c) => c[1]).sort()).toEqual(['participant', 'speaker']);
    expect(only(h.calls, 'voice.close').map((c) => c[1]).sort()).toEqual(['participant', 'speaker']);
  });

  it('a leg that cannot start cancels the other while it is still opening: the start rejects with the first leg\'s error, without waiting', async () => {
    const h = both({ translation: { held: true } });
    await flush();
    const refused = new AdapterStartError('No model for this pair.', 'translation_unavailable');
    h.translationOf('participant').refuse(refused);
    // The speaker's translation never opens: it is cancelled, not waited for.
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LegStartError);
    expect(error).toMatchObject({ leg: 'participant', cause: refused });
    expect(h.translationOf('speaker').request.signal.aborted).toBe(true);
    expect(only(h.calls, 'translation.stop').map((c) => c[1]).sort()).toEqual(['participant', 'speaker']);
    expect(only(h.calls, 'voice.close').map((c) => c[1]).sort()).toEqual(['participant', 'speaker']);
    expect(named(h.calls)).not.toContain('text.start');
  });

  it('the leg that failed first is the one named, when the other fails after it', async () => {
    const h = both({ translation: { held: true } });
    await flush();
    const refused = new Error('first');
    h.translationOf('participant').refuse(refused);
    h.translationOf('speaker').refuse(new Error('second'));
    await expect(h.starting).rejects.toMatchObject({ leg: 'participant', cause: refused });
  });
});

describe('a leg of three units is an adapter (spec §4.4)', () => {
  interface Scenario { plan: RunPlan; text: ReturnType<typeof stubTextUnit>; voice: ReturnType<typeof stubSpeechUnit>; translation: TranslationSession | null }
  let now!: Scenario;
  let ref = 0;
  let over = false;
  const say = (emit: (e: AdapterEvents) => void) => { if (!over) emit(now.text.starts[0].events); };

  const harness: AdapterHarness<Scenario, undefined> = {
    adapter: { start: (request, sink) => startComposite(request.config.plan, { ...request, config: new Map(), credentials: () => undefined }, sink) },
    config: () => {
      over = false;
      ref = 0;
      const scenario: Scenario = {
        plan: undefined as unknown as RunPlan,
        // Typed text is the transcription's: it shows it as a source, which is translated as any source is.
        text: stubTextUnit([], { held: true, session: { stop: async () => { over = true; }, networkRestored: () => {}, appendText: (typed) => say((e) => {
          const source = ++ref;
          e.segmentOpened({ ref: source, side: 'source', origin: `t${source}` });
          e.segmentText({ ref: source, text: typed });
          e.segmentClosed({ ref: source, origin: `t${source}` });
        }) } }),
        voice: stubSpeechUnit([], { answers: true }),
        translation: null,
      };
      // A real job translator over a `translate` that answers at once.
      const translation = stubTranslationUnit();
      translation.planned.unit.startTranslation = (request, events) => (scenario.translation = createJobTranslator({ translate: async (text) => `«${text}»`, events, clock: request.clock, signal: request.signal }));
      scenario.plan = separatePlan(scenario.text.planned, translation.planned, scenario.voice.planned);
      now = scenario;
      return scenario;
    },
    credentials: undefined,
    opening: () => [{ flush: true }, { run: () => now.text.starts[0].open() }],
    exchange: [
      { run: () => say((e) => {
        const source = ++ref;
        e.segmentOpened({ ref: source, side: 'source', origin: `u${source}` });
        e.segmentText({ ref: source, text: 'Hello. How', heard: { pieces: [], stableLen: 10 } });
        e.segmentText({ ref: source, text: 'Hello. How are you?' });
        e.segmentClosed({ ref: source, origin: `u${source}` });
      }) },
      { flush: true },
    ],
    serverClose: [{ run: () => say((e) => { over = true; e.closed({ reason: 'server' }); }) }],
    refuse: [{ flush: true }, { run: () => now.text.starts[0].refuse(new AdapterStartError('Refused.', 'invalid_key')) }],
    answerText: [{ flush: true }],
    reconnect: [{ run: () => say((e) => { e.reconnecting({ attempt: 1 }); e.reconnected(); }) }],
  };

  it('runs every scenario of the suite, typed text included', () => {
    expect(scenarioNames(harness)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'text', 'server-close', 'reconnect']);
  });

  it.each(scenarioNames(harness))('%s', async (name) => {
    const report = await runScenario(harness, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('the exchange is translated a sentence at a time and spoken: two translations under the source\'s origin, each with audio', async () => {
    const rec = recordEvents();
    const scenario = harness.config(SPEAKS, 'open-stop');
    const starting = harness.adapter.start({ context: SPEAKS, config: scenario, credentials: undefined, clock: createVirtualClock(0), signal: new AbortController().signal }, rec.events);
    await flush();
    scenario.text.starts[0].open();
    const session: AdapterSession = await starting;
    for (const step of harness.exchange) if ('run' in step) await step.run({ session, clock: createVirtualClock(0), log: [] });
    await flush();
    const opened = rec.log.filter((e) => e.kind === 'segmentOpened').map((e) => e.payload);
    expect(opened).toEqual([
      { ref: 1, side: 'source', origin: 'u1' },
      { ref: 2, side: 'translation', origin: 'u1' },
      { ref: 3, side: 'translation', origin: 'u1' },
    ]);
    expect(rec.log.filter((e) => e.kind === 'segmentText').slice(-2).map((e) => e.payload)).toEqual([
      { ref: 2, text: '«Hello.»', stableLen: 8 },
      { ref: 3, text: '«How are you?»', stableLen: 14 },
    ]);
    expect(rec.log.filter((e) => e.kind === 'audio').map((e) => (e.payload as { ref: number }).ref)).toEqual([2, 3]);
  });
});
