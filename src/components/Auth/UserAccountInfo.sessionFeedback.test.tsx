// What the account panel tells the user about the session, in the two moments
// it previously told them nothing.
//
// 1. Signing out is a network round-trip. The button did not change while it
//    was in flight, so the screen sat perfectly still and the user could not
//    tell whether the click had registered.
//
// 2. The session cookie is shared with the dashboard this panel opens. Sign out
//    over there and every authenticated request from here 401s — but the
//    one-time-token failure was only console.warn'd, and the code then opened
//    the un-authenticated URL anyway. The user got a login page where they
//    asked for billing, while this panel went on showing their avatar and
//    balance.
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

// A sign-out we control the timing of, so the in-flight window is observable.
let releaseSignOut: () => void = () => {};
const signOut = vi.fn(
  () => new Promise<void>((resolve) => { releaseSignOut = () => resolve(); }),
);
let ottResult: unknown = { data: { token: 'good' }, error: null };
vi.mock('../../lib/auth-client', () => ({
  authClient: {
    signOut: () => signOut(),
    oneTimeToken: { generate: async () => ottResult },
  },
}));

const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));

const setAuthOverlay = vi.fn();
vi.mock('../../stores/settingsStore', () => ({
  useSetAuthOverlay: () => setAuthOverlay,
}));

vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

beforeEach(() => {
  cleanup();
  signOut.mockClear();
  showToast.mockClear();
  setAuthOverlay.mockClear();
  refetchSession.mockClear();
  ottResult = { data: { token: 'good' }, error: null };
});

const signOutButton = () => screen.getByRole('button', { name: /sign out/i });

describe('sign-out feedback', () => {
  it('disables the button while the request is in flight', async () => {
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());
    // The click has registered and the request has not come back yet. This is
    // exactly the window in which the screen used to look untouched.
    await waitFor(() => expect(signOutButton().hasAttribute('disabled')).toBe(true));
    releaseSignOut();
  });

  it('ignores a second click while the first is still running', async () => {
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());
    await waitFor(() => expect(signOutButton().hasAttribute('disabled')).toBe(true));
    fireEvent.click(signOutButton());
    expect(signOut).toHaveBeenCalledTimes(1);
    releaseSignOut();
  });

  it('re-enables the button if signing out fails, so the user can retry', async () => {
    let fail: (e: Error) => void = () => {};
    signOut.mockImplementationOnce(
      () => new Promise<void>((_, reject) => { fail = reject; }),
    );
    render(<UserAccountInfo />);
    fireEvent.click(signOutButton());
    // Assert it went disabled FIRST. Without this the test passes against code
    // that never disables the button at all, and "re-enabled" means nothing.
    await waitFor(() => expect(signOutButton().hasAttribute('disabled')).toBe(true));
    fail(new Error('offline'));
    await waitFor(() => expect(signOutButton().hasAttribute('disabled')).toBe(false));
  });
});

describe('a session the server has forgotten', () => {
  const topUp = () => screen.getByRole('button', { name: /top up/i });

  it('does not open a page that will only show a login form', async () => {
    ottResult = { data: null, error: { status: 401 } };
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(topUp());
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('tells the user, instead of failing silently', async () => {
    ottResult = { data: null, error: { status: 401 } };
    vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(topUp());
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][1]).toMatchObject({ variant: 'error' });
  });

  it('re-checks the session so the rest of the UI stops claiming to be signed in', async () => {
    ottResult = { data: null, error: { status: 401 } };
    vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    refetchSession.mockClear();
    fireEvent.click(topUp());
    await waitFor(() => expect(refetchSession).toHaveBeenCalled());
  });

  it('offers the way back in', async () => {
    ottResult = { data: null, error: { status: 401 } };
    vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(topUp());
    await waitFor(() => expect(setAuthOverlay).toHaveBeenCalledWith('sign-in'));
  });

  // A token endpoint that is merely down is a different problem from a session
  // that is gone. Signing the user out over a 500 would be its own bug.
  it('still opens the page when the token endpoint fails for another reason', async () => {
    ottResult = { data: null, error: { status: 500 } };
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(topUp());
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(setAuthOverlay).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
