import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import type { Segment } from '../conversation/types';
import type { Leg, SegmentId } from '../conversation/types';
import type { PairingThresholds } from './types';
import { createPairCache, DEFAULT_PAIRING, inferPairs } from './pair';

let n = 0;
const seg = (over: Partial<Segment>): Segment => ({
  id: `s:speaker:${++n}`, ref: n, side: 'source', text: 'x', final: true, openedAt: 0, marks: [], speech: [], ...over,
});

describe('inferPairs', () => {
  it('pairs by maximum media-time overlap when both sides carry timing', () => {
    const s1 = seg({ side: 'source', timing: { startMs: 0, endMs: 1000 } });
    const s2 = seg({ side: 'source', timing: { startMs: 1000, endMs: 2000 } });
    const t = seg({ side: 'translation', timing: { startMs: 900, endMs: 1900 } });
    expect(inferPairs([s1, s2, t], DEFAULT_PAIRING)).toEqual(new Map([[t.id, s2.id]]));
  });

  it('pairs by proximity of opening when timing is absent, within the window and only forward', () => {
    const s1 = seg({ side: 'source', openedAt: 0 });
    const s2 = seg({ side: 'source', openedAt: 5000 });
    const t1 = seg({ side: 'translation', openedAt: 1200 });
    const t2 = seg({ side: 'translation', openedAt: 4000 });
    expect(inferPairs([s1, s2, t1, t2], DEFAULT_PAIRING)).toEqual(new Map([[t1.id, s1.id]]));
  });

  it('never pairs a source twice, and skips segments with a stated origin', () => {
    const s1 = seg({ side: 'source', openedAt: 0 });
    const t1 = seg({ side: 'translation', openedAt: 100 });
    const t2 = seg({ side: 'translation', openedAt: 200 });
    const stated = seg({ side: 'translation', openedAt: 50, origin: 'o1' });
    const pairs = inferPairs([s1, t1, t2, stated], DEFAULT_PAIRING);
    expect(pairs).toEqual(new Map([[t1.id, s1.id]]));
  });

  it('leaves a translation unpaired when the overlap is below the threshold', () => {
    const s = seg({ side: 'source', timing: { startMs: 0, endMs: 1000 } });
    const t = seg({ side: 'translation', timing: { startMs: 900, endMs: 2900 } });
    expect(inferPairs([s, t], DEFAULT_PAIRING).size).toBe(0);
  });
});

/** Today's full scan, word for word before F16: the reference the window must agree with. */
function referencePairs(segments: readonly Segment[], t: PairingThresholds): Map<SegmentId, SegmentId> {
  const score = (src: Segment, tr: Segment): number | null => {
    if (src.timing && tr.timing) {
      const overlap = Math.min(src.timing.endMs, tr.timing.endMs) - Math.max(src.timing.startMs, tr.timing.startMs);
      const fraction = overlap / Math.max(1, tr.timing.endMs - tr.timing.startMs);
      return fraction >= t.minOverlap ? 1 + fraction : null;
    }
    const gap = tr.openedAt - src.openedAt;
    if (gap < 0 || gap > t.proximityMs) return null;
    return 1 - gap / t.proximityMs;
  };
  const sources = segments.filter((s) => s.side === 'source' && s.origin === undefined);
  const translations = segments.filter((s) => s.side === 'translation' && s.origin === undefined);
  const taken = new Set<SegmentId>();
  const out = new Map<SegmentId, SegmentId>();
  for (const tr of translations) {
    let best: Segment | undefined;
    let bestScore = -Infinity;
    for (const src of sources) {
      if (taken.has(src.id)) continue;
      const s = score(src, tr);
      if (s !== null && s > bestScore) { best = src; bestScore = s; }
    }
    if (best) { out.set(tr.id, best.id); taken.add(best.id); }
  }
  return out;
}

/** A deterministic generator (mulberry32), so the long leg is the same leg on every run. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2 000 segments in opening order: both sides, a quarter timed, a tenth with a stated origin — the same leg on every run. */
function longLeg(): Segment[] {
  const random = prng(7);
  let at = 0;
  const long: Segment[] = [];
  for (let i = 0; i < 2000; i++) {
    at += Math.floor(random() * 3000);
    const side = random() < 0.5 ? 'source' : 'translation';
    const start = Math.floor(random() * 600_000);
    const timed = random() < 0.25;
    const stated = random() < 0.1;
    long.push(seg({
      side,
      openedAt: at,
      ...(timed ? { timing: { startMs: start, endMs: start + 500 + Math.floor(random() * 4000) } } : {}),
      ...(stated ? { origin: `o${i}` } : {}),
    }));
  }
  return long;
}

