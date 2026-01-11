import React, { useState } from 'react';
import { Mic, Volume2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import DeviceList from '../shared/DeviceList';
import WarningModal from '../shared/WarningModal';
import { useFilteredDevices, WarningType, AudioDevice } from '../shared/hooks';
import { useAudioContext } from '../../../stores/audioStore';
import { useAnalytics } from '../../../lib/analytics';

interface AudioDeviceSectionProps {
  isSessionActive: boolean;
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
  showMicrophone = true,
  showSpeaker = true,
  isSystemAudioEnabled = false,
  onSpeakerMutualExclusivity,
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
    isLoading,
    selectInputDevice,
    selectMonitorDevice,
    toggleInputDeviceState,
    toggleMonitorDeviceState,
    refreshDevices
  } = useAudioContext();

  // Filter out virtual devices
  const filteredInputDevices = useFilteredDevices(audioInputDevices);
  const filteredMonitorDevices = useFilteredDevices(audioMonitorDevices);

  // Warning modal state
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  const handleInputDeviceSelect = (device: AudioDevice) => {
    if (!isInputDeviceOn) {
      toggleInputDeviceState();
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

    if (!isMonitorDeviceOn) {
      toggleMonitorDeviceState();
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
          </h3>

          <DeviceList
            devices={filteredInputDevices}
            selectedDevice={selectedInputDevice}
            isDeviceOn={isInputDeviceOn}
            onSelect={handleInputDeviceSelect}
            onToggleOff={toggleInputDeviceState}
            onRefresh={refreshDevices}
            isLoading={isLoading}
            deviceType="input"
            showHeader={false}
            filterVirtual={false}
            showVirtualIndicators={true}
            onVirtualDeviceClick={handleInputVirtualDeviceClick}
          />
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
          </h3>

          <DeviceList
            devices={filteredMonitorDevices}
            selectedDevice={selectedMonitorDevice}
            isDeviceOn={isMonitorDeviceOn}
            onSelect={handleMonitorDeviceSelect}
            onToggleOff={toggleMonitorDeviceState}
            onRefresh={refreshDevices}
            isLoading={isLoading}
            disabled={isSystemAudioEnabled}
            deviceType="output"
            showHeader={false}
            filterVirtual={false}
            showVirtualIndicators={true}
            onVirtualDeviceClick={handleOutputVirtualDeviceClick}
          />
        </div>
      )}
    </>
  );
};

export default AudioDeviceSection;
