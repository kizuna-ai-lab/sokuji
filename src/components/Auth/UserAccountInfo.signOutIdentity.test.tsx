// Signing out ended the session but left the PostHog identity in place.
//
// On a shared machine the next person's events then landed on the previous
// user's distinct_id. That is worse than missing data: nothing on the event
// distinguishes "A did this" from "B did this after A signed out", so it cannot
// be separated afterwards. Our own test machines are the most typical instance.
//
// See kizuna-ai-lab/sokuji#523.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { UserAccountInfo } from './UserAccountInfo';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

const refetchSession = vi.fn();
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({
    user: { emailVerified: true, createdAt: new Date(0) },
    refetch: refetchSession,
  }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({
    user: { email: 'you@example.com', firstName: 'J' },
    quota: { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' },
    isLoading: false,
    refetchAll: vi.fn(),
  }),
}));

// better-auth resolves with { data, error } rather than rejecting on an HTTP
// failure — better-fetch's `throw` defaults to false and this client does not
// set it. The mock has to carry that shape or the component's destructure of
// the result throws.
const signedOutOk = { data: { success: true }, error: null };
const signOut = vi.fn(async () => signedOutOk as any);
vi.mock('../../lib/auth-client', () => ({
  authClient: {
    signOut: () => signOut(),
    oneTimeToken: { generate: async () => ({ data: { token: 'good' }, error: null }) },
  },
}));

const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));

const setAuthOverlay = vi.fn();
vi.mock('../../stores/settingsStore', () => ({
  useSetAuthOverlay: () => setAuthOverlay,
}));

const trackEvent = vi.fn();
const resetUser = vi.fn();
vi.mock('../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent, resetUser }),
}));

vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

beforeEach(() => {
  cleanup();
  signOut.mockClear();
  signOut.mockImplementation(async () => signedOutOk as any);
  trackEvent.mockClear();
  resetUser.mockClear();
  refetchSession.mockClear();
});

const signOutButton = () => screen.getByRole('button', { name: /sign out/i });

describe('sign-out clears the analytics identity', () => {
  it('resets the PostHog identity when signing out succeeds', async () => {
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());
    await waitFor(() => expect(resetUser).toHaveBeenCalledTimes(1));
  });

  it('resets it AFTER the success event, never before', async () => {
    // Ordering is the whole trap. reset() swaps in a fresh anonymous
    // distinct_id, so a sign_out_succeeded sent afterwards would be attributed
    // to nobody instead of to the user who just left — trading one wrong
    // attribution for another.
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());
    await waitFor(() => expect(resetUser).toHaveBeenCalled());

    const succeededAt = trackEvent.mock.calls.findIndex(([name]) => name === 'sign_out_succeeded');
    expect(succeededAt).toBeGreaterThanOrEqual(0);
    expect(trackEvent.mock.invocationCallOrder[succeededAt])
      .toBeLessThan(resetUser.mock.invocationCallOrder[0]);
  });

  it('leaves the identity alone when the transport fails, because the user is still signed in', async () => {
    // A rejected signOut does not end the session. The catch clears nothing,
    // and the finally's cleanup works only because a successful signOut has
    // already ended the session server-side — which is why the existing
    // failure test expects this component and its retry button to survive.
    //
    // Resetting here would make a still-authenticated user report anonymously,
    // and nothing would identify them again: identifyUser runs only from the
    // sign-in and sign-up forms. Sign-out failure is far more common than the
    // shared-machine case this whole change exists for, so getting this branch
    // wrong would cost more than it buys.
    signOut.mockRejectedValueOnce(new Error('offline'));
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());

    // Wait for the failure to have been handled, so this asserts on a settled
    // state rather than racing the rejection.
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('sign_out_failed', expect.anything()),
    );
    expect(resetUser).not.toHaveBeenCalled();
  });

  it('leaves it alone when the server refuses, which resolves rather than throws', async () => {
    // The case a try/catch alone cannot see, and the reason the previous
    // attempt at this fix was incomplete. better-fetch's `throw` defaults to
    // false and this client never sets it, so a 403 arrives as a RESOLVED
    // value carrying `error`. Awaiting without inspecting it treats a refused
    // sign-out as a successful one — which is also why sign_out_failed never
    // fired for anything but a dead network.
    signOut.mockResolvedValueOnce({
      data: null,
      error: { status: 403, statusText: 'Forbidden' },
    } as any);
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('sign_out_failed', { error_code: 403 }),
    );
    expect(resetUser).not.toHaveBeenCalled();
    // And it must not have been reported as a success either.
    expect(trackEvent).not.toHaveBeenCalledWith('sign_out_succeeded', expect.anything());
  });
});
