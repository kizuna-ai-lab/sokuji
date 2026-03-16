import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../utils/environment';
import {
  useUpdateStatus,
  useUpdateNewVersion,
  useUpdateChangelog,
  useUpdateProgressPercent,
  useUpdateProgressTransferred,
  useUpdateProgressTotal,
  useUpdateDownloadUrl,
  useUpdateDialogOpen,
  useCloseUpdateDialog,
  useDownloadUpdate,
  useInstallUpdate,
} from '../../stores/updateStore';
import './UpdateDialog.scss';

const UpdateDialog: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const newVersion = useUpdateNewVersion();
  const changelog = useUpdateChangelog();
  const percent = useUpdateProgressPercent();
  const transferred = useUpdateProgressTransferred();
  const total = useUpdateProgressTotal();
  const downloadUrl = useUpdateDownloadUrl();
  const dialogOpen = useUpdateDialogOpen();
  const closeDialog = useCloseUpdateDialog();
  const downloadUpdate = useDownloadUpdate();
  const installUpdate = useInstallUpdate();

  const [currentVersion, setCurrentVersion] = React.useState('?');

  React.useEffect(() => {
    if (isElectron() && dialogOpen) {
      (window as any).electron?.invoke('get-app-version')?.then((v: string) => {
        if (v) setCurrentVersion(v);
      });
    }
  }, [dialogOpen]);

  if (!dialogOpen) return null;

  const isLinux = navigator.platform.toLowerCase().includes('linux');

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getTitle = (): string => {
    switch (status) {
      case 'available': return t('update.available', { version: newVersion });
      case 'downloading': return t('update.downloading', { percent: Math.round(percent) });
      case 'downloaded': return t('update.downloaded');
      case 'not-available': return t('update.notAvailable');
      default: return t('update.checkButton');
    }
  };

  return (
    <div className="update-dialog-overlay" onClick={closeDialog}>
      <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-dialog-header">
          <h3>{getTitle()}</h3>
          <button className="close-button" onClick={closeDialog}>
            <X size={16} />
          </button>
        </div>

        <div className="update-dialog-body">
          {status === 'available' && newVersion && (
            <div className="version-info">
              <span>{t('update.currentVersion', { version: currentVersion })}</span>
              <span className="arrow">→</span>
              <span className="new-version">{t('update.newVersion', { version: newVersion })}</span>
            </div>
          )}

          {changelog && (status === 'available' || status === 'downloading' || status === 'downloaded') && (
            <div className="changelog">
              <pre>{changelog}</pre>
            </div>
          )}

          {status === 'downloading' && (
            <div className="download-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-details">
                <span>{formatBytes(transferred)} / {formatBytes(total)}</span>
                <span>{Math.round(percent)}%</span>
              </div>
            </div>
          )}

          {status === 'not-available' && (
            <div className="up-to-date">
              <p>{t('update.notAvailable')}</p>
            </div>
          )}
        </div>

        <div className="update-dialog-footer">
          {status === 'available' && (
            <>
              {isLinux && downloadUrl ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    window.open(downloadUrl, '_blank');
                    closeDialog();
                  }}
                >
                  {t('update.goToDownload')}
                </button>
              ) : (
                <button className="primary-button" onClick={downloadUpdate}>
                  {t('update.downloadNow')}
                </button>
              )}
              <button className="secondary-button" onClick={closeDialog}>
                {t('update.later')}
              </button>
            </>
          )}

          {status === 'downloaded' && (
            <>
              <button className="primary-button" onClick={installUpdate}>
                {t('update.restartNow')}
              </button>
              <button className="secondary-button" onClick={closeDialog}>
                {t('update.later')}
              </button>
            </>
          )}

          {status === 'not-available' && (
            <button className="secondary-button" onClick={closeDialog}>
              {t('common.close', 'Close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateDialog;
