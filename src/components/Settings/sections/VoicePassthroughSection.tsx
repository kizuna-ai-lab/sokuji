import React from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import { useAudioContext } from '../../../stores/audioStore';
import { useAnalytics } from '../../../lib/analytics';

interface VoicePassthroughSectionProps {
  /** Additional class name */
  className?: string;
  /** When true, the toggle and slider render disabled with a tooltip. */
  disabled?: boolean;
  /** Tooltip text shown when disabled (i18n string). */
  disabledReason?: string;
}

const VoicePassthroughSection: React.FC<VoicePassthroughSectionProps> = ({
  className = '',
  disabled = false,
  disabledReason
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
    if (disabled) return;
    if (enable !== isRealVoicePassthroughEnabled) {
      toggleRealVoicePassthrough();
      trackEvent('audio_passthrough_toggled', {
        enabled: enable,
        volume_level: realVoicePassthroughVolume
      });
    }
  };

  return (
    <div
      className={`config-section voice-passthrough-section ${className} ${disabled ? 'disabled' : ''}`}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
    >
      <h3>
        {t('audioPanel.realVoicePassthrough')}
        <Tooltip
          content={disabled && disabledReason ? disabledReason : t('audioPanel.realVoicePassthroughDescription')}
          position="top"
          icon="help"
          maxWidth={300}
        />
      </h3>
      <ToggleSwitch
        checked={isRealVoicePassthroughEnabled}
        onChange={() => handleToggle(!isRealVoicePassthroughEnabled)}
        label={isRealVoicePassthroughEnabled ? t('common.on', 'On') : t('common.off', 'Off')}
        disabled={disabled}
      />
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
            disabled={disabled}
            onChange={(e) => {
              if (disabled) return;
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
  );
};

export default VoicePassthroughSection;
