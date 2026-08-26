/**
 * The one secret-pattern list.
 *
 * Leaf module: imports nothing, so `logStore` can depend on it without gaining
 * an edge to anything else (see the design's import-graph section).
 *
 * Redaction lives at the SINKS — `logStore.addLog` and `sanitizeEvent` — not at
 * the call sites. Sink-side is the only placement that also covers the legacy
 * `addLog` callers and any future bypass; a call-site rule is a review comment,
 * not a guarantee.
 *
 * Every pattern below is traced to the line that produces the shape. A pattern
 * with no named source is not added: panel text is user-visible and
 * clipboard-exportable, so each rule has to earn its false-positive risk.
 */

/** Replacement is bare `[REDACTED]`, matching what `errorTracking` already emits. */
const REDACTED = '[REDACTED]';

/**
 * Carrier-first: rules that keep a naming prefix run before the bare-token
 * rules, so `?key=AIza…` reports which parameter was dropped rather than
 * collapsing to an anonymous `[REDACTED]`.
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // `${MODELS_ENDPOINT}?key=${apiKey}` — GeminiClient.ts:138-139. Also covers the
  // token/secret parameter names used by the relay and Volcengine signed URLs.
  [
    /([?&](?:key|api_key|apikey|token|access_token|accessToken|secret|signature)=)[^&\s"']+/gi,
    `$1${REDACTED}`,
  ],
  // `Authorization: Bearer <token>` on every provider fetch.
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
  // `sokuji-auth.${this.apiKey}` WebSocket subprotocol — OpenAITranslateGAClient.ts:501,
  // VolcengineAST2Client (relay auth).
  [/(\bsokuji-auth\.)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`],
  // Bare provider key shapes. `sk-`/`AIza`/`key-` were already redacted by
  // errorTracking.ts:57; `ek_` is the OpenAI ephemeral client secret
  // (EphemeralTokenService.ts:190), which :200 could otherwise dump wholesale.
  [/\b(?:sk-|AIza|key-|ek_)[A-Za-z0-9_-]{10,}\b/g, REDACTED],
  // Account addresses — named in #441. Reached via the wallet and auth paths
  // (UserProfileContext, settingsStore.ts:1121).
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED],
];

/** Replace every known credential shape in `text`. Safe on any string. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
