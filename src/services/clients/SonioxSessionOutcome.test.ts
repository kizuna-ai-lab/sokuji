import { describe, it, expect } from 'vitest';
import { SonioxSessionOutcome } from './SonioxSessionOutcome';

/**
 * Pure-unit tests, same shape as SonioxCostMeter.test.ts: a plain
 * construction, no mocks, one assertion per policy branch.
 *
 * The property under test is the whole reason this class exists. In split
 * Both mode the two STT keys share one `max_session_duration_seconds`, so
 * both legs take a 403 within the same second and both try to say "This
 * segment has ended". Whoever claims first owns the sentence; everyone
 * else is silent — including a DIFFERENT ending arriving in the same
 * instant, because a user cannot act on two contradictory reasons.
 */
describe('SonioxSessionOutcome', () => {
  it('starts unclaimed', () => {
    const o = new SonioxSessionOutcome();
    expect(o.isClaimed).toBe(false);
    expect(o.kind).toBeNull();
  });

  it('grants the claim to the first caller only', () => {
    const o = new SonioxSessionOutcome();
    expect(o.claim('duration_cutoff')).toBe(true);
    expect(o.claim('duration_cutoff')).toBe(false);
    expect(o.claim('duration_cutoff')).toBe(false);
  });

  it('remembers which kind won', () => {
    const o = new SonioxSessionOutcome();
    o.claim('budget_exhausted');
    expect(o.kind).toBe('budget_exhausted');
    expect(o.isClaimed).toBe(true);
  });

  it('refuses a SECOND, DIFFERENT ending — the first reason is the one the user acts on', () => {
    const o = new SonioxSessionOutcome();
    expect(o.claim('budget_exhausted')).toBe(true);
    // The granted duration lapsing a moment after the balance ran out must
    // not overwrite "top up your balance" with "tap Start to continue" —
    // the second sentence sends the user straight into a 402.
    expect(o.claim('duration_cutoff')).toBe(false);
    expect(o.kind).toBe('budget_exhausted');
  });
});
