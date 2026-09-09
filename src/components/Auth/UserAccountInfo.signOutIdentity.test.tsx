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

const signOut = vi.fn(async () => {});
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
  signOut.mockImplementation(async () => {});
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

  it('resets it even when signing out fails, because the user is treated as logged out anyway', async () => {
    // The handler deliberately clears frontend state on failure so a user can
    // always leave. The analytics identity is frontend state: leaving it behind
    // means a user who believes they logged out keeps collecting events.
    signOut.mockRejectedValueOnce(new Error('offline'));
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());
    await waitFor(() => expect(resetUser).toHaveBeenCalledTimes(1));

    const failedAt = trackEvent.mock.calls.findIndex(([name]) => name === 'sign_out_failed');
    expect(failedAt).toBeGreaterThanOrEqual(0);
    expect(trackEvent.mock.invocationCallOrder[failedAt])
      .toBeLessThan(resetUser.mock.invocationCallOrder[0]);
  });
});
