// The account panel (shown signed in in "Accounts and keys") has one payment entry,
// whichever wallet tab is open, and its payer tab is a real tab named as the panel shows it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import en from '../../locales/en/translation.json';
import { UserAccountInfo } from './UserAccountInfo';

// Keys resolved against the real English catalog, as UserAccountInfo.org.test.tsx does.
const lookup = (key: string): string | undefined => key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), en as any);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      const fallback = typeof opts === 'string' ? opts : (opts && typeof opts.defaultValue === 'string' ? opts.defaultValue : undefined);
      const vars = typeof opts === 'object' && opts ? opts : {};
      return (lookup(key) ?? fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ''));
    },
  }),
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: async () => undefined }),
  useUser: () => ({ user: { emailVerified: true, createdAt: new Date(0) }, refetch: vi.fn() }),
}));
let quota: unknown;
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ user: { email: 'you@example.com', firstName: 'J' }, quota, isLoading: false, refetchAll: vi.fn() }),
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { oneTimeToken: { generate: async () => ({ data: null, error: 'x' }) } } }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn(), resetUser: vi.fn() }) }));
vi.mock('../../stores/settingsStore', () => ({ useSetAuthOverlay: () => vi.fn() }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

const member = {
  balance: 50_000_000, last30DaysUsage: 3_420_000, plan: 'free',
  organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 50_000_000, frozen: false, role: 'member' },
  personal: { balanceMicroUsd: 12_340_000, frozen: false, expiringSoon: null },
};
const topUps = () => screen.queryAllByRole('button', { name: /top up/i });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  quota = member;
});

describe('the account panel: who pays, and one payment entry', () => {
  it('a member has exactly one top-up, on the organization tab and on the personal tab', () => {
    render(<UserAccountInfo />);
    expect(topUps()).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Your balance');
    expect(topUps()).toHaveLength(1);
  });

  it("names the paying organization's tab by its name, for a screen reader as on screen", () => {
    render(<UserAccountInfo />);
    const selected = screen.getByRole('tab', { selected: true });
    expect(selected).toHaveAccessibleName('Acme Ltd');
    expect(selected.textContent).toBe('Acme Ltd');
  });

  it('someone without an organization has one top-up and no payer tabs', () => {
    quota = { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' };
    render(<UserAccountInfo />);
    expect(topUps()).toHaveLength(1);
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
