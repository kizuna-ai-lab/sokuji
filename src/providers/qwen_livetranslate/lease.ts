/**
 * Kizuna AI's lease on a managed Qwen LiveTranslate run (spec
 * 2026-10-17-kizuna-managed-qwen, §3–4). `acquire` buys the run's one 60 s
 * Alibaba token from our backend and hands each leg its own
 * `QwenCredentials` — the same grant, dialled by the device directly; it
 * ends the run when the grant does, and `release` tells the backend the run
 * is over. Each leg's `QwenLeasePort` forwards the adapter's session report
 * (the `session.created` id and the handshake's request id) so the backend
 * can match Alibaba's usage log and charge the account. A sibling of
 * Soniox's lease (`../soniox/lease.ts`), self-contained: nothing is shared
 * with it. Not Qwen's session side: `adapter.ts` never reaches this module.
 */
import { AdapterStartError, type AdapterFrame } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { LeaseContext, Resources, RunNotice, RunShape } from '../../lib/session/types';
import { getApiUrl } from '../../utils/environment';
import { isEndpointId, type EndpointId } from './endpoints';
import type { QwenCredentials, QwenLeasePort, QwenSettings } from './settings';

/** One session-key attempt's bound, its body included: a request that never answers must not hold Start. A 409's retry gets its own. */
export const SESSION_KEY_TIMEOUT_MS = 15_000;
/** The wait before a 409's one retry when the body names none (the backend's own is 3 000 ms). */
export const DEFAULT_CONFLICT_RETRY_MS = 3_000;
/** The longest segment a managed run lasts (the backend's cap): a grant held to it ends as a segment, a shorter one is the balance running out. */
export const QWEN_SESSION_CAP_SECONDS = 3_600;
/** `session-end`'s attempts share this budget: none begins after it, and one in flight is aborted at it. */
export const SESSION_END_BUDGET_MS = 4_000;
/** The waits between `session-end`'s attempts: three attempts at most. */
export const SESSION_END_RETRY_DELAYS_MS: readonly number[] = [500, 1_000];
/** The waits between a session report's attempts: four at most; only a transport failure or a 5xx is retried. */
export const SESSION_STARTED_RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000];

export interface QwenLeaseDeps {
  /** `fetch` in the app, read at call time; a stub in tests. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The backend's API root; `getApiUrl()` by default. */
  apiUrl?: () => string;
}

interface Grant {
  leaseId: string;
  endpoint: EndpointId;
  apiKey: string;
  maxSessionDurationSeconds: number;
}

/** A 200's body, checked: a contract break fails the start loudly, and no message carries the key. */
function parseGrant(body: unknown): Grant {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.leaseId !== 'string' || !b.leaseId) throw new Error('The session-key response is missing leaseId.');
  if (typeof b.apiKey !== 'string' || !b.apiKey) throw new Error('The session-key response is missing the grant.');
  if (!isEndpointId(b.endpoint)) throw new Error(`The session-key response names no known endpoint (${String(b.endpoint)}).`);
  const seconds = b.maxSessionDurationSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new Error('The session-key response names no granted duration.');
  return { leaseId: b.leaseId, endpoint: b.endpoint, apiKey: b.apiKey, maxSessionDurationSeconds: seconds };
}

/**
 * A refused session key in the user's words: the code picks the sentence,
 * the message keeps the server's. No wallet figure goes in it: the runner
 * sends a failed start's message to analytics as `error_message`, so a
 * 402's amounts go to the Logs' frame instead (`refusalFrame`).
 */
function refusal(status: number, body: unknown): Error {
  const b = (body ?? {}) as { error?: unknown };
  const server = typeof b.error === 'string' ? b.error : '';
  const detail = server ? `: ${server}` : '';
  switch (status) {
    case 401: return new AdapterStartError(`The session service did not accept the sign-in (HTTP 401${detail}).`, 'sign_in_required');
    case 402: return new AdapterStartError(`The session service refused the start: insufficient balance (HTTP 402${detail}).`, 'insufficient_balance');
    case 403: return new AdapterStartError(`The wallet is frozen (HTTP 403${detail}).`, 'wallet_frozen');
    case 409: return new AdapterStartError(`Another session holds the account's lease (HTTP 409${detail}).`, 'session_conflict');
    case 502: return new AdapterStartError(`Qwen did not mint the session's token (HTTP 502${detail}).`, 'qwen_service_unavailable');
    case 503: return new AdapterStartError(`The Qwen session service is unavailable (HTTP 503${detail}).`, 'qwen_service_busy');
    default: return new Error(server || `Failed to start a managed Qwen session (HTTP ${status})`);
  }
}

/** A refusal as the Logs show it: its status, the server's words, and a 402's figures, which only diagnostics may carry. */
function refusalFrame(status: number, body: unknown): AdapterFrame {
  const b = (body ?? {}) as { error?: unknown; requiredMicroUsd?: unknown; balanceMicroUsd?: unknown };
  return {
    direction: 'in',
    type: 'session.refused',
    payload: {
      status,
      ...(typeof b.error === 'string' ? { error: b.error } : {}),
      ...(typeof b.requiredMicroUsd === 'number' ? { requiredMicroUsd: b.requiredMicroUsd } : {}),
      ...(typeof b.balanceMicroUsd === 'number' ? { balanceMicroUsd: b.balanceMicroUsd } : {}),
    },
  };
}

