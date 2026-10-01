import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { createLevelMeter, LEVEL_BARS, LEVEL_STALE_MS, type LevelMeter } from './levelMeter';

/** `ms` of a sine at `hz`, its peak `dbfs` below full scale (32768), rounded to Int16. */
const sine = (hz: number, dbfs: number, ms: number): Int16Array => {
  const amplitude = Math.min(32767, 32768 * 10 ** (dbfs / 20));
  return Int16Array.from({ length: (SAMPLE_RATE * ms) / 1000 }, (_, i) => Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)));
};
const silence = (ms: number): Int16Array => new Int16Array((SAMPLE_RATE * ms) / 1000);
const zeros = () => new Array(LEVEL_BARS).fill(0);
/** The bin a tone lands in: a 64-point FFT spreads 0..SAMPLE_RATE over 64 bins. */
const binOf = (hz: number) => Math.round((hz * 64) / SAMPLE_RATE);
const peakOf = (levels: Float32Array) => levels.indexOf(Math.max(...levels));
/** Reads one window until the smoothing has converged (0.8^100 ≈ 2e-10 left). */
const settle = (meter: LevelMeter): Float32Array => {
  let levels = meter.read();
  for (let i = 0; i < 100; i++) levels = meter.read();
  return levels;
};

/** On a bin centre: 64 samples hold exactly 8 of its cycles, whatever the window's start. */
const TONE_HZ = 3000;
const TONE_BIN = 8;