/** 300 segments on a 500 ms grid: many opening at one instant, and gaps and overlaps landing exactly on a threshold. */
function gridLeg(seed: number): Segment[] {
  const random = prng(seed);
  let at = 0;
  const grid: Segment[] = [];
  for (let i = 0; i < 300; i++) {
    at += 500 * Math.floor(random() * 3);
    const side = random() < 0.5 ? 'source' : 'translation';
    const start = 250 * Math.floor(random() * 240);
    const timed = random() < 0.3;
    const stated = random() < 0.1;
    grid.push(seg({
      side,
      openedAt: at,
      ...(timed ? { timing: { startMs: start, endMs: start + 250 * (1 + Math.floor(random() * 8)) } } : {}),
      ...(stated ? { origin: `g${seed}:${i}` } : {}),
    }));
  }
  return grid;
}

describe('inferPairs — at its thresholds, windowed (F16)', () => {
  it('pairs at exactly the proximity window, and not a millisecond past it', () => {
    const s1 = seg({ side: 'source', openedAt: 1000 });
    const at = seg({ side: 'translation', openedAt: 5000 });
    expect(inferPairs([s1, at], DEFAULT_PAIRING)).toEqual(new Map([[at.id, s1.id]]));
    const s2 = seg({ side: 'source', openedAt: 1000 });
    const past = seg({ side: 'translation', openedAt: 5001 });
    expect(inferPairs([s2, past], DEFAULT_PAIRING).size).toBe(0);
  });

  it('pairs a translation that opened with its source, never one that opened before it', () => {
    const s1 = seg({ side: 'source', openedAt: 1000 });
    const same = seg({ side: 'translation', openedAt: 1000 });
    expect(inferPairs([s1, same], DEFAULT_PAIRING)).toEqual(new Map([[same.id, s1.id]]));
    const early = seg({ side: 'translation', openedAt: 900 });
    const s2 = seg({ side: 'source', openedAt: 1000 });
    expect(inferPairs([early, s2], DEFAULT_PAIRING).size).toBe(0);
  });

  it('pairs at exactly the minimum overlap, and not below it', () => {
    const s1 = seg({ side: 'source', timing: { startMs: 0, endMs: 1000 } });
    const half = seg({ side: 'translation', timing: { startMs: 500, endMs: 1500 } });
    expect(inferPairs([s1, half], DEFAULT_PAIRING)).toEqual(new Map([[half.id, s1.id]]));
    const s2 = seg({ side: 'source', timing: { startMs: 0, endMs: 1000 } });
    const less = seg({ side: 'translation', timing: { startMs: 501, endMs: 1501 } });
    expect(inferPairs([s2, less], DEFAULT_PAIRING).size).toBe(0);
  });

  it('breaks a tie toward the earlier-opened source, as the full scan did', () => {
    const first = seg({ side: 'source', openedAt: 0 });
    const second = seg({ side: 'source', openedAt: 0 });
    const t = seg({ side: 'translation', openedAt: 100 });
    expect(inferPairs([first, second, t], DEFAULT_PAIRING)).toEqual(new Map([[t.id, first.id]]));
  });

  it('still scores every timed source for a timed translation, however long before it opened', () => {
    const s1 = seg({ side: 'source', openedAt: 0, timing: { startMs: 0, endMs: 10_000 } });
    const t = seg({ side: 'translation', openedAt: 20_000, timing: { startMs: 2000, endMs: 9000 } });
    expect(inferPairs([s1, t], DEFAULT_PAIRING)).toEqual(new Map([[t.id, s1.id]]));
  });

  it('agrees with the full scan over a long leg in opening order', () => {
    const long = longLeg();
    const pairs = inferPairs(long, DEFAULT_PAIRING);
    expect(pairs.size).toBeGreaterThan(100);
    expect(pairs).toEqual(referencePairs(long, DEFAULT_PAIRING));
  });

  it('agrees with the full scan over grid legs, where sources share an instant and gaps sit on the window edge, at other thresholds too', () => {
    const thresholds: PairingThresholds[] = [DEFAULT_PAIRING, { minOverlap: 0.25, proximityMs: 1000 }, { minOverlap: 0.75, proximityMs: 500 }];
    let compared = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const grid = gridLeg(seed);
      for (const t of thresholds) {
        const want = referencePairs(grid, t);
        expect(inferPairs(grid, t)).toEqual(want);
        compared += want.size;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("reads each segment's opening time a bounded number of times, where the full scan reads it for every pair", () => {
    let reads = 0;
    // The same leg, each `openedAt` behind a getter that counts its reads.
    const counted = longLeg().map((s) => {
      const openedAt = s.openedAt;
      return Object.defineProperty({ ...s }, 'openedAt', { get: () => { reads += 1; return openedAt; }, enumerable: true });
    });
    inferPairs(counted, DEFAULT_PAIRING);
    const windowed = reads;
    reads = 0;
    referencePairs(counted, DEFAULT_PAIRING);
    // The window: a binary search and a short walk per translation (13 717 reads, simulated while writing this plan). The full scan: every untaken source for every translation (1 087 704).
    expect(windowed).toBeLessThan(10 * counted.length);
    expect(reads).toBeGreaterThan(100 * counted.length);
  });
});

describe('createPairCache — re-pairs only when what pairing reads changed (F16)', () => {
  const leg = (segments: readonly Segment[], session = 's1'): Pick<Leg, 'leg' | 'session' | 'segments'> => ({ leg: 'speaker', session, segments });

  it('a partial — new text — costs no re-pairing; an opened segment, an origin, a timing, another session or other thresholds do', () => {
    const infer = vi.fn(inferPairs);
    const pairsOf = createPairCache(infer);
    const s1 = seg({ side: 'source', openedAt: 0, text: 'He' });
    const t = seg({ side: 'translation', openedAt: 500 });
    const segments = [s1, t];
    const first = pairsOf(leg(segments), DEFAULT_PAIRING);
    expect(first).toEqual(new Map([[t.id, s1.id]]));
    expect(pairsOf(leg(segments), DEFAULT_PAIRING)).toBe(first);
    expect(pairsOf(leg([{ ...s1, text: 'Hello', final: true }, t]), DEFAULT_PAIRING)).toBe(first);
    expect(infer).toHaveBeenCalledTimes(1);

    pairsOf(leg([s1, t, seg({ side: 'source', openedAt: 900 })]), DEFAULT_PAIRING);
    expect(infer).toHaveBeenCalledTimes(2);
    pairsOf(leg([s1, { ...t, origin: 'o1' }]), DEFAULT_PAIRING);
    expect(infer).toHaveBeenCalledTimes(3);
    pairsOf(leg([s1, { ...t, origin: 'o1', timing: { startMs: 0, endMs: 10 } }]), DEFAULT_PAIRING);
    expect(infer).toHaveBeenCalledTimes(4);
    pairsOf(leg([s1, { ...t, origin: 'o1', timing: { startMs: 0, endMs: 10 } }], 's2'), DEFAULT_PAIRING);
    expect(infer).toHaveBeenCalledTimes(5);
    pairsOf(leg([s1, { ...t, origin: 'o1', timing: { startMs: 0, endMs: 10 } }], 's2'), { ...DEFAULT_PAIRING });
    expect(infer).toHaveBeenCalledTimes(6);
  });

  it('re-pairs when a close states an origin, though the leg keeps its length', () => {
    const infer = vi.fn(inferPairs);
    const pairsOf = createPairCache(infer);
    const s1 = seg({ side: 'source', openedAt: 0 });
    const t = seg({ side: 'translation', openedAt: 500, final: false });
    expect(pairsOf(leg([s1, t]), DEFAULT_PAIRING)).toEqual(new Map([[t.id, s1.id]]));
    // L1's close replaces the segment in place — the same id, now with a stated origin — so only `origin` differs.
    expect(pairsOf(leg([s1, { ...t, final: true, origin: 'u1' }]), DEFAULT_PAIRING).size).toBe(0);
    expect(infer).toHaveBeenCalledTimes(2);
  });

  it('keeps one answer per leg: the other leg is its own', () => {
    const infer = vi.fn(inferPairs);
    const pairsOf = createPairCache(infer);
    const segments = [seg({ side: 'source', openedAt: 0 }), seg({ side: 'translation', openedAt: 10 })];
    pairsOf({ leg: 'speaker', session: 's1', segments }, DEFAULT_PAIRING);
    pairsOf({ leg: 'participant', session: 's1', segments }, DEFAULT_PAIRING);
    pairsOf({ leg: 'speaker', session: 's1', segments }, DEFAULT_PAIRING);
    expect(infer).toHaveBeenCalledTimes(2);
  });
});

describe('createPairCache — compares what pairing read, and holds no segment (F16)', () => {
  const leg = (segments: readonly Segment[]): Pick<Leg, 'leg' | 'session' | 'segments'> => ({ leg: 'speaker', session: 's1', segments });

  it('re-pairs an array changed in place: it compares what it read, never the array', () => {
    const infer = vi.fn(inferPairs);
    const pairsOf = createPairCache(infer);
    const s1 = seg({ side: 'source', openedAt: 0 });
    const t = seg({ side: 'translation', openedAt: 500 });
    const segments = [s1, t];
    expect(pairsOf(leg(segments), DEFAULT_PAIRING)).toEqual(new Map([[t.id, s1.id]]));
    segments[1] = { ...t, origin: 'u1' };
    expect(pairsOf(leg(segments), DEFAULT_PAIRING).size).toBe(0);
    expect(infer).toHaveBeenCalledTimes(2);
  });

  it('keeps neither the segments array, a segment nor its pcm alive once the leg lets them go', async () => {
    // A full collection on demand. The suite runs without `--expose-gc`, so the
    // flag is set here and a fresh context, which reads it, hands out `gc`; a
    // Node without it throws here rather than letting the case pass unchecked.
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    // ES2021's `WeakRef`: Node has it, the project's ES2020 `lib` does not declare it.
    const WeakRef = (globalThis as unknown as { WeakRef: new <T extends object>(target: T) => { deref(): T | undefined } }).WeakRef;
    // A leg name no later run projects: its last array must not outlive the leg.
    const pairsOf = createPairCache();
    const feed = () => {
      const segments = [
        seg({ side: 'source', openedAt: 0, speech: [{ pcm: new Int16Array(1 << 20) }] }),
        seg({ side: 'translation', openedAt: 10 }),
      ];
      const map = pairsOf({ leg: 'participant', session: 's1', segments }, DEFAULT_PAIRING);
      return { ids: segments.map((s) => s.id), map, array: new WeakRef(segments), segment: new WeakRef(segments[0]), pcm: new WeakRef(segments[0].speech[0].pcm) };
    };
    const fed = feed();
    // Controls: an array a holder keeps survives the collection, and one nothing keeps does not.
    const holder = new Map<string, Segment[]>();
    const kept = (() => {
      const segments = [seg({ side: 'source' })];
      holder.set('kept', segments);
      return new WeakRef(segments);
    })();
    const loose = new WeakRef([seg({ side: 'source' })]);
    // Node's own `gcUntil` (`test/common/gc.js`): a macrotask, a full collection, a look — a few rounds, since one
    // collection need not clear every target. The macrotask comes first each round: a WeakRef keeps its target
    // alive until the current job ends, and so does each `deref()`.
    const gone = () => [loose, fed.array, fed.segment, fed.pcm].every((ref) => ref.deref() === undefined);
    for (let round = 0; round < 5; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
      if (gone()) break;
    }
    expect(kept.deref()).toBe(holder.get('kept'));
    expect(loose.deref()).toBeUndefined();
    expect(fed.array.deref()).toBeUndefined();
    expect(fed.segment.deref()).toBeUndefined();
    expect(fed.pcm.deref()).toBeUndefined();
    // The cache is still alive, and still answers from the inputs it kept.
    const again = [seg({ id: fed.ids[0], side: 'source', openedAt: 0 }), seg({ id: fed.ids[1], side: 'translation', openedAt: 10 })];
    expect(pairsOf({ leg: 'participant', session: 's1', segments: again }, DEFAULT_PAIRING)).toBe(fed.map);
  });
});
