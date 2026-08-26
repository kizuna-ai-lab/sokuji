/**
 * One readable sentence for a caught value — never a serialisation of it.
 *
 * Its own leaf module, importing only `redact`, so a provider client can use it
 * without importing `report` — which would pull in the store, and which
 * consoleLedger.consistency.test.ts forbids clients from importing as a value.
 * Clients name conditions through `handlers.onDiagnostic`; only MainPanel knows
 * which session leg they are on.
 */
import { redact } from './redact';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * One readable sentence for a caught value — never a serialisation of it.
 *
 * Handles the shapes this codebase actually throws, because "anything else →
 * unknown error" on its own would erase the message from most of them:
 * `ClientEventHandlers.onError` payloads are plain `{message|error}` objects
 * (`apiErrorProps.ts:8-38`), Palabra wraps errors in `{errors:[{title,detail}]}`
 * (`PalabraAIClient.ts:194-201`), and OpenAI in `{error:{message}}`
 * (`EphemeralTokenService.ts:183`).
 */
export function describeCause(cause: unknown): string {
  return redact(describeCauseRaw(cause));
}

function describeCauseRaw(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof DOMException) return `${cause.name}: ${cause.message}`;
  if (cause instanceof Error) return cause.message || cause.name;
  if (!isRecord(cause)) return 'unknown error';

  // Palabra: { errors: [{ title, detail }] }
  const errors = cause.errors;
  if (Array.isArray(errors) && errors.length > 0 && isRecord(errors[0])) {
    const first = errors[0];
    const detail = typeof first.detail === 'string' ? first.detail : undefined;
    const title = typeof first.title === 'string' ? first.title : undefined;
    if (detail || title) return (detail || title) as string;
  }

  // OpenAI: { error: { message } }
  if (isRecord(cause.error) && typeof cause.error.message === 'string') {
    return cause.error.message;
  }

  // Client error event: { message } | { error }
  if (typeof cause.message === 'string' && cause.message) return cause.message;
  if (typeof cause.error === 'string' && cause.error) return cause.error;

  return 'unknown error';
}
