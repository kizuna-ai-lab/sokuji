// When the account button names who pays, and when it shows the payer's icon instead (owner, 2026-11-17).
import { describe, it, expect } from 'vitest';
import { compactPayer } from './payerFit';

describe('the payer: its name while it fits, its icon when the title bar runs out of room', () => {
  it('keeps the name while the bar has room left', () => {
    expect(compactPayer(false, 0, 90, 14)).toBe(false);
    expect(compactPayer(false, 40, 90, 14)).toBe(false);
  });

  it('turns to the icon once the bar overflows with the name', () => {
    expect(compactPayer(false, -1, 90, 14)).toBe(true);
  });

  it('goes back to the name only when the room left takes it in the icon\'s place', () => {
    expect(compactPayer(true, 75, 90, 14)).toBe(true);
    expect(compactPayer(true, 76, 90, 14)).toBe(false);
  });
});
