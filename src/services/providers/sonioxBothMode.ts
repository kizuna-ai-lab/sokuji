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
// This module is a LEAF, consumed BY SonioxProviderConfig's planBothMode
// override rather than the other way around — the edge runs descriptor →
// here, and this file still has no import of ProviderConfigFactory or any
// concrete descriptor of its own. components/MainPanel/sessionStartGate.ts
// keeps taking the derived boolean as a plain input regardless: that gate is
// also loaded by the subtitle window, so it stays clear of this module (and
// every other provider-specific one) on principle, not because importing it
// would be heavy.
// Type-only, so the one import above adds no runtime edge.
import type { BothModePlan } from './ProviderDescriptor';

/** Structurally identical to audioStore's AudioMode, declared locally so this
 *  module does not import a Zustand store into every caller. */
export type SonioxBothModeScope = 'speaker' | 'participant' | 'both';

export interface SonioxBothModeInput {
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

/** Alias for the descriptor-level type — this module's own return shape was
 *  the type before ProviderDescriptor.planBothMode existed; kept as a
 *  type-only re-export so existing importers of the name are unaffected. */
export type SonioxBothModePlan = BothModePlan;

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
  const { settings, mode } = input;

  // Provider dispatch no longer lives here: this module is the Soniox
  // descriptor's planBothMode implementation (twin included, by class
  // extension), so "is this Soniox at all" is answered by which descriptor
  // you asked. The registry test pins that the managed twin and BYOK answer
  // identically — the 409 twin bug this module's old isSoniox line existed for.
  if (mode !== 'both') return { shared: false, split: false };

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
