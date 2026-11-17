// The writer observes a run and writes it into its History record, in order, without ever disturbing the run.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createVirtualClock, type VirtualClock } from '../../contract/clock';
import type { Heard } from '../../contract/adapter';
import { Conversation } from '../../conversation/Conversation';
import type { LegName } from '../../conversation/types';
import { ConversationSet } from '../../session/conversationSet';
import type { RunState } from '../../session/types';
import type { HistoryPort } from '../port';
import { createHistoryWriter, myLanguageOf, TICK_MS, type CaptureFacts, type HistoryWriter } from './writer';

type Call = [string, any];
function recordingPort() {
  const calls: Call[] = [];
  const failing = new Map<string, number>();
  const slow = new Set<string>();
  let releaseAll: Array<(failing?: boolean) => void> = [];
  let nextTranscript = 0;
  const answer = (method: string, arg: unknown, value: unknown) => {
    calls.push([method, arg]);
    const left = failing.get(method) ?? 0;
    if (left > 0) {
      failing.set(method, left - 1);
      return Promise.reject(new Error(`${method} failed`));
    }
    if (slow.has(method)) {
      return new Promise((resolve, reject) => {
        releaseAll.push((failing) => (failing ? reject(new Error(`${method} failed`)) : resolve(value)));
      });
    }
    return Promise.resolve(value);
  };
  const port = {
    openRecord: (a: unknown) => answer('openRecord', a, undefined),
    putLeg: (a: unknown) => answer('putLeg', a, undefined),
    createTranscript: (a: unknown) => answer('createTranscript', a, ++nextTranscript),
    putSegments: (a: unknown) => answer('putSegments', a, undefined),
    putNotices: (a: unknown) => answer('putNotices', a, undefined),
    appendSentences: (a: { sentences: unknown[] }) => answer('appendSentences', a, { added: a.sentences.length }),
    reviseSentences: (a: unknown) => answer('reviseSentences', a, undefined),
    closeRecord: (a: unknown) => answer('closeRecord', a, { kept: true }),
  } as unknown as HistoryPort;
  return {
    port, calls,
    fail: (method: string, times: number) => failing.set(method, times),
    slow: (method: string) => slow.add(method),
    /** The held calls answer; `failing`: they fail. */
    release: (failing = false) => { slow.clear(); const r = releaseAll; releaseAll = []; for (const f of r) f(failing); },
  };
}

const MIC = { input: 'microphone', inputName: 'MacBook Pro Microphone', inputId: 'default', spoken: false } as const;
const ZOOM = { input: 'app', inputName: 'Zoom', inputId: 'app:pid:4242', spoken: false } as const;
const defaultFacts = (): CaptureFacts => ({ mode: 'both', legs: { speaker: MIC, participant: ZOOM }, shared: false, originalText: true, appVersion: '9.9.9' });

let clock: VirtualClock;
let state: StoreApi<RunState>;
let conversation: ConversationSet;
let port: ReturnType<typeof recordingPort>;
let facts: CaptureFacts;
let report: ReturnType<typeof vi.fn<(message: string, cause: unknown) => void>>;
let tell: ReturnType<typeof vi.fn<() => void>>;
let writer: HistoryWriter;
let legs: Map<LegName, Conversation>;

beforeEach(() => {
  clock = createVirtualClock(1000);
  state = createStore<RunState>(() => ({ phase: 'idle' }));
  conversation = new ConversationSet();
  port = recordingPort();
  facts = defaultFacts();
  report = vi.fn<(message: string, cause: unknown) => void>();
  tell = vi.fn<() => void>();
  writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => facts, report, tell });
});
afterEach(() => writer.dispose());

