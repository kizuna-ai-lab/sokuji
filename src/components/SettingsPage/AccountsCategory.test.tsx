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
const profile = vi.hoisted(() => ({ quota: { balance: 12_400_000 } as { balance?: number } | null }));
vi.mock('../../contexts/UserProfileContext', () => ({ useOptionalUserProfile: () => ({ quota: profile.quota }) }));
const opened = vi.hoisted(() => [] as string[]);
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: (url: string) => { opened.push(url); } }));

import { AccountsCategory } from './AccountsCategory';
import { useProviderStore } from '../../stores/providerStore';
import { useModelStore } from '../../stores/modelStore';

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
    expect(within(row('Soniox')).queryByText('Transcription and translation')).toBeNull();
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    expect(within(row('Soniox')).getByText('Transcription and translation')).toBeInTheDocument();
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

// The mock's tags (owner 2026-11-15: the tags should look like the mock's): one per way the account works — what it
// does over one connection ("End to end", "Transcription and translation"), else each stage on its own.
describe('accounts and keys — what each can do, as the mock tags it', () => {
  const tags = (name: string) => [...row(name).querySelectorAll('.accounts-row__chip')].map((c) => c.textContent);

  it('tags a provider that serves transcription and translation over one connection, and speech apart', () => {
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    expect(tags('Soniox')).toEqual(['Transcription and translation', 'Speech']);
  });

  it('tags an end-to-end provider once', () => {
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('OpenAI')).getByRole('button', { name: 'Add key' }));
    expect(tags('OpenAI')).toContain('End to end');
    expect(tags('OpenAI')).not.toContain('Transcription');
  });

  it('tags each stage of a provider that binds none', () => {
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('This device')).getByRole('button', { name: 'View' }));
    expect(tags('This device')).toEqual(['Transcription', 'Translation', 'Speech']);
  });
});

// What the mock writes under the two accounts (owner 2026-11-15): Kizuna AI's balance, and on this device how many
// models are downloaded and how much room they take.
describe('accounts and keys — the state line, as the mock writes it', () => {
  beforeEach(() => {
    profile.quota = { balance: 12_400_000 };
    useModelStore.setState({ initialized: true, modelStatuses: { 'sensevoice-int8': 'downloaded', 'opus-mt-en-jap': 'downloaded', 'smart-turn-v3.2': 'downloaded' }, storageUsedMb: 2867 } as never);
  });

  it("shows Kizuna AI's balance once it is known", () => {
    const first = render(<AccountsCategory locked={false} />);
    expect(row('Kizuna AI')).toHaveTextContent('Signed in; balance $12.40');
    first.unmount();
    profile.quota = null;
    render(<AccountsCategory locked={false} />);
    expect(row('Kizuna AI')).toHaveTextContent('Signed in');
    expect(row('Kizuna AI')).not.toHaveTextContent('balance');
  });

  it('counts the models downloaded on this device and the room they take', () => {
    const first = render(<AccountsCategory locked={false} />);
    // The session models only: Smart Turn is a helper model.
    expect(row('This device')).toHaveTextContent('Runs on this computer; 2 models downloaded, 2.8 GB in all');
    first.unmount();
    useModelStore.setState({ modelStatuses: {}, storageUsedMb: 0 } as never);
    render(<AccountsCategory locked={false} />);
    expect(row('This device')).toHaveTextContent('Runs on this computer; no models downloaded yet');
  });
});
