import { describe, it, expect, vi } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { ClipQueue, LEAD_S, type AudioTimeline } from './clipQueue';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

/** A timeline the test moves by hand; a clip ends once the clock passes its end, or when stopped. */
function fakeTimeline() {
  let now = 0;
  const plays: Array<{ pcm: Int16Array; at: number; onEnded: () => void; stopped: boolean; done: boolean }> = [];
  const timeline: AudioTimeline = {
    now: () => now,
    play(pcm, at, onEnded) {
      const play = { pcm, at, onEnded, stopped: false, done: false };
      plays.push(play);
      return () => {
        play.stopped = true;
        if (!play.done) {
          play.done = true;
          play.onEnded();
        }
      };
    },
  };
  const advance = (seconds: number) => {
    now += seconds;
    for (const play of plays) {
      if (!play.done && play.at + play.pcm.length / SAMPLE_RATE <= now) {
        play.done = true;
        play.onEnded();
      }
    }
  };
  return { timeline, plays, advance };
}

/** `ms` milliseconds of pcm. */
const pcm = (ms: number) => new Int16Array((SAMPLE_RATE * ms) / 1000);

describe('ClipQueue', () => {
  it('plays clips back to back in the order they were enqueued, the first one lead ahead of the clock', () => {
    const { timeline, plays } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(200));
    queue.enqueue('b', pcm(100));
    expect(plays.map((p) => p.at)).toEqual([LEAD_S, LEAD_S + 0.2]);
    expect(queue.pending).toBe(2);
  });

  it('says which clip plays and how far into it, and null before it starts and once it has ended', () => {
    const { timeline, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(200));
    expect(queue.position()).toBeNull();
    advance(LEAD_S + 0.05);
    expect(queue.position()?.key).toBe('a');
    expect(queue.position()?.t).toBeCloseTo(50, 6);
    advance(0.2);
    expect(queue.position()).toBeNull();
    expect(queue.pending).toBe(0);
  });

  it('moves to the next clip at the boundary', () => {
    const { timeline, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(100));
    queue.enqueue('b', pcm(100));
    advance(LEAD_S + 0.15);
    expect(queue.position()?.key).toBe('b');
    expect(queue.position()?.t).toBeCloseTo(50, 6);
  });

  it('is null in a gap: a clip enqueued after the queue drained starts one lead ahead of the clock, not at the old tail', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(100));
    advance(1);
    expect(queue.position()).toBeNull();
    queue.enqueue('b', pcm(100));
    expect(plays[1].at).toBeCloseTo(1 + LEAD_S, 9);
  });

  it('tells subscribers when a clip is enqueued and when one ends', () => {
    const { timeline, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    const heard = vi.fn();
    const off = queue.subscribe(heard);
    queue.enqueue('a', pcm(100));
    expect(heard).toHaveBeenCalledTimes(1);
    advance(1);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    queue.enqueue('b', pcm(100));
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('clear stops every clip, drops them, tells subscribers once, and the next clip starts fresh', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(500));
    queue.enqueue('b', pcm(500));
    advance(LEAD_S + 0.1);
    const heard = vi.fn();
    queue.subscribe(heard);
    queue.clear();
    expect(plays.every((p) => p.stopped)).toBe(true);
    expect(queue.pending).toBe(0);
    expect(queue.position()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    queue.enqueue('c', pcm(100));
    expect(plays[2].at).toBeCloseTo(LEAD_S + 0.1 + LEAD_S, 9);
  });

  it('ignores an empty clip', () => {
    const { timeline, plays } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', new Int16Array(0));
    expect(plays).toHaveLength(0);
    expect(queue.pending).toBe(0);
  });

  it('a subscriber that throws is reported and does not keep the next from hearing', () => {
    const { timeline } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    reportErrorSpy.mockClear();
    queue.subscribe(() => { throw new Error('buggy karaoke'); });
    const heard = vi.fn();
    queue.subscribe(heard);
    queue.enqueue('a', pcm(100));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });
});
