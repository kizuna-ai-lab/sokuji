import { describe, it, expect, beforeEach } from 'vitest';
import { SIDE_DEFAULT_PX, SIDE_MIN_PX, sideWidthWithin, readSideWidth, writeSideWidth } from './sideColumn';

// Owner, 2026-11-18: the record's side panel is a column of the page, as the notes are, not a drawer over the
// transcript: it is going to hold tools that edit the transcript, which a drawer would cover.
describe("the side panel's column on a record page", () => {
  beforeEach(() => localStorage.clear());

  it('is 300px the first time, and keeps the width the user left it at', () => {
    expect(SIDE_DEFAULT_PX).toBe(300);
    expect(readSideWidth()).toBe(300);
    writeSideWidth(352.6);
    expect(readSideWidth()).toBe(353);
  });

  it('never narrower than 240px, at most half of its room, and always 400px left for the transcript', () => {
    expect(SIDE_MIN_PX).toBe(240);
    expect(sideWidthWithin(100, 1200)).toBe(240);
    expect(sideWidthWithin(900, 1200)).toBe(600); // half of 1200
    expect(sideWidthWithin(900, 900)).toBe(450); // half of 900, with 449 left for the transcript and the divider
    expect(sideWidthWithin(900, 800)).toBe(399); // 800 − 400 − the 1px divider, under half
    expect(sideWidthWithin(300, 1200)).toBe(300);
  });

  it('takes the whole room when there is not enough for both, so the transcript gives way while it is open', () => {
    expect(sideWidthWithin(300, 600)).toBe(600);
  });

  it('reads a broken stored width as the default', () => {
    localStorage.setItem('history.sideWidth', 'wide');
    expect(readSideWidth()).toBe(300);
  });
});
