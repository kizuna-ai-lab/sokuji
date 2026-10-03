import React from 'react';
import { AlertTriangle, RefreshCw, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAudioSystemStatus,
  useAudioSystemReason,
  useAudioSystemDismissed,
  useAudioSystemRetrying,
  useAudioSystemRetry,
  useAudioSystemRepairing,
  useAudioSystemRepairFailed,
  useAudioSystemRepair,
  useAudioSystemDismiss,
} from '../../stores/audioSystemStore';
import './AudioSystemBanner.scss';

const AudioSystemBanner: React.FC = () => {
  const { t } = useTranslation();
  const status = useAudioSystemStatus();
  const reason = useAudioSystemReason();
  const dismissed = useAudioSystemDismissed();
  const retrying = useAudioSystemRetrying();
  const retry = useAudioSystemRetry();
  const repairing = useAudioSystemRepairing();
  const repairFailed = useAudioSystemRepairFailed();
  const repair = useAudioSystemRepair();
  const dismiss = useAudioSystemDismiss();

  if (status !== 'unavailable' || dismissed) {
    return null;
  }

  const isPactlMissing = reason === 'pactl-missing';
  // macOS: the driver is installed but was never loaded; the fix is a re-sign
  // behind macOS's administrator prompt, not another retry.
  const isMacDriverNotLoaded = reason === 'mac-driver-not-loaded';

  let body = t('audioSystem.unavailableBody');
  if (isPactlMissing) body = t('audioSystem.pactlMissingBody');
  if (isMacDriverNotLoaded) body = repairFailed ? t('audioSystem.macRepairFailedBody') : t('audioSystem.macDriverNotLoadedBody');

  return (
    <div className="audio-system-banner">
      <div className="audio-system-banner-content">
        <AlertTriangle size={14} />
        <div className="audio-system-banner-text">
          <span>{body}</span>
          {isPactlMissing && (
            <code className="audio-system-banner-command">{t('audioSystem.installCommand')}</code>
          )}
        </div>
      </div>
      <div className="audio-system-banner-actions">
        {isMacDriverNotLoaded ? (
          <button
            className="retry-button"
            onClick={() => repair(t('audioSystem.macRepairPrompt'))}
            disabled={repairing}
          >
            <Wrench size={12} className={repairing ? 'spinning' : ''} />
            {repairing ? t('audioSystem.repairing') : t('audioSystem.repair')}
          </button>
        ) : (
          <button
            className="retry-button"
            onClick={() => retry()}
            disabled={retrying}
          >
            <RefreshCw size={12} className={retrying ? 'spinning' : ''} />
            {retrying ? t('audioSystem.retrying') : t('audioSystem.retry')}
          </button>
        )}
        <button className="dismiss-button" onClick={dismiss} aria-label="Dismiss">
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

export default AudioSystemBanner;
