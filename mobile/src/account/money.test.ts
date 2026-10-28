import { describe, it, expect } from 'vitest';
import { formatUsd } from './money';

// The website's money-format rule (web/src/lib/money-format.ts in the backend
// repo), restated here as the same case table: a fixed two decimals deleted
// every usage row's amount, so the precision follows the magnitude.
describe('formatUsd', () => {
  it('keeps two decimals from a dollar up, and for zero', () => {
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(1)).toBe('$1.00');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('shows four decimals from a cent up, six below', () => {
    expect(formatUsd(0.0265)).toBe('$0.0265');
    expect(formatUsd(0.001552)).toBe('$0.001552');
  });

  it('signs a negative amount after formatting, never a zero', () => {
    expect(formatUsd(-2.5)).toBe('-$2.50');
    expect(formatUsd(-0.001552)).toBe('-$0.001552');
    expect(formatUsd(-0.0000001)).toBe('$0.000000');
  });

  it('shows a dash for an amount it does not have', () => {
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});
