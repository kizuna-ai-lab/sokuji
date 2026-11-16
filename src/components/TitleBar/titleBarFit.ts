// src/components/TitleBar/titleBarFit.ts
//
// How much the title bar spells out (owner, 2026-11-17). Step 0: everything. Step 1: who pays as an icon (a building,
// a person) rather than its name. Step 2: icons alone, the labels of Subtitle, History and Settings hidden too. Whether
// a step fits depends on the window, the interface language and the names, so no one width can say: the bar measures.
// A step is taken when the bar overflows, and undone only once the window is as wide as the step before needed, so two
// steps never take turns.

/** The last step: icons alone. */
export const LAST_FIT = 2;

export interface Fit {
  /** The step shown. */
  level: number;
  /** For each step left behind, how wide the window must be for it to fit again. */
  needed: number[];
}

/** The step to show, from the bar's overflow with the current one (0: none) and the window's width. */
export function nextFit(fit: Fit, overflow: number, width: number): Fit {
  if (overflow > 0 && fit.level < LAST_FIT) {
    const needed = [...fit.needed];
    needed[fit.level] = width + overflow;
    return { level: fit.level + 1, needed };
  }
  const before = fit.level - 1;
  if (overflow <= 0 && before >= 0 && fit.needed[before] !== undefined && width >= fit.needed[before]) {
    return { level: before, needed: fit.needed };
  }
  return fit;
}

/** How far what the bar holds runs past it (0: it fits). */
export function overflowOf(bar: Element): number {
  return Math.max(0, bar.scrollWidth - bar.clientWidth);
}
