import { describe, it, expect } from 'vitest';
import { sentencesFrom, joinSegments, markBoundaries, SAT_DEFAULTS, f16round } from './punctuation-sat';

describe('SaT defaults', () => {
  it('keeps wtpsplit thresholds', () => {
    expect(SAT_DEFAULTS).toEqual({ threshold: 0.25, blockSize: 512, stride: 64, batchSize: 32 });
  });
});

describe('SaT sentencesFrom', () => {
  const chars = Array.from('one two three');
  it('cuts strictly above the threshold', () => {
    const probs = new Float32Array(chars.length);
    probs[2] = 0.25; // exactly at the threshold: not a boundary
    expect(sentencesFrom(chars, probs)).toEqual(['one two three']);
    probs[2] = 0.2500001;
    expect(sentencesFrom(chars, probs)).toEqual(['one ', 'two three']);
  });
  it('gives the whitespace after a boundary to the segment before it', () => {
    // The space is not dropped. The cut advances past the run of whitespace
    // and the whole slice, trailing space included, becomes the preceding
    // segment. Removing that space is joinSegments' job — which is exactly
    // why the two functions are tested apart.
    const probs = new Float32Array(chars.length);
    probs[2] = 0.9;
    expect(sentencesFrom(chars, probs)).toEqual(['one ', 'two three']);
  });
  it('treats an input newline as a boundary', () => {
    const withNewline = Array.from('one\ntwo');
    expect(sentencesFrom(withNewline, new Float32Array(withNewline.length))).toEqual(['one', 'two']);
  });
});

describe('SaT joinSegments', () => {
  it('drops one trailing space per cut segment', () => {
    expect(joinSegments(['one ', 'two'])).toBe('one\ntwo');
  });
});

describe('SaT float16 accumulation', () => {
  it('rounds to half precision, which is what the reference buffers do', () => {
    expect(f16round(1 / 3)).not.toBe(1 / 3);
    expect(f16round(1)).toBe(1);
  });
});

describe('SaT markBoundaries', () => {
  it('puts the mark before the space the boundary left behind', () => {
    expect(markBoundaries(['one ', 'two three'], '.')).toEqual({
      text: 'one. two three',
      sentenceEnds: [4],
    });
  });
  it('does not invent a space where the input had none', () => {
    expect(markBoundaries(['今日はいい天気です', '散歩に行きましょう'], '。')).toEqual({
      text: '今日はいい天気です。散歩に行きましょう',
      sentenceEnds: [10],
    });
  });
  it('never marks the last segment', () => {
    expect(markBoundaries(['only one'], '.')).toEqual({ text: 'only one', sentenceEnds: [] });
  });
  it('skips the blank segments consecutive newlines produce', () => {
    expect(markBoundaries(['one', '', 'two'], '.')).toEqual({ text: 'one.two', sentenceEnds: [4] });
  });
});
