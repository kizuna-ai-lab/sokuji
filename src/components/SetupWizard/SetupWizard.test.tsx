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
  // Interpolating, not just default-returning: the mirror line's whole content
  // is its two interpolated language names, and a mock that dropped them let a
  // swapped `their`/`mine` pass.
  useTranslation: () => ({
    t: (k: string, d?: string | object, opts?: Record<string, unknown>) => {
      const params = (typeof d === 'object' && d !== null ? d : opts) as Record<string, unknown> | undefined;
      const text = typeof d === 'string' ? d : k;
      return params
        ? text.replace(/{{(\w+)}}/g, (m, name) => (params[name] === undefined ? m : String(params[name])))
        : text;
    },
    i18n: { language: uiLanguage },
  }),
}));
vi.mock('../../locales', () => ({ changeLanguageWithLoad: vi.fn(async (l: string) => l) }));
let signedIn = false;
const setAuthOverlay = vi.fn();
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: signedIn, getToken: async () => null }),
  // Verified: the account step's unverified branch is StepCredentials' own
  // test; here it would only add a warning box to every managed assertion.
  useUser: () => ({ isLoaded: true, user: signedIn ? { emailVerified: true } : null }),
}));
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
// Parked here, a rejection makes the next Finish fail exactly once — the case
// where settings were never written and the tour must not start over them.
let applyError: Error | null = null;
vi.mock('./useApplySetup', () => ({
  useApplySetup: () => async (draft: unknown) => {
    if (applyGate) await applyGate;
    if (applyError) { const err = applyError; applyError = null; throw err; }
    applied.push(draft);
  },
}));
let apiKeyValid: boolean | null = null;
// The provider slices the wizard reads: what a credential field is prefilled
// from, and what "skip" is deciding whether to keep. Mutable per test.
let sliceState: Record<string, unknown> = {};
// Mutable so a test can simulate the sign-in overlay opening from step 3 and
// claiming Escape before the wizard's own useDismiss does.
let authOverlayState: 'sign-in' | 'sign-up' | 'forgot-password' | null = null;
vi.mock('../../stores/settingsStore', () => ({
  useUILanguage: () => 'en',
  useSetUILanguage: () => vi.fn(async () => {}),
  useSetAuthOverlay: () => setAuthOverlay,
  useAuthOverlay: () => authOverlayState,
  useProvider: () => 'openai',
  useIsApiKeyValid: () => apiKeyValid,
  useSettingsStore: Object.assign((sel: (s: any) => unknown) => sel(sliceState), { getState: () => sliceState }),
}));
// The record a Help re-run pre-fills from. Mutable: with it fixed at null the
// isProviderSupported-guarded prefill branch never ran in any test.
let setupRecord: { version: number; scenario: string; providerPath: string; provider: string; completedAt: string } | null = null;
// SetupPersistError is redeclared rather than re-exported from the real module:
// the point of mocking setupStore here is to keep ServiceFactory's import graph
// out, and `instanceof` only has to agree between this file and the component,
// which both read the class from this mock.
const MockSetupPersistError = vi.hoisted(() => class SetupPersistError extends Error {
  readonly code = 'SETUP_PERSIST_FAILED' as const;
  constructor() { super('Setup record could not be persisted'); this.name = 'SetupPersistError'; }
});
vi.mock('../../stores/setupStore', () => ({
  useSetupRecord: () => setupRecord,
  SetupPersistError: MockSetupPersistError,
}));
// The tour the first-run wizard hands off to on Finish.
const startTourSpy = vi.fn();
vi.mock('../Tour/TourProvider', () => ({ useTour: () => ({ start: startTourSpy }) }));

import SetupWizard from './SetupWizard';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { matchLanguage } from './languageDefaults';

