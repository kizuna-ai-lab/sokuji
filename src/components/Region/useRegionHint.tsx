/**
 * The region hint strip: after the one-time measurement recorded a `hint`
 * for the selected managed provider, a dismissible banner says the
 * recommended region is faster and offers the region list. Closing it keeps
 * the current region for good. It never changes a region itself.
 */
import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { RECOMMEND_MIN_GAIN_MS } from '../../lib/region/decision';
import { markActed } from '../../lib/region/record';
import { regionRecommendationEvent } from '../../lib/region/runRecommendation';
import { REGION_FAMILIES, REGION_FAMILY_OF, currentRegion, isRecommendedProvider, type RecommendedProviderId } from '../../lib/region/regionalProviders';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import type { RegionRecord } from '../../lib/region/record';
import type { BannerProps } from '../Banner/Banner';

/**
 * Whether the hint (and its list) may show: the provider is selected and idle,
 * the record is a `hint` whose recommended region belongs to the family with a
 * measured median, and the live region is not already that one nor, when
 * measured, within `RECOMMEND_MIN_GAIN_MS` of it (changed elsewhere to a
 * near-best region; the record stays a hint). Returns the live region.
 */
export function usableHint(
  provider: string | null,
  selected: string | null,
  locked: boolean,
  record: RegionRecord | undefined,
  settings: unknown,
): { provider: RecommendedProviderId; current: string; recommended: string } | null {
  if (!isRecommendedProvider(provider) || provider !== selected || locked) return null;
  if (!record || record.status !== 'hint' || !record.recommended) return null;
  const family = REGION_FAMILIES[REGION_FAMILY_OF[provider]];
  if (!family.regions.includes(record.recommended)) return null;
  const recommendedMedian = record.medians?.[record.recommended];
  if (typeof recommendedMedian !== 'number') return null;
  const current = currentRegion(provider, settings);
  if (current === record.recommended) return null;
  const currentMedian = record.medians?.[current];
  if (typeof currentMedian === 'number' && currentMedian - recommendedMedian < RECOMMEND_MIN_GAIN_MS) return null;
  return { provider, current, recommended: record.recommended };
}

export function useRegionHint(): BannerProps | null {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const selected = useProviderStore((s) => s.selected);
  const locked = useProviderStore((s) => s.selectionLocked);
  const settings = useProviderStore((s) => (s.selected ? s.entries[s.selected]?.settings : undefined));
  const record = useRegionRecommendationStore((s) => (isRecommendedProvider(selected) ? s.records[selected] : undefined));
  const setRecord = useRegionRecommendationStore((s) => s.setRecord);
  const openList = useRegionRecommendationStore((s) => s.openList);

  const usable = usableHint(selected, selected, locked, record, settings);
  if (!usable || !isRecommendedProvider(selected) || !record) return null;
  const { current, recommended } = usable;

  const family = REGION_FAMILIES[REGION_FAMILY_OF[selected]];
  const currentMedian = record.medians?.[current];
  const recommendedMedian = record.medians?.[recommended] as number;
  const params = { region: family.label(recommended), current: family.label(current) };
  const text = typeof currentMedian === 'number'
    ? t('region.hintFaster', '{{region}} is about {{ms}} ms faster than your current region ({{current}})', { ...params, ms: Math.round((currentMedian - recommendedMedian) / 10) * 10 })
    : t('region.hintCurrentUnreachable', '{{region}} answers in {{ms}} ms; your current region ({{current}}) could not be reached', { ...params, ms: recommendedMedian });

  return {
    id: 'region-hint',
    tone: 'brand',
    icon: <Gauge size={14} aria-hidden="true" />,
    text,
    action: { label: t('region.hintAction', "See each region's speed"), onClick: () => openList(selected) },
    onDismiss: () => {
      setRecord(selected, markActed(record, Date.now()));
      trackEvent('region_recommendation', regionRecommendationEvent(selected, record, current, 'kept', current));
    },
    dismissLabel: t('common.dismiss', 'Dismiss'),
  };
}