/** `ms` on the clock, or the abort's reason. */
function wait(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const onAbort = () => {
      cancel();
      reject(signal.reason ?? new Error('aborted'));
    };
    const cancel = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface Ending {
  done: Promise<void>;
  cancel(): void;
}

/**
 * Tells the backend the run is over: a hint that lets its sweep settle the
 * lease before expiry. The first attempt goes with `keepalive`, so it
 * outlives a closing page, and the token cached at acquire, so `pagehide`'s
 * synchronous release sends it before any await. A transport failure or a
 * 5xx is retried, three attempts at most within `SESSION_END_BUDGET_MS`; a
 * 4xx is final.
 */
function signalEnd(
  doFetch: NonNullable<QwenLeaseDeps['fetch']>, url: string, token: string, leaseId: string, clock: Clock, frame: (f: AdapterFrame) => void,
): Ending {
  let cancelled = false;
  let inFlight: AbortController | null = null;
  // Dropped for good once an attempt fails in transport: a runtime that refuses a keepalive request needing a
  // CORS preflight fails it that way, and a plain request still reaches the backend on a normal Stop.
  let keepalive = true;
  const deadline = clock.now() + SESSION_END_BUDGET_MS;
  const attempt = async (): Promise<boolean> => {
    const controller = new AbortController();
    inFlight = controller;
    const cancelTimer = clock.setTimeout(() => controller.abort(), Math.max(0, deadline - clock.now()));
    try {
      const res = await doFetch(url, {
        method: 'POST',
        ...(keepalive ? { keepalive: true } : {}),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId }),
        signal: controller.signal,
      });
      if (res.status >= 500) return false;
      if (!res.ok) frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-end', message: `HTTP ${res.status}` } });
      return true;
    } catch {
      keepalive = false;
      return false;
    } finally {
      cancelTimer();
      inFlight = null;
    }
  };
  const done = (async () => {
    for (let i = 0; ; i += 1) {
      if (cancelled) return;
      if (await attempt()) return;
      const delay = SESSION_END_RETRY_DELAYS_MS[i];
      if (cancelled || delay === undefined || clock.now() + delay >= deadline) break;
      await new Promise<void>((resolve) => { clock.setTimeout(resolve, delay); });
    }
    if (!cancelled) frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-end', message: 'The backend did not acknowledge session-end.' } });
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      inFlight?.abort();
    },
  };
}

