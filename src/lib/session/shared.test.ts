import { describe, it, expect } from 'vitest';
import { buildSharedSettings } from './shared';

const pair = { source: 'en', target: 'ja' };
const pauses = { sourceSeconds: 1.2, translationSeconds: 0.8 };
const segmentation = { mode: 'off' as const, sentencesPerRow: 0 };

describe('buildSharedSettings', () => {
  it('passes the pauses through', () => {
    expect(buildSharedSettings(pair, pauses, segmentation).pauses).toEqual(pauses);
  });

  it("says which direction is the participant's, and carries the display segmentation", () => {
    const shared = buildSharedSettings(pair, pauses, { mode: 'sentences', sentencesPerRow: 0 });
    expect(shared.reversed({ source: 'en', target: 'ja' })).toBe(false);
    expect(shared.reversed({ source: 'ja', target: 'en' })).toBe(true);
    expect(shared.segmentation).toEqual({ mode: 'sentences', sentencesPerRow: 0 });
  });

  it("carries no instructions: they are each provider's own setting (Stage 2 Gemini, ruling 4)", () => {
    expect(buildSharedSettings(pair, pauses, segmentation)).not.toHaveProperty('instructions');
  });
});
