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

  it('keeps a sentence end that has a space before it, as French writes ? and !', () => {
    const c = createSegmentCut();
    const input = { text: 'Ça va ? Encore', final: false, openedAt: 0, marks: [], heard: { pieces: [], stableLen: 7 }, now: 1000 };
    expect(c.update(input).added.map((s) => s.text)).toEqual(['Ça va ?']);
    expect(c.update(input)).toEqual({ added: [], revised: [] });
    expect(c.update(input)).toEqual({ added: [], revised: [] });
    const r = c.update({ text: 'Ça va ? Encore une fois !', final: true, openedAt: 0, marks: [], now: 2000 });
    expect(r.revised).toEqual([]);
    expect(r.added.map((s) => s.text)).toEqual(['Encore une fois !']);
  });

  // Review: only ? and ! take the space before them; a word that begins with a dot stays the next sentence's.
  it('does not pull a dot that begins the next sentence back into the one before', () => {
    for (const [text, first] of [['Hi. .NET is great. And', 'Hi.'], ['Wait. ...and then. So', 'Wait.']]) {
      const c = createSegmentCut();
      const input = { text, final: false, openedAt: 0, marks: [], heard: { pieces: [], stableLen: text.lastIndexOf(' ') }, now: 1000 };
      const added = c.update(input).added.map((s) => s.text);
      expect(added[0]).toBe(first);
      expect(added.join(' ')).toBe(text.slice(0, text.lastIndexOf(' ')));
      expect(c.update(input)).toEqual({ added: [], revised: [] });
    }
  });

  it('reports nothing when nothing changed', () => {
    const c = createSegmentCut();
    const input = { text: 'Same. Text.', final: true, openedAt: 0, marks: [], now: 0 };
    c.update(input);
    expect(c.update(input)).toEqual({ added: [], revised: [] });
  });

  // Review: Soniox words carry their leading space: a piece starting on the space still times the sentence's first word.
  it("times a sentence from its first word even when that word's piece begins with a space", () => {
    const heard = { pieces: [{ at: 0, len: 5, startAt: 100, endAt: 400 }, { at: 5, len: 1, startAt: 400, endAt: 450 }, { at: 6, len: 5, startAt: 2000, endAt: 2300 }, { at: 11, len: 1, startAt: 2300, endAt: 2350 }], stableLen: 12 };
    const r = createSegmentCut().update({ text: 'First. Next.', final: true, openedAt: 0, marks: [], heard, now: 3000 });
    expect(r.added.map((s) => [s.text, s.startAt, s.endAt])).toEqual([['First.', 100, 450], ['Next.', 2000, 2350]]);
  });

  it('after 45 s does not take a sentence that ends exactly where the open text ends', () => {
    const c = createSegmentCut();
    expect(c.update({ text: 'We need to ship.', final: false, openedAt: 0, marks: marks([44_000, 16]), now: 45_000 }).added).toEqual([]);
    expect(c.update({ text: 'Done. We need to ship.', final: false, openedAt: 0, marks: marks([44_000, 22]), now: 45_000 }).added.map((s) => s.text)).toEqual(['Done.']);
  });

  // Owner's decision: a final segment without a sentence end is cut at a pause of 5 s and into stretches of at most 45 s.
  it('cuts a final segment without sentence ends where the speaker paused for 5 s', () => {
    const text = 'we talked about the budget and then we moved on to hiring';
    const r = createSegmentCut().update({ text, final: true, openedAt: 0, marks: marks([1000, 9], [2000, 26], [8000, 35], [9000, 57]), now: 9000 });
    expect(r.added.map((s) => [s.text, s.startAt, s.endAt])).toEqual([
      ['we talked about the budget', 1000, 2000],
      ['and then we moved on to hiring', 8000, 9000],
    ]);
  });

  it('cuts a long final segment without sentence ends into stretches of at most 45 s, never inside a word', () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    // One word every 2 s, no pause: 100 s of speech.
    const growth = words.map((_, i) => [2000 * (i + 1), words.slice(0, i + 1).join(' ').length] as [number, number]);
    const r = createSegmentCut().update({ text, final: true, openedAt: 0, marks: marks(...growth), now: 100_000 });
    expect(r.added.length).toBe(3);
    expect(r.added.map((s) => s.text).join(' ')).toBe(text);
    for (const s of r.added) {
      expect(s.endAt - s.startAt).toBeLessThanOrEqual(45_000);
      expect(s.text).toMatch(/^word\d+( word\d+)*$/);
    }
  });

  it('does not cut a final segment that has its own sentence ends at its pauses', () => {
    const r = createSegmentCut().update({ text: 'One thing. Another thing.', final: true, openedAt: 0, marks: marks([1000, 10], [9000, 25]), now: 9000 });
    expect(r.added.map((s) => s.text)).toEqual(['One thing.', 'Another thing.']);
  });
});

