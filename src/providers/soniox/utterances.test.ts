/**
 * Soniox's tokens as segments (Stage 2 Soniox, Task 6): the utterance
 * machine over the STT socket's messages, on a virtual clock. `<end>` and
 * `<fin>` are the boundaries (ruling 5); a translation token after one and
 * before the next original token belongs to the utterance that just ended
 * (choice 3). Cases 19–20 pin the review's C1: late translation tokens and
 * the next utterance's first original in one message.
 */
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { Ref, TextRange } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import type { SonioxToken } from './sttStream';
import { FIN_TRANSLATION_GRACE_MS, Utterances, tokenFrames, type SegmentEvent } from './utterances';

const orig = (text: string, is_final = true, more: Partial<SonioxToken> = {}): SonioxToken => ({ text, is_final, translation_status: 'original', language: 'en', ...more });
const none = (text: string): SonioxToken => ({ text, is_final: true, translation_status: 'none', language: 'en' });
const tr = (text: string, is_final = true, language = 'ja'): SonioxToken => ({ text, is_final, translation_status: 'translation', language, source_language: 'en' });
const END: SonioxToken = { text: '<end>', is_final: true };
const FIN: SonioxToken = { text: '<fin>', is_final: true };

type Call = { leg: LegName } & ({ segment: SegmentEvent } | { speak: [Ref, string, TextRange, string] } | { endSpeech: Ref });
function setup(legFor: (t: SonioxToken) => LegName = () => 'speaker') {
  const clock = createVirtualClock(0);
  const calls: Call[] = [];
  const machine = new Utterances({
    clock, legFor, targetFor: (leg) => (leg === 'speaker' ? 'ja' : 'en'),
    sink: {
      segment: (leg, segment) => calls.push({ leg, segment }),
      speak: (leg, ...speak) => calls.push({ leg, speak }),
      endSpeech: (leg, endSpeech) => calls.push({ leg, endSpeech }),
    },
  });
  const segments = () => calls.flatMap((c) => ('segment' in c ? [c.segment] : []));
  const spoken = () => calls.flatMap((c) => ('speak' in c ? [c.speak] : []));
  /** Every `segmentText` payload sent for `ref`, in order. */
  const textsOf = (ref: Ref) => segments().flatMap((s) => (s.kind === 'segmentText' && s.payload.ref === ref ? [s.payload] : []));
  /** The index in `calls` of the first call `pred` accepts; fails the test when there is none. */
  const where = (pred: (c: Call) => boolean) => {
    const i = calls.findIndex(pred);
    expect(i, 'no such call').toBeGreaterThanOrEqual(0);
    return i;
  };
  return { clock, calls, machine, segments, spoken, textsOf, where };
}

const seg = (kind: SegmentEvent['kind'], ref: Ref) => (c: Call) => 'segment' in c && c.segment.kind === kind && c.segment.payload.ref === ref;
const ended = (ref: Ref) => (c: Call) => 'endSpeech' in c && c.endSpeech === ref;
const said = (text: string) => (c: Call) => 'speak' in c && c.speak[1] === text;
function lastWhere<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i -= 1) if (pred(xs[i])) return i;
  return -1;
}

