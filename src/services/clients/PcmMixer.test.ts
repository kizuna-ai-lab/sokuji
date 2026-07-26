import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PcmMixer } from './PcmMixer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(onFrame: (m: Int16Array) => void, over = {}) {
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
});
