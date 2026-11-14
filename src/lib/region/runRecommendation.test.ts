import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setRegionMeasure } from './measure';
import {
  recommendationGate, regionRecommendationEvent, runRegionRecommendation, resetRecommendationAttemptsForTests,
  type GateInputs,
} from './runRecommendation';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import { useRegionLatencyStore } from '../../stores/regionLatencyStore';
import { useProviderStore } from '../../stores/providerStore';
import type { AnalyticsEvents } from '../analytics';

const open: GateInputs = { provider: 'kizunaai_soniox', loaded: true, signedIn: true, wizardOpen: false, tourActive: false, locked: false, online: true, record: undefined };
const live = () => new AbortController().signal;
const seed = (region: string) =>
  useProviderStore.setState({ entries: { kizunaai_soniox: { settings: { region } } } as never });
const rec = () => useRegionRecommendationStore.getState().records.kizunaai_soniox;
let track: ReturnType<typeof vi.fn<(e: AnalyticsEvents['region_recommendation']) => void>>;

beforeEach(() => {
  localStorage.clear();
  useRegionRecommendationStore.setState({ records: {}, listOpen: null });
  resetRecommendationAttemptsForTests();
  track = vi.fn<(e: AnalyticsEvents['region_recommendation']) => void>();
  seed('jp');
});

describe('recommendationGate', () => {
  it('opens only for a managed regional provider, signed in, after setup and the tour, idle and online, with no final record', () => {
    expect(recommendationGate(open)).toBe(true);
    for (const k of ['signedIn', 'loaded', 'online'] as const) expect(recommendationGate({ ...open, [k]: false })).toBe(false);
    for (const k of ['wizardOpen', 'tourActive', 'locked'] as const) expect(recommendationGate({ ...open, [k]: true })).toBe(false);
    expect(recommendationGate({ ...open, provider: 'soniox' })).toBe(false);
    expect(recommendationGate({ ...open, provider: null })).toBe(false);
    expect(recommendationGate({ ...open, record: { status: 'acted', at: 1, attempts: 1 } })).toBe(false);
    expect(recommendationGate({ ...open, record: { status: 'unmeasured', at: 1, attempts: 1 } })).toBe(true);
  });
});

describe('regionRecommendationEvent', () => {
  it('carries the record medians and recommendation', () => {
    expect(regionRecommendationEvent('kizunaai_soniox', { status: 'hint', medians: { us: 1 }, recommended: 'in', at: 1, attempts: 1 }, 'jp', 'switched', 'in'))
      .toEqual({ provider: 'kizunaai_soniox', medians: { us: 1 }, current: 'jp', recommended: 'in', outcome: 'switched', chosen: 'in' });
    expect(regionRecommendationEvent('kizunaai_soniox', { status: 'no-change', at: 1, attempts: 1 }, 'jp', 'no_change', 'jp'))
      .toMatchObject({ medians: {}, recommended: null });
  });
});

describe('runRegionRecommendation', () => {
  it('measures an existing user once whatever region is stored, and records the hint', async () => {
    const measure = vi.fn(async () => ({ us: 177, eu: 240, jp: 300, in: 136 }));
    setRegionMeasure(measure);
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(rec()).toMatchObject({ status: 'hint', recommended: 'in' });
    expect(localStorage.getItem('regionRecommendation.kizunaai_soniox')).toContain('"hint"');
    expect(useRegionLatencyStore.getState().families.soniox?.medians).toMatchObject({ in: 136 });
    expect(track).not.toHaveBeenCalled();
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('no-change tracks no_change; the third failed launch tracks gave_up', async () => {
    setRegionMeasure(async () => ({ us: 100, eu: 120, jp: 90, in: 130 }));
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(rec()?.status).toBe('no-change');
    expect(track).toHaveBeenCalledWith({
      provider: 'kizunaai_soniox', medians: { us: 100, eu: 120, jp: 90, in: 130 }, current: 'jp', recommended: null, outcome: 'no_change', chosen: 'jp',
    });

    useRegionRecommendationStore.setState({ records: {} });
    track.mockClear();
    setRegionMeasure(async () => ({ us: null, eu: null, jp: null, in: null }));
    for (let launch = 1; launch <= 3; launch++) {
      resetRecommendationAttemptsForTests();
      await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
      expect(rec()).toMatchObject({ status: launch < 3 ? 'unmeasured' : 'gave-up', attempts: launch });
    }
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      provider: 'kizunaai_soniox', medians: { us: null, eu: null, jp: null, in: null }, current: 'jp', recommended: null, outcome: 'gave_up', chosen: 'jp',
    });
  });

  it('an aborted measurement writes nothing and may run again this launch', async () => {
    setRegionMeasure(async () => null);
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(rec()).toBeUndefined();
    expect(localStorage.length).toBe(0);
    const measure = vi.fn(async () => ({ us: 100, eu: 120, jp: 90, in: 130 }));
    setRegionMeasure(measure);
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(rec()?.status).toBe('no-change');
  });

  it('a rejected measurement is treated like an abort', async () => {
    setRegionMeasure(async () => { throw new Error('boom'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(rec()).toBeUndefined();
    const measure = vi.fn(async () => ({ us: 100, eu: 120, jp: 90, in: 130 }));
    setRegionMeasure(measure);
    await runRegionRecommendation('kizunaai_soniox', { signal: live(), track });
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
