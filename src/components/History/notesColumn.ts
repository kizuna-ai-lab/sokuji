// src/components/History/notesColumn.ts
//
// The notes column of a wide record page (owner, 2026-11-17; B-31): its width, which the divider beside it drags, and
// whether it is open; both kept on this computer for the next record. The width stays within reach of the page it is
// shown on: at least 240px, at most 60% of the page, and always 400px left for the transcript.

export const NOTES_DEFAULT_PX = 380;
export const NOTES_MIN_PX = 240;
export const NOTES_MAX_SHARE = 0.6;
export const TRANSCRIPT_MIN_PX = 400;
/** The divider between the two columns. */
export const DIVIDER_PX = 1;

const WIDTH_KEY = 'history.notesWidth';
const CLOSED_KEY = 'history.notesClosed';

/** The width to show on a page `columns` px wide; what is stored is left as it is, for a wider window later. */
export function notesWidthWithin(width: number, columns: number): number {
  const max = Math.max(NOTES_MIN_PX, Math.min(Math.floor(columns * NOTES_MAX_SHARE), columns - TRANSCRIPT_MIN_PX - DIVIDER_PX));
  return Math.round(Math.min(Math.max(width, NOTES_MIN_PX), max));
}

export function readNotesWidth(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10);
    return Number.isFinite(n) ? n : NOTES_DEFAULT_PX;
  } catch {
    return NOTES_DEFAULT_PX;
  }
}

export function writeNotesWidth(width: number): void {
  try { localStorage.setItem(WIDTH_KEY, String(Math.round(width))); } catch { /* the default next time */ }
}

/** Open unless it was hidden: the last choice holds for every record, those without notes too (owner, 2026-11-17). */
export function readNotesOpen(): boolean {
  try { return localStorage.getItem(CLOSED_KEY) !== '1'; } catch { return true; }
}

export function writeNotesOpen(open: boolean): void {
  try {
    if (open) localStorage.removeItem(CLOSED_KEY); else localStorage.setItem(CLOSED_KEY, '1');
  } catch { /* open again next time */ }
}
