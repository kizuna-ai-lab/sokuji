import { describe, it, expect } from 'vitest';
import { recordEvents } from '../../lib/contract/events';
import { Ast2Segments, MATCH_WINDOW } from './segments';

const setup = () => {
  const { events, log } = recordEvents();
  const segments = new Ast2Segments(events);
  const emitted = (): Array<Record<string, unknown>> => log.map((e) => ({ kind: e.kind, ...(e.payload as Record<string, unknown>) }));
  return { segments, emitted };
};

describe("Doubao's subtitles as segments", () => {
  it('opens a side on its first text, sends the pieces joined as the whole text each time, and closes it at End — no origin, no timing (choice 3)', () => {
    const { segments, emitted } = setup();
    expect(segments.subtitle('source', 'start', '')).toBe(1);
    expect(emitted()).toEqual([]);
    // The owner's probe (2026-09-28, zh → en): each Response a piece, the End the whole (Gemini/AST2 follow-up, choice 1).
    for (const piece of ['W', 'ing', '使用', '实时', '翻译', '，']) segments.subtitle('source', 'response', piece);
    expect(segments.subtitle('source', 'end', 'Wing使用实时翻译，')).toBe(1);
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentText', ref: 1, text: 'W' },
      { kind: 'segmentText', ref: 1, text: 'Wing' },
      { kind: 'segmentText', ref: 1, text: 'Wing使用' },
      { kind: 'segmentText', ref: 1, text: 'Wing使用实时' },
      { kind: 'segmentText', ref: 1, text: 'Wing使用实时翻译' },
      { kind: 'segmentText', ref: 1, text: 'Wing使用实时翻译，' },
      // The End equals the pieces joined: nothing new to send.
      { kind: 'segmentClosed', ref: 1 },
    ]);
  });

  it('sends nothing for an empty piece, keeps a blank one in the join, and takes an End that differs from the join as the whole text', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '');
    // The probe's ja → zh translations carry empty pieces between the characters.
    for (const piece of ['“', 'リ', '', 'エ', ' ', 'ル']) segments.subtitle('translation', 'response', piece);
    segments.subtitle('translation', 'end', '“リエル');
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'translation' },
      { kind: 'segmentText', ref: 1, text: '“' },
      { kind: 'segmentText', ref: 1, text: '“リ' },
      { kind: 'segmentText', ref: 1, text: '“リエ' },
      { kind: 'segmentText', ref: 1, text: '“リエ ' },
      { kind: 'segmentText', ref: 1, text: '“リエ ル' },
      // The server's End is the whole text, and wins.
      { kind: 'segmentText', ref: 1, text: '“リエル' },
      { kind: 'segmentClosed', ref: 1 },
    ]);
  });

  it("starts the next segment's join from nothing: an End, or a Start, clears the pieces before it", () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'response', 'One');
    segments.subtitle('translation', 'end', 'One.');
    segments.subtitle('translation', 'response', 'Two');
    segments.subtitle('translation', 'start', '');
    segments.subtitle('translation', 'response', 'Three');
    expect(emitted().filter((e) => e.kind === 'segmentText')).toEqual([
      { kind: 'segmentText', ref: 1, text: 'One' },
      { kind: 'segmentText', ref: 1, text: 'One.' },
      { kind: 'segmentText', ref: 2, text: 'Two' },
      { kind: 'segmentText', ref: 3, text: 'Three' },
    ]);
  });

  it('keeps the two sides apart, on one counter, and never reuses a ref', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'start', '');
    segments.subtitle('translation', 'start', '');
    segments.subtitle('source', 'end', 'A');
    segments.subtitle('translation', 'end', 'B');
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'end', 'C');
    const opened = emitted().filter((e) => e.kind === 'segmentOpened');
    expect(opened).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentOpened', ref: 2, side: 'translation' },
      { kind: 'segmentOpened', ref: 3, side: 'source' },
    ]);
  });

  it("drops the server VAD's false start: a Start and an empty End with nothing shown emit nothing", () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'response', '');
    expect(segments.subtitle('source', 'end', '')).toBe(1);
    expect(emitted()).toEqual([]);
  });

  it('treats a blank End after a Start as a false start, as the old client did: no segment, and no ref for speech', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '');
    segments.subtitle('translation', 'response', '  ');
    expect(segments.subtitle('translation', 'end', ' ')).toBe(1);
    expect(emitted()).toEqual([]);
    expect(segments.speechRef()).toBeUndefined();
  });

  it('keeps the text of a shown segment whose End came blank', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '');
    segments.subtitle('translation', 'response', 'Hello');
    segments.subtitle('translation', 'end', ' ');
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'translation' },
      { kind: 'segmentText', ref: 1, text: 'Hello' },
      { kind: 'segmentClosed', ref: 1 },
    ]);
  });

  it('closes a shown segment whose End came empty with the text it had (survey §1.18.4)', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '');
    segments.subtitle('translation', 'response', 'Hello');
    segments.subtitle('translation', 'end', '');
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'translation' },
      { kind: 'segmentText', ref: 1, text: 'Hello' },
      { kind: 'segmentClosed', ref: 1 },
    ]);
  });

  it('gives Responses with no Start one segment, not one per frame (survey §1.18.3), and an End with no Start its own', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'response', 'a');
    segments.subtitle('source', 'response', 'b');
    segments.subtitle('source', 'end', 'abc');
    segments.subtitle('source', 'end', 'lone');
    expect(emitted().filter((e) => e.kind === 'segmentOpened').map((e) => e.ref)).toEqual([1, 2]);
    expect(emitted().filter((e) => e.kind === 'segmentText').map((e) => e.text)).toEqual(['a', 'ab', 'abc', 'lone']);
    expect(emitted().filter((e) => e.kind === 'segmentClosed').map((e) => e.ref)).toEqual([1, 2]);
  });

  it('sends a text the previous segment of the side also ended with', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'end', 'Yes.');
    segments.subtitle('source', 'end', 'Yes.');
    expect(emitted().filter((e) => e.kind === 'segmentText')).toEqual([
      { kind: 'segmentText', ref: 1, text: 'Yes.' },
      { kind: 'segmentText', ref: 2, text: 'Yes.' },
    ]);
  });

  it('closes a segment whose End never came when the next Start arrives, and drops one never shown', () => {
    const { segments, emitted } = setup();
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'response', 'cut off');
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'end', 'next');
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentText', ref: 1, text: 'cut off' },
      { kind: 'segmentClosed', ref: 1 },
      { kind: 'segmentOpened', ref: 3, side: 'source' },
      { kind: 'segmentText', ref: 3, text: 'next' },
      { kind: 'segmentClosed', ref: 3 },
    ]);
  });

  it('names the translation a spoken sentence belongs to: the one started now, shown or not, else the last one shown (ruling 10)', () => {
    const { segments } = setup();
    expect(segments.speechRef()).toBeUndefined();
    segments.subtitle('translation', 'start', '');
    // Started, no text yet: the sentence is this translation's, as the old client locked it at Start.
    expect(segments.speechRef()).toBe(1);
    segments.subtitle('translation', 'response', 'Hi');
    expect(segments.speechRef()).toBe(1);
    segments.subtitle('translation', 'end', 'Hi.');
    expect(segments.speechRef()).toBe(1);
    segments.subtitle('translation', 'start', '');
    expect(segments.speechRef()).toBe(2);
    // A false start releases its ref: the last one shown again.
    segments.subtitle('translation', 'end', '');
    expect(segments.speechRef()).toBe(1);
    // Source subtitles never move it.
    segments.subtitle('source', 'start', '');
    segments.subtitle('source', 'response', 'src');
    expect(segments.speechRef()).toBe(1);
  });
});

