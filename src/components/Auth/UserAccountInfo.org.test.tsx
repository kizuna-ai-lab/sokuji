import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import en from '../../locales/en/translation.json';
import { UserAccountInfo } from './UserAccountInfo';

// Resolve keys against the real English catalog so a missing key fails here.
const lookup = (key: string): string | undefined =>
  key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), en as any);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      const fallback = typeof opts === 'string' ? opts : undefined;
      const vars = typeof opts === 'object' && opts ? opts : {};
      const raw = lookup(key) ?? fallback ?? key;
      return raw.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ''));
    },
  }),
}));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { emailVerified: true, createdAt: new Date(0) }, refetch: vi.fn() }),
}));
let quota: unknown;
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
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn(), resetUser: vi.fn() }) }));
vi.mock('../../stores/settingsStore', () => ({ useSetAuthOverlay: () => vi.fn() }));
vi.mock('../../utils/environment', () => ({
  isElectron: () => false,
  getBackendUrl: () => 'https://sokuji.kizuna.ai',
  getApiUrl: () => 'https://sokuji.kizuna.ai/api',
}));

// The quota section exactly as the panel rendered it before organizations.
const TODAYS_QUOTA_SECTION =
  '<div class="quota-status-section"><div class="quota-compact-line"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wallet wallet-icon" aria-hidden="true"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path></svg><span class="balance-section">$12.34</span><span class="divider">|</span><span class="usage-section"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-column usage-icon" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path></svg>30D: $3.42</span><button class="action-button-compact refresh-account" title="Refresh"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-cw" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg></button></div><button class="top-up-button">Top up</button></div>';

const personalQuota = { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' };
const memberQuota = (over: Record<string, unknown> = {}) => ({
  balance: 50_000_000,
  last30DaysUsage: 3_420_000,
  plan: 'free',
  organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 50_000_000, frozen: false, role: 'member' },
  personal: { balanceMicroUsd: 12_340_000, frozen: false, expiringSoon: null },
  ...over,
});

beforeEach(() => {
  cleanup();
  quota = personalQuota;
});

describe('UserAccountInfo with an organization', () => {
  it('shows the organization and personal balances on separate labelled lines', () => {
    quota = memberQuota();
    render(<UserAccountInfo />);
    const org = screen.getByText('Acme Ltd balance').closest('.quota-balance-row')!;
    expect(org.textContent).toContain('$50.00');
    const own = screen.getByText('Your balance').closest('.quota-balance-row')!;
    expect(own.textContent).toContain('$12.34');
    expect(org).not.toBe(own);
  });

  it('keeps the 30-day usage as the person\'s own', () => {
    quota = memberQuota();
    render(<UserAccountInfo />);
    expect(screen.getByText(/30D: \$3\.42/)).toBeTruthy();
  });

  it('shows the same two lines for the owner', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 50_000_000, frozen: false, role: 'owner' },
    });
    render(<UserAccountInfo />);
    expect(screen.getByText('Acme Ltd balance')).toBeTruthy();
    expect(screen.getByText('Your balance')).toBeTruthy();
  });

  it.each(['owner', 'member'])('offers Top up to the %s, opening the billing page', async (role) => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 1, frozen: false, role },
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<UserAccountInfo />);
    fireEvent.click(screen.getByRole('button', { name: /top up/i }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(String(open.mock.calls[0][0])).toContain('/dashboard/billing');
    open.mockRestore();
  });

  it('marks a paused organization and only that line', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 0, frozen: true, role: 'member' },
    });
    render(<UserAccountInfo />);
    expect(screen.getByText('Acme Ltd balance').closest('.quota-balance-row')!.textContent).toContain('Paused');
    expect(screen.getByText('Your balance').closest('.quota-balance-row')!.textContent).not.toContain('Paused');
  });

  it('marks a paused personal wallet and only that line', () => {
    quota = memberQuota({ personal: { balanceMicroUsd: 0, frozen: true, expiringSoon: null } });
    render(<UserAccountInfo />);
    expect(screen.getByText('Your balance').closest('.quota-balance-row')!.textContent).toContain('Paused');
    expect(screen.getByText('Acme Ltd balance').closest('.quota-balance-row')!.textContent).not.toContain('Paused');
  });

  it('shows only the organization line when personal is missing', () => {
    quota = memberQuota({ personal: undefined });
    render(<UserAccountInfo />);
    expect(screen.getByText('Acme Ltd balance')).toBeTruthy();
    expect(screen.queryByText('Your balance')).toBeNull();
    expect(screen.getByRole('button', { name: /top up/i })).toBeTruthy();
  });

  it('renders the organization name as text, not markup', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: '<img src=x onerror=alert(1)>', availableMicroUsd: 1, frozen: false, role: 'member' },
    });
    const { container } = render(<UserAccountInfo />);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)> balance');
  });
});

describe('UserAccountInfo without an organization', () => {
  it('renders exactly what it rendered before organizations existed', () => {
    const { container } = render(<UserAccountInfo />);
    expect(container.querySelector('.quota-status-section')!.outerHTML).toBe(TODAYS_QUOTA_SECTION);
  });

  it('ignores a stray personal block when there is no organization', () => {
    quota = { ...personalQuota, personal: { balanceMicroUsd: 1, frozen: true, expiringSoon: null } };
    const { container } = render(<UserAccountInfo />);
    expect(container.querySelector('.quota-status-section')!.outerHTML).toBe(TODAYS_QUOTA_SECTION);
  });
});
