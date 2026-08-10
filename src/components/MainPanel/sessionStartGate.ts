// src/components/MainPanel/sessionStartGate.ts
//
// Single source of truth for "can a session start, and if not, why".
//
// This used to live twice inside MainPanel's JSX — a nested ternary on the
// basic-mode button's title and a chain of tooltip spans in advanced mode.
// The subtitle window (a sibling React tree that cannot see MainPanel state)
// now needs the same answer, so the logic is a pure function both surfaces
// call. Keeping it in one place is what stops the two windows from giving
// the user contradictory explanations.
import { Provider, isKizunaManagedProvider, type ProviderType } from '../../types/Provider';
// Imported from the leaf module, NOT from SonioxProviderConfig which
// re-exports it: this file is also loaded by the subtitle window, and that
// barrel pulls in SonioxClient and the i18n bootstrap behind it.
import { sonioxManagedMinBalanceMicroUsd } from '../../services/providers/sonioxManagedMinBalance';
import { formatUsd } from '../../utils/formatters';

export type StartBlockReason =
  | 'missing-device'
  | 'auto-source-participant'
  | 'local-models-missing'
  | 'api-key-invalid'
  | 'no-models'
  | 'loading-models'
  | 'wallet-frozen'
  | 'insufficient-balance'
  | 'quota-unknown';

export type DeviceScope = 'speaker' | 'participant' | 'both';

export interface StartGate {
  canStart: boolean;
  /**
   * Why the session cannot start. `null` with `canStart: false` means the
   * blocker is transient initialization, which callers render as a spinner
   * rather than as a problem the user has to fix.
   */
  reason: StartBlockReason | null;
  /** Present only for 'insufficient-balance'. */
  balance?: number;
  /** Present only for 'missing-device'. */
  deviceScope?: DeviceScope;
}

export interface StartGateInput {
  // MainPanel's isApiKeyValid state is `boolean | null` (null while
  // validation hasn't resolved yet); widened here to match. All internal
  // uses are in boolean contexts (`!isApiKeyValid`), so `null` behaves the
  // same as `false` and this widening changes no behavior.
  isApiKeyValid: boolean | null;
  availableModelCount: number;
  loadingModels: boolean;
  isInitializing: boolean;
  provider: ProviderType;
  quota: { balance?: number; frozen?: boolean } | null | undefined;
  missingDeviceForMode: DeviceScope | null;
  /**
   * Some providers build the participant session by swapping a *concrete*
   * source language into the translate target — Soniox through
   * source/target, Gemini Live Translate through
   * `translationConfig.targetLanguageCode`. An 'auto' source cannot be
   * reversed for either: the participant's target would become the literal
   * 'auto', which is not a language. True when that combination is selected.
   * See `reversesDirectionViaSourceLanguage` and MainPanel.
   */
  autoSourceParticipantBlocked: boolean;
  /**
   * Will the session about to start be text-only (no spoken translation)?
   *
   * Read ONLY for managed Soniox, which is the one provider with a real
   * balance floor rather than "any positive balance" — see
   * `balanceFloorMicroUsd` below. Optional, and every other provider keeps
   * the historical `> 0` rule regardless of its value, so callers that do
   * not know about the text-only toggle can leave it out.
   */
  textOnly?: boolean;
}

export function computeStartGate(input: StartGateInput): StartGate {
  const {
    isApiKeyValid,
    availableModelCount,
    loadingModels,
    isInitializing,
    provider,
    quota,
    missingDeviceForMode,
    autoSourceParticipantBlocked,
    textOnly,
  } = input;

  const kizunaManaged = isKizunaManagedProvider(provider);

  // Managed Soniox has a real floor rather than "any positive balance": the
  // backend refuses to issue a session key below the price of its shortest
  // session (60s) at the SKU's rate — $0.01 text-only, $0.025
  // speech-to-speech. Gating on `> 0` showed a green Start to a user who was
  // then handed a 402 by the server. The 402 stays as the authority; this
  // stops the button lying about it.
  //
  // Every other provider gets a floor of 1: balances are integer micro-USD,
  // so `>= 1` is exactly the `> 0` rule this replaced.
  const balanceFloorMicroUsd =
    provider === Provider.KIZUNA_AI_SONIOX
      ? sonioxManagedMinBalanceMicroUsd(Boolean(textOnly))
      : 1;

  const hasValidBalance =
    !kizunaManaged ||
    Boolean(
      quota &&
        quota.balance !== undefined &&
        quota.balance >= balanceFloorMicroUsd &&
        !quota.frozen,
    );

  const canStart =
    isApiKeyValid &&
    availableModelCount > 0 &&
    !loadingModels &&
    !isInitializing &&
    hasValidBalance &&
    missingDeviceForMode === null &&
    !autoSourceParticipantBlocked;

  if (canStart) return { canStart: true, reason: null };

  // Initialization is not a problem to report — it is the "starting" state.
  if (isInitializing) return { canStart: false, reason: null };

  // Precedence below mirrors the tooltip chain the main window has always
  // used (MainPanel.tsx:3408). Do not reorder without changing both.
  if (missingDeviceForMode !== null) {
    return { canStart: false, reason: 'missing-device', deviceScope: missingDeviceForMode };
  }
  // Sits with missing-device rather than further down: both say "the scope
  // you picked can't run as configured", which is more actionable than a
  // generic credential complaint. On main this condition closed the gate
  // with no explanation at all — the silent-disable this module exists to
  // remove.
  if (autoSourceParticipantBlocked) {
    return { canStart: false, reason: 'auto-source-participant' };
  }
  if (!isApiKeyValid) {
    // For LOCAL_INFERENCE, "API key valid" is really "required models are
    // downloaded" (settingsStore.validateApiKey delegates to
    // modelStore.isProviderReady), so the actionable message differs.
    return {
      canStart: false,
      reason: provider === Provider.LOCAL_INFERENCE ? 'local-models-missing' : 'api-key-invalid',
    };
  }
  if (loadingModels) return { canStart: false, reason: 'loading-models' };
  if (availableModelCount === 0) return { canStart: false, reason: 'no-models' };
  if (kizunaManaged && quota?.frozen) return { canStart: false, reason: 'wallet-frozen' };
  if (kizunaManaged && quota?.balance !== undefined && quota.balance < balanceFloorMicroUsd) {
    return { canStart: false, reason: 'insufficient-balance', balance: quota.balance };
  }
  // Defensive: hasValidBalance failed for a Kizuna provider whose quota
  // hasn't loaded yet (quota is still null — the profile fetch is async and
  // can fail). This is NOT known to be an account problem, so it must not
  // be reported as 'insufficient-balance': that reason's message
  // interpolates {{balance}}, which would render as an empty slot ("...:
  // tokens") and route the user to the account page for a problem that may
  // not exist. 'quota-unknown' is its own distinct, inert reason instead.
  return { canStart: false, reason: 'quota-unknown' };
}

