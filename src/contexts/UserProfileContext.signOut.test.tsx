// Signing out has to clear the quota, and until now it did not.
//
// fetchQuota() already contains the branch that clears it when signed out,
// but the effect that calls fetchQuota reads `if (isSignedIn && userId)` — so
// on sign-out the call never happens and the branch is unreachable. The stale
// balance simply stayed on screen, which is the reason sign-out reached for
// window.location.reload() in the first place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
});

afterEach(() => { vi.useRealTimers(); });

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

describe('UserProfileContext quota poll interval', () => {
  // Session-aware polling used to read sessionStore.isSessionActive; it now
  // reads the page's run phase — 'running' is still the fast interval, and a
  // start or a stop in flight (neither 'idle') polls at that same 60s rate.
  it('polls every 60s while a run is on, every 300s while idle', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => walletBody,
    }));
    vi.stubGlobal('fetch', fetchMock);

    runPhase = 'running';
    const { UserProfileProvider, useUserProfile } = await load();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(UserProfileProvider, null, children);
    const { rerender } = renderHook(() => useUserProfile(), { wrapper });

    // The mount effect's own fetch, unrelated to the interval.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Switching to idle restarts the interval at the slower rate; the 60s
    // mark that fired above is not reached again.
    runPhase = 'idle';
    rerender();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(240_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
