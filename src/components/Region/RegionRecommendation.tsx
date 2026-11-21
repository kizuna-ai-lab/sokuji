/**
 * The host of the region recommendation: it watches the app state, and 5 s
 * after the gate opens it runs the one-time measurement of the plan's
 * managed provider that a recommendation covers. Later pieces (the voice
 * warning, the region list) render inside this same wrapper.
 */
import React, { useEffect } from 'react';
import { useAnalytics } from '../../lib/analytics';
import { reportWarning } from '../../lib/diagnostics/report';
import { usePlan } from '../../lib/plan/fromStores';
import { providersIn } from '../../lib/plan/read';
import { isRecommendedProvider } from '../../lib/region/regionalProviders';
import { RECOMMENDATION_DELAY_MS, recommendationGate, runRegionRecommendation } from '../../lib/region/runRecommendation';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import { useSetupWizardOpen } from '../../stores/layoutStore';
import { useAuthContext } from '../providers/useAuthContext';
import { useTour } from '../Tour/TourProvider';
import RegionChangeConfirm from './RegionChangeConfirm';
import RegionListModal from './RegionListModal';
import { useOnline } from './useOnline';

export default function RegionRecommendation(): React.JSX.Element {
  const { trackEvent } = useAnalytics();
  // The plan's provider a recommendation covers, once the line-up and every entry of the plan have loaded
  // (one provider per plan in this step).
  const plan = usePlan();
  const provider = plan.state === 'ready' ? providersIn(plan.plan).find((p) => isRecommendedProvider(p.id))?.id ?? null : null;
  const locked = useLineUpStore((s) => s.locked);
  const auth = useAuthContext();
  const wizardOpen = useSetupWizardOpen();
  const tourActive = useTour().active;
  const online = useOnline();
  const record = useRegionRecommendationStore((s) => (isRecommendedProvider(provider) ? s.records[provider] : undefined));

  const ready = recommendationGate({
    provider,
    loaded: plan.state === 'ready',
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
    if (!ready || !isRecommendedProvider(provider)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      runRegionRecommendation(provider, {
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
  }, [ready, provider]);

  return (
    <div data-testid="region-recommendation">
      <RegionListModal />
      <RegionChangeConfirm />
    </div>
  );
}
