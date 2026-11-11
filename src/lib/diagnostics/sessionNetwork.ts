/**
 * The lease-side half of the session-service network diagnostics: the frame
 * that says how one managed endpoint request ended, and why a cancelled one
 * was cancelled.
 *
 * Electron's collector (`electron/session-network-diagnostics.js`) sees the
 * transport — request id, Chromium error, HTTP status, CF-Ray. Only the lease
 * knows what Chromium cannot tell apart: an aborted run and a local deadline
 * both surface as `net::ERR_ABORTED`, and a reissue the lease itself let go is
 * not a network failure at all. So each request the collector watches gets one
 * frame here, keyed by the same stage name.
 *
 * Nothing thrown, no response body and no notice text enters a frame: the
 * payload is an allowlist of facts. The existing frame sink gates it on the
 * Diagnostic logs switch, so nothing here runs unless the user opted in.
 */
import type { LeaseContext } from '../session/types';

/**
 * Every managed endpoint a run's Start, reconnect or end reaches, on both
 * providers. The collector's table and the renderer bridge's table must name
 * the same stages; `sessionNetwork.consistency.test.ts` holds the three
 * copies together.
 */
export type NetworkStage =
  | 'soniox.session-key'
  | 'soniox.reissue'
  | 'soniox.started'
  | 'soniox.end'
  | 'qwen.session-key'
  | 'qwen.reissue'
  | 'qwen.started'
  | 'qwen.end';

/** What the Logs show as the request's path, per stage. Display only: the collector and the bridge each derive their own from the same allowlist. */
export const NETWORK_STAGE_PATHS: Readonly<Record<NetworkStage, string>> = {
  'soniox.session-key': '/api/soniox/session-key',
  'soniox.reissue': '/api/soniox/session-key/reissue',
  'soniox.started': '/api/soniox/session-started',
  'soniox.end': '/api/soniox/session-end',
  'qwen.session-key': '/api/qwen/session-key',
  'qwen.reissue': '/api/qwen/session-key/reissue',
  'qwen.started': '/api/qwen/session-started',
  'qwen.end': '/api/qwen/session-end',
};

/** How one attempt ended, as the lease saw it. */
export type NetworkOutcome = 'response' | 'network' | 'timeout' | 'run_cancelled' | 'lease_released';

/**
 * What an attempt is recorded as when the run or the lease ended around it.
 * The run's abort is named first (it also aborts the attempt's own controller),
 * then the local deadline, then the lease's release; otherwise the attempt's
 * own outcome stands. Only attempts that were actually interrupted get a
 * cancellation label: `session-started` is not wired to a signal, so one that
 * outlives the run still records what it did.
 */
export function interruptedOutcome(
  outcome: NetworkOutcome,
  flags: { runCancelled?: boolean; timedOut?: boolean; released?: boolean } = {},
): NetworkOutcome {
  if (flags.runCancelled) return 'run_cancelled';
  if (flags.timedOut) return 'timeout';
  if (flags.released) return 'lease_released';
  return outcome;
}

/**
 * The run end reasons that may be named beside a cancelled request. Anything
 * else a context reports is dropped: a diagnostic frame is not a place for
 * free text.
 */
const CANCELLATION_CAUSES: ReadonlySet<string> = new Set([
  'user', 'refused', 'start-failed', 'leg-failed', 'leg-closed', 'source-ended', 'lease-ended', 'page-hidden',
]);

/**
 * One attempt's recorder. Call it once, when the attempt ends: a response
 * (`status` given), a transport failure, the local deadline, the run's abort,
 * or the lease letting the request go.
 */
export function recordNetworkAttempt(ctx: LeaseContext, stage: NetworkStage): (outcome: NetworkOutcome, status?: number) => void {
  const started = ctx.clock.now();
  const timestamp = started;
  const path = NETWORK_STAGE_PATHS[stage];
  return (outcome, status) => {
    const cause = outcome === 'run_cancelled' ? ctx.cancellationCause?.() : undefined;
    const cancellationCause = cause && CANCELLATION_CAUSES.has(cause) ? cause : undefined;
    ctx.frame({
      direction: 'out', type: 'session.network',
      payload: {
        stage, path, timestamp,
        durationMs: Math.max(0, Math.round(ctx.clock.now() - started)),
        outcome,
        ...(cancellationCause ? { cancellationCause } : {}),
        ...(status === undefined ? {} : { status }),
      },
    });
  };
}
