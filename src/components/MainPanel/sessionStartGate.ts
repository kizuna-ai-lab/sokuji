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
// Also a leaf, for the same reason.
import { effectiveTextOnly } from '../../utils/effectiveTextOnly';
import { formatUsdFloor } from '../../utils/formatters';

export type StartBlockReason =
  | 'missing-device'
  | 'auto-source-participant'
  | 'local-models-missing'
  | 'api-key-invalid'
  | 'sign-in-required'
  | 'managed-key-unavailable'
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
   * The user's "Text Only" toggle (no spoken translation).
   *
   * The user's REQUEST, not the answer: `speakerWillStart` below can override
   * it, and the gate applies that rule itself rather than trusting the caller
   * to have pre-resolved it — see `effectiveTextOnly`.
   *
   * Read ONLY for managed Soniox, which is the one provider with a real
   * balance floor rather than "any positive balance" — see
   * `balanceFloorMicroUsd` below. Optional, and every other provider keeps
   * the historical `> 0` rule regardless of its value, so callers that do
   * not know about the text-only toggle can leave it out.
   */
  textOnly?: boolean;
  /**
   * Will the microphone (forward-direction) leg of the session about to start
   * actually run? False for a participant-only session.
   *
   * Read ONLY for managed Soniox, and only to resolve `textOnly` into the
   * session's EFFECTIVE text-only-ness: the participant leg never speaks, so a
   * session without a speaker leg opens no synthesis stream however the toggle
   * is set, and belongs on the cheaper floor.
   *
   * Optional with the same safe default as `textOnly` — omitted means "assume
   * a speaker leg", which keeps the HIGHER floor, because a caller that has
   * not been taught about the channel matrix might be about to start one.
   */
  speakerWillStart?: boolean;
  /**
   * Is the user signed in to their Kizuna account?
   *
   * Read ONLY to word the blocker for a Kizuna-managed provider, whose key is
   * issued by the backend: signed out is a sign-in prompt, signed in with no
   * key is an account failure. It never affects `canStart` — whether the key
   * actually arrived is already answered by `isApiKeyValid`.
   *
   * Optional, defaulting to signed IN. A caller that has not been taught about
   * auth then gets the neutral account message instead of telling a signed-in
   * user to sign in, which is the worse of the two wrong answers.
   */
  isSignedIn?: boolean;
  /**
   * Will the session about to start run Both mode as TWO Soniox streams (one
   * per audio source) rather than one shared mixed stream?
   *
   * Read ONLY for managed Soniox, and only to pick the balance floor: split
   * opens a second transcription stream, so the shortest session the backend
   * will start costs roughly twice as much.
   *
   * Optional like `textOnly`, but with the OPPOSITE safe default, deliberately.
   * `textOnly` omitted falls back to the HIGHER speech-to-speech floor, because
   * a caller that does not know about that toggle might be about to start a
   * speech session. Split is the reverse: it is opt-in, reachable only in Both
   * mode, and only a caller that reads the shared/split toggle can be in it —
   * so omitting it means "not split" and falls back to the LOWER floor.
   * Defaulting it the other way would block Start on every speaker-only
   * session for any caller that had not been taught about split.
   */
  sonioxBothSplit?: boolean;
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
    speakerWillStart,
    sonioxBothSplit,
    isSignedIn = true,
  } = input;

  const kizunaManaged = isKizunaManagedProvider(provider);

  // Managed Soniox has a real floor rather than "any positive balance": the
  // backend refuses to issue a session key below the price of its shortest
  // session (60s) at the CONSERVATIVE AGGREGATE rate for the stream set that
  // session will open — $0.018334 text-only, $0.041667 speech-to-speech, and
  // for split Both (a second transcription stream) $0.036667 and $0.06.
  // Gating on `> 0` showed a green Start to a user who was then handed a 402
  // by the server. The 402 stays as the authority; this stops the button lying
  // about it.
  //
  // Every other provider gets a floor of 1: balances are integer micro-USD,
  // so `>= 1` is exactly the `> 0` rule this replaced.
  //
  // `effectiveTextOnly` rather than the raw toggle: a participant-only session
  // opens no synthesis stream whatever the toggle says (the participant leg is
  // forced text-only for every provider), so charging it the speech-to-speech
  // floor blocked Start on a session the backend would have started.
  const balanceFloorMicroUsd =
    provider === Provider.KIZUNA_AI_SONIOX
      ? sonioxManagedMinBalanceMicroUsd(
          effectiveTextOnly({
            speakerLegRuns: speakerWillStart ?? true,
            textOnly: Boolean(textOnly),
          }),
          Boolean(sonioxBothSplit),
        )
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
    // `isApiKeyValid` is the readiness flag for every provider, but only some
    // of them are ready by way of an API key the user pastes. This branch was
    // a two-way split that sent everything except LOCAL_INFERENCE to
    // 'api-key-invalid', whose message told the user to add an OpenAI key —
    // shown verbatim to a Gemini user, to a local engine that has no key at
    // all, and to a signed-out managed user who cannot supply one. Each group
    // gets the instruction it can actually act on.

    // Local engines: "valid" means the required models are downloaded.
    // settingsStore.validateApiKey routes BOTH of them through their model
    // store's ensureSelectionReady resolver gate — modelStore for
    // LOCAL_INFERENCE, nativeModelStore for LOCAL_NATIVE — and neither ever
    // sees a credential.
    if (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) {
      return { canStart: false, reason: 'local-models-missing' };
    }

    // Kizuna-managed: the key is issued by the backend against the user's
    // account (ApiKeyService), so there is no field to paste one into. Signed
    // out is by far the common case and is what settingsStore already reports
    // as `kizunaKeyError: 'auth.signedOut'`; signed in with no key is a
    // session or backend failure, whose specific detail ProviderSection
    // renders. The two differ in wording, not in destination — ProviderSection
    // carries the affordance for both (see `reasonToSettingsTarget`).
    if (kizunaManaged) {
      return {
        canStart: false,
        reason: isSignedIn ? 'managed-key-unavailable' : 'sign-in-required',
      };
    }

    // Everything left really does hold a user-supplied credential.
    return { canStart: false, reason: 'api-key-invalid' };
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
 * The other end of the same question: the session was allowed to start — did
 * any channel actually come up? True means abort, because a session with no
 * working stream is a fake "active" UI state.
 *
 * Both inputs mean "end to end": connected AND its recorder wired, the contract
 * `setSpeakerChannelActive(true)` / `setParticipantChannelActive(true)` already
 * carry. They are passed as plain booleans because connectConversation must read
 * them back within the same pass, which a setState cannot offer.
 *
 * It takes OUTCOMES because the guard this replaces took client references, and
 * a reference is not evidence that a channel works:
 *
 *  - The participant catch block is non-fatal by design and does NOT clear
 *    `participantClientRef.current`, so a leg whose connect() or
 *    startSystemAudioRecording() rejected still left the ref set.
 *  - `speakerClientRef.current` is never assigned null anywhere in MainPanel,
 *    not even on Stop — so after the first session that builds a speaker client
 *    the speaker half of the old condition was false for the rest of the
 *    process's life, and the guard could not fire at all.
 *
 * The case that makes this matter is the participant-only session: no
 * microphone, the participant leg fails, and the session is marked active with
 * zero working streams while a managed Soniox lease is held until it expires,
 * 409ing every subsequent Start. A failed participant leg ALONGSIDE a working
 * speaker stays what it has always been — a one-way session that continues, and
 * that SplitDegradedChip reports.
 */
