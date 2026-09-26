import { describe, it, expect } from 'vitest';
import type { Segment } from '../conversation/types';
import { inferPairs, DEFAULT_PAIRING } from './pair';

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
