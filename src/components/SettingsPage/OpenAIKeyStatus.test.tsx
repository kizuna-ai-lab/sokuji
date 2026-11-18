// The OpenAI key's state, from Accounts and keys to the notes card.
// The real provider store, its settings storage faked; OpenAI's own check (its model list) answered here, never sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';

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
// Signed out: with an OpenAI key, OpenAI writes the notes by default.
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: false, getToken: async () => null }) }));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => false }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: () => <div /> }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: () => <div /> }));
vi.mock('./EdgeVoices', () => ({ EdgeVoices: () => <div /> }));
vi.mock('./LocalVoices', () => ({ LocalVoices: () => <div /> }));
vi.mock('../providers/ProviderOwnSettings', () => ({ ProviderEngine: () => <div />, ProviderOwnSettings: () => <div />, ProviderTurnDetectionControls: () => <div /> }));
vi.mock('../../lib/notes/notesPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notes/notesPricing')>()),
  useNotesPricing: () => null,
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../Auth/UserAccountInfo', () => ({ UserAccountInfo: () => <div /> }));
vi.mock('../../app/useRun', () => ({ useRunState: () => ({ phase: 'idle' }), useRunParticipantSpeech: () => null }));
vi.mock('../providers/ManagedAccountRow', () => ({ ManagedAccountRow: () => <div /> }));
vi.mock('../../contexts/UserProfileContext', () => ({ useOptionalUserProfile: () => ({ quota: null }) }));
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: () => {} }));

import { AccountsCategory } from './AccountsCategory';
import { LineUpCategory } from './LineUpCategory';
import { useProviderStore } from '../../stores/providerStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useModelStore } from '../../stores/modelStore';
import { openaiProvider } from '../../providers/openai/provider';
import type { CheckResult } from '../../lib/provider/types';

/** OpenAI's check, held until the test answers it: a key is accepted when it is in `good`. */
let calls: string[] = [];
let pending: Array<() => void> = [];
let good = new Set<string>();
// The store keeps a passed check per key for the whole module: each test types its own keys.
let run = 0;
const key = (name: string) => `sk-${name}-${run}`;

beforeEach(() => {
  run += 1;
  calls = [];
  pending = [];
  good = new Set();
  vi.spyOn(openaiProvider, 'check').mockImplementation(((credentials: { apiKey: string }) => {
    calls.push(credentials.apiKey);
    return new Promise<CheckResult>((resolve) => {
      pending.push(() => resolve(good.has(credentials.apiKey) ? { ok: true, models: [] } : { ok: false, code: 'auth', reason: 'HTTP 401' }));
    });
  }) as never);
  useModelStore.setState({ initialized: true, modelStatuses: {}, storageUsedMb: 0 } as never);
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null }, stored: true });
  useProviderStore.setState({
    selected: 'soniox', selectionLocked: false, readiness: {},
    entries: {
      soniox: { settings: { region: 'us' }, credentials: { apiKey: 'k', apiKeyEu: '', apiKeyJp: '' }, pair: { source: 'ja', target: 'en' } },
      openai: { settings: {}, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } },
    } as never,
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const answerAll = async () => {
  const now = pending;
  pending = [];
  await act(async () => { for (const answer of now) answer(); await Promise.resolve(); });
};
const openAiRow = () => screen.getByRole('group', { name: 'OpenAI' });
const notesCard = () => screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
const typeKey = (value: string) => fireEvent.change(within(openAiRow()).getByLabelText(/api ?key/i), { target: { value } });
const validate = () => fireEvent.click(within(openAiRow()).getByRole('button', { name: 'Validate' }));

describe('OpenAI key status', () => {
  it('a wrong key, then the right one: checking while the check runs, then not accepted, then working', async () => {
    render(<AccountsCategory locked={false} />);
    fireEvent.click(within(openAiRow()).getByRole('button', { name: 'Add key' }));
    typeKey(key('wrong'));
    validate();
    // Checking: the button spins and cannot be pressed again.
    expect(useProviderStore.getState().readiness.openai?.state).toBe('checking');
    expect(within(openAiRow()).getByRole('button', { name: 'Validate' })).toBeDisabled();
    expect(openAiRow().querySelector('.validate-button .spinner')).not.toBeNull();
    await answerAll();
    expect(openAiRow().querySelector('.accounts-row__state')).toHaveTextContent('Key not accepted');
    expect(openAiRow().querySelector('.validation-message.error')).not.toBeNull();

    good.add(key('right'));
    typeKey(key('right'));
    // A new key forgets what the old one's check found.
    expect(openAiRow().querySelector('.accounts-row__state')).toHaveTextContent('Key not verified');
    validate();
    expect(useProviderStore.getState().readiness.openai?.state).toBe('checking');
    await answerAll();
    expect(openAiRow().querySelector('.accounts-row__state')).toHaveTextContent('Key saved');
    expect(openAiRow().querySelector('.accounts-row__state')).toHaveClass('is-ok');
    expect(calls).toEqual([key('wrong'), key('right')]);
  });

  it('the notes card reuses the answer Accounts and keys got: Ready, with no request of its own', async () => {
    good.add(key('right'));
    const accounts = render(<AccountsCategory locked={false} />);
    fireEvent.click(within(openAiRow()).getByRole('button', { name: 'Add key' }));
    typeKey(key('right'));
    validate();
    await answerAll();
    expect(calls).toHaveLength(1);
    accounts.unmount();

    render(<LineUpCategory locked={false} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByRole('combobox', { name: 'Notes' })).toHaveValue('openai');
    expect(within(notesCard()).getByText('Ready')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it('the notes card says it is checking a key nothing has checked yet, then what the check found, asking once', async () => {
    useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, openai: { settings: {}, credentials: { apiKey: key('wrong') }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<LineUpCategory locked={false} />);
    await waitFor(() => expect(within(notesCard()).getByText('Checking the key…')).toBeInTheDocument());
    await answerAll();
    expect(within(notesCard()).getByRole('button', { name: 'Key not accepted' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls).toEqual([key('wrong')]);
  });

  it('during a session the key cannot be checked from Accounts and keys', () => {
    useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, openai: { settings: {}, credentials: { apiKey: key('any') }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<AccountsCategory locked />);
    fireEvent.click(within(openAiRow()).getByRole('button', { name: 'View' }));
    expect(within(openAiRow()).getByRole('button', { name: 'Validate' })).toBeDisabled();
    fireEvent.click(within(openAiRow()).getByRole('button', { name: 'Validate' }));
    expect(calls).toEqual([]);
  });
});

// History's "choose another service" link lands on `#lineup-section`: the real line-up draws that element.
describe('the line-up holds the element the History link scrolls to', () => {
  it('draws the stage cards under #lineup-section', () => {
    render(<LineUpCategory locked={false} />);
    const section = document.getElementById('lineup-section');
    expect(section).not.toBeNull();
    expect(section).toContainElement(screen.getByRole('combobox', { name: 'Notes' }));
  });
});
