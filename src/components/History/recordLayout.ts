// src/components/History/recordLayout.ts
//
// How the record page lays out its three parts for its width (owner, 2026-11-19). The transcript always shows; the
// notes and the edit panel each have a switch in the toolbar.
//  - 'three': room for the three at their narrowest. Each panel switched on is a column: the notes at the left of the
//    transcript, the edit panel at its right.
//  - 'two': room for one panel beside the transcript. One switched on stands where it would with room for three; both
//    switched on share the left column, a tab each.
//  - 'tabs': not even that. Notes | Transcript | Edit, one at a time, each taking the page.

import { DIVIDER_PX, NOTES_MIN_PX, TRANSCRIPT_MIN_PX } from './notesColumn';
import { SIDE_MIN_PX } from './sideColumn';

export type RecordLayout = 'three' | 'two' | 'tabs';

/** A panel at its narrowest, its divider, and the transcript at its narrowest. */
export const TWO_COLUMNS_PX = NOTES_MIN_PX + DIVIDER_PX + TRANSCRIPT_MIN_PX;
/** The notes and the edit panel at their narrowest, the transcript at its narrowest, and their two dividers. */
export const THREE_COLUMNS_PX = TWO_COLUMNS_PX + DIVIDER_PX + SIDE_MIN_PX;

/** The layout for a page `width` px wide; 0, before it is measured, is tabs. */
export function layoutFor(width: number): RecordLayout {
  if (width >= THREE_COLUMNS_PX) return 'three';
  if (width >= TWO_COLUMNS_PX) return 'two';
  return 'tabs';
}
