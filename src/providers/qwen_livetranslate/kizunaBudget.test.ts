import { describe, it, expect } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import { kizunaQwenMinimumBalance } from './kizunaBudget';

/**
 * The backend refuses a session token below its shortest session's price at
 * the leg set's rate (`floorMicroUsd`): 3.654 USD/h per speaking leg, 0.954
 * per text-only leg, 60 s. These literals restate that arithmetic, so a
 * change on either side fails here rather than as a Start button that lies.
 */
describe('Kizuna Qwen start floor mirrors the backend', () => {
  const at = (legs: LegName[], textOnly: boolean, participantSpeech: boolean) => kizunaQwenMinimumBalance({ legs, textOnly, participantSpeech });
  // Integer µUSD per hour, so the ceil is exact.
  const floor = (speaking: number, text: number) => Math.ceil(((speaking * 3_654_000 + text * 954_000) * 60) / 3600);

  it('prices a leg that speaks at 3.654 USD/h and one that does not at 0.954', () => {
    expect(floor(1, 0)).toBe(60_900);
    expect(floor(0, 1)).toBe(15_900);
    expect(floor(1, 1)).toBe(76_800);
    expect(floor(2, 0)).toBe(121_800);
  });

  it('names the floor for each shape', () => {
    expect(at(['speaker'], false, false)).toBe(60_900);
    expect(at(['speaker'], true, false)).toBe(15_900);
    expect(at(['speaker', 'participant'], false, false)).toBe(76_800);
    expect(at(['speaker', 'participant'], false, true)).toBe(121_800);
    expect(at(['participant'], false, false)).toBe(15_900);
    expect(at(['participant'], false, true)).toBe(60_900);
    // The speaker's text-only switch silences the speaker leg, never the participant's voice.
    expect(at(['speaker', 'participant'], true, true)).toBe(76_800);
  });
});
