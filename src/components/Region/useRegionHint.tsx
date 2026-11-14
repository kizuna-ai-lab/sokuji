/**
 * The region hint strip: after the one-time measurement recorded a `hint`
 * for the selected managed provider, a dismissible banner says the
 * recommended region is faster and offers the region list. Closing it keeps
 * the current region for good. It never changes a region itself.
 */
import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { markActed } from '../../lib/region/record';
import { regionRecommendationEvent } from '../../lib/region/runRecommendation';
import { REGION_FAMILIES, REGION_FAMILY_OF, currentRegion, isRecommendedProvider } from '../../lib/region/regionalProviders';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import type { BannerProps } from '../Banner/Banner';

export function useRegionHint(): BannerProps | null {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const selected = useProviderStore((s) => s.selected);
  const locked = useProviderStore((s) => s.selectionLocked);
  const settings = useProviderStore((s) => (s.selected ? s.entries[s.selected]?.settings : undefined));
  const record = useRegionRecommendationStore((s) => (isRecommendedProvider(selected) ? s.records[selected] : undefined));
  const setRecord = useRegionRecommendationStore((s) => s.setRecord);
  const openList = useRegionRecommendationStore((s) => s.openList);

  if (!isRecommendedProvider(selected) || locked || !record || record.status !== 'hint' || !record.recommended) return null;
  const current = currentRegion(selected, settings);
  if (current === record.recommended) return null;

  const family = REGION_FAMILIES[REGION_FAMILY_OF[selected]];
  const recommended = record.recommended;
  const currentMedian = record.medians?.[current];
  const recommendedMedian = record.medians?.[recommended];
  const params = { region: family.label(recommended), current: family.label(current) };
  const text = typeof currentMedian === 'number' && typeof recommendedMedian === 'number'
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
