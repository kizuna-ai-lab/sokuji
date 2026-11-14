/**
 * The region list: every region's measured latency for the provider whose
 * hint was opened, with a Switch per measured region other than the current
 * one. Switch goes through the shared region-change path (which may ask the
 * voice question first); Keep, the X and the backdrop keep the current region.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { markActed } from '../../lib/region/record';
import { requestRegionChange } from '../../lib/region/regionChange';
import { REGION_FAMILIES, REGION_FAMILY_OF, currentRegion } from '../../lib/region/regionalProviders';
import { regionRecommendationEvent } from '../../lib/region/runRecommendation';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionRecommendationStore } from '../../stores/regionRecommendationStore';
import Modal from '../Modal/Modal';
import { useAuthContext } from '../providers/useAuthContext';
import './Region.scss';

export default function RegionListModal(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const auth = useAuthContext();
  const providerId = useRegionRecommendationStore((s) => s.listOpen);
  const record = useRegionRecommendationStore((s) => (s.listOpen ? s.records[s.listOpen] : undefined));
  const setRecord = useRegionRecommendationStore((s) => s.setRecord);
  const closeList = useRegionRecommendationStore((s) => s.closeList);
  const settings = useProviderStore((s) => (providerId ? s.entries[providerId]?.settings : undefined));
  const [pending, setPending] = useState(false);

  if (!providerId || !record) return null;
  const family = REGION_FAMILIES[REGION_FAMILY_OF[providerId]];
  const current = currentRegion(providerId, settings);

  const resolve = (outcome: 'kept' | 'switched', chosen: string) => {
    setRecord(providerId, markActed(record, Date.now()));
    trackEvent('region_recommendation', regionRecommendationEvent(providerId, record, current, outcome, chosen));
    closeList();
  };
  const keep = () => resolve('kept', current);
  const switchTo = async (to: string) => {
    if (pending) return;
    setPending(true);
    try {
      if (await requestRegionChange({ providerId, to, origin: 'list', auth })) resolve('switched', to);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal isOpen onClose={keep} title={t('region.listTitle', 'Choose a faster region')}>
      <div className="region-list">
        <p className="region-list__intro">{t('region.listIntro', 'We measured your connection to each {{vendor}} region:', { vendor: family.vendor })}</p>
        <ul className="region-list__rows">
          {family.regions.map((r) => {
            const ms = record.medians?.[r];
            const measured = typeof ms === 'number';
            return (
              <li key={r} className="region-list__row">
                <span className="region-list__name">{family.label(r)}</span>
                <span className="region-list__ms">{measured ? t('region.latencyMs', '{{ms}} ms', { ms }) : t('region.unreachable', "Couldn't reach")}</span>
                <span className="region-list__tags">
                  {r === record.recommended && <span className="region-list__tag region-list__tag--recommended">{t('region.recommended', 'Recommended')}</span>}
                  {r === current && <span className="region-list__tag">{t('region.current', 'Current')}</span>}
                </span>
                {measured && r !== current && (
                  <button type="button" className="region-list__switch" disabled={pending} onClick={() => { void switchTo(r); }}>
                    {t('region.switch', 'Switch')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="region-list__footer">
          <button type="button" className="region-list__keep" onClick={keep}>
            {t('region.keep', 'Keep {{region}}', { region: family.label(current) })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
