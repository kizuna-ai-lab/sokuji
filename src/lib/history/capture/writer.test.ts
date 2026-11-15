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
import { createHistoryWriter, type CaptureFacts, type HistoryWriter } from './writer';

type Call = [string, any];
function recordingPort() {
  const calls: Call[] = [];
  const failing = new Map<string, number>();
  const slow = new Set<string>();
  let releaseAll: Array<() => void> = [];
  let nextTranscript = 0;
  const answer = (method: string, arg: unknown, value: unknown) => {
    calls.push([method, arg]);
    const left = failing.get(method) ?? 0;
    if (left > 0) {
      failing.set(method, left - 1);
      return Promise.reject(new Error(`${method} failed`));
    }
    if (slow.has(method)) return new Promise((resolve) => { releaseAll.push(() => resolve(value)); });
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
    release: () => { slow.clear(); const r = releaseAll; releaseAll = []; for (const f of r) f(); },
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
let writer: HistoryWriter;
let legs: Map<LegName, Conversation>;

beforeEach(() => {
  clock = createVirtualClock(1000);
  state = createStore<RunState>(() => ({ phase: 'idle' }));
  conversation = new ConversationSet();
  port = recordingPort();
  facts = defaultFacts();
  report = vi.fn<(message: string, cause: unknown) => void>();
  writer = createHistoryWriter({ state, conversation, port: port.port, clock, facts: () => facts, report });
});
afterEach(() => writer.dispose());

function start(id = 'run-0001-aaaa', o: { legs?: LegName[]; languages?: { source: string; target: string } } = {}) {
  const languages = o.languages ?? { source: 'zh', target: 'ja' };
  state.setState({ phase: 'starting', participantSpeech: false, step: 'opening' });
  legs = new Map((o.legs ?? ['speaker', 'participant']).map((leg) => [leg, new Conversation({
    leg, session: id, clock,
    languages: leg === 'speaker' ? languages : { source: languages.target, target: languages.source },
  })]));
  conversation.replace(legs, { provider: 'fake', models: {} });
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
    expect(report).toHaveBeenCalledTimes(1);
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
});
