/**
 * The reconnect policy every adapter shares (#692): when the attempts run,
 * how long they may run, and when a connection that keeps dropping is let
 * go. An adapter owns one reconnector per connection. It tells the
 * reconnector a connection dropped and judged the cause retryable; the
 * reconnector calls back into the adapter for each attempt (credentials,
 * connect, bring the socket live), reports the outcome, and writes the
 * diagnostic frames. It never learns whether the session is managed.
 *
 * Platform-neutral on purpose (the mobile app imports it): no DOM, React,
 * Electron, store or reporter imports, and every timer and clock read goes
 * through the injected `Clock`.
 */
import type { Clock } from '../contract/clock';
import type { DropInfo, ReconnectedInfo, GiveUp } from '../contract/reconnect';

export type { DropCause, DropInfo, ReconnectedInfo, GiveUp } from '../contract/reconnect';

/** The wait before attempt 1, 2, … 6; every attempt after that waits `RECONNECT_REPEAT_MS`. A flapping drop starts further down (`FLAP_WINDOW_MS`). */
export const RECONNECT_DELAYS_MS: readonly number[] = [0, 250, 500, 1000, 2000, 4000];
export const RECONNECT_REPEAT_MS = 4000;
/** From the drop to giving up. */
export const RECONNECT_BUDGET_MS = 30000;
/**
 * A drop this soon after a reconnect is a flap: it continues the previous
 * drop's budget instead of getting a fresh one, and the k-th flap in a row
 * starts k steps down the ladder, so a connection that keeps coming back
 * only to drop again backs off as if it had never come back.
 */
export const FLAP_WINDOW_MS = 10000;
/** A shared budget is never left with less than this, so the attempts get a real chance. */
export const FLAP_MIN_REMAINING_MS = 5000;
/** The backstop over a long session; the flapping rule is what normally stops a runaway loop. */
export const MAX_RECONNECTS = 100;
/** The flapping rule's limit: the drop after this many reconnects inside any minute gives up, as at `MAX_RECONNECTS`. */
export const MAX_RECONNECTS_PER_MINUTE = 10;
const MINUTE_MS = 60000;

export type AttemptResult =
  | { ok: true; reissued: boolean; reissueMs: number }
  | { ok: false; final: false; code?: string; message: string; reissued: boolean; reissueMs: number }
  | { ok: false; final: true; reason: 'refused' | 'terminal_error' | 'lease_ended'; code: string; message: string; refusalCode?: string };

export interface ReconnectorOptions {
  clock: Clock;
  frame(type: string, payload: Record<string, unknown>): void;
  /** Before each attempt — a flapping drop's first at the drop, ahead of its wait; `drop` only on the first. */
  reconnecting(e: { attempt: number; drop?: DropInfo }): void;
  reconnected(e: ReconnectedInfo): void;
  gaveUp(e: GiveUp): void;
  /**
   * One attempt. The signal (shared by all attempts of a drop) aborts when the deadline's timer runs and on `cancel()`; an answer
   * after that is abandoned. A success read before that timer has run is taken, even past the deadline's time (a throttled page's
   * late timer): its connection is already live, and ending it would be worse than a reconnect that came late.
   */
  attempt(ctx: { attempt: number; signal: AbortSignal }): Promise<AttemptResult>;
}

export interface Reconnector {
  /**
   * The connection dropped and the adapter judged it retryable. While an attempt is in flight, it is that attempt's connection dropping
   * before its answer was read: the attempt fails however it answers, and the next one follows on the same drop's ladder and budget.
   * Ignored during a wait, and after the reconnector finished.
   * Break before make: the caller must already have detached and closed the dropped socket, because attempt 1 may run synchronously inside this call.
   * The `AbortSignal` passed to `attempt` is shared by every attempt of one drop, so a listener added per attempt must be removed when the attempt ends.
   */
  dropped(drop: DropInfo): void;
  /** The network is back: a waiting attempt starts now; during an attempt, the next one skips its delay. */
  wake(): void;
  /** The session ended. Stops everything and emits nothing. */
  cancel(): void;
  readonly active: boolean;
}

const LOST = 'connection_lost';

/**
 * A lease's refusal to reissue, as the attempt's answer (spec §6): final.
 * The two the user can act on show as themselves; any other as the
 * connection lost, its own code kept as `refusalCode`; `lease_ended` gives
 * up as such.
 */