describe('createLevelMeter', () => {
  it(`reads ${LEVEL_BARS} zeros before any chunk`, () => {
    const meter = createLevelMeter(createVirtualClock(0));
    expect([...meter.read()]).toEqual(zeros());
  });

  it("a tone peaks in its own bin and dominates the bins outside the window's main lobe", () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(sine(TONE_HZ, -40, 100));
    clock.advance(100);
    const levels = meter.read();
    expect(binOf(TONE_HZ)).toBe(TONE_BIN);
    expect(peakOf(levels)).toBe(TONE_BIN);
    expect(levels[TONE_BIN]).toBeGreaterThan(0);
    // Through a Blackman window a tone on a bin centre leaks into the two bins
    // either side only (the main lobe ends at ±3); the Int16 rounding error,
    // at most half a step, stays below -100 dB.
    for (let k = 0; k < LEVEL_BARS; k++) {
      if (Math.abs(k - TONE_BIN) >= 3) expect(levels[k]).toBe(0);
    }
  });

  it('silence reads 0 in every bin, below minDecibels', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(silence(100));
    for (const at of [0, 50, 50]) {
      clock.advance(at);
      expect([...meter.read()]).toEqual(zeros());
    }
  });

  it(`reads flat once nothing arrived for ${LEVEL_STALE_MS}ms`, () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(sine(TONE_HZ, -40, 100));
    clock.advance(100);
    expect(meter.read()[TONE_BIN]).toBeGreaterThan(0);
    clock.advance(LEVEL_STALE_MS + 1 - 100);
    expect([...meter.read()]).toEqual(zeros());
  });

  it('reset() reads flat at once', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(sine(TONE_HZ, -40, 100));
    clock.advance(100);
    expect(meter.read()[TONE_BIN]).toBeGreaterThan(0);
    meter.reset();
    expect([...meter.read()]).toEqual(zeros());
  });

  it('a chunk after a stale gap starts clean: no stale samples in its window, no stale smoothing', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    // Two loud chunks: the second's window reaches back into the first.
    meter.push(sine(TONE_HZ, 0, 100));
    clock.advance(100);
    meter.push(sine(TONE_HZ, 0, 100));
    clock.advance(100);
    settle(meter);
    clock.advance(LEVEL_STALE_MS + 1);
    meter.push(sine(1500, -40, 100));
    // 1 ms in, the playhead is 24 samples into the chunk: the window still
    // reaches 40 samples back, before it.
    clock.advance(1);

    const freshClock = createVirtualClock(0);
    const fresh = createLevelMeter(freshClock);
    fresh.push(sine(1500, -40, 100));
    freshClock.advance(1);
    expect([...meter.read()]).toEqual([...fresh.read()]);
  });

  it("moves at the frame rate: each read takes the window at the playhead, not the chunk's end", () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    // One 100 ms chunk: 50 ms of silence, then 50 ms of the tone.
    const chunk = silence(100);
    chunk.set(sine(TONE_HZ, -40, 50), chunk.length / 2);
    meter.push(chunk);
    clock.advance(20); // the playhead is in the silence
    const early = meter.read();
    clock.advance(60); // no new chunk; the playhead is in the tone
    const late = meter.read();
    expect([...early]).toEqual(zeros());
    expect(peakOf(late)).toBe(TONE_BIN);
    expect(late[TONE_BIN]).toBeGreaterThan(0);
  });

  it("a read as a chunk lands takes its window from the previous chunk's tail", () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(sine(TONE_HZ, -40, 100));
    clock.advance(100);
    meter.push(silence(100));
    const spanning = meter.read();

    const referenceClock = createVirtualClock(0);
    const reference = createLevelMeter(referenceClock);
    reference.push(sine(TONE_HZ, -40, 100));
    referenceClock.advance(100);
    expect([...spanning]).toEqual([...reference.read()]);
    expect(peakOf(spanning)).toBe(TONE_BIN);
  });

  it('a window spans as many earlier chunks as it needs when they are shorter than it', () => {
    const tone = sine(TONE_HZ, -40, 100);
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(tone.slice(0, 32));
    meter.push(tone.slice(32, 64));
    meter.push(tone.slice(64, 96));
    const spanning = meter.read();

    const referenceClock = createVirtualClock(0);
    const reference = createLevelMeter(referenceClock);
    reference.push(tone.slice(0, 64));
    referenceClock.advance(3); // past the chunk's 64 samples: the playhead rests at its end
    expect([...spanning]).toEqual([...reference.read()]);
  });

  it("every bin is the spec's windowed DFT of the window, not just a tone's", () => {
    // A naive DFT of the spec's formula: X[k] = (1/N)·Σ x[n]·w[n]·e^(−2πikn/N).
    const window = (n: number) => 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / 64) + 0.08 * Math.cos((4 * Math.PI * n) / 64);
    let seed = 1;
    // Noise at -40 dBFS, so no bin sits on a clamp.
    const noise = Int16Array.from({ length: 200 }, () => {
      seed = (seed * 16807) % 2147483647;
      return Math.round(((seed / 2147483647) * 2 - 1) * 328);
    });
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(noise);
    clock.advance(5); // the playhead is 120 samples in
    const levels = settle(meter);
    const x = Array.from(noise.slice(120 - 64, 120), (v) => v / 32768);
    for (let k = 0; k < LEVEL_BARS; k++) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < 64; n++) {
        re += x[n] * window(n) * Math.cos((2 * Math.PI * k * n) / 64);
        im -= x[n] * window(n) * Math.sin((2 * Math.PI * k * n) / 64);
      }
      const db = 20 * Math.log10(Math.hypot(re, im) / 64);
      expect(db).toBeGreaterThan(-100);
      expect(db).toBeLessThan(-30);
      expect(levels[k]).toBeCloseTo((db + 100) / 70, 5);
    }
  });

  it('smooths like the analyser (τ = 0.8): consecutive reads of one window approach its steady value', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(sine(TONE_HZ, -40, 100));
    clock.advance(100);
    const first = meter.read()[TONE_BIN];
    const second = meter.read()[TONE_BIN];
    const steady = settle(meter)[TONE_BIN];
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(steady);
    expect(steady - second).toBeLessThan(steady - first);
    // From zero, n reads of one window hold (1 − τⁿ) of its magnitude: 0.2,
    // then 0.36 — in dB over the 70 dB range, that far below the steady value.
    expect(first).toBeCloseTo(steady + (20 * Math.log10(0.2)) / 70, 6);
    expect(second).toBeCloseTo(steady + (20 * Math.log10(0.36)) / 70, 6);
  });

  it("maps onto the analyser's scale: -100..-30 dB over 0..1", () => {
    const loudClock = createVirtualClock(0);
    const loud = createLevelMeter(loudClock);
    loud.push(sine(TONE_HZ, 0, 100));
    loudClock.advance(100);
    // A full-scale sine's bin reads -13.6 dB, above maxDecibels: the top.
    expect(settle(loud)[TONE_BIN]).toBe(1);

    const quietClock = createVirtualClock(0);
    const quiet = createLevelMeter(quietClock);
    quiet.push(sine(TONE_HZ, -60, 100));
    quietClock.advance(100);
    // What a sine's peak bin loses to the window: the Blackman window's mean
    // (its coherent gain, 0.42), halved because a real sine's amplitude
    // splits between +f and -f.
    const windowGain = 2 / 0.42;
    const expected = (-60 - 20 * Math.log10(windowGain) - -100) / 70;
    // Within 0.005 (0.35 dB): rounding a 33-step sine to Int16 moves its peak
    // by at most half a step, 1.5% (0.13 dB, 0.002 here); the smoothing left
    // after `settle` is 2e-10; and the output strip's own bytes are 1/255
    // (0.004) apart, so this is the resolution the analyser shows.
    expect(settle(quiet)[TONE_BIN]).toBeCloseTo(expected, 2);
  });

  it('gives a new array on every read, safe for a caller to keep', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(sine(TONE_HZ, -40, 100));
    clock.advance(100);
    const first = meter.read();
    const second = meter.read();
    expect(first).not.toBe(second);
    expect(first).toHaveLength(LEVEL_BARS);
    expect(second).toHaveLength(LEVEL_BARS);
  });
});
