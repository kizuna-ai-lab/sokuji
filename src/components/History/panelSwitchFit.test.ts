import { describe, it, expect } from 'vitest';
import { labelsFit, HEADING_MIN_PX } from './panelSwitchFit';

describe("whether the record page's panel switches keep their words", () => {
  it('keep them while the heading keeps its room beside the actions with words', () => {
    // 16px padding each side, a 12px gap, the heading's 240px, actions 420px wide with their words.
    expect(HEADING_MIN_PX).toBe(240);
    expect(labelsFit({ head: 720, padding: 32, gaps: 12, others: 0, actions: 420 })).toBe(true);
    expect(labelsFit({ head: 704, padding: 32, gaps: 12, others: 0, actions: 420 })).toBe(true);
    expect(labelsFit({ head: 703, padding: 32, gaps: 12, others: 0, actions: 420 })).toBe(false);
  });

  it('count what else stands in the head, such as the way back to the list', () => {
    // The back button (86px) and a second gap: 560 − 32 − 86 − 24 − 212 = 206, under the heading's 240.
    expect(labelsFit({ head: 560, padding: 32, gaps: 24, others: 86, actions: 212 })).toBe(false);
    expect(labelsFit({ head: 594, padding: 32, gaps: 24, others: 86, actions: 212 })).toBe(true);
  });

  it('say nothing before the page is laid out', () => {
    expect(labelsFit({ head: 0, padding: 0, gaps: 0, others: 0, actions: 0 })).toBe(true);
  });
});
