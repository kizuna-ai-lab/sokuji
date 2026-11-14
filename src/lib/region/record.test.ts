import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../diagnostics/report', () => ({ reportWarning: vi.fn() }));

import { reportWarning } from '../diagnostics/report';
import {
  needsMeasurement, recordAfterMeasurement, markActed, markChoseManually,
  regionRecordKey, readRegionRecord, writeRegionRecord, MAX_MEASURE_ATTEMPTS,
  type RegionRecord,
} from './record';

function mapStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

beforeEach(() => vi.mocked(reportWarning).mockClear());

describe('region record', () => {
  it('counts failed attempts and gives up at the third', () => {
    const a = recordAfterMeasurement(null, { kind: 'unmeasured' }, {}, 1);
    expect(a).toEqual({ status: 'unmeasured', at: 1, attempts: 1 });
    const c = recordAfterMeasurement(recordAfterMeasurement(a, { kind: 'unmeasured' }, {}, 2), { kind: 'unmeasured' }, {}, 3);
    expect(c).toMatchObject({ status: 'gave-up', attempts: 3 });
    expect(MAX_MEASURE_ATTEMPTS).toBe(3);
    expect(needsMeasurement(a)).toBe(true);
    expect(needsMeasurement(c)).toBe(false);
    expect(needsMeasurement(null)).toBe(true);
    expect(needsMeasurement(undefined)).toBe(true);
  });

  it('a recommendation is a hint with its medians; nothing to recommend is no-change; both stop measuring', () => {
    const m = { us: 177, jp: 13 };
    const hint = recordAfterMeasurement(null, { kind: 'recommend', region: 'jp' }, m, 5);
    expect(hint).toEqual({ status: 'hint', medians: m, recommended: 'jp', at: 5, attempts: 1 });
    expect(hint.medians).not.toBe(m);
    const nc = recordAfterMeasurement(null, { kind: 'no-change' }, m, 5);
    expect(nc).toMatchObject({ status: 'no-change', medians: m });
    expect(nc).not.toHaveProperty('recommended');
    expect(needsMeasurement(hint)).toBe(false);
    expect(needsMeasurement(nc)).toBe(false);
  });

  it('markActed keeps medians, recommended and attempts', () => {
    const hint: RegionRecord = { status: 'hint', medians: { jp: 13 }, recommended: 'jp', at: 1, attempts: 2 };
    expect(markActed(hint, 7)).toEqual({ status: 'acted', medians: { jp: 13 }, recommended: 'jp', at: 7, attempts: 2 });
  });

  it('a manual change records chose-manually over any record, a hint included', () => {
    expect(markChoseManually({ status: 'hint', recommended: 'jp', at: 1, attempts: 1 }, 9))
      .toMatchObject({ status: 'chose-manually', at: 9, recommended: 'jp', attempts: 1 });
    expect(markChoseManually(null, 9)).toEqual({ status: 'chose-manually', at: 9, attempts: 0 });
  });

  it('round-trips through storage under regionRecommendation.<id>', () => {
    const s = mapStorage();
    const r: RegionRecord = { status: 'hint', medians: { us: 177, jp: null }, recommended: 'jp', at: 5, attempts: 1 };
    writeRegionRecord('kizunaai_soniox', r, s);
    expect(regionRecordKey('kizunaai_soniox')).toBe('regionRecommendation.kizunaai_soniox');
    expect(s.m.has('regionRecommendation.kizunaai_soniox')).toBe(true);
    expect(readRegionRecord('kizunaai_soniox', s)).toEqual(r);
  });

  it('reads malformed JSON, an unknown status or a missing storage as no record, without throwing', () => {
    const get = (v: string | null) => ({ getItem: () => v });
    expect(readRegionRecord('p', get('{'))).toBeNull();
    expect(readRegionRecord('p', get('{"status":"maybe","at":1,"attempts":0}'))).toBeNull();
    expect(readRegionRecord('p', get(null))).toBeNull();
    expect(readRegionRecord('p', null)).toBeNull();
    expect(readRegionRecord('p', get('[]'))).toBeNull();
    expect(readRegionRecord('p', get('5'))).toBeNull();
    expect(readRegionRecord('p', get('{"status":"hint","at":"x","attempts":0}'))).toBeNull();
    expect(readRegionRecord('p', get('{"status":"hint","at":1,"attempts":null}'))).toBeNull();
    expect(readRegionRecord('p', get('{"status":"hint","at":1,"attempts":0,"medians":{"a":"x"}}'))).toBeNull();
    expect(readRegionRecord('p', get('{"status":"hint","at":1,"attempts":0,"medians":[]}'))).toBeNull();
    expect(readRegionRecord('p', get('{"status":"hint","at":1,"attempts":0,"recommended":3}'))).toBeNull();
    expect(readRegionRecord('p', { getItem: () => { throw new Error('denied'); } })).toBeNull();
  });

  it('keeps only the known fields of a valid record', () => {
    const s = { getItem: () => '{"status":"no-change","at":1,"attempts":1,"extra":true}' };
    expect(readRegionRecord('p', s)).toEqual({ status: 'no-change', at: 1, attempts: 1 });
  });

  it('a failed write is reported as a warning and does not throw', () => {
    const err = new Error('QuotaExceededError');
    const s = { setItem: () => { throw err; } };
    expect(() => writeRegionRecord('p', { status: 'acted', at: 1, attempts: 1 }, s)).not.toThrow();
    expect(reportWarning).toHaveBeenCalledWith('RegionRecommendation', expect.any(String), { cause: err, dedupeKey: 'region:record' });
    expect(() => writeRegionRecord('p', { status: 'acted', at: 1, attempts: 1 }, null)).not.toThrow();
  });
});
