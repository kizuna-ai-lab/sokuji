import React from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAudioSystemStatus,
  useAudioSystemReason,
  useAudioSystemMessage,
  useAudioSystemDismissed,
  useAudioSystemRetrying,
  useAudioSystemRetry,
  useAudioSystemDismiss,
} from '../../stores/audioSystemStore';
import './AudioSystemBanner.scss';

const AudioSystemBanner: React.FC = () => {
  const { t } = useTranslation();
  const status = useAudioSystemStatus();
  const reason = useAudioSystemReason();
  const message = useAudioSystemMessage();
  const dismissed = useAudioSystemDismissed();
  const retrying = useAudioSystemRetrying();
  const retry = useAudioSystemRetry();
  const dismiss = useAudioSystemDismiss();

  if (status !== 'unavailable' || dismissed) {
    return null;
  }

  const isPactlMissing = reason === 'pactl-missing';

  return (
    <div className="audio-system-banner">
      <div className="audio-system-banner-content">
        <AlertTriangle size={14} />
        <div className="audio-system-banner-text">
          <span>
            {isPactlMissing ? t('audioSystem.pactlMissingBody') : (message || t('audioSystem.unavailableBody'))}
          </span>
          {isPactlMissing && (
            <code className="audio-system-banner-command">{t('audioSystem.installCommand')}</code>
          )}
        </div>
      </div>
      <div className="audio-system-banner-actions">
        <button
          className="retry-button"
          onClick={() => retry()}
          disabled={retrying}
        >
          <RefreshCw size={12} className={retrying ? 'spinning' : ''} />
          {retrying ? t('audioSystem.retrying') : t('audioSystem.retry')}
        </button>
        <button className="dismiss-button" onClick={dismiss} aria-label="Dismiss">
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

export default AudioSystemBanner;