function start(id = 'run-0001-aaaa', o: { legs?: LegName[]; languages?: { source: string; target: string } } = {}) {
  const languages = o.languages ?? { source: 'zh', target: 'ja' };
  state.setState({ phase: 'starting', participantSpeech: false, step: 'opening' });
  legs = new Map((o.legs ?? ['speaker', 'participant']).map((leg) => [leg, new Conversation({
    leg, session: id, clock,
    languages: leg === 'speaker' ? languages : { source: languages.target, target: languages.source },
  })]));
  conversation.replace(legs, { provider: 'fake', models: {}, startedAt: 0 });
  state.setState({ phase: 'running', participantSpeech: false, since: clock.now(), legs: {} });
}
const end = () => state.setState({ phase: 'idle', lastEnd: { reason: 'user' } } as RunState);
const open = (leg: LegName, ref: number, side: 'source' | 'translation') => legs.get(leg)!.apply({ kind: 'segmentOpened', payload: { ref, side } });
const text = (leg: LegName, ref: number, t: string, o: { language?: string; person?: string; heard?: Heard } = {}) => legs.get(leg)!.apply({ kind: 'segmentText', payload: { ref, text: t, ...o } });
const close = (leg: LegName, ref: number) => legs.get(leg)!.apply({ kind: 'segmentClosed', payload: { ref } });
const say = (leg: LegName, ref: number, t: string) => { open(leg, ref, 'source'); text(leg, ref, t); close(leg, ref); };
const sayTranslation = (leg: LegName, ref: number, t: string) => { open(leg, ref, 'translation'); text(leg, ref, t); close(leg, ref); };
const count = (method: string) => port.calls.filter((c) => c[0] === method).length;
const lastArg = (method: string) => port.calls.filter((c) => c[0] === method).pop()![1];
const allSentences = () => port.calls.filter((c) => c[0] === 'appendSentences').flatMap((c) => c[1].sentences);

