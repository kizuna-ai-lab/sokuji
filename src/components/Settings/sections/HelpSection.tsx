import React, { useEffect } from 'react';
import { HelpCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../../utils/environment';
import { useOnboarding } from '../../../contexts/OnboardingContext';
import { useUpdateStatus, useCheckForUpdates, useOpenUpdateDialog } from '../../../stores/updateStore';

interface HelpSectionProps {
  toggleSettings?: () => void;
}

const HelpSection: React.FC<HelpSectionProps> = ({ toggleSettings }) => {
  const { t } = useTranslation();
  const { startOnboarding } = useOnboarding();
  const updateStatus = useUpdateStatus();
  const checkForUpdates = useCheckForUpdates();
  const openUpdateDialog = useOpenUpdateDialog();

  useEffect(() => {
    if (updateStatus === 'available') openUpdateDialog();
  }, [updateStatus, openUpdateDialog]);

  return (
    <div className="config-section" id="help-section">
      <h3>
        <HelpCircle size={18} />
        <span>{t('settings.help', 'Help')}</span>
      </h3>
      <div className="setting-item">
        <button
          className="restart-onboarding-button"
          onClick={() => {
            startOnboarding();
            if (toggleSettings) {
              toggleSettings();
            }
          }}
        >
          <HelpCircle size={16} />
          <span>{t('onboarding.restartTour', 'Restart Setup Guide')}</span>
        </button>
      </div>
      {isElectron() && (
        <div className="setting-item">
          <button
            className="restart-onboarding-button"
            onClick={checkForUpdates}
            disabled={updateStatus === 'checking'}
          >
            <RefreshCw size={16} className={updateStatus === 'checking' ? 'spinning' : ''} />
            <span>{updateStatus === 'checking' ? t('update.checking') : t('update.checkButton')}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default HelpSection;
