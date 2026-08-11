// src/services/providers/sonioxManagedMinBalance.ts
//
// Deliberately a LEAF module: no imports at all.
//
// The Start-button gate (components/MainPanel/sessionStartGate.ts) needs this
// floor, and that gate is also rendered by the subtitle window — a sibling
// React tree. Reading the constants from SonioxProviderConfig instead would
// drag SonioxClient, and through it the whole i18n bootstrap, into every
// surface that merely wants to know whether Start is allowed.
// SonioxProviderConfig re-exports every symbol here, so existing importers are
// unaffected.

/**
 * Conservative budget rate for ONE managed Soniox stream, in micro-USD per
 * hour, by stream kind.
 *
 * These MIRROR the backend's conservative-rate ESTIMATE table. Each is the
 * revenue coefficient K over the worst-case provider cost rate for a stream of
 * that kind ($0.55/hr transcription, $0.70/hr synthesis). K itself is defined
 * in exactly one place — the backend — and is deliberately not restated here;
 * only its product is mirrored.
 *
 * They are deliberately NOT the old per-SKU list rates ($0.60 / $1.50 per
 * hour). Pinning the budget to the list price would re-open overdraft now that
 * charging is provider cost × K rather than wall-clock time at a list rate.
 * The visible consequence, written down so it is not rediscovered as a bug
 * report: an existing single-stream user sees a SHORTER quoted duration at the
 * same balance (the speech-to-speech floor moves $0.025 → $0.041667) while
 * typically being CHARGED LESS than before.
 *
 * Integers rather than dollars-as-floats so the ceil below is exact: the float
 * spelling of the two-stream speech-to-speech sum lands one ULP above 60000
 * and ceils to 60001.
 */
export const SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR = {
  /** any `*_stt` role — one transcription stream */
  stt: 1_100_000,
  /** any `*_tts` role — one synthesis stream */
  tts: 1_400_000,
} as const;

/** The shortest session the backend will start, in seconds (its MIN_SESSION_S). */
export const SONIOX_MANAGED_MIN_SESSION_S = 60;

/**
 * What a MANAGED Soniox session costs to start, in micro-USD, keyed by the
 * STREAM SET it will open rather than by a per-SKU price.
 *
 * The backend refuses to issue a session key below the price of its shortest
 * session at the set's aggregate conservative rate, so gating Start on
 * `balance > 0` — or on the old per-SKU floor — shows a green button to a user
 * who is about to be handed a 402.
 *
 * Split Both opens TWO transcription streams (`spk_stt` + `par_stt`) where
 * every other shape opens one (`spk_stt`, `par_stt` or `mix_stt`); that is
 * what makes split roughly 2× per wall-clock minute. Only one synthesis stream
 * exists in any shape, because the participant leg is hardcoded text-only.
 *
 * KEEP IN SYNC with sokuji-backend's conservative-rate estimate table
 * (`src/services/pricing.ts`) and `src/config/soniox.ts` (MIN_SESSION_S). The
 * estimate table and the list-price table are separate structures there on
 * purpose — one number serving both meanings drifts silently. This is a UI
 * pre-check only; the backend's 402 remains the authority, and the client
 * still surfaces it.
 */
export const SONIOX_MANAGED_MIN_BALANCE_MICRO_USD = {
  /** 1 stt @ $1.10/hr for 60 s */
  one_stt_text_only: 18_334,
  /** 1 stt + 1 tts @ $2.50/hr for 60 s */
  one_stt_speech_to_speech: 41_667,
  /** 2 stt @ $2.20/hr for 60 s */
  two_stt_text_only: 36_667,
  /** 2 stt + 1 tts @ $3.60/hr for 60 s */
  two_stt_speech_to_speech: 60_000,
} as const;

/**
 * The floor that applies to the session the user is about to start.
 *
 * `textOnly` is the same toggle `SonioxClient` uses to pick the mode it asks
 * the backend for. `bothSplit` is true only for split Both — the one shape
 * that opens a second transcription stream — and defaults to false so a caller
 * that predates the toggle keeps today's single-stream floor.
 */
export function sonioxManagedMinBalanceMicroUsd(textOnly: boolean, bothSplit = false): number {
  if (bothSplit) {
    return textOnly
      ? SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_text_only
      : SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_speech_to_speech;
  }
  return textOnly
    ? SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_text_only
    : SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_speech_to_speech;
}
