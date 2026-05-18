import { describe, it, expect } from 'vitest';
import { getHighlightOverlayForBg } from './SubtitleApp';

describe('getHighlightOverlayForBg', () => {
  it('returns a translucent white overlay for the default black background', () => {
    expect(getHighlightOverlayForBg('#000000')).toBe('rgba(255, 255, 255, 0.3)');
  });

  it('returns a translucent black overlay for a white background', () => {
    expect(getHighlightOverlayForBg('#ffffff')).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('flips at the YIQ midpoint (≈ 128)', () => {
    // YIQ for #555555 = 0.299*85 + 0.587*85 + 0.114*85 = 85 < 128 → dark → white overlay
    expect(getHighlightOverlayForBg('#555555')).toBe('rgba(255, 255, 255, 0.3)');
    // YIQ for #aaaaaa = 170 > 128 → light → black overlay
    expect(getHighlightOverlayForBg('#aaaaaa')).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('weights green most heavily (YIQ luminance)', () => {
    // Pure red (#ff0000): YIQ = 0.299*255 ≈ 76 → dark → white
    expect(getHighlightOverlayForBg('#ff0000')).toBe('rgba(255, 255, 255, 0.3)');
    // Pure green (#00ff00): YIQ = 0.587*255 ≈ 150 → light → black
    expect(getHighlightOverlayForBg('#00ff00')).toBe('rgba(0, 0, 0, 0.3)');
    // Pure blue (#0000ff): YIQ = 0.114*255 ≈ 29 → dark → white
    expect(getHighlightOverlayForBg('#0000ff')).toBe('rgba(255, 255, 255, 0.3)');
  });

  it('returns the dark-bg default when the input is malformed', () => {
    expect(getHighlightOverlayForBg('#fff')).toBe('rgba(255, 255, 255, 0.3)');
    expect(getHighlightOverlayForBg('not-a-hex')).toBe('rgba(255, 255, 255, 0.3)');
    expect(getHighlightOverlayForBg('')).toBe('rgba(255, 255, 255, 0.3)');
  });
});
