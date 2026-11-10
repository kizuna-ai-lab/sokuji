import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import en from '../../locales/en/translation.json';
import { UserAccountInfo } from './UserAccountInfo';
import { clearUsageSidesCache } from '../../lib/wallet/usageSides';

// Resolve keys against the real English catalog so a missing key fails here.
const lookup = (key: string): string | undefined =>
  key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), en as any);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      const fallback = typeof opts === 'string' ? opts
        : (opts && typeof opts.defaultValue === 'string' ? opts.defaultValue : undefined);
      const vars = typeof opts === 'object' && opts ? opts : {};
      const raw = lookup(key) ?? fallback ?? key;
      return raw.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ''));
    },
  }),
}));
vi.mock('../../lib/auth/hooks', () => ({
  // No `getToken`: the panel must not fetch without one, which is also what
  // keeps these tests off the network.
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

const personalQuota = { balance: 12_340_000, last30DaysUsage: 3_420_000, plan: 'free' };
const memberQuota = (over: Record<string, unknown> = {}) => ({
  balance: 50_000_000,
  last30DaysUsage: 3_420_000,
  plan: 'free',
  organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 50_000_000, frozen: false, role: 'member' },
  personal: { balanceMicroUsd: 12_340_000, frozen: false, expiringSoon: null },
  ...over,
});

const row = (label: string): HTMLElement => {
  const key = screen.getAllByText(new RegExp(`^${label}`), { selector: '.quota-key' })[0];
  return key.closest('.quota-row') as HTMLElement;
};
const rowValue = (label: string): string => row(label).querySelector('.quota-val')!.textContent ?? '';

beforeEach(() => {
  cleanup();
  clearUsageSidesCache();
  // The payer switch is remembered per device (localStorage), so without this a
  // test that switched to the personal wallet would decide the next one's tab.
  localStorage.clear();
  quota = personalQuota;
});

describe('UserAccountInfo with an organization', () => {
  it('opens on the organization tab: the committed balance, the available one, and nothing from the other side', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 30_000_000, committedBalanceMicroUsd: 50_000_000, frozen: false, role: 'member' },
    });
    render(<UserAccountInfo />);
    // The tab is the organization's name; the big figure is what it holds.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Acme Ltd');
    expect(rowValue('Balance')).toBe('$50.00');
    expect(rowValue('Available')).toBe('$30.00');
    // The personal wallet is one click away, not a second line.
    expect(screen.queryAllByText('$12.34')).toHaveLength(0);
  });

  it('shows the held line, and only when something is held', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 30_000_000, committedBalanceMicroUsd: 50_000_000, frozen: false, role: 'member' },
    });
    const { unmount } = render(<UserAccountInfo />);
    expect(rowValue('Held by sessions')).toBe('$20.00');
    unmount();

    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 50_000_000, committedBalanceMicroUsd: 50_000_000, frozen: false, role: 'member' },
    });
    render(<UserAccountInfo />);
    expect(screen.queryByText(/Held by sessions/)).toBeNull();
  });

  it('explains the held figure behind a hint, not as a permanent sentence', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 30_000_000, committedBalanceMicroUsd: 50_000_000, frozen: false, role: 'member' },
    });
    render(<UserAccountInfo />);
    expect(screen.queryByText(/unused part returns/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /hold part of the balance/i }));
    expect(screen.getByText(/unused part returns/)).toBeTruthy();
  });

  it('switches to the personal wallet: its balance, and no organization-only rows', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 30_000_000, committedBalanceMicroUsd: 50_000_000, frozen: false, role: 'member' },
    });
    render(<UserAccountInfo />);
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Your balance');
    expect(rowValue('Balance')).toBe('$12.34');
    expect(screen.queryByText('Available')).toBeNull();
    expect(screen.queryByText('Held by sessions')).toBeNull();
  });

  it('keeps the 30-day figure personal on the personal tab, and claims none for the organization it does not know', () => {
    quota = memberQuota();
    const { container } = render(<UserAccountInfo />);
    // No per-side figures in this test (no token), so the organization's spend is unknown.
    expect(container.querySelector('.quota-zone')!.textContent).toContain('My usage in this org');
    expect(screen.getByText('No usage yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    expect(container.querySelector('.quota-zone')!.textContent).toContain('My usage · last 30 days');
    expect(screen.getByText('$3.42')).toBeTruthy();
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

  it('marks a paused organization on its own tab', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: 'Acme Ltd', availableMicroUsd: 0, frozen: true, role: 'member' },
    });
    render(<UserAccountInfo />);
    expect(row('Balance').textContent).toContain('Paused');
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    expect(row('Balance').textContent).not.toContain('Paused');
  });

  it('marks a paused personal wallet on its own tab', () => {
    quota = memberQuota({ personal: { balanceMicroUsd: 0, frozen: true, expiringSoon: null } });
    render(<UserAccountInfo />);
    expect(row('Balance').textContent).not.toContain('Paused');
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    expect(row('Balance').textContent).toContain('Paused');
  });

  it('offers no personal tab when the server sends no personal wallet', () => {
    quota = memberQuota({ personal: undefined });
    render(<UserAccountInfo />);
    expect(screen.getByRole('tab', { name: 'Acme Ltd' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Your balance' })).toBeNull();
    expect(screen.getByRole('button', { name: /top up/i })).toBeTruthy();
  });

  it('renders the organization name as text, not markup', () => {
    quota = memberQuota({
      organization: { id: 'org_1', name: '<img src=x onerror=alert(1)>', availableMicroUsd: 1, frozen: false, role: 'member' },
    });
    const { container } = render(<UserAccountInfo />);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('locks both tabs while a session runs, and names the payer it was started with', () => {
    quota = memberQuota();
    const { container } = render(<UserAccountInfo idle={false} runPayer="organization" />);
    expect((screen.getByRole('tab', { name: 'Acme Ltd' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('tab', { name: 'Your balance' }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.quota-locked')!.textContent).toContain('This session is paid by Acme Ltd');
    // The tab follows the run, not the switch.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Acme Ltd');
  });

  it('shows no tabs at all for a session that carries no payer', () => {
    quota = memberQuota();
    render(<UserAccountInfo idle={false} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/This session is paid by/)).toBeNull();
  });
});

describe('UserAccountInfo without an organization', () => {
  it('shows one balance, one usage zone and one total — no tabs', () => {
    const { container } = render(<UserAccountInfo />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(rowValue('Balance')).toBe('$12.34');
    expect(container.querySelector('.quota-zone')!.textContent).toContain('My usage · last 30 days');
    expect(screen.getByText('$3.42')).toBeTruthy();
    expect(container.textContent).toContain('30-day total');
  });

  it('ignores a stray personal block when there is no organization', () => {
    quota = { ...personalQuota, personal: { balanceMicroUsd: 1, frozen: true, expiringSoon: null } };
    render(<UserAccountInfo />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(rowValue('Balance')).toBe('$12.34');
  });
});