export function refusalResult(answer: { code: string; message: string }): AttemptResult {
  const actionable = answer.code === 'sign_in_required' || answer.code === 'wallet_frozen';
  return {
    ok: false, final: true, reason: answer.code === 'lease_ended' ? 'lease_ended' : 'refused',
    code: actionable ? answer.code : LOST, message: answer.message, refusalCode: answer.code,
  };
}

/** A reissue that could not answer (a 5xx, its per-minute limit, the network, a timeout): a failed attempt, the next one asking again; the time it took counts. */
export function reissueFailed(message: string, reissueMs: number): AttemptResult {
  return { ok: false, final: false, code: 'reissue_failed', message, reissued: false, reissueMs };
}

/** Server-side ends we retry: a transport-level close. Everything else, including an unknown code, says the request or the session is over. */
export function closeCodeAction(code: number | undefined): 'reconnect' | 'end' {
  if (code === undefined) return 'end';
  if (code === 1000 || code === 1001 || code === 1005 || code === 1006) return 'reconnect';
  return code >= 1011 && code <= 1014 ? 'reconnect' : 'end';
}

interface Cycle {
  droppedAt: number;
  deadline: number;
  shared: boolean;
  /** How far down the ladder its attempt 1 starts: k for the k-th flap in a row, 0 for a drop that is no flap. */
  step: number;
  attempt: number;
  /** `reconnecting` already said attempt `attempt`, which has not started yet (a flapping drop's first, during its wait). */
  announced: boolean;
  /** The connection the attempt in flight brought back dropped before its answer was read. */
  droppedBehind: boolean;
  reissued: boolean;
  reissueMs: number;
  lastCode?: string;
  lastMessage?: string;
  inFlight: boolean;
  skipDelay: boolean;
  controller: AbortController;
  cancelWait: (() => void) | null;
  cancelDeadline: () => void;
}