/** Kizuna Qwen's `acquire`. One instance per provider: it remembers the last release still retrying, which the next acquire cancels. */
export function createQwenLease(deps: QwenLeaseDeps = {}) {
  const doFetch: NonNullable<QwenLeaseDeps['fetch']> = (url, init) => (deps.fetch ?? fetch)(url, init);
  const apiUrl = () => (deps.apiUrl ?? getApiUrl)();
  /** The previous lease's `session-end` still retrying: the backend scopes it by account, so a late one would end the next lease. */
  let previous: Ending | null = null;

  return async function acquire(shape: RunShape, _s: QwenSettings, ctx: LeaseContext): Promise<Resources<QwenCredentials>> {
    previous?.cancel();
    previous = null;
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
    const token = await shape.auth.getToken();
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
    if (!token) throw new AdapterStartError('Sign in is required to start a managed Qwen session.', 'sign_in_required');
    // What the start asks for: the legs, and which of them speak. The speaker speaks unless text-only; the participant only under Translation I hear.
    const sent = { legs: [...shape.legs], speech: { speaker: !shape.textOnly, participant: shape.participantSpeech } };

    const attempt = async (): Promise<{ status: number; body: unknown }> => {
      // An abort that landed after the 409 wait resolved, before this attempt: its listener below would never fire.
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
      // The request as the Logs show it, never the token; before the POST, so one that never answers shows.
      ctx.frame({ direction: 'out', type: 'session.key_requested', payload: sent });
      const controller = new AbortController();
      let timedOut = false;
      const cancelTimer = ctx.clock.setTimeout(() => { timedOut = true; controller.abort(); }, SESSION_KEY_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await doFetch(`${apiUrl()}/qwen/session-key`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sent),
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch (error) {
          // A body that is not JSON leaves the status to speak; an abort is not that.
          if (controller.signal.aborted) throw error;
        }
        return { status: res.status, body };
      } catch (error) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
        if (timedOut) throw new AdapterStartError('The Qwen session service did not answer within 15 s.', 'qwen_service_unavailable');
        throw new AdapterStartError(`Failed to reach the Qwen session service: ${describeCause(error)}`, 'network', undefined, { cause: error });
      } finally {
        cancelTimer();
        ctx.signal.removeEventListener('abort', onAbort);
      }
    };

    let answer = await attempt();
    if (answer.status === 409) {
      // Once: the account's previous session is very often just finishing its teardown.
      const hint = (answer.body as { retryAfterMs?: unknown } | null)?.retryAfterMs;
      const retryAfterMs = typeof hint === 'number' && Number.isFinite(hint) && hint >= 0 ? hint : DEFAULT_CONFLICT_RETRY_MS;
      ctx.frame({ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs } });
      await wait(ctx.clock, retryAfterMs, ctx.signal);
      answer = await attempt();
    }
    if (answer.status < 200 || answer.status >= 300) {
      ctx.frame(refusalFrame(answer.status, answer.body));
      throw refusal(answer.status, answer.body);
    }
    // A contract break past here leaves a never-reported lease, which the backend frees at its window's end; `session-end` cannot.
    const grant = parseGrant(answer.body);

    const startedAt = ctx.clock.now();
    const totalMs = grant.maxSessionDurationSeconds * 1000;
    // Held to the per-run cap, the grant's end is a segment ending — the balance covers more, and a new Start continues;
    // otherwise the balance is what ran out. Stable English messages: the runner tracks a budget exhaustion as `api_error`,
    // and a message that carried the seconds could not be grouped; the seconds go to the Logs' frame instead.
    const capped = grant.maxSessionDurationSeconds >= QWEN_SESSION_CAP_SECONDS;
    const grantEnd: { notice: RunNotice; expected: boolean } = capped
      ? { notice: { code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, expected: true }
      : { notice: { code: 'budget_exhausted', message: 'Session budget exhausted' }, expected: false };

    let ended = false;
    let released = false;
    let cancelBudget = () => {};
    const endOnce = ({ notice, expected }: { notice: RunNotice; expected: boolean }): void => {
      if (ended || released) return;
      ended = true;
      cancelBudget();
      ctx.frame({ direction: 'in', type: 'session.lease_ended', payload: { code: notice.code, maxSessionDurationSeconds: grant.maxSessionDurationSeconds } });
      ctx.end(notice, { expected });
    };
    cancelBudget = ctx.clock.setTimeout(() => endOnce(grantEnd), totalMs);
    // The grant itself (`apiKey`) is never framed.
    ctx.frame({
      direction: 'in',
      type: 'session.lease_acquired',
      payload: { leaseId: grant.leaseId, endpoint: grant.endpoint, maxSessionDurationSeconds: grant.maxSessionDurationSeconds },
    });

    const reported = new Set<string>();
    /** One session's report: a 4xx is the backend's refusal, final; only a transport failure or a 5xx is retried, and none once the run ended or the lease is released. Never ends the run: an unreported session is still charged by its window. */
    const report = async (leg: LegName, taskUuid: string, requestId: string | undefined): Promise<void> => {
      const body = JSON.stringify({ leaseId: grant.leaseId, leg, taskUuid, ...(requestId ? { requestId } : {}) });
      for (let i = 0; ; i += 1) {
        try {
          const res = await doFetch(`${apiUrl()}/qwen/session-started`, {
            method: 'POST',
            keepalive: true,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body,
          });
          if (res.ok) return;
          if (res.status < 500) {
            let error: string | null = null;
            try {
              const b = (await res.json()) as { error?: unknown } | null;
              if (typeof b?.error === 'string') error = b.error;
            } catch {
              // Not JSON: the status says the report was not accepted.
            }
            ctx.frame({ direction: 'in', type: 'session.started_refused', payload: { status: res.status, error, leg } });
            return;
          }
        } catch {
          // Transport failure: retried below.
        }
        if (ended || released) return;
        const delay = SESSION_STARTED_RETRY_DELAYS_MS[i];
        if (delay === undefined) break;
        await new Promise<void>((resolve) => { ctx.clock.setTimeout(resolve, delay); });
        if (ended || released) return;
      }
      ctx.frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', leg, message: 'The backend did not acknowledge the session report.' } });
    };
    const port = (leg: LegName): QwenLeasePort => ({
      sessionCreated: (id, requestId) => {
        // Once per (leg, id), and never once the grant has ended the run or the lease is released: a late report from a
        // socket still closing must not start a lease the account already ended.
        const key = `${leg}\u0000${id}`;
        if (ended || released || reported.has(key)) return;
        reported.add(key);
        ctx.frame({ direction: 'out', type: 'session.started', payload: { leg, taskUuid: id, ...(requestId ? { requestId } : {}) } });
        // Not awaited, never failing the session.
        void report(leg, id, requestId);
      },
    });

    return {
      credentials(leg: LegName): QwenCredentials {
        if (!shape.legs.includes(leg)) throw new Error(`The ${leg} leg was not requested of this lease.`);
        return { apiKey: grant.apiKey, endpoint: grant.endpoint, lease: port(leg) };
      },
      budget: { totalMs, endsAt: startedAt + totalMs },
      async release(): Promise<void> {
        if (released) return;
        released = true;
        cancelBudget();
        ctx.frame({ direction: 'out', type: 'session.end', payload: { leaseId: grant.leaseId } });
        const ending = signalEnd(doFetch, `${apiUrl()}/qwen/session-end`, token, grant.leaseId, ctx.clock, ctx.frame);
        previous = ending;
        await ending.done;
        if (previous === ending) previous = null;
      },
    };
  };
}
