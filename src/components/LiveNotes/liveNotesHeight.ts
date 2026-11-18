// src/components/LiveNotes/liveNotesHeight.ts
//
// The height of the live notes above the conversation in a narrow window (owner, 2026-11-19), which the divider under
// them drags, as the one beside the conversation drags their width (liveNotesWidth.ts); kept on this computer for the
// next session. Never dragged, the notes take what they need up to 40% of the window (MainPanel.scss), as before. At
// least 80px of notes, and always 120px left for the conversation.

export const LIVE_NOTES_MIN_HEIGHT_PX = 80;
export const CONVERSATION_MIN_HEIGHT_PX = 120;
/** The divider between the notes and the conversation. */
export const ROW_DIVIDER_PX = 1;

const HEIGHT_KEY = 'liveNotes.height';

/** The height to show in a column `column` px tall; what is stored is left as it is, for a taller window later. */
export function liveNotesHeightWithin(height: number, column: number): number {
  const max = Math.max(LIVE_NOTES_MIN_HEIGHT_PX, column - CONVERSATION_MIN_HEIGHT_PX - ROW_DIVIDER_PX);
  return Math.round(Math.min(Math.max(height, LIVE_NOTES_MIN_HEIGHT_PX), max));
}

/** The height kept from last time; null when it was never dragged (the notes then size to what they hold). */
export function readLiveNotesHeight(): number | null {
  try {
    const n = Number.parseInt(localStorage.getItem(HEIGHT_KEY) ?? '', 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLiveNotesHeight(height: number): void {
  try { localStorage.setItem(HEIGHT_KEY, String(Math.round(height))); } catch { /* sized to what they hold next time */ }
}
