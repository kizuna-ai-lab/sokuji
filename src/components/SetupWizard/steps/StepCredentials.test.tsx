import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
  isElectron: () => true, isExtension: () => false,
}));
// Keys, not defaults: the field label's default is the slice key itself, which
// is the very thing these tests vary.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// The descriptor registry drags the clients in, and one of them imports the
// i18n singleton — which cannot initialise against the mocked react-i18next.
vi.mock('../../../locales', () => ({ default: { t: (k: string) => k }, changeLanguageWithLoad: vi.fn() }));
let authState = { isSignedIn: false, emailVerified: false as boolean | null };
vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: authState.isSignedIn, userId: authState.isSignedIn ? 'u1' : null, getToken: async () => null }),
  useUser: () => ({ isLoaded: true, user: authState.isSignedIn ? { emailVerified: authState.emailVerified } : null }),
}));
// Own-key credentials no longer read the settings store: only the managed
// branch still needs useSetAuthOverlay.
vi.mock('../../../stores/settingsStore', () => ({
  useSetAuthOverlay: () => vi.fn(),
}));

import StepCredentials from './StepCredentials';
import { initialDraft } from '../setupDraft';
import type { SetupDraft } from '../setupDraft';
import { Provider } from '../../../types/Provider';
import { useProviderStore } from '../../../stores/providerStore';
import { sonioxProvider } from '../../../providers/soniox/provider';
import { SONIOX_DEFAULTS } from '../../../providers/soniox/settings';
import { volcengineAst2Provider } from '../../../providers/volcengine_ast2/provider';
import { AST2_DEFAULTS, type Ast2AuthMode } from '../../../providers/volcengine_ast2/settings';

const ownKeyDraft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
  ...initialDraft(), step: 3, providerPath: 'own-key', provider: Provider.SONIOX, scenario: 'be-heard', ...patch,
});
const managedDraft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
  ...initialDraft(), step: 3, providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, ...patch,
});

/** Seeds the provider store's soniox entry the way a loaded install would hold
 *  it, so the step never waits on a storage load. */
const seedSoniox = (region: 'us' | 'eu' | 'jp', credentials: { apiKey: string; apiKeyEu: string; apiKeyJp: string }) => {
  useProviderStore.setState({
    entries: { soniox: { settings: { ...SONIOX_DEFAULTS, region }, credentials, pair: { source: 'ja', target: 'en' } } },
    readiness: {},
  });
};

