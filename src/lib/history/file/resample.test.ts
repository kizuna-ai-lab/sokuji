// Imported audio resampled to the record's 24 kHz, a piece at a time.
import { describe, it, expect } from 'vitest';
import { createResampler } from './resample';

const sine = (hz: number, rate: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: Float32Array, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const db = (a: number, b: number) => 20 * Math.log10(a / b);
function run(rate: number, input: Float32Array, sizes: number[]): Float32Array {
  const r = createResampler(rate, 24000);
  const out: Float32Array[] = [];
  for (let at = 0, k = 0; at < input.length; k++) {
    const n = sizes[k % sizes.length];
    out.push(r.push(input.subarray(at, at + n)));
    at += n;
  }
  out.push(r.flush());
  const all = new Float32Array(out.reduce((n, o) => n + o.length, 0));
  let p = 0;
  for (const o of out) { all.set(o, p); p += o.length; }
  return all;
}

describe('resampling to 24 kHz', () => {
  it('passes 24 kHz through unchanged', () => {
    const x = sine(440, 24000, 0.1);
    expect(Array.from(createResampler(24000, 24000).push(x))).toEqual(Array.from(x));
  });

  it('gives exactly as many samples as the ratio says, over many pieces', () => {
    for (const rate of [48000, 44100, 16000]) {
      const x = sine(300, rate, 10);
      const out = run(rate, x, [1, 7, 480, 4410]);
      expect(Math.abs(out.length - Math.round((x.length * 24000) / rate))).toBeLessThanOrEqual(1);
    }
  });

  it('keeps speech-band tones and removes what 24 kHz cannot carry', () => {
    const keep = run(48000, sine(1000, 48000, 2), [4800]);
    expect(Math.abs(db(rms(keep, 2400, keep.length - 2400), rms(sine(1000, 24000, 2))))).toBeLessThan(0.5);
    const cut = run(48000, sine(15000, 48000, 2), [4800]);
    expect(db(rms(cut, 2400, cut.length - 2400), rms(sine(15000, 48000, 2)))).toBeLessThan(-40);
  });

  it('does not click at piece boundaries', () => {
    const x = sine(523, 44100, 3);
    const whole = run(44100, x, [x.length]);
    const sizes = Array.from({ length: 100 }, (_, i) => 50 + ((i * 7919) % 2600));
    const pieces = run(44100, x, sizes);
    expect(pieces.length).toBe(whole.length);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - pieces[i]));
    expect(worst).toBeLessThanOrEqual(1e-5);
  });
});
