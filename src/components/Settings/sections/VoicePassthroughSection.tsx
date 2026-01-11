import React from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import { useAudioContext } from '../../../stores/audioStore';
import { useAnalytics } from '../../../lib/analytics';

interface VoicePassthroughSectionProps {
  /** Additional class name */
  className?: string;
}

const VoicePassthroughSection: React.FC<VoicePassthroughSectionProps> = ({
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  const {
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    toggleRealVoicePassthrough,
    setRealVoicePassthroughVolume
  } = useAudioContext();

  const handleToggle = (enable: boolean) => {
    if (enable !== isRealVoicePassthroughEnabled) {
      toggleRealVoicePassthrough();
      trackEvent('audio_passthrough_toggled', {
        enabled: enable,
        volume_level: realVoicePassthroughVolume
      });
    }
  };

  return (
    <div className={`config-section voice-passthrough-section ${className}`}>
      <h3>
        {t('audioPanel.realVoicePassthrough')}
        <Tooltip
          content={t('audioPanel.realVoicePassthroughDescription')}
          position="top"
          icon="help"
          maxWidth={300}
        />
      </h3>
      <div className="device-list">
        {/* Off option */}
        <div
          className={`device-option ${!isRealVoicePassthroughEnabled ? 'selected' : ''}`}
          onClick={() => handleToggle(false)}
        >
          <span>{t('common.off', 'Off')}</span>
          {!isRealVoicePassthroughEnabled && <div className="selected-indicator" />}
        </div>
        {/* On option */}
        <div
          className={`device-option ${isRealVoicePassthroughEnabled ? 'selected' : ''}`}
          onClick={() => handleToggle(true)}
        >
          <span>{t('common.on', 'On')}</span>
          {isRealVoicePassthroughEnabled && <div className="selected-indicator" />}
        </div>
        {/* Volume slider - shown when enabled */}
        {isRealVoicePassthroughEnabled && (
          <div className="volume-control">
            <div className="setting-label">
              <span>{t('audioPanel.realVoiceVolume')}</span>
              <span className="setting-value">{Math.round(realVoicePassthroughVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.6"
              step="0.01"
              value={realVoicePassthroughVolume}
              onChange={(e) => {
                const newVolume = parseFloat(e.target.value);
                setRealVoicePassthroughVolume(newVolume);
              }}
              onMouseUp={(e) => {
                trackEvent('ui_interaction', {
                  component: 'VoicePassthroughSection',
                  action: 'passthrough_volume_changed',
                  element: 'volume_slider',
                  value: parseFloat((e.target as HTMLInputElement).value)
                });
              }}
              className="volume-slider"
            />
            <div className="volume-limits">
              <span>0%</span>
              <span>60%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoicePassthroughSection;