describe("Doubao's spoken sentences, named by their server times (Gemini/AST2 follow-up, ruling 1)", () => {
  /** The owner's probe (2026-09-28, zh → en): T2 and S2 both carry 1940–4500 ms. */
  const T2 = { startTime: 1_940, endTime: 4_500 };
  const TEXT = 'to help you speak more fluently. ';
  const NONE = { startTime: 0, endTime: 0 };

  it('names the translation whose times a sentence carries, and ranges its clip over the whole text once the End came first', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '', T2);
    for (const piece of ['to', ' help', ' you', ' speak', ' more', ' flu', 'ently', '.', ' ']) segments.subtitle('translation', 'response', piece);
    segments.subtitle('translation', 'end', TEXT, T2);
    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: true, range: [0, TEXT.length] });
    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([]);
  });

  it('requires the times to match exactly: one millisecond off names no translation, and the sentence falls back to the lock (review M1)', () => {
    const { segments } = setup();
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'end', TEXT, T2);
    const nearMiss = segments.sentence({ startTime: 1_940, endTime: 4_501 });
    expect(segments.clipFor(nearMiss)).toEqual({ ref: 1, matched: false });
  });

  it('a clip emitted before its subtitle is final plays rangeless, and takes its range by speechRanges at the close (Gemini/AST2 follow-up, choice 4)', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '', T2);
    for (const piece of ['to', ' help', ' you', ' speak', ' more', ' flu', 'ently']) segments.subtitle('translation', 'response', piece);
    // The probe's S2 started at 8.72 s, before T2's End at 8.86 s.
    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: true });
    segments.subtitle('translation', 'response', '.');
    segments.subtitle('translation', 'response', ' ');
    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([]);
    segments.subtitle('translation', 'end', TEXT, T2);
    expect(emitted().slice(-2)).toEqual([
      { kind: 'segmentClosed', ref: 1 },
      { kind: 'speechRanges', ref: 1, ranges: [{ index: 0, range: [0, TEXT.length] }] },
    ]);
  });

  it('a segment whose End never came is final at the next Start, with the text it had', () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'response', 'to help');
    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: true });
    segments.subtitle('translation', 'start', '', { startTime: 4_500, endTime: 6_000 });
    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([{ kind: 'speechRanges', ref: 1, ranges: [{ index: 0, range: [0, 7] }] }]);
  });

  it('keys by the times, not by which subtitle is open: a sentence arriving after the next translation started still voices its own (Gemini/AST2 follow-up, choice 2)', () => {
    const { segments } = setup();
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'end', TEXT, T2);
    segments.subtitle('translation', 'start', '', { startTime: 7_220, endTime: 8_500 });
    // The lock says ref 2, the translation open now.
    const sentence = segments.sentence(T2);
    expect(sentence).toEqual({ lock: 2, times: T2 });
    expect(segments.clipFor(sentence)).toEqual({ ref: 1, matched: true, range: [0, TEXT.length] });
  });

  it("matches the times as the clip is emitted: a sentence that started before its translation's Start still voices it (Gemini/AST2 follow-up, choice 2)", () => {
    const { segments } = setup();
    segments.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 });
    segments.subtitle('translation', 'end', 'Wing uses real-time translation ', { startTime: 20, endTime: 1_460 });
    const sentence = segments.sentence(T2);
    // At its start the times name nothing yet, and the lock is the previous translation.
    expect(sentence.lock).toBe(1);
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'end', TEXT, T2);
    expect(segments.clipFor(sentence)).toEqual({ ref: 2, matched: true, range: [0, TEXT.length] });
  });

  it('falls back to the lock, unmatched and rangeless, when the times name no recent translation or there are none', () => {
    const { segments, emitted } = setup();
    expect(segments.clipFor(segments.sentence(T2))).toBeUndefined();
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'response', 'Hi');
    expect(segments.clipFor(segments.sentence({ startTime: 1, endTime: 2 }))).toEqual({ ref: 1, matched: false });
    // A sentence with no times at all: the lock too.
    expect(segments.clipFor(segments.sentence(NONE))).toEqual({ ref: 1, matched: false });
    segments.subtitle('translation', 'end', 'Hi.', T2);
    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([]);
  });

  it("ranges only the first clip to carry a translation's times; a second one, and a locked clip, play rangeless — each counted as its entry (Gemini/AST2 follow-up, choice 3)", () => {
    const { segments, emitted } = setup();
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'response', 'to help');
    // A clip the lock gave this ref first: entry 0.
    expect(segments.clipFor(segments.sentence(NONE))).toEqual({ ref: 1, matched: false });
    const first = segments.clipFor(segments.sentence(T2));
    const second = segments.clipFor(segments.sentence(T2));
    expect([first, second]).toEqual([{ ref: 1, matched: true }, { ref: 1, matched: false }]);
    segments.subtitle('translation', 'end', 'to help.', T2);
    // The matched clip was the ref's second audio: entry 1.
    expect(emitted().filter((e) => e.kind === 'speechRanges')).toEqual([{ kind: 'speechRanges', ref: 1, ranges: [{ index: 1, range: [0, 8] }] }]);
  });

  it('never names a translation that was never shown: a false start leaves the list, and its sentence takes the lock', () => {
    const { segments } = setup();
    segments.subtitle('translation', 'start', '', { startTime: 100, endTime: 900 });
    segments.subtitle('translation', 'end', 'Shown.', { startTime: 100, endTime: 900 });
    segments.subtitle('translation', 'start', '', T2);
    segments.subtitle('translation', 'end', '', T2);
    expect(segments.clipFor(segments.sentence(T2))).toEqual({ ref: 1, matched: false });
  });

  it(`matches against the last ${MATCH_WINDOW} translations only`, () => {
    const { segments } = setup();
    const times = (k: number) => ({ startTime: k * 1_000, endTime: k * 1_000 + 900 });
    for (let k = 1; k <= MATCH_WINDOW + 1; k++) {
      segments.subtitle('translation', 'start', '', times(k));
      segments.subtitle('translation', 'end', `Sentence ${k}.`, times(k));
    }
    // The first has left the list: its times fall to the lock, the last shown.
    expect(segments.clipFor(segments.sentence(times(1)))).toEqual({ ref: MATCH_WINDOW + 1, matched: false });
    expect(segments.clipFor(segments.sentence(times(2)))).toEqual({ ref: 2, matched: true, range: [0, 'Sentence 2.'.length] });
  });

  it('ignores the times of source subtitles', () => {
    const { segments } = setup();
    segments.subtitle('source', 'start', '', T2);
    segments.subtitle('source', 'end', '希望这个声音能让交流变得轻松自然。', T2);
    expect(segments.clipFor(segments.sentence(T2))).toBeUndefined();
  });
});
