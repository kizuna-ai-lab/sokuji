// src/services/providers/sonioxBothMode.ts
//
// THE answer to "how does Both mode run for this session", in one place.
//
// Before this module the decision was a four-clause `&&` written inline in
// MainPanel.connectConversation, and a second, partial copy of the same
// reasoning ('auto' source language) lived twenty lines above it in the
// `sonioxAutoParticipantBlocked` gate. Three consumers need the same answer:
// the managed `session-key` request (which declares `bothSplit`), the Start
// gate's balance floor, and the client wiring (`bidirectional: true` plus the
// secondary-port participant). Three inline copies would drift.
//
// Pure, with no React and no store access, so it can be called from BOTH the
// render pass (reactive selectors feed the Start gate) and from inside
// connectConversation (a one-shot useSettingsStore.getState() snapshot). Same
// house rule as resolveVoicePrepOutcome: the DECISION is a pure function, only
// the side effects stay in the component.
//
// This module is NOT imported by components/MainPanel/sessionStartGate.ts —
// the gate takes the derived boolean as a plain input. That matters: the gate
// is also loaded by the subtitle window, and this file's import of
// SonioxProviderConfig pulls SonioxClient and the i18n bootstrap behind it.
import { Provider, kizunaBaseProvider } from '../../types/Provider';

/** Structurally identical to audioStore's AudioMode, declared locally so this
 *  module does not import a Zustand store into every caller. */
export type SonioxBothModeScope = 'speaker' | 'participant' | 'both';

export interface SonioxBothModeInput {
  /** The ACTIVE provider id — the Kizuna-managed twin, not its base. */
  provider: Provider;
  /**
   * The ACTIVE provider's settings slice (`soniox` for BYOK, `kizunaSoniox`
   * for the managed twin), resolved by the descriptor's settingsSliceKey.
   * Widened to the two fields that matter so callers can pass either the whole
   * slice or a two-field literal built from reactive selectors.
   */
  settings: { bothModeSharedSession?: boolean; sourceLanguage?: string } | null | undefined;
  /** The effective mode (lockedMode ?? currentMode). */
  mode: SonioxBothModeScope;
}

export interface SonioxBothModePlan {
  /** One Soniox session, mic and system audio mixed (`mix_stt`). */
  shared: boolean;
  /** Two Soniox sessions, one per audio source (`spk_stt` + `par_stt`). */
  split: boolean;
}

/**
 * Does Both mode run on ONE shared Soniox session?
 *
 * Both flavours honour the user's stored preference. Managed (Kizuna AI) used
 * to be forced to `true` here because the backend's session lease was
 * account-scoped and single-session: a second client meant a 409, so You→Others
 * worked while Others→You silently did not. One lease now issues one temporary
 * key per stream (spk_stt + par_stt for split Both), so two managed
 * transcription streams are a supported shape rather than a race the backend
 * refuses — and the answer no longer depends on which provider is asking. The
 * `provider` parameter was removed rather than left dead, so that every call
 * site had to be visited when the policy inverted.
 *
 * `ProviderSpecificSettings` (the toggle) and `sonioxBothModePlan` (the
 * session wiring, the Start-gate floor and the managed session-key request)
 * both read this one function, so a stored value cannot mean one thing to the
 * UI and another to the session.
 *
 * Default is shared: it is one stream instead of two, i.e. the cheaper and
 * lower-latency shape, and it is what every existing install without a stored
 * preference has been running.
 */
export function sonioxUsesSharedBothSession(
  settings: { bothModeSharedSession?: boolean } | null | undefined
): boolean {
  return settings?.bothModeSharedSession ?? true;
}

export function sonioxBothModePlan(input: SonioxBothModeInput): SonioxBothModePlan {
  const { provider, settings, mode } = input;

  // Effective provider, so the KIZUNA_AI_SONIOX managed twin resolves to
  // SONIOX. A raw `provider === Provider.SONIOX` test is always false for the
  // twin — the exact bug this expression carried before, which opened two
  // independent managed sessions and had the second refused with a 409.
  const isSoniox = (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX;
  if (!isSoniox || mode !== 'both') return { shared: false, split: false };

  // The stored preference, through the shared helper rather than reading
  // `bothModeSharedSession` directly: the helper is the one place the default
  // for an unset preference lives, and it is the same function the settings
  // toggle renders from, so a stored value cannot mean one thing to the UI and
  // another to the session. It no longer takes a provider — the managed
  // override it used to apply is gone.
  const prefersShared = sonioxUsesSharedBothSession(settings);

  // Shared mode distinguishes the two sides by LANGUAGE, not by channel, so it
  // cannot run with an 'auto' source. When the user has asked for shared with
  // an 'auto' source, neither answer is true: the Start gate closes on
  // `sonioxAutoParticipantBlocked` before any session exists, and the caller's
  // historical fall-through (two independent clients) is preserved unchanged.
  const shared = prefersShared && settings?.sourceLanguage !== 'auto';
  const split = !prefersShared;

  return { shared, split };
}
