// src/components/History/sideColumn.ts
//
// The side panel's column on a record page (owner, 2026-11-18): at the right of the transcript, sharing the page with it
// as the notes do, never over it, since it is to hold tools that edit the transcript. Its width is dragged at the divider
// on its left and kept on this computer for the next record: at least 240px, at most half of its room (the page less the
// notes), and always 400px left for the transcript. A room too small for both gives it all: the transcript gives way
// while it is open.
import { DIVIDER_PX, TRANSCRIPT_MIN_PX } from './notesColumn';

export const SIDE_DEFAULT_PX = 300;
export const SIDE_MIN_PX = 240;
const SIDE_MAX_SHARE = 0.5;
const WIDTH_KEY = 'history.sideWidth';

/** Whether the transcript and the side panel both fit in `room` px. */
export function sideFitsBeside(room: number): boolean {
  return room >= SIDE_MIN_PX + DIVIDER_PX + TRANSCRIPT_MIN_PX;
}

/** The width to show in `room` px; what is stored is left as it is, for a wider window later. */
export function sideWidthWithin(width: number, room: number): number {
  if (!sideFitsBeside(room)) return Math.max(0, Math.round(room));
  const max = Math.max(SIDE_MIN_PX, Math.min(Math.floor(room * SIDE_MAX_SHARE), room - TRANSCRIPT_MIN_PX - DIVIDER_PX));
  return Math.round(Math.min(Math.max(width, SIDE_MIN_PX), max));
}

export function readSideWidth(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10);
    return Number.isFinite(n) ? n : SIDE_DEFAULT_PX;
  } catch {
    return SIDE_DEFAULT_PX;
  }
}

export function writeSideWidth(width: number): void {
  try { localStorage.setItem(WIDTH_KEY, String(Math.round(width))); } catch { /* the default next time */ }
}
