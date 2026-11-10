import { describe, expect, it } from 'vitest';
import { orgHeldMicroUsd, orgNoticeParams } from './orgNotice';
import type { AccountState } from './types';

const account = (organization: { name: string; role?: 'owner' | 'member' } | undefined): AccountState => ({
  status: 'known', balanceMicroUsd: 0, frozen: false,
  ...(organization ? { organization: { ...organization, availableMicroUsd: 0, frozen: false } } : {}),
});

describe('orgNoticeParams', () => {
  it('names the organization and the role', () => {
    expect(orgNoticeParams(account({ name: 'Acme', role: 'owner' }))).toEqual({ organization: 'Acme', role: 'owner' });
  });

  it('keeps the role when the name is empty, so an owner still gets the owner wording', () => {
    expect(orgNoticeParams(account({ name: '', role: 'owner' }))).toEqual({ role: 'owner' });
  });

  it('has nothing for a stale quota without an organization, or one with neither name nor role', () => {
    expect(orgNoticeParams(account(undefined))).toBeUndefined();
    expect(orgNoticeParams(account({ name: '' }))).toBeUndefined();
    expect(orgNoticeParams(null)).toBeUndefined();
  });
});

describe('orgHeldMicroUsd', () => {
  it('is committed less available, never below 0, and 0 without a committed figure', () => {
    expect(orgHeldMicroUsd({ availableMicroUsd: 2_000_000, committedBalanceMicroUsd: 5_000_000 })).toBe(3_000_000);
    expect(orgHeldMicroUsd({ availableMicroUsd: 5_000_000, committedBalanceMicroUsd: 5_000_000 })).toBe(0);
    expect(orgHeldMicroUsd({ availableMicroUsd: 6_000_000, committedBalanceMicroUsd: 5_000_000 })).toBe(0);
    expect(orgHeldMicroUsd({ availableMicroUsd: 2_000_000 })).toBe(0);
  });
});
