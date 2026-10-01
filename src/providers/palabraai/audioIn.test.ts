import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { CHUNK_MS, CHUNK_SAMPLES, IDLE_MS, Rechunker, SILENCE } from './audioIn';

/** 24 kHz pcm whose samples count up from `from`, so order and loss show. */
const ramp = (length: number, from: number) => new Int16Array(length).map((_, i) => (from + i) % 30_000);

describe("What Palabra hears (rulings 3, 5)", () => {
  it('cuts 320 ms chunks, and waits past the capture\'s slowest chunk before it calls a gap an idle', () => {
    expect(CHUNK_MS).toBe(320);
    expect(CHUNK_SAMPLES).toBe(7_680);
    expect(SILENCE).toHaveLength(CHUNK_SAMPLES);
    expect(SILENCE.every((s) => s === 0)).toBe(true);
    // The participant's ScriptProcessor fallback is the slowest of the four
    // capture cadences: 16 384 samples at 24 kHz, 682.7 ms (fix round 1, I1).
    expect(IDLE_MS).toBeGreaterThan((16_384 / SAMPLE_RATE) * 1000);
    expect(IDLE_MS).toBe(800);
  });

  it("re-chunks the worklet's 2 048-sample chunks into whole 320 ms ones, every sample in order", () => {
    const r = new Rechunker();
    const out: Int16Array[] = [];
    for (let k = 0; k < 15; k++) out.push(...r.push(ramp(2_048, k * 2_048)));
    // 15 × 2 048 = 30 720 = 4 × 7 680: four chunks, nothing left.
    expect(out.map((c) => c.length)).toEqual([7_680, 7_680, 7_680, 7_680]);
    const joined = new Int16Array(30_720);
    out.forEach((c, i) => joined.set(c, i * 7_680));
    expect(Array.from(joined)).toEqual(Array.from(ramp(30_720, 0)));
    expect(r.flush()).toBeNull();
  });

  it('cuts a chunk larger than one, and keeps each chunk it hands out its own', () => {
    const r = new Rechunker();
    const out = r.push(ramp(8_192 * 2, 0));
    expect(out.map((c) => c.length)).toEqual([7_680, 7_680]);
    out[0][0] = -1;
    const next = r.push(ramp(7_680, 0));
    expect(next[0][0]).not.toBe(-1);
  });

  it('flushes what waits padded with silence to a whole chunk, saying how much of it was audio; nothing, when nothing waits', () => {
    const r = new Rechunker();
    expect(r.flush()).toBeNull();
    r.push(ramp(1_000, 5));
    const flushed = r.flush()!;
    expect(flushed.samples).toBe(1_000);
    expect(flushed.chunk).toHaveLength(CHUNK_SAMPLES);
    expect(Array.from(flushed.chunk.subarray(0, 1_000))).toEqual(Array.from(ramp(1_000, 5)));
    expect(flushed.chunk.subarray(1_000).every((s) => s === 0)).toBe(true);
    expect(r.flush()).toBeNull();
    // What comes after a flush starts a chunk of its own.
    expect(r.push(ramp(7_680, 0))[0][0]).toBe(0);
  });
});
