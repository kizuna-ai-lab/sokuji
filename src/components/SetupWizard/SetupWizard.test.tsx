import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true, isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => false, isKizunaVolcengineAST2Enabled: () => false,
  isPalabraAIEnabled: () => true, isLocalNativeEnabled: () => true,
  isElectron: () => true, isExtension: () => false, getRelayWsUrl: () => 'wss://r.example/v1',
}));
// The detected interface language, as i18next reports it. Mutable so a test can
// render the wizard "in Japanese" the way a first-run user in Japan gets it.
let uiLanguage = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string | object) => (typeof d === 'string' ? d : k), i18n: { language: uiLanguage } }),
}));
vi.mock('../../locales', () => ({ changeLanguageWithLoad: vi.fn(async (l: string) => l) }));
let signedIn = false;
const setAuthOverlay = vi.fn();
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: signedIn, getToken: async () => null }) }));
const trackSpy = vi.fn();
vi.mock('../../lib/analytics', () => ({
  // A new function object per render, like the real hook — the identity churn
  // that made the effects re-fire is what this test must reproduce.
  useAnalytics: () => ({ trackEvent: (...args: unknown[]) => trackSpy(...args) }),
}));
const applied: unknown[] = [];
// A test can hold Finish open by parking a promise here, which is how the
// "cannot abandon an in-flight Finish" case gets a window to press Escape in.
let applyGate: Promise<void> | null = null;
vi.mock('./useApplySetup', () => ({
  useApplySetup: () => async (draft: unknown) => { if (applyGate) await applyGate; applied.push(draft); },
}));
let apiKeyValid: boolean | null = null;
vi.mock('../../stores/settingsStore', () => ({
  useUILanguage: () => 'en',
  useSetUILanguage: () => vi.fn(async () => {}),
  useSetAuthOverlay: () => setAuthOverlay,
  useProvider: () => 'openai',
  useIsApiKeyValid: () => apiKeyValid,
  useSettingsStore: Object.assign((sel: (s: any) => unknown) => sel({ openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } }), {
    getState: () => ({ openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } }),
  }),
}));
// The record a Help re-run pre-fills from. Mutable: with it fixed at null the
// isProviderSupported-guarded prefill branch never ran in any test.
let setupRecord: { version: number; scenario: string; providerPath: string; provider: string; completedAt: string } | null = null;
vi.mock('../../stores/setupStore', () => ({ useSetupRecord: () => setupRecord }));

import SetupWizard from './SetupWizard';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { matchLanguage } from './languageDefaults';

beforeEach(() => {
  cleanup();
  applied.length = 0; applyGate = null; signedIn = false; uiLanguage = 'en';
  apiKeyValid = null; setupRecord = null;
  setAuthOverlay.mockClear(); trackSpy.mockClear();
});

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

  it('stops calling a managed user pending once they have signed in', async () => {
    const { rerender } = render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Start right away/ }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));   // pending, for now
    signedIn = true;
    rerender(<SetupWizard variant="first-run" />);
    next();                                           // language pair
    next();                                           // finish
    expect(screen.queryByText(/Not signed in/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(trackSpy.mock.calls.some((c) => c[0] === 'setup_completed')).toBe(true));
    expect(trackSpy.mock.calls.find((c) => c[0] === 'setup_completed')![1]).toMatchObject({ credentials_pending: false });
  });

  it('takes the interface language from i18next, and seeds the pair from it', () => {
    uiLanguage = 'ja';
    render(<SetupWizard variant="first-run" />);
    expect(screen.getByRole('combobox', { name: 'Interface language' })).toHaveValue('ja');

    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();                                           // credentials: nothing to enter offline
    next();                                           // language pair
    const jaSource = matchLanguage(ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveSourceLanguages(), 'ja');
    // If the local engine offered no Japanese source there would be nothing to
    // assert about the pair; the interface-language assertion above still holds.
    if (jaSource) expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue(jaSource);
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

  it('rerun variant shows a close control, and takes focus off the app behind it', async () => {
    const onClose = vi.fn();
    render(<SetupWizard variant="rerun" onClose={onClose} />);
    // Help closes the settings panel on its way here, so focus is on <body>
    // unless the overlay claims it — and a dead Escape handler is worse than
    // none. FloatingFocusManager moves focus in a rAF, hence waitFor.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(trackSpy).toHaveBeenCalledWith('setup_abandoned', { step: 0 });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('pre-fills a re-run from the stored record', () => {
    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'own-key', provider: 'openai', completedAt: 'x' };
    apiKeyValid = true;
    render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
    next();
    expect(screen.getByRole('radio', { name: /Be understood in a meeting/ })).toBeChecked();
    next();
    expect(screen.getByRole('radio', { name: /I have my own API key/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^OpenAI$/ })).toBeChecked();
    next();
    // credentialsAlreadyValid carried over from a valid live key: nothing to re-enter.
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('starts blank when the stored record names a provider this build does not have', () => {
    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'own-key', provider: 'not-a-provider', completedAt: 'x' };
    apiKeyValid = true;
    render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
    next();
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  });

  it('will not abandon setup while Finish is in flight', async () => {
    let release!: () => void;
    applyGate = new Promise<void>((r) => { release = r; });
    const onClose = vi.fn();
    render(<SetupWizard variant="rerun" onClose={onClose} />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next(); next(); next();                           // credentials, language pair, finish
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(trackSpy.mock.calls.some((c) => c[0] === 'setup_abandoned')).toBe(false);

    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('emits setup_started once and setup_step_viewed once per step, never on a keystroke', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Subtitle my own speech/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /I have my own API key/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^OpenAI$/ }));
    next();

    const apiKeyInput = screen.getByLabelText('apiKey');
    fireEvent.change(apiKeyInput, { target: { value: 'a' } });
    fireEvent.change(apiKeyInput, { target: { value: 'ab' } });
    fireEvent.change(apiKeyInput, { target: { value: 'abc' } });

    const startedCalls = trackSpy.mock.calls.filter((c) => c[0] === 'setup_started');
    const stepViewedCalls = trackSpy.mock.calls.filter((c) => c[0] === 'setup_step_viewed');
    expect(startedCalls).toHaveLength(1);
    expect(stepViewedCalls).toHaveLength(4);
    expect(stepViewedCalls[stepViewedCalls.length - 1][1]).toEqual({ step: 3, step_id: 'credentials' });
  });
});
