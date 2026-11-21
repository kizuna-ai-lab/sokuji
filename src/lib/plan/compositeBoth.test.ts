// src/lib/plan/compositeBoth.test.ts
import { describe, expect, it } from 'vitest';
import { AdapterStartError, LegStartError } from '../contract/adapter';
import type { AdapterEvents, SessionContext, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { checkConformance, recordConformance } from '../contract/conformance';
import type { LegName } from '../conversation/types';
import type { PlanConfigs } from './composite';
import { startCompositeBoth } from './compositeBoth';
import { stubSpeechUnit, stubStartBoth, stubTextUnit, textAndSpeechPlan, type StubCalls } from './testing';
import type { PlannedUnit } from './types';

const LEGS: readonly LegName[] = ['speaker', 'participant'];
/** The speaker hears English and is answered in Japanese; the participant the other way round. */
const CONTEXTS: Record<LegName, SessionContext> = {
  speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
  participant: { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' },
};
const named = (calls: StubCalls) => calls.map((c) => c[0]);
const only = (calls: StubCalls, ...what: string[]) => calls.filter((c) => what.includes(c[0] as string));

interface Options {
  shared?: boolean;
  /** The legs that speak; both by default. */
  speaks?: readonly LegName[];
  voice?: Parameters<typeof stubSpeechUnit>[1];
  fails?: unknown;
  /** What a leg's text session says while the legs start. */
  during?: (events: Record<LegName, AdapterEvents>) => void;
}

/** Both legs over a stub text provider that starts both and a stub speech unit, started. */
async function both(o: Options = {}) {
  const calls: StubCalls = [];
  const text = stubStartBoth(calls, { shared: o.shared ?? true, fails: o.fails, during: o.during });
  const textUnit = stubTextUnit(calls, { provider: { session: { startBoth: text.startBoth } } });
  const voice = stubSpeechUnit(calls, { answers: true, ...o.voice });
  const plan = textAndSpeechPlan(textUnit.planned, voice.planned);
  const clock = createVirtualClock(0);
  const signal = new AbortController().signal;
  const rec = { speaker: recordConformance(), participant: recordConformance() };
  const contexts = Object.fromEntries(LEGS.map((leg) => [leg, { ...CONTEXTS[leg], speech: (o.speaks ?? LEGS).includes(leg) }])) as Record<LegName, SessionContext>;
  const request = (leg: LegName): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> => ({
    context: contexts[leg],
    config: new Map<PlannedUnit, unknown>([[textUnit.planned, { unit: 'text', leg }], [voice.planned, { unit: 'voice', leg }]]),
    credentials: (unit) => ({ key: unit === textUnit.planned ? 'text' : 'voice', leg }),
    clock,
    signal,
  });
  const requests = { speaker: request('speaker'), participant: request('participant') };
  const starting = startCompositeBoth(plan, requests, { speaker: rec.speaker.events, participant: rec.participant.events });
  const failure = await starting.then(() => null, (error: unknown) => error);
  const sessions = failure === null ? await starting : null;
  const emit = (leg: LegName): AdapterEvents => text.started[0].events[leg];
  const voiceOf = (leg: LegName) => voice.voices.find((v) => v.request.leg === leg);
  const of = (leg: LegName, kind: string) => rec[leg].log.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);
  return { calls, text, voice, plan, requests, contexts, rec, sessions: sessions!, failure, emit, voiceOf, of };
}

/** A translation segment said whole and closed. */
function translate(events: AdapterEvents, ref: number, text: string, language?: string) {
  events.segmentOpened({ ref, side: 'translation' });
  events.segmentText({ ref, text, stableLen: text.length, ...(language ? { language } : {}) });
  events.segmentClosed({ ref });
}

describe('startCompositeBoth: what can start', () => {
  it('rejects with plan_unsupported when the text provider cannot start both legs', async () => {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls);
    const voice = stubSpeechUnit(calls);
    const request = { context: CONTEXTS.speaker, config: new Map(), credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal };
    const rec = recordConformance();
    const starting = startCompositeBoth(textAndSpeechPlan(text.planned, voice.planned), { speaker: request, participant: request }, { speaker: rec.events, participant: rec.events });
    await expect(starting).rejects.toBeInstanceOf(AdapterStartError);
    await expect(starting).rejects.toMatchObject({ code: 'plan_unsupported' });
    expect(calls).toEqual([]);
  });

  it('rejects with plan_unsupported for a plan that is not a text unit and a speech unit', async () => {
    const calls: StubCalls = [];
    const text = stubTextUnit(calls, { provider: { session: { startBoth: stubStartBoth(calls).startBoth } } });
    const plan = { units: [text.planned], byStage: { transcription: text.planned, translation: text.planned, speech: text.planned } };
    const request = { context: CONTEXTS.speaker, config: new Map(), credentials: () => ({}), clock: createVirtualClock(0), signal: new AbortController().signal };
    const rec = recordConformance();
    await expect(startCompositeBoth(plan, { speaker: request, participant: request }, { speaker: rec.events, participant: rec.events })).rejects.toMatchObject({ code: 'plan_unsupported' });
    expect(calls).toEqual([]);
  });
});

