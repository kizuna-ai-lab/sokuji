import { describe, it, expect } from 'vitest';
import { mapWalletStatusToQuota, isWalletStatus } from './walletQuota';

describe('mapWalletStatusToQuota', () => {
  it('maps the backend wallet status into QuotaData with a DEFINED balance', () => {
    const q = mapWalletStatusToQuota({ balance: 1000, frozen: false, usage: 50 });
    // The bug that disabled the Start button: quota lacked a `balance` field,
    // so hasValidBalance (which requires quota.balance !== undefined) was false.
    expect(q.balance).toBe(1000);
    expect(q.balance).not.toBeUndefined();
    expect(q.frozen).toBe(false);
    expect(q.total).toBe(1000);
    expect(q.remaining).toBe(1000);
    expect(q.last30DaysUsage).toBe(50);
  });

  it('reports zero remaining when the wallet is frozen', () => {
    const q = mapWalletStatusToQuota({ balance: 1000, frozen: true, usage: 0 });
    expect(q.frozen).toBe(true);
    expect(q.remaining).toBe(0);
    expect(q.balance).toBe(1000);
  });

  it('keeps a zero balance defined (new wallets) so the gate can pass', () => {
    const q = mapWalletStatusToQuota({ balance: 0, frozen: false, usage: 0 });
    expect(q.balance).toBe(0);
    expect(q.balance !== undefined && q.balance >= 0 && !q.frozen).toBe(true);
  });

  it('throws on a malformed payload so callers fail closed', () => {
    // Each of these is a realistic backend drift: missing field, null, wrong
    // type, or NaN. A throw keeps the gate disabled rather than producing a
    // quota with an undefined/NaN balance.
    const bad: unknown[] = [
      undefined,
      null,
      {},
      { balance: 1000, frozen: false },                 // missing usage
      { balance: '1000', frozen: false, usage: 0 },     // balance not a number
      { balance: 1000, frozen: 'no', usage: 0 },        // frozen not a boolean
      { balance: NaN, frozen: false, usage: 0 },         // non-finite balance
      { balance: 1000, frozen: false, usage: null },    // usage null
    ];
    for (const payload of bad) {
      expect(() => mapWalletStatusToQuota(payload)).toThrow('Invalid wallet status payload');
    }
  });

  it('reads balanceMicroUsd when the backend sends the new shape', () => {
    const q = mapWalletStatusToQuota({
      balanceMicroUsd: 3_420_000,
      balanceUsd: '3.42',
      frozen: false,
      last30DaysUsageMicroUsd: 1_580_000,
      last30DaysUsageUsd: '1.58',
      rates: { 'soniox:text_only': 0.6 },
      balance: 3_420_000,
      usage: 1_580_000,
    });
    expect(q.balance).toBe(3_420_000);
    expect(q.remaining).toBe(3_420_000);
    expect(q.last30DaysUsage).toBe(1_580_000);
  });

  it('still accepts the legacy shape from an older backend', () => {
    const q = mapWalletStatusToQuota({ balance: 500, frozen: false, usage: 10 });
    expect(q.balance).toBe(500);
  });
});

describe('isWalletStatus', () => {
  it('accepts a well-formed payload', () => {
    expect(isWalletStatus({ balance: 0, frozen: false, usage: 0 })).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isWalletStatus(null)).toBe(false);
    expect(isWalletStatus({ balance: 1, frozen: false })).toBe(false);
    expect(isWalletStatus({ balance: Infinity, frozen: false, usage: 0 })).toBe(false);
  });
});
