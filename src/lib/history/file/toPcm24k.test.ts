// Decoded blocks of an imported file made into the record's samples: placed by their timestamps, mixed, at 24 kHz.
import { describe, it, expect } from 'vitest';
import { toPcm24k, type DecodedPiece } from './toPcm24k';

const piece = (timestampS: number, seconds: number, sampleRate: number, values: number[]): DecodedPiece => ({
  timestampS, sampleRate, planes: values.map((v) => new Float32Array(Math.round(seconds * sampleRate)).fill(v)),
});
async function* from(pieces: DecodedPiece[], onRead?: (i: number) => void) {
  for (let i = 0; i < pieces.length; i++) { onRead?.(i); yield pieces[i]; }
}
async function collect(it: AsyncIterable<Int16Array>): Promise<Int16Array> {
  const parts: Int16Array[] = [];
  for await (const p of it) parts.push(p);
  const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}
const level = (x: Int16Array, from: number, to: number) => x.slice(from, to).reduce((n, v) => n + v, 0) / (to - from);

describe('decoded blocks to the record samples', () => {
  it('mixes the channels to one and keeps the level', async () => {
    const two = await collect(toPcm24k(from([piece(0, 1, 24000, [0.5, 0.5])])));
    expect(Math.abs(level(two, 1000, 20000) / 32767 - 0.5)).toBeLessThan(0.01);
    const six = await collect(toPcm24k(from([piece(0, 1, 24000, [0.3, 0.3, 0.3, 0.3, 0.3, 0.3])])));
    expect(Math.abs(level(six, 1000, 20000) / 32767 - 0.3)).toBeLessThan(0.01);
  });

  it("starts at the first piece's time", async () => {
    const out = await collect(toPcm24k(from([piece(1.5, 1, 24000, [0.5])])));
    expect(out.length).toBe(60000);
    expect(out.slice(0, 36000).every((v) => v === 0)).toBe(true);
    expect(out[36000 + 100]).toBeGreaterThan(16000);
  });

  it('fills a gap with silence and cuts an overlap', async () => {
    const out = await collect(toPcm24k(from([piece(0, 1, 24000, [0.25]), piece(1.25, 1, 24000, [0.5]), piece(2.1, 1, 24000, [0.75])])));
    expect(out.length).toBe(Math.round(3.1 * 24000));
    expect(out.slice(24000, 30000).every((v) => v === 0)).toBe(true);
    expect(out[30000 + 100]).toBe(Math.round(0.5 * 32767.5 - 0.25));
    // The third block began 0.15 s before the second ended: from 2.25 s on it is the third's.
    expect(out[Math.round(2.25 * 24000) + 100]).toBe(Math.round(0.75 * 32767.5 - 0.25));
  });

  it('fills a long gap without holding it all at once', async () => {
    let largest = 0;
    for await (const c of toPcm24k(from([piece(0, 1, 48000, [0.5]), piece(600, 1, 48000, [0.5])]))) largest = Math.max(largest, c.length);
    expect(largest).toBeLessThanOrEqual(240000);
  });

  it('follows a change of sample rate between pieces', async () => {
    const out = await collect(toPcm24k(from([piece(0, 2, 48000, [0.5]), piece(2, 2, 44100, [0.5])])));
    expect(Math.abs(out.length - 4 * 24000)).toBeLessThanOrEqual(2);
  });

  // Review: a container may state its rate as a fraction (Matroska floats, MOV fixed point).
  it('takes a sample rate that is not a whole number as the nearest whole one', async () => {
    const out = await collect(toPcm24k(from([piece(0, 1, 47999.9, [0.5])])));
    expect(Math.abs(out.length - 24000)).toBeLessThanOrEqual(1);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const read: number[] = [];
    const pieces = Array.from({ length: 5 }, (_, i) => piece(i * 10, 10, 24000, [0.5]));
    const got: Int16Array[] = [];
    for await (const chunk of toPcm24k(from(pieces, (i) => read.push(i)), { chunkSamples: 240000, signal: controller.signal })) {
      got.push(chunk);
      controller.abort();
    }
    expect(got.length).toBe(1);
    expect(read.length).toBeLessThanOrEqual(2);
  });
});