beforeEach(() => {
  cleanup();
  authState = { isSignedIn: false, emailVerified: false };
  seedSoniox('us', { apiKey: '', apiKeyEu: '', apiKeyJp: '' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StepCredentials (own key)', () => {
  it("writes a typed Soniox key into the configured region's slot", () => {
    seedSoniox('jp', { apiKey: '', apiKeyEu: '', apiKeyJp: '' });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft()} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText('setup.credentials.apiKey'), { target: { value: 'sk-jp' } });

    expect(dispatch).toHaveBeenCalledWith({ type: 'setCredential', key: 'apiKeyJp', value: 'sk-jp' });
  });

  it('keeps the US slot for the default region', () => {
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft()} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText('setup.credentials.apiKey'), { target: { value: 'sk-us' } });

    expect(dispatch).toHaveBeenCalledWith({ type: 'setCredential', key: 'apiKey', value: 'sk-us' });
  });

  it('prefills the key already in settings so a re-run shows what is saved', () => {
    seedSoniox('us', { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '' });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentialsValidated: true })} dispatch={dispatch} />);

    expect(dispatch).toHaveBeenCalledWith({ type: 'prefillCredentials', credentials: { apiKey: 'sk-saved' } });
  });

  it('does not prefill over a value the user is typing', () => {
    seedSoniox('us', { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '' });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-typing' } })} dispatch={dispatch} />);

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'prefillCredentials' }));
  });

  it('says the key is on file when the validated one is not in a rendered field', () => {
    // Palabra in app mode validates clientId+clientSecret; a provider whose
    // rendered field stays empty must not be painted green over nothing.
    const { container } = render(<StepCredentials draft={ownKeyDraft({ credentialsValidated: true })} dispatch={vi.fn()} />);

    expect(screen.getByText('setup.credentials.onFile')).toBeInTheDocument();
    expect(container.querySelector('input')).not.toHaveClass('settings-input--valid');
  });

  it('does not flash the on-file notice while the prefill is landing', () => {
    // The saved key is in the entry for the first render too; only a
    // credential the wizard cannot show at all deserves the notice.
    seedSoniox('us', { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '' });
    render(<StepCredentials draft={ownKeyDraft({ credentialsValidated: true })} dispatch={vi.fn()} />);

    expect(screen.queryByText('setup.credentials.onFile')).not.toBeInTheDocument();
  });

  it('marks a validated field valid', () => {
    const draft = ownKeyDraft({ credentialsValidated: true, credentials: { apiKey: 'sk-typed' } });
    const { container } = render(<StepCredentials draft={draft} dispatch={vi.fn()} />);

    expect(screen.queryByText('setup.credentials.onFile')).not.toBeInTheDocument();
    expect(container.querySelector('input')).toHaveClass('settings-input--valid');
  });

  it('moves on when the key is left for later, instead of sitting on the step', () => {
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.skipForNow' }));

    // Nothing is saved, so "later" really does leave the provider without a key.
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'skipCredentials', keepExisting: false });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'next' });
  });

  it('treats Skip as "leave it as it is" when the saved key already validates', () => {
    seedSoniox('us', { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '' });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentialsValidated: true })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.skipForNow' }));

    // The prefill effect dispatches first, so match on the action, not on the
    // call index.
    expect(dispatch).toHaveBeenCalledWith({ type: 'skipCredentials', keepExisting: true });
  });

  it('does not call a saved-but-unvalidated key good enough to skip on', () => {
    seedSoniox('us', { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '' });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.skipForNow' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'skipCredentials', keepExisting: false });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'skipCredentials', keepExisting: true });
  });

  it('links the provider tutorial so the user can find out how to get a key', () => {
    render(<StepCredentials draft={ownKeyDraft()} dispatch={vi.fn()} />);

    expect(screen.getByRole('link', { name: /setup.credentials.guide/ }))
      .toHaveAttribute('href', 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup');
  });

  it("Validate runs the provider's own check over the draft's key, and validates on a ready answer", async () => {
    const checkSpy = vi.spyOn(sonioxProvider, 'check').mockResolvedValue({ ok: true });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-typed' } })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));

    await waitFor(() => expect(screen.getByText('setup.credentials.valid')).toBeInTheDocument());
    expect(checkSpy).toHaveBeenCalledWith(
      { region: 'us', stt: 'sk-typed', tts: 'sk-typed' },
      useProviderStore.getState().entries.soniox.settings,
      expect.objectContaining({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal: expect.any(AbortSignal) }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'credentialsValidated' });
  });

  it('a refusal shows the provider\'s words, and validates nothing', async () => {
    vi.spyOn(sonioxProvider, 'check').mockResolvedValue({ ok: false, code: 'auth', reason: 'HTTP 401' });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-typed' } })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));

    await waitFor(() => expect(screen.getByText('notices.auth')).toBeInTheDocument());
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'credentialsValidated' });
  });

  it('an edit made mid-check aborts it, so its stale answer never validates the new key', async () => {
    let resolveCheck!: (r: { ok: true }) => void;
    const checkPromise = new Promise<{ ok: true }>((resolve) => { resolveCheck = resolve; });
    vi.spyOn(sonioxProvider, 'check').mockReturnValue(checkPromise);
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-old' } })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));
    // The user keeps typing while the first check is still in flight.
    fireEvent.change(screen.getByLabelText('setup.credentials.apiKey'), { target: { value: 'sk-new' } });
    resolveCheck({ ok: true });
    // The Validate button's own loading state always clears once the promise
    // settles (the `finally` runs whether or not the answer was aborted) —
    // a stable point to wait on without asserting on the bug itself.
    await waitFor(() => expect(screen.getByRole('button', { name: 'setup.credentials.validate' })).toBeEnabled());

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'credentialsValidated' });
    expect(screen.queryByText('setup.credentials.valid')).not.toBeInTheDocument();
  });

  it('a check that could not find out says why', async () => {
    vi.spyOn(sonioxProvider, 'check').mockRejectedValue(new Error('Soniox did not answer the key check within 15 s.'));
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-typed' } })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));

    await waitFor(() => expect(screen.getByText('Soniox did not answer the key check within 15 s.')).toBeInTheDocument());
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'credentialsValidated' });
  });

  it('writes nothing: the saved key and the provider\'s readiness are untouched', async () => {
    vi.spyOn(sonioxProvider, 'check').mockResolvedValue({ ok: true });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-typed' } })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));
    await waitFor(() => expect(screen.getByText('setup.credentials.valid')).toBeInTheDocument());

    expect(useProviderStore.getState().entries.soniox.credentials.apiKey).toBe('');
    expect(useProviderStore.getState().readiness.soniox).toBeUndefined();
  });
});