describe('startCompositeBoth: start and stop', () => {
  it("starts the text provider's both legs once, each on its own config and credentials and a context that does not speak", async () => {
    const h = await both();
    expect(only(h.calls, 'text.startBoth')).toHaveLength(1);
    const { requests } = h.text.started[0];
    for (const leg of LEGS) {
      expect(requests[leg]).toMatchObject({
        context: { ...CONTEXTS[leg], speech: false }, config: { unit: 'text', leg }, credentials: { key: 'text', leg }, clock: h.requests[leg].clock, signal: h.requests[leg].signal,
      });
    }
  });

  it('starts one speech session per speaking leg, opened and not awaited, each on its own config, credentials and context', async () => {
    const h = await both();
    expect(named(h.calls)).toEqual(['text.startBoth', 'voice.start', 'voice.open', 'voice.start', 'voice.open']);
    for (const leg of LEGS) {
      expect(h.voiceOf(leg)!.request).toMatchObject({ leg, context: CONTEXTS[leg], config: { unit: 'voice', leg }, credentials: { key: 'voice', leg } });
    }
  });

  it('starts no speech session for a leg that does not speak', async () => {
    const h = await both({ speaks: ['speaker'] });
    expect(h.voice.voices.map((v) => v.request.leg)).toEqual(['speaker']);
  });

  it.each([
    ['failed', (e: AdapterEvents) => e.failed({ message: 'gone' })],
    ['closed', (e: AdapterEvents) => e.closed({ reason: 'server' })],
  ] as const)("starts no voice for a leg whose text session %s while the legs were starting; the other leg's voice still starts", async (kind, end) => {
    for (const shared of [true, false]) {
      const h = await both({ shared, during: (events) => end(events.speaker) });
      expect(named(h.calls)).toEqual(['text.startBoth', 'voice.start', 'voice.open']);
      expect(h.voice.voices.map((v) => v.request.leg)).toEqual(['participant']);
      expect(h.rec.speaker.log.map((e) => e.kind)).toEqual([kind]);
      translate(h.emit('participant'), 2, 'Good morning.');
      expect(h.of('participant', 'audio')).toHaveLength(1);
      await h.sessions.participant.stop();
      expect(only(h.calls, 'voice.close')).toEqual([['voice.close', 'participant']]);
    }
  });

  it('gives both voices one count of audio entries when the legs share a connection, and each its own when they do not', async () => {
    const shared = await both({ shared: true });
    expect(shared.voiceOf('speaker')!.request.counts).toBe(shared.voiceOf('participant')!.request.counts);
    const split = await both({ shared: false });
    expect(split.voiceOf('speaker')!.request.counts).not.toBe(split.voiceOf('participant')!.request.counts);
  });

  it("rejects with the text provider's own error, starting no voice", async () => {
    const error = new LegStartError('speaker', new AdapterStartError('No such key.', 'invalid_key'));
    const h = await both({ fails: error });
    expect(h.failure).toBe(error);
    expect(named(h.calls)).toEqual(['text.startBoth']);
    expect(h.rec.speaker.log).toEqual([]);
    expect(h.rec.participant.log).toEqual([]);
  });

  it("answers with each leg's text session behind its own facade: audio in and info are the text session's, setSpeech the leg's voice", async () => {
    const h = await both();
    h.calls.length = 0;
    const pcm = new Int16Array(8);
    h.sessions.participant.appendAudio(pcm);
    h.sessions.participant.setSpeech!(false);
    h.sessions.speaker.endTurn();
    expect(h.calls).toEqual([['text.appendAudio', 'participant', pcm], ['voice.setOn', 'participant', false], ['text.endTurn', 'speaker']]);
    expect(h.sessions.speaker.info).toBe(h.text.started[0].sessions.speaker.info);
    expect(h.sessions.speaker.info.shared).toBe(true);
  });

  it('shared: stopping either leg stops its text session, then closes both voices; the other stop closes nothing twice', async () => {
    const h = await both();
    h.calls.length = 0;
    const stopping = h.sessions.participant.stop();
    expect(h.calls).toEqual([['text.stop', 'participant'], ['voice.close', 'speaker'], ['voice.close', 'participant']]);
    await stopping;
    await h.sessions.speaker.stop();
    expect(h.calls).toEqual([['text.stop', 'participant'], ['voice.close', 'speaker'], ['voice.close', 'participant'], ['text.stop', 'speaker']]);
  });

  it('split: stopping a leg stops its text session, then closes its own voice only', async () => {
    const h = await both({ shared: false });
    h.calls.length = 0;
    await h.sessions.speaker.stop();
    expect(h.calls).toEqual([['text.stop', 'speaker'], ['voice.close', 'speaker']]);
    translate(h.emit('participant'), 2, 'It is fine.');
    expect(h.of('participant', 'audio')).toHaveLength(1);
  });

  it('says tts_degraded on the leg whose speech unit cannot start, and goes on', async () => {
    const h = await both({ voice: { fails: new Error('no model') } });
    for (const leg of LEGS) expect(h.of(leg, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    translate(h.emit('speaker'), 2, 'こんにちは。');
    expect(h.rec.speaker.log.map((e) => e.kind)).toEqual(['degraded', 'segmentOpened', 'segmentText', 'segmentClosed']);
  });
});

describe('startCompositeBoth: which voice reads a translation (spec §7.2)', () => {
  it("a translation into the leg's own target is read by that leg's voice, on its own row, naming no voice", async () => {
    const h = await both();
    translate(h.emit('speaker'), 2, 'おはよう。');
    translate(h.emit('participant'), 4, 'Good morning.', 'en');
    expect(only(h.calls, 'voice.speak', 'voice.endUtterance')).toEqual([
      ['voice.speak', 'speaker', 2, 'おはよう。', [0, 5], 'ja', undefined],
      ['voice.endUtterance', 'speaker', 2],
      ['voice.speak', 'participant', 4, 'Good morning.', [0, 13], 'en', undefined],
      ['voice.endUtterance', 'participant', 4],
    ]);
    expect(h.of('speaker', 'audio')).toEqual([{ pcm: expect.any(Int16Array), ref: 2, range: [0, 5] }]);
    expect(h.of('participant', 'audio')).toEqual([{ pcm: expect.any(Int16Array), ref: 4, range: [0, 13] }]);
  });

  it("shared: a translation into the speaker's own language is read by the participant's voice, on the speaker's row, naming that voice; the speaker's leg speaks on after it", async () => {
    const h = await both();
    // The speaker's source is 'en'; they said a Japanese line, translated into English — the participant leg's target.
    translate(h.emit('speaker'), 2, 'It is fine.', 'en');
    expect(only(h.calls, 'voice.speak')).toEqual([['voice.speak', 'participant', 2, 'It is fine.', [0, 11], 'en', 'speaker']]);
    // The utterance's end reaches the row's own voice and the voice that read it.
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2], ['voice.endUtterance', 'participant', 2]]);
    // Its audio comes back on the speaker's row, named with the participant's voice.
    expect(h.of('speaker', 'audio')).toEqual([{ pcm: expect.any(Int16Array), ref: 2, range: [0, 11], voice: 'participant' }]);
    expect(h.of('participant', 'audio')).toHaveLength(0);
    h.voiceOf('participant')!.events.speechRanges({ ref: 2, ranges: [{ index: 0, range: [0, 11] }], home: 'speaker' });
    expect(h.of('speaker', 'speechRanges')).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 11] }] }]);
    expect(h.of('participant', 'speechRanges')).toHaveLength(0);
    // A normal line afterwards is spoken by the speaker's own voice.
    translate(h.emit('speaker'), 4, 'おはよう。');
    expect(only(h.calls, 'voice.speak').slice(1)).toEqual([['voice.speak', 'speaker', 4, 'おはよう。', [0, 5], 'ja', undefined]]);
    expect(h.of('speaker', 'audio')[1]).toEqual({ pcm: expect.any(Int16Array), ref: 4, range: [0, 5] });
  });

  it("shared: text that came after its segment closed is read by the voice that reads its language, on the row's leg, and both voices end the utterance", async () => {
    const h = await both();
    translate(h.emit('speaker'), 2, 'おはよう');
    h.emit('speaker').lateSpeech!({ ref: 2, text: ' Fine.', span: [4, 10], language: 'en' });
    expect(only(h.calls, 'voice.speak', 'voice.endUtterance')).toEqual([
      ['voice.speak', 'speaker', 2, 'おはよう', [0, 4], 'ja', undefined],
      ['voice.endUtterance', 'speaker', 2],
      ['voice.speak', 'participant', 2, ' Fine.', [4, 10], 'en', 'speaker'],
      ['voice.endUtterance', 'speaker', 2],
      ['voice.endUtterance', 'participant', 2],
    ]);
    // Its audio returns on the speaker's row, naming the participant's voice, numbered after the row's own.
    expect(h.of('speaker', 'audio')).toEqual([
      { pcm: expect.any(Int16Array), ref: 2, range: [0, 4] },
      { pcm: expect.any(Int16Array), ref: 2, range: [4, 10], voice: 'participant' },
    ]);
    expect(h.of('speaker', 'lateSpeech')).toEqual([]);
  });

  it('shared: a row both voices read is numbered once, by the count they share', async () => {
    const h = await both();
    const e = h.emit('speaker');
    e.segmentOpened({ ref: 2, side: 'translation' });
    e.segmentText({ ref: 2, text: 'おはよう。', stableLen: 5 });
    e.segmentText({ ref: 2, text: 'おはよう。 Fine.', stableLen: 11, language: 'en' });
    e.segmentClosed({ ref: 2 });
    expect(h.of('speaker', 'audio').map((a) => [a.range, a.voice])).toEqual([[[0, 5], undefined], [[5, 11], 'participant']]);
    expect(h.voiceOf('speaker')!.request.counts.get(2)).toBe(2);
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2], ['voice.endUtterance', 'participant', 2]]);
    h.voiceOf('participant')!.events.speechRanges({ ref: 2, ranges: [{ index: 1, range: [6, 11] }], home: 'speaker' });
    expect(checkConformance(h.rec.speaker.log, h.contexts.speaker)).toEqual([]);
  });

  it("shared: a translation into the other leg's language is read by nobody when that leg has no voice", async () => {
    const h = await both({ speaks: ['speaker'] });
    translate(h.emit('speaker'), 2, 'It is fine.', 'en');
    expect(only(h.calls, 'voice.speak')).toEqual([]);
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2]]);
  });

  it("shared: a row of a leg that does not speak is still read by the other leg's voice when it is in that leg's target, and by nobody otherwise", async () => {
    const h = await both({ speaks: ['speaker'] });
    // The participant's leg has no voice. Its translation into Japanese, the speaker leg's target, is read there.
    translate(h.emit('participant'), 2, 'だいじょうぶ。', 'ja');
    expect(only(h.calls, 'voice.speak')).toEqual([['voice.speak', 'speaker', 2, 'だいじょうぶ。', [0, 7], 'ja', 'participant']]);
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2]]);
    expect(h.of('participant', 'audio')).toEqual([{ pcm: expect.any(Int16Array), ref: 2, range: [0, 7], voice: 'speaker' }]);
    // Audio another leg's voice reads is no violation on a leg that does not speak.
    expect(checkConformance(h.rec.participant.log, h.contexts.participant)).toEqual([]);
    translate(h.emit('participant'), 4, 'It is fine.');
    expect(only(h.calls, 'voice.speak')).toHaveLength(1);
  });

  it("shared: a translation in a language that is no leg's target is read by nobody", async () => {
    const h = await both();
    translate(h.emit('speaker'), 2, 'Ça va.', 'fr');
    expect(only(h.calls, 'voice.speak')).toEqual([]);
  });

  it("split: a translation into the other leg's language is not read", async () => {
    const h = await both({ shared: false });
    translate(h.emit('speaker'), 2, 'It is fine.', 'en');
    expect(only(h.calls, 'voice.speak')).toEqual([]);
    expect(only(h.calls, 'voice.endUtterance')).toEqual([['voice.endUtterance', 'speaker', 2]]);
    expect(h.of('speaker', 'audio')).toHaveLength(0);
    expect(h.of('participant', 'audio')).toHaveLength(0);
  });

  it('split: the legs number their rows apart, so the same ref on each leg is counted on its own', async () => {
    const h = await both({ shared: false });
    translate(h.emit('speaker'), 2, 'おはよう。');
    translate(h.emit('participant'), 2, 'Good morning.');
    expect(h.voiceOf('speaker')!.request.counts.get(2)).toBe(1);
    expect(h.voiceOf('participant')!.request.counts.get(2)).toBe(1);
  });
});

