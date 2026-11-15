/**
 * The per-provider region record, kept device-local in localStorage (never in
 * synced settings): it decides whether a provider still needs measuring.
 */
import { reportWarning } from '../diagnostics/report';
import type { RegionMedians } from './probe';
import type { RegionDecision } from './decision';

export type RegionRecordStatus =
  | 'unmeasured'
  | 'hint'
  | 'acted'
  | 'no-change'
  | 'gave-up'
  | 'chose-manually';

export interface RegionRecord {
  status: RegionRecordStatus;
  medians?: Record<string, number | null>;
  recommended?: string;
  at: number;
  attempts: number;
}

export const MAX_MEASURE_ATTEMPTS = 3;

const STATUSES: readonly RegionRecordStatus[] = [
  'unmeasured', 'hint', 'acted', 'no-change', 'gave-up', 'chose-manually',
];

/** Only an absent or `unmeasured` record leaves the provider to be measured. */
export function needsMeasurement(r: RegionRecord | null | undefined): boolean {
  return !r || r.status === 'unmeasured';
}

export function recordAfterMeasurement(
  prev: RegionRecord | null | undefined,
  d: RegionDecision,
  medians: RegionMedians,
  now: number,
): RegionRecord {
  const attempts = (prev?.attempts ?? 0) + 1;
  switch (d.kind) {
    case 'recommend':
      return { status: 'hint', medians: { ...medians }, recommended: d.region, at: now, attempts };
    case 'no-change':
      return { status: 'no-change', medians: { ...medians }, at: now, attempts };
    case 'unmeasured':
      return { status: attempts >= MAX_MEASURE_ATTEMPTS ? 'gave-up' : 'unmeasured', at: now, attempts };
  }
}

export function markActed(r: RegionRecord, now: number): RegionRecord {
  return { ...r, status: 'acted', at: now };
}

export function markChoseManually(prev: RegionRecord | null | undefined, now: number): RegionRecord {
  return { ...prev, status: 'chose-manually', at: now, attempts: prev?.attempts ?? 0 };
}

export function regionRecordKey(providerId: string): string {
  return `regionRecommendation.${providerId}`;
}

function isMedians(v: unknown): v is Record<string, number | null> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((x) => x === null || typeof x === 'number');
}

/** A stored record, or null when absent or unusable; never throws. */
export function readRegionRecord(
  providerId: string,
  storage: Pick<Storage, 'getItem'> | null,
): RegionRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(regionRecordKey(providerId));
    if (raw == null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (!STATUSES.includes(o.status as RegionRecordStatus)) return null;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
    if (typeof o.attempts !== 'number' || !Number.isFinite(o.attempts)) return null;
    const r: RegionRecord = { status: o.status as RegionRecordStatus, at: o.at, attempts: o.attempts };
    if (o.medians !== undefined) {
      if (!isMedians(o.medians)) return null;
      r.medians = o.medians;
    }
    if (o.recommended !== undefined) {
      if (typeof o.recommended !== 'string') return null;
      r.recommended = o.recommended;
    }
    return r;
  } catch {
    return null;
  }
}

export function writeRegionRecord(
  providerId: string,
  r: RegionRecord,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(regionRecordKey(providerId), JSON.stringify(r));
  } catch (cause) {
    reportWarning('RegionRecommendation', 'Could not save the region recommendation record', {
      cause,
      dedupeKey: 'region:record',
    });
  }
}
