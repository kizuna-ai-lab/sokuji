import React from 'react';
import { ArrowLeftRight, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSetOutletChannel } from '../../stores/audioStore';
import { useFaceToFace } from '../MainPanel/useFaceToFace';
import { getAppAudio } from '../../lib/audio/appAudio';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import './EarsBlock.scss';

interface EarsBlockProps {
  className?: string;
}

/**
 * Face-to-face's ears: which language plays in each ear, a preview chime per ear,
 * and the swap. Absent unless face-to-face is on and some leg is voiced: under Text
 * Only nothing plays in either ear, so there are no ears, previews or swap.
 */
const EarsBlock: React.FC<EarsBlockProps> = ({ className }) => {
  const { t } = useTranslation();
  const f2f = useFaceToFace();
  const setOutletChannel = useSetOutletChannel();
  const label = useLanguageLabel();

  if (!(f2f.active && f2f.me && f2f.other && (f2f.speaks.speaker || f2f.speaks.participant))) return null;

  return (
    <div className={`ears-block${className ? ` ${className}` : ''}`}>
      <div className="ears-block__title">{t('faceToFace.earsTitle', 'Left and right · each person hears the translation into their own language')}</div>
      {(['left', 'right'] as const).map((ear) => {
        const mine = f2f.ears.participant === ear;
        // My ear plays the participant leg's translation (into my language); theirs, mine.
        const voiced = f2f.speaks[mine ? 'participant' : 'speaker'];
        const outlet = mine ? 'them' : 'other';
        const earName = ear === 'left' ? t('faceToFace.leftEar', 'Left ear') : t('faceToFace.rightEar', 'Right ear');
        return (
          <div key={ear} className={`ears-block__ear ears-block__ear--${mine ? 'me' : 'other'}`}>
            <span className="ears-block__ear-letter">{ear === 'left' ? t('faceToFace.earLeft', 'L') : t('faceToFace.earRight', 'R')}</span>
            <span className="ears-block__ear-name">{earName}</span>
            <span className="ears-block__ear-who">
              {mine
                ? t('faceToFace.meListens', 'Me ({{language}})', { language: label(f2f.me!) })
                : t('faceToFace.otherListens', 'Other person ({{language}})', { language: label(f2f.other!) })}
            </span>
            {voiced ? (
              <button
                type="button"
                className="ears-block__ear-preview"
                aria-label={ear === 'left' ? t('faceToFace.previewLeft', 'Preview the left ear') : t('faceToFace.previewRight', 'Preview the right ear')}
                onClick={() => {
                  void getAppAudio()
                    .then((app) => app.earPreview(outlet))
                    .catch((error: unknown) => reportError('EarsBlock', `The ear preview did not play: ${describeCause(error)}`, { cause: error }));
                }}
              >
                <Play size={12} />
              </button>
            ) : (
              // A silent leg (Kizuna Soniox's participant today): nothing plays in this ear.
              <span className="ears-block__ear-off">{t('popover.statusOff', 'Off')}</span>
            )}
          </div>
        );
      })}
      <div className="ears-block__actions">
        <button type="button" className="ears-block__swap" onClick={() => {
            // Each outlet takes the other one's ear.
            setOutletChannel('other', f2f.ears.participant);
            setOutletChannel('them', f2f.ears.speaker);
          }}
        >
          <ArrowLeftRight size={14} />
          {t('faceToFace.swap', 'Swap left and right')}
        </button>
        <span className="ears-block__hint">{t('faceToFace.speakersHint', 'Use headphones, one side each. Any speaker lets the microphone pick up the translation and translate it again.')}</span>
      </div>
    </div>
  );
};

export default EarsBlock;
