/**
 * A screen that must not be left while its own request runs (sign-in, verify,
 * a rename or delete being saved): Back is refused during the hold. A request
 * that ends by leaving (signed in, session deleted) asks to leave while it
 * still holds the page; the page then stops refusing and goes once the hold
 * has released, so the navigation is never swallowed by the hold itself.
 */
export function leaveState(s: { holding: boolean; leaving: boolean }): { prevent: boolean; goBack: boolean } {
  return { prevent: s.holding && !s.leaving, goBack: s.leaving && !s.holding };
}
