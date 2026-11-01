import { describe, it, expect } from 'vitest';
import { createLatest } from './latest';

describe('overlapping loads of one screen', () => {
  it('counts only the newest as current, so an older result is dropped', () => {
    const latest = createLatest();
    const first = latest.next();
    const second = latest.next();
    expect(latest.isCurrent(first)).toBe(false);
    expect(latest.isCurrent(second)).toBe(true);
  });

  it('retires the newest too once another starts', () => {
    const latest = createLatest();
    const a = latest.next();
    expect(latest.isCurrent(a)).toBe(true);
    latest.next();
    expect(latest.isCurrent(a)).toBe(false);
  });
});
