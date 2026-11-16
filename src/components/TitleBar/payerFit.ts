// src/components/TitleBar/payerFit.ts
//
// Who pays, in the account button (owner, 2026-11-17): the organization's name or "Personal" while the title bar has
// room for it, the payer's icon when it does not. The room depends on the window, the interface language and the
// name, so no one width can say; the button measures instead.

/**
 * Whether the button shows the payer's icon rather than its name.
 * `slack`: the room the title bar has left with what the button shows now (below 0: it overflows).
 * Showing the name, it turns to the icon once the bar overflows; showing the icon, it goes back to the name only when
 * the room left takes the name in the icon's place, so the two never take turns.
 */
export function compactPayer(compact: boolean, slack: number, nameWidth: number, iconWidth: number): boolean {
  if (!compact) return slack < 0;
  return slack < nameWidth - iconWidth;
}

/** The room the title bar has left: the space before its actions, less what overflows it. */
export function titleBarSlack(bar: Element): number | null {
  const title = bar.querySelector('.title-bar__title');
  const actions = bar.querySelector('.title-bar__actions');
  if (!title || !actions) return null;
  const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
  const before = actions.getBoundingClientRect().left - title.getBoundingClientRect().right - gap;
  return before - Math.max(0, bar.scrollWidth - bar.clientWidth);
}
