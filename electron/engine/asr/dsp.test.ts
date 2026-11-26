// @vitest-environment node
/** The ASR input downsample against the Python engine's own output (test/golden/dsp_asr.json), float32 for float32. */
import '../test/env';
import { describe, expect, it } from 'vitest';
import golden from '../test/golden/dsp_asr.json';
import { downsampleInt16ToF32_16k } from './dsp';

const bytesOf = (values: readonly number[]) => new Uint8Array(Int16Array.from(values).buffer);

describe('downsampleInt16ToF32_16k', () => {
  it('matches dsp_asr.json', () => {
    const cases = golden.cases as Array<{ input: number[]; output: number[]; src_rate: number }>;
    expect(cases.map((c) => c.src_rate)).toEqual([16000, 22050, 24000, 44100, 48000, 24000]);
    for (const c of cases) expect([c.src_rate, Array.from(downsampleInt16ToF32_16k(bytesOf(c.input), c.src_rate))]).toEqual([c.src_rate, c.output]);
  });

  it('empty bytes give an empty Float32Array, at any rate', () => {
    for (const rate of [24000, 48000]) {
      const out = downsampleInt16ToF32_16k(new Uint8Array(0), rate);
      expect(out).toBeInstanceOf(Float32Array);
      expect(out.length).toBe(0);
    }
  });

  it('reads a frame that does not start on an even byte offset', () => {
    const backing = new Uint8Array(7);
    backing.set(bytesOf([1000, -1000, 32767]), 1);
    expect(Array.from(downsampleInt16ToF32_16k(backing.subarray(1), 16000))).toEqual([1000 / 32768, -1000 / 32768, Math.fround(32767 / 32768)]);
  });

  it("rounds the output length half to even, as Python's round does", () => {
    // 5 samples at 32 kHz → 2.5 samples at 16 kHz: Python rounds to 2 (JavaScript's Math.round would say 3).
    expect(Array.from(downsampleInt16ToF32_16k(bytesOf([0, 100, 200, 300, 400]), 32000))).toEqual([0, 200 / 32768]);
    expect(downsampleInt16ToF32_16k(bytesOf([0, 100, 200, 300, 400, 500, 600]), 32000).length).toBe(4);   // 3.5 → 4
  });

  it('an odd byte count is an error, as numpy raises', () => {
    expect(() => downsampleInt16ToF32_16k(new Uint8Array(3))).toThrow(/multiple of element size/);
  });
});
