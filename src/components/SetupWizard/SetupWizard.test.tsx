import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => false, isKizunaVolcengineAST2Enabled: () => false,
  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
  isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string | object) => (typeof d === 'string' ? d : k), i18n: { language: 'en' } }),
}));
vi.mock('../../locales', () => ({ changeLanguageWithLoad: vi.fn(async (l: string) => l) }));
let signedIn = false;
const setAuthOverlay = vi.fn();
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: signedIn, getToken: async () => null }) }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
const applied: unknown[] = [];
vi.mock('./useApplySetup', () => ({ useApplySetup: () => async (draft: unknown) => { applied.push(draft); } }));
vi.mock('../../stores/settingsStore', () => ({
  useUILanguage: () => 'en',
  useSetUILanguage: () => vi.fn(async () => {}),
  useSetAuthOverlay: () => setAuthOverlay,
  useProvider: () => 'openai',
  useIsApiKeyValid: () => null,
  useSettingsStore: Object.assign((sel: (s: any) => unknown) => sel({ openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } }), {
    getState: () => ({ openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } }),
  }),
}));
vi.mock('../../stores/setupStore', () => ({ useSetupRecord: () => null }));

import SetupWizard from './SetupWizard';

beforeEach(() => { cleanup(); applied.length = 0; signedIn = false; setAuthOverlay.mockClear(); });

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));

describe('SetupWizard', () => {
  it('starts on the interface-language step with Next enabled and no Back', () => {
    render(<SetupWizard variant="first-run" />);
    expect(screen.getByRole('combobox', { name: 'Interface language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('will not leave the scenario step until a card is chosen, and Back returns without losing it', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    back(); next();
    expect(screen.getByRole('radio', { name: /Be understood in a meeting/ })).toBeChecked();
  });

  it('greys out a provider that cannot serve the scenario and says why', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /I have my own API key/ }));
    const zoom = screen.getByRole('radio', { name: /Zoom AI Services/ });
    expect(zoom).toBeDisabled();
    expect(zoom.closest('label')?.textContent).toMatch(/cannot produce spoken translation/);
  });

  it('lets an own-key user skip the credentials for now and finish', async () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Subtitle my own speech/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /I have my own API key/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^OpenAI$/ }));
    next();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    next();                                           // language pair, defaults filled
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    next();                                           // finish
    expect(screen.getByText(/No API key yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ scenario: 'subtitle-myself', providerPath: 'own-key', provider: 'openai', credentialsPending: true });
  });

  it('opens the sign-in overlay from the managed path and passes once signed in', () => {
    const { rerender } = render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Start right away/ }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(setAuthOverlay).toHaveBeenCalledWith('sign-in');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    signedIn = true;
    rerender(<SetupWizard variant="first-run" />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('shows the hardware notice on the offline path and needs nothing else', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();
    expect(screen.getByText(/GPU/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('rerun variant shows a close control', () => {
    const onClose = vi.fn();
    render(<SetupWizard variant="rerun" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
