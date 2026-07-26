import React, { useEffect, useId, useState } from 'react';
import { Mic, Volume2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import DeviceList from '../shared/DeviceList';
import WarningModal from '../shared/WarningModal';
import { useFilteredDevices, WarningType, AudioDevice } from '../shared/hooks';
import { useAudioContext, useNoiseSuppressionMode, useSetNoiseSuppressionMode, useIsMonitorChannelInScope, NoiseSuppressionMode } from '../../../stores/audioStore';
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
  /** Show microphone section */
  showMicrophone?: boolean;
  /** Show speaker section */
  showSpeaker?: boolean;
  /** If system audio is enabled (for mutual exclusivity check) */
  isSystemAudioEnabled?: boolean;
  /** Callback when speaker is clicked while system audio is on */
  onSpeakerMutualExclusivity?: () => void;
  /** Additional class name */
  className?: string;
}

const AudioDeviceSection: React.FC<AudioDeviceSectionProps> = ({
  isSessionActive,
  isLocked,
  lockedReason,
  showMicrophone = true,
  showSpeaker = true,
  isSystemAudioEnabled = false,
  onSpeakerMutualExclusivity,
  className = ''
}) => {
  const locked = isLocked ?? isSessionActive;
  const reactId = useId();
  // Only referenced (and only rendered) while locked, so an unlocked list stays
  // undescribed rather than pointing at an absent element. Both sections can be
  // shown at once, so the id is per-channel to keep it unique.
  const showReason = locked && !!lockedReason;
  const reasonIdFor = (channel: 'mic' | 'speaker') =>
    showReason ? `${reactId}-${channel}-locked-reason` : undefined;
  const renderReason = (channel: 'mic' | 'speaker') => showReason && (
    <span className="setting-description section-locked-reason" id={reasonIdFor(channel)}>
      {lockedReason}
    </span>
  );
  // Monitor is in scope only in pure speaker mode (mutex with participant).
  // Out of scope the monitor toggle reads Off even though the user's saved
  // preference (isMonitorMuted) is preserved underneath and restored when they
  // return to speaker mode — keeps the displayed state honest (the monitor is
  // silenced) without destroying the preference.
  const monitorInScope = useIsMonitorChannelInScope();
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const noiseSuppressionMode = useNoiseSuppressionMode();
  const setNoiseSuppressionMode = useSetNoiseSuppressionMode();

  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectedMonitorDevice,
    isMicMuted,
    isMonitorMuted,
    isLoading,
    selectInputDevice,
    selectMonitorDevice,
    setMicMuted,
    setMonitorMuted,
    refreshDevices
  } = useAudioContext();

  // Filter out virtual devices
  const filteredInputDevices = useFilteredDevices(audioInputDevices);
  const filteredMonitorDevices = useFilteredDevices(audioMonitorDevices);

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

  const handleMonitorDeviceSelect = (device: AudioDevice) => {
    // Check mutual exclusivity with system audio
    if (isSystemAudioEnabled) {
      if (onSpeakerMutualExclusivity) {
        onSpeakerMutualExclusivity();
      } else {
        setWarningType('mutual-exclusivity-speaker');
      }
      return;
    }

    if (isMonitorMuted) {
      setMonitorMuted(false);
    }
    selectMonitorDevice(device);
    trackEvent('audio_device_changed', {
      device_type: 'output',
      device_name: device.label,
      change_type: 'selected',
      during_session: isSessionActive
    });
  };

  const handleInputVirtualDeviceClick = () => {
    setWarningType('virtual-mic');
    trackEvent('virtual_device_warning', {
      device_type: 'input',
      action_taken: 'ignored'
    });
  };

  const handleOutputVirtualDeviceClick = () => {
    setWarningType('virtual-speaker');
    trackEvent('virtual_device_warning', {
      device_type: 'output',
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
      {showMicrophone && (
        <div className={`config-section microphone-section ${className}`} id="microphone-section">
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

          {renderReason('mic')}

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
            ariaDescribedBy={reasonIdFor('mic')}
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
      )}

      {/* Speaker Section */}
      {showSpeaker && (
        <div className={`config-section speaker-section ${className}`} id="speaker-section">
          <h3>
            <Volume2 size={18} />
            <span>{t('simpleConfig.speaker')}</span>
            <Tooltip
              content={t('simpleConfig.speakerDesc')}
              position="top"
              icon="help"
              maxWidth={300}
            />
            <button
              className="section-refresh-button"
              onClick={refreshDevices}
              disabled={isLoading || isSystemAudioEnabled}
              title={t('audioPanel.refreshDevices')}
            >
              <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
            </button>
          </h3>

          {renderReason('speaker')}

          <DeviceList
            devices={filteredMonitorDevices}
            selectedDevice={selectedMonitorDevice}
            isDeviceOn={!isMonitorMuted && monitorInScope}
            onSelect={handleMonitorDeviceSelect}
            onToggleOff={() => setMonitorMuted(!isMonitorMuted)}
            disabled={locked}
            deviceType="output"
            filterVirtual={false}
            showVirtualIndicators={true}
            onVirtualDeviceClick={handleOutputVirtualDeviceClick}
            toggleAriaLabel={isMonitorMuted
              ? t('audioPanel.turnOnMonitor', 'Turn on speaker monitor')
              : t('audioPanel.turnOffMonitor', 'Turn off speaker monitor')}
            ariaDescribedBy={reasonIdFor('speaker')}
          />
        </div>
      )}
    </>
  );
};

export default AudioDeviceSection;
