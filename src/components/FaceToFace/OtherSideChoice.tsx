import React, { useId } from 'react';
import { FaceToFaceIcon } from './FaceToFaceIcon';
import { useTranslation } from 'react-i18next';
import { useOtherSide, useSetOtherSide } from '../../stores/audioStore';
import './OtherSideChoice.scss';

interface OtherSideChoiceProps {
  /** A run is live, as the mode picker's `locked`: the run's side froze at Start, so the choice is locked too. */
  locked: boolean;
  className?: string;
}

/**
 * Both: where the other person is. A visible heading, which also names the radio
 * group, over two tiles. Callers decide when to offer it (the provider supports
 * face-to-face, the mode is Both).
 */
const OtherSideChoice: React.FC<OtherSideChoiceProps> = ({ locked, className }) => {
  const { t } = useTranslation();
  const otherSide = useOtherSide();
  const setOtherSide = useSetOtherSide();
  const headingId = useId();

  return (
    <div className={`other-side-choice${className ? ` ${className}` : ''}`}>
      <div id={headingId} className="other-side-choice__heading">
        <FaceToFaceIcon size={14} className="other-side-choice__icon" aria-hidden="true" />
        <span className="other-side-choice__label">{t('popover.otherSide', 'Other side')}</span>
      </div>
      <div className={`other-side-choice__sides${locked ? ' other-side-choice__sides--locked' : ''}`} role="radiogroup" aria-labelledby={headingId}>
        {(['meeting', 'beside'] as const).map((side) => (
          <label
            key={side}
            className={`other-side-choice__side${otherSide === side ? ' other-side-choice__side--active' : ''}`}
            title={locked ? t('modePicker.switchDisabled', 'Mode is locked during a session.') : undefined}
          >
            <input type="radio" name={headingId} checked={otherSide === side} disabled={locked} onChange={() => setOtherSide(side)} />
            <span className="other-side-choice__side-title">
              {side === 'meeting' ? t('popover.otherSideMeeting', 'In a meeting') : t('popover.otherSideBeside', 'Beside me')}
            </span>
            <span className="other-side-choice__side-hint">
              {side === 'meeting' ? t('popover.otherSideMeetingHint', 'Captures the system audio or an app') : t('popover.otherSideBesideHint', 'Two people at one microphone')}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default OtherSideChoice;
