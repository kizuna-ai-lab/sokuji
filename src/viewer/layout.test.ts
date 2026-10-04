// src/viewer/layout.test.ts
import { describe, it, expect } from 'vitest';
import { atLiveEdge, defaultSize, layoutFor, stepSize } from './layout';

describe('layout', () => {
  it('picks the layout by width', () => {
    expect(layoutFor(390)).toBe('phone');
    expect(layoutFor(599)).toBe('phone');
    expect(layoutFor(600)).toBe('tablet');
    expect(layoutFor(999)).toBe('tablet');
    expect(layoutFor(1000)).toBe('desktop');
  });

  it('defaults to large text on phones and medium elsewhere, and steps within range', () => {
    expect(defaultSize('phone')).toBe('large');
    expect(defaultSize('desktop')).toBe('medium');
    expect(stepSize('large', 1)).toBe('xlarge');
    expect(stepSize('xlarge', 1)).toBe('xlarge');
    expect(stepSize('small', -1)).toBe('small');
  });

  it('counts within 48px of the bottom as the live edge', () => {
    expect(atLiveEdge(950, 500, 1490)).toBe(true);
    expect(atLiveEdge(900, 500, 1490)).toBe(false);
  });
});
