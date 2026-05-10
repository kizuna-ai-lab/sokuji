import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onReturn: () => void;
}

const SubtitleSessionEnded: React.FC<Props> = ({ onReturn }) => {
  const { t } = useTranslation();
  return (
    <div className="subtitle-session-ended">
      <p>{t('subtitle.sessionEnded', 'Session ended')}</p>
      <button type="button" onClick={onReturn}>
        {t('subtitle.backToMain', 'Return to main window')}
      </button>
    </div>
  );
};

export default SubtitleSessionEnded;