describe('StepCredentials — a credential choice (Stage 2 Volcengine AST2, I2)', () => {
  const ast2Draft = (patch: Partial<SetupDraft> = {}) => ownKeyDraft({ provider: Provider.VOLCENGINE_AST2, ...patch });
  const seedAst2 = (authMode: Ast2AuthMode) => useProviderStore.setState({
    entries: { volcengine_ast2: { settings: { ...AST2_DEFAULTS, authMode }, credentials: { appId: '', accessToken: '', apiKey: '' }, pair: { source: 'zh', target: 'en' } } },
    readiness: {},
  });

  it("draws the choice above the saved mode's fields, that mode pressed", () => {
    seedAst2('app');
    const { container } = render(<StepCredentials draft={ast2Draft()} dispatch={vi.fn()} />);

    const buttons = [...container.querySelectorAll('.credential-choice-group .segmented-control .segmented-option')];
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['providers.volcengine_ast2.authModeApp', 'true'],
      ['setup.credentials.apiKey', 'false'],
    ]);
    expect(screen.getByLabelText('setup.credentials.appId')).toBeInTheDocument();
    expect(screen.getByLabelText('setup.credentials.accessToken')).toBeInTheDocument();
    expect(screen.queryByLabelText('setup.credentials.apiKey')).toBeNull();
  });

  it("switches modes in the draft, and the draft's mode shows its own fields", () => {
    seedAst2('app');
    const dispatch = vi.fn();
    render(<StepCredentials draft={ast2Draft()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.apiKey' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'setCredentialChoice', setting: 'authMode', value: 'apiKey' });
    cleanup();
    render(<StepCredentials draft={ast2Draft({ credentialChoice: { setting: 'authMode', value: 'apiKey' } })} dispatch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'setup.credentials.apiKey' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('setup.credentials.apiKey')).toBeInTheDocument();
    expect(screen.queryByLabelText('setup.credentials.appId')).toBeNull();
  });

  it('sets up with an API key only: Validate checks it in the chosen mode, and writes nothing before Finish', async () => {
    seedAst2('app');
    const checkSpy = vi.spyOn(volcengineAst2Provider, 'check').mockResolvedValue({ ok: true });
    const dispatch = vi.fn();
    render(<StepCredentials draft={ast2Draft({ credentialChoice: { setting: 'authMode', value: 'apiKey' }, credentials: { apiKey: 'key-1' } })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.credentials.validate' }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'credentialsValidated' }));
    expect(checkSpy).toHaveBeenCalledWith(
      { kind: 'apiKey', apiKey: 'key-1' },
      expect.objectContaining({ authMode: 'apiKey' }),
      expect.objectContaining({ pair: { source: 'zh', target: 'en' }, legs: ['speaker'] }),
    );
    expect((useProviderStore.getState().entries.volcengine_ast2.settings as { authMode: string }).authMode).toBe('app');
  });
});

describe('StepCredentials (managed)', () => {
  it('tells a signed-in user with an unverified address to finish verification', () => {
    authState = { isSignedIn: true, emailVerified: false };
    render(<StepCredentials draft={managedDraft()} dispatch={vi.fn()} />);

    expect(screen.getByText('setup.credentials.verifyEmail')).toBeInTheDocument();
    expect(screen.queryByText('setup.credentials.signedIn')).not.toBeInTheDocument();
  });

  it('confirms a verified account', () => {
    authState = { isSignedIn: true, emailVerified: true };
    render(<StepCredentials draft={managedDraft()} dispatch={vi.fn()} />);

    expect(screen.getByText('setup.credentials.signedIn')).toBeInTheDocument();
    expect(screen.queryByText('setup.credentials.verifyEmail')).not.toBeInTheDocument();
  });

  it('moves on when sign-in is left for later', () => {
    const dispatch = vi.fn();
    render(<StepCredentials draft={managedDraft()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.skipForNow' }));

    // The managed key belongs to the account, so there is never anything on
    // file here to keep.
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'skipCredentials', keepExisting: false });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'next' });
  });
});
