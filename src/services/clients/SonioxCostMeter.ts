const MICRO_USD_PER_USD = 1_000_000;

export interface SonioxCostMeterOptions {
  /** Balance snapshot the backend issued this session against, in micro-USD. */
  budgetMicroUsd: number;
  /** The SKU's list price, supplied by the backend so the client needs no rate table. */
  rateUsdPerHour: number;
  /** Called once, when the budget is exhausted. */
  onExhausted?: () => void;
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
    const hours = this.elapsedMs / 3_600_000;
    return Math.ceil(hours * this.opts.rateUsdPerHour * MICRO_USD_PER_USD);
  }

  get remainingMicroUsd(): number {
    return Math.max(0, this.opts.budgetMicroUsd - this.spentMicroUsd);
  }

  get remainingSeconds(): number {
    const rate = this.opts.rateUsdPerHour;
    if (!rate || !Number.isFinite(rate)) return 0;
    return Math.max(0, Math.floor((this.remainingMicroUsd / MICRO_USD_PER_USD / rate) * 3600));
  }
}
