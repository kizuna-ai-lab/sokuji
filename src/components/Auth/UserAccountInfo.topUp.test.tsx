import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { UserAccountInfo } from './UserAccountInfo';

const invoke = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { emailVerified: true, createdAt: new Date(0) }, refetch: vi.fn() }),
}));
let quota: unknown = { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' };
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({
    user: { email: 'you@example.com', firstName: 'J' },
    quota,
    isLoading: false,
    refetchAll: vi.fn(),
  }),
}));
vi.mock('../../lib/auth-client', () => ({
  authClient: { oneTimeToken: { generate: async () => ({ data: null, error: 'x' }) } },
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
let electron = false;
vi.mock('../../utils/environment', () => ({
  isElectron: () => electron,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

beforeEach(() => {
  cleanup();
  invoke.mockClear();
  electron = false;
  quota = { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' };
});

describe('UserAccountInfo top-up', () => {
  it('offers a top-up button that opens the billing page', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(screen.getByRole('button', { name: /top up/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(String(open.mock.calls[0][0])).toContain('/dashboard/billing');
    open.mockRestore();
  });

  // A failed quota load is not a reason to withhold the way to add funds —
  // it is one of the likeliest moments for someone to want it. Putting the
  // button inside the success branch meant the error state offered no way out.
  it('still offers top-up when the quota could not be loaded', () => {
    quota = null;
    render(<UserAccountInfo />);
    expect(screen.getByRole('button', { name: /top up/i })).toBeTruthy();
  });

  // The Electron branch fires an IPC call and discards the promise. A rejected
  // invoke — the main process gone, the handler throwing — became an unhandled
  // rejection with nothing in the UI to show for it. This covers all three
  // callers of openExternalWithAuth, not just top-up.
  it('survives the desktop open-external call rejecting', async () => {
    electron = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as any).electron = {
      invoke: vi.fn().mockRejectedValue(new Error('no main process')),
    };
    render(<UserAccountInfo />);
    fireEvent.click(screen.getByRole('button', { name: /top up/i }));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    delete (window as any).electron;
    warn.mockRestore();
  });
});
