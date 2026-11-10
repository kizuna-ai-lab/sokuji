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
// No token by default: the panel must not fetch without one, which is also what
// keeps most of these tests off the network. The per-side tests opt in.
const auth = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: async () => auth.token }),
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
  auth.token = undefined;
  vi.unstubAllGlobals();
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
    // No per-side figures in this test (no token): the organization's spend is
    // UNKNOWN, which must not read as "you spent nothing".
    expect(container.querySelector('.quota-zone')!.textContent).toContain('My usage in this org');
    expect(row('Spent').textContent).toContain('—');
    expect(screen.queryByText('No usage yet')).toBeNull();

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

describe('the per-side figures, once the endpoint answers', () => {
  const respond = (body: unknown) => {
    auth.token = 't';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  };

  it('shows each side its own spend and the two of them as the total', async () => {
    quota = memberQuota();
    respond({
      personal: { spendMicroUsd: 860_000, sessionSeconds: 5_600, sessionCount: 4 },
      organization: { spendMicroUsd: 3_390_000, sessionSeconds: 22_000, sessionCount: 9 },
    });
    const { container } = render(<UserAccountInfo />);
    await waitFor(() => expect(container.textContent).toContain('$3.39'));
    expect(container.textContent).toContain('30-day total · $4.25');

    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    await waitFor(() => expect(container.textContent).toContain('$0.86'));
  });

  it('draws a runway for the side it is showing, and none when there is nothing to divide by', async () => {
    quota = memberQuota();
    respond({ personal: { spendMicroUsd: 860_000, sessionSeconds: 5_600, sessionCount: 4 } });
    const { container, unmount } = render(<UserAccountInfo />);
    // The organization's side has no figures, so nothing to wait for: switch to
    // the side that does.
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    await waitFor(() => expect(container.textContent).toContain('$0.86'));
    expect(row('Runway').textContent).toMatch(/about \d+ hours/);
    unmount();

    // The organization's side has no figures here, so no runway — and no zero.
    clearUsageSidesCache();
    respond({});
    render(<UserAccountInfo />);
    expect(screen.queryByText(/^Runway/)).toBeNull();
  });

  it('a confirmed zero reads "No usage yet", a missing block reads "—"', async () => {
    quota = memberQuota({ last30DaysUsage: 0 });
    respond({ personal: { spendMicroUsd: 0, sessionSeconds: 0, sessionCount: 0 } });
    const { container, unmount } = render(<UserAccountInfo />);
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    await waitFor(() => expect(screen.getByText('No usage yet')).toBeTruthy());
    // The organization's own side never arrived: unknown, not zero — and the
    // total cannot add a side it does not have.
    expect(container.textContent).toContain('30-day total · —');
    unmount();
  });
});

describe('the refresh button', () => {
  it('refreshes the usage figures too, not only the balance', async () => {
    quota = memberQuota();
    auth.token = 't';
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<UserAccountInfo />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The first answer cached nothing useful, but the button must still ask again
    // rather than serve the same figure for five minutes.
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe('overlapping usage requests', () => {
  it('keeps the newer figures when an earlier request lands last', async () => {
    quota = memberQuota();
    auth.token = 't';
    const resolvers: Array<() => void> = [];
    const bodies = [
      { personal: { spendMicroUsd: 100_000, sessionSeconds: 600, sessionCount: 1 } },
      { personal: { spendMicroUsd: 900_000, sessionSeconds: 600, sessionCount: 1 } },
    ];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      const i = resolvers.length;
      resolvers.push(() => resolve({ ok: true, json: async () => bodies[i] }));
    })));

    const { container } = render(<UserAccountInfo />);
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // The user refreshes before the automatic read has answered.
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // The refresh answers first…
    resolvers[1]();
    fireEvent.click(screen.getByRole('tab', { name: 'Your balance' }));
    await waitFor(() => expect(container.textContent).toContain('$0.90'));
    // …and the earlier one must not paint over it.
    resolvers[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toContain('$0.90');
    expect(container.textContent).not.toContain('$0.10');
  });
});

describe('when the identity changes', () => {
  it('drops the previous organization\'s figures rather than carrying them across', async () => {
    quota = memberQuota();
    auth.token = 't';
    let release: () => void = () => {};
    const body = { organization: { spendMicroUsd: 3_390_000, sessionSeconds: 22_000, sessionCount: 9 } };
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => body });
    })));
    const { container, rerender } = render(<UserAccountInfo />);
    await waitFor(() => expect(typeof release).toBe('function'));
    release();
    await waitFor(() => expect(container.textContent).toContain('$3.39'));

    // The same person in a different organization: the figures belong to the old one.
    quota = memberQuota({ organization: { id: 'org_2', name: 'Other Org', availableMicroUsd: 50_000_000, frozen: false, role: 'member' } });
    rerender(<UserAccountInfo />);
    expect(container.textContent).not.toContain('$3.39');
    expect(row('Spent').textContent).toContain('—');
  });
});

describe('a wallet the server did not send', () => {
  it('shows the organization side rather than a personal balance of zero', () => {
    quota = memberQuota({ personal: undefined });
    localStorage.setItem('sokuji.payer.useOwnBalance', 'true');
    const { container } = render(<UserAccountInfo />);
    // The switch points at a wallet that does not exist; the only wallet we know is shown.
    expect(screen.queryByRole('tab', { name: 'Your balance' })).toBeNull();
    expect(row('Balance').textContent).toContain('$50.00');
    expect(container.textContent).not.toContain('$0.00');
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