export function noChannelCameUp(channels: {
  speakerChannelStarted: boolean;
  participantChannelStarted: boolean;
}): boolean {
  return !channels.speakerChannelStarted && !channels.participantChannelStarted;
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
    // Both managed-provider blockers, deliberately NOT 'user-account': the
    // account entry was moved out of the settings panel to the title bar's
    // AccountButton, and Settings.tsx resolves a target by looking up
    // `${target}-section`, so 'user-account' matches no element — the Fix
    // button would switch to the General tab, scroll nowhere, and leave the
    // user with nothing to click. ProviderSection is where BOTH states have an
    // affordance: the sign-in link that opens the account popover, and the
    // specific `kizunaKeyError` for a signed-in user whose key never arrived.
    case 'sign-in-required':
    case 'managed-key-unavailable':
      return 'provider';
    // Pre-existing, and left alone here: 'user-account' is dead for these two
    // as well, but where a wallet top-up should land is a separate question
    // from what this gate reports.
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
        defaultValue: "Set My language to a specific language — with automatic detection, the other side's speech can't be translated into it.",
      };
    case 'local-models-missing':
      return { key: 'mainPanel.localModelsRequired', defaultValue: 'Please download the required models in Settings to start.' };
    case 'api-key-invalid':
      // Provider-neutral on purpose. This string named OpenAI in all 30
      // catalogs and was the catch-all blocker, so every other provider's
      // users were told to fix a service they had not selected. Naming the
      // right one instead would mean interpolating a display name that is
      // itself localized — and i18next will not resolve a `$t()` arriving
      // through interpolation (skipOnVariables) -- for a sentence whose
      // Fix button already opens the selected provider's own settings.
      return { key: 'mainPanel.apiKeyRequired', defaultValue: 'Please add a valid API key in settings first' };
    case 'sign-in-required':
      // The same sentence ProviderSection shows under this exact condition,
      // and the one settingsStore stores as the signed-out `kizunaKeyError`.
      return { key: 'auth.signedOut', defaultValue: "Sign in to use Kizuna AI's built-in translation service." };
    case 'managed-key-unavailable':
      // Deliberately NOT auth.sessionUnavailable ("please sign in again"): the
      // key can also fail to arrive because the backend call did, and sending
      // a signed-in user to re-authenticate for a network blip is a dead end.
      return { key: 'auth.unknown', defaultValue: 'Could not verify your account. Please try again.' };
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
      //
      // Floored, like every other balance: this message appears precisely when
      // the balance is too low to start, so rounding it UP to a friendlier
      // number is the worst possible moment to overstate it.
      return {
        key: 'mainPanel.insufficientBalance',
        defaultValue: 'Insufficient balance: {{balance}}',
        values: { balance: formatUsdFloor(balanceMicroUsd ?? 0) },
      };
    case 'quota-unknown':
      return { key: 'tokenUsage.unableToLoadQuota', defaultValue: 'Unable to load quota information' };
  }
}
