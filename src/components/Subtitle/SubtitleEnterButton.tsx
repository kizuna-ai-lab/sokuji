import React from 'react';
import { useTranslation } from 'react-i18next';
import { Captions } from 'lucide-react';
import { useIsSessionActive } from '../../stores/sessionStore';
import { useEnterSubtitleMode } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';

const SubtitleEnterButton: React.FC = () => {
  const { t } = useTranslation();
  const enterSubtitleMode = useEnterSubtitleMode();
  const isSessionActive = useIsSessionActive();

  if (!isElectron()) return null;

  return (
    <button
      type="button"
      className="font-size-btn"
      onClick={() => void enterSubtitleMode()}
      disabled={!isSessionActive}
      title={
        isSessionActive
          ? t('subtitle.enterButton.title', 'Enter subtitle mode')
          : t('subtitle.enterButton.disabled', 'Start a session first')
      }
      aria-label={t('subtitle.enterButton.title', 'Enter subtitle mode')}
    >
      <Captions size={14} />
    </button>
  );
};

export default SubtitleEnterButton;
