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
    expect(within(row('Soniox')).getByText('Transcription')).toBeInTheDocument();
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
