import { describe, it, expect } from 'vitest';
import { getHighlightedChars } from './highlight';

describe('getHighlightedChars', () => {
  describe('segment-based', () => {
    const segments = [
      { textEnd: 5, audioEnd: 1.0 },   // "Hello"
      { textEnd: 11, audioEnd: 2.0 },  // "Hello world"
      { textEnd: 14, audioEnd: 3.0 },  // "Hello world!!!"
    ];

    it('inside the first segment scales by segment progress', () => {
      // half-way through segment 1: 0.5s of [0, 1.0s] → 50% of "Hello" (5 chars).
      // Math.round(2.5) = 3 (round-half-up).
      expect(getHighlightedChars(0.5, segments, 14, 0)).toBe(3);
    });

    it('inside a later segment uses prevTextEnd + intra-segment progress', () => {
      // 1.5s in: 0.5/1.0 through seg 2 (textEnd 11, prev 5, width 6) → 5 + 3 = 8
      expect(getHighlightedChars(1.5, segments, 14, 0)).toBe(8);
    });

    it('past the final segment returns the last textEnd', () => {
      expect(getHighlightedChars(99, segments, 14, 0)).toBe(14);
    });

    it('zero-duration segment returns its full textEnd immediately', () => {
      const zeroDur = [
        { textEnd: 3, audioEnd: 1.0 },
        { textEnd: 7, audioEnd: 1.0 }, // same audioEnd → segDuration === 0
      ];
      // currentTime exactly at the boundary chooses seg 2 (currentTime < audioEnd false for seg 1)
      expect(getHighlightedChars(1.0, zeroDur, 7, 0)).toBe(7);
    });

    it('near end of final segment highlights the last character', () => {
      // The end-of-playback case from the bug: currentTime hovers just under
      // audioEnd because the player polls at 10Hz and stops before reaching
      // the segment boundary exactly. Math.round bridges the gap; floor would
      // leave the last char permanently uncolored.
      // 2.95s into seg 3 (range [2.0, 3.0], width 3): segProgress 0.95.
      // Math.round(3 * 0.95) = 3. prevTextEnd 11 + 3 = 14 = textLength.
      expect(getHighlightedChars(2.95, segments, 14, 0)).toBe(14);
    });
  });

  describe('linear fallback', () => {
    it('rounds textLength * progressRatio when segments is undefined', () => {
      expect(getHighlightedChars(0, undefined, 10, 0.5)).toBe(5);
    });

    it('rounds textLength * progressRatio when segments is empty', () => {
      expect(getHighlightedChars(0, [], 10, 0.3)).toBe(3);
    });

    it('progressRatio 0 returns 0', () => {
      expect(getHighlightedChars(0, undefined, 10, 0)).toBe(0);
    });

    it('progressRatio 1 returns textLength', () => {
      expect(getHighlightedChars(0, undefined, 10, 1)).toBe(10);
    });

    it('near-complete progressRatio still highlights the final character', () => {
      // Math.floor(11 * 0.95) = 10 (last char missed).
      // Math.round(11 * 0.95) = 10. But Math.round(11 * 0.96) = 11.
      // The key end-of-playback case: even slightly under 1.0 reaches textLength.
      expect(getHighlightedChars(0, undefined, 11, 0.96)).toBe(11);
    });
  });

  describe('boundaries', () => {
    it('textLength 0 returns 0', () => {
      expect(getHighlightedChars(0, undefined, 0, 0.5)).toBe(0);
    });
  });
});
