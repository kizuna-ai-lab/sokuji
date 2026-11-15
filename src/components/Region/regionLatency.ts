import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import { REGION_FAMILIES, type RegionFamily } from '../../lib/region/regionalProviders';
import { useRegionLatencyStore, type RegionLatency } from '../../stores/regionLatencyStore';

export type ShownLatency = RegionLatency | 'measuring';

/**
 * What the region drop-down of a family shows next to each region: `measuring`
 * for every region while a measurement is in flight, otherwise the cached
 * numbers, or `null` (plain labels) when there is nothing to show. `live`
 * measures on mount (when the cache is over 10 minutes old); a locked select
 * passes false and only reads. Display only: it writes no setting.
 */
export function useRegionLatencies(family: RegionFamily, live: boolean): Readonly<Record<string, ShownLatency>> | null {
  const entry = useRegionLatencyStore((s) => s.families[family]);
  const ensureFresh = useRegionLatencyStore((s) => s.ensureFresh);
  useEffect(() => {
    if (live) ensureFresh(family);
  }, [family, live, ensureFresh]);

  if (entry?.measuring) {
    return Object.fromEntries(REGION_FAMILIES[family].regions.map((r) => [r, 'measuring' as const]));
  }
  return entry?.medians ?? null;
}

export function regionOptionLabel(t: TFunction, label: string, latency: ShownLatency | undefined): string {
  if (latency === undefined) return label;
  const suffix =
    latency === 'measuring' ? t('region.latencyMeasuring', 'measuring…')
    : latency === 'unreachable' ? t('region.latencyUnreachable', 'unreachable')
    : t('region.latencyMs', '{{ms}} ms', { ms: latency });
  return `${label} — ${suffix}`;
}
