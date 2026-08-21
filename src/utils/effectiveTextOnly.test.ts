import { describe, it, expect } from 'vitest';
import { effectiveTextOnly } from './effectiveTextOnly';

describe('effectiveTextOnly', () => {
  it('honours the user toggle when the speaker leg runs', () => {
    expect(effectiveTextOnly({ speakerLegRuns: true, textOnly: false })).toBe(false);
    expect(effectiveTextOnly({ speakerLegRuns: true, textOnly: true })).toBe(true);
  });

  it('forces text-only when no speaker leg runs, whatever the toggle says', () => {
    expect(effectiveTextOnly({ speakerLegRuns: false, textOnly: false })).toBe(true);
    expect(effectiveTextOnly({ speakerLegRuns: false, textOnly: true })).toBe(true);
  });
});
