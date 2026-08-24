// src/components/TitleBar/compactBalance.test.ts
import { describe, it, expect } from 'vitest';
import { compactBalanceLabel } from './compactBalance';

describe('compactBalanceLabel', () => {
  it('renders whole cents floored, never rounded up', () => {
    expect(compactBalanceLabel(12_340_000)).toBe('$12.34');
    // 4.999 must not become $5.00 — the wallet does not hold $5.00.
    expect(compactBalanceLabel(4_999_000)).toBe('$4.99');
  });

  it('collapses anything under a cent to a bound, not a long decimal', () => {
    // The whole point: $0.001552 is 265px wider than $12.34 in the title bar.
    expect(compactBalanceLabel(1_552)).toBe('< $0.01');
    expect(compactBalanceLabel(9_999)).toBe('< $0.01');
  });

  it('shows exactly zero as zero, not as "less than a cent"', () => {
    expect(compactBalanceLabel(0)).toBe('$0.00');
  });

  it('keeps a negative balance negative and floored away from zero', () => {
    // Charging is post-paid, so a session can overrun the balance.
    expect(compactBalanceLabel(-30_000)).toBe('-$0.03');
    expect(compactBalanceLabel(-1_552)).toBe('-$0.01');
  });

  // This used to return '$0.00' for an absent balance, which is how signing in
  // produced a title bar reading $0.00 before the wallet had loaded — the one
  // number a user is guaranteed to misread, and the reading is "I am broke".
  // Not knowing yet is not a balance, so it gets no label at all.
  it('reports no label when the balance is not known yet', () => {
    expect(compactBalanceLabel(null)).toBeNull();
    expect(compactBalanceLabel(undefined)).toBeNull();
    expect(compactBalanceLabel(NaN)).toBeNull();
  });

  // A wallet that really is empty still says so.
  it('still shows an actual zero balance', () => {
    expect(compactBalanceLabel(0)).toBe('$0.00');
  });
});
