/**
 * The voice warning: a Soniox region change whose custom voice would not
 * follow asks here first. It only renders the question the region change path
 * put in `useRegionChangeStore` and answers it; Switch answers true, Cancel
 * and the X answer false, and so does a session starting while it is open.
 */
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SONIOX_REGION_LABELS } from '../../lib/soniox/regions';
import { useProviderStore } from '../../stores/providerStore';
import { useRegionChangeStore } from '../../stores/regionChangeStore';
import Modal from '../Modal/Modal';
import './Region.scss';

export default function RegionChangeConfirm(): React.JSX.Element | null {
  const { t } = useTranslation();
  const question = useRegionChangeStore((s) => s.question);
  const answer = useRegionChangeStore((s) => s.answer);
  const locked = useProviderStore((s) => s.selectionLocked);
  // A session that starts while the question is open answers it "no" (the change would be refused anyway), resolving the waiting change.
  useEffect(() => {
    if (locked && question) useRegionChangeStore.getState().answer(false);
  }, [locked, question]);
  if (!question) return null;

  const from = SONIOX_REGION_LABELS[question.from];
  const to = SONIOX_REGION_LABELS[question.to];
  const ownKey = !question.managed;
  const body = question.warning.kind === 'built-in'
    ? (ownKey
      ? t('region.changeBuiltInOwnKey', "Your custom voice is in your {{from}} Soniox project and can't be used in {{to}}. Sessions in {{to}} will use the built-in voice {{name}} until you create a custom voice in your {{to}} project. Your {{from}} voice stays; switching back to {{from}} uses it again.", { from, to, name: question.warning.name })
      : t('region.changeBuiltIn', "Your custom voice is saved in the {{from}} region and can't be used in {{to}}. Sessions in {{to}} will use the built-in voice {{name}} until you create a custom voice there. Your {{from}} voice stays; switching back to {{from}} uses it again.", { from, to, name: question.warning.name }))
    : (ownKey
      ? t('region.changeCustomOwnKey', 'Sessions in {{to}} will use the custom voice in your {{to}} Soniox project. Your {{from}} voice stays in your {{from}} project.', { from, to })
      : t('region.changeCustom', 'Sessions in {{to}} will use the custom voice you created there. Your {{from}} voice stays in {{from}}.', { from, to }));

  return (
    <Modal isOpen onClose={() => answer(false)} title={t('region.changeTitle', 'Switch region?')}>
      <div className="region-change">
        <p>{body}</p>
        <div className="region-change__actions">
          <button type="button" className="region-change__cancel" onClick={() => answer(false)}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="region-change__confirm" onClick={() => answer(true)}>
            {t('region.changeConfirm', 'Switch to {{to}}', { to })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
