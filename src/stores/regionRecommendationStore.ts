/**
 * The device-local region recommendation records, one per managed provider,
 * mirrored to localStorage; and which provider's region list is open.
 */
import { create } from 'zustand';
import { readRegionRecord, writeRegionRecord, type RegionRecord } from '../lib/region/record';
import { RECOMMENDED_PROVIDER_IDS, type RecommendedProviderId } from '../lib/region/regionalProviders';

type Records = Partial<Record<RecommendedProviderId, RegionRecord>>;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRegionRecords(storage: Pick<Storage, 'getItem'> | null): Records {
  const records: Records = {};
  for (const id of RECOMMENDED_PROVIDER_IDS) {
    const r = readRegionRecord(id, storage);
    if (r) records[id] = r;
  }
  return records;
}

interface RegionRecommendationState {
  records: Records;
  listOpen: RecommendedProviderId | null;
  setRecord(p: RecommendedProviderId, r: RegionRecord): void;
  openList(p: RecommendedProviderId): void;
  closeList(): void;
}

export const useRegionRecommendationStore = create<RegionRecommendationState>((set) => ({
  records: loadRegionRecords(browserStorage()),
  listOpen: null,
  setRecord(p, r) {
    set((s) => ({ records: { ...s.records, [p]: r } }));
    writeRegionRecord(p, r, browserStorage());
  },
  openList: (p) => set({ listOpen: p }),
  closeList: () => set({ listOpen: null }),
}));
