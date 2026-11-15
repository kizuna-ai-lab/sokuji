// The sentence cutter for one source segment: numbers and times stay, texts follow later corrections.
import { describe, it, expect } from 'vitest';
import { createSegmentCut } from './cut';

const marks = (...m: [number, number][]) => m.map(([at, len]) => ({ at, len }));

describe('the sentence cutter', () => {
  it('cuts a final segment at its sentence ends and keeps the rest as a last sentence', () => {
    const c = createSegmentCut();
    const r = c.update({ text: 'Can you ship by Wednesday? It depends on the test', final: true, openedAt: 1000, marks: marks([1500, 26], [3000, 49]), now: 3000 });
    expect(r.added.map((s) => [s.index, s.text])).toEqual([[0, 'Can you ship by Wednesday?'], [1, 'It depends on the test']]);
    expect(r.added.map((s) => [s.startAt, s.endAt, s.timeKind])).toEqual([[1500, 1500, 'estimated'], [3000, 3000, 'estimated']]);
  });

  it('cuts Chinese and Japanese text', () => {
    const r = createSegmentCut().update({ text: '下周三之前能交货吗？要看认证测试的结果。', final: true, openedAt: 0, marks: [], now: 0 });
    expect(r.added.map((s) => s.text)).toEqual(['下周三之前能交货吗？', '要看认证测试的结果。']);
  });

  it('takes only the stable part of an open segment and gives its times from what was heard', () => {
    const c = createSegmentCut();
    const heard = { pieces: [{ at: 0, len: 6, startAt: 100, endAt: 500 }, { at: 6, len: 6, startAt: 500, endAt: 900 }, { at: 13, len: 4, startAt: 1200, endAt: 1500 }], stableLen: 17 };
    const r = c.update({ text: 'First one. Then the next', final: false, openedAt: 0, marks: [], heard, now: 2000 });
    expect(r.added).toEqual([{ index: 0, text: 'First one.', startAt: 100, endAt: 900, timeKind: 'given' }]);
    expect(c.update({ text: 'First one. Then the next.', final: true, openedAt: 0, marks: [], heard: { ...heard, stableLen: 25 }, now: 3000 }).added.map((s) => s.index)).toEqual([1]);
  });

  it('waits 45 s before cutting an open segment that states nothing stable, and leaves the sentence being spoken', () => {
    const c = createSegmentCut();
    const text = 'One is done. Two is done. Three is still';
    expect(c.update({ text, final: false, openedAt: 0, marks: marks([10_000, 12], [20_000, 25], [44_000, 40]), now: 44_000 }).added).toEqual([]);
    expect(c.update({ text, final: false, openedAt: 0, marks: marks([10_000, 12], [20_000, 25], [44_000, 40]), now: 45_000 }).added.map((s) => s.text)).toEqual(['One is done.', 'Two is done.']);
  });

  it('cuts text without a sentence end after a pause of 5 s, inside the stable part only', () => {
    const c = createSegmentCut();
    const heard = { pieces: [], stableLen: 9 };
    expect(c.update({ text: 'no ending', final: false, openedAt: 0, marks: marks([1000, 9]), heard, now: 5999 }).added).toEqual([]);
    expect(c.update({ text: 'no ending', final: false, openedAt: 0, marks: marks([1000, 9]), heard, now: 6000 }).added.map((s) => s.text)).toEqual(['no ending']);
  });

  it('keeps numbers and reports new texts when punctuation is filled in later', () => {
    const c = createSegmentCut();
    c.update({ text: 'hello there. how are you', final: true, openedAt: 0, marks: [], now: 0 });
    const r = c.update({ text: 'Hello there. How are you?', final: true, openedAt: 0, marks: [], now: 100 });
    expect(r.added).toEqual([]);
    expect(r.revised).toEqual([{ index: 0, text: 'Hello there.' }, { index: 1, text: 'How are you?' }]);
  });

  // A known limit, on purpose: when the service changes the number of letters, the cut stays at the old count.
  it('keeps the cuts at the same count of letters when words change', () => {
    const c = createSegmentCut();
    c.update({ text: 'I red the book. It was good.', final: true, openedAt: 0, marks: [], now: 0 });
    expect(c.update({ text: 'I read the book. It was good.', final: true, openedAt: 0, marks: [], now: 1 }).revised).toEqual([{ index: 0, text: 'I read the boo' }, { index: 1, text: 'k. It was good.' }]);
  });

  it('gives a stored sentence what is left when the text becomes shorter', () => {
    const c = createSegmentCut();
    c.update({ text: 'One two. Three four.', final: true, openedAt: 0, marks: [], now: 0 });
    expect(c.update({ text: 'One.', final: true, openedAt: 0, marks: [], now: 1 }).revised).toEqual([{ index: 0, text: 'One.' }, { index: 1, text: '' }]);
  });

  it('reports nothing when nothing changed', () => {
    const c = createSegmentCut();
    const input = { text: 'Same. Text.', final: true, openedAt: 0, marks: [], now: 0 };
    c.update(input);
    expect(c.update(input)).toEqual({ added: [], revised: [] });
  });
});
