import React from 'react';
import { AlertTriangle, Volume2, Mic, Headphones } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './AudioFeedbackWarning.scss';
import { isSpeakerMode } from '../../utils/audioUtils';

interface AudioFeedbackWarningProps {
  isVisible: boolean;
  inputDeviceLabel?: string;
  outputDeviceLabel?: string;
  recommendedAction?: string;
  feedbackRisk?: 'low' | 'medium' | 'high';
  onDismiss: () => void;
}

const AudioFeedbackWarning: React.FC<AudioFeedbackWarningProps> = ({
  isVisible,
  inputDeviceLabel,
  outputDeviceLabel,
  recommendedAction,
  feedbackRisk = 'medium',
  onDismiss
}) => {
  const { t } = useTranslation();

  if (!isVisible) {
    return null;
  }

  // Check if we're in speaker mode
  const isInSpeakerMode = outputDeviceLabel && isSpeakerMode({ deviceId: '', label: outputDeviceLabel });
  
  // Determine warning severity class
  const severityClass = feedbackRisk === 'high' ? 'high-risk' : feedbackRisk === 'medium' ? 'medium-risk' : 'low-risk';

  return (
    <div className={`audio-feedback-warning ${severityClass}`}>
      <div className="warning-content">
        <div className="warning-header">
          <AlertTriangle size={20} className="warning-icon" />
          <span className="warning-title">
            {t('audioFeedback.title')}
          </span>
          <button className="dismiss-button" onClick={onDismiss}>×</button>
        </div>
        
        <div className="warning-body">
          <p className="warning-description">
            {isInSpeakerMode 
              ? t('audioFeedback.speakerModeDescription')
              : t('audioFeedback.description')
            }
          </p>
          
          {inputDeviceLabel && outputDeviceLabel && (
            <div className="device-info">
              <div className="device-row">
                <Mic size={16} className="device-icon" />
                <span className="device-label">{inputDeviceLabel}</span>
              </div>
              <div className="device-row">
                <Volume2 size={16} className="device-icon" />
                <span className="device-label">{outputDeviceLabel}</span>
              </div>
            </div>
          )}
          
          <div className="feedback-solutions">
            {isInSpeakerMode ? (
              <>
                <div className="primary-solution">
                  <Headphones size={20} />
                  <span>{t('audioFeedback.solutions.useHeadphones')}</span>
                </div>
                <div className="alternative-solutions">
                  <span>{t('audioFeedback.solutions.orTry')}</span>
                  <ul>
                    <li>{t('audioFeedback.solutions.adjustDistance')}</li>
                    <li>{t('audioFeedback.solutions.disablePassthrough')}</li>
                  </ul>
                </div>
              </>
            ) : (
              <ul>
                <li>{t('audioFeedback.solutions.useHeadphones')}</li>
                <li>{t('audioFeedback.solutions.differentDevices')}</li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioFeedbackWarning; 