import { describe, it, expect } from 'vitest';
import type { HistoryNotesBody } from './types';
import { findWord, replaceInNotes, replaceWord, swapIn } from './wordFix';

/** A notes body with one topic and one point. */
function notes(o: { title: string; overview: string; topic: [string, string]; point: { text: string; owner?: string }; names: Array<Record<string, unknown>> }): HistoryNotesBody {
  return {
    title: o.title,
    overview: { text: o.overview, format: 'plain' },
    topics: [{ title: o.topic[0], summary: o.topic[1], first: 1 }],
    points: [{ topic: 0, text: o.point.text, owner: o.point.owner, sentences: [1], kinds: [] }],
    names: o.names,
  };
}

// Owner, 2026-11-19 (design §5.1): a misheard word is fixed everywhere at once. CJK and kana are found anywhere; a
// Latin word only whole, in any case, so "Un" is not found in "Under".
describe('finding a misheard word', () => {
  it('finds a CJK word anywhere', () => expect(findWord('Sokuji 搜库机 和搜库机', '搜库机')).toEqual([{ start: 7, end: 10 }, { start: 12, end: 15 }]));
  it('finds a Latin word whole, in any case', () => expect(findWord('Under Un un', 'Un').map((r) => r.start)).toEqual([6, 9]));
  it('counts digits as part of a Latin word', () => expect(findWord('V3 V30', 'V3')).toEqual([{ start: 0, end: 2 }]));
  it('takes CJK beside a Latin word as a boundary', () => expect(findWord('用Uniswap换', 'Uniswap')).toEqual([{ start: 1, end: 8 }]));
  it('reads the word literally', () => expect(findWord('a.b a+b', 'a+b')).toEqual([{ start: 4, end: 7 }]));
});

describe('replacing it', () => {
  it('replaces every one, as typed', () => expect(replaceWord('搜库机和搜库机', '搜库机', 'Sokuji')).toEqual({ text: 'Sokuji和Sokuji', count: 2 }));
  // Review focus: a word that is part of the right one changes only where it was misheard.
  it('a word inside its replacement', () => expect(replaceWord('Sok and Sokuji', 'Sok', 'Sokuji')).toEqual({ text: 'Sokuji and Sokuji', count: 1 }));
  it('replaces in the notes, names left alone', () => {
    const { body, count } = replaceInNotes(notes({
      title: '搜库机周会', overview: '搜库机', topic: ['搜库机', '用搜库机'], point: { text: '搜库机上线', owner: '搜库机组' }, names: [{ written: '搜库机' }],
    }), '搜库机', 'Sokuji');
    expect(count).toBe(6);
    expect(body.title).toBe('Sokuji周会');
    expect(body.points[0]).toMatchObject({ text: 'Sokuji上线', owner: 'Sokuji组' });
    expect(body.names).toEqual([{ written: '搜库机' }]);
  });
});

// Design §5.2: an edit that swaps one word for another is offered everywhere the misheard word shows.
describe('telling a one-word swap', () => {
  it('tells a one-word swap', () => expect(swapIn('我们用搜库机开会', '我们用Sokuji开会')).toEqual({ from: '搜库机', to: 'Sokuji' }));
  it('widens a swap to whole Latin words', () => expect(swapIn('the Un450P三 one', 'the Uniswap V3 one')).toEqual({ from: 'Un450P三', to: 'Uniswap V3' }));
  it('an added or dropped word is no swap', () => {
    expect(swapIn('abc', 'abcd')).toBeNull();
    expect(swapIn('abc', 'abc')).toBeNull();
  });
});
