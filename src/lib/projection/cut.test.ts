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
  const sentences = { mode: 'sentences' as const, sentencesPerRow: 1, pauseMs: 0 };
  const pause = { mode: 'pause' as const, sentencesPerRow: 0, pauseMs: 1500 };
  const off = { mode: 'off' as const, sentencesPerRow: 0, pauseMs: 0 };

  it('cuts a final segment by sentences and keys the rows', () => {
    const rows = cutSegment(seg({ text: 'One. Two.' }), sentences);
    expect(rows).toEqual([
      { key: 's:speaker:1:0', segmentId: 's:speaker:1', side: 'source', start: 0, end: 4 },
      { key: 's:speaker:1:1', segmentId: 's:speaker:1', side: 'source', start: 4, end: 9 },
    ]);
  });

  it('leaves an open segment as one live row under the sentences mode', () => {
    expect(cutSegment(seg({ text: 'One. Tw', final: false }), sentences)).toHaveLength(1);
  });

  it('cuts by pause whether the segment is open or closed', () => {
    const s = seg({ text: 'abcdefgh', final: false, marks: [{ at: 0, len: 4 }, { at: 3000, len: 8 }] });
    expect(cutSegment(s, pause).map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 8]]);
  });

  it('is one row when segmentation is off', () => {
    expect(cutSegment(seg({ text: 'One. Two.' }), off)).toHaveLength(1);
  });
});
