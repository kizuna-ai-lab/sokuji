import { describe, it, expect, vi } from 'vitest';
import { SonioxCostMeter } from './SonioxCostMeter';

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
});
