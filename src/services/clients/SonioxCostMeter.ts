const MICRO_USD_PER_USD = 1_000_000;

export interface SonioxCostMeterOptions {
  /** Balance snapshot the backend issued this session against, in micro-USD. */
  budgetMicroUsd: number;
  /** The SKU's list price, supplied by the backend so the client needs no rate table. */
  rateUsdPerHour: number;
  /** Called once, when the budget is exhausted. */
  onExhausted?: () => void;
}

/** Micro-USD spent for `elapsedMs` of usage at `rateUsdPerHour`, rounded UP to the
 *  whole micro-USD — pinned by SonioxCostMeter.test.ts's "round-up direction" case,
 *  since underbilling by rounding down would never match what the backend charges. */
function spentMicroUsdFor(elapsedMs: number, rateUsdPerHour: number): number {
  const hours = elapsedMs / 3_600_000;
  return Math.ceil(hours * rateUsdPerHour * MICRO_USD_PER_USD);
}

function remainingMicroUsdFor(elapsedMs: number, budgetMicroUsd: number, rateUsdPerHour: number): number {
  return Math.max(0, budgetMicroUsd - spentMicroUsdFor(elapsedMs, rateUsdPerHour));
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
 * Tracks what a managed Soniox session has cost so far.
 *
 * Billing is by time, so this is a clock — no token counting, no correction
 * factor, and no estimation error: what it reports is what will be charged.
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

  get spentMicroUsd(): number {
    return spentMicroUsdFor(this.elapsedMs, this.opts.rateUsdPerHour);
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
