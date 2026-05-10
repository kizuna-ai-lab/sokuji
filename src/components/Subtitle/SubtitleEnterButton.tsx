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

  const label = t('subtitle.enterButton.label', 'Subtitle');
  const tooltip = isSessionActive
    ? t('subtitle.enterButton.title', 'Enter subtitle mode')
    : t('subtitle.enterButton.disabled', 'Start a session first');

  return (
    <button
      type="button"
      className="title-bar__action"
      onClick={() => void enterSubtitleMode()}
      disabled={!isSessionActive}
      title={tooltip}
      aria-label={tooltip}
    >
      <Captions size={14} />
      <span className="title-bar__action-label">{label}</span>
    </button>
  );
};

export default SubtitleEnterButton;
