import { describe, it, expect, beforeEach } from 'vitest';
import {
  LIVE_NOTES_DEFAULT_PX, LIVE_NOTES_MIN_PX, CONVERSATION_MIN_PX,
  liveNotesWidthWithin, readLiveNotesWidth, writeLiveNotesWidth,
} from './liveNotesWidth';

describe("the live notes panel's width beside the conversation", () => {
  beforeEach(() => localStorage.clear());

  it('is 324px the first time, as it was before it could be dragged', () => {
    expect(LIVE_NOTES_DEFAULT_PX).toBe(324);
    expect(readLiveNotesWidth()).toBe(324);
  });

  it('keeps the width the user left it at, for the next session', () => {
    writeLiveNotesWidth(410.6);
    expect(readLiveNotesWidth()).toBe(411);
  });

  it('never narrower than 240px, never more than 60% of the row, and always 400px left for the conversation', () => {
    expect(LIVE_NOTES_MIN_PX).toBe(240);
    expect(CONVERSATION_MIN_PX).toBe(400);
    expect(liveNotesWidthWithin(100, 1400)).toBe(240);
    expect(liveNotesWidthWithin(1000, 1400)).toBe(840); // 60% of 1400
    expect(liveNotesWidthWithin(1000, 900)).toBe(499); // 900 − 400 − the 1px divider, under 60%
    expect(liveNotesWidthWithin(324, 1400)).toBe(324);
  });

  it('stays at 240px in a row too narrow for both, or not measured yet, rather than vanishing', () => {
    expect(liveNotesWidthWithin(324, 500)).toBe(240);
    expect(liveNotesWidthWithin(324, 0)).toBe(240);
  });

  it('fits a width kept from a wider window into a narrower one, without forgetting it', () => {
    writeLiveNotesWidth(700);
    expect(liveNotesWidthWithin(readLiveNotesWidth(), 1000)).toBe(599);
    expect(readLiveNotesWidth()).toBe(700);
    expect(liveNotesWidthWithin(readLiveNotesWidth(), 1400)).toBe(700);
  });

  it('reads a broken stored width as the default', () => {
    localStorage.setItem('liveNotes.width', 'wide');
    expect(readLiveNotesWidth()).toBe(324);
  });
});
