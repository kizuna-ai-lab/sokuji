import { describe, it, expect } from 'vitest';
import { TimelineResampler } from './timeline-resampler';

// Copy of resampleInt16ToFloat32_16k from whisper-webgpu.worker.ts.
function workerResample(samples: Int16Array, inputRate: number): Float32Array {
  const ratio = inputRate / 16000;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    const vLo = samples[lo] / 32768;
    const vHi = samples[hi] / 32768;
    out[i] = vLo + (vHi - vLo) * frac;
  }
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPcm(n: number, r: () => number): Int16Array {
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.floor(r() * 65536) - 32768;
  return a;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('TimelineResampler', () => {
  it("matches the workers' per-chunk resampling bit for bit on the runner's 2400-sample chunks", () => {
    const r = rng(1);
    const rs = new TimelineResampler();
    for (let c = 0; c < 20; c++) {
      const chunk = randomPcm(2400, r);
      const got = rs.push(chunk);
      const want = workerResample(chunk, 24000);
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) expect(got[i]).toBe(want[i]);
    }
    expect(rs.position).toBe(20 * 1600);
  });

  it('any chunking gives the samples of one chunk, and positions never drift', () => {
    const r = rng(7);
    for (let trial = 0; trial < 200; trial++) {
      const all = randomPcm(1 + Math.floor(r() * 20000), r);
      const one = new TimelineResampler();
      const whole = concat([one.push(all), one.flush()]);

      const rs = new TimelineResampler();
      const parts: Float32Array[] = [];
      for (let o = 0; o < all.length;) {
        const n = Math.min(all.length - o, 1 + Math.floor(r() * 5000));
        parts.push(rs.push(all.subarray(o, o + n)));
        o += n;
      }
      parts.push(rs.flush());
      const got = concat(parts);
      expect(got.length).toBe(whole.length);
      expect(got).toEqual(whole);
      expect(rs.position).toBe(one.position);
      expect(rs.position).toBe(got.length);
    }
  }, 60_000);

  it('after N input samples and a flush, the position is floor(2(N-1)/3) + 1', () => {
    for (const n of [1, 2, 3, 2401, 1_000_000]) {
      const rs = new TimelineResampler();
      rs.push(new Int16Array(n));
      rs.flush();
      expect(rs.position).toBe(Math.floor((2 * (n - 1)) / 3) + 1);
    }
  });

  it('a sample past the last input is never invented: [0, 16384] yields 1 sample, flush adds none', () => {
    const rs = new TimelineResampler();
    expect(Array.from(rs.push(Int16Array.from([0, 16384])))).toEqual([0]);
    expect(rs.flush().length).toBe(0);
    expect(rs.position).toBe(1);
  });

  it('16 kHz input passes through', () => {
    const r = rng(3);
    const pcm = randomPcm(1000, r);
    const rs = new TimelineResampler(16000);
    const out = concat([rs.push(pcm.subarray(0, 333)), rs.push(pcm.subarray(333)), rs.flush()]);
    expect(out.length).toBe(1000);
    for (let i = 0; i < 1000; i++) expect(out[i]).toBe(pcm[i] / 32768);
    expect(rs.position).toBe(1000);
  });
});
