/**
 * The host of the region recommendation: it watches the app state, and 5 s
 * after the gate opens it runs the one-time measurement of the selected
 * managed provider. Later pieces (the voice warning, the region list) render
 * inside this same wrapper.
 */
import React, { useEffect } from 'react';
import { useAnalytics } from '../../lib/analytics';
import { reportWarning } from '../../lib/diagnostics/report';
import { isRecommendedProvider } from '../../lib/region/regionalProviders';
import { RECOMMENDATION_DELAY_MS, recommendationGate, runRegionRecommendation } from '../../lib/region/runRecommendation';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import { useSetupWizardOpen } from '../../stores/layoutStore';
import { useAuthContext } from '../providers/useAuthContext';
import { useTour } from '../Tour/TourProvider';
import RegionChangeConfirm from './RegionChangeConfirm';
import { useOnline } from './useOnline';

export default function RegionRecommendation(): React.JSX.Element {
  const { trackEvent } = useAnalytics();
  const selected = useProviderStore((s) => s.selected);
  const loadedEntry = useProviderStore((s) => (s.selected ? !!s.entries[s.selected] : false));
  const locked = useProviderStore((s) => s.selectionLocked);
  const auth = useAuthContext();
  const wizardOpen = useSetupWizardOpen();
  const tourActive = useTour().active;
  const online = useOnline();
  const record = useRegionRecommendationStore((s) => (isRecommendedProvider(selected) ? s.records[selected] : undefined));

  const ready = recommendationGate({
    provider: selected,
    loaded: loadedEntry,
    signedIn: !!auth.loaded && auth.signedIn,
    wizardOpen,
    tourActive,
    locked,
    online,
    record,
  });

  // The latest tracker, so the effect is keyed only on the gate and provider.
  const trackRef = React.useRef(trackEvent);
  trackRef.current = trackEvent;

  useEffect(() => {
    if (!ready || !isRecommendedProvider(selected)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      runRegionRecommendation(selected, {
        signal: controller.signal,
        track: (e) => trackRef.current('region_recommendation', e),
      }).catch((cause) => {
        reportWarning('RegionRecommendation', 'The region measurement failed.', { dedupeKey: 'region:run', cause });
      });
    }, RECOMMENDATION_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ready, selected]);

  return (
    <div data-testid="region-recommendation">
      <RegionChangeConfirm />
    </div>
  );
}
