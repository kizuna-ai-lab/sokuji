/**
 * The cross-stage memory ledger (port of accel.py's ledger): the three stages share one accelerator. Each engine
 * claims its ACTUAL device footprint at load (0 when it landed on CPU) and releases it on close; one stage's reserve
 * then uses the loaded stages' real claims and falls back to estimates only for stages not loaded yet.
 */
const LEDGER = new Map<string, number>();

export function ledgerReset(): void {
  LEDGER.clear();
}

export function ledgerClaim(stage: string, nbytes: number | null | undefined): void {
  LEDGER.set(stage, Math.max(0, Math.trunc(nbytes || 0)));
}

export function ledgerRelease(stage: string): void {
  LEDGER.delete(stage);
}

/** The device bytes every OTHER loaded stage holds. */
export function ledgerOther(stage: string): number {
  let total = 0;
  for (const [k, v] of LEDGER) if (k !== stage) total += v;
  return total;
}

/**
 * The margin `stage` should leave for the OTHER stages, sizing the budget quant and tier selection reserve against.
 * A loaded stage (any entry, 0 for CPU) holds its memory now — it is already out of every free reading — so it
 * reserves nothing; a stage not loaded yet reserves its planned estimate.
 */
export function ledgerEffectiveReserve(stage: string, plannedEst: Readonly<Record<string, number | null | undefined>>): number {
  let total = 0;
  for (const [other, est] of Object.entries(plannedEst)) {
    if (other === stage || LEDGER.has(other)) continue;
    total += Math.trunc(est || 0);
  }
  return total;
}
