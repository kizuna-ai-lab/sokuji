// A response must not outlive the session it was asked for.
//
// Both quota fetches call setQuota unconditionally after their await. If the
// user signs out while one is in flight, the effect clears the quota and the
// late response puts it straight back — so the next sign-in, especially to a
// different account, renders the previous account's balance. That balance also
// gates managed sessions, so this is not only a display problem.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';

let signedIn = true;
let userId: string | undefined = 'u1';
vi.mock('../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn, userId, getToken: async () => 'tok' }),
  useUser: () => ({
    isLoaded: true,
    user: signedIn ? { id: userId, email: 'you@example.com' } : null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../utils/environment', () => ({
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
  isElectron: () => false,
  isExtension: () => false,
}));
vi.mock('../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));

const wallet = (balance: number) => ({
  balanceMicroUsd: balance,
  last30DaysUsageMicroUsd: 0,
  frozen: false,
});

// A fetch whose completion we decide.
let releaseFetch: (body: unknown) => void = () => {};
const suspendedFetch = () =>
  new Promise((resolve) => {
    releaseFetch = (body) => resolve({ ok: true, status: 200, json: async () => body });
  });

beforeEach(() => {
  signedIn = true;
  userId = 'u1';
  releaseFetch = () => {};
});

const load = async () => import('./UserProfileContext');

const mount = async () => {
  const { UserProfileProvider, useUserProfile } = await load();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(UserProfileProvider, null, children);
  return renderHook(() => useUserProfile(), { wrapper });
};

describe('a quota response that outlived its session', () => {
  it('is discarded when the user has signed out meanwhile', async () => {
    vi.stubGlobal('fetch', vi.fn(suspendedFetch));
    const { result, rerender } = await mount();

    // Sign out while the request is still out.
    signedIn = false;
    userId = undefined;
    rerender();
    await waitFor(() => expect(result.current.quota).toBeNull());

    // The request now comes back, for a session that no longer exists.
    await act(async () => { releaseFetch(wallet(12_340_000)); });

    expect(result.current.quota).toBeNull();
  });

  it('is discarded when a different account has signed in meanwhile', async () => {
    vi.stubGlobal('fetch', vi.fn(suspendedFetch));
    const { result, rerender } = await mount();

    // u1's request is in flight; u2 signs in.
    const firstRelease = releaseFetch;
    userId = 'u2';
    rerender();

    // u1's response arrives late. It must not become u2's balance.
    await act(async () => { firstRelease(wallet(99_000_000)); });

    expect(result.current.quota?.balance).not.toBe(99_000_000);
  });

  // The guard must not reject responses that are still valid.
  it('accepts the response for the session that is still current', async () => {
    vi.stubGlobal('fetch', vi.fn(suspendedFetch));
    const { result } = await mount();

    await act(async () => { releaseFetch(wallet(12_340_000)); });

    await waitFor(() => expect(result.current.quota?.balance).toBe(12_340_000));
  });
});
