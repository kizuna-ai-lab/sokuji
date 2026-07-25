import { describe, it, expect, vi } from 'vitest';
import { SonioxCostMeter, computeSonioxRemainingMs, computeSonioxBudgetTotalMs } from './SonioxCostMeter';

const opts = { budgetMicroUsd: 300_000, rateUsdPerHour: 0.6 }; // $0.30 at $0.60/hr = 1800s

describe('SonioxCostMeter', () => {
  it('spends nothing before it starts', () => {
    const m = new SonioxCostMeter(opts);
    expect(m.spentMicroUsd).toBe(0);
    expect(m.remainingMicroUsd).toBe(300_000);
  });

  it('spends at the SKU rate as the clock runs', () => {
    const m = new SonioxCostMeter(opts);
    m.start(0);
    m.tick(3_600_000);              // one hour
    expect(m.spentMicroUsd).toBe(600_000);
  });

  it('reports remaining seconds from the budget and rate', () => {
    const m = new SonioxCostMeter(opts);
    m.start(0);
    expect(m.remainingSeconds).toBe(1800);
    m.tick(900_000);                // 900s elapsed
    expect(m.remainingSeconds).toBe(900);
  });

  it('uses the speech-to-speech rate when given one', () => {
    const m = new SonioxCostMeter({ budgetMicroUsd: 750_000, rateUsdPerHour: 1.5 });
    m.start(0);
    expect(m.remainingSeconds).toBe(1800);
  });

  it('fires onExhausted exactly once when the budget runs out', () => {
    const onExhausted = vi.fn();
    const m = new SonioxCostMeter({ ...opts, onExhausted });
    m.start(0);
    m.tick(1_799_000);
    expect(onExhausted).not.toHaveBeenCalled();
    m.tick(1_800_000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    m.tick(2_000_000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('never reports negative remaining', () => {
    const m = new SonioxCostMeter(opts);
    m.start(0);
    m.tick(10_000_000);
    expect(m.remainingMicroUsd).toBe(0);
    expect(m.remainingSeconds).toBe(0);
  });

  it('treats a zero or missing rate as no time rather than dividing by zero', () => {
    const m = new SonioxCostMeter({ budgetMicroUsd: 300_000, rateUsdPerHour: 0 });
    m.start(0);
    expect(m.remainingSeconds).toBe(0);
    expect(Number.isFinite(m.remainingSeconds)).toBe(true);
  });

  it('rounds a partial micro-dollar up, never down', () => {
    // 1 second at $0.60/hour:
    // (1000 ms / 3_600_000 ms/hr) * $0.60/hr * 1_000_000 µUSD/USD
    // = (1 / 3600) * 0.6 * 1_000_000
    // = 166.666... µUSD
    // ceil(166.666...) = 167, floor(166.666...) = 166
    const m = new SonioxCostMeter({ budgetMicroUsd: 1_000_000, rateUsdPerHour: 0.6 });
    m.start(0);
    m.tick(1000);  // 1 second
    expect(m.spentMicroUsd).toBe(167);
  });

  describe('getBudgetSnapshot', () => {
    it('is null before start()', () => {
      const m = new SonioxCostMeter(opts);
      expect(m.getBudgetSnapshot()).toBeNull();
    });

    it('captures the static budget params and start time after start()', () => {
      const m = new SonioxCostMeter(opts);
      m.start(1_000);
      expect(m.getBudgetSnapshot()).toEqual({
        budgetMicroUsd: 300_000,
        rateUsdPerHour: 0.6,
        startedAtMs: 1_000,
      });
    });

    it('does not change as time passes — it is a fixed snapshot, not a live read', () => {
      const m = new SonioxCostMeter(opts);
      m.start(0);
      m.tick(900_000);
      expect(m.getBudgetSnapshot()).toEqual({
        budgetMicroUsd: 300_000,
        rateUsdPerHour: 0.6,
        startedAtMs: 0,
      });
    });
  });
});

describe('computeSonioxRemainingMs', () => {
  const snapshot = { budgetMicroUsd: 300_000, rateUsdPerHour: 0.6, startedAtMs: 10_000 }; // 1800s budget

  it('reports the full budget at the start time', () => {
    expect(computeSonioxRemainingMs(10_000, snapshot)).toBe(1_800_000);
  });

  it('counts down as wall-clock time advances, independent of any tick() call', () => {
    expect(computeSonioxRemainingMs(10_000 + 900_000, snapshot)).toBe(900_000);
  });

  it('never goes negative once the budget is exceeded', () => {
    expect(computeSonioxRemainingMs(10_000 + 10_000_000, snapshot)).toBe(0);
  });

  it('clamps a `now` before startedAtMs to the full budget rather than going negative', () => {
    expect(computeSonioxRemainingMs(0, snapshot)).toBe(1_800_000);
  });
});

describe('computeSonioxBudgetTotalMs', () => {
  it('equals the remaining time at t=0 — the countdown\'s 100% mark', () => {
    const snapshot = { budgetMicroUsd: 300_000, rateUsdPerHour: 0.6, startedAtMs: 5_000 };
    expect(computeSonioxBudgetTotalMs(snapshot)).toBe(1_800_000);
    expect(computeSonioxBudgetTotalMs(snapshot)).toBe(computeSonioxRemainingMs(5_000, snapshot));
  });

  it('is independent of startedAtMs — only the rate and budget determine total time', () => {
    const a = { budgetMicroUsd: 750_000, rateUsdPerHour: 1.5, startedAtMs: 0 };
    const b = { budgetMicroUsd: 750_000, rateUsdPerHour: 1.5, startedAtMs: 999_999 };
    expect(computeSonioxBudgetTotalMs(a)).toBe(computeSonioxBudgetTotalMs(b));
  });
});