beforeEach(() => {
  cleanup();
  applied.length = 0; applyGate = null; applyError = null; signedIn = false; uiLanguage = 'en';
  apiKeyValid = null; setupRecord = null; authOverlayState = null;
  sliceState = { openai: { apiKey: '' }, soniox: { apiKey: '', region: 'us' } };
  setAuthOverlay.mockClear(); trackSpy.mockClear(); startTourSpy.mockClear();
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

  it('finishes the offline path with nothing to enter', async () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Subtitle my own speech/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();                                           // the hardware notice
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    next();                                           // language pair
    next();                                           // finish
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ scenario: 'subtitle-myself', providerPath: 'offline', provider: 'local_inference', credentialsPending: false });
    // First-run Finish hands straight off to the tour. Nothing to validate on
    // the offline path, so apiKeyValid stays null rather than true/false.
    expect(startTourSpy).toHaveBeenCalledTimes(1);
    expect(startTourSpy).toHaveBeenCalledWith(expect.objectContaining({ providerPath: 'offline', apiKeyValid: null, mode: 'speaker', textOnly: true }));
  });

  it('does not start the tour when Finish fails', async () => {
    applyError = new Error('could not write settings');
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next(); next(); next();                           // credentials, language pair, finish
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    // Nothing was applied, so there is no app behind the tour to tour: the
    // wizard stays put and says why.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not write settings'));
    expect(applied).toHaveLength(0);
    expect(startTourSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });

  it('shows the translated copy when the setup record could not be written', async () => {
    // The store's Error carries a code, not user-facing prose: every string the
    // wizard shows has to come from the catalogue.
    applyError = new MockSetupPersistError();
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Understand what others say/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next(); next(); next();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save your setup. Please try again.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Setup record could not be persisted');
    expect(startTourSpy).not.toHaveBeenCalled();
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
    // Labelled by the same sentence Settings prints, not "From"/"To": this
    // scenario translates the other side, so the first field is what I read.
    if (jaSource) expect(screen.getByRole('combobox', { name: 'I read' })).toHaveValue(jaSource);
  });

  it('states the mirrored leg on both the pair step and the summary in both mode', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /you read subtitles generated/ }));   // two-way voice: both, spoken
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();
    next();                                           // language pair
    const source = (screen.getByRole('combobox', { name: 'I speak' }) as HTMLSelectElement).value;
    const target = (screen.getByRole('combobox', { name: 'they hear' }) as HTMLSelectElement).value;
    const sources = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveSourceLanguages();
    const targets = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).resolveTargetLanguages(source);
    const sourceName = sources.find((o) => o.value === source)!.name;
    const targetName = targets.find((o) => o.value === target)!.name;
    // The reverse leg reads the pair the other way round: they speak what the
    // forward leg targets, I read what it sources. Asserting the names is what
    // catches the two being swapped.
    expect(screen.getByText(`They speak ${targetName} → I read ${sourceName}`)).toBeInTheDocument();
    next();                                           // finish
    expect(screen.getByText(`They speak ${targetName} → I read ${sourceName}`)).toBeInTheDocument();
    // ...and the summary states the forward leg as a sentence of the same
    // shape, rather than as a label/value row.
    expect(screen.getByText(`I speak ${sourceName} → they hear ${targetName}`)).toBeInTheDocument();
  });

  it('leaves the mirrored leg out of a one-way scenario', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();
    next();
    expect(screen.queryByText(/They speak .* I read/)).toBeNull();
  });

  it('labels the language pair the way the chosen scenario will run it', () => {
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));   // speaker, spoken
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();
    next();
    expect(screen.getByRole('combobox', { name: 'I speak' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'they hear' })).toBeInTheDocument();
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
    expect(startTourSpy).not.toHaveBeenCalled();     // the tour is a first-run affair
  });

  it('pre-fills a re-run from the stored record', () => {
    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'offline', provider: 'local_inference', completedAt: 'x' };
    apiKeyValid = true;
    render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
    next();
    expect(screen.getByRole('radio', { name: /Be understood in a meeting/ })).toBeChecked();
    next();
    expect(screen.getByRole('radio', { name: /Free, offline/ })).toBeChecked();
    next();
    // Nothing to re-enter on the offline path.
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('starts blank when the stored record names a provider this build does not have', () => {
    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'own-key', provider: 'not-a-provider', completedAt: 'x' };
    apiKeyValid = true;
    render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
    next();
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  });

  it('starts blank from a managed record — the card is gone until Stage 2', async () => {
    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'managed', provider: 'kizunaai_soniox', completedAt: 'x' };
    render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
    next();
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);

    // Walking the (only) offline card through Finish hands the offline
    // provider, never the record's stale one.
    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next(); next(); next();                           // credentials, language pair, finish
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ provider: 'local_inference' });
  });

  it('starts blank from an own-key record — the card is gone until Stage 2', async () => {
    setupRecord = { version: 1, scenario: 'be-heard', providerPath: 'own-key', provider: 'openai', completedAt: 'x' };
    render(<SetupWizard variant="rerun" onClose={vi.fn()} />);
    next();
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);

    fireEvent.click(screen.getByRole('radio', { name: /Be understood in a meeting/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next(); next(); next();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ provider: 'local_inference' });
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

  it('keeps the rerun wizard open while the auth overlay owns Escape', () => {
    const onClose = vi.fn();
    const { rerender } = render(<SetupWizard variant="rerun" onClose={onClose} />);

    authOverlayState = 'sign-in';
    rerender(<SetupWizard variant="rerun" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(trackSpy.mock.calls.some((c) => c[0] === 'setup_abandoned')).toBe(false);

    authOverlayState = null;
    rerender(<SetupWizard variant="rerun" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('emits setup_started once and setup_step_viewed once per step, never on a keystroke', () => {
    // No own-key card remains to type a credential into (offline only until
    // Stage 2), so the repeated-interaction-without-a-step-change half of this
    // test uses the language pair's source select instead of a credential
    // field — same property: a re-render that does not change draft.step must
    // not refire the tracking effect.
    render(<SetupWizard variant="first-run" />);
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Subtitle my own speech/ }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Free, offline/ }));
    next();                                           // credentials: nothing to enter
    next();                                           // language pair

    const sourceSelect = screen.getByRole('combobox', { name: 'I speak' }) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: sourceSelect.value } });
    fireEvent.change(sourceSelect, { target: { value: sourceSelect.value } });
    fireEvent.change(sourceSelect, { target: { value: sourceSelect.value } });

    const startedCalls = trackSpy.mock.calls.filter((c) => c[0] === 'setup_started');
    const stepViewedCalls = trackSpy.mock.calls.filter((c) => c[0] === 'setup_step_viewed');
    expect(startedCalls).toHaveLength(1);
    expect(stepViewedCalls).toHaveLength(5);
    expect(stepViewedCalls[stepViewedCalls.length - 1][1]).toEqual({ step: 4, step_id: 'language-pair' });
  });
});
