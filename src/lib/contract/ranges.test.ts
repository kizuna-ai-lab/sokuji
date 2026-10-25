import { describe, it, expect } from 'vitest';
import { priorSeconds, SpeechPace, tileSpan } from './ranges';

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

describe('priorSeconds', () => {
  it("reads the phrase's script: kana 0.16, mostly Han 0.25, mostly Hangul 0.17, else 0.075", () => {
    expect(priorSeconds('Hello there')).toBe(0.075);
    expect(priorSeconds('明天的会议')).toBe(0.25);
    expect(priorSeconds('リアルタイム翻訳')).toBe(0.16);
    expect(priorSeconds('안녕하세요')).toBe(0.17);
    expect(priorSeconds('下午3点开始')).toBe(0.25);
    expect(priorSeconds('Room 3 会议')).toBe(0.075);
  });
});

describe('SpeechPace', () => {
  it('starts from the prior in samples per letter, scaled by the speaking speed', () => {
    expect(new SpeechPace().rate('Hello')).toBe(1800);
    expect(new SpeechPace(1.25).rate('Hello')).toBe(1440);
  });

  it('blends what fill-ins measured with the prior, the prior weighted as 10 letters', () => {
    const pace = new SpeechPace();
    pace.learn('Hello world', 20_000);
    expect(pace.rate('abc')).toBe(1900);
  });

  it('learns nothing from a fill-in with no letters or no samples', () => {
    const pace = new SpeechPace();
    pace.learn('...', 5_000);
    pace.learn('Hello', 0);
    expect(pace.rate('abc')).toBe(1800);
  });

  it('reaches into the phrase in proportion to the samples heard against its estimated length, never past its end', () => {
    const pace = new SpeechPace();
    expect(pace.reach('abcdefghij', 9_000, 0)).toBe(5);
    expect(pace.reach('abcdefghij', 18_000, 5)).toBe(10);
    expect(pace.reach('abcdefghij', 27_000, 10)).toBe(10);
  });

  it('never reaches back before from', () => {
    expect(new SpeechPace().reach('abcdefghij', 9_000, 6)).toBe(6);
  });

  it('places nothing in a phrase with no letters', () => {
    expect(new SpeechPace().reach('', 5_000, 0)).toBeNull();
    expect(new SpeechPace().reach('...', 5_000, 0)).toBeNull();
  });

  it('never ends inside a surrogate pair', () => {
    expect(new SpeechPace().reach('a😀b', 1_800, 0)).toBe(3);
  });
});
