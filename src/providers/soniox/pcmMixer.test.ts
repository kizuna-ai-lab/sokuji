import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PcmMixer } from './pcmMixer';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(onFrame: (m: Int16Array, ea: number, eb: number) => void, over = {}) {
  return new PcmMixer({ frameSamples: 4, intervalMs: 100, maxBacklogSamples: 12, onFrame, ...over });
}

describe('PcmMixer', () => {
  it('sums the two channels at fixed 0.5 each on each tick', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    m.pushA(new Int16Array([100, 200, 300, 400]));
    m.pushB(new Int16Array([10, 20, 30, 40]));
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([55, 110, 165, 220]); // round(0.5a+0.5b)
    m.stop();
  });

  it('zero-fills a starved channel (one side silent) — active side at half level', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    m.pushA(new Int16Array([100, 200, 300, 400])); // B empty
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([50, 100, 150, 200]);
    m.stop();
  });

  it('emits a full silence frame when both channels are empty (keepalive-friendly)', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    vi.advanceTimersByTime(100);
    expect(frames[0].length).toBe(4);
    expect(Array.from(frames[0])).toEqual([0, 0, 0, 0]);
    m.stop();
  });

  it('consumes the queue across ticks in order', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    m.pushA(new Int16Array([2, 4, 6, 8, 10, 12])); // 6 samples, frame=4
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([1, 2, 3, 4]);
    expect(Array.from(frames[1])).toEqual([5, 6, 0, 0]); // remaining 2 + zero-fill
    m.stop();
  });

  it('drops oldest samples past the backlog cap', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f), { maxBacklogSamples: 4 });
    m.start();
    m.pushA(new Int16Array([1, 2, 3, 4, 5, 6])); // cap 4 → keep [3,4,5,6]
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([2, 2, 3, 3]); // 0.5*[3,4,5,6] rounded
    m.stop();
  });

  it('stop() halts emission and start() is idempotent', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start(); m.start();
    m.stop();
    vi.advanceTimersByTime(500);
    expect(frames).toHaveLength(0);
  });

  it('clips the sum into int16 range', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f), { frameSamples: 1 });
    m.start();
    m.pushA(new Int16Array([32767])); m.pushB(new Int16Array([32767]));
    vi.advanceTimersByTime(100);
    expect(frames[0][0]).toBe(32767); // 0.5*32767+0.5*32767 = 32767, no clip
    m.stop();
  });

  it('reports per-channel mean-absolute energy of the raw (pre-gain) samples', () => {
    const got: Array<[number, number]> = [];
    const m = make((_f: Int16Array, ea: number, eb: number) => got.push([ea, eb]));
    m.start();
    m.pushA(new Int16Array([100, -100, 100, -100]));
    m.pushB(new Int16Array([10, 10, -10, -10]));
    vi.advanceTimersByTime(100);
    expect(got[0]).toEqual([100, 10]);
    m.stop();
  });

  it('reports zero energy for a silent/starved channel and partial energy for a zero-filled tail', () => {
    const got: Array<[number, number]> = [];
    const m = make((_f: Int16Array, ea: number, eb: number) => got.push([ea, eb]));
    m.start();
    m.pushA(new Int16Array([200, 200])); // 2 of 4 samples → mean |.| = 100
    vi.advanceTimersByTime(100);
    expect(got[0]).toEqual([100, 0]);
    m.stop();
  });

  // The capture delivers 100 ms of audio every 100 ms, but a browser fires
  // every timer a little late. One frame per tick keeps up only if the ticks
  // stay on the 100-ms grid (as `setInterval` did); otherwise the backlog
  // grows to the cap and audio is dropped from then on.
  it('keeps up with real-time input on a clock whose timers fire late: 600 frames in 60 s, no backlog growth', () => {
    const v = createVirtualClock(0);
    const late = 2;
    const clock: Clock = { now: v.now, setTimeout: (fn, ms) => v.setTimeout(fn, ms + late) };
    const frameSamples = 1600; // 100 ms at 16 kHz
    const frames: Int16Array[] = [];
    const m = new PcmMixer({
      clock,
      frameSamples,
      intervalMs: 100,
      maxBacklogSamples: 32_000,
      onFrame: (f) => frames.push(f),
    });
    m.start();
    const chunk = new Int16Array(frameSamples).fill(1000);
    for (let t = 0; t < 600; t++) {
      m.pushA(chunk);
      m.pushB(chunk);
      v.advance(100);
    }
    // The 600th frame is due at 60 000 ms and fires `late` after it.
    v.advance(late);
    expect(frames).toHaveLength(600);
    expect(frames.every((f) => f.every((s) => s === 1000))).toBe(true);
    // Nothing queued behind it: the next tick finds both channels empty.
    v.advance(100);
    m.stop();
    expect(frames).toHaveLength(601);
    expect(frames[600].every((s) => s === 0)).toBe(true);
  });

  // A timer that fires a millisecond early (the renderer's monotonic timers
  // against an integer `Date.now()`) must not tick its beat twice: the second
  // tick would find the queue empty and send a silent frame mid-speech.
  it('inserts no silent frame on a clock whose timers fire early: 600 full frames in 60 s', () => {
    const v = createVirtualClock(0);
    const clock: Clock = { now: v.now, setTimeout: (fn, ms) => v.setTimeout(fn, ms > 1 ? ms - 1 : ms) };
    const frameSamples = 1600;
    const frames: Int16Array[] = [];
    const m = new PcmMixer({ clock, frameSamples, intervalMs: 100, maxBacklogSamples: 32_000, onFrame: (f) => frames.push(f) });
    m.start();
    const chunk = new Int16Array(frameSamples).fill(1000);
    for (let t = 0; t < 600; t++) {
      m.pushA(chunk);
      m.pushB(chunk);
      v.advance(100);
    }
    m.stop();
    expect(frames).toHaveLength(600);
    expect(frames.some((f) => f.every((s) => s === 0))).toBe(false);
  });
});
