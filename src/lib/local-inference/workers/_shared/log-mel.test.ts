import { describe, expect, it } from 'vitest';
import fixture from './log-mel.fixture.json';
import { logMel, MIN_MEL_INPUT_SAMPLES, type MelFilterbank } from './log-mel';

// The fixture holds a 0.25 s chirp, a 4-filter toy bank and reference values computed with the
// export pipeline's torch.stft recipe (see `_generator` inside the JSON).
const audio = Float32Array.from(fixture.audio as number[]);
const filters = fixture.filters as MelFilterbank;

describe('logMel', () => {
  const out = logMel(audio, filters);

  it('produces floor(len / hop) frames because the last STFT frame is dropped', () => {
    expect(out.T).toBe(fixture.T);
    expect(out.T).toBe(Math.floor(audio.length / 160));
    expect(out.nMels).toBe(4);
    expect(out.data.length).toBe(4 * out.T);
  });

  it('matches torch.stft + power + filterbank + log10 + dynamic-range clamp + (x + 4) / 4 within 1e-4', () => {
    for (const [m, t, v] of fixture.points as [number, number, number][]) {
      expect(out.data[m * out.T + t]).toBeCloseTo(v, 4);
    }
  });

  it('keeps every value within the Whisper-style range (max is (max + 4) / 4, floor is 2 below it)', () => {
    let max = -Infinity;
    let min = Infinity;
    for (const v of out.data) {
      if (v > max) max = v;
      if (v < min) min = v;
    }
    expect(min).toBeGreaterThanOrEqual(max - 2 - 1e-6);
  });
});

describe('logMel on a very short input', () => {
  const noise = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.3));
  const hasNaN = (n: number) => logMel(noise(n), filters).data.some((v) => Number.isNaN(v));

  it('an input of MIN_MEL_INPUT_SAMPLES or fewer reads past its reflect padding and holds NaN: callers must not send it', () => {
    expect(MIN_MEL_INPUT_SAMPLES).toBe(200);
    expect(hasNaN(160)).toBe(true);
    expect(hasNaN(MIN_MEL_INPUT_SAMPLES)).toBe(true);
  });

  it('one sample more is clean', () => {
    expect(hasNaN(MIN_MEL_INPUT_SAMPLES + 1)).toBe(false);
  });
});
