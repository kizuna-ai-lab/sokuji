import React, { useEffect, useId, useState } from 'react';
import { Mic, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import DeviceList from '../shared/DeviceList';
import WarningModal from '../shared/WarningModal';
import { useFilteredDevices, WarningType, AudioDevice, isVirtualMic } from '../shared/hooks';
import { useAudioContext, useNoiseSuppressionMode, useSetNoiseSuppressionMode, NoiseSuppressionMode } from '../../../stores/audioStore';
import { useAnalytics } from '../../../lib/analytics';

interface AudioDeviceSectionProps {
  /** Real session-active state — used for analytics (during_session) only. */
  isSessionActive: boolean;
  /**
   * Per-channel lock — when true, disable interactive controls.
   * Defaults to isSessionActive for backward compatibility.
   * Callers that need finer-grained control (locking specific channels
   * while a session is active) should pass this explicitly.
   */
  isLocked?: boolean;
  /**
   * Why the channel is locked (i18n string). Rendered under the section
   * heading while `isLocked` holds. Greying a control without stating the
   * reason invites the interaction it then refuses — worse still when the lock
   * is persistent (the monitor stays locked outside 'You' mode across
   * restarts), where it reads as broken rather than locked.
   */
  lockedReason?: string;
  /** Additional class name */
  className?: string;
}

const AudioDeviceSection: React.FC<AudioDeviceSectionProps> = ({
  isSessionActive,
  isLocked,
  lockedReason,
  className = ''
}) => {
  const locked = isLocked ?? isSessionActive;
  const reactId = useId();
  // Only referenced (and only rendered) while locked, so an unlocked list stays
  // undescribed rather than pointing at an absent element.
  const showReason = locked && !!lockedReason;
  const reasonId = showReason ? `${reactId}-mic-locked-reason` : undefined;
  const renderReason = () => showReason && (
    <span className="setting-description section-locked-reason" id={reasonId}>
      {lockedReason}
    </span>
  );
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const noiseSuppressionMode = useNoiseSuppressionMode();
  const setNoiseSuppressionMode = useSetNoiseSuppressionMode();

  const {
    audioInputDevices,
    selectedInputDevice,
    isMicMuted,
    isLoading,
    selectInputDevice,
    setMicMuted,
    refreshDevices
  } = useAudioContext();

  // Filter out virtual devices
  const filteredInputDevices = useFilteredDevices(audioInputDevices);

  // Warning modal state
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  // Close the warning modal when the panel hides (<Activity> runs effect
  // cleanups on hide); a hidden-but-open dialog would otherwise reappear on
  // the next reveal and swallow the visible panel's Escape key.
  useEffect(() => () => setWarningType(null), []);

  const handleInputDeviceSelect = (device: AudioDevice) => {
    if (isMicMuted) {
      setMicMuted(false);
    }
    selectInputDevice(device);
    trackEvent('audio_device_changed', {
      device_type: 'input',
      device_name: device.label,
      change_type: 'selected',
      during_session: isSessionActive
    });
  };

  const handleInputVirtualDeviceClick = (device: AudioDevice) => {
    // DeviceList routes two kinds of risky input picks here: Sokuji's own
    // virtual devices (selection blocked) and OS loopback-style inputs
    // (selection goes through, warned). Each gets its own explanation.
    setWarningType(isVirtualMic(device) ? 'virtual-mic' : 'loopback-mic');
    trackEvent('virtual_device_warning', {
      device_type: 'input',
      action_taken: 'ignored'
    });
  };

  return (
    <>
      <WarningModal
        isOpen={warningType !== null}
        onClose={() => setWarningType(null)}
        type={warningType}
      />

      {/* Microphone Section */}
      <div className={`config-section microphone-section ${className}`} id="microphone-section" data-tour="microphone-section">
        <h3>
          <Mic size={18} />
          <span>{t('simpleConfig.microphone')}</span>
          <Tooltip
            content={t('simpleConfig.microphoneDesc')}
            position="top"
            icon="help"
            maxWidth={300}
          />
          <button
            className="section-refresh-button"
            onClick={refreshDevices}
            disabled={isLoading}
            title={t('audioPanel.refreshDevices')}
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>
        </h3>

        {renderReason()}

        <DeviceList
          devices={filteredInputDevices}
          selectedDevice={selectedInputDevice}
          isDeviceOn={!isMicMuted}
          onSelect={handleInputDeviceSelect}
          onToggleOff={() => setMicMuted(!isMicMuted)}
          disabled={locked}
          deviceType="input"
          filterVirtual={false}
          showVirtualIndicators={true}
          onVirtualDeviceClick={handleInputVirtualDeviceClick}
          toggleAriaLabel={isMicMuted
            ? t('audioPanel.turnOnMicrophone', 'Turn on microphone')
            : t('audioPanel.turnOffMicrophone', 'Turn off microphone')}
          ariaDescribedBy={reasonId}
        />

        {/* Noise Suppression Mode */}
        <div className="noise-suppression-control">
          <div className="noise-suppression-header">
            <span className="noise-suppression-label">{t('settings.noiseSuppression')}</span>
            <Tooltip
              content={
                `${t('settings.noiseSuppressionTooltip.off')}\n\n` +
                `${t('settings.noiseSuppressionTooltip.standard')}\n\n` +
                `${t('settings.noiseSuppressionTooltip.enhanced')}`
              }
              position="top"
              icon="help"
              maxWidth={350}
            />
          </div>
          <div className="segmented-control noise-suppression-modes">
            {(['off', 'standard', 'enhanced'] as NoiseSuppressionMode[]).map((mode) => (
              <button
                key={mode}
                className={`segmented-option ${noiseSuppressionMode === mode ? 'active' : ''}`}
                onClick={() => {
                  setNoiseSuppressionMode(mode);
                  trackEvent('noise_suppression_toggled', {
                    enabled: mode !== 'off',
                    mode,
                    during_session: isSessionActive
                  });
                }}
              >
                {t(`settings.noiseSuppressionMode.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default AudioDeviceSection;
