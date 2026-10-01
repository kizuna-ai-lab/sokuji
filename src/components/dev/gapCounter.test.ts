import { describe, expect, it } from 'vitest';
import { createGapCounter, GAP_MIN_SAMPLES } from './gapCounter';

// The fake's tone, as the tap would hear it. Its first sample is `sin(0) = 0`,
// silent, so the first sound is sample 1 and `at` is measured from there. A
// tone resumed after a gap starts at a nonzero phase (`from` ≠ 0) so the
// gap's length is exact.
const tone = (ms: number, from = 0) =>
  Float32Array.from({ length: 24 * ms }, (_, i) => (Math.sin((2 * Math.PI * 440 * (from + i)) / 24_000) * 8000) / 32768);

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('createGapCounter', () => {
  it('a continuous tone, however it is split across reads, has no gap', () => {
    const counter = createGapCounter();
    const full = tone(500);
    counter.push(full.subarray(0, 1000));
    counter.push(full.subarray(1000, 1037));
    counter.push(full.subarray(1037));
    expect(counter.read()).toEqual({ gaps: 0, gapMs: 0, at: [] });
  });

  it('counts a run of silence of 12 samples inside speech as one gap, and 11 as none', () => {
    const counter = createGapCounter();
    counter.push(tone(100));
    counter.push(new Float32Array(GAP_MIN_SAMPLES));
    counter.push(tone(100, 2412));
    const gapCount = counter.read();
    expect(gapCount.gaps).toBe(1);
    expect(gapCount.gapMs).toBe(0.5);
    expect(gapCount.at[0]).toBeCloseTo(0.1, 3);

    const short = createGapCounter();
    short.push(tone(100));
    short.push(new Float32Array(GAP_MIN_SAMPLES - 1));
    short.push(tone(100, 2411));
    expect(short.read().gaps).toBe(0);
  });

  it('does not count silence before the first sound or after the last', () => {
    const counter = createGapCounter();
    counter.push(new Float32Array(2400));
    counter.push(tone(100));
    counter.push(new Float32Array(2400));
    expect(counter.read().gaps).toBe(0);
  });

  it('counts a gap that straddles two reads once, at its full length', () => {
    const counter = createGapCounter();
    counter.push(concat(tone(100), new Float32Array(30)));
    counter.push(concat(new Float32Array(30), tone(100, 2460)));
    const gapCount = counter.read();
    expect(gapCount.gaps).toBe(1);
    expect(gapCount.gapMs).toBe(2.5);
  });

  it("a 440 Hz tone's zero crossings are not gaps", () => {
    const counter = createGapCounter();
    counter.push(tone(1000));
    expect(counter.read().gaps).toBe(0);
  });
});