describe('startCompositeBoth: speech off, reconnects and endings', () => {
  it('goes on feeding a voice that is switched off, and the other leg\'s rows it reads', async () => {
    const h = await both();
    h.sessions.participant.setSpeech!(false);
    translate(h.emit('participant'), 2, 'Good morning.');
    translate(h.emit('speaker'), 4, 'It is fine.', 'en');
    expect(only(h.calls, 'voice.speak').map((c) => [c[1], c[2]])).toEqual([['participant', 2], ['participant', 4]]);
    expect(h.of('participant', 'audio')).toHaveLength(0);
    expect(h.of('speaker', 'audio')).toHaveLength(0);
  });

  it("recycles a leg's voice before it passes that leg's reconnect on", async () => {
    const h = await both();
    h.calls.length = 0;
    h.emit('speaker').reconnected();
    expect(h.calls).toEqual([['voice.recycle', 'speaker']]);
    h.emit('participant').reconnected();
    expect(h.calls).toEqual([['voice.recycle', 'speaker'], ['voice.recycle', 'participant']]);
    expect(h.of('speaker', 'reconnected')).toHaveLength(1);
    expect(h.of('participant', 'reconnected')).toHaveLength(1);
  });

  it("closes a leg's voice when its text session fails, and nothing reaches that leg after it", async () => {
    const h = await both();
    h.emit('speaker').failed({ message: 'gone' });
    expect(only(h.calls, 'voice.close')).toEqual([['voice.close', 'speaker']]);
    // The participant's voice, asked earlier to read a row of the speaker's, answers late.
    h.voiceOf('participant')!.audio(2, undefined, 'speaker');
    expect(h.rec.speaker.log.map((e) => e.kind)).toEqual(['failed']);
  });

  it('drops audio and ranges the text sessions emit, with one frame per leg', async () => {
    const h = await both();
    h.emit('speaker').audio({ pcm: new Int16Array(4), ref: 2 });
    h.emit('speaker').audio({ pcm: new Int16Array(4), ref: 2 });
    h.emit('participant').speechRanges({ ref: 2, ranges: [] });
    expect(h.rec.speaker.log).toEqual([{ kind: 'frame', payload: { direction: 'in', type: 'composite.unexpected_audio', payload: { event: 'audio' } } }]);
    expect(h.rec.participant.log).toEqual([{ kind: 'frame', payload: { direction: 'in', type: 'composite.unexpected_audio', payload: { event: 'speechRanges' } } }]);
  });

  it('shared: after a stop no voice is asked anything more, for either leg\'s rows', async () => {
    const h = await both();
    const e = h.emit('speaker');
    e.segmentOpened({ ref: 2, side: 'translation' });
    e.segmentText({ ref: 2, text: 'It is', stableLen: 5, language: 'en' });
    await h.sessions.participant.stop();
    h.calls.length = 0;
    e.segmentClosed({ ref: 2 });
    translate(h.emit('participant'), 4, 'Good morning.');
    expect(h.calls).toEqual([]);
  });
});
