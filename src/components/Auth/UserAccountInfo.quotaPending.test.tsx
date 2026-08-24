// The balance must never show a number it is not sure about.
//
// isLoading starts false while quota starts null, so there is a frame — the
// one before the effect that starts the request has run — where the state
// reads "not loading, no data". The render treated that as failure, so signing
// in produced a flash of the error row, then a spinner, then the real balance.
// Whatever the user caught in that flicker, it was not their balance.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { UserAccountInfo } from './UserAccountInfo';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { emailVerified: true, createdAt: new Date(0) }, refetch: vi.fn() }),
}));

let profile: Record<string, unknown> = {};
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({
    user: { email: 'you@example.com', firstName: 'J' },
    refetchAll: vi.fn(),
    ...profile,
  }),
}));

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    signOut: vi.fn(),
    oneTimeToken: { generate: async () => ({ data: null, error: null }) },
  },
}));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../stores/settingsStore', () => ({ useSetAuthOverlay: () => vi.fn() }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

const spinner = () => document.querySelector('.quota-loading');
const errorRow = () => document.querySelector('.quota-error');

beforeEach(() => { cleanup(); profile = {}; });

describe('balance while the request is still out', () => {
  // The frame right after signing in: the effect that starts the fetch has not
  // run yet, so nothing is "loading" and nothing has arrived.
  it('waits, rather than reporting a failure that has not happened', () => {
    profile = { quota: null, isLoading: false, error: null };
    render(<UserAccountInfo />);
    expect(spinner()).not.toBeNull();
    expect(errorRow()).toBeNull();
  });

  it('shows no number at all until one is known', () => {
    profile = { quota: null, isLoading: false, error: null };
    render(<UserAccountInfo />);
    // Both halves matter. Without the spinner assertion this passes against
    // the error branch, which also happens to print no number — and then the
    // test cannot tell "waiting" from "failed".
    expect(spinner()).not.toBeNull();
    // $0.00 in this frame is a lie the user reads as "I am out of money".
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it('keeps waiting once the request is formally in flight', () => {
    profile = { quota: null, isLoading: true, error: null };
    render(<UserAccountInfo />);
    expect(spinner()).not.toBeNull();
  });

  // A failure that actually happened still has to be reported — this is the
  // line between "not yet" and "no".
  it('reports a real failure', () => {
    profile = { quota: null, isLoading: false, error: 'network down' };
    render(<UserAccountInfo />);
    expect(errorRow()).not.toBeNull();
    expect(spinner()).toBeNull();
  });

  it('shows the balance once it arrives', () => {
    profile = {
      quota: { balance: 4_920_000, last30DaysUsage: 241_400, plan: 'free' },
      isLoading: false,
      error: null,
    };
    render(<UserAccountInfo />);
    expect(spinner()).toBeNull();
    expect(screen.getByText(/\$4\.92/)).toBeTruthy();
  });
});
