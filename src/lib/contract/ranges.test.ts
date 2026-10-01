import { describe, it, expect } from 'vitest';
import { tileSpan } from './ranges';

describe('tileSpan (Stage 2 Palabra, choice 2: lifted from Soniox, byte for byte)', () => {
  it("tiles a span by sample count, the last range ending at the span's end", () => {
    expect(tileSpan([0, 10], [100, 100], 'x'.repeat(10))).toEqual([[0, 5], [5, 10]]);
    expect(tileSpan([3, 9], [1, 2, 3], 'x'.repeat(9))).toEqual([[3, 4], [4, 6], [6, 9]]);
    expect(tileSpan([2, 7], [480], 'x'.repeat(7))).toEqual([[2, 7]]);
  });

  it('never ends a range inside a surrogate pair', () => {
    expect(tileSpan([0, 4], [1, 1], 'a😀b')).toEqual([[0, 3], [3, 4]]);
  });

  it('a chunk whose share rounds to nothing gets an empty range: harmless, pinned', () => {
    // Under half a code unit each: rounding gives some chunks [n, n]. The kit rejects only start > end, and karaoke holds at the boundary.
    expect(tileSpan([0, 3], [1, 1, 1, 1, 1], 'abc')).toEqual([[0, 1], [1, 1], [1, 2], [2, 2], [2, 3]]);
  });

  it("tiles a whole sentence over a burst of 200 ms chunks and a short last one, as Palabra's audio arrives (ruling 6)", () => {
    const text = 'Welcome to real-time translation.';
    const ranges = tileSpan([0, text.length], [4_800, 4_800, 4_800, 2_859], text);
    expect(ranges[0][0]).toBe(0);
    expect(ranges[ranges.length - 1][1]).toBe(text.length);
    for (let k = 1; k < ranges.length; k++) expect(ranges[k][0]).toBe(ranges[k - 1][1]);
  });
});
