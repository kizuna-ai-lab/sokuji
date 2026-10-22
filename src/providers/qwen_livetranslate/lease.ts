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
import { asQwenRegion, QWEN_REGIONS, type QwenRegion } from './regions';
import type { QwenCredentials, QwenLeasePort, QwenSettings } from './settings';

/** What the backend accepts as a handshake request id (sokuji-backend `routes/qwen.ts`). */
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One session-key attempt's bound, its body included: a request that never answers must not hold Start. A 409's retry gets its own. */
export const SESSION_KEY_TIMEOUT_MS = 15_000;
/** The wait before a 409's one retry when the body names none (the backend's own hint varies with the client's version). */
export const DEFAULT_CONFLICT_RETRY_MS = 3_000;
/** How long a Start waits, in all, for a blocking session that is ending or never started to clear. Longer than Soniox's 60 s: a never-started Qwen lease holds its whole start window, 60 s plus the backend's 15 s margin. */
export const CONFLICT_WAIT_LIMIT_MS = 90_000;
/** Between asks while the blocking session is ending: a Qwen lease is freed once Alibaba's log has its session, about 15 s after it ends. */
export const ENDING_POLL_MS = 5_000;
/** Before asking again after a lease freed as the backend read it. */
export const RELEASED_RETRY_MS = 1_000;
/** Past a never-started lease's expiry, so the next ask finds it gone. */
const UNSTARTED_SLACK_MS = 1_000;

/**
 * What blocks the account, as a 409 names it (sokuji-backend `ConflictBlocker`),
 * whichever provider's lease it is, since the account's one-session lock is
 * shared with Kizuna Soniox: a lease whose session never started (`clearsInMs`
 * until its start window frees it), a session already ending, a session
 * running elsewhere, or a lease freed as it was read. Null when the body names
 * none (an older backend, a failed read): the one retry after `retryAfterMs`
 * stands, as before.
 */
type Blocker =
  | { state: 'unstarted'; clearsInMs: number }
  | { state: 'ending' | 'active' | 'released' };

