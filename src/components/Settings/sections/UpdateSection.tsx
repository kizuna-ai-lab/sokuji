import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../../utils/environment';
import { useUpdateStatus, useCheckForUpdates, useOpenUpdateDialog } from '../../../stores/updateStore';
import './UpdateSection.scss';

const UpdateSection: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const checkForUpdates = useCheckForUpdates();
  const openDialog = useOpenUpdateDialog();
  const [showUpToDate, setShowUpToDate] = useState(false);

  // Show "Up to date" briefly after check completes
  useEffect(() => {
    if (status === 'not-available') {
      setShowUpToDate(true);
      const timer = setTimeout(() => setShowUpToDate(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // When update is available, open dialog instead
  useEffect(() => {
    if (status === 'available') {
      openDialog();
    }
  }, [status, openDialog]);

  // Only show in Electron
  if (!isElectron()) return null;

  const handleClick = () => {
    if (status === 'checking') return;
    checkForUpdates();
  };

  const getButtonText = (): string => {
    if (status === 'checking') return t('update.checking');
    if (showUpToDate) return t('update.upToDate');
    return t('update.checkButton');
  };

  return (
    <div className="config-section" id="update-section">
      <h3>
        <RefreshCw size={18} />
        <span>{t('update.checkButton')}</span>
      </h3>
      <button
        className={`check-update-button ${status === 'checking' ? 'checking' : ''} ${showUpToDate ? 'up-to-date' : ''}`}
        onClick={handleClick}
        disabled={status === 'checking'}
      >
        {status === 'checking' && <RefreshCw size={14} className="spinning" />}
        {getButtonText()}
      </button>
    </div>
  );
};

export default UpdateSection;
