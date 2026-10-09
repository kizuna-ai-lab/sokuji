import { describe, it, expect } from 'vitest';
import fixture from './mel-filters.fixture.json';
import { slaneyMelFilterbank } from './mel-filters';

const filters = slaneyMelFilterbank({ nMels: 80, nFft: 400, sampleRate: 16000, fMin: 0, fMax: 8000 });

describe('slaneyMelFilterbank', () => {
  it('has the shape log-mel.ts reads', () => {
    expect(filters.n_mels).toBe(80);
    expect(filters.n_freqs).toBe(201);
    expect(filters.data).toHaveLength(80);
    for (const row of filters.data) expect(row).toHaveLength(201);
  });

  it("equals WhisperFeatureExtractor's own filters", () => {
    expect(fixture.nonzero.length).toBeGreaterThan(300);
    const expected = Array.from({ length: 80 }, () => new Array<number>(201).fill(0));
    for (const [m, k, v] of fixture.nonzero as [number, number, number][]) expected[m][k] = v;
    let worst = 0;
    for (let m = 0; m < 80; m++) {
      for (let k = 0; k < 201; k++) worst = Math.max(worst, Math.abs(filters.data[m][k] - expected[m][k]));
    }
    expect(worst).toBeLessThan(1e-12);
  });
});
