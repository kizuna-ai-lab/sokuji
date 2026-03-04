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
    expect(splitSentences('こんにちは。元気ですか？はい！')).toEqual([
      'こんにちは。',
      '元気ですか？',
      'はい！',
    ]);
  });

  it('splits Chinese sentences', () => {
    expect(splitSentences('你好。今天天气怎么样？很好！')).toEqual([
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

  it('splits on semicolons (Chinese)', () => {
    expect(splitSentences('第一句；第二句。')).toEqual([
      '第一句；',
      '第二句。',
    ]);
  });

  it('handles trailing whitespace between sentences', () => {
    expect(splitSentences('First.  Second.  Third.')).toEqual([
      'First.',
      'Second.',
      'Third.',
    ]);
  });
});