function blockerOf(body: unknown): Blocker | null {
  const raw = (body as { blocker?: unknown } | null)?.blocker as { state?: unknown; clearsInMs?: unknown } | undefined;
  switch (raw?.state) {
    case 'unstarted':
      return typeof raw.clearsInMs === 'number' && Number.isFinite(raw.clearsInMs) && raw.clearsInMs >= 0
        ? { state: 'unstarted', clearsInMs: raw.clearsInMs }
        : null;
    case 'ending':
    case 'active':
    case 'released':
      return { state: raw.state };
    default:
      return null;
  }
}
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
  /** The region the keys were bought in; absent from a backend before the Beijing region. The endpoint, not this, is what the leg dials. */
  region?: QwenRegion;
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
  let region: QwenRegion | undefined;
  if (b.region !== undefined) {
    if (typeof b.region !== 'string' || !(QWEN_REGIONS as readonly string[]).includes(b.region)) throw new Error(`The session-key response names no known region (${String(b.region)}).`);
    region = b.region as QwenRegion;
  }
  return { leaseId: b.leaseId, endpoint: b.endpoint, ...(region ? { region } : {}), apiKey: b.apiKey, maxSessionDurationSeconds: seconds };
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
    case 409:
      switch (blockerOf(body)?.state) {
        case 'active': return new AdapterStartError(`A session running elsewhere holds the account's lease (HTTP 409${detail}).`, 'session_in_use');
        case 'ending':
        case 'unstarted': return new AdapterStartError(`The account's previous session has not cleared (HTTP 409${detail}).`, 'previous_session_ending');
        default: return new AdapterStartError(`Another session holds the account's lease (HTTP 409${detail}).`, 'session_conflict');
      }
    case 502: return new AdapterStartError(`Qwen did not mint the session's token (HTTP 502${detail}).`, 'qwen_service_unavailable');
    case 503:
      // The backend's three 503s, told apart by its `error`: its per-minute cap (`qwen_busy`, with a
      // `retryAfterMs`) is "busy"; a region it has no pricing or workspace for yet is the region's;
      // the rest (its wallet, say) is the service's.
      if (server === 'qwen_busy') return new AdapterStartError(`The Qwen session service is at capacity (HTTP 503${detail}).`, 'qwen_service_busy');
      if (server === 'Qwen region not available') return new AdapterStartError(`The session service does not serve the region picked right now (HTTP 503${detail}).`, 'qwen_region_unavailable');
      return new AdapterStartError(`The Qwen session service is unavailable (HTTP 503${detail}).`, 'qwen_service_unavailable');
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
  /** The previous lease's `session-end` still retrying: stopped at the next acquire. The backend marks only the lease it names, so a late one ends nothing new; retrying it past the next Start only spends requests. */
  let previous: Ending | null = null;

  return async function acquire(shape: RunShape, s: QwenSettings, ctx: LeaseContext): Promise<Resources<QwenCredentials>> {
    previous?.cancel();
    previous = null;
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
    const token = await shape.auth.getToken();
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
    if (!token) throw new AdapterStartError('Sign in is required to start a managed Qwen session.', 'sign_in_required');
    // What the start asks for: the legs, which of them speak, the region the keys are bought in, and whether this run has a screen.
    // The speaker speaks unless text-only; the participant only under Translation I hear. The region is the setting's, narrowed:
    // the backend answers with its own.
    const sent = {
      legs: [...shape.legs],
      speech: { speaker: shape.legs.includes('speaker') && !shape.textOnly, participant: shape.legs.includes('participant') && shape.participantSpeech },
      region: asQwenRegion(s.region),
      // The truth of this run, not the switch: a cancelled pick sent no source, so it is not billed the add-on.
      screenContext: shape.frames !== undefined,
    };

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
    // A 409 that names what blocks the account is waited out while that is a
    // session ending or one that never started, up to CONFLICT_WAIT_LIMIT_MS;
    // a session running elsewhere, or a 409 that names nothing, gets the one
    // retry after the backend's hint, as before. Kizuna Soniox's lease waits the same way.
    const deadline = ctx.clock.now() + CONFLICT_WAIT_LIMIT_MS;
    let retried = false;
    let waitingShown = false;
    try {
      while (answer.status === 409) {
        const blocker = blockerOf(answer.body);
        let delay: number;
        if (blocker?.state === 'ending') delay = ENDING_POLL_MS;
        else if (blocker?.state === 'unstarted') delay = blocker.clearsInMs + UNSTARTED_SLACK_MS;
        else if (blocker?.state === 'released') delay = RELEASED_RETRY_MS;
        else {
          if (retried) break;
          retried = true;
          const hint = (answer.body as { retryAfterMs?: unknown } | null)?.retryAfterMs;
          delay = typeof hint === 'number' && Number.isFinite(hint) && hint >= 0 ? hint : DEFAULT_CONFLICT_RETRY_MS;
        }
        if (blocker && ctx.clock.now() + delay > deadline) break;
        ctx.frame({ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs: delay, ...(blocker ? { blocker: blocker.state } : {}) } });
        if (!waitingShown && (blocker?.state === 'ending' || blocker?.state === 'unstarted')) {
          waitingShown = true;
          ctx.waiting?.(true);
        }
        await wait(ctx.clock, delay, ctx.signal);
        answer = await attempt();
      }
    } finally {
      if (waitingShown) ctx.waiting?.(false);
    }
    if (answer.status < 200 || answer.status >= 300) {
      ctx.frame(refusalFrame(answer.status, answer.body));
      throw refusal(answer.status, answer.body);
    }
    // A contract break past here leaves a never-reported lease, which the backend frees at its window's end; `session-end` cannot.
    const grant = parseGrant(answer.body);
    // The grant must name the region picked, under a tooltip that says the audio stays there: a grant naming none is
    // Singapore's (the backend before the Beijing region ignored `region`), so only a Singapore pick accepts it. The
    // notice is the region's, as for a 503 naming it: the sentence says to pick another.
    if ((grant.region ?? 'sg') !== sent.region) {
      ctx.frame({ direction: 'in', type: 'session.refused', payload: { status: answer.status, region: sent.region, served: grant.region ?? null } });
      throw new AdapterStartError(
        `The session service did not serve the ${sent.region} region picked (it answered ${grant.region ?? 'no region'}).`,
        'qwen_region_unavailable',
      );
    }

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
      payload: { leaseId: grant.leaseId, endpoint: grant.endpoint, ...(grant.region ? { region: grant.region } : {}), maxSessionDurationSeconds: grant.maxSessionDurationSeconds },
    });

    const reported = new Set<string>();
    /** Aborted by `release`: a report's retry wait leaves no timer behind. */
    const stopReports = new AbortController();
    /** One session's report: a 4xx is the backend's refusal, final; only a transport failure or a 5xx is retried, and none once the run ended or the lease is released. Never ends the run: an unreported session is still charged by its window. */
    const report = async (leg: LegName, taskUuid: string, requestId: string | undefined): Promise<void> => {
      const body = JSON.stringify({ leaseId: grant.leaseId, leg, taskUuid, ...(requestId ? { requestId } : {}) });
      // Dropped for good after a transport failure, as `signalEnd` does: a runtime may refuse a keepalive request as a transport error.
      let keepalive = true;
      let last = '';
      for (let i = 0; ; i += 1) {
        try {
          const res = await doFetch(`${apiUrl()}/qwen/session-started`, {
            method: 'POST',
            ...(keepalive ? { keepalive: true } : {}),
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
          last = `HTTP ${res.status}`;
        } catch (error) {
          keepalive = false;
          last = describeCause(error);
        }
        if (ended || released) return;
        const delay = SESSION_STARTED_RETRY_DELAYS_MS[i];
        if (delay === undefined) break;
        try {
          await wait(ctx.clock, delay, stopReports.signal);
        } catch {
          return;
        }
        if (ended || released) return;
      }
      ctx.frame({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', leg, message: `The backend did not acknowledge the session report (${last}).` } });
    };
    const port = (leg: LegName): QwenLeasePort => ({
      sessionCreated: (id, rawRequestId) => {
        // The backend answers 400 to anything but a lowercase UUID, a final refusal that would lose the session id too: send it as it came, or not at all.
        const requestId = rawRequestId !== undefined && REQUEST_ID_RE.test(rawRequestId) ? rawRequestId : undefined;
        // Once per (leg, id), and never once the grant has ended the run or the lease is released: a late report from a
        // socket still closing must not start a lease the account already ended.
        const key = `${leg}\u0000${id}`;
        if (ended || released || reported.has(key)) return;
        reported.add(key);
        ctx.frame({ direction: 'out', type: 'session.started', payload: { leg, taskUuid: id, withRequestId: Boolean(requestId) } });
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
        stopReports.abort();
        ctx.frame({ direction: 'out', type: 'session.end', payload: { leaseId: grant.leaseId } });
        const ending = signalEnd(doFetch, `${apiUrl()}/qwen/session-end`, token, grant.leaseId, ctx.clock, ctx.frame);
        previous = ending;
        await ending.done;
        if (previous === ending) previous = null;
      },
    };
  };
}
