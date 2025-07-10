import React from 'react';
import { AlertTriangle, Volume2, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './AudioFeedbackWarning.scss';

interface AudioFeedbackWarningProps {
  isVisible: boolean;
  inputDeviceLabel?: string;
  outputDeviceLabel?: string;
  recommendedAction?: string;
  onDismiss: () => void;
}

const AudioFeedbackWarning: React.FC<AudioFeedbackWarningProps> = ({
  isVisible,
  inputDeviceLabel,
  outputDeviceLabel,
  recommendedAction,
  onDismiss
}) => {
  const { t } = useTranslation();

  if (!isVisible) {
    return null;
  }

  return (
    <div className="audio-feedback-warning">
      <div className="warning-content">
        <div className="warning-header">
          <AlertTriangle size={20} className="warning-icon" />
          <span className="warning-title">{t('audioFeedback.title')}</span>
          <button className="dismiss-button" onClick={onDismiss}>×</button>
        </div>
        
        <div className="warning-body">
          <p className="warning-description">
            {t('audioFeedback.description')}
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
          
          <div className="feedback-solutions">
            <h4>{t('audioFeedback.solutions.title')}</h4>
            <ul>
              <li>{t('audioFeedback.solutions.differentDevices')}</li>
              <li>{t('audioFeedback.solutions.useHeadphones')}</li>
              <li>{t('audioFeedback.solutions.adjustDistance')}</li>
              <li>{t('audioFeedback.solutions.disablePassthrough')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioFeedbackWarning; 