import type { Segment, SegmentId } from '../conversation/types';
import type { PairingThresholds } from './types';

export const DEFAULT_PAIRING: PairingThresholds = { minOverlap: 0.5, proximityMs: 4000 };

/**
 * `origin` inference for a leg's segments that state none: by maximum media-
 * time overlap where both sides carry `timing`, otherwise by how soon after a
 * source the translation opened. Each source pairs at most once; translations
 * are matched in order of opening. Unpaired is the normal case, not an error.
 */
export function inferPairs(segments: readonly Segment[], t: PairingThresholds): Map<SegmentId, SegmentId> {
  const sources = segments.filter((s) => s.side === 'source' && s.origin === undefined);
  const translations = segments.filter((s) => s.side === 'translation' && s.origin === undefined);
  const taken = new Set<SegmentId>();
  const out = new Map<SegmentId, SegmentId>();
  for (const tr of translations) {
    let best: Segment | undefined;
    let bestScore = -Infinity;
    for (const src of sources) {
      if (taken.has(src.id)) continue;
      const score = pairScore(src, tr, t);
      if (score !== null && score > bestScore) {
        best = src;
        bestScore = score;
      }
    }
    if (best) {
      out.set(tr.id, best.id);
      taken.add(best.id);
    }
  }
  return out;
}

/** Higher is better; null means "not a candidate". Timing outranks proximity. */
function pairScore(src: Segment, tr: Segment, t: PairingThresholds): number | null {
  if (src.timing && tr.timing) {
    const overlap = Math.min(src.timing.endMs, tr.timing.endMs) - Math.max(src.timing.startMs, tr.timing.startMs);
    const span = Math.max(1, tr.timing.endMs - tr.timing.startMs);
    const fraction = overlap / span;
    return fraction >= t.minOverlap ? 1 + fraction : null;
  }
  const gap = tr.openedAt - src.openedAt;
  if (gap < 0 || gap > t.proximityMs) return null;
  return 1 - gap / t.proximityMs;
}
