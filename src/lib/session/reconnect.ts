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

/** The wait before attempt 1, 2, … 6; every attempt after that waits `RECONNECT_REPEAT_MS`. */
export const RECONNECT_DELAYS_MS: readonly number[] = [0, 250, 500, 1000, 2000, 4000];
export const RECONNECT_REPEAT_MS = 4000;
/** From the drop to giving up. */
export const RECONNECT_BUDGET_MS = 30000;
/** A drop this soon after a reconnect continues the previous drop's budget instead of getting a fresh one. */
export const FLAP_WINDOW_MS = 10000;
/** A shared budget is never left with less than this, so the attempts get a real chance. */
export const FLAP_MIN_REMAINING_MS = 5000;
/** The backstop on a runaway loop; the flapping rule is what normally stops one. */
export const MAX_RECONNECTS = 100;

export type AttemptResult =
  | { ok: true; reissued: boolean; reissueMs: number }
  | { ok: false; final: false; code?: string; message: string; reissued: boolean; reissueMs: number }
  | { ok: false; final: true; reason: 'refused' | 'terminal_error' | 'lease_ended'; code: string; message: string; refusalCode?: string };

export interface ReconnectorOptions {
  clock: Clock;
  frame(type: string, payload: Record<string, unknown>): void;
  /** Before each attempt; `drop` only on the first. */
  reconnecting(e: { attempt: number; drop?: DropInfo }): void;
  reconnected(e: ReconnectedInfo): void;
  gaveUp(e: GiveUp): void;
  /** One attempt. The signal aborts at the deadline and on `cancel()`; an attempt that outlives it is abandoned. */
  attempt(ctx: { attempt: number; signal: AbortSignal }): Promise<AttemptResult>;
}

export interface Reconnector {
  /** The connection dropped and the adapter judged it retryable. Ignored while already reconnecting, and after the reconnector finished. */
  dropped(drop: DropInfo): void;
  /** The network is back: a waiting attempt starts now; during an attempt, the next one skips its delay. */
  wake(): void;
  /** The session ended. Stops everything and emits nothing. */
  cancel(): void;
  readonly active: boolean;
}

const LOST = 'connection_lost';

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
  attempt: number;
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

  const delayBefore = (attempt: number) => RECONNECT_DELAYS_MS[attempt - 1] ?? RECONNECT_REPEAT_MS;

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

  const start = (c: Cycle) => {
    c.cancelWait = null;
    if (clock.now() >= c.deadline) { timeout(c); return; }
    c.attempt += 1;
    c.inFlight = true;
    c.skipDelay = false;
    const attempt = c.attempt;
    o.reconnecting(attempt === 1 ? { attempt, drop: dropOf } : { attempt });
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

  const settle = (c: Cycle, attempt: number, r: AttemptResult) => {
    // A cancelled, timed-out or superseded cycle's late answer is nobody's business.
    if (cycle !== c || c.attempt !== attempt) return;
    c.inFlight = false;
    if (r.ok) {
      c.reissued ||= r.reissued;
      c.reissueMs += r.reissueMs;
      const info: ReconnectedInfo = { attempts: c.attempt, credentialsReissued: c.reissued, reissueMs: c.reissueMs, budgetShared: c.shared };
      const downMs = clock.now() - c.droppedAt;
      lastReconnectedAt = clock.now();
      lastDeadline = c.deadline;
      stop(c);
      o.frame('session.reconnected', { downMs, attempts: info.attempts });
      o.reconnected(info);
      return;
    }
    if (r.final) {
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
    const delay = c.skipDelay ? 0 : delayBefore(c.attempt + 1);
    if (delay === 0) { start(c); return; }
    // The deadline timer fires first if it falls before the wait ends.
    c.cancelWait = clock.setTimeout(() => start(c), delay);
  };

  /** The first attempt's drop, kept for the `reconnecting` payload. */
  let dropOf: DropInfo;

  return {
    get active() { return cycle !== null; },

    dropped(drop) {
      if (finished || cycle) return;
      const now = clock.now();
      drops += 1;
      if (drops > MAX_RECONNECTS) {
        finished = true;
        o.frame('session.connection_lost', { attempts: 0 });
        o.gaveUp({ attempts: 0, reason: 'session_cap', code: LOST, message: 'Connection lost' });
        return;
      }
      const shared = lastReconnectedAt !== null && now - lastReconnectedAt <= FLAP_WINDOW_MS;
      const deadline = shared ? Math.max(lastDeadline, now + FLAP_MIN_REMAINING_MS) : now + RECONNECT_BUDGET_MS;
      dropOf = drop;
      const c: Cycle = {
        droppedAt: now, deadline, shared, attempt: 0, reissued: false, reissueMs: 0,
        inFlight: false, skipDelay: false, controller: new AbortController(), cancelWait: null, cancelDeadline: () => {},
      };
      cycle = c;
      c.cancelDeadline = clock.setTimeout(() => { if (cycle === c) timeout(c); }, deadline - now);
      o.frame('session.reconnecting', { cause: drop.cause, code: drop.closeCode ?? drop.errorCode });
      start(c);
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
