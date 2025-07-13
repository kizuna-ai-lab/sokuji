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
            {isInSpeakerMode ? t('audioFeedback.speakerModeWarning') : t('audioFeedback.title')}
          </span>
          <button className="dismiss-button" onClick={onDismiss}>×</button>
        </div>
        
        <div className="warning-body">
          <p className="warning-description">
            {isInSpeakerMode 
              ? t('audioFeedback.speakerModeWarning')
              : t('audioFeedback.description')
            }
          </p>
          
          {inputDeviceLabel && outputDeviceLabel && (
            <div className="device-info">
              <div className="device-row">
                <Mic size={16} className="device-icon" />
                <span className="device-label">{t('audioFeedback.inputDevice')}: {inputDeviceLabel}</span>
              </div>
              <div className="device-row">
                <Volume2 size={16} className="device-icon" />
                <span className="device-label">{t('audioFeedback.outputDevice')}: {outputDeviceLabel}</span>
              </div>
            </div>
          )}
          
          {recommendedAction && (
            <div className="recommended-action">
              <strong>{t('audioFeedback.recommendation')}:</strong>
              <p>{recommendedAction}</p>
            </div>
          )}
          
          {isInSpeakerMode && (
            <div className="headphone-recommendation">
              <div className="headphone-icon-wrapper">
                <Headphones size={24} className="headphone-icon" />
              </div>
              <div className="headphone-text">
                <strong>{t('audioFeedback.solutions.speakerModeHeadphones')}</strong>
              </div>
            </div>
          )}
          
          <div className="feedback-solutions">
            <h4>{t('audioFeedback.solutions.title')}</h4>
            <ul>
              {isInSpeakerMode ? (
                <>
                  <li className="priority-solution">{t('audioFeedback.solutions.useHeadphones')}</li>
                  <li>{t('audioFeedback.solutions.adjustDistance')}</li>
                  <li>{t('audioFeedback.solutions.disablePassthrough')}</li>
                </>
              ) : (
                <>
                  <li>{t('audioFeedback.solutions.differentDevices')}</li>
                  <li>{t('audioFeedback.solutions.useHeadphones')}</li>
                  <li>{t('audioFeedback.solutions.adjustDistance')}</li>
                  <li>{t('audioFeedback.solutions.disablePassthrough')}</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioFeedbackWarning; 