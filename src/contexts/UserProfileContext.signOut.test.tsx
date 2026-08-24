// Signing out has to clear the quota, and until now it did not.
//
// fetchQuota() already contains the branch that clears it when signed out,
// but the effect that calls fetchQuota reads `if (isSignedIn && userId)` — so
// on sign-out the call never happens and the branch is unreachable. The stale
// balance simply stayed on screen, which is the reason sign-out reached for
// window.location.reload() in the first place.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

let signedIn = true;
let userId: string | undefined = 'u1';
vi.mock('../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn, userId, getToken: async () => 'tok' }),
  useUser: () => ({
    isLoaded: true,
    user: signedIn ? { id: 'u1', email: 'you@example.com' } : null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../utils/environment', () => ({
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
  isElectron: () => false,
  isExtension: () => false,
}));

vi.mock('../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));

// Shaped to satisfy isWalletStatus: `frozen` is required, and one of the two
// money-field spellings must be a finite number. A payload that fails the guard
// makes fetchQuota throw and leave the quota null, which would make the
// assertion below pass for entirely the wrong reason.
const walletBody = {
  balanceMicroUsd: 12_340_000,
  last30DaysUsageMicroUsd: 3_420_000,
  frozen: false,
};

beforeEach(() => {
  signedIn = true;
  userId = 'u1';
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => walletBody,
  })));
});

const load = async () => {
  const mod = await import('./UserProfileContext');
  return mod;
};

describe('UserProfileContext on sign-out', () => {
  it('clears the quota when the user signs out', async () => {
    const { UserProfileProvider, useUserProfile } = await load();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UserProfileProvider, null, children);

    const { result, rerender } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.quota).not.toBeNull());

    signedIn = false;
    userId = undefined;
    rerender();

    await waitFor(() => expect(result.current.quota).toBeNull());
  });
});
