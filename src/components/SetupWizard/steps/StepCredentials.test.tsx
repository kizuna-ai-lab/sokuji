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
vi.mock('../../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false, getToken: async () => null }) }));
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

beforeEach(() => {
  cleanup();
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

  it('shows the key-on-file notice instead of marking an empty field valid', () => {
    // A Help re-run seeds credentialsValidated from the live key, which is in
    // settings, not in the draft: a green empty password box claims otherwise.
    const { container } = render(<StepCredentials draft={ownKeyDraft({ credentialsValidated: true })} dispatch={vi.fn()} />);

    expect(screen.getByText('setup.credentials.onFile')).toBeInTheDocument();
    expect(container.querySelector('input')).not.toHaveClass('settings-input--valid');
  });

  it('marks a freshly validated field valid, with no notice', () => {
    const draft = ownKeyDraft({ credentialsValidated: true, credentials: { apiKey: 'sk-typed' } });
    const { container } = render(<StepCredentials draft={draft} dispatch={vi.fn()} />);

    expect(screen.queryByText('setup.credentials.onFile')).not.toBeInTheDocument();
    expect(container.querySelector('input')).toHaveClass('settings-input--valid');
  });

  it('keeps the US slot for the default region', () => {
    const dispatch = vi.fn();
    render(<StepCredentials draft={ownKeyDraft()} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText('setup.credentials.apiKey'), { target: { value: 'sk-us' } });

    expect(dispatch).toHaveBeenCalledWith({ type: 'setCredential', key: 'apiKey', value: 'sk-us' });
  });
});
