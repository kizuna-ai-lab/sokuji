// src/components/LiveNotes/liveNotesWidth.ts
//
// The width of the live notes panel beside the conversation (owner, 2026-11-18), which the divider on its left drags;
// kept on this computer for the next session. Like the record page's notes column (notesColumn.ts): at least 240px, at
// most 60% of the row, and always 400px left for the conversation. Narrow windows stack the two and ignore it.

export const LIVE_NOTES_DEFAULT_PX = 324;
export const LIVE_NOTES_MIN_PX = 240;
export const LIVE_NOTES_MAX_SHARE = 0.6;
export const CONVERSATION_MIN_PX = 400;
/** The divider between the conversation and the notes. */
export const DIVIDER_PX = 1;

const WIDTH_KEY = 'liveNotes.width';

/** The width to show in a row `row` px wide; what is stored is left as it is, for a wider window later. */
export function liveNotesWidthWithin(width: number, row: number): number {
  const max = Math.max(LIVE_NOTES_MIN_PX, Math.min(Math.floor(row * LIVE_NOTES_MAX_SHARE), row - CONVERSATION_MIN_PX - DIVIDER_PX));
  return Math.round(Math.min(Math.max(width, LIVE_NOTES_MIN_PX), max));
}

export function readLiveNotesWidth(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10);
    return Number.isFinite(n) ? n : LIVE_NOTES_DEFAULT_PX;
  } catch {
    return LIVE_NOTES_DEFAULT_PX;
  }
}

export function writeLiveNotesWidth(width: number): void {
  try { localStorage.setItem(WIDTH_KEY, String(Math.round(width))); } catch { /* the default next time */ }
}
