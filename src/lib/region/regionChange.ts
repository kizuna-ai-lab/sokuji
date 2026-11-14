/**
 * The one path every region change goes through: the drop-downs and the
 * recommendation list both call `requestRegionChange`. Refuses during a run;
 * a Soniox change may ask about the custom voice first.
 */
import type { AnalyticsEvents } from '../analytics';
import { reportWarning } from '../diagnostics/report';
import { currentRunPhase } from '../../app/runPhase';
import { requestSonioxRegionChange } from '../../providers/soniox/regionChange';
import { loadedProvider, useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import type { SonioxRegion } from '../soniox/regions';
import type { AuthContext } from '../provider/types';
import { markChoseManually } from './record';
import { REGION_FAMILIES, REGION_FAMILY_OF, currentRegion, isRecommendedProvider, type RegionalProviderId } from './regionalProviders';
import { regionRecommendationEvent } from './runRecommendation';

export type RegionChangeOrigin = 'select' | 'list';

type RegionChangeRequest = {
  providerId: string;
  to: string;
  origin: RegionChangeOrigin;
  auth?: AuthContext;
  /** Reports a pending hint the select change resolves (the list reports its own). */
  track?(e: AnalyticsEvents['region_recommendation']): void;
};

/** A throw anywhere in the path is recorded and the change does not happen: callers fire this without a `.catch`. */
export async function requestRegionChange(r: RegionChangeRequest): Promise<boolean> {
  try {
    return await changeRegion(r);
  } catch (cause) {
    reportWarning('RegionChange', 'The region change failed.', { dedupeKey: 'region:change', cause });
    return false;
  }
}

async function changeRegion(r: RegionChangeRequest): Promise<boolean> {
  if (!Object.prototype.hasOwnProperty.call(REGION_FAMILY_OF, r.providerId)) return false;
  const id = r.providerId as RegionalProviderId;
  const family = REGION_FAMILY_OF[id];
  const provider = loadedProvider(id);
  const entry = useProviderStore.getState().entries[id];
  if (!provider || !entry || currentRunPhase() !== 'idle') return false;
  const to = REGION_FAMILIES[family].narrow(r.to);
  const from = currentRegion(id, entry.settings);
  if (to === from) return false;

  let changed: boolean;
  if (family === 'soniox') {
    changed = await requestSonioxRegionChange(provider, from as SonioxRegion, to as SonioxRegion, r.auth);
  } else {
    await useProviderStore.getState().updateSettings(provider, { region: to });
    changed = true;
  }

  if (changed && r.origin === 'select' && isRecommendedProvider(id)) {
    const store = useRegionRecommendationStore.getState();
    const prev = store.records[id];
    // Following a pending hint by hand resolves it: reported as switched, recorded as chose-manually.
    if (prev?.status === 'hint') r.track?.(regionRecommendationEvent(id, prev, from, 'switched', to));
    store.setRecord(id, markChoseManually(prev, Date.now()));
  }
  return changed;
}
