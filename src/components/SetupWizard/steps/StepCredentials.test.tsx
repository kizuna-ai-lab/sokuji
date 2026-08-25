import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => false, isKizunaVolcengineAST2Enabled: () => false,
  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
  isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
}));
// Keys, not defaults: the field label's default is the slice key itself, which
// is the very thing these tests vary.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// The descriptor registry drags the clients in, and one of them imports the
// i18n singleton — which cannot initialise against the mocked react-i18next.
vi.mock('../../../locales', () => ({ default: { t: (k: string) => k }, changeLanguageWithLoad: vi.fn() }));
let authState = { isSignedIn: false, emailVerified: false as boolean | null };
vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: authState.isSignedIn, getToken: async () => null }),
  useUser: () => ({ isLoaded: true, user: authState.isSignedIn ? { emailVerified: authState.emailVerified } : null }),
}));
// The live slice the wizard reads to resolve the credential field and to stand
// in for the provider's defaults during Validate. Mutable per test.
let sliceState: Record<string, unknown> = {};
vi.mock('../../../stores/settingsStore', () => ({
  useSetAuthOverlay: () => vi.fn(),
  useSettingsStore: Object.assign((sel: (s: any) => unknown) => sel(sliceState), { getState: () => sliceState }),
}));

import StepCredentials from './StepCredentials';
import { initialDraft } from '../setupDraft';
import type { SetupDraft } from '../setupDraft';
import { Provider } from '../../../types/Provider';

const ownKeyDraft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
  ...initialDraft(), step: 3, providerPath: 'own-key', provider: Provider.SONIOX, ...patch,
});
const managedDraft = (patch: Partial<SetupDraft> = {}): SetupDraft => ({
  ...initialDraft(), step: 3, providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, ...patch,
});

beforeEach(() => {
  cleanup();
  authState = { isSignedIn: false, emailVerified: false };
  sliceState = { soniox: { apiKey: '', apiKeyEu: '', apiKeyJp: '', region: 'us' } };
});

describe('StepCredentials (own key)', () => {
  it("writes a typed Soniox key into the configured region's slot", () => {
    sliceState = { soniox: { apiKey: '', apiKeyEu: '', apiKeyJp: '', region: 'jp' } };
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
    sliceState = { soniox: { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '', region: 'us' } };
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentialsValidated: true })} dispatch={dispatch} />);

    expect(dispatch).toHaveBeenCalledWith({ type: 'prefillCredentials', credentials: { apiKey: 'sk-saved' } });
  });

  it('does not prefill over a value the user is typing', () => {
    sliceState = { soniox: { apiKey: 'sk-saved', apiKeyEu: '', apiKeyJp: '', region: 'us' } };
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft({ credentials: { apiKey: 'sk-typing' } })} dispatch={dispatch} />);

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'prefillCredentials' }));
  });

  it('marks a validated field valid', () => {
    const draft = ownKeyDraft({ credentialsValidated: true, credentials: { apiKey: 'sk-typed' } });
    const { container } = render(<StepCredentials draft={draft} dispatch={vi.fn()} />);

    expect(container.querySelector('input')).toHaveClass('settings-input--valid');
  });

  it('moves on when the key is left for later, instead of sitting on the step', () => {
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'setup.skipForNow' }));

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'skipCredentials' });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'next' });
  });

  it('links the provider tutorial so the user can find out how to get a key', () => {
    render(<StepCredentials draft={ownKeyDraft()} dispatch={vi.fn()} />);

    expect(screen.getByRole('link', { name: /setup.credentials.guide/ }))
      .toHaveAttribute('href', 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup');
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

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'skipCredentials' });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'next' });
  });
});
