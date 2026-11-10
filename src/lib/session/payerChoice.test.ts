import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chosenPayer, getUseOwnBalance, setUseOwnBalance, useAccountPayer, subscribeUseOwnBalance, USE_OWN_BALANCE_KEY } from './payerChoice';
import { payerBalance } from './orgNotice';
import type { AccountState } from './types';

const member = {
  organization: { name: 'Acme', availableMicroUsd: 7_000_000, frozen: false },
  personal: { balanceMicroUsd: 3_000_000, frozen: false },
};
const known = (over: Partial<Extract<AccountState, { status: 'known' }>> = {}): Extract<AccountState, { status: 'known' }> =>
  ({ status: 'known', balanceMicroUsd: 7_000_000, frozen: false, ...member, ...over });

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // A successful write also drops a choice an earlier test left in memory.
  setUseOwnBalance(false);
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

  it('keeps the choice in memory when the storage cannot hold it, and tells subscribers', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const listener = vi.fn();
    const off = subscribeUseOwnBalance(listener);
    setUseOwnBalance(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getUseOwnBalance()).toBe(true);
    expect(chosenPayer(member)).toBe('personal');
    setUseOwnBalance(false);
    expect(getUseOwnBalance()).toBe(false);
    off();
    get.mockRestore();
    set.mockRestore();
  });

  it('a write that fails while reads work (a full storage) still turns the switch on', () => {
    localStorage.setItem(USE_OWN_BALANCE_KEY, 'false');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    setUseOwnBalance(true);
    expect(getUseOwnBalance()).toBe(true);
    set.mockRestore();
    // Once a write works again, the storage is the source again.
    setUseOwnBalance(false);
    expect(localStorage.getItem(USE_OWN_BALANCE_KEY)).toBe('false');
    localStorage.setItem(USE_OWN_BALANCE_KEY, 'true');
    expect(getUseOwnBalance()).toBe(true);
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
    expect(payerBalance({ status: 'known', balanceMicroUsd: 42, frozen: true }, undefined)).toEqual({ microUsd: 42, frozen: true });
  });

  it('is the wallet of the payer it is given, never the live switch', () => {
    setUseOwnBalance(true);
    expect(payerBalance(known(), 'organization')).toEqual({ microUsd: 7_000_000, frozen: false });
    setUseOwnBalance(false);
    expect(payerBalance(known(), 'personal')).toEqual({ microUsd: 3_000_000, frozen: false });
    expect(payerBalance(known({ personal: { balanceMicroUsd: 1, frozen: true } }), 'personal')).toEqual({ microUsd: 1, frozen: true });
  });

  it('has no balance for a personal payer whose wallet the account does not hold, and does not call it frozen', () => {
    expect(payerBalance(known({ personal: undefined }), 'personal')).toEqual({ microUsd: undefined, frozen: false });
  });
});

describe('a choice kept in memory, and other documents', () => {
  const failWrites = () => vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });

  it('is kept when another document clears the storage or removes the key', () => {
    failWrites();
    setUseOwnBalance(true);
    expect(getUseOwnBalance()).toBe(true);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(getUseOwnBalance()).toBe(true);
    window.dispatchEvent(new StorageEvent('storage', { key: USE_OWN_BALANCE_KEY, newValue: null }));
    expect(getUseOwnBalance()).toBe(true);
  });

  it('gives way when another document writes a value for the key', () => {
    const set = failWrites();
    setUseOwnBalance(true);
    set.mockRestore();
    localStorage.setItem(USE_OWN_BALANCE_KEY, 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: USE_OWN_BALANCE_KEY, newValue: 'false' }));
    expect(getUseOwnBalance()).toBe(false);
  });
});

describe('the switch across documents', () => {
  const fire = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));

  it("tells a subscriber when another document changes the switch's key", () => {
    const listener = vi.fn();
    const off = subscribeUseOwnBalance(listener);
    localStorage.setItem(USE_OWN_BALANCE_KEY, 'true');
    fire(USE_OWN_BALANCE_KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getUseOwnBalance()).toBe(true);
    off();
  });

  it('tells it when storage is cleared, and ignores other keys', () => {
    const listener = vi.fn();
    const off = subscribeUseOwnBalance(listener);
    fire('something.else');
    expect(listener).not.toHaveBeenCalled();
    fire(null);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('stops listening once unsubscribed', () => {
    const listener = vi.fn();
    subscribeUseOwnBalance(listener)();
    fire(USE_OWN_BALANCE_KEY);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('useAccountPayer', () => {
  it('follows the switch for a member, and is none for a non-member or an unknown wallet', () => {
    const { result } = renderHook(() => useAccountPayer(known()));
    expect(result.current).toBe('organization');
    act(() => setUseOwnBalance(true));
    expect(result.current).toBe('personal');
    expect(renderHook(() => useAccountPayer({ status: 'known', balanceMicroUsd: 1, frozen: false })).result.current).toBeUndefined();
    expect(renderHook(() => useAccountPayer({ status: 'loading' })).result.current).toBeUndefined();
  });
});
