/**
 * Latest measured latency per region family, for display in the region
 * drop-downs. In memory only; keyed by family so own-key and managed Soniox
 * share one entry (same hosts).
 */
import { create } from 'zustand';
import type { RegionMedians } from '../lib/region/probe';
import { measureRegionFamily } from '../lib/region/measure';
import type { RegionFamily } from '../lib/region/regionalProviders';

export const LATENCY_CACHE_MS = 600_000;

export type RegionLatency = number | 'unreachable';

export interface FamilyLatency {
  medians: Readonly<Record<string, RegionLatency>> | null;
  at: number | null;
  measuring: boolean;
}

interface RegionLatencyState {
  families: Partial<Record<RegionFamily, FamilyLatency>>;
  /** Measure unless the cached numbers are under 10 minutes old or a measurement is in flight. */
  ensureFresh(family: RegionFamily): void;
  fill(family: RegionFamily, medians: RegionMedians, at: number): void;
}

const EMPTY: FamilyLatency = { medians: null, at: null, measuring: false };

export const useRegionLatencyStore = create<RegionLatencyState>((set, get) => {
  const patch = (family: RegionFamily, change: Partial<FamilyLatency>) =>
    set((s) => ({ families: { ...s.families, [family]: { ...EMPTY, ...s.families[family], ...change } } }));

  return {
    families: {},

    ensureFresh(family) {
      const entry = get().families[family];
      if (entry?.measuring) return;
      if (entry?.at != null && Date.now() - entry.at < LATENCY_CACHE_MS) return;
      patch(family, { measuring: true });
      // Display only: a null result or a failure keeps the last numbers and reports nothing.
      measureRegionFamily(family).then(
        (result) => {
          if (result) get().fill(family, result, Date.now());
          else patch(family, { measuring: false });
        },
        () => patch(family, { measuring: false }),
      );
    },

    fill(family, medians, at) {
      const mapped: Record<string, RegionLatency> = {};
      for (const [region, ms] of Object.entries(medians)) mapped[region] = ms === null ? 'unreachable' : ms;
      patch(family, { medians: mapped, at, measuring: false });
    },
  };
});
