/**
 * Which of several overlapping requests from one screen is the newest. A screen
 * that reloads on every focus can have two loads in flight; the older one must
 * not overwrite the newer one's result when it finishes last.
 */
export function createLatest(): { next(): number; isCurrent(token: number): boolean } {
  let n = 0;
  return {
    next: () => ++n,
    isCurrent: (token) => token === n,
  };
}
