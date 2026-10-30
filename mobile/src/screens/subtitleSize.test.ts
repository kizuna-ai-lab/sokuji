import { describe, expect, it } from 'vitest';
import { scaledLine } from './subtitleSize';

describe('a subtitle line at the system text size', () => {
  it('follows the system size below its cap, the line height with it', () => {
    expect(scaledLine(22, 30, 1.2, 2.5)).toEqual({ fontSize: 26.4, lineHeight: 36 });
  });

  it('stops at its cap, the line height too (Android scales a set line height past maxFontSizeMultiplier)', () => {
    expect(scaledLine(17, 23, 2, 1.5)).toEqual({ fontSize: 25.5, lineHeight: 35 });
  });

  it('follows a system size below 1 as well', () => {
    expect(scaledLine(20, 27, 0.85, 1.5)).toEqual({ fontSize: 17, lineHeight: 23 });
  });
});
