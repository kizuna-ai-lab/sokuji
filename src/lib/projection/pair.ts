import type { Leg, LegName, Segment, SegmentId } from '../conversation/types';
import type { PairingThresholds } from './types';

export const DEFAULT_PAIRING: PairingThresholds = { minOverlap: 0.5, proximityMs: 4000 };

/**
 * `origin` inference for a leg's segments that state none: by maximum media-
 * time overlap where both sides carry `timing`, otherwise by how soon after a
 * source the translation opened. Each source pairs at most once; translations
 * are matched in order of opening, a tie going to the earlier-opened source.
 * Unpaired is the normal case, not an error.
 *
 * Windowed (F16, Stage 2 Gemini): `segments` is in the order L1 opened them
 * and `openedAt` is L1's clock at that moment, so it does not decrease along
 * the list — the opening-order assumption matching "in order of opening"
 * already made. A translation looks only at the sources that opened within
 * `proximityMs` before it (a binary search, then a walk up to its own
 * opening) and, when it carries timing, at every source that does. A wall
 * clock set back mid-session breaks the order: a source out of place may
 * then be missed, and its translation shows unpaired or pairs with another
 * source its window still holds — which that source then no longer offers
 * to a later translation.
 */
export function inferPairs(segments: readonly Segment[], t: PairingThresholds): Map<SegmentId, SegmentId> {
  const sources = segments.filter((s) => s.side === 'source' && s.origin === undefined);
  const translations = segments.filter((s) => s.side === 'translation' && s.origin === undefined);
  const timed = sources.flatMap((s, i) => (s.timing ? [i] : []));
  const taken = new Set<SegmentId>();
  const out = new Map<SegmentId, SegmentId>();
  for (const tr of translations) {
    const near = windowOf(sources, tr.openedAt - t.proximityMs, tr.openedAt);
    let best: Segment | undefined;
    let bestScore = -Infinity;
    // Ascending source order, as the full scan: the earlier source keeps a tie.
    for (const i of tr.timing ? mergeSorted(near, timed) : near) {
      const src = sources[i];
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

/** The indices of the `sources` (in opening order) that opened within [from, to]. */
function windowOf(sources: readonly Segment[], from: number, to: number): number[] {
  let lo = 0;
  let hi = sources.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sources[mid].openedAt < from) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < sources.length && sources[i].openedAt <= to; i++) out.push(i);
  return out;
}

/** Two ascending index lists as one, each index once. */
function mergeSorted(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (out[out.length - 1] !== next) out.push(next);
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

/** What `inferPairs` reads of a segment: a partial's text changes none of it. */
interface PairInput { id: SegmentId; side: Segment['side']; origin: string | undefined; openedAt: number; startMs: number | undefined; endMs: number | undefined }

const pairInput = (s: Segment): PairInput => ({ id: s.id, side: s.side, origin: s.origin, openedAt: s.openedAt, startMs: s.timing?.startMs, endMs: s.timing?.endMs });

const sameInput = (a: PairInput, s: Segment): boolean =>
  a.id === s.id && a.side === s.side && a.origin === s.origin && a.openedAt === s.openedAt && a.startMs === s.timing?.startMs && a.endMs === s.timing?.endMs;

interface Cached { session: string; t: PairingThresholds; inputs: PairInput[]; map: Map<SegmentId, SegmentId> }

/**
 * Pairing re-evaluated only when what it reads changed (F16; spec: "The
 * projection is incremental"): a segment opened, or one's origin or timing
 * changed. A partial — twenty a second, for hours — changes none of them,
 * so it costs one comparison per segment instead of a re-pairing. One
 * answer per leg name; a new session replaces it. `infer` is the test's seam.
 *
 * It keeps what pairing read, never the segments: the cache lives as long as
 * the app's one view, and a leg name no later run projects would otherwise
 * hold its last array — every segment's replay pcm with it — for good. So
 * every call compares the inputs, the same array included, which also
 * catches an array changed in place. The map is the one answer every hit
 * returns: callers read it, never change it.
 */
export function createPairCache(infer: typeof inferPairs = inferPairs): (leg: Pick<Leg, 'leg' | 'session' | 'segments'>, t: PairingThresholds) => Map<SegmentId, SegmentId> {
  const byLeg = new Map<LegName, Cached>();
  return (leg, t) => {
    const hit = byLeg.get(leg.leg);
    if (hit && hit.session === leg.session && hit.t === t
      && hit.inputs.length === leg.segments.length && leg.segments.every((s, i) => sameInput(hit.inputs[i], s))) {
      return hit.map;
    }
    const map = infer(leg.segments, t);
    byLeg.set(leg.leg, { session: leg.session, t, inputs: leg.segments.map(pairInput), map });
    return map;
  };
}
