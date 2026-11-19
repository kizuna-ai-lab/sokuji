import { describe, expect, it } from 'vitest';
import { segmentStartSample } from './segmentStart';

describe('segmentStartSample', () => {
  it('runs back from the samples fed over the segment’s own length, its pad included', () => {
    expect(segmentStartSample(48_000, new Float32Array(16_000))).toBe(32_000);
  });

  it('never before the first sample', () => {
    expect(segmentStartSample(8_000, new Float32Array(16_000))).toBe(0);
  });
});
