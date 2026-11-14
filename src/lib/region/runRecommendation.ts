/**
 * The one-time region measurement for a managed provider: when it may happen
 * (the gate), what it records, and the analytics event it reports. It only
 * records; changing a region is always the user's click.
 */
import type { AnalyticsEvents } from '../analytics';
import { reportWarning } from '../diagnostics/report';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionLatencyStore } from '../../stores/regionLatencyStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import { decideRegion } from './decision';
import { measureRegionFamily } from './measure';
import { needsMeasurement, recordAfterMeasurement, type RegionRecord } from './record';
import { REGION_FAMILIES, REGION_FAMILY_OF, currentRegion, isRecommendedProvider, type RecommendedProviderId } from './regionalProviders';

export const RECOMMENDATION_DELAY_MS = 5000;

export interface GateInputs {
  provider: string | null;
  loaded: boolean;
  signedIn: boolean;
  wizardOpen: boolean;
  tourActive: boolean;
  locked: boolean;
  online: boolean;
  record: RegionRecord | undefined;
}

export function recommendationGate(i: GateInputs): boolean {
  return (
    isRecommendedProvider(i.provider) &&
    i.loaded &&
    i.signedIn &&
    !i.wizardOpen &&
    !i.tourActive &&
    !i.locked &&
    i.online &&
    needsMeasurement(i.record)
  );
}

type RegionEvent = AnalyticsEvents['region_recommendation'];

export function regionRecommendationEvent(
  provider: RecommendedProviderId,
  record: RegionRecord,
  current: string,
  outcome: RegionEvent['outcome'],
  chosen: string,
): RegionEvent {
  return {
    provider,
    medians: { ...(record.medians ?? {}) },
    current,
    recommended: record.recommended ?? null,
    outcome,
    chosen,
  };
}

const attempted = new Set<RecommendedProviderId>();

export function resetRecommendationAttemptsForTests(): void {
  attempted.clear();
}

export async function runRegionRecommendation(
  provider: RecommendedProviderId,
  deps: { signal: AbortSignal; track(e: RegionEvent): void; now?(): number },
): Promise<void> {
  const store = useRegionRecommendationStore.getState();
  const prev = store.records[provider];
  if (!needsMeasurement(prev) || attempted.has(provider)) return;
  attempted.add(provider);

  const family = REGION_FAMILY_OF[provider];
  let result;
  try {
    result = await measureRegionFamily(family, deps.signal);
  } catch (cause) {
    reportWarning('RegionRecommendation', 'Could not measure region latency', { cause, dedupeKey: 'region:measure' });
    result = null;
  }
  if (!result || deps.signal.aborted) {
    attempted.delete(provider);
    return;
  }

  const now = (deps.now ?? Date.now)();
  useRegionLatencyStore.getState().fill(family, result, now);
  const current = currentRegion(provider, useProviderStore.getState().entries[provider]?.settings);
  const decision = decideRegion(REGION_FAMILIES[family].regions, result, current);
  const record = recordAfterMeasurement(useRegionRecommendationStore.getState().records[provider], decision, result, now);
  useRegionRecommendationStore.getState().setRecord(provider, record);

  if (record.status === 'no-change') {
    deps.track(regionRecommendationEvent(provider, record, current, 'no_change', current));
  } else if (record.status === 'gave-up') {
    deps.track(regionRecommendationEvent(provider, { ...record, medians: { ...result } }, current, 'gave_up', current));
  }
}
