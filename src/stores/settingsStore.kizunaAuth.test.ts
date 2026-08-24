/**
 * Signed-out users must never be shown the store's internal auth prose.
 *
 * The chain this file pins: `useAuth().getToken` is ALWAYS a function — signed
 * out it merely resolves to `null`, it is never undefined. So
 * `validateApiKey`'s `getAuthToken ? … : false` always took the truthy branch,
 * and the hardcoded `true` it passed to `ensureKizunaApiKey` made that action's
 * own signed-out guard unreachable from this call site. Every signed-out user
 * selecting a Kizuna-managed provider therefore fell through to the generic
 * "Failed to get auth session" branch and read it verbatim in Settings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Provider } from '../types/Provider';
import i18n from '../locales';

// Force platform detection so the Kizuna-managed providers are present in the
// descriptor registry (ProviderConfigFactory's static block runs on import).
// Mirrors settingsStore.test.ts.
vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isKizunaAIEnabled: () => true,
  isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => true,
  isKizunaVolcengineAST2Enabled: () => true,
  isPalabraAIEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
}));

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

const { default: useSettingsStore } = await import('./settingsStore');

/** A signed-out `useAuth().getToken`: present, callable, resolves to null. */
const signedOutGetToken = async (): Promise<string | null> => null;

describe('validateApiKey auth errors for Kizuna-managed providers', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      provider: Provider.KIZUNA_AI_SONIOX,
      kizunaKeyError: null,
      isKizunaKeyFetching: false,
      validationMessage: '',
    });
  });

  it('does not store a raw engineering string when the user is signed out', async () => {
    await useSettingsStore.getState().validateApiKey(signedOutGetToken);
    expect(useSettingsStore.getState().kizunaKeyError).not.toBe('Failed to get auth session');
  });

  it('stores a code the UI can translate, never English prose', async () => {
    await useSettingsStore.getState().validateApiKey(signedOutGetToken);
    const err = useSettingsStore.getState().kizunaKeyError;
    expect(err).toMatch(/^auth\./);
  });

  // Step 3 of the task: the signed-in state has to be threaded through, not
  // hardcoded. Without it the two cases below collapse onto one message.
  it('says "signed out" when the caller knows the user is signed out', async () => {
    await useSettingsStore.getState().validateApiKey(signedOutGetToken, false);
    expect(useSettingsStore.getState().kizunaKeyError).toBe('auth.signedOut');
  });

  it('distinguishes a signed-in session that cannot produce a token', async () => {
    await useSettingsStore.getState().validateApiKey(signedOutGetToken, true);
    expect(useSettingsStore.getState().kizunaKeyError).toBe('auth.sessionUnavailable');
  });

  it('reports an unknown-error code when the token call throws', async () => {
    await useSettingsStore.getState().validateApiKey(async () => {
      throw new Error('ECONNRESET while refreshing the session');
    }, true);
    expect(useSettingsStore.getState().kizunaKeyError).toBe('auth.unknown');
  });

  // ProviderSection already renders a signed-out notice of its own — the
  // clickable common.signInRequired line, which opens the account popover.
  // Setting validationMessage here too puts two sentences saying the same
  // thing one above the other, and the duller of the two is the one that
  // cannot be clicked.
  it('leaves the validation message empty when signed out, so the notice is not doubled', async () => {
    await useSettingsStore.getState().validateApiKey(signedOutGetToken, false);
    const s = useSettingsStore.getState();
    expect(s.validationMessage).toBe('');
    // The diagnosis itself is still recorded — only the duplicate display is gone.
    expect(s.kizunaKeyError).toBe('auth.signedOut');
    expect(s.isApiKeyValid).toBe(false);
  });

  // A signed-in user whose token cannot be produced sees NO signed-out notice
  // from ProviderSection — that branch is gated on being signed out — so here
  // the validation message is the only thing that can explain the failure.
  it('still explains a broken session, where nothing else would', async () => {
    await useSettingsStore.getState().validateApiKey(signedOutGetToken, true);
    const { validationMessage } = useSettingsStore.getState();
    expect(validationMessage).toBe(i18n.t('auth.sessionUnavailable'));
    expect(validationMessage).not.toBe('Sign in is required for Kizuna relay providers');
  });

  it('returns the same translated message to the caller', async () => {
    const result = await useSettingsStore.getState()
      .validateApiKey(signedOutGetToken, false);
    expect(result.valid).toBe(false);
    expect(result.message).toBe(i18n.t('auth.signedOut'));
    expect(result.message).not.toBe('Failed to fetch Kizuna AI API key');
  });
});
