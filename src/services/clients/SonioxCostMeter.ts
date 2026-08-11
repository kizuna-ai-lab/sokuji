const MICRO_USD_PER_USD = 1_000_000;

export interface SonioxCostMeterOptions {
  /** The session ALLOWANCE the backend granted, in micro-USD: a snapshot of the
   *  account balance taken at session start. It is the ceiling this session may
   *  consume, not a bill. */
  budgetMicroUsd: number;
  /**
   * The CONSERVATIVE aggregate rate the backend budgeted this session's whole
   * stream set at, in USD/hour — supplied by the backend so the client needs no
   * rate table and must never grow one.
   *
   * Deliberately not a price. The backend charges provider cost × a revenue
   * coefficient per usage log; this rate is the worst case it is willing to
   * grant time against, so `budgetMicroUsd / rateUsdPerHour` UNDER-states how
   * long the balance really buys. It is one number for the whole SET — a split
   * Both session runs two transcription streams and is budgeted at roughly
   * twice a single-stream session — never a per-stream figure.
   */
  rateUsdPerHour: number;
  /** Called once, when the allowance is used up. */
  onExhausted?: () => void;
}

/** Allowance consumed by `elapsedMs` of session time at `rateUsdPerHour`,
 *  rounded UP to the whole micro-USD — pinned by SonioxCostMeter.test.ts's
 *  "round-up direction" case. The direction is a safety margin on the
 *  allowance: rounding down would hand out fractionally more session time than
 *  the grant covers. It is NOT an attempt to match a charge — the charge is
 *  provider cost × K per usage log and is not knowable from here. */
function allowanceConsumedMicroUsdFor(elapsedMs: number, rateUsdPerHour: number): number {
  const hours = elapsedMs / 3_600_000;
  return Math.ceil(hours * rateUsdPerHour * MICRO_USD_PER_USD);
}

function remainingMicroUsdFor(elapsedMs: number, budgetMicroUsd: number, rateUsdPerHour: number): number {
  return Math.max(0, budgetMicroUsd - allowanceConsumedMicroUsdFor(elapsedMs, rateUsdPerHour));
}

function remainingSecondsFor(elapsedMs: number, budgetMicroUsd: number, rateUsdPerHour: number): number {
  if (!rateUsdPerHour || !Number.isFinite(rateUsdPerHour)) return 0;
  const remainingMicroUsd = remainingMicroUsdFor(elapsedMs, budgetMicroUsd, rateUsdPerHour);
  return Math.max(0, Math.floor((remainingMicroUsd / MICRO_USD_PER_USD / rateUsdPerHour) * 3600));
}

/** Static parameters needed to compute a managed session's remaining time at any
 *  later instant — see getBudgetSnapshot()/computeSonioxRemainingMs(). */
export interface SonioxBudgetSnapshot {
  budgetMicroUsd: number;
  rateUsdPerHour: number;
  startedAtMs: number;
}

/**
 * Live remaining time (ms), computed with the same wall-clock formula
 * SonioxCostMeter uses internally — remaining time is a pure function of
 * elapsed time since the session started, at a fixed rate, so a caller (the
 * status footer's countdown) can re-evaluate this every second against
 * Date.now() for a smooth per-second display without polling the meter
 * itself, which only advances on the STT stream's ~5s keepalive tick.
 */
export function computeSonioxRemainingMs(nowMs: number, snapshot: SonioxBudgetSnapshot): number {
  const elapsedMs = Math.max(0, nowMs - snapshot.startedAtMs);
  return remainingSecondsFor(elapsedMs, snapshot.budgetMicroUsd, snapshot.rateUsdPerHour) * 1000;
}

/** Total time the session's budget buys at its rate — the countdown's 100% mark
 *  (elapsedMs=0), used to derive the low-budget emphasis threshold. */
export function computeSonioxBudgetTotalMs(snapshot: SonioxBudgetSnapshot): number {
  return remainingSecondsFor(0, snapshot.budgetMicroUsd, snapshot.rateUsdPerHour) * 1000;
}

/**
 * The session ALLOWANCE countdown for a managed Soniox session.
 *
 * The backend grants each session a fixed allowance (a snapshot of the account
 * balance) and a conservative rate to spend it against. This class burns that
 * allowance down against wall-clock time and fires `onExhausted` when it hits
 * zero. That is the real cutoff — the session is torn down — so this number is
 * load-bearing for "when does this stop".
 *
 * It is NOT a price, and must never be presented as one. Billing is provider
 * cost × a revenue coefficient, applied per usage log by the backend
 * reconciler after each Soniox stream ends. That figure is not knowable here —
 * no usage log exists while the session is still running — and it is normally
 * SMALLER than what this meter has counted down, because the granted rate is
 * the worst case for the whole stream set. Trust the countdown for the cutoff;
 * the wallet is the only authority on cost.
 *
 * It has no clock of its own. `tick(nowMs)` is fed by the STT stream's ~5 s
 * keepalive and is ABSOLUTE (`now - startedAt`), not incremental — which is
 * what makes a split Both session harmless: two transcription streams each
 * forwarding their own keepalive compute the same elapsed time, so more than
 * one ticker cannot double-count. Do not make `tick` incremental.
 */
export class SonioxCostMeter {
  private startedAt: number | null = null;
  private elapsedMs = 0;
  private exhaustedFired = false;

  constructor(private opts: SonioxCostMeterOptions) {}

  start(nowMs: number): void {
    this.startedAt = nowMs;
    this.elapsedMs = 0;
  }

  tick(nowMs: number): void {
    if (this.startedAt == null) return;
    this.elapsedMs = Math.max(0, nowMs - this.startedAt);
    if (!this.exhaustedFired && this.remainingMicroUsd <= 0) {
      this.exhaustedFired = true;
      this.opts.onExhausted?.();
    }
  }

  /** How much of the granted allowance this session has burned through. Named
   *  for what it is: this is not what the user is charged, and there is
   *  deliberately no getter that claims to be. */
  get allowanceConsumedMicroUsd(): number {
    return allowanceConsumedMicroUsdFor(this.elapsedMs, this.opts.rateUsdPerHour);
  }

  get remainingMicroUsd(): number {
    return remainingMicroUsdFor(this.elapsedMs, this.opts.budgetMicroUsd, this.opts.rateUsdPerHour);
  }

  get remainingSeconds(): number {
    return remainingSecondsFor(this.elapsedMs, this.opts.budgetMicroUsd, this.opts.rateUsdPerHour);
  }

  /** Snapshot of this session's static budget parameters (fixed once start() has
   *  run), for callers that need to derive a live countdown themselves — see
   *  computeSonioxRemainingMs(). Null before start() has been called. */
  getBudgetSnapshot(): SonioxBudgetSnapshot | null {
    if (this.startedAt == null) return null;
    return {
      budgetMicroUsd: this.opts.budgetMicroUsd,
      rateUsdPerHour: this.opts.rateUsdPerHour,
      startedAtMs: this.startedAt,
    };
  }
}
