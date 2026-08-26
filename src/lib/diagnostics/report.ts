/**
 * How a caught failure gets recorded. The one place console-vs-panel is decided.
 *
 * CLAUDE.md states the convention "errors logged to logStore for user visibility
 * via LogsPanel"; in practice 154 caught failures across 27 files went to
 * `console.error`/`console.warn`, where a user cannot see them, because nothing
 * decided where a failure should go — so every call site, and every review bot
 * reading that sentence, decided again (#441).
 *
 * The rule this module encodes:
 *
 *   - The console line always fires, synchronously, with the raw `cause`. That
 *     is the developer surface and it keeps stacks, object shapes and
 *     frequency intact.
 *   - A redacted one-sentence `message` reaches LogsPanel one microtask later.
 *     That is the user-diagnostic surface: advanced mode only, English,
 *     copy-pasted into bug reports.
 *   - Nothing here shows UI. A failure the user must act on becomes state on
 *     the owning store and a component renders it. A logger that can pop a
 *     toast is how "which tier is this?" gets re-litigated at every call site.
 *
 * Not a sink for session-scoped client failures: inside an `IClient` session a
 * client uses `handlers.onError` / `onDiagnostic` / `onRealtimeEvent`, because
 * only MainPanel knows which channel (speaker/participant) it is.
 */
import useLogStore, { type ClientId } from '../../stores/logStore';
import { redact } from './redact';

/** True only for `any`, which is the one non-string that `string` would accept. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * A string, and never `any`, `unknown`, `string | undefined`, or an object.
 *
 * `reportError('X', data)` where `data = await response.json()` is a compile
 * error, which is the point: `EphemeralTokenService.ts:200` used to hand a whole
 * response body — client secret included — to `console.error`, and the panel is
 * user-visible and clipboard-exportable. The caught value belongs in `cause`,
 * which never leaves the console.
 *
 * Verified against the repo's tsc: `any`, `unknown`, `string | undefined`,
 * object literals and numbers are all rejected; string literals, `string`,
 * template literals and `Error['message']` all compile.
 */
export type Message<T> = IsAny<T> extends true ? never : T extends string ? T : never;

export interface ReportOptions {
  /** The caught value. Console only — never crosses into the panel. */
  cause?: unknown;
  /**
   * Session leg this failure belongs to. Omit for settings, auth, devices and
   * models: an undefined channel is a global entry, which LogsPanel shows under
   * both tabs rather than mis-filing under "Me".
   */
  clientId?: ClientId;
  /** Panel throttle key; defaults to the message. Use when the message varies per burst. */
  dedupeKey?: string;
}

const THROTTLE_WINDOW_MS = 5000;
const THROTTLE_MAX_KEYS = 100;

/** key → last time it reached the panel. Insertion-ordered, trimmed as an LRU. */
const lastPanelWrite = new Map<string, number>();

function passesThrottle(key: string): boolean {
  const now = Date.now();
  const previous = lastPanelWrite.get(key);
  if (previous !== undefined && now - previous < THROTTLE_WINDOW_MS) return false;

  // Re-insert so the key moves to the end of the iteration order.
  lastPanelWrite.delete(key);
  lastPanelWrite.set(key, now);
  while (lastPanelWrite.size > THROTTLE_MAX_KEYS) {
    const oldest = lastPanelWrite.keys().next().value;
    if (oldest === undefined) break;
    lastPanelWrite.delete(oldest);
  }
  return true;
}

/**
 * Drop all throttle state.
 *
 * Test infrastructure: without it a key throttled by one test silently
 * suppresses the panel entry another test asserts on, which reads as a broken
 * implementation. `setupTests.ts` calls it after every test.
 */
export function resetReportThrottle(): void {
  lastPanelWrite.clear();
}

function emit(
  level: 'error' | 'warning',
  scope: string,
  message: string,
  opts?: ReportOptions,
): void {
  const line = `[Sokuji] [${scope}] ${message}`;
  const write = level === 'error' ? console.error : console.warn;
  if (opts?.cause === undefined) write(line);
  else write(line, opts.cause);

  if (!passesThrottle(`${scope}|${opts?.dedupeKey ?? message}`)) return;

  // Deferred unconditionally. `report()` is reachable from Zustand getters that
  // React calls during render (settingsStore.ts:1236 ←
  // ProviderSpecificSettings.tsx:2377), where a synchronous store write is a
  // setState-during-render. Deferring here means no call site has to know.
  queueMicrotask(() => {
    useLogStore.getState().addLog(`[${scope}] ${message}`, level, opts?.clientId);
  });
}

/** The operation the user asked for did not happen. */
export function reportError<T>(scope: string, message: Message<T>, opts?: ReportOptions): void {
  emit('error', scope, message as string, opts);
}

/** It happened, or will: a fallback ran, a retry is pending, state is in memory but unpersisted. */
export function reportWarning<T>(scope: string, message: Message<T>, opts?: ReportOptions): void {
  emit('warning', scope, message as string, opts);
}

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

/**
 * Let every pending panel write land, then flush logStore's batch.
 *
 * For tests. The microtask is real even under `vi.useFakeTimers()` — fake timers
 * do not fake `queueMicrotask` — so awaiting a resolved promise is enough to
 * drain it; `flushPendingLogs` then moves the batch into `logs`.
 */
export async function settleReports(): Promise<void> {
  await Promise.resolve();
  useLogStore.getState().flushPendingLogs();
}
