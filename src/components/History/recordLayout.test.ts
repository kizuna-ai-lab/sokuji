import { describe, it, expect } from 'vitest';
import { THREE_COLUMNS_PX, TWO_COLUMNS_PX, layoutFor } from './recordLayout';

// Owner, 2026-11-19: three columns where the page has room for the notes, the transcript and the edit panel at their
// narrowest; two where it has room for one of them beside the transcript; tabs only where even two do not fit.
describe('the record page\'s layout for its width', () => {
  it('has room for three columns from the three at their narrowest, with their dividers', () => {
    expect(THREE_COLUMNS_PX).toBe(240 + 1 + 400 + 1 + 240);
    expect(layoutFor(882)).toBe('three');
    expect(layoutFor(1400)).toBe('three');
  });

  it('has room for two columns from the transcript and one panel at their narrowest', () => {
    expect(TWO_COLUMNS_PX).toBe(240 + 1 + 400);
    expect(layoutFor(881)).toBe('two');
    expect(layoutFor(760)).toBe('two');
    expect(layoutFor(641)).toBe('two');
  });

  it('is tabs below that, and before the page is measured', () => {
    expect(layoutFor(640)).toBe('tabs');
    expect(layoutFor(375)).toBe('tabs');
    expect(layoutFor(0)).toBe('tabs');
  });
});
