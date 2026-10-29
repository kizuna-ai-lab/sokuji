import { describe, it, expect } from 'vitest';
import { hoursLeft, formatHours } from './hours';

// The website's billing page, mirrored: the balance at the account's own
// 30-day rate, or at the calculator's opening preset without one; shown
// rounded down, so the estimate never promises the last partial hour.
describe('hoursLeft', () => {
  it('divides the balance by the account\'s own rate', () => {
    expect(hoursLeft(12, 1.5, 4)).toBe(8);
  });
  it('falls back to the preset rate without a personal one', () => {
    expect(hoursLeft(12, null, 4)).toBe(3);
  });
  it('is never negative', () => {
    expect(hoursLeft(-2, 1, 4)).toBe(0);
  });
});

describe('formatHours', () => {
  it.each([
    [0.4, '< 1'],
    [2.53, '2.5'],
    [12.4, '12'],
    [0, '0'],
    [9.99, '9.9'],
  ])('%s → %s', (hours, shown) => {
    expect(formatHours(hours)).toBe(shown);
  });
});

describe('non-finite input', () => {
  it('is treated as nothing, never shown as NaN', () => {
    expect(hoursLeft(Number.NaN, 2, 1)).toBe(0);
    expect(formatHours(Number.NaN)).toBe('0');
    expect(formatHours(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
