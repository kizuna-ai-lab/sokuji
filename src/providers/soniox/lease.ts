/**
 * Kizuna AI's lease on a managed Soniox session (Stage 2 Kizuna Soniox;
 * survey §1.2–1.7, §2.4–2.5). `acquire` buys the session's keys from our
 * backend — one STT key per transcription stream, the TTS key of the same
 * side, each bound to its own client reference — and hands each leg its
 * own `SonioxCredentials`; it ends the run when the grant does, and
 * `release` tells the backend the session is over. Ported from
 * `ManagedSonioxSession` (`src/services/clients/ManagedSonioxSession.ts`,
 * read-only until Plan B2), with every timer on the run's clock and every
 * wait abortable. Not Soniox's session side: `adapter.ts` never reaches
 * this module. The participant's speech key is mapped only while the
 * participant-speech flag is on (ruling 2).
 */
import { AdapterStartError, type AdapterFrame } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { LeaseContext, Resources, RunNotice, RunShape } from '../../lib/session/types';
import { SONIOX_REGIONS, type SonioxRegion } from '../../lib/soniox/regions';
import { getApiUrl } from '../../utils/environment';
import { sonioxSessionCapSeconds } from './kizunaBudget';
import { isSttRole, leaseRequest, requestBody, roleFor, sideOf, STREAM_ROLES, type SttRole, type StreamRole } from './leaseRequest';
import type { SonioxCredentials, SonioxSettings } from './settings';

/** One session-key attempt's bound, its body included (choice 5): a request that never answers must not hold Start. A 409's retry gets its own. */
export const SESSION_KEY_TIMEOUT_MS = 15_000;
/** The wait before a 409's one retry when the body names none (the backend's own is 3 000 ms). */
export const DEFAULT_CONFLICT_RETRY_MS = 3_000;
/** `session-end`'s attempts share this budget (ruling 10): none begins after it, and one in flight is aborted at it. */
export const SESSION_END_BUDGET_MS = 4_000;
/** The waits between `session-end`'s attempts: three attempts at most. */
export const SESSION_END_RETRY_DELAYS_MS: readonly number[] = [500, 1_000];

export interface KizunaLeaseDeps {
  /** The participant-speech flag (ruling 2): the definition's, handed over by its factory. Off by default, as shipped. */
  participantSpeech?: boolean;
  /** `fetch` in the app, read at call time; a stub in tests (ruling 12). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The backend's API root; `getApiUrl()` by default. */
  apiUrl?: () => string;
}

interface Grant {
  leaseId: string;
  region: SonioxRegion;
  maxSessionDurationSeconds: number;
  streams: Array<{ role: StreamRole; apiKey: string; clientReferenceId: string }>;
}

/** A 200's body, checked: a contract break fails the start loudly (ruling 10) — no flat-field or region fallback, no key in any message. */
function parseGrant(body: unknown): Grant {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.leaseId !== 'string' || !b.leaseId) throw new Error('The session-key response is missing leaseId.');
  if (typeof b.clientReferenceId !== 'string' || !b.clientReferenceId) throw new Error('The session-key response is missing clientReferenceId.');
  // The region the keys belong to is the response's, never the request's.
  if (typeof b.region !== 'string' || !(SONIOX_REGIONS as readonly string[]).includes(b.region)) {
    throw new Error(`The session-key response names no known region (${String(b.region)}).`);
  }
  const seconds = b.maxSessionDurationSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new Error('The session-key response names no granted duration.');
  if (!Array.isArray(b.streams) || b.streams.length === 0) throw new Error('The session-key response issued no streams.');
  const streams = b.streams.map((raw: unknown) => {
    const st = (raw ?? {}) as Record<string, unknown>;
    if (!STREAM_ROLES.includes(st.role as StreamRole) || typeof st.apiKey !== 'string' || typeof st.clientReferenceId !== 'string') {
      throw new Error(`The session-key response issued a malformed stream (${String(st.role)}).`);
    }
    return { role: st.role as StreamRole, apiKey: st.apiKey, clientReferenceId: st.clientReferenceId };
  });
  return { leaseId: b.leaseId, region: b.region as SonioxRegion, maxSessionDurationSeconds: seconds, streams };
}

/**
 * A refused session key in the user's words (choice 5): the code picks the
 * sentence, the message keeps the server's. No wallet figure goes in it:
 * the runner sends a failed start's message to analytics as
 * `error_message`, so a 402's amounts go to the Logs' frame instead
 * (`refusalFrame`).
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
    case 502: return new AdapterStartError(`Soniox did not mint the session's keys (HTTP 502${detail}).`, 'soniox_service_unavailable');
    // All three of the backend's 503 bodies, as the old client worded them (survey §1.12.3).
    case 503: return new AdapterStartError(`The Soniox session service is unavailable (HTTP 503${detail}).`, 'soniox_service_busy');
    default: return new Error(server || `Failed to start a managed Soniox session (HTTP ${status})`);
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
 * Tells the backend the session is over (choice 6): a hint that lets its
 * sweep settle the lease before expiry (`routes/soniox.ts:820-864`). The
 * first attempt goes with `keepalive`, so it outlives a closing page, and
 * the token cached at acquire, so `pagehide`'s synchronous release sends it
 * before any await. A transport failure or a 5xx is retried, three attempts
 * at most within `SESSION_END_BUDGET_MS`; a 4xx is final.
 */
