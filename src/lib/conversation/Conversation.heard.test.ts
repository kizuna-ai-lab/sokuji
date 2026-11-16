// When an adapter states when its words were heard (`heard`): kept, compared and re-anchored like the text's marks.
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { Heard } from '../contract/adapter';
import { Conversation } from './Conversation';

function make() {
  const clock = createVirtualClock(10_000);
  const conv = new Conversation({ leg: 'speaker', session: 's1', languages: { source: 'en', target: 'ja' }, clock });
  const open = (ref: number) => conv.apply({ kind: 'segmentOpened', payload: { ref, side: 'source' } });
  const text = (ref: number, t: string, o: { heard?: Heard } = {}) => conv.apply({ kind: 'segmentText', payload: { ref, text: t, ...o } });
  const seg = (ref: number) => conv.snapshot().segments.find((s) => s.ref === ref)!;
  return { clock, conv, open, text, seg };
}

describe('Conversation — heard', () => {
  it('stores what the adapter heard and keeps it when a later snapshot states none', () => {
    const { open, text, seg } = make();
    open(1);
    text(1, 'Hello there.', { heard: { pieces: [{ at: 0, len: 5, startAt: 100, endAt: 400 }], stableLen: 5 } });
    text(1, 'Hello there. And');
    expect(seg(1).heard).toEqual({ pieces: [{ at: 0, len: 5, startAt: 100, endAt: 400 }], stableLen: 5 });
  });

  it('does not count a heard-only snapshot as growth', () => {
    const { open, text, seg, clock } = make();
    open(1);
    text(1, 'Hello');
    const marks = seg(1).marks;
    clock.advance(5000);
    text(1, 'Hello', { heard: { pieces: [{ at: 0, len: 5, startAt: 1, endAt: 2 }], stableLen: 5 } });
    expect(seg(1).marks).toBe(marks);
    expect(seg(1).heard?.stableLen).toBe(5);
  });

  it('re-anchors the pieces when the text is rewritten', () => {
    const { open, text, seg } = make();
    open(1);
    text(1, 'hello there', { heard: { pieces: [{ at: 0, len: 5, startAt: 1, endAt: 2 }, { at: 6, len: 5, startAt: 3, endAt: 4 }], stableLen: 11 } });
    text(1, 'Hello, there.');
    expect(seg(1).heard!.pieces.map((p) => [p.at, p.len])).toEqual([[0, 5], [7, 5]]);
    expect(seg(1).heard!.stableLen).toBe(12);
  });

  it('a snapshot that states the same heard again changes nothing', () => {
    const { open, text, seg } = make();
    open(1);
    const heard = { pieces: [{ at: 0, len: 2, startAt: 1, endAt: 2 }], stableLen: 2 };
    text(1, 'Hi', { heard });
    const before = seg(1);
    text(1, 'Hi', { heard: { pieces: [{ at: 0, len: 2, startAt: 1, endAt: 2 }], stableLen: 2 } });
    expect(seg(1)).toBe(before);
  });

  it('Clear drops it with the text of a segment still open', () => {
    const { open, text, seg, conv } = make();
    open(1);
    text(1, 'Hello', { heard: { pieces: [{ at: 0, len: 5, startAt: 1, endAt: 2 }], stableLen: 5 } });
    conv.clear();
    expect(seg(1).text).toBe('');
    expect(seg(1).heard).toBeUndefined();
  });
});
