import { describe, it, expect } from 'vitest';
import { relativeLuminance, toneOf } from './tone';

describe('toneOf', () => {
  // Dark when white contrasts better with the colour than black does: WCAG
  // relative luminance under 0.179. #757575 sits just under, #777777 just over.
  it.each([
    ['#1f1f1f', 'dark'],
    ['#000000', 'dark'],
    ['#ffffff', 'light'],
    ['#f7f7f8', 'light'],
    ['#ff0000', 'light'],
    ['#003b6f', 'dark'],
    ['#757575', 'dark'],
    ['#777777', 'light'],
    ['FFFFFF', 'light'],
    ['not-a-colour', 'dark'],
    ['#fff', 'dark'],
  ] as const)('toneOf(%s) is %s', (hex, tone) => {
    expect(toneOf(hex)).toBe(tone);
  });

  it('relative luminance follows WCAG 2.x', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2158, 3);
  });
});
