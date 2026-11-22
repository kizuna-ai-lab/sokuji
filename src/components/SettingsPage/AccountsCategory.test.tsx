import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import type { ComponentType } from 'react';
import { BingIcon, KizunaAIIcon, OpenAIIcon, SonioxIcon } from '../Icons/ProviderIcons';

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
// The title bar's account panel, which the open Kizuna AI row shows signed in (owner, 2026-11-15).
const panel = vi.hoisted(() => ({ props: [] as Array<{ idle?: boolean; runPayer?: string }> }));
vi.mock('../Auth/UserAccountInfo', () => ({ UserAccountInfo: (p: { idle?: boolean; runPayer?: string }) => { panel.props.push(p); return <div>account panel</div>; } }));
const runState = vi.hoisted(() => ({ value: { phase: 'idle' } as { phase: string; payer?: string } }));
vi.mock('../../app/useRun', () => ({ useRunState: () => runState.value }));
vi.mock('../providers/ManagedAccountRow', () => ({ ManagedAccountRow: () => <div>account row</div> }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const profile = vi.hoisted(() => ({ quota: { balance: 12_400_000 } as { balance?: number } | null }));
vi.mock('../../contexts/UserProfileContext', () => ({ useOptionalUserProfile: () => ({ quota: profile.quota }) }));
const opened = vi.hoisted(() => [] as string[]);
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: (url: string) => { opened.push(url); } }));

import { AccountsCategory } from './AccountsCategory';
import { useProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';

const row = (name: string) => screen.getByRole('group', { name });

beforeEach(() => {
  runsOn('soniox');
  useProviderStore.setState({
    readiness: {},
    entries: {
      soniox: { settings: { region: 'us' }, credentials: { apiKey: 'k', apiKeyEu: '', apiKeyJp: '' }, pair: { source: 'ja', target: 'en' } },
      openai: { settings: {}, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } },
    } as never,
  });
});
afterEach(() => cleanup());

