// "Accounts and keys": what a session locks there, the Soniox row after
// its key is removed, and Kizuna AI's balance across sign-in and sign-out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});
const authState = vi.hoisted(() => ({ signedIn: true }));
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: authState.signedIn, getToken: async () => null }) }));
vi.mock('../Auth/UserAccountInfo', () => ({ UserAccountInfo: () => <div>account panel</div> }));
const run = vi.hoisted(() => ({ value: { phase: 'idle' } as { phase: string; payer?: 'organization' | 'personal' } }));
vi.mock('../../app/useRun', () => ({ useRunState: () => run.value }));
vi.mock('../providers/ManagedAccountRow', () => ({ ManagedAccountRow: () => <button type="button">Sign in</button> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const profile = vi.hoisted(() => ({ quota: { balance: 12_400_000 } as { balance?: number } | null }));
vi.mock('../../contexts/UserProfileContext', () => ({ useOptionalUserProfile: () => ({ quota: profile.quota }) }));

import { AccountsCategory } from './AccountsCategory';
import { useProviderStore } from '../../stores/providerStore';
import { useAccountStore } from '../../stores/accountStore';
import { useModelStore } from '../../stores/modelStore';
import { setUseOwnBalance } from '../../lib/session/payerChoice';

const row = (name: string) => screen.getByRole('group', { name });
const state = (name: string) => row(name).querySelector('.accounts-row__state')!;

beforeEach(() => {
  authState.signedIn = true;
  profile.quota = { balance: 12_400_000 };
  localStorage.clear();
  useAccountStore.setState({ account: null });
  useModelStore.setState({ initialized: true } as never);
  useProviderStore.setState({
    selected: 'soniox', selectionLocked: false, readiness: { soniox: { state: 'ready', models: [] } } as never,
    refreshReadiness: (async () => ({ state: 'unknown' })) as never,
    entries: {
      soniox: { settings: { region: 'us' }, credentials: { apiKey: 'sk-us', apiKeyEu: '', apiKeyJp: '', apiKeyIn: '' }, pair: { source: 'ja', target: 'en' } },
      openai: { settings: {}, credentials: { apiKey: 'sk-openai' }, pair: { source: 'ja', target: 'en' } },
    } as never,
  });
});
afterEach(() => { cleanup(); setUseOwnBalance(false); });

describe('accounts and keys during a session: partly locked', () => {
  it('locks the keys but leaves every row openable and the Kizuna AI sign-in usable; unlocked after, keys unchanged', () => {
    authState.signedIn = false;
    const { rerender } = render(<AccountsCategory locked />);
    for (const toggle of screen.getAllByRole('button', { name: /^(View|Add key|Hide)$/ })) expect(toggle).toBeEnabled();
    fireEvent.click(within(row('Kizuna AI')).getByRole('button', { name: 'View' }));
    expect(within(row('Kizuna AI')).getByRole('button', { name: 'Sign in' })).toBeEnabled();
    // One row is open at a time: OpenAI's key, then Soniox's.
    fireEvent.click(within(row('OpenAI')).getByRole('button', { name: 'View' }));
    const openAiKey = within(row('OpenAI')).getByLabelText(/api ?key/i);
    expect(openAiKey).toBeDisabled();
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    expect(within(row('Soniox')).getByLabelText('API key')).toBeDisabled();
    expect(within(row('Soniox')).getByRole('button', { name: 'Remove the key for United States' })).toBeDisabled();

    rerender(<AccountsCategory locked={false} />);
    expect(within(row('Soniox')).getByLabelText('API key')).toBeEnabled();
    expect(within(row('Soniox')).getByLabelText('API key')).toHaveValue('sk-us');
    fireEvent.click(within(row('OpenAI')).getByRole('button', { name: 'View' }));
    expect(within(row('OpenAI')).getByLabelText(/api ?key/i)).toBeEnabled();
    expect(within(row('OpenAI')).getByLabelText(/api ?key/i)).toHaveValue('sk-openai');
    expect(useProviderStore.getState().entries.openai!.credentials).toMatchObject({ apiKey: 'sk-openai' });
  });
});

describe('the Soniox row after its key is removed', () => {
  it("the row's state and button follow at once: no key line, Needs a key", async () => {
    render(<AccountsCategory locked={false} />);
    expect(state('Soniox')).toHaveTextContent('Key saved');
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'Remove the key for United States' }));
    await waitFor(() => expect(state('Soniox')).toHaveTextContent('Needs a key'));
    expect(state('Soniox')).not.toHaveClass('is-ok');
    expect(row('Soniox').querySelector('.soniox-key__line')).toBeNull();
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'Hide' }));
    expect(within(row('Soniox')).getByRole('button', { name: 'Add key' })).toBeInTheDocument();
  });
});

describe('the account: sign-in, balance', () => {
  it('shows the balance signed in and drops it once signed out', () => {
    const { rerender } = render(<AccountsCategory locked={false} />);
    expect(state('Kizuna AI')).toHaveTextContent('Signed in; balance $12.40');
    expect(state('Kizuna AI')).toHaveClass('is-ok');
    authState.signedIn = false;
    rerender(<AccountsCategory locked={false} />);
    expect(state('Kizuna AI')).toHaveTextContent('Not signed in');
    expect(row('Kizuna AI')).not.toHaveTextContent('$');
    expect(state('Kizuna AI')).not.toHaveClass('is-ok');
  });

  it("a member's row shows the balance of the wallet that pays, the one the title bar shows", () => {
    useAccountStore.setState({ account: {
      status: 'known', balanceMicroUsd: 3_000_000, frozen: false,
      organization: { name: 'Acme', availableMicroUsd: 3_000_000, frozen: false }, personal: { balanceMicroUsd: 40_000_000, frozen: false },
    } } as never);
    const first = render(<AccountsCategory locked={false} />);
    // The organization pays: its balance (the title bar reads "Account (Acme)" and $3.00, AccountButton.test.tsx).
    expect(state('Kizuna AI')).toHaveTextContent('Signed in; balance $3.00');
    first.unmount();
    setUseOwnBalance(true);
    render(<AccountsCategory locked={false} />);
    // The member's own wallet pays: its balance ("Account (Personal)", $40.00 in the title bar).
    expect(state('Kizuna AI')).toHaveTextContent('Signed in; balance $40.00');
  });

  it('during a session, shows the wallet the session spends even after the payer switch is flipped', () => {
    useAccountStore.setState({ account: {
      status: 'known', balanceMicroUsd: 3_000_000, frozen: false,
      organization: { name: 'Acme', availableMicroUsd: 3_000_000, frozen: false }, personal: { balanceMicroUsd: 40_000_000, frozen: false },
    } } as never);
    // Started with the organization paying; the switch then flipped to the member's own wallet (another window can).
    run.value = { phase: 'running', payer: 'organization' };
    setUseOwnBalance(true);
    try {
      render(<AccountsCategory locked />);
      expect(state('Kizuna AI')).toHaveTextContent('Signed in; balance $3.00');
    } finally {
      run.value = { phase: 'idle' };
    }
  });

  it('adds no top-up of its own: the only payment entry is in the account panel', () => {
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('Kizuna AI')).getByRole('button', { name: 'View' }));
    expect(within(row('Kizuna AI')).getByText('account panel')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /top up|pay|billing/i })).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: /top up|pay|billing/i })).toHaveLength(0);
  });
});
