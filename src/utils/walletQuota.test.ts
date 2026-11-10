import { describe, it, expect } from 'vitest';
import { mapWalletStatusToQuota, isWalletStatus } from './walletQuota';
import * as report from '../lib/diagnostics/report';
import { vi } from 'vitest';

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

  it('reads balanceMicroUsd when the backend sends ONLY the new shape (no legacy aliases)', () => {
    // No `balance` / `usage` keys at all — this is what proves the new field
    // names are actually read, rather than the mapper falling through to
    // legacy aliases that happen to carry identical values.
    const q = mapWalletStatusToQuota({
      balanceMicroUsd: 3_420_000,
      balanceUsd: '3.42',
      frozen: false,
      last30DaysUsageMicroUsd: 1_580_000,
      last30DaysUsageUsd: '1.58',
      rates: { 'soniox:text_only': 0.6 },
    });
    expect(q.balance).toBe(3_420_000);
    expect(q.remaining).toBe(3_420_000);
    expect(q.last30DaysUsage).toBe(1_580_000);
  });

  // THE SHAPE THE BACKEND ACTUALLY RETURNS TODAY: buildWalletStatus emits the
  // new fields AND the deprecated `balance`/`usage` aliases, carrying identical
  // values. With both present and equal, no assertion on the RESULT can tell
  // which field was read — so this pins the precedence at the mapper's own
  // `??` chain by asserting the new field wins when the two disagree, and
  // separately that the realistic equal-valued payload maps correctly.
  it('reads the new fields from the MIXED payload the backend sends today', () => {
    const q = mapWalletStatusToQuota({
      balanceMicroUsd: 3_420_000,
      balanceUsd: '3.42',
      frozen: false,
      last30DaysUsageMicroUsd: 1_580_000,
      last30DaysUsageUsd: '1.58',
      rates: { 'soniox:text_only': 0.6 },
      // Deprecated aliases, same values — exactly what ships today.
      balance: 3_420_000,
      usage: 1_580_000,
    });
    expect(q.balance).toBe(3_420_000);
    expect(q.remaining).toBe(3_420_000);
    expect(q.total).toBe(3_420_000);
    expect(q.last30DaysUsage).toBe(1_580_000);
    expect(q.used).toBe(1_580_000);
  });

  it('prefers the new fields over the legacy aliases when they disagree', () => {
    // Not a payload the backend sends, but the only way to prove which field
    // the mapper actually reads. If the `??` order regressed to legacy-first,
    // this returns the stale alias values.
    const q = mapWalletStatusToQuota({
      balanceMicroUsd: 3_420_000,
      frozen: false,
      last30DaysUsageMicroUsd: 1_580_000,
      balance: 11,
      usage: 22,
    });
    expect(q.balance).toBe(3_420_000);
    expect(q.last30DaysUsage).toBe(1_580_000);
  });

  it('reads a zero new-field balance rather than falling through to a non-zero alias', () => {
    // `??` (not `||`) matters here: a 0 balance is a real value, so a funded
    // legacy alias must not shadow it.
    const q = mapWalletStatusToQuota({
      balanceMicroUsd: 0,
      frozen: false,
      last30DaysUsageMicroUsd: 0,
      balance: 9_999_999,
      usage: 5,
    });
    expect(q.balance).toBe(0);
    expect(q.last30DaysUsage).toBe(0);
  });

  it('still accepts the legacy-only shape from an older backend (no new fields)', () => {
    const q = mapWalletStatusToQuota({ balance: 500, frozen: false, usage: 10 });
    expect(q.balance).toBe(500);
    expect(q.remaining).toBe(500);
    expect(q.last30DaysUsage).toBe(10);
  });

  it('throws when a payload carries neither the new nor legacy money fields', () => {
    // Trust boundary: the payload is untyped JSON. If both money fields are
    // absent, mapping must fail closed rather than produce a QuotaData with
    // an undefined/NaN balance, which would silently disable the Start
    // button's hasValidBalance gate for every user.
    const payload = {
      frozen: false,
      balanceUsd: '0.00',
      last30DaysUsageUsd: '0.00',
      rates: {},
    };
    expect(() => mapWalletStatusToQuota(payload)).toThrow('Invalid wallet status payload');
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

describe('mapWalletStatusToQuota organization fields', () => {
  const expiring = { microUsd: 200, usd: '0.0002', microUsdAtEarliest: 100, usdAtEarliest: '0.0001', expiresAt: 1_800_000_000_000 };
  const member = {
    balanceMicroUsd: 5_000_000,
    frozen: false,
    expiringSoon: false,
    last30DaysUsageMicroUsd: 70,
    organization: { id: 'org_1', name: 'Acme', availableMicroUsd: 5_000_000, frozen: false, role: 'member' },
    personal: { balanceMicroUsd: 300, frozen: true, expiringSoon: expiring },
  };

  it('maps organization and personal objects for a member payload', () => {
    const q = mapWalletStatusToQuota(member);
    expect(q.organization).toEqual({ id: 'org_1', name: 'Acme', availableMicroUsd: 5_000_000, frozen: false, role: 'member' });
    expect(q.personal).toEqual({ balanceMicroUsd: 300, frozen: true, expiringSoon: expiring });
  });

  it('keeps top-level balance as the organization available balance', () => {
    const q = mapWalletStatusToQuota(member);
    expect(q.balance).toBe(5_000_000);
    expect(q.remaining).toBe(5_000_000);
    expect(q.frozen).toBe(false);
  });

  it('carries committedBalanceMicroUsd when it is a finite number, and omits it otherwise', () => {
    const withIt = mapWalletStatusToQuota({ ...member, organization: { ...member.organization, committedBalanceMicroUsd: 8_000_000 } });
    expect(withIt.organization?.committedBalanceMicroUsd).toBe(8_000_000);
    expect(withIt.organization?.availableMicroUsd).toBe(5_000_000);
    const without = mapWalletStatusToQuota(member);
    expect(without.organization).toBeDefined();
    expect('committedBalanceMicroUsd' in without.organization!).toBe(false);
  });

  it('treats a malformed committedBalanceMicroUsd as absent without dropping the organization', () => {
    for (const bad of ['8', NaN, Infinity, null, {}]) {
      const q = mapWalletStatusToQuota({ ...member, organization: { ...member.organization, committedBalanceMicroUsd: bad } });
      expect(q.organization).toBeDefined();
      expect(q.organization?.committedBalanceMicroUsd).toBeUndefined();
      expect(q.organization?.availableMicroUsd).toBe(5_000_000);
    }
  });

  it('accepts the owner role', () => {
    const q = mapWalletStatusToQuota({ ...member, organization: { ...member.organization, role: 'owner' } });
    expect(q.organization?.role).toBe('owner');
  });

  it('maps an old payload exactly as before (snapshot)', () => {
    const q = mapWalletStatusToQuota({ balance: 1000, frozen: false, usage: 50 });
    expect(q).toStrictEqual({
      balance: 1000,
      frozen: false,
      last30DaysUsage: 50,
      total: 1000,
      used: 50,
      remaining: 1000,
      resetDate: null,
      plan: 'free',
    });
    expect('organization' in q).toBe(false);
    expect('personal' in q).toBe(false);
  });

  it('drops a malformed organization or personal object without throwing', () => {
    const badOrgs: unknown[] = [
      null, 'x', 5,
      { ...member.organization, id: 1 },
      { ...member.organization, name: undefined },
      { ...member.organization, availableMicroUsd: '5' },
      { ...member.organization, availableMicroUsd: NaN },
      { ...member.organization, frozen: 'no' },
      { ...member.organization, role: 'admin' },
    ];
    for (const organization of badOrgs) {
      const q = mapWalletStatusToQuota({ ...member, organization });
      expect(q.organization).toBeUndefined();
      expect(q.personal).toBeDefined();
      expect(q.balance).toBe(5_000_000);
    }
    const badPersonals: unknown[] = [
      null, [], { balanceMicroUsd: '1', frozen: false, expiringSoon: null },
      { balanceMicroUsd: 1, frozen: 0, expiringSoon: null },
      { frozen: false, expiringSoon: null },
    ];
    for (const personal of badPersonals) {
      const q = mapWalletStatusToQuota({ ...member, personal });
      expect(q.personal).toBeUndefined();
      expect(q.organization).toBeDefined();
    }
    expect(isWalletStatus({ ...member, organization: 7, personal: 'x' })).toBe(true);
  });

  it('keeps personal with expiringSoon null, absent, or malformed (field becomes null)', () => {
    const base = { balanceMicroUsd: 300, frozen: false };
    const cases: unknown[] = [
      { ...base, expiringSoon: null },
      base,
      { ...base, expiringSoon: undefined },
      { ...base, expiringSoon: 'soon' },
      { ...base, expiringSoon: true },
      { ...base, expiringSoon: { ...expiring, expiresAt: 'x' } },
    ];
    for (const personal of cases) {
      const q = mapWalletStatusToQuota({ ...member, personal });
      expect(q.personal).toEqual({ balanceMicroUsd: 300, frozen: false, expiringSoon: null });
    }
  });
});

describe('mapWalletStatusToQuota: organization and personal drift', () => {
  const base = { balance: 1000, frozen: false, usage: 0 };
  const org = { id: 'o1', name: 'Acme', availableMicroUsd: 5, frozen: false, role: 'member' };

  it('keeps a well-formed organization without warning', () => {
    const warn = vi.spyOn(report, 'reportWarning').mockImplementation(() => {});
    expect(mapWalletStatusToQuota({ ...base, organization: org }).organization).toMatchObject({ role: 'member' });
    expect(mapWalletStatusToQuota({ ...base, organization: { ...org, role: 'owner' } }).organization).toMatchObject({ role: 'owner' });
    expect(mapWalletStatusToQuota(base).organization).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops a present-but-malformed organization (an unknown role) and warns with a dedupe key', () => {
    const warn = vi.spyOn(report, 'reportWarning').mockImplementation(() => {});
    expect(mapWalletStatusToQuota({ ...base, organization: { ...org, role: 'admin' } }).organization).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][2]).toMatchObject({ dedupeKey: expect.any(String) });
    warn.mockRestore();
  });

  it('drops a present-but-malformed personal and warns with a dedupe key', () => {
    const warn = vi.spyOn(report, 'reportWarning').mockImplementation(() => {});
    expect(mapWalletStatusToQuota({ ...base, personal: { balanceMicroUsd: 'x', frozen: false } }).personal).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][2]).toMatchObject({ dedupeKey: expect.any(String) });
    warn.mockRestore();
  });
});