describe('the history writer', () => {
  it('opens the record, its legs and a transcript when the run shows its legs', async () => {
    start('run-0001-aaaa', { legs: ['speaker', 'participant'], languages: { source: 'zh', target: 'ja' } });
    await writer.settled();
    expect(port.calls.map((c) => c[0])).toEqual(['openRecord', 'putLeg', 'putLeg', 'createTranscript']);
    expect(port.calls[2][1]).toEqual({ recordId: 'run-0001-aaaa', leg: 'participant', languages: { source: 'ja', target: 'zh' }, input: 'app', inputName: 'Zoom', inputId: 'app:pid:4242', translated: true, spoken: false });
    expect(port.calls[0][1]).toEqual({ id: 'run-0001-aaaa', startedAt: 1000, mode: 'both', myLanguage: 'zh', targetLanguage: 'ja', services: { provider: 'fake', models: {} }, appVersion: '9.9.9' });
    expect(port.calls[3][1]).toEqual({ recordId: 'run-0001-aaaa', origin: { service: 'fake', kind: 'live' }, textKind: 'original' });
  });

  it('opens nothing for a start that is refused', async () => {
    state.setState({ phase: 'starting', participantSpeech: false, step: 'checking' });
    state.setState({ phase: 'idle', lastEnd: { reason: 'refused' } } as RunState);
    await writer.settled();
    expect(port.calls).toEqual([]);
  });

  it('writes a final segment at once and an open one at most once a second', async () => {
    start();
    open('speaker', 1, 'source');
    text('speaker', 1, 'Hel');
    text('speaker', 1, 'Hello');
    await writer.settled();
    expect(count('putSegments')).toBe(1);
    text('speaker', 1, 'Hello th');
    clock.advance(999);
    await writer.settled();
    expect(count('putSegments')).toBe(1);
    clock.advance(1);
    await writer.settled();
    expect(count('putSegments')).toBe(2);
    text('speaker', 1, 'Hello there.');
    close('speaker', 1);
    await writer.settled();
    expect(lastArg('putSegments').segments[0]).toEqual(expect.objectContaining({ text: 'Hello there.', final: true }));
    expect(lastArg('putSegments').segments[0]).not.toHaveProperty('speech');
    expect(lastArg('putSegments').segments[0]).not.toHaveProperty('heard');
  });

  it('appends sentences with side, track, speaker, language and times on the record clock', async () => {
    start('run-0001-aaaa');
    clock.advance(500);
    open('participant', 1, 'source');
    text('participant', 1, 'はい。', { language: 'ja', person: '1.2' });
    close('participant', 1);
    await writer.settled();
    expect(lastArg('appendSentences').sentences).toEqual([{ n: 1, segmentId: 'run-0001-aaaa:participant:1', side: 'other', sideCertain: true, track: 'other', speaker: '1.2', startMs: 500, endMs: 500, text: 'はい。', language: 'ja', timeKind: 'estimated' }]);
  });

  it('marks the side as inferred when both legs share one microphone, and puts both on the microphone track', async () => {
    const mic = { ...MIC, spoken: true } as const;
    facts = { mode: 'face-to-face', legs: { speaker: mic, participant: mic }, shared: true, originalText: true, appVersion: '9.9.9' };
    start();
    open('participant', 1, 'source');
    text('participant', 1, 'Yes.');
    close('participant', 1);
    await writer.settled();
    expect(lastArg('appendSentences').sentences[0]).toEqual(expect.objectContaining({ side: 'other', sideCertain: false, track: 'microphone', speaker: '1' }));
  });

  it('cuts the translation, and marks the transcript so, when the session gives no original text', async () => {
    facts = { ...facts, originalText: false };
    start();
    sayTranslation('speaker', 1, 'Can we ship by Wednesday?');
    await writer.settled();
    expect(lastArg('createTranscript')).toEqual(expect.objectContaining({ textKind: 'translation' }));
    expect(allSentences().map((s) => [s.n, s.text, s.language])).toEqual([[1, 'Can we ship by Wednesday?', 'ja']]);
  });

  it('numbers sentences across legs in the order they were cut and never cuts a translation', async () => {
    start();
    say('speaker', 1, 'One. Two.');
    sayTranslation('speaker', 2, 'Uno. Dos.');
    say('participant', 1, 'Three.');
    await writer.settled();
    expect(allSentences().map((s) => [s.n, s.text])).toEqual([[1, 'One.'], [2, 'Two.'], [3, 'Three.']]);
  });

  it('revises a stored sentence when its text is corrected later', async () => {
    start();
    say('speaker', 1, 'hello there');
    await writer.settled();
    text('speaker', 1, 'Hello there.');
    await writer.settled();
    expect(lastArg('reviseSentences')).toEqual({ transcriptId: 1, revisions: [{ n: 1, text: 'Hello there.' }] });
  });

  it('cuts the stable part of a long open segment while it is still open, and does not repeat it at the close', async () => {
    start();
    open('speaker', 1, 'source');
    text('speaker', 1, 'First one. And then', { heard: { pieces: [{ at: 0, len: 10, startAt: 1200, endAt: 1900 }], stableLen: 11 } });
    await writer.settled();
    expect(allSentences().map((s) => [s.n, s.text, s.startMs, s.timeKind])).toEqual([[1, 'First one.', 200, 'given']]);
    text('speaker', 1, 'First one. And then more.');
    close('speaker', 1);
    await writer.settled();
    expect(allSentences().map((s) => [s.n, s.text])).toEqual([[1, 'First one.'], [2, 'And then more.']]);
  });

  it('begins the recording with the record and ends it before closing the record', async () => {
    writer.dispose();
    const order: string[] = [];
    const recorder = {
      prepare: (id: string, startedAt: number) => { order.push(`prepare:${id}:${startedAt}`); },
      begin: (id: string, startedAt: number) => { order.push(`begin:${id}:${startedAt}`); },
      drop: (id: string) => { order.push(`drop:${id}`); },
      end: async (id: string) => { order.push(`end:${id}`); },
    };
    const tracked = recordingPort();
    const base = tracked.port as unknown as Record<string, (a: unknown) => Promise<unknown>>;
    const openRecord = base.openRecord;
    const closeRecord = base.closeRecord;
    base.openRecord = (a) => { order.push('openRecord'); return openRecord(a); };
    base.closeRecord = (a) => { order.push('closeRecord'); return closeRecord(a); };
    writer = createHistoryWriter({ state, conversation, port: tracked.port, clock, facts: () => facts, report, recorder });
    start('run-0001-aaaa');
    say('speaker', 1, '你好。');
    await writer.settled();
    end();
    await writer.settled();
    expect(order).toEqual(['prepare:run-0001-aaaa:1000', 'openRecord', 'begin:run-0001-aaaa:1000', 'end:run-0001-aaaa', 'closeRecord']);
  });

  // Review: the end time was read after the recording's end, which can wait up to ten seconds.
  it('closes the record at the time the run ended, however long the recording takes to end', async () => {
    writer.dispose();
    const recorder = {
      prepare: () => {}, begin: () => {}, drop: () => {},
      end: async () => { clock.advance(8000); },
    };
    const tracked = recordingPort();
    writer = createHistoryWriter({ state, conversation, port: tracked.port, clock, facts: () => facts, report, recorder });
    start('run-0001-aaaa');
    say('speaker', 1, 'Hello.');
    await writer.settled();
    clock.advance(4000);
    end();
    await writer.settled();
    const close = tracked.calls.filter((c) => c[0] === 'closeRecord').pop()!;
    expect(close[1]).toEqual({ id: 'run-0001-aaaa', endedAt: 5000 });
  });

  it('does not begin the recording when the record could not be opened', async () => {
    writer.dispose();
    const begun: string[] = [];
    const dropped: string[] = [];
    const recorder = { prepare: () => {}, begin: (id: string) => { begun.push(id); }, drop: (id: string) => { dropped.push(id); }, end: async () => {} };
    const tracked = recordingPort();
    tracked.fail('openRecord', 1);
    writer = createHistoryWriter({ state, conversation, port: tracked.port, clock, facts: () => facts, report, recorder });
    start('run-0001-aaaa');
    await writer.settled();
    expect(begun).toEqual([]);
    expect(dropped).toEqual(['run-0001-aaaa']);
  });

  it('hands each numbered sentence to the live notes once, never a revision', async () => {
    writer.dispose();
    const handed: Array<{ recordId: string; n: number; text: string; fromOpen: boolean }> = [];
    writer = createHistoryWriter({
      state, conversation, port: port.port, clock, facts: () => facts, report,
      onSentences: (recordId, list) => { for (const x of list) handed.push({ recordId, n: x.n, text: x.text, fromOpen: x.fromOpen }); },
    });
    start('run-0001-aaaa');
    say('speaker', 1, 'Hello there. How are you?');
    await writer.settled();
    text('speaker', 1, 'Hello there! How are you?');
    await writer.settled();
    say('speaker', 2, 'Fine.');
    await writer.settled();
    expect(handed).toEqual([
      { recordId: 'run-0001-aaaa', n: 1, text: 'Hello there.', fromOpen: false },
      { recordId: 'run-0001-aaaa', n: 2, text: 'How are you?', fromOpen: false },
      { recordId: 'run-0001-aaaa', n: 3, text: 'Fine.', fromOpen: false },
    ]);
  });

  it('writes the sentences even when the live notes throw on them', async () => {
    writer.dispose();
    writer = createHistoryWriter({
      state, conversation, port: port.port, clock, facts: () => facts, report,
      onSentences: () => { throw new Error('live notes broke'); },
    });
    start('run-0001-aaaa');
    say('speaker', 1, 'Hello there.');
    await writer.settled();
    expect(allSentences().map((x: { text: string }) => x.text)).toEqual(['Hello there.']);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('live notes'), expect.any(Error));
  });

  it('hands a sentence cut from words the recognizer has made final as settled, though its segment is still open', async () => {
    writer.dispose();
    const handed: Array<{ n: number; text: string; fromOpen: boolean }> = [];
    writer = createHistoryWriter({
      state, conversation, port: port.port, clock, facts: () => facts, report,
      onSentences: (_id, list) => { for (const x of list) handed.push({ n: x.n, text: x.text, fromOpen: x.fromOpen }); },
    });
    start('run-0001-aaaa');
    open('speaker', 1, 'source');
    const words = 'Hello there. How';
    text('speaker', 1, words, { heard: { pieces: [{ at: 0, len: 12, startAt: 1000, endAt: 1600 }], stableLen: 12 } });
    clock.advance(1000);
    await writer.settled();
    expect(handed).toEqual([{ n: 1, text: 'Hello there.', fromOpen: false }]);
  });

  it('closes the record when the run ends, after the last corrections', async () => {
    start('run-0001-aaaa');
    say('speaker', 1, 'hello');
    state.setState({ phase: 'stopping', participantSpeech: false });
    text('speaker', 1, 'Hello.');
    clock.advance(4000);
    end();
    await writer.settled();
    const names = port.calls.map((c) => c[0]);
    expect(names[names.length - 1]).toBe('closeRecord');
    expect(names.lastIndexOf('reviseSentences')).toBeLessThan(names.length - 1);
    expect(lastArg('closeRecord')).toEqual({ id: 'run-0001-aaaa', endedAt: 5000 });
  });

  it('says when a record it kept has closed, and not for one the store dropped', async () => {
    writer.dispose();
    const closed: string[] = [];
    writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => facts, report, onClosed: (id) => closed.push(id) });
    start('run-0001-aaaa');
    say('speaker', 1, 'Hello.');
    end();
    await writer.settled();
    expect(closed).toEqual(['run-0001-aaaa']);

    (port.port as unknown as { closeRecord: () => Promise<unknown> }).closeRecord = async () => ({ kept: false });
    start('run-0002-bbbb');
    end();
    await writer.settled();
    expect(closed).toEqual(['run-0001-aaaa']);
  });

  it('says when the store did not keep a record', async () => {
    writer.dispose();
    const dropped: string[] = [];
    writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => facts, report, onNotKept: (id) => dropped.push(id) });
    start('run-0001-aaaa');
    say('speaker', 1, 'Hello.');
    end();
    await writer.settled();
    expect(dropped).toEqual([]);
    (port.port as unknown as { closeRecord: () => Promise<unknown> }).closeRecord = async () => ({ kept: false });
    start('run-0002-bbbb');
    end();
    await writer.settled();
    expect(dropped).toEqual(['run-0002-bbbb']);
  });

  it('says when a record could not be closed (it stays open until the next launch closes it)', async () => {
    writer.dispose();
    const failed: string[] = [];
    writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => facts, report, onCloseFailed: (id) => failed.push(id) });
    port.fail('closeRecord', 1);
    start('run-0001-aaaa');
    say('speaker', 1, 'Hello.');
    end();
    await writer.settled();
    expect(failed).toEqual(['run-0001-aaaa']);
  });

  // Review: once its writes are given up, a record is never closed, and nothing said what became of it.
  it('says when a record whose writes were given up is not closed', async () => {
    writer.dispose();
    const skipped: string[] = [];
    const closed: string[] = [];
    writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => facts, report, onCloseSkipped: (id) => skipped.push(id), onClosed: (id) => closed.push(id) });
    port.fail('putSegments', Infinity);
    start('run-0001-aaaa');
    for (let i = 1; i <= 4; i++) {
      say('speaker', i, `Line ${i}.`);
      clock.advance(TICK_MS);
      await writer.settled();
    }
    end();
    await writer.settled();
    expect(port.calls.some((c) => c[0] === 'closeRecord')).toBe(false);
    expect(skipped).toEqual(['run-0001-aaaa']);
    expect(closed).toEqual([]);
  });

  it('says when a run has ended, after its last sentences and before the record is closed, kept or not', async () => {
    writer.dispose();
    const events: string[] = [];
    writer = createHistoryWriter({
      state, conversation, port: port.port, clock, facts: () => facts, report,
      onSentences: (id, list) => events.push(`sentences ${id} ${list.map((s) => s.n).join(',')}`),
      onEnded: (id) => events.push(`ended ${id}`),
    });
    start('run-0001-aaaa');
    say('speaker', 1, 'Said before Stop.');
    port.slow('closeRecord');
    end();
    expect(events).toEqual(['sentences run-0001-aaaa 1', 'ended run-0001-aaaa']);
    port.release();
    await writer.settled();

    port.fail('closeRecord', 1);
    start('run-0002-bbbb');
    end();
    await writer.settled();
    expect(events).toEqual(['sentences run-0001-aaaa 1', 'ended run-0001-aaaa', 'ended run-0002-bbbb']);
  });

  it("names the record's language the same way for the record and the live notes: my side's, else what the other side is translated into", () => {
    const leg = (name: LegName, source: string, target: string) => ({ leg: name, session: 's', languages: { source, target }, segments: [], notices: [] });
    expect(myLanguageOf([leg('speaker', 'zh', 'ja'), leg('participant', 'ja', 'zh')])).toBe('zh');
    expect(myLanguageOf([leg('participant', 'en', 'ja')])).toBe('ja');
    expect(myLanguageOf([])).toBe('');
  });

  it('keeps what was written when Clear is pressed and goes on with new segments', async () => {
    start();
    say('speaker', 1, 'Before.');
    await writer.settled();
    const before = port.calls.length;
    conversation.clear();
    await writer.settled();
    expect(port.calls.length).toBe(before);
    say('speaker', 2, 'After.');
    await writer.settled();
    expect(allSentences().map((s) => s.n)).toEqual([1, 2]);
  });

  it('keeps two records apart when a second run starts while the first is still closing', async () => {
    start('run-0001-aaaa');
    say('speaker', 1, 'One.');
    port.slow('closeRecord');
    end();
    start('run-0002-bbbb');
    say('speaker', 1, 'Two.');
    port.release();
    await writer.settled();
    expect(port.calls.filter((c) => c[0] === 'appendSentences').map((c) => c[1].transcriptId)).toEqual([1, 2]);
    expect(port.calls.findIndex((c) => c[0] === 'closeRecord')).toBeLessThan(port.calls.findIndex((c) => c[0] === 'openRecord' && c[1].id === 'run-0002-bbbb'));
  });

  it('stops writing a record after three failures in a row, reports once, and leaves the run alone', async () => {
    port.fail('putSegments', Infinity);
    start();
    say('speaker', 1, 'One.');
    say('speaker', 2, 'Two.');
    say('speaker', 3, 'Three.');
    say('speaker', 4, 'Four.');
    await writer.settled();
    expect(report).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) { clock.advance(TICK_MS); await writer.settled(); }
    expect(report).toHaveBeenCalledTimes(1);
    expect(tell).toHaveBeenCalledTimes(1);
    expect(count('putSegments')).toBe(3);
    expect(state.getState().phase).toBe('running');
  });

  it('writes notices that last, not passing ones', async () => {
    start();
    legs.get('speaker')!.apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'No speech' } });
    await writer.settled();
    expect(count('putNotices')).toBe(1);
    expect(lastArg('putNotices')).toEqual(expect.objectContaining({ recordId: 'run-0001-aaaa', leg: 'speaker', notices: [expect.objectContaining({ code: 'tts_degraded' })] }));
  });

  // Review: Clear keeps a still-open segment with its text emptied; its sentences must neither be blanked nor appended again.
  it('Clear while a segment is open neither blanks its sentences nor appends them again', async () => {
    start();
    open('speaker', 1, 'source');
    const heard = { pieces: [{ at: 0, len: 10, startAt: 1200, endAt: 1900 }], stableLen: 11 };
    text('speaker', 1, 'First one. And then', { heard });
    await writer.settled();
    conversation.clear();
    await writer.settled();
    text('speaker', 1, 'First one. And then more', { heard });
    await writer.settled();
    expect(count('reviseSentences')).toBe(0);
    expect(allSentences().map((s) => [s.n, s.text])).toEqual([[1, 'First one.']]);
    expect(port.calls.filter((c) => c[0] === 'putSegments').flatMap((c) => c[1].segments).every((g: { text: string }) => g.text !== '')).toBe(true);
  });

  it('does not write a segment again for audio that changes nothing it keeps', async () => {
    start();
    sayTranslation('speaker', 1, 'Hola.');
    await writer.settled();
    const before = count('putSegments');
    for (let i = 0; i < 5; i++) legs.get('speaker')!.apply({ kind: 'audio', payload: { ref: 1, pcm: new Int16Array(240) } });
    await writer.settled();
    expect(count('putSegments')).toBe(before);
  });

  it('a failure of its own never reaches the run', async () => {
    writer.dispose();
    writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => { throw new Error('no facts'); }, report });
    expect(() => start()).not.toThrow();
    expect(state.getState().phase).toBe('running');
    expect(report).toHaveBeenCalled();
  });

  // Review: a write counts once it is answered; one that failed is made again at the next pass.
  describe('a write that failed', () => {
    const pass = async () => { clock.advance(TICK_MS); await writer.settled(); };

    it('writes the segment again, unchanged as it is', async () => {
      start();
      open('speaker', 1, 'source');
      text('speaker', 1, 'One.');
      await writer.settled();
      port.fail('putSegments', 1);
      close('speaker', 1);
      await writer.settled();
      expect(count('putSegments')).toBe(2);
      await pass();
      expect(count('putSegments')).toBe(3);
      expect(lastArg('putSegments').segments).toEqual([expect.objectContaining({ text: 'One.', final: true })]);
      expect(report).not.toHaveBeenCalled();
      // Written again, it is no longer counted as unwritten at the close.
      end();
      await writer.settled();
      expect(report).not.toHaveBeenCalled();
    });

    // Review: Clear takes a segment off the screen; a failed write of it must still go, not wait on the screen.
    it('writes a failed segment again after Clear took it off the screen', async () => {
      start();
      port.fail('putSegments', 1);
      say('speaker', 1, 'One.');
      await writer.settled();
      expect(count('putSegments')).toBe(1);
      conversation.clear();
      await pass();
      await pass();
      expect(count('putSegments')).toBe(2);
      expect(lastArg('putSegments').segments).toEqual([expect.objectContaining({ text: 'One.', final: true })]);
      end();
      await writer.settled();
      expect(report).not.toHaveBeenCalled();
    });

    // Review: a retry of a failed write queued behind a newer write of the same segment must not overwrite it.
    it('drops a retry of a failed write once a newer write of that segment has gone', async () => {
      start();
      port.fail('putSegments', 1);
      open('speaker', 1, 'source');
      text('speaker', 1, 'Hello');
      await writer.settled();
      port.slow('putSegments');
      text('speaker', 1, 'Hello there');
      clock.advance(TICK_MS);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      conversation.clear();
      clock.advance(TICK_MS);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      port.release();
      await writer.settled();
      const texts = port.calls.filter((c) => c[0] === 'putSegments').flatMap((c) => c[1].segments.map((g: { text: string }) => g.text));
      expect(texts[texts.length - 1]).toBe('Hello there');
      expect(texts.filter((x: string) => x === 'Hello').length).toBe(1);
    });

    // Review: a held retry put back its older text over the newer write's failure.
    it('keeps the newer text when the newer write fails too while a retry of the older waits behind it', async () => {
      start();
      port.fail('putSegments', 1);
      open('speaker', 1, 'source');
      text('speaker', 1, 'Hello');
      await writer.settled();
      port.slow('putSegments');
      text('speaker', 1, 'Hello there');
      clock.advance(TICK_MS);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      conversation.clear();
      clock.advance(TICK_MS);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      port.release(true);
      await writer.settled();
      clock.advance(TICK_MS);
      await writer.settled();
      const texts = port.calls.filter((c) => c[0] === 'putSegments').flatMap((c) => c[1].segments.map((g: { text: string }) => g.text));
      expect(texts[texts.length - 1]).toBe('Hello there');
    });

    it('says so at the close when a segment Clear took off the screen could still not be written', async () => {
      start();
      say('speaker', 1, 'Zero.');
      await writer.settled();
      port.fail('putSegments', 2);
      say('speaker', 2, 'One.');
      await writer.settled();
      conversation.clear();
      end();
      await writer.settled();
      expect(report).toHaveBeenCalledWith(expect.stringContaining('could not be written'), null);
      expect(tell).toHaveBeenCalledTimes(1);
    });

    it('appends the same sentences again, with their numbers', async () => {
      port.fail('appendSentences', 1);
      start();
      say('speaker', 1, 'One. Two.');
      await writer.settled();
      expect(count('appendSentences')).toBe(1);
      await pass();
      expect(count('appendSentences')).toBe(2);
      expect(lastArg('appendSentences').sentences.map((x: { n: number; text: string }) => [x.n, x.text])).toEqual([[1, 'One.'], [2, 'Two.']]);
      say('speaker', 2, 'Three.');
      await writer.settled();
      expect(lastArg('appendSentences').sentences.map((x: { n: number }) => x.n)).toEqual([3]);
    });

    it('puts a correction into a sentence still waiting to be appended', async () => {
      port.fail('appendSentences', 1);
      start();
      say('speaker', 1, 'hello there');
      await writer.settled();
      text('speaker', 1, 'Hello there.');
      await pass();
      expect(lastArg('appendSentences').sentences.map((x: { n: number; text: string }) => [x.n, x.text])).toEqual([[1, 'Hello there.']]);
      expect(count('reviseSentences')).toBe(0);
    });

    it('sends a correction again', async () => {
      start();
      say('speaker', 1, 'hello there');
      await writer.settled();
      port.fail('reviseSentences', 1);
      text('speaker', 1, 'Hello there.');
      await writer.settled();
      await pass();
      expect(count('reviseSentences')).toBe(2);
      expect(lastArg('reviseSentences')).toEqual({ transcriptId: 1, revisions: [{ n: 1, text: 'Hello there.' }] });
    });

    it('writes a notice again', async () => {
      port.fail('putNotices', 1);
      start();
      legs.get('speaker')!.apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'No speech' } });
      await writer.settled();
      await pass();
      expect(count('putNotices')).toBe(2);
    });

    it('writes a failed notice again after Clear took it off the screen', async () => {
      port.fail('putNotices', 1);
      start();
      legs.get('speaker')!.apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'No speech' } });
      await writer.settled();
      conversation.clear();
      await pass();
      await pass();
      expect(count('putNotices')).toBe(2);
      expect(lastArg('putNotices').notices).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
      end();
      await writer.settled();
      expect(report).not.toHaveBeenCalled();
    });

    // Review: a record that could not be closed stayed open without a word until the next launch.
    it('says so when the record cannot be closed', async () => {
      start();
      say('speaker', 1, 'One.');
      await writer.settled();
      port.fail('closeRecord', 1);
      end();
      await writer.settled();
      expect(report).toHaveBeenCalledWith(expect.stringContaining('could not close record run-0001-aaaa'), expect.any(Error));
      expect(tell).toHaveBeenCalledTimes(1);
    });

    it('gives up only after three failures in a row', async () => {
      port.fail('appendSentences', 2);
      start();
      say('speaker', 1, 'One.');
      await writer.settled();
      await pass();
      await pass();
      port.fail('appendSentences', 2);
      say('speaker', 2, 'Two.');
      await writer.settled();
      await pass();
      await pass();
      expect(count('appendSentences')).toBe(6);
      expect(lastArg('appendSentences').sentences.map((x: { n: number }) => x.n)).toEqual([2]);
      expect(tell).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    });

    // Review: a short hiccup while the conversation streams must not spend the three tries at once.
    it('tries again at most once a pass, so a short failure costs nothing', async () => {
      start();
      port.fail('appendSentences', Infinity);
      for (let i = 1; i <= 6; i++) {
        say('speaker', i, `Sentence ${i}.`);
        clock.advance(50);
        await writer.settled();
      }
      expect(count('appendSentences')).toBe(1);
      port.fail('appendSentences', 0);
      // The pass after the wait has run out: within two passes of the failure.
      await pass();
      await pass();
      expect(report).not.toHaveBeenCalled();
      expect(tell).not.toHaveBeenCalled();
      expect(lastArg('appendSentences').sentences.map((x: { n: number }) => x.n)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('tells the user when what failed at the close can no longer be written', async () => {
      start();
      say('speaker', 1, 'One.');
      port.fail('appendSentences', 1);
      end();
      await writer.settled();
      expect(tell).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(expect.stringContaining('could not be written'), null);
    });
  });
});
