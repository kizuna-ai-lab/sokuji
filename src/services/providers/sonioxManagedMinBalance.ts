// src/services/providers/sonioxManagedMinBalance.ts
//
// Deliberately a LEAF module: no imports at all.
//
// The Start-button gate (components/MainPanel/sessionStartGate.ts) needs this
// floor, and that gate is also rendered by the subtitle window — a sibling
// React tree. Reading the constants from SonioxProviderConfig instead would
// drag SonioxClient, and through it the whole i18n bootstrap, into every
// surface that merely wants to know whether Start is allowed.
// SonioxProviderConfig re-exports both symbols, so existing importers are
// unaffected.

/**
 * What a MANAGED Soniox session costs to start, in micro-USD.
 *
 * The backend refuses to issue a session key below `minBalanceMicroUsd(sku,
 * MIN_SESSION_S)` — the price of the shortest session it will start (60s) at
 * that SKU's hourly rate: $0.60/hr text-only → $0.01, $1.50/hr
 * speech-to-speech → $0.025. Gating Start on `balance > 0` alone therefore
 * showed a green button to a user who was about to be handed a 402.
 *
 * KEEP IN SYNC with sokuji-backend `src/services/pricing.ts` (RATE_USD_PER_HOUR)
 * and `src/config/soniox.ts` (MIN_SESSION_S). This is a UI pre-check only —
 * the backend's 402 remains the authority, and the client still surfaces it.
 */
export const SONIOX_MANAGED_MIN_BALANCE_MICRO_USD = {
  text_only: 10_000,
  speech_to_speech: 25_000,
} as const;

/** The floor that applies to the session the user is about to start. A session
 *  is speech_to_speech unless the text-only toggle is on — the same mapping
 *  `SonioxClient` uses to pick the mode it asks the backend for. */
export function sonioxManagedMinBalanceMicroUsd(textOnly: boolean): number {
  return textOnly
    ? SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.text_only
    : SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.speech_to_speech;
}
