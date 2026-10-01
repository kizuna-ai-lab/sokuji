// The start gate reads the wallet outside React through a small store
// (Stage 2 Kizuna Soniox, ruling 5): loading while the first fetch is in
// flight, unknown once a fetch failed with no wallet known, else the wallet
// as last fetched — and the way back from an offline launch, a re-fetch on
// `online` and a bounded back-off, so Start does not stay refused until the
// 5-minute poll finds its way back on its own.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { useAccountStore } from '../stores/accountStore';

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

// The context's own read of the run phase pulls the whole root module graph
// (getAppSession()); mocked here since the `utils/environment` mock above is
// total and the root's graph reads it. Mutable so the interval test below can
// move it between 'idle' and 'running'.
let runPhase: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
vi.mock('../app/useRun', () => ({ useRunPhase: () => runPhase }));

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
  runPhase = 'idle';
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => walletBody,
  })));
  // Also resets the account store (brief step 1): a prior test's wallet must
  // not leak into the next one.
  useAccountStore.setState({ account: null });
});

afterEach(() => { vi.useRealTimers(); });

const load = async () => {
  const mod = await import('./UserProfileContext');
  return mod;
};

const wrap = (UserProfileProvider: React.ComponentType<{ children: React.ReactNode }>) =>
  ({ children }: { children: React.ReactNode }) => React.createElement(UserProfileProvider, null, children);

describe('UserProfileContext writes the account store (Stage 2 Kizuna Soniox, ruling 5)', () => {
  it('is loading while the first fetch is in flight, known once it lands, and nothing on sign-out', async () => {
    let answer!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      answer = () => resolve({ ok: true, status: 200, json: async () => walletBody });
    })));
    const { UserProfileProvider, useUserProfile } = await load();
    const { rerender } = renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });

    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'loading' }));

    answer();
    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'known', balanceMicroUsd: 12_340_000, frozen: false }));

    signedIn = false;
    userId = undefined;
    rerender();
    await waitFor(() => expect(useAccountStore.getState().account).toBeNull());
  });

  it('is unknown when the fetch fails and no wallet is known', async () => {
    const { UserProfileProvider, useUserProfile } = await load();
    const wrapper = wrap(UserProfileProvider);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    renderHook(() => useUserProfile(), { wrapper });
    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'unknown' }));

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) })));
    renderHook(() => useUserProfile(), { wrapper });
    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'unknown' }));
  });

  it('re-fetches when the browser comes back online', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => walletBody });
    vi.stubGlobal('fetch', fetchMock);
    const { UserProfileProvider, useUserProfile } = await load();
    renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });

    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'unknown' }));

    act(() => { window.dispatchEvent(new Event('online')); });

    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'known', balanceMicroUsd: 12_340_000, frozen: false }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-fetches an unknown wallet after 15, 30 and 60 s, then leaves it to the 5-minute poll', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await load();
    const { UserProfileProvider, useUserProfile } = mod;
    renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().account).toEqual({ status: 'unknown' });

    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 105s elapsed so far; +100s = 205s: no timer due until the 5-minute poll.
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // +95s = 300s: the 5-minute poll's first tick.
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    expect(mod.WALLET_RETRY_DELAYS_MS).toEqual([15_000, 30_000, 60_000]);
  });

  it('stops retrying once the wallet is known, and on sign-out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => walletBody });
    vi.stubGlobal('fetch', fetchMock);
    const { UserProfileProvider, useUserProfile } = await load();
    renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(useAccountStore.getState().account).toEqual({ status: 'unknown' });

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAccountStore.getState().account).toEqual({ status: 'known', balanceMicroUsd: 12_340_000, frozen: false });

    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The sign-out half needs its own render, whose first fetch fails, so a
    // back-off is actually pending (15 s, 45 s and 105 s timers armed) when
    // it signs out — the render above is already `known`, with no timer left
    // to interrupt, so reusing it would prove nothing (review Important 1).
    const failingFetch = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', failingFetch);
    const { rerender } = renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(useAccountStore.getState().account).toEqual({ status: 'unknown' });
    expect(failingFetch).toHaveBeenCalledTimes(1);

    signedIn = false;
    userId = undefined;
    await act(async () => { rerender(); await vi.advanceTimersByTimeAsync(0); });
    expect(useAccountStore.getState().account).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(105_000); });
    expect(failingFetch).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(failingFetch).toHaveBeenCalledTimes(1);
  });

  it('clears it when the provider unmounts', async () => {
    const { UserProfileProvider, useUserProfile } = await load();
    const { unmount } = renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });

    await waitFor(() => expect(useAccountStore.getState().account).toEqual({ status: 'known', balanceMicroUsd: 12_340_000, frozen: false }));

    unmount();
    expect(useAccountStore.getState().account).toBeNull();
  });

  it('unmounting during the back-off also clears its timers and its online listener', async () => {
    vi.useFakeTimers();
    const failingFetch = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', failingFetch);
    const { UserProfileProvider, useUserProfile } = await load();
    const { unmount } = renderHook(() => useUserProfile(), { wrapper: wrap(UserProfileProvider) });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(failingFetch).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(105_000); });
    expect(failingFetch).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0); });
    expect(failingFetch).toHaveBeenCalledTimes(1);
  });
});
