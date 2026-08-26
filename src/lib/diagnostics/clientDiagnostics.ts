/**
 * The closed vocabulary of client-side diagnostics.
 *
 * A provider client cannot know which session leg it is running on — only
 * MainPanel does — so it cannot file its own panel entry, and it must not
 * import the store or `report()` (enforced by consoleLedger.consistency.test.ts).
 * It emits a code instead, and `participantTelemetry` gives it a channel and a
 * severity.
 *
 * A closed table rather than free-form strings, because the alternative is
 * every client deciding severity for itself: that is exactly the per-call-site
 * judgement #441 exists to remove. Adding a row is a deliberate act with one
 * obvious place to do it.
 *
 * This is the ONLY closed vocabulary in the design. Everything outside a client
 * session calls `reportError`/`reportWarning` with a plain sentence; a
 * general-purpose code table would become a merge-conflict file for the repo's
 * busiest modules without buying anything.
 *
 * Leaf module: imports nothing, so `IClient` can take a type-only dependency on
 * it without pulling the renderer graph into every client.
 */
export const CLIENT_DIAGNOSTICS = {
  /** A frame arrived that could not be parsed. The stream continues. */
  parse_error: { severity: 'warning' },
  /** A teardown step threw. The session is already ending. */
  cleanup_failed: { severity: 'warning' },
  /** Audio capture broke mid-session: nothing further will be transcribed. */
  input_pipeline_failed: { severity: 'error' },
  /** Speech synthesis degraded or dropped; translation text still arrives. */
  tts_degraded: { severity: 'warning' },
  /** An automatic resume attempt failed; further attempts may follow. */
  resume_attempt_failed: { severity: 'warning' },
  /** Outbound audio or text could not be sent and was dropped. */
  send_dropped: { severity: 'warning' },
  /** The requested voice was unavailable and a substitute was used. */
  voice_fallback: { severity: 'warning' },
  /** A managed-session lease notification could not be delivered. */
  lease_notify_failed: { severity: 'warning' },
} satisfies Record<string, { severity: 'error' | 'warning' }>;

export type ClientDiagnosticCode = keyof typeof CLIENT_DIAGNOSTICS;

/** What a client hands to `handlers.onDiagnostic`. */
export interface ClientDiagnostic {
  code: ClientDiagnosticCode;
  /**
   * One readable sentence. Build it with `describeCause` when it comes from a
   * caught value — never pass the caught value itself, which would be an object
   * on a path that ends in a user-visible, clipboard-exportable log.
   */
  message: string;
  /** The caught value, for the console line only. */
  cause?: unknown;
}
