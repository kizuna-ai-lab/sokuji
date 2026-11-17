// src/components/History/panelSwitchFit.ts
//
// Whether the record page's two panel switches keep their words ("Notes", "Side panel") beside their icons (owner,
// 2026-11-17): as the title bar does, the words stay while there is room and go, the icons staying, when there is not.
// Room means the heading keeps its 240px beside the actions with their words; the words' width depends on the
// language, so the page measures it.

/** What the heading keeps beside the actions (its flex basis in History.scss). */
export const HEADING_MIN_PX = 240;

export interface Widths {
  /** The head's width, its padding included. */
  head: number;
  /** The head's left and right padding together. */
  padding: number;
  /** The gaps between the head's parts, together. */
  gaps: number;
  /** What else stands in the head beside the heading and the actions (the way back to the list). */
  others: number;
  /** The actions' width with the switches' words shown. */
  actions: number;
}

/** True when the words fit; also before the page is laid out (nothing measured yet). */
export function labelsFit(w: Widths): boolean {
  if (w.head <= 0) return true;
  return w.head - w.padding - w.gaps - w.others - w.actions >= HEADING_MIN_PX;
}
