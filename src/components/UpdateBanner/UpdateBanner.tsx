import React from 'react';
import { Download, RefreshCw, X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useUpdateStatus,
  useUpdateNewVersion,
  useUpdateProgressPercent,
  useUpdateError,
  useUpdateBannerDismissed,
  useDismissBanner,
  useOpenUpdateDialog,
  useInstallUpdate,
} from '../../stores/updateStore';
import './UpdateBanner.scss';

const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const newVersion = useUpdateNewVersion();
  const percent = useUpdateProgressPercent();
  const errorMessage = useUpdateError();
  const bannerDismissed = useUpdateBannerDismissed();
  const dismissBanner = useDismissBanner();
  const openDialog = useOpenUpdateDialog();
  const installUpdate = useInstallUpdate();

  if (status === 'idle' || status === 'checking' || status === 'not-available') {
    return null;
  }

  if (bannerDismissed && status !== 'downloading' && status !== 'downloaded') {
    return null;
  }

  if (status === 'error') {
    return (
      <div className="update-banner error">
        <div className="update-banner-content">
          <AlertCircle size={14} />
          <span>{errorMessage || t('update.error')}</span>
        </div>
      </div>
    );
  }

  const handleBannerAction = () => {
    if (status === 'available') openDialog();
    if (status === 'downloaded') installUpdate();
  };

  const isClickable = status === 'available' || status === 'downloaded';

  return (
    <div className={`update-banner ${status}`}>
      <div
        className="update-banner-content"
        onClick={handleBannerAction}
        onKeyDown={(e) => {
          if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleBannerAction();
          }
        }}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
      >
        {status === 'available' && (
          <>
            <Download size={14} />
            <span>{t('update.available', { version: newVersion })}</span>
          </>
        )}

        {status === 'downloading' && (
          <>
            <RefreshCw size={14} className="spinning" />
            <span>{t('update.downloading', { percent: Math.round(percent) })}</span>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </>
        )}

        {status === 'downloaded' && (
          <>
            <RefreshCw size={14} />
            <span>{t('update.downloaded')}</span>
          </>
        )}
      </div>

      {(status === 'available' || status === 'downloaded') && (
        <button className="dismiss-button" onClick={dismissBanner} aria-label="Dismiss">
          <X size={12} />
        </button>
      )}
    </div>
  );
};

export default UpdateBanner;
