import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setRegionMeasure } from '../lib/region/measure';
import { useRegionLatencyStore, LATENCY_CACHE_MS } from './regionLatencyStore';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const st = () => useRegionLatencyStore.getState();

describe('regionLatencyStore', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ensureFresh measures once, keeps the result 10 minutes, and maps null to unreachable', async () => {
    const measure = vi.fn(async () => ({ us: 177, eu: null, jp: 13, in: 136 }));
    setRegionMeasure(measure);
    st().ensureFresh('soniox');
    st().ensureFresh('soniox');
    expect(st().families.soniox?.measuring).toBe(true);
    await flush();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(st().families.soniox).toMatchObject({ measuring: false, medians: { us: 177, eu: 'unreachable', jp: 13, in: 136 } });
    vi.setSystemTime(Date.now() + LATENCY_CACHE_MS - 1); st().ensureFresh('soniox');
    expect(measure).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2); st().ensureFresh('soniox');
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('a fill from the one-time measurement counts as fresh', () => {
    const measure = vi.fn(async () => ({ us: 1 }));
    setRegionMeasure(measure);
    st().fill('qwen', { sg: 40, cn: null }, Date.now());
    st().ensureFresh('qwen');
    expect(measure).not.toHaveBeenCalled();
    expect(st().families.qwen?.medians).toEqual({ sg: 40, cn: 'unreachable' });
  });

  it('a null or rejected measurement keeps the last numbers and the old timestamp', async () => {
    st().fill('soniox', { us: 20 }, Date.now());
    const at = st().families.soniox!.at;
    vi.setSystemTime(Date.now() + LATENCY_CACHE_MS + 1);
    setRegionMeasure(async () => null);
    st().ensureFresh('soniox');
    await flush();
    expect(st().families.soniox).toEqual({ medians: { us: 20 }, at, measuring: false });
    setRegionMeasure(async () => { throw new Error('boom'); });
    st().ensureFresh('soniox');
    await flush();
    expect(st().families.soniox).toEqual({ medians: { us: 20 }, at, measuring: false });
  });

  it('a synchronous throw from the measurement does not throw, and clears measuring', async () => {
    st().fill('soniox', { us: 20 }, Date.now());
    const at = st().families.soniox!.at;
    vi.setSystemTime(Date.now() + LATENCY_CACHE_MS + 1);
    setRegionMeasure(() => { throw new Error('sync'); });
    expect(() => st().ensureFresh('soniox')).not.toThrow();
    await flush();
    expect(st().families.soniox).toEqual({ medians: { us: 20 }, at, measuring: false });
  });

  it('writes nothing to localStorage', async () => {
    setRegionMeasure(async () => ({ us: 5 }));
    st().ensureFresh('soniox');
    await flush();
    st().fill('qwen', { sg: 1 }, Date.now());
    expect(localStorage.length).toBe(0);
  });

  it('an all-unreachable result is shown but not cached as fresh: the next ensureFresh measures again', async () => {
    const measure = vi.fn(async () => ({ us: null, eu: null, jp: null, in: null }));
    setRegionMeasure(measure);
    st().ensureFresh('soniox');
    await flush();
    expect(st().families.soniox).toEqual({
      medians: { us: 'unreachable', eu: 'unreachable', jp: 'unreachable', in: 'unreachable' }, at: null, measuring: false,
    });
    st().ensureFresh('soniox');
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('an all-unreachable fill from the one-time measurement does not count as fresh either', () => {
    const measure = vi.fn(() => new Promise<null>(() => {}));
    setRegionMeasure(measure);
    st().fill('qwen', { sg: null, cn: null }, Date.now());
    expect(st().families.qwen).toMatchObject({ medians: { sg: 'unreachable', cn: 'unreachable' }, at: null });
    st().ensureFresh('qwen');
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('setMeasuring marks a family measured elsewhere, so ensureFresh starts no parallel measurement', () => {
    const measure = vi.fn(() => new Promise<null>(() => {}));
    setRegionMeasure(measure);
    st().setMeasuring('soniox', true);
    st().ensureFresh('soniox');
    expect(measure).not.toHaveBeenCalled();
    expect(st().families.soniox?.measuring).toBe(true);
    st().setMeasuring('soniox', false);
    expect(st().families.soniox).toEqual({ medians: null, at: null, measuring: false });
    st().ensureFresh('soniox');
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
