import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';

vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: true, getToken: async () => null }) }));
vi.mock('../providers/ManagedAccountRow', () => ({ ManagedAccountRow: () => <div>account row</div> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const opened = vi.hoisted(() => [] as string[]);
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: (url: string) => { opened.push(url); } }));

import { AccountsCategory } from './AccountsCategory';
import { useProviderStore } from '../../stores/providerStore';

const row = (name: string) => screen.getByRole('group', { name });

beforeEach(() => {
  useProviderStore.setState({
    selected: 'soniox', selectionLocked: false, readiness: {},
    entries: {
      soniox: { settings: { region: 'us' }, credentials: { apiKey: 'k', apiKeyEu: '', apiKeyJp: '' }, pair: { source: 'ja', target: 'en' } },
      openai: { settings: {}, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } },
    } as never,
  });
});
afterEach(() => cleanup());

describe('accounts and keys', () => {
  it('lists the accounts with their state and what they can do', () => {
    render(<AccountsCategory locked={false} />);
    expect(row('Kizuna AI')).toHaveTextContent('Signed in');
    expect(row('Soniox')).toHaveTextContent('Key saved');
    expect(row('OpenAI')).toHaveTextContent('Needs a key');
    expect(row('Bing')).toHaveTextContent('No key needed; online, a Microsoft service');
    expect(row('This device')).toHaveTextContent('Runs on this computer');
    // What an account can do is shown once its row is open (the mock's rows carry name and state only).
    expect(within(row('Soniox')).queryByText('Transcription')).toBeNull();
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    expect(within(row('Soniox')).getByText('Transcription')).toBeInTheDocument();
    expect(within(row('Soniox')).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
  });

  // The mock's order: the accounts that need no key first, then the ones with a key.
  it('lists Kizuna AI, This device, Bing and Edge first, then the providers with a key', () => {
    render(<AccountsCategory locked={false} />);
    const names = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names.slice(0, 4)).toEqual(['Kizuna AI', 'This device', 'Bing', 'Edge']);
    expect(names).toContain('OpenAI');
  });

  // The tour's key step points at the account rows.
  it('carries the tour anchor of the key step', () => {
    const { container } = render(<AccountsCategory locked={false} />);
    expect(container.querySelector('[data-tour="provider-section"]')).toHaveClass('accounts-category');
  });

  it('saves a key through the provider store and checks it', () => {
    const setCredential = vi.spyOn(useProviderStore.getState(), 'setCredential');
    const refreshReadiness = vi.spyOn(useProviderStore.getState(), 'refreshReadiness').mockResolvedValue({ state: 'ready' } as never);
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('OpenAI')).getByRole('button', { name: /Add key/ }));
    const input = within(row('OpenAI')).getByLabelText(/api ?key/i);
    fireEvent.change(input, { target: { value: 'sk-new' } });
    expect(setCredential).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai' }), 'apiKey', 'sk-new');
    fireEvent.click(within(row('OpenAI')).getByRole('button', { name: /check|validate/i }));
    expect(refreshReadiness).toHaveBeenCalled();
  });

  it('one OpenAI row with one key for the three OpenAI providers, and one Kizuna AI sign-in for both hosted ones', () => {
    render(<AccountsCategory locked={false} />);
    expect(screen.getAllByRole('group', { name: /OpenAI/ })).toHaveLength(1);
    expect(screen.getAllByRole('group', { name: /Kizuna AI/ })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: /OpenAI Live/ })).toBeNull();
    expect(document.getElementById('provider-section')).not.toBeNull();
    expect(document.getElementById('user-account-section')).toBe(row('Kizuna AI'));
  });

  it('refuses edits during a session', () => {
    render(<AccountsCategory locked />);
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: /View/ }));
    const inputs = row('Soniox').querySelectorAll('input');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input).toBeDisabled();
  });
});

describe('accounts and keys — opened from a notice or the tour', () => {
  it("opened by the 'provider' target, shows the selected provider's key at once", () => {
    useProviderStore.setState({ selected: 'openai' });
    render(<AccountsCategory locked={false} openedBy="provider" />);
    expect(within(row('OpenAI')).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(row('Soniox')).getByRole('button', { name: 'View' })).toHaveAttribute('aria-expanded', 'false');
  });

  it("opened by the 'provider' target under a hosted provider, shows the Kizuna AI sign-in", () => {
    useProviderStore.setState({ selected: 'kizunaai_soniox' });
    render(<AccountsCategory locked={false} openedBy="provider" />);
    expect(within(row('Kizuna AI')).getByText('account row')).toBeInTheDocument();
  });

  it('opened from the list, keeps every row folded', () => {
    render(<AccountsCategory locked={false} />);
    expect(screen.queryByText('account row')).toBeNull();
  });
});

// Owner, 2026-11-15: the setup guide each provider had in the old provider area belongs to its account row.
describe('accounts and keys — setup guides', () => {
  it("links each account's setup guide, and none where there is no guide", () => {
    opened.length = 0;
    render(<AccountsCategory locked={false} />);
    const guide = (name: string) => within(row(name)).queryByRole('link', { name: 'Setup guide' });
    fireEvent.click(guide('OpenAI')!);
    fireEvent.click(guide('Kizuna AI')!);
    fireEvent.click(guide('This device')!);
    expect(opened).toEqual([
      'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      'https://sokuji.kizuna.ai/docs/kizuna-ai/quick-start',
      'https://sokuji.kizuna.ai/docs/tutorials/local-inference-setup',
    ]);
    expect(guide('Soniox')).not.toBeNull();
    expect(guide('Bing')).toBeNull();
    expect(guide('Edge')).toBeNull();
  });
});
