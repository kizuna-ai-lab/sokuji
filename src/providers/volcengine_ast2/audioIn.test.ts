import { describe, it, expect } from 'vitest';
import { IDLE_MS, InputPacer, KEEPALIVE_MS, PACKET_SAMPLES, Resampler, TAIL_MS } from './audioIn';

const ramp = (n: number, from = 0) => Int16Array.from({ length: n }, (_, i) => from + i);
const concat = (parts: readonly Int16Array[]) => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

describe('the resampler (ruling 12)', () => {
  it('takes three 24 kHz samples to two 16 kHz ones: the first as it is, the mean of the next two', () => {
    expect(Array.from(new Resampler().push(Int16Array.from([10, 20, 31, 40, 50, 61])))).toEqual([10, 26, 40, 56]);
  });

  it('carries what does not fill a group into the next chunk: the output is the same however the input is cut', () => {
    const whole = new Resampler().push(ramp(6_144));
    for (const cut of [[2_048, 2_048, 2_048], [1, 5, 6_138], [1_000, 1, 1, 5_142], [3, 3, 6_138]]) {
      const r = new Resampler();
      let from = 0;
      const parts = cut.map((n) => { const part = r.push(ramp(n, from)); from += n; return part; });
      expect(concat(parts)).toEqual(whole);
    }
    // Exactly two thirds: nothing lost at the chunk edges (survey §1.18.10).
    expect(whole.length).toBe(4_096);
  });

  it('holds back at most two samples, and a reset drops them', () => {
    const r = new Resampler();
    expect(r.push(ramp(2)).length).toBe(0);
    expect(r.push(ramp(1, 2)).length).toBe(2);
    r.push(ramp(2));
    r.reset();
    expect(Array.from(r.push(Int16Array.from([7, 8, 9])))).toEqual([7, 9]);
  });
});

describe('the input pacer', () => {
  it('cuts the 16 kHz stream into 80 ms packets, the rest waiting', () => {
    const pacer = new InputPacer();
    // Three capture chunks of 2 048 samples (85.3 ms each at 24 kHz) are 4 096 at 16 kHz: three packets and 256 waiting.
    const packets = [pacer.push(ramp(2_048)), pacer.push(ramp(2_048)), pacer.push(ramp(2_048))].flat();
    expect(packets.map((p) => p.length)).toEqual([PACKET_SAMPLES, PACKET_SAMPLES, PACKET_SAMPLES]);
    expect(PACKET_SAMPLES).toBe(1_280);
  });

  it('sends the resampled stream itself, whole and in order, however the capture is cut', () => {
    // 4 000 samples at 24 kHz are 2 666 at 16 kHz: one push completes two packets.
    for (const cut of [[2_048, 2_048, 2_048], [4_000, 7, 2_137], [1, 1, 1, 3_838, 2_303]]) {
      const pacer = new InputPacer();
      let from = 0;
      const packets = cut.flatMap((n) => { const p = pacer.push(ramp(n, from)); from += n; return p; });
      expect(packets.every((p) => p.length === PACKET_SAMPLES)).toBe(true);
      expect(concat([...packets, ...pacer.drain()])).toEqual(new Resampler().push(ramp(from)));
    }
  });

  it("a release sends what waits, then 500 ms of silence as six 80 ms packets and a 20 ms one (ruling 6)", () => {
    const pacer = new InputPacer();
    pacer.push(ramp(600));
    const tail = pacer.tail();
    expect(tail.map((p) => p.length)).toEqual([400, 1_280, 1_280, 1_280, 1_280, 1_280, 1_280, 320]);
    expect(tail.slice(1).every((p) => p.every((s) => s === 0))).toBe(true);
    expect(tail.slice(1).reduce((n, p) => n + p.length, 0) / 16).toBe(TAIL_MS);
    // Nothing waiting: the silence alone.
    expect(pacer.tail().map((p) => p.length)).toEqual([1_280, 1_280, 1_280, 1_280, 1_280, 1_280, 320]);
  });

  it('drains what waits at an idle as one short packet, with no silence and no carry, so the next packet starts clean (ruling 7)', () => {
    const pacer = new InputPacer();
    // 601 samples: 400 at 16 kHz, and one held by the resampler.
    pacer.push(new Int16Array(601).fill(500));
    expect(pacer.drain().map((p) => [p.length, p.every((s) => s === 500)])).toEqual([[400, true]]);
    expect(pacer.drain()).toEqual([]);
    expect(pacer.push(new Int16Array(1_920).fill(700)).map((p) => [p.length, p.every((s) => s === 700)])).toEqual([[1_280, true]]);
  });

  it('a release drops the carry too, so the next turn starts clean (choice 11)', () => {
    const pacer = new InputPacer();
    pacer.push(new Int16Array(601).fill(500));
    pacer.tail();
    expect(pacer.push(new Int16Array(1_920).fill(700)).map((p) => [p.length, p.every((s) => s === 700)])).toEqual([[1_280, true]]);
  });

  it('keeps the keepalive off the capture: its idle threshold is well past a chunk period (ruling 7)', () => {
    const chunkPeriodMs = (2_048 / 24_000) * 1000;
    expect(KEEPALIVE_MS).toBe(80);
    expect(IDLE_MS).toBeGreaterThan(2 * chunkPeriodMs);
  });
});
