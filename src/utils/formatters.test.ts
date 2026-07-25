import { describe, it, expect } from 'vitest';
import { formatUsd } from './formatters';

describe('formatUsd', () => {
  it('renders micro-USD as a 2dp dollar string', () => {
    expect(formatUsd(3_420_000)).toBe('$3.42');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1_000_000)).toBe('$1.00');
  });

  it('keeps negative balances signed', () => {
    expect(formatUsd(-1_500_000)).toBe('$-1.50');
  });

  // QuotaData is built from an untyped JSON payload, and the call sites
  // (`quota.balance ?? 0`, `quota.balance || quota.remaining`) do not stop a
  // NaN — without the guard the balance UI rendered the literal "$NaN".
  it('renders non-finite input as $0.00 rather than $NaN', () => {
    expect(formatUsd(NaN)).toBe('$0.00');
    expect(formatUsd(Infinity)).toBe('$0.00');
    expect(formatUsd(-Infinity)).toBe('$0.00');
  });

  it('renders null / undefined as $0.00', () => {
    expect(formatUsd(null)).toBe('$0.00');
    expect(formatUsd(undefined)).toBe('$0.00');
  });

  it('rejects a non-number that would coerce (a string balance from bad JSON)', () => {
    expect(formatUsd('3420000' as unknown as number)).toBe('$0.00');
  });
});