function signalEnd(
  doFetch: NonNullable<KizunaLeaseDeps['fetch']>, url: string, token: string, leaseId: string, clock: Clock, frame: (f: AdapterFrame) => void,
): Ending {
  let cancelled = false;
  let inFlight: AbortController | null = null;
  // Dropped for good once an attempt fails in transport: a runtime that refuses a keepalive request needing a
  // CORS preflight fails it that way, and a plain request still reaches the backend on a normal Stop, as the
  // old client's did. A 5xx is the backend's answer, so it keeps the flag.
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

/** Kizuna Soniox's `acquire`. One instance per provider: it remembers the last release still retrying, which the next acquire cancels. */
export function createKizunaLease(deps: KizunaLeaseDeps = {}) {
  const doFetch: NonNullable<KizunaLeaseDeps['fetch']> = (url, init) => (deps.fetch ?? fetch)(url, init);
  const apiUrl = () => (deps.apiUrl ?? getApiUrl)();
  const participantSpeech = deps.participantSpeech ?? false;
  /** The previous lease's `session-end` still retrying: the backend scopes it by account, so a late one would end the next lease (survey §1.2). */
  let previous: Ending | null = null;

  return async function acquire(shape: RunShape, s: SonioxSettings, ctx: LeaseContext): Promise<Resources<SonioxCredentials>> {
    previous?.cancel();
    previous = null;
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
    const token = await shape.auth.getToken();
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
    if (!token) throw new AdapterStartError('Sign in is required to start a managed Soniox session.', 'sign_in_required');
    const request = leaseRequest(shape, s, participantSpeech);

    const attempt = async (): Promise<{ status: number; body: unknown }> => {
      // An abort that landed after the 409 wait resolved, before this attempt: its listener below would never fire.
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted');
      const controller = new AbortController();
      let timedOut = false;
      const cancelTimer = ctx.clock.setTimeout(() => { timedOut = true; controller.abort(); }, SESSION_KEY_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await doFetch(`${apiUrl()}/soniox/session-key`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody(request)),
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
        if (timedOut) throw new AdapterStartError('The Soniox session service did not answer within 15 s.', 'soniox_service_unavailable');
        throw new AdapterStartError(`Failed to reach the Soniox session service: ${describeCause(error)}`, 'network', undefined, { cause: error });
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
    // A contract break past here leaves a never-started lease, which the
    // backend frees at its start window's end; `session-end` cannot (survey §1.2).
    const grant = parseGrant(answer.body);

    // Ruling 2: a `par_tts` is the participant's only while the flag is on; off, one in an answer is ignored.
    const streams = participantSpeech ? grant.streams : grant.streams.filter((st) => st.role !== 'par_tts');
    const bundles = new Map<SttRole, SonioxCredentials>();
    for (const st of streams) {
      if (!isSttRole(st.role)) continue;
      // The TTS key of the same side rides this STT stream: split Both's one `spk_tts` stays on the speaker, a `par_tts` goes with `par_stt`.
      const tts = streams.find((t) => !isSttRole(t.role) && sideOf(t.role) === sideOf(st.role));
      bundles.set(st.role, { region: grant.region, stt: st.apiKey, ...(tts ? { tts: tts.apiKey } : {}), clientReferenceId: st.clientReferenceId });
    }
    for (const leg of shape.legs) {
      const role = roleFor(request, leg);
      if (role && !bundles.has(role)) throw new Error(`The session-key response issued no key for ${role}, which the ${leg} leg runs on.`);
    }

    const startedAt = ctx.clock.now();
    const totalMs = grant.maxSessionDurationSeconds * 1000;
    // The backend caps what it minted (`maxSessionSecondsFor(roles)`, `BE:src/routes/soniox.ts:84`), whatever the flag: the words follow the minted set.
    const speaks = grant.streams.some((st) => !isSttRole(st.role));
    // Ruling 3: held to the per-session cap, the grant's end is a segment
    // ending — the balance covers more, and a new Start continues;
    // otherwise the balance is what ran out.
    const capped = grant.maxSessionDurationSeconds >= sonioxSessionCapSeconds(speaks);
    // Stable English messages: the runner tracks a budget exhaustion as
    // `api_error` (ruling 8), and a message that carried the seconds could
    // not be grouped; the seconds go to the Logs' frame instead. The end
    // at the cap is the normal end of a segment: `expected`, untracked.
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
    ctx.frame({
      direction: 'in',
      type: 'session.lease_acquired',
      payload: { leaseId: grant.leaseId, region: grant.region, roles: grant.streams.map((st) => st.role), maxSessionDurationSeconds: grant.maxSessionDurationSeconds },
    });

    return {
      credentials(leg: LegName): SonioxCredentials {
        if (!shape.legs.includes(leg)) throw new Error(`The ${leg} leg was not requested of this lease.`);
        const role = roleFor(request, leg);
        if (role) return { ...bundles.get(role)! };
        // Shared Both's participant rides the speaker's mixed socket: the
        // adapter reads only its region, its reference and its TTS key,
        // for its own TTS socket (`adapter.ts:80-86`). That key is
        // `par_tts`, with its own reference, while the flag is on and the
        // answer carries one; otherwise it has none and speaks nothing.
        const mix = bundles.get('mix_stt')!;
        const tts = streams.find((st) => st.role === 'par_tts');
        return tts
          ? { region: mix.region, stt: mix.stt, tts: tts.apiKey, clientReferenceId: tts.clientReferenceId }
          : { region: mix.region, stt: mix.stt, clientReferenceId: mix.clientReferenceId };
      },
      budget: { totalMs, endsAt: startedAt + totalMs },
      async release(): Promise<void> {
        if (released) return;
        released = true;
        cancelBudget();
        ctx.frame({ direction: 'out', type: 'session.end', payload: { leaseId: grant.leaseId } });
        const ending = signalEnd(doFetch, `${apiUrl()}/soniox/session-end`, token, grant.leaseId, ctx.clock, ctx.frame);
        previous = ending;
        await ending.done;
        if (previous === ending) previous = null;
      },
    };
  };
}
