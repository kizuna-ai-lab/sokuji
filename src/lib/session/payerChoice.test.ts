import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chosenPayer, getUseOwnBalance, payerBalance, setUseOwnBalance, USE_OWN_BALANCE_KEY } from './payerChoice';
import type { AccountState } from './types';

const member = {
  organization: { name: 'Acme', availableMicroUsd: 7_000_000, frozen: false },
  personal: { balanceMicroUsd: 3_000_000, frozen: false },
};
const known = (over: Partial<Extract<AccountState, { status: 'known' }>> = {}): Extract<AccountState, { status: 'known' }> =>
  ({ status: 'known', balanceMicroUsd: 7_000_000, frozen: false, ...member, ...over });

beforeEach(() => {
  localStorage.clear();
});

describe('the switch', () => {
  it('is off by default, and remembered under its key', () => {
    expect(getUseOwnBalance()).toBe(false);
    setUseOwnBalance(true);
    expect(localStorage.getItem('sokuji.payer.useOwnBalance')).toBe('true');
    expect(USE_OWN_BALANCE_KEY).toBe('sokuji.payer.useOwnBalance');
    expect(getUseOwnBalance()).toBe(true);
    setUseOwnBalance(false);
    expect(getUseOwnBalance()).toBe(false);
  });

  it('survives a reload: a fresh module reads what the storage holds', async () => {
    setUseOwnBalance(true);
    vi.resetModules();
    const fresh = await import('./payerChoice');
    expect(fresh.getUseOwnBalance()).toBe(true);
  });

  it('reads off when the storage throws, and a failed write throws nothing', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(getUseOwnBalance()).toBe(false);
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => setUseOwnBalance(true)).not.toThrow();
    set.mockRestore();
  });
});

describe('chosenPayer', () => {
  it('is undefined for a non-member, whatever the switch says', () => {
    expect(chosenPayer({})).toBeUndefined();
    expect(chosenPayer(null)).toBeUndefined();
    setUseOwnBalance(true);
    expect(chosenPayer({})).toBeUndefined();
  });

  it('is the organization for a member with the switch off, and personal with it on', () => {
    expect(chosenPayer(member)).toBe('organization');
    setUseOwnBalance(true);
    expect(chosenPayer(member)).toBe('personal');
  });
});

describe('payerBalance', () => {
  it("is today's top-level wallet for a non-member", () => {
    expect(payerBalance({ status: 'known', balanceMicroUsd: 42, frozen: true })).toEqual({ microUsd: 42, frozen: true });
  });

  it('is the wallet the chosen payer spends for a member', () => {
    expect(payerBalance(known())).toEqual({ microUsd: 7_000_000, frozen: false });
    setUseOwnBalance(true);
    expect(payerBalance(known())).toEqual({ microUsd: 3_000_000, frozen: false });
    expect(payerBalance(known({ personal: { balanceMicroUsd: 1, frozen: true } }))).toEqual({ microUsd: 1, frozen: true });
  });
});
