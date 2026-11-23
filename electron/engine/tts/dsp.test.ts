// @vitest-environment node
/**
 * The TTS output conversion (ported from sidecar/tests/test_tts_engine.py) and the Python engine's own output
 * (test/golden/dsp_tts.json): the 24 kHz cases bit for bit; the resampled ones against soxr within 60 dB SNR, which
 * needs the addon's speexdsp resampler (SOKUJI_NATIVE_DIR).
 */
import '../test/env';
import { afterEach, describe, expect, it } from 'vitest';
import golden from '../test/golden/dsp_tts.json';
import { loadNative, setNativeForTests, useNative } from '../native';
import { downmix, dspSeams, restoreDspSeams, toInt16_24kMono } from './dsp';

const int16 = (bytes: Uint8Array) => Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));
/** A stand-in resampler: linear interpolation to the right length (enough for lengths and plumbing). */
const linear = (pcm: Float32Array, _ch: number, from: number, to: number) => {
  const n = Math.round(pcm.length * to / from);
  return Float32Array.from({ length: n }, (_, i) => pcm[Math.min(pcm.length - 1, Math.floor(i * from / to))]);
};
const cases = golden.cases as Array<{ src_rate: number; channels: number; input: number[]; output: number[] }>;

afterEach(() => {
  restoreDspSeams();
  setNativeForTests(null);
});

describe('toInt16_24kMono', () => {
  it('24 kHz input equals the Python engine, bit for bit', () => {
    dspSeams.resample = () => { throw new Error('24 kHz needs no resampling'); };
    const at24k = cases.filter((c) => c.src_rate === 24000);
    expect(at24k.map((c) => c.channels)).toEqual([1, 2]);
    for (const c of at24k) expect(int16(toInt16_24kMono(Float32Array.from(c.input), c.channels, 24000))).toEqual(c.output);
  });

  it('48 kHz stereo → 24 kHz mono', () => {
    dspSeams.resample = linear;
    const out = int16(toInt16_24kMono(new Float32Array(96000).fill(1), 2, 48000));
    expect(Math.abs(out.length - 24000)).toBeLessThanOrEqual(2);
    expect(Math.max(...out)).toBeGreaterThan(30000);
  });

  it('16 kHz and 44.1 kHz mono → 24 000 samples a second', () => {
    dspSeams.resample = linear;
    expect(Math.abs(toInt16_24kMono(new Float32Array(16000), 1, 16000).length / 2 - 24000)).toBeLessThanOrEqual(2);
    expect(Math.abs(toInt16_24kMono(new Float32Array(44100), 1, 44100).length / 2 - 24000)).toBeLessThanOrEqual(2);
  });

  it('resamples through the resampler, once, mono, to 24 kHz', () => {
    const calls: unknown[] = [];
    dspSeams.resample = (pcm, ch, from, to) => { calls.push([pcm.length, ch, from, to]); return new Float32Array(to); };
    toInt16_24kMono(new Float32Array(88200), 2, 44100);
    expect(calls).toEqual([[44100, 1, 44100, 24000]]);
  });

  it('clips to ±1 and truncates toward zero, as astype(int16) does', () => {
    expect(int16(toInt16_24kMono(Float32Array.from([2, -2, 0.5, -0.5, 1e-5]), 1, 24000))).toEqual([32767, -32767, 16383, -16383, 0]);
  });

  it('a stereo clip of +1 and -1 downmixes to silence', () => {
    const lr = new Float32Array(48000);
    for (let i = 0; i < 24000; i++) { lr[2 * i] = 1; lr[2 * i + 1] = -1; }
    expect(new Set(int16(toInt16_24kMono(lr, 2, 24000)))).toEqual(new Set([0]));
    expect(downmix(Float32Array.from([1, 2, 3, 4, 5, 6]), 3)).toEqual(Float32Array.from([2, 5]));
  });

  it('empty audio stays empty without resampling', () => {
    dspSeams.resample = () => { throw new Error('nothing to resample'); };
    expect(toInt16_24kMono(new Float32Array(0), 1, 16000).length).toBe(0);
  });
});

/** SNR in dB of `got` against `want` over their common length. */
function snrDb(got: number[], want: number[]): number {
  const n = Math.min(got.length, want.length);
  let sig = 0;
  let err = 0;
  for (let i = 0; i < n; i++) {
    sig += want[i] * want[i];
    err += (got[i] - want[i]) ** 2;
  }
  return 10 * Math.log10(sig / Math.max(err, 1e-12));
}

describe.skipIf(!process.env.SOKUJI_NATIVE_DIR)('the addon resampler', () => {
  it('resamples like soxr within 60 dB SNR', () => {
    useNative(loadNative(process.env.SOKUJI_NATIVE_DIR!), process.env.SOKUJI_NATIVE_DIR!);
    for (const c of cases.filter((x) => x.src_rate !== 24000)) {
      const got = int16(toInt16_24kMono(Float32Array.from(c.input), c.channels, c.src_rate));
      expect([c.src_rate, c.channels, Math.abs(got.length - c.output.length) <= 1]).toEqual([c.src_rate, c.channels, true]);
      // The edges carry each resampler's own filter ramp; compare the steady middle.
      const edge = 24;
      expect(snrDb(got.slice(edge, -edge), c.output.slice(edge, -edge))).toBeGreaterThan(60);
    }
  });
});