/**
 * Settings section to navigate to when the user asks to fix the blocker.
 * Values are keys of NAVIGATION_TAB_MAP (Settings.tsx:25); passing one to
 * settingsStore.navigateToSettings() opens the panel and scrolls to it.
 * Returns null when there is nothing for the user to do.
 */
export function reasonToSettingsTarget(
  reason: StartBlockReason,
  deviceScope?: DeviceScope,
): string | null {
  switch (reason) {
    case 'missing-device':
      return deviceScope === 'participant' ? 'participant' : 'microphone';
    case 'auto-source-participant':
      return 'languages';
    case 'local-models-missing':
      return 'model-management';
    case 'api-key-invalid':
    case 'no-models':
      return 'provider';
    case 'wallet-frozen':
    case 'insufficient-balance':
      return 'user-account';
    case 'loading-models':
    // Quota state is unknown (not confirmed insufficient), so there is
    // nothing concrete to send the user to fix — same as 'loading-models'.
    case 'quota-unknown':
      return null;
  }
}

/**
 * Existing translation keys, reused verbatim. These strings already ship in
 * all 30 locale directories, and reusing them guarantees the subtitle window
 * and the main window word the same blocker identically.
 *
 * `balanceMicroUsd` is only read by 'insufficient-balance'. Interpolation
 * values are returned already display-formatted, so no call site can render
 * a raw wallet integer — pass `values` straight to `t()`.
 */
export function reasonToI18n(
  reason: StartBlockReason,
  balanceMicroUsd?: number,
): { key: string; defaultValue: string; values?: Record<string, string> } {
  switch (reason) {
    case 'missing-device':
      return { key: 'modePicker.missingDevice', defaultValue: 'Configure devices for this mode to start.' };
    case 'auto-source-participant':
      // Same sentence the language settings already show for this exact
      // combination (LanguageSection's showAutoSourceParticipantWarning).
      // The key still reads `soniox...` because Soniox was the first provider
      // to hit this; the sentence itself never named a provider, and renaming
      // the key would churn every locale file for no user-visible gain.
      return {
        key: 'settings.sonioxAutoParticipantWarning',
        defaultValue: "Choose a specific source language — with automatic detection, the other participant's speech can't be translated into your language.",
      };
    case 'local-models-missing':
      return { key: 'mainPanel.localModelsRequired', defaultValue: 'Please download the required models in Settings to start.' };
    case 'api-key-invalid':
      return { key: 'mainPanel.apiKeyRequired', defaultValue: 'Please add a valid OpenAI API Key in settings first' };
    case 'no-models':
      return { key: 'mainPanel.modelsRequired', defaultValue: 'Models are required. Please validate your API key first to load available models.' };
    case 'loading-models':
      return { key: 'mainPanel.modelsLoading', defaultValue: 'Loading available models, please wait...' };
    case 'wallet-frozen':
      return { key: 'mainPanel.walletFrozen', defaultValue: 'Wallet is frozen. Please contact support.' };
    case 'insufficient-balance':
      // The wallet is denominated in micro-USD and this product no longer
      // speaks in "tokens", so the raw value would render as a 7-digit
      // integer. Formatted here — the one place every surface reads its
      // blocker message from — rather than at each call site.
      return {
        key: 'mainPanel.insufficientBalance',
        defaultValue: 'Insufficient balance: {{balance}}',
        values: { balance: formatUsd(balanceMicroUsd ?? 0) },
      };
    case 'quota-unknown':
      return { key: 'tokenUsage.unableToLoadQuota', defaultValue: 'Unable to load quota information' };
  }
}
