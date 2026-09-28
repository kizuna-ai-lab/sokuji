import { describe, it, expect } from 'vitest';
import { recordEvents } from '../../lib/contract/events';
import { Ast2Segments } from './segments';

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
