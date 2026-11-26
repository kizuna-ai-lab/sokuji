import { describe, expect, it } from 'vitest';
import { createLiveTally } from './tally';

describe('the live notes tally', () => {
  // One summary per session from the loop's per-update lines: counts and a mean time, never text.
  it('sums a session’s updates, how many were kept and given up, and the mean latency', () => {
    const t = createLiveTally('kizunaai');
    t.add({ sentences: 3, latencyMs: 1000, accepted: true, givenUp: false, unstablePoints: 0 });
    t.add({ sentences: 2, latencyMs: 3000, accepted: true, givenUp: false, unstablePoints: 1 });
    t.add({ sentences: 1, latencyMs: 20000, accepted: false, givenUp: true, unstablePoints: 0 });
    expect(t.summary()).toEqual({ service: 'kizunaai', updates: 3, accepted: 2, given_up: 1, avg_latency_ms: 8000 });
  });

  it('has no summary for a session with no update', () => {
    expect(createLiveTally('own').summary()).toBeNull();
  });

  it('ignores a line it cannot read', () => {
    const t = createLiveTally('own');
    t.add({ nonsense: true });
    expect(t.summary()).toBeNull();
  });
});
