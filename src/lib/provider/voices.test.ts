import { describe, it, expect } from 'vitest';
import { distinctVoice } from './voices';

const DEFAULTS = { participant: 'Grace', speaker: 'Adrian' };

describe('distinctVoice', () => {
  it("keeps the other party's choice while it is not the speaker's voice", () => {
    expect(distinctVoice('Kenji', 'Adrian', DEFAULTS)).toBe('Kenji');
  });

  it("swaps a choice that is the speaker's own for a default the speaker is not using", () => {
    expect(distinctVoice('Nina', 'Nina', DEFAULTS)).toBe('Grace');
    expect(distinctVoice('Grace', 'Grace', DEFAULTS)).toBe('Adrian');
    expect(distinctVoice('Adrian', 'Adrian', DEFAULTS)).toBe('Grace');
  });
});
