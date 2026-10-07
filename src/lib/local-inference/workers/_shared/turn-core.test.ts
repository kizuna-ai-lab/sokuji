import { describe, it, expect } from 'vitest';
import fixture from './turn-core.fixture.json';
import { featurize } from './turn-core';
import { TURN_SAMPLE_RATE } from './turn-protocol';

/** The same clip benchmark/smart-turn/make_turn_features_fixture.py builds. */
function synth(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / TURN_SAMPLE_RATE;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t);
    const voiced = 0.4 * Math.sin(2 * Math.PI * (180 * t + 20 * t * t)) * env;
    const burst = t % 1 < 0.5 ? 0.2 : 0.04;
    out[i] = voiced + burst * Math.sin(2 * Math.PI * 1250 * t + 0.3) + 0.05 * Math.sin(2 * Math.PI * 3100 * t);
  }
  return out;
}

describe('featurize', () => {
  it.each(fixture.windows)('matches WhisperFeatureExtractor on a $seconds s clip within 1e-4', ({ seconds, points }) => {
    const features = featurize(synth(seconds * TURN_SAMPLE_RATE));
    expect(features).toHaveLength(80 * 800);
    for (const [m, t, v] of points as [number, number, number][]) {
      expect(Math.abs(features[m * 800 + t] - v)).toBeLessThan(1e-4);
    }
  });

  it('reads only the last 8 s', () => {
    const clip = synth(12 * TURN_SAMPLE_RATE);
    expect(featurize(clip)).toEqual(featurize(clip.slice(4 * TURN_SAMPLE_RATE)));
  });

  it('leaves its input as it was', () => {
    const clip = synth(2 * TURN_SAMPLE_RATE);
    const copy = clip.slice();
    featurize(clip);
    expect(clip).toEqual(copy);
  });
});
