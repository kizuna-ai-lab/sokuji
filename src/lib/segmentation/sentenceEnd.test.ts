import { describe, it, expect } from 'vitest';
import {
  periodIsNotSentenceEnd,
  lastSentenceEnd,
  lastClauseEnd,
  sentenceEnds,
  breakpoints,
  skeleton,
  baseLang,
} from './sentenceEnd';

describe('periodIsNotSentenceEnd', () => {
  // Every case here is one the spec measured Intl.Segmenter getting wrong.
  const notAnEnd: [string, number][] = [
    ['Dr. Smith will join us.', 2],
    ['I met Mr. Brown today.', 8],
    ['Use a fruit, e.g. Apple.', 16],
    ['He served in the U.S. Army.', 20],
    ['The meeting is at 2 p.m. Please be on time.', 23],
    ['Version 3.5 is out.', 9],
    ['Visit sokuji.kizuna.ai for details.', 12],
    ['Wait... What happened?', 4],
    ['J. K. Rowling wrote it.', 1],
    ['Das ist z. B. ein Test.', 9],
    ['Siehe Nr. 5 im Anhang.', 8],
    ['El Sr. García llegó ayer.', 5],
    ['A Dra. Silva chegou.', 5],
    ['Это т. е. пример.', 5],
  ];
  it.each(notAnEnd)('%s: the dot at %i is not a sentence end', (text, dot) => {
    expect(text[dot]).toBe('.');
    expect(periodIsNotSentenceEnd(text, dot)).toBe(true);
  });

  const isAnEnd: [string, number][] = [
    ['Thanks. See you.', 6],
    ['Apple Inc. Announced results.', 28],
    ['It is free. Try it.', 10],
  ];
  it.each(isAnEnd)('%s: the dot at %i ends a sentence', (text, dot) => {
    expect(text[dot]).toBe('.');
    expect(periodIsNotSentenceEnd(text, dot)).toBe(false);
  });

  it('derives the casing signal from the text when the caller omits it', () => {
    // Same sentence twice; only the capitals differ. Cased: the lowercase
    // continuation is GPT-Live's mid-sentence period, not an end. Uncased:
    // casing says nothing, so the period is taken at face value.
    expect(periodIsNotSentenceEnd('I said no. then we left.', 9)).toBe(true);
    expect(periodIsNotSentenceEnd('i said no. then we left.', 9)).toBe(false);
  });
});

describe('lastSentenceEnd', () => {
  it('returns the index just past the terminal', () => {
    expect(lastSentenceEnd('Hello there. And then')).toBe(12);
  });
  it('includes closing quotes and brackets', () => {
    expect(lastSentenceEnd('He said "go.") Then')).toBe(14);
  });
  it('judges a word split across deltas on the whole word', () => {
    expect(lastSentenceEnd('. Andrew', 'Dr')).toBe(-1);
  });
  it('returns -1 with no terminal', () => {
    expect(lastSentenceEnd('no terminal here')).toBe(-1);
  });

  // The flip-flop hazard: the delta is the same six characters both times.
  // Only the item it lands in differs, and the casing signal has to come from
  // the item, or a cased utterance loses the guard mid-flight.
  it('reads casing from the whole item, so a lowercase delta inside a cased item does not cut', () => {
    expect(lastSentenceEnd('. then', 'Hello there, I said no')).toBe(-1);
  });
  it('cuts the same delta when the item it lands in is all lowercase', () => {
    expect(lastSentenceEnd('. then', 'hello there, i said no')).toBe(1);
  });
});

describe('lastClauseEnd', () => {
  it('returns the index just past the last clause mark', () => {
    expect(lastClauseEnd('one, two; three')).toBe(9);
  });
  it('returns -1 with no clause mark', () => {
    expect(lastClauseEnd('nothing here')).toBe(-1);
  });
});

describe('sentenceEnds', () => {
  it('lists every sentence end in order, closers included', () => {
    expect(sentenceEnds('One. Two? Three!')).toEqual([4, 9, 16]);
  });
  it('skips abbreviation dots', () => {
    expect(sentenceEnds('Dr. Smith spoke. Then left.')).toEqual([16, 27]);
  });
  it('handles CJK terminals', () => {
    expect(sentenceEnds('你好。世界！')).toEqual([3, 6]);
  });
  it('is empty for unpunctuated text', () => {
    expect(sentenceEnds('这是一段没有标点的文字')).toEqual([]);
  });

  // A CTC-style model writes punctuation but no capitals. Every sentence then
  // starts lowercase, so the lowercase-continuation guard has to stand down or
  // "By sentences" finds no boundary at all and falls back to length.
  it('finds every boundary in an uncased transcript', () => {
    expect(sentenceEnds('one. two. three. four.')).toEqual([4, 9, 16, 22]);
  });
  it('finds the boundary after a lowercase sentence', () => {
    expect(sentenceEnds('hello. this is next')).toEqual([6]);
  });
  it('still suppresses a lowercase continuation where the transcript does capitalise', () => {
    expect(sentenceEnds('I said no. then we left.')).toEqual([24]);
  });
  it('leaves a cased transcript alone', () => {
    expect(sentenceEnds('One. Two. Three. Four.')).toEqual([4, 9, 16, 22]);
  });
});

describe('breakpoints', () => {
  it('merges sentence ends and clause marks in order', () => {
    expect(breakpoints('One, two. Three')).toEqual([4, 9]);
  });
  it('includes CJK commas', () => {
    expect(breakpoints('你好，世界。')).toEqual([3, 6]);
  });
});

describe('skeleton', () => {
  it('keeps letters and digits, lowercased, and drops everything else', () => {
    expect(skeleton('Hello, World! 42')).toBe('helloworld42');
  });
  it('keeps CJK characters', () => {
    expect(skeleton('你好，世界。')).toBe('你好世界');
  });
  it('is case-insensitive so a model that recases still matches', () => {
    expect(skeleton('i think so')).toBe(skeleton('I think so.'));
  });
});

describe('baseLang', () => {
  it.each([
    ['zh', 'zh'],
    ['zh-CN', 'zh'],
    ['cmn-CN', 'zh'],
    ['yue', 'yue'],
    ['en-US', 'en'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(baseLang(input)).toBe(expected);
  });
});