describe('accounts and keys', () => {
  // Rudolf's review of B-11: a saved key is not a working one. The row says so until its check passes.
  it("says whether a saved key works: saved and checked, refused, or not verified yet", () => {
    const soniox = () => row('Soniox').querySelector('.accounts-row__state')!;
    useProviderStore.setState({ readiness: { soniox: { state: 'ready', models: [] } } as never });
    const first = render(<AccountsCategory locked={false} />);
    expect(soniox()).toHaveTextContent('Key saved');
    expect(soniox()).toHaveClass('is-ok');
    first.unmount();
    useProviderStore.setState({ readiness: { soniox: { state: 'not-ready', code: 'auth', reason: 'HTTP 401' } } as never });
    const second = render(<AccountsCategory locked={false} />);
    expect(soniox()).toHaveTextContent('Key not accepted');
    expect(soniox()).not.toHaveClass('is-ok');
    second.unmount();
    useProviderStore.setState({ readiness: {} });
    render(<AccountsCategory locked={false} />);
    expect(soniox()).toHaveTextContent('Key not verified');
    expect(soniox()).not.toHaveClass('is-ok');
  });

  // B-11: Soniox's key is kept by region, found by asking every region.
  // B-39: the key and the region it belongs to, in one line; no list of regions.
  it("opens Soniox's key with the region it belongs to", () => {
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    expect(row('Soniox').querySelector('.soniox-key__line')).toHaveTextContent('Key saved, not verified yet · Belongs to United States');
    expect(within(row('Soniox')).queryByRole('list')).toBeNull();
    expect(within(row('Soniox')).getByRole('button', { name: 'Save and find its region' })).toBeInTheDocument();
  });

  it('lists the accounts with their state and what they can do', () => {
    useProviderStore.setState({ readiness: { soniox: { state: 'ready', models: [] } } as never });
    render(<AccountsCategory locked={false} />);
    expect(row('Kizuna AI')).toHaveTextContent('Signed in');
    expect(row('Soniox')).toHaveTextContent('Key saved');
    expect(row('OpenAI')).toHaveTextContent('Needs a key');
    expect(row('Bing')).toHaveTextContent('No key needed; online, a Microsoft service');
    expect(row('This device')).toHaveTextContent('Runs on this computer');
    // What an account can do is shown beside its name, folded or open (owner, 2026-11-15: the page is wide, and many
    // providers have only a key besides these tags).
    const name = row('Soniox').querySelector('.accounts-row__name')!;
    expect(name.parentElement!.querySelector('.accounts-row__chips')).toHaveTextContent('Transcription and translation');
    fireEvent.click(within(row('Soniox')).getByRole('button', { name: 'View' }));
    expect(within(row('Soniox')).getAllByText('Transcription and translation')).toHaveLength(1);
    expect(within(row('Soniox')).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
  });

  // Owner, 2026-11-22: a row opens only where there is something to fill in. Bing and Edge need nothing; This
  // device's models are set up in Models and storage, so its button goes there.
  it('gives Bing and Edge no button, and This device a way to its models', () => {
    useSettingsStore.setState({ settingsNavigationTarget: null });
    render(<AccountsCategory locked={false} />);
    for (const name of ['Bing', 'Edge']) expect([name, within(row(name)).queryAllByRole('button')]).toEqual([name, []]);
    const manage = within(row('This device')).getByRole('button', { name: 'Manage models' });
    expect(manage).not.toHaveAttribute('aria-expanded');
    fireEvent.click(manage);
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('models');
    // Nothing unfolds in the row itself.
    expect(row('This device').querySelectorAll('.accounts-row__head ~ *')).toHaveLength(0);
  });

  // The mock's order: the accounts that need no key first, then the ones with a key.
  it('lists Kizuna AI, This device, Bing and Edge first, then the providers with a key', () => {
    render(<AccountsCategory locked={false} />);
    const names = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(names.slice(0, 4)).toEqual(['Kizuna AI', 'This device', 'Bing', 'Edge']);
    expect(names).toContain('OpenAI');
  });

  // Owner, 2026-11-19: each row shows its service's logo, the line-up picker's, so the list is found at a glance.
  it("shows each account's logo before its name, the one the line-up's picker shows", () => {
    render(<AccountsCategory locked={false} />);
    const logoOf = (name: string) => within(screen.getByRole('group', { name })).getByText((_, el) => el?.classList.contains('accounts-row__icon') ?? false);
    // Drawn on its own, off the page; the ids a logo makes for its gradients differ per drawing.
    const shape = (html: string) => html.replace(/(id|href)="[^"]*"|url\(#[^)]*\)/g, '');
    const drawn = (Icon: ComponentType<{ size?: number }>) => shape(render(<Icon size={20} />, { container: document.createElement('div') }).container.innerHTML);
    expect(shape(logoOf('Kizuna AI').innerHTML)).toBe(drawn(KizunaAIIcon));
    expect(shape(logoOf('Bing').innerHTML)).toBe(drawn(BingIcon));
    expect(shape(logoOf('OpenAI').innerHTML)).toBe(drawn(OpenAIIcon));
    expect(shape(logoOf('Soniox').innerHTML)).toBe(drawn(SonioxIcon));
    // Before the name, and not read out: the name says it.
    for (const row of screen.getAllByRole('group')) {
      const logo = row.querySelector('.accounts-row__head > .accounts-row__icon');
      expect(logo).not.toBeNull();
      expect(logo!.getAttribute('aria-hidden')).toBe('true');
      expect(logo!.nextElementSibling).toHaveClass('accounts-row__main');
    }
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
    // OpenAI's own row; the compatible service, with an address of its own, is another.
    expect(screen.getAllByRole('group', { name: /OpenAI/ }).map((g) => g.getAttribute('aria-label'))).toEqual(['OpenAI', 'OpenAI-Compatible Service']);
    expect(screen.getAllByRole('group', { name: /Kizuna AI/ })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: /OpenAI Live/ })).toBeNull();
    expect(document.getElementById('provider-section')).not.toBeNull();
    expect(document.getElementById('user-account-section')).toBe(row('Kizuna AI'));
  });

  // Text models, part B: Gemini's text models use Gemini's key, OpenAI's the OpenAI key; a compatible service has a
  // row of its own, with its address, an optional key and a way to find its models.
  it("one Gemini row for Gemini Live and Gemini's text models, and the OpenAI row says it also translates", () => {
    render(<AccountsCategory locked={false} />);
    expect(screen.getAllByRole('group', { name: /Gemini/ }).map((g) => g.getAttribute('aria-label'))).toEqual(['Google Gemini']);
    const chipsOf = (name: string) => row(name).querySelector('.accounts-row__chips')!.textContent;
    expect(chipsOf('OpenAI')).toContain('End to end');
    expect(chipsOf('OpenAI')).toContain('Translation');
    expect(chipsOf('Google Gemini')).toContain('Translation');
    expect(row('Google Gemini')).toHaveAttribute('id', 'account-gemini-section');
  });

  it('a compatible service: its address and an optional key, Check once the address is there, and Find models', () => {
    useProviderStore.setState((st) => ({ entries: { ...st.entries, openai_compatible: { settings: {}, credentials: { baseUrl: '', apiKey: '' }, pair: { source: 'ja', target: 'en' } } } as never }));
    render(<AccountsCategory locked={false} />);
    expect(row('OpenAI-Compatible Service')).toHaveTextContent('Needs an address');
    expect(row('OpenAI-Compatible Service').querySelector('.accounts-row__chips')).toHaveTextContent('Translation');
    fireEvent.click(within(row('OpenAI-Compatible Service')).getByRole('button', { name: 'Configure' }));
    expect(within(row('OpenAI-Compatible Service')).getByRole('textbox', { name: 'Address' })).toBeInTheDocument();
    expect(within(row('OpenAI-Compatible Service')).getByLabelText('API key (optional)')).toBeInTheDocument();
    expect(within(row('OpenAI-Compatible Service')).getByRole('button', { name: 'Find models' })).toBeDisabled();
    cleanup();
    useProviderStore.setState((st) => ({ entries: { ...st.entries, openai_compatible: { settings: {}, credentials: { baseUrl: 'http://localhost:11434/v1', apiKey: '' }, pair: { source: 'ja', target: 'en' } } } as never }));
    render(<AccountsCategory locked={false} />);
    // The key may stay empty: the address is all a check needs.
    expect(row('OpenAI-Compatible Service')).toHaveTextContent('Key not verified');
    fireEvent.click(within(row('OpenAI-Compatible Service')).getByRole('button', { name: 'View' }));
    expect(within(row('OpenAI-Compatible Service')).getByRole('button', { name: /check|validate/i })).toBeEnabled();
    expect(within(row('OpenAI-Compatible Service')).getByRole('button', { name: 'Find models' })).toBeEnabled();
  });

  it('a compatible service never configured (nothing stored yet) needs an address, and is configured, not keyed', () => {
    // Its entry is not loaded: the row reads the fields its provider asks for, as it does once one is.
    const load = useProviderStore.getState().load;
    useProviderStore.setState({ load: async () => {} } as never);
    try {
      render(<AccountsCategory locked={false} />);
      expect(useProviderStore.getState().entries.openai_compatible).toBeUndefined();
      expect(row('OpenAI-Compatible Service').querySelector('.accounts-row__state')).toHaveTextContent('Needs an address');
      expect(within(row('OpenAI-Compatible Service')).getByRole('button', { name: 'Configure' })).toBeInTheDocument();
    } finally {
      useProviderStore.setState({ load } as never);
    }
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
    runsOn('openai');
    render(<AccountsCategory locked={false} openedBy="provider" />);
    expect(within(row('OpenAI')).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(row('Soniox')).getByRole('button', { name: 'View' })).toHaveAttribute('aria-expanded', 'false');
  });

  // Owner, 2026-11-17: a link about OpenAI's key, with the session on another provider, opens OpenAI's row, which the page then
  // scrolls to by its id.
  it("opened by one provider's target, shows that provider's key, whatever the session runs on", () => {
    runsOn('soniox');
    render(<AccountsCategory locked={false} openedBy="provider:openai" />);
    expect(within(row('OpenAI')).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(row('Soniox')).getByRole('button', { name: 'View' })).toHaveAttribute('aria-expanded', 'false');
    expect(row('OpenAI')).toHaveAttribute('id', 'account-openai-section');
    expect(row('Soniox')).toHaveAttribute('id', 'account-soniox-section');
  });

  it("opened by the 'provider' target under a hosted provider, shows the Kizuna AI sign-in", () => {
    authState.signedIn = false;
    runsOn('kizunaai_soniox');
    render(<AccountsCategory locked={false} openedBy="provider" />);
    expect(within(row('Kizuna AI')).getByText('account row')).toBeInTheDocument();
    authState.signedIn = true;
  });

  // A selection not offered here falls back, as the plan does, to the first provider offered (Kizuna AI's Soniox) once
  // its entry has loaded: its account is the one shown.
  it("opened by the 'provider' target with a selection not offered here, shows the first offered provider's account once it has loaded", () => {
    authState.signedIn = false;
    runsOn('not_offered_here');
    useProviderStore.setState((st) => ({
      entries: { ...st.entries, kizunaai_soniox: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } } as never,
    }));
    render(<AccountsCategory locked={false} openedBy="provider" />);
    expect(within(row('Kizuna AI')).getByText('account row')).toBeInTheDocument();
    authState.signedIn = true;
  });

  it('opened, Kizuna AI shows the account panel signed in: balances, dashboard, sign out, feedback, top up', () => {
    authState.signedIn = true;
    runState.value = { phase: 'running', payer: 'personal' };
    panel.props.length = 0;
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('Kizuna AI')).getByRole('button', { name: 'View' }));
    expect(within(row('Kizuna AI')).getByText('account panel')).toBeInTheDocument();
    expect(within(row('Kizuna AI')).queryByText('account row')).toBeNull();
    // The run's payer while a session runs, as the title bar's panel reads it.
    expect(panel.props[panel.props.length - 1]).toMatchObject({ idle: false, runPayer: 'personal' });
    runState.value = { phase: 'idle' };
  });

  it('opened, Kizuna AI signed out still offers the sign-in', () => {
    authState.signedIn = false;
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(row('Kizuna AI')).getByRole('button', { name: 'View' }));
    expect(within(row('Kizuna AI')).getByText('account row')).toBeInTheDocument();
    expect(within(row('Kizuna AI')).queryByText('account panel')).toBeNull();
    authState.signedIn = true;
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
    expect(tags('Soniox')).toEqual(['Transcription and translation', 'Speech']);
  });

  it('tags an end-to-end provider once', () => {
    render(<AccountsCategory locked={false} />);
    expect(tags('OpenAI')).toContain('End to end');
    expect(tags('OpenAI')).not.toContain('Transcription');
  });

  it('tags each stage of a provider that binds none', () => {
    render(<AccountsCategory locked={false} />);
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