describe('Utterances', () => {
  it('opens the source at the first original token, and sends its whole text every message: finals kept, partials replaced', () => {
    const { machine, segments } = setup();
    machine.message([orig('Hello'), orig(' wor', false)]);
    expect(segments()).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Hello wor', language: 'en' } },
    ]);
    machine.message([orig(' world', false)]);
    expect(segments().slice(2)).toEqual([
      { kind: 'segmentText', payload: { ref: 1, text: 'Hello world', language: 'en' } },
    ]);
  });

  it("routes a 'none' token to the source, like an original", () => {
    const { machine, segments } = setup();
    machine.message([none('Ok')]);
    expect(segments()).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Ok', language: 'en' } },
    ]);
  });

  it("opens the translation at its first token, in the translated-into language, with the utterance's origin", () => {
    const { machine, segments } = setup();
    machine.message([orig('Hi.'), tr('やあ。')]);
    expect(segments()).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Hi.', language: 'en' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'やあ。', language: 'ja' } },
    ]);
  });

  it("speaks each message's final translation as one chunk, with its span in the translation's text, before <end>", () => {
    const { machine, calls, spoken, where } = setup();
    machine.message([orig('How are you'), tr('お元気'), tr('ですか')]);
    expect(spoken()).toEqual([[2, 'お元気ですか', [0, 6], 'ja']]);
    machine.message([tr('？'), END]);
    expect(spoken()).toEqual([[2, 'お元気ですか', [0, 6], 'ja'], [2, '？', [6, 7], 'ja']]);
    expect(where(said('？'))).toBeLessThan(where(seg('segmentClosed', 1)));
    expect(calls.every((c) => c.leg === 'speaker')).toBe(true);
  });

  it('a partial translation is shown, never spoken', () => {
    const { machine, spoken, textsOf } = setup();
    machine.message([orig('x'), tr('部分', false)]);
    expect(textsOf(2)).toEqual([{ ref: 2, text: '部分', language: 'ja' }]);
    expect(spoken()).toEqual([]);
  });

  it('<end> closes both sides with the origin; the source keeps its finals only', () => {
    const { machine, calls, textsOf, where } = setup();
    machine.message([orig('Done.'), orig(' and', false), tr('完了。'), END]);
    const sourceTexts = textsOf(1);
    expect(sourceTexts[sourceTexts.length - 1]).toEqual({ ref: 1, text: 'Done.', language: 'en' });
    expect(calls.slice(-3)).toEqual([
      { leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } } },
      { leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } } },
      { leg: 'speaker', endSpeech: 2 },
    ]);
    expect(lastWhere(calls, seg('segmentText', 1))).toBeLessThan(where(seg('segmentClosed', 1)));
  });

  it("times the source from its original tokens' start_ms and end_ms", () => {
    const { machine, textsOf } = setup();
    machine.message([orig('a', true, { start_ms: 120, end_ms: 300 }), orig('b', false, { start_ms: 300, end_ms: 480 })]);
    expect(textsOf(1)).toEqual([{ ref: 1, text: 'ab', timing: { startMs: 120, endMs: 480 }, language: 'en' }]);
  });

  it("names each side's language: the spoken one on the source, the translated-into one on the translation", () => {
    const { machine, textsOf } = setup();
    machine.message([orig('Salut', true, { language: 'fr' }), orig(' toi', false, { language: 'fr' }), tr('やあ')]);
    expect(textsOf(1).map((p) => p.language)).toEqual(['fr']);
    expect(textsOf(2).map((p) => p.language)).toEqual(['ja']);
  });

  it('<fin> closes the source at once and holds the translation for late tokens, until the next original token', () => {
    const { machine, calls, segments, textsOf, where } = setup();
    machine.message([orig('Hi.'), FIN]);
    expect(segments()).toContainEqual({ kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } });
    expect(segments().some((s) => s.payload.ref === 2)).toBe(false);

    machine.message([tr('やあ。')]);
    expect(segments()).toContainEqual({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } });
    expect(textsOf(2)).toEqual([{ ref: 2, text: 'やあ。', language: 'ja' }]);
    expect(calls.some(seg('segmentClosed', 2))).toBe(false);

    machine.message([orig('Next')]);
    const closed = where(seg('segmentClosed', 2));
    const endSpeech = where(ended(2));
    const opened = where(seg('segmentOpened', 3));
    expect(calls[closed]).toEqual({ leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } } });
    expect(calls[opened]).toEqual({ leg: 'speaker', segment: { kind: 'segmentOpened', payload: { ref: 3, side: 'source', origin: 'u2' } } });
    expect(closed).toBeLessThan(opened);
    expect(endSpeech).toBeLessThan(opened);
  });

  it('a translation held after <fin> closes after FIN_TRANSLATION_GRACE_MS', () => {
    const { clock, machine, calls } = setup();
    machine.message([orig('Hi.'), tr('や'), FIN]);
    clock.advance(1_999);
    expect(calls.some(seg('segmentClosed', 2))).toBe(false);
    expect(calls.some(ended(2))).toBe(false);
    clock.advance(1);
    expect(calls.slice(-2)).toEqual([
      { leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } } },
      { leg: 'speaker', endSpeech: 2 },
    ]);
  });

  it('a translation token after its translation closed revises it, and is spoken', () => {
    const { machine, calls, spoken, textsOf, where } = setup();
    machine.message([orig('Hi.'), tr('やあ'), END]);
    machine.message([tr('。')]);
    expect(lastWhere(calls, seg('segmentText', 2))).toBeGreaterThan(where(seg('segmentClosed', 2)));
    const texts = textsOf(2);
    expect(texts[texts.length - 1]).toEqual({ ref: 2, text: 'やあ。', language: 'ja' });
    const chunks = spoken();
    expect(chunks[chunks.length - 1]).toEqual([2, '。', [2, 3], 'ja']);
    const lastSpeak = lastWhere(calls, (c) => 'speak' in c);
    expect(calls[lastSpeak + 1]).toEqual({ leg: 'speaker', endSpeech: 2 });
    expect(calls.filter(seg('segmentClosed', 2))).toHaveLength(1);
  });

  it('a translation that only arrives after <end> opens after it and is held for the grace', () => {
    const { clock, machine, calls, segments, where } = setup();
    machine.message([orig('Hi.'), END]);
    expect(segments().some((s) => s.payload.ref === 2)).toBe(false);
    machine.message([tr('やあ。')]);
    expect(segments()).toContainEqual({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1' } });
    expect(where(seg('segmentOpened', 2))).toBeGreaterThan(where(seg('segmentClosed', 1)));
    clock.advance(FIN_TRANSLATION_GRACE_MS - 1);
    expect(calls.some(seg('segmentClosed', 2))).toBe(false);
    clock.advance(1);
    expect(segments()).toContainEqual({ kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } });
    expect(calls[calls.length - 1]).toEqual({ leg: 'speaker', endSpeech: 2 });
  });

  it('never reuses a ref, and counts utterances in origins', () => {
    const { machine, segments } = setup();
    machine.message([orig('One.'), tr('一。'), END]);
    machine.message([orig('Two.'), tr('二。'), END]);
    const opened = segments().flatMap((s) => (s.kind === 'segmentOpened' ? [s.payload] : []));
    expect(opened.map((p) => p.ref)).toEqual([1, 2, 3, 4]);
    expect(opened.map((p) => p.origin)).toEqual(['u1', 'u1', 'u2', 'u2']);
    const closed = segments().flatMap((s) => (s.kind === 'segmentClosed' ? [s.payload] : []));
    expect(closed).toEqual([
      { ref: 1, origin: 'u1' }, { ref: 2, origin: 'u1' },
      { ref: 3, origin: 'u2' }, { ref: 4, origin: 'u2' },
    ]);
  });

  it('abandon closes what is open as it stands, and refs go on', () => {
    const { machine, calls, segments, textsOf } = setup();
    machine.message([orig('Half', false), tr('半')]);
    expect(textsOf(1)).toEqual([{ ref: 1, text: 'Half', language: 'en' }]);
    const before = calls.length;
    machine.abandon();
    expect(calls.slice(before)).toEqual([
      { leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } } },
      { leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } } },
      { leg: 'speaker', endSpeech: 2 },
    ]);
    machine.message([orig('Again')]);
    expect(segments()).toContainEqual({ kind: 'segmentOpened', payload: { ref: 3, side: 'source', origin: 'u2' } });
  });

  it("picks an utterance's leg at its first token", () => {
    const { machine, calls, spoken } = setup((t) => (t.speaker === '2' ? 'participant' : 'speaker'));
    machine.message([orig('Bonjour', true, { speaker: '2' }), orig(' encore', true, { speaker: '1' })]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.leg === 'participant')).toBe(true);
    // No translation token names a language: speech takes the participant's target.
    machine.message([tr('Hello again', true, '')]);
    expect(calls.every((c) => c.leg === 'participant')).toBe(true);
    expect(spoken()).toEqual([[2, 'Hello again', [0, 11], 'en']]);
  });

  it("speaks in the first final translation token's language, else the leg's target", () => {
    const named = setup();
    named.machine.message([orig('x'), tr('Hola', true, 'es')]);
    named.machine.message([tr(' mundo', true, 'pt')]);
    expect(named.spoken()).toEqual([[2, 'Hola', [0, 4], 'es'], [2, ' mundo', [4, 10], 'es']]);

    const unnamed = setup();
    unnamed.machine.message([orig('x'), tr('Hola', true, '')]);
    expect(unnamed.spoken()).toEqual([[2, 'Hola', [0, 4], 'ja']]);
  });

  it('stop cancels the grace: nothing follows', () => {
    const { clock, machine, calls } = setup();
    machine.message([orig('Hi.'), tr('や'), FIN]);
    machine.stop();
    const before = calls.length;
    clock.advance(10_000);
    expect(calls).toHaveLength(before);
    machine.message([orig('x')]);
    expect(calls).toHaveLength(before);
  });

  it('summarizes a message for the Logs: a delta for partials, a transcript and a translation for finals, an endpoint, a finalize', () => {
    expect(tokenFrames([orig('a', false), tr('b', false)])).toEqual([
      { direction: 'in', type: 'stt.delta', payload: { transcript: 'a', translation: 'b' } },
    ]);
    expect(tokenFrames([orig('a'), tr('b'), END])).toEqual([
      { direction: 'in', type: 'stt.transcript', payload: { text: 'a' } },
      { direction: 'in', type: 'stt.translation', payload: { text: 'b' } },
      { direction: 'in', type: 'stt.endpoint' },
    ]);
    expect(tokenFrames([FIN])).toEqual([{ direction: 'in', type: 'stt.finalized' }]);
    expect(tokenFrames([])).toEqual([]);
  });

  // The review's C1: late translation tokens and the next utterance's first
  // original in ONE message, the layout continuous speech produces. Against
  // an `endPrevious()` that only closes, 19 sees ref 2 opened and closed with
  // no text and nothing spoken, and 20 never shows or speaks '。'.
  it('a late translation in the same message as the next original is shown and spoken before it closes', () => {
    const { machine, calls, where } = setup();
    machine.message([orig('Hi.'), END]);
    machine.message([tr('やあ。'), orig('Next')]);
    const text = where(seg('segmentText', 2));
    const speak = where(said('やあ。'));
    const closed = where(seg('segmentClosed', 2));
    const opened = where(seg('segmentOpened', 3));
    const endSpeech = where(ended(2));
    expect(calls[text]).toEqual({ leg: 'speaker', segment: { kind: 'segmentText', payload: { ref: 2, text: 'やあ。', language: 'ja' } } });
    expect(calls[speak]).toEqual({ leg: 'speaker', speak: [2, 'やあ。', [0, 3], 'ja'] });
    expect(calls[closed]).toEqual({ leg: 'speaker', segment: { kind: 'segmentClosed', payload: { ref: 2, origin: 'u1' } } });
    expect(calls[opened]).toEqual({ leg: 'speaker', segment: { kind: 'segmentOpened', payload: { ref: 3, side: 'source', origin: 'u2' } } });
    expect(text).toBeLessThan(closed);
    expect(speak).toBeLessThan(closed);
    expect(closed).toBeLessThan(opened);
    expect(endSpeech).toBeGreaterThan(closed);
  });

  it('a revision in the same message as the next original, after the translation closed at <end>, is shown and spoken', () => {
    const { machine, calls, where } = setup();
    machine.message([orig('Hi.'), tr('やあ'), END]);
    const before = calls.length;
    machine.message([tr('。'), orig('Next')]);
    const late = calls.slice(before, where(seg('segmentOpened', 3)));
    expect(late).toContainEqual({ leg: 'speaker', segment: { kind: 'segmentText', payload: { ref: 2, text: 'やあ。', language: 'ja' } } });
    expect(late).toContainEqual({ leg: 'speaker', speak: [2, '。', [2, 3], 'ja'] });
    expect(late).toContainEqual({ leg: 'speaker', endSpeech: 2 });
    expect(late.findIndex(said('。'))).toBeLessThan(late.findIndex(ended(2)));
    expect(calls.filter(seg('segmentClosed', 2))).toHaveLength(1);
  });
});
