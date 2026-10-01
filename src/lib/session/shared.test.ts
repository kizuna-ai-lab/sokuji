import { describe, it, expect } from 'vitest';
import { buildSharedSettings } from './shared';

/** The participant's direction for the pair en → ja, as `reversedPair` gives it by the plain swap. */
const participant = { source: 'ja', target: 'en' };
const pauses = { sourceSeconds: 1.2, translationSeconds: 0.8 };
const segmentation = { mode: 'off' as const, sentencesPerRow: 0 };

describe('buildSharedSettings', () => {
  it('passes the pauses through', () => {
    expect(buildSharedSettings(participant, pauses, segmentation).pauses).toEqual(pauses);
  });

  it("says which direction is the participant's, and carries the display segmentation", () => {
    const shared = buildSharedSettings(participant, pauses, { mode: 'sentences', sentencesPerRow: 0 });
    expect(shared.reversed({ source: 'en', target: 'ja' })).toBe(false);
    expect(shared.reversed({ source: 'ja', target: 'en' })).toBe(true);
    expect(shared.segmentation).toEqual({ mode: 'sentences', sentencesPerRow: 0 });
  });

  it("names the provider's own reverse, and none when the pair has none (Stage 2 Palabra, ruling 9)", () => {
    // Palabra's `ja → en-us` runs its participant `en → ja`: the target's source code, not a plain swap.
    const palabra = buildSharedSettings({ source: 'en', target: 'ja' }, pauses, segmentation);
    expect(palabra.reversed({ source: 'en', target: 'ja' })).toBe(true);
    expect(palabra.reversed({ source: 'en-us', target: 'ja' })).toBe(false);
    const none = buildSharedSettings(null, pauses, segmentation);
    expect(none.reversed({ source: 'en', target: 'ja' })).toBe(false);
  });

  it("carries no instructions: they are each provider's own setting (Stage 2 Gemini, ruling 4)", () => {
    expect(buildSharedSettings(participant, pauses, segmentation)).not.toHaveProperty('instructions');
  });
});