export function createReconnector(o: ReconnectorOptions): Reconnector {
  const { clock } = o;
  let cycle: Cycle | null = null;
  /** Cancelled, or gave up: nothing more happens. */
  let finished = false;
  let drops = 0;
  let lastReconnectedAt: number | null = null;
  let lastDeadline = 0;
  /** The flaps in a row so far. */
  let flaps = 0;
  /** When each reconnect inside the last minute came, oldest first. */
  const recent: number[] = [];

  const delayBefore = (c: Cycle, attempt: number) => RECONNECT_DELAYS_MS[c.step + attempt - 1] ?? RECONNECT_REPEAT_MS;

  const stop = (c: Cycle) => {
    c.cancelWait?.();
    c.cancelWait = null;
    c.cancelDeadline();
    cycle = null;
  };

  const giveUp = (c: Cycle, e: Omit<GiveUp, 'attempts' | 'errorCode'>) => {
    c.controller.abort();
    stop(c);
    finished = true;
    o.frame('session.connection_lost', { attempts: c.attempt });
    o.gaveUp({ ...e, attempts: c.attempt, errorCode: c.lastCode });
  };

  const timeout = (c: Cycle) => giveUp(c, { reason: 'timeout', code: LOST, message: c.lastMessage ?? 'Connection lost' });

  /** Says the next attempt; false when a stop inside the callback ended the cycle, so nothing more may start. */
  const announce = (c: Cycle): boolean => {
    c.attempt += 1;
    c.announced = true;
    o.reconnecting(c.attempt === 1 ? { attempt: 1, drop: dropOf } : { attempt: c.attempt });
    return cycle === c;
  };

  const start = (c: Cycle) => {
    c.cancelWait = null;
    if (clock.now() >= c.deadline) { timeout(c); return; }
    if (!c.announced && !announce(c)) return;
    c.announced = false;
    c.inFlight = true;
    c.skipDelay = false;
    const attempt = c.attempt;
    let run: Promise<AttemptResult>;
    try {
      run = o.attempt({ attempt, signal: c.controller.signal });
    } catch (err) {
      run = Promise.reject(err);
    }
    run.then(
      (r) => settle(c, attempt, r),
      (err) => settle(c, attempt, { ok: false, final: false, message: err instanceof Error ? err.message : String(err), reissued: false, reissueMs: 0 }),
    );
  };

  const settle = (c: Cycle, attempt: number, answer: AttemptResult) => {
    // A cancelled, timed-out or superseded cycle's late answer is nobody's business. The deadline is its timer's to enforce, not
    // this read's: a success that lands past the deadline's time, its timer not yet run, is taken (the attempt contract above).
    if (cycle !== c || c.attempt !== attempt) return;
    c.inFlight = false;
    const behind = c.droppedBehind;
    c.droppedBehind = false;
    // Its connection dropped before this answer was read: nothing came back, and the next attempt follows.
    const r: AttemptResult = answer.ok && behind
      ? { ok: false, final: false, code: LOST, message: 'The new connection dropped as it opened.', reissued: answer.reissued, reissueMs: answer.reissueMs }
      : answer;
    if (r.ok) {
      c.reissued ||= r.reissued;
      c.reissueMs += r.reissueMs;
      const info: ReconnectedInfo = { attempts: c.attempt, credentialsReissued: c.reissued, reissueMs: c.reissueMs, budgetShared: c.shared };
      const downMs = clock.now() - c.droppedAt;
      lastReconnectedAt = clock.now();
      lastDeadline = c.deadline;
      recent.push(lastReconnectedAt);
      stop(c);
      o.frame('session.reconnected', { downMs, attempts: info.attempts });
      o.reconnected(info);
      return;
    }
    if (r.final) {
      // A final failure is still the last failed attempt: its code is the analytics `error_code`.
      c.lastCode = r.code;
      giveUp(c, { reason: r.reason, code: r.code, message: r.message, ...(r.refusalCode !== undefined ? { refusalCode: r.refusalCode } : {}) });
      return;
    }
    c.reissued ||= r.reissued;
    c.reissueMs += r.reissueMs;
    c.lastCode = r.code;
    c.lastMessage = r.message;
    o.frame('session.reconnect_failed', { attempt, message: r.message });
    schedule(c);
  };

  const schedule = (c: Cycle) => {
    const delay = c.skipDelay ? 0 : delayBefore(c, c.attempt + 1);
    if (delay === 0) { start(c); return; }
    // The deadline timer fires first if it falls before the wait ends.
    c.cancelWait = clock.setTimeout(() => start(c), delay);
  };

  /** The first attempt's drop, kept for the `reconnecting` payload. */
  let dropOf: DropInfo;

  return {
    get active() { return cycle !== null; },

    dropped(drop) {
      if (finished) return;
      if (cycle) {
        // During a wait there is no connection to drop; during an attempt it is the one the attempt brought back.
        if (cycle.inFlight) cycle.droppedBehind = true;
        return;
      }
      const now = clock.now();
      drops += 1;
      while (recent.length > 0 && now - recent[0] >= MINUTE_MS) recent.shift();
      if (drops > MAX_RECONNECTS || recent.length >= MAX_RECONNECTS_PER_MINUTE) {
        finished = true;
        o.frame('session.reconnecting', { cause: drop.cause, code: drop.closeCode ?? drop.errorCode });
        o.frame('session.connection_lost', { attempts: 0 });
        o.gaveUp({ attempts: 0, reason: 'session_cap', code: LOST, message: 'Connection lost' });
        return;
      }
      const shared = lastReconnectedAt !== null && now - lastReconnectedAt <= FLAP_WINDOW_MS;
      flaps = shared ? flaps + 1 : 0;
      const deadline = shared ? Math.max(lastDeadline, now + FLAP_MIN_REMAINING_MS) : now + RECONNECT_BUDGET_MS;
      dropOf = drop;
      const c: Cycle = {
        droppedAt: now, deadline, shared, step: flaps, attempt: 0, announced: false, droppedBehind: false, reissued: false, reissueMs: 0,
        inFlight: false, skipDelay: false, controller: new AbortController(), cancelWait: null, cancelDeadline: () => {},
      };
      cycle = c;
      c.cancelDeadline = clock.setTimeout(() => { if (cycle === c) timeout(c); }, deadline - now);
      o.frame('session.reconnecting', { cause: drop.cause, code: drop.closeCode ?? drop.errorCode });
      const first = delayBefore(c, 1);
      if (first === 0) { start(c); return; }
      // A flap waits its step of the ladder before attempt 1, but the drop is said now: the leg shows reconnecting from it.
      if (!announce(c)) return;
      // It ends before the deadline: a flap's is at least `FLAP_MIN_REMAINING_MS` away, longer than the ladder's longest step.
      c.cancelWait = clock.setTimeout(() => start(c), first);
    },

    wake() {
      const c = cycle;
      if (!c) return;
      if (c.inFlight) { c.skipDelay = true; return; }
      if (c.cancelWait) { c.cancelWait(); start(c); }
    },

    cancel() {
      finished = true;
      const c = cycle;
      if (!c) return;
      c.controller.abort();
      stop(c);
    },
  };
}
