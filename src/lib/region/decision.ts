/**
 * The recommendation rule. Platform-neutral: only a type is imported.
 */
import type { RegionMedians } from './probe';

/** Absolute gain, in ms, the best region must have over the current one. */
export const RECOMMEND_MIN_GAIN_MS = 50;

export type RegionDecision =
  | { kind: 'unmeasured' }
  | { kind: 'no-change' }
  | { kind: 'recommend'; region: string };

export function decideRegion(
  regions: readonly string[],
  medians: RegionMedians,
  current: string,
): RegionDecision {
  const measured = regions.filter((r) => medians[r] != null);
  if (measured.length === 0) return { kind: 'unmeasured' };
  // A tie keeps the current region.
  const start = medians[current] != null ? current : measured[0];
  const best = measured.reduce((a, b) => (medians[b]! < medians[a]! ? b : a), start);
  if (best === current) return { kind: 'no-change' };
  const cur = medians[current];
  return cur == null || cur - medians[best]! >= RECOMMEND_MIN_GAIN_MS
    ? { kind: 'recommend', region: best }
    : { kind: 'no-change' };
}
