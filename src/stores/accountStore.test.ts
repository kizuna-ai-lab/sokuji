import { describe, it, expect } from 'vitest';
import { useAccountStore } from './accountStore';

describe('useAccountStore', () => {
  it('holds nothing until told, then the account, and nothing again', () => {
    expect(useAccountStore.getState().account).toBeNull();

    useAccountStore.getState().setAccount({ status: 'known', balanceMicroUsd: 5, frozen: false });
    expect(useAccountStore.getState().account).toEqual({ status: 'known', balanceMicroUsd: 5, frozen: false });

    useAccountStore.getState().setAccount({ status: 'loading' });
    expect(useAccountStore.getState().account).toEqual({ status: 'loading' });

    useAccountStore.getState().setAccount(null);
    expect(useAccountStore.getState().account).toBeNull();
  });
});
