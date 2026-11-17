// How much the title bar spells out (owner, 2026-11-17): everything while it fits; then who pays as an icon; then
// icons alone. Each step is taken when the bar overflows, and undone when the window is as wide as the step before needs.
import { describe, it, expect } from 'vitest';
import { nextFit, LAST_FIT } from './titleBarFit';

describe('the title bar\'s steps', () => {
  it('stays as it is while nothing overflows', () => {
    expect(nextFit({ level: 0, needed: [] }, 0, 800)).toEqual({ level: 0, needed: [] });
  });

  it('takes the next step once the bar overflows, remembering how wide the window must be for the step before', () => {
    expect(nextFit({ level: 0, needed: [] }, 30, 700)).toEqual({ level: 1, needed: [730] });
    expect(nextFit({ level: 1, needed: [730] }, 12, 650)).toEqual({ level: 2, needed: [730, 662] });
  });

  it('goes back a step only once the window is as wide as that step needs', () => {
    expect(nextFit({ level: 2, needed: [730, 662] }, 0, 661)).toEqual({ level: 2, needed: [730, 662] });
    expect(nextFit({ level: 2, needed: [730, 662] }, 0, 662)).toEqual({ level: 1, needed: [730, 662] });
    expect(nextFit({ level: 1, needed: [730, 662] }, 0, 730)).toEqual({ level: 0, needed: [730, 662] });
  });

  it('stops at icons alone', () => {
    expect(LAST_FIT).toBe(2);
    expect(nextFit({ level: 2, needed: [730, 662] }, 20, 600)).toEqual({ level: 2, needed: [730, 662] });
  });
});
