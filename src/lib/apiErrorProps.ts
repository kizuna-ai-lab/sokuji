import type { AnalyticsEvents } from './analytics';

/**
 * The error shape clients hand to `ClientEventHandlers.onError`. It is `any` on
 * the interface and every client fills a different subset, so everything here
 * is optional.
 */
export interface ClientErrorEvent {
  /** Provider wire code: '503', 408, 'socket_error', 'auth_failed', … */
  code?: string | number;
  /** What the UI shows. May be localized — see `rawMessage`. */
  message?: string;
  /**
   * The provider's own, untranslated words, when `message` is not them.
   *
   * A client that localizes `message` (so the conversation bubble reads well
   * in the user's language) must put the original here, or the same failure
   * reaches analytics as one of 30 translations of one sentence and cannot be
   * grouped at all. Clients whose `message` is already the raw text — most of
   * them — simply omit this.
   */
  rawMessage?: string;
  /** Older clients pass the description here instead of `message`. */
  error?: string;
  type?: string;
}

/**
 * The text a human should see for this error.
 *
 * Deliberately a DIFFERENT precedence from `error_message` below: the bubble
 * wants the localized `message`, analytics wants the untranslated `rawMessage`.
 * Exported so the conversation bubble and the log entry are built from one
 * expression instead of two copies that drift.
 */
export function clientErrorMessage(event: ClientErrorEvent): string {
  return event.message || event.error || 'Unknown error';
}

/**
 * Map a client error onto the `api_error` analytics event.
 *
 * Lives in its own module rather than inline in MainPanel's `onError` handler:
 * MainPanel has no test file, and which string becomes `error_message` is a
 * decision, not plumbing — it decides whether outages are groupable.
 */
export function buildApiErrorProps(
  event: ClientErrorEvent,
  provider: string,
  /** Which audio leg reported it. Optional so existing single-leg call sites
   *  keep compiling; every MainPanel call site names one. */
  channel?: 'speaker' | 'participant'
): AnalyticsEvents['api_error'] {
  const code = event.code === undefined || event.code === null || event.code === ''
    ? undefined
    : String(event.code);
  return {
    provider,
    error_message: event.rawMessage || event.message || event.error || 'Unknown error',
    // Omitted rather than set to undefined: an absent property and a property
    // whose value is undefined are different rows once they reach PostHog.
    ...(code === undefined ? {} : { error_code: code }),
    // Same reasoning as error_code: omitted, not undefined.
    ...(channel === undefined ? {} : { channel }),
    // Deliberately unchanged. `type` is set by almost no client, so this has
    // always resolved to 'server' in practice — including for transport-level
    // failures that are anything but. Correcting it would shift the meaning of
    // an existing analytics dimension, which needs a look at what queries it
    // first; `error_code` now carries the truth in the meantime.
    error_type: event.type === 'error' ? 'client' : 'server',
  };
}
