import { describe, it, expect } from 'vitest';
import { resolveVadThresholds } from './vad-thresholds';

describe('resolveVadThresholds', () => {
  it('uses the vad-web defaults when nothing is configured', () => {
    expect(resolveVadThresholds()).toEqual({ positive: 0.3, negative: 0.15 });
  });

  it('derives the negative threshold from a lowered speech threshold', () => {
    // The whole point: a user lowering `threshold` to catch quiet speech must not
    // end up with a negative threshold ABOVE it, which kills endpoint detection.
    expect(resolveVadThresholds({ threshold: 0.2 })).toEqual({ positive: 0.2, negative: 0.05 });
  });

  it('honours an explicit negative threshold below the positive one', () => {
    expect(resolveVadThresholds({ threshold: 0.5, negativeThreshold: 0.3 }))
      .toEqual({ positive: 0.5, negative: 0.3 });
  });

  it('clamps an inverted negative threshold down to the positive one', () => {
    expect(resolveVadThresholds({ threshold: 0.2, negativeThreshold: 0.25 }))
      .toEqual({ positive: 0.2, negative: 0.2 });
  });

  it('floors the derived negative threshold above zero', () => {
    expect(resolveVadThresholds({ threshold: 0.1 })).toEqual({ positive: 0.1, negative: 0.01 });
  });

  it('floors an explicit zero negative threshold', () => {
    expect(resolveVadThresholds({ threshold: 0.5, negativeThreshold: 0 }))
      .toEqual({ positive: 0.5, negative: 0.01 });
  });
});
