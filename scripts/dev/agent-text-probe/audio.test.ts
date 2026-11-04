import { describe, expect, it } from 'vitest';
import { activeDbfs, clampInt16, dbToGain, EchoTrack, micFrame, normalizeActive, resample, Track } from './audio';

const RATE = 24000;
const ms = (n: number) => Math.round((n * RATE) / 1000);

describe('Track', () => {
  it('adds clips at their sample, summing where they overlap, and reads zeros past its end', () => {
    const t = new Track(4);
    t.add([1, 2, 3], 2);
    t.add([10, 10], 3, 0.5);
    expect(Array.from(t.read(0, 7))).toEqual([0, 0, 1, 7, 8, 0, 0]);
    expect(t.length).toBe(5);
    // Grows past its first size.
    t.add([4], 5000);
    expect(t.read(5000, 2)[0]).toBe(4);
    expect(t.length).toBe(5001);
  });

  it('cuts off what falls before its start', () => {
    const t = new Track();
    t.add([1, 2, 3], -2);
    expect(Array.from(t.read(0, 2))).toEqual([3, 0]);
  });
});

describe('EchoTrack', () => {
  it('places the played clip `delayMs` later on the microphone, scaled by the gain', () => {
    const e = new EchoTrack({ rate: RATE, delayMs: 120, gain: dbToGain(-6), rir: null });
    const pcm = new Int16Array(ms(10)).fill(1000);
    const placed = e.place(pcm, RATE, 500);
    expect(placed).toEqual({ fromMs: 620, toMs: 630 });
    const window = e.track.read(ms(619), ms(12));
    // Nothing before 620 ms, the clip at −6 dB (×0.501) from there for 10 ms, nothing after.
    expect(window[ms(1) - 1]).toBe(0);
    expect(window[ms(1)]).toBeCloseTo(501.19, 1);
    expect(window[ms(11) - 1]).toBeCloseTo(501.19, 1);
    expect(window[ms(11)]).toBe(0);
  });

  it('adds overlapping echoes rather than replacing one with the other', () => {
    const e = new EchoTrack({ rate: RATE, delayMs: 0, gain: 1, rir: null });
    e.place(new Int16Array(10).fill(100), RATE, 0);
    e.place(new Int16Array(10).fill(50), RATE, 0);
    expect(e.track.read(0, 1)[0]).toBe(150);
  });

  it('resamples a clip at another rate to the microphone rate', () => {
    const e = new EchoTrack({ rate: RATE, delayMs: 0, gain: 1, rir: null });
    const placed = e.place(new Int16Array(160).fill(7), 16000, 0);
    expect(placed.toMs).toBeCloseTo(10, 5);
    expect(e.track.length).toBe(240);
  });

  it('convolves with a sparse room response: each reflection a delayed, scaled copy', () => {
    const rir = { delays: Int32Array.from([0, 3]), gains: Float32Array.from([0.8, 0.5]) };
    const e = new EchoTrack({ rate: RATE, delayMs: 0, gain: 2, rir });
    e.place(Int16Array.from([100]), RATE, 0);
    expect(Array.from(e.track.read(0, 5))).toEqual([160, 0, 0, 100, 0]);
  });
});

describe('micFrame', () => {
  it('adds the echo to the voices', () => {
    const { frame, clipped } = micFrame(Int16Array.from([100, -200, 0]), Float32Array.from([10, 20.4, -30.6]));
    expect(Array.from(frame)).toEqual([110, -180, -31]);
    expect(clipped).toBe(0);
  });

  it('clips at full scale, as the microphone would, and counts the samples clipped', () => {
    const { frame, clipped } = micFrame(Int16Array.from([30000, -30000, 1]), Float32Array.from([5000, -5000, 1]));
    expect(Array.from(frame)).toEqual([32767, -32768, 2]);
    expect(clipped).toBe(2);
  });

  it('with no echo, is the voices unchanged (a copy)', () => {
    const human = Int16Array.from([1, 2]);
    const { frame } = micFrame(human, null);
    expect(Array.from(frame)).toEqual([1, 2]);
    expect(frame).not.toBe(human);
  });
});

describe('levels', () => {
  const tone = (amp: number, n: number) => Int16Array.from({ length: n }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / RATE)));

  it('measures the active level, leaving the pauses out', () => {
    const half = tone(16384, RATE);
    const withPause = new Int16Array(RATE * 2);
    withPause.set(half, 0);
    // A sine at half scale: -6.02 dB peak, -9.03 dBFS RMS; the second of silence does not lower it.
    expect(activeDbfs(half, RATE)).toBeCloseTo(-9.03, 1);
    expect(activeDbfs(withPause, RATE)).toBeCloseTo(-9.03, 1);
    expect(activeDbfs(new Int16Array(100), RATE)).toBe(-Infinity);
  });

  it('brings a clip to a given active level', () => {
    expect(activeDbfs(normalizeActive(tone(16384, RATE), RATE, -20), RATE)).toBeCloseTo(-20, 1);
  });

  it('clamps and resamples', () => {
    expect(clampInt16([40000, -40000, 1.4]).pcm).toEqual(Int16Array.from([32767, -32768, 1]));
    const pcm = Int16Array.from([0, 100]);
    expect(resample(pcm, RATE, RATE)).toBe(pcm);
    expect(resample(Int16Array.from([0, 100, 200, 300]), 16000, 24000)).toHaveLength(6);
  });
});
