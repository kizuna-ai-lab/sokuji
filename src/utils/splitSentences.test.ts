import { describe, it, expect } from 'vitest';
import { splitSentences } from './splitSentences';

describe('splitSentences', () => {
  it('splits English sentences', () => {
    expect(splitSentences('Hello world. How are you? Fine!')).toEqual([
      'Hello world.',
      'How are you?',
      'Fine!',
    ]);
  });

  it('splits Japanese sentences', () => {
    expect(splitSentences('こんにちは。元気ですか？はい！', 'ja')).toEqual([
      'こんにちは。',
      '元気ですか？',
      'はい！',
    ]);
  });

  it('splits Chinese sentences', () => {
    expect(splitSentences('你好。今天天气怎么样？很好！', 'zh')).toEqual([
      '你好。',
      '今天天气怎么样？',
      '很好！',
    ]);
  });

  it('handles mixed language text', () => {
    expect(splitSentences('Hello。世界！OK?')).toEqual([
      'Hello。',
      '世界！',
      'OK?',
    ]);
  });

  it('returns single sentence as-is', () => {
    expect(splitSentences('No punctuation here')).toEqual(['No punctuation here']);
  });

  it('handles empty string', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('handles whitespace only', () => {
    expect(splitSentences('   ')).toEqual([]);
  });

  it('does not split on semicolons (Intl.Segmenter treats them as non-terminal)', () => {
    expect(splitSentences('第一句；第二句。', 'zh')).toEqual([
      '第一句；第二句。',
    ]);
  });

  it('handles trailing whitespace between sentences', () => {
    expect(splitSentences('First.  Second.  Third.')).toEqual([
      'First.',
      'Second.',
      'Third.',
    ]);
  });

  // Edge cases that the old regex-based splitter got wrong
  it('does not split on version numbers', () => {
    expect(splitSentences('Qwen3.5 is a model.')).toEqual([
      'Qwen3.5 is a model.',
    ]);
  });

  it('handles abbreviations like e.g.', () => {
    expect(splitSentences('Use e.g., this one. Then that.')).toEqual([
      'Use e.g., this one.',
      'Then that.',
    ]);
  });

  it('handles complex abbreviations with etc.', () => {
    expect(splitSentences(
      'Models like 9B, 27B, 35B-A3B, etc., which vary greatly. Is it using something?'
    )).toEqual([
      'Models like 9B, 27B, 35B-A3B, etc., which vary greatly.',
      'Is it using something?',
    ]);
  });

  it('handles ellipsis', () => {
    expect(splitSentences('Wait... Really?')).toEqual([
      'Wait...',
      'Really?',
    ]);
  });
});
