import React, { useEffect } from 'react';
import { HelpCircle, RefreshCw, Mail, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
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

  const openExternalUrl = (url: string) => {
    if (isElectron() && (window as any).electron?.invoke) {
      (window as any).electron.invoke('open-external', url);
    } else {
      window.open(url, '_blank');
    }
  };

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
      <div className="setting-item">
        <Tooltip content={t('settings.helpEmailTooltip', 'Report bugs or get help')} position="top">
          <button
            className="restart-onboarding-button"
            onClick={() => openExternalUrl('mailto:support@kizuna.ai')}
          >
            <Mail size={16} />
            <span>{t('settings.helpEmailSupport', 'Email Support')}</span>
          </button>
        </Tooltip>
      </div>
      <div className="setting-item">
        <Tooltip content={t('settings.helpDiscussionsTooltip', 'Feature requests, feedback, and community discussions')} position="top">
          <button
            className="restart-onboarding-button"
            onClick={() => openExternalUrl('https://github.com/kizuna-ai-lab/sokuji/discussions')}
          >
            <MessageSquare size={16} />
            <span>{t('settings.helpDiscussions', 'Discussions')}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default HelpSection;
