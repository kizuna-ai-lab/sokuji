/** Does the live slice still match a prepareToStart expectation? Every key in
 *  `expectation` must strictly equal the slice's current value. The two-phase
 *  stale-selection rule (see PrepareOutcome) runs on this: guard 1 discards
 *  the whole outcome, guard 2 drops only the session patch and its notice —
 *  both because the settings UI stays live while Start awaits, and a choice
 *  the user made meanwhile must not be silently overwritten. */
export function expectationHolds(
  expectation: Record<string, unknown> | undefined,
  slice: unknown,
): boolean {
  if (!expectation) return true;
  const s = (slice ?? {}) as Record<string, unknown>;
  return Object.entries(expectation).every(([k, v]) => s[k] === v);
}
