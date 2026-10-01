import { describe, it, expect } from 'vitest';
import type { Segment } from '../conversation/types';
import { cutRanges, pauseCuts, cutSegment } from './cut';

const seg = (over: Partial<Segment>): Segment => ({
  id: 's:speaker:1', ref: 1, side: 'source', text: '', final: true, openedAt: 0, marks: [], speech: [], ...over,
});

describe('cutRanges', () => {
  it('tiles the text with no gaps and no trimming, one range per n sentences', () => {
    const text = '今天天气很好。我们去公园吧。顺便买点东西。';
    expect(cutRanges(text, 1)).toEqual([[0, 7], [7, 14], [14, 21]]);
    expect(cutRanges(text, 2)).toEqual([[0, 14], [14, 21]]);
    expect(cutRanges('Hi there. How are you? Fine.', 1)).toEqual([[0, 9], [9, 22], [22, 28]]);
  });

  it('returns the whole text for n = 0, for fewer ends than n, and for empty text', () => {
    expect(cutRanges('One. Two.', 0)).toEqual([[0, 9]]);
    expect(cutRanges('One. Two.', 3)).toEqual([[0, 9]]);
    expect(cutRanges('', 1)).toEqual([[0, 0]]);
  });

  it('never ends with an empty range when the text ends on a sentence end', () => {
    // Not 'A. B.': a lone capital before a period reads as an initial, not a sentence end.
    expect(cutRanges('One. Two.', 1)).toEqual([[0, 4], [4, 9]]);
  });
});

describe('pauseCuts', () => {
  it('cuts at the length the text had when a pause of at least pauseMs began', () => {
    const marks = [{ at: 0, len: 4 }, { at: 200, len: 8 }, { at: 2000, len: 12 }, { at: 2100, len: 16 }];
    expect(pauseCuts(marks, 1500, 16)).toEqual([8]);
  });
  it('drops cuts at 0, at the end, and when pauses are off', () => {
    expect(pauseCuts([{ at: 0, len: 0 }, { at: 5000, len: 9 }, { at: 9000, len: 9 }], 1500, 9)).toEqual([]);
    expect(pauseCuts([{ at: 0, len: 4 }, { at: 5000, len: 9 }], 0, 9)).toEqual([]);
  });
});

describe('cutSegment', () => {
  const sentences = { mode: 'sentences' as const, sentencesPerRow: 1, sourcePauseMs: 0, translationPauseMs: 0 };
  const pause = { mode: 'pause' as const, sentencesPerRow: 0, sourcePauseMs: 1500, translationPauseMs: 1500 };
  const off = { mode: 'off' as const, sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0 };

  it("cuts a final segment by sentences, keys the rows, and gives each its text and the segment's state", () => {
    const rows = cutSegment(seg({ text: 'One. Two.', language: 'en' }), sentences);
    expect(rows).toEqual([
      { key: 's:speaker:1:0', segmentId: 's:speaker:1', side: 'source', start: 0, end: 4, text: 'One.', final: true, language: 'en' },
      { key: 's:speaker:1:1', segmentId: 's:speaker:1', side: 'source', start: 4, end: 9, text: ' Two.', final: true, language: 'en' },
    ]);
  });

  it('leaves the language off a row whose segment has none', () => {
    expect(cutSegment(seg({ text: 'One.' }), off)[0]).not.toHaveProperty('language');
  });

  it('cuts an open segment like a closed one, its last row the live one', () => {
    const rows = cutSegment(seg({ text: 'One. Tw', final: false }), sentences);
    expect(rows.map((r) => [r.start, r.end, r.final])).toEqual([[0, 4, false], [4, 7, false]]);
  });

  it('joins a whitespace-only range to the row before it, so no row is blank and the rows still tile the text', () => {
    const rows = cutSegment(seg({ text: 'One. Two. ' }), sentences);
    expect(rows.map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 10]]);
    expect(rows.map((r) => r.text).join('')).toBe('One. Two. ');
  });

  it('yields no rows for a segment with no text, or only whitespace', () => {
    expect(cutSegment(seg({ text: '' }), off)).toEqual([]);
    expect(cutSegment(seg({ text: '  ' }), sentences)).toEqual([]);
  });

  it("cuts by pause whether the segment is open or closed, with its own side's pause", () => {
    const marks = [{ at: 0, len: 4 }, { at: 3000, len: 8 }];
    expect(cutSegment(seg({ text: 'abcdefgh', final: false, marks }), pause).map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 8]]);
    const translation = seg({ side: 'translation', text: 'abcdefgh', final: false, marks });
    expect(cutSegment(translation, { ...pause, translationPauseMs: 5000 })).toHaveLength(1);
    expect(cutSegment(translation, { ...pause, sourcePauseMs: 5000 })).toHaveLength(2);
  });

  it('is one row when segmentation is off', () => {
    expect(cutSegment(seg({ text: 'One. Two.' }), off)).toHaveLength(1);
  });
});
