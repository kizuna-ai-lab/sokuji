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
  it('opens a side on its first text, sends each snapshot whole, and closes it at End — no origin, no timing (choice 3)', () => {
    const { segments, emitted } = setup();
    expect(segments.subtitle('source', 'start', '')).toBe(1);
    expect(emitted()).toEqual([]);
    segments.subtitle('source', 'response', '你好');
    segments.subtitle('source', 'response', '你好，今天');
    expect(segments.subtitle('source', 'end', '你好，今天怎么样？')).toBe(1);
    expect(emitted()).toEqual([
      { kind: 'segmentOpened', ref: 1, side: 'source' },
      { kind: 'segmentText', ref: 1, text: '你好' },
      { kind: 'segmentText', ref: 1, text: '你好，今天' },
      { kind: 'segmentText', ref: 1, text: '你好，今天怎么样？' },
      { kind: 'segmentClosed', ref: 1 },
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
    segments.subtitle('source', 'response', 'ab');
    segments.subtitle('source', 'end', 'abc');
    segments.subtitle('source', 'end', 'lone');
    expect(emitted().filter((e) => e.kind === 'segmentOpened').map((e) => e.ref)).toEqual([1, 2]);
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
