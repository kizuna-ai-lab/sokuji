// src/lib/language/arrowBetween.ts
//
// Two language names with an arrow between them, the way a session translates (the conversation's footer, the History
// list and the record page). In a right-to-left script (Hebrew, Arabic, Persian) the browser laid "name → name" out as
// one right-to-left run: the names swapped places and the arrow did not, so it pointed the wrong way (review,
// 2026-11-18). A left-to-right mark on each side of the arrow keeps the names in the order written, mine first, each
// read in its own direction; the left-to-right isolate around the whole keeps that order on a right-to-left page too,
// where the marks alone would not (measured in Chromium). None of them takes room; in other scripts nothing changes.

const LRM = '\u200E';
/** Left-to-right isolate, and the end of it. */
const LRI = '\u2066';
const PDI = '\u2069';

export function arrowBetween(left: string, arrow: string, right: string): string {
  return `${LRI}${left}${LRM} ${arrow} ${LRM}${right}${PDI}`;
}
