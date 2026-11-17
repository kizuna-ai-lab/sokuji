import { describe, it, expect, beforeEach } from 'vitest';
import {
  NOTES_DEFAULT_PX, NOTES_MIN_PX, TRANSCRIPT_MIN_PX,
  notesWidthWithin, readNotesWidth, writeNotesWidth, readNotesOpen, writeNotesOpen,
} from './notesColumn';

describe("the notes column's width and whether it is open, on a wide record page", () => {
  beforeEach(() => localStorage.clear());

  it('is 380px and open the first time', () => {
    expect(NOTES_DEFAULT_PX).toBe(380);
    expect(readNotesWidth()).toBe(380);
    expect(readNotesOpen()).toBe(true);
  });

  it('keeps the width the user left it at, and whether it was hidden, for the next record', () => {
    writeNotesWidth(512.4);
    writeNotesOpen(false);
    expect(readNotesWidth()).toBe(512);
    expect(readNotesOpen()).toBe(false);
    writeNotesOpen(true);
    expect(readNotesOpen()).toBe(true);
  });

  it('never narrower than 240px, never more than 60% of the page, and always 400px left for the transcript', () => {
    expect(NOTES_MIN_PX).toBe(240);
    expect(TRANSCRIPT_MIN_PX).toBe(400);
    expect(notesWidthWithin(100, 1400)).toBe(240);
    expect(notesWidthWithin(900, 1400)).toBe(840); // 60% of 1400
    expect(notesWidthWithin(900, 1000)).toBe(599); // 1000 − 400 − the 1px divider, under 60%
    expect(notesWidthWithin(380, 1400)).toBe(380);
  });

  it('fits a width kept from a wider window into a narrower one, without forgetting it', () => {
    writeNotesWidth(700);
    expect(notesWidthWithin(readNotesWidth(), 1000)).toBe(599);
    expect(readNotesWidth()).toBe(700);
    expect(notesWidthWithin(readNotesWidth(), 1400)).toBe(700);
  });

  it('reads a broken stored width as the default', () => {
    localStorage.setItem('history.notesWidth', 'wide');
    expect(readNotesWidth()).toBe(380);
  });
});
