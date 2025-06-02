import React from 'react';
import { useTranslation } from 'react-i18next';

const I18nExample: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div style={{ padding: '20px', color: 'white' }}>
      <h2>{t('app.title')}</h2>
      <p>{t('app.description')}</p>
      
      <div style={{ marginTop: '20px' }}>
        <h3>{t('translation.start')}</h3>
        <p>{t('translation.listening')}</p>
        <p>{t('translation.translating')}</p>
      </div>
      
      <div style={{ marginTop: '20px' }}>
        <h3>{t('settings.title')}</h3>
        <p>{t('settings.language')}: {t('settings.audio')}</p>
      </div>
    </div>
  );
};

export default I18nExample; 