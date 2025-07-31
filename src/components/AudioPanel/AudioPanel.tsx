import React, { useState } from 'react';
import { ArrowRight, Volume2, Mic, RefreshCw, AlertTriangle, AudioLines } from 'lucide-react';
import './AudioPanel.scss';
import Modal from '../Modal/Modal';
import { useAudioContext } from '../../contexts/AudioContext';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { useSession } from '../../contexts/SessionContext';

const AudioPanel: React.FC<{ toggleAudio: () => void }> = ({ toggleAudio }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const { isSessionActive } = useSession();
  const [showVirtualMicWarning, setShowVirtualMicWarning] = useState(false);
  const [showVirtualSpeakerWarning, setShowVirtualSpeakerWarning] = useState(false);

  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
    isLoading,
    // Real person voice passthrough settings
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    selectInputDevice,
    selectMonitorDevice,
    toggleInputDeviceState,
    toggleMonitorDeviceState,
    toggleRealVoicePassthrough,
    setRealVoicePassthroughVolume,
    refreshDevices
  } = useAudioContext();

  // Check if a device is the virtual microphone
  const isVirtualMic = (device: {deviceId: string; label: string}) => {
    return device.label.toLowerCase().includes('sokuji_virtual_mic');
  };

  // Check if a device is the virtual speaker
  const isVirtualSpeaker = (device: {deviceId: string; label: string}) => {
    return device.label.toLowerCase().includes('sokuji_virtual_speaker');
  };

  // Handle input device selection with virtual mic check
  const handleInputDeviceSelection = (device: {deviceId: string; label: string; isDefault?: boolean}) => {
    if (isVirtualMic(device)) {
      setShowVirtualMicWarning(true);
      trackEvent('virtual_device_warning', {
        device_type: 'input',
        action_taken: 'ignored'
      });
    } else {
      selectInputDevice(device);
      trackEvent('audio_device_changed', {
        device_type: 'input',
        device_name: device.label,
        change_type: 'selected',
        during_session: isSessionActive
      });
    }
  };

  // Handle monitor device selection with virtual speaker check
  const handleMonitorDeviceSelection = (device: {deviceId: string; label: string; isDefault?: boolean}) => {
    if (isVirtualSpeaker(device)) {
      setShowVirtualSpeakerWarning(true);
      trackEvent('virtual_device_warning', {
        device_type: 'output',
        action_taken: 'ignored'
      });
    } else {
      selectMonitorDevice(device);
      trackEvent('audio_device_changed', {
        device_type: 'output',
        device_name: device.label,
        change_type: 'selected',
        during_session: isSessionActive
      });
    }
  };

  return (
    <div className="audio-panel">
      <Modal 
        isOpen={showVirtualMicWarning} 
        onClose={() => setShowVirtualMicWarning(false)}
        title={t('audioPanel.virtualMicrophoneNotice')}
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>{t('audioPanel.virtualMicWarningTitle')}</strong>
          </p>
          <p>
            {t('audioPanel.virtualMicWarningText1')}
          </p>
          <p>
            {t('audioPanel.virtualMicWarningText2')}
          </p>
          <button 
            className="understand-button" 
            onClick={() => setShowVirtualMicWarning(false)}
          >
            {t('audioPanel.iUnderstand')}
          </button>
        </div>
      </Modal>

      <Modal 
        isOpen={showVirtualSpeakerWarning} 
        onClose={() => setShowVirtualSpeakerWarning(false)}
        title={t('audioPanel.virtualSpeakerNotice')}
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>{t('audioPanel.virtualSpeakerWarningTitle')}</strong>
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText1')}
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText2')}
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText3')}
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText4')}
          </p>
          <button 
            className="understand-button" 
            onClick={() => setShowVirtualSpeakerWarning(false)}
          >
            {t('audioPanel.iUnderstand')}
          </button>
        </div>
      </Modal>

      <div className="audio-panel-header">
        <h2>{t('audioPanel.title')}</h2>
        <button className="close-audio-button" onClick={toggleAudio}>
          <ArrowRight size={16} />
          <span>{t('common.close')}</span>
        </button>
      </div>
      <div className="audio-content">
        {/* Input Device Section */}
        <div className="audio-section microphone-section">
          <h3>{t('audioPanel.audioInputDevice')}</h3>
          <div className="device-selector">
            <div className="device-status">
              <div className={`device-icon ${isInputDeviceOn ? 'active' : 'inactive'}`}>
                <Mic size={18} />
              </div>
              <div className="device-info">
                <div className="device-name">{isLoading ? t('audioPanel.loadingDevices') : (selectedInputDevice?.label || t('audioPanel.noDeviceSelected'))}</div>
              </div>
            </div>
            <button 
              className={`device-toggle-button ${isInputDeviceOn ? 'on' : 'off'}`}
              onClick={toggleInputDeviceState}
            >
              {isInputDeviceOn ? t('audioPanel.turnOff') : t('audioPanel.turnOn')}
            </button>
          </div>
          
          <div className="device-list">
            <div className="device-list-header">
              <h4>{t('audioPanel.availableInputDevices')}</h4>
              <button 
                className="refresh-button"
                onClick={() => refreshDevices()}
                disabled={isLoading}
                title={t('audioPanel.refreshInputDevices')}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {audioInputDevices.map((device, index) => (
              <div 
                key={index} 
                className={`device-option ${selectedInputDevice?.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => handleInputDeviceSelection(device)}
              >
                <span>{device.label}</span>
                {isVirtualMic(device) && (
                  <div className="virtual-indicator" title={t('audioPanel.virtualMicrophone')}>
                    <AlertTriangle size={14} color="#f0ad4e" />
                  </div>
                )}
                {selectedInputDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* Monitor Device Section */}
        <div className="audio-section speaker-section">
          <h3>{t('audioPanel.virtualSpeakerMonitorDevice')}</h3>
          <div className="device-selector">
            <div className="device-status">
              <div className={`device-icon ${isMonitorDeviceOn ? 'active' : 'inactive'}`}>
                <Volume2 size={18} />
              </div>
              <div className="device-info">
                <div className="device-name">{isLoading ? t('audioPanel.loadingDevices') : (selectedMonitorDevice?.label || t('audioPanel.noDeviceSelected'))}</div>
              </div>
            </div>
            <button 
              className={`device-toggle-button ${isMonitorDeviceOn ? 'on' : 'off'}`}
              onClick={toggleMonitorDeviceState}
            >
              {isMonitorDeviceOn ? t('audioPanel.turnOff') : t('audioPanel.turnOn')}
            </button>
          </div>
          
          <div className="device-list">
            <div className="device-list-header">
              <h4>{t('audioPanel.availableMonitorDevices')}</h4>
              <button 
                className="refresh-button"
                onClick={() => refreshDevices()}
                disabled={isLoading}
                title={t('audioPanel.refreshMonitorDevices')}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {audioMonitorDevices.map((device, index) => (
              <div 
                key={index} 
                className={`device-option ${selectedMonitorDevice?.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => handleMonitorDeviceSelection(device)}
              >
                <span>{device.label}</span>
                {isVirtualSpeaker(device) && (
                  <div className="virtual-indicator" title={t('audioPanel.virtualSpeaker')}>
                    <AlertTriangle size={14} color="#f0ad4e" />
                  </div>
                )}
                {selectedMonitorDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* Real Person Voice Passthrough Section */}
        <div className="audio-section voice-passthrough-section">
          <h3>{t('audioPanel.realVoicePassthrough')}</h3>
          <div className="device-selector">
            <div className="device-status">
              <div className={`device-icon ${isRealVoicePassthroughEnabled ? 'active' : 'inactive'}`}>
                <AudioLines size={18} />
              </div>
              <div className="device-info">
                <div className="device-name">{t('audioPanel.enableRealVoicePassthrough')}</div>
                <div className="device-description">{t('audioPanel.realVoicePassthroughDescription')}</div>
              </div>
            </div>
            <button 
              className={`device-toggle-button ${isRealVoicePassthroughEnabled ? 'on' : 'off'}`}
              onClick={() => {
                toggleRealVoicePassthrough();
                trackEvent('audio_passthrough_toggled', {
                  enabled: !isRealVoicePassthroughEnabled,
                  volume_level: realVoicePassthroughVolume
                });
              }}
            >
              {isRealVoicePassthroughEnabled ? t('audioPanel.turnOff') : t('audioPanel.turnOn')}
            </button>
          </div>
          
          <div className="device-list">
            <div className={`volume-control ${!isRealVoicePassthroughEnabled ? 'disabled' : ''}`}>
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
                  // Track volume change on mouse up to avoid too many events
                  trackEvent('ui_interaction', {
                    component: 'AudioPanel',
                    action: 'passthrough_volume_changed',
                    element: 'volume_slider',
                    value: parseFloat((e.target as HTMLInputElement).value)
                  });
                }}
                className="volume-slider"
                disabled={!isRealVoicePassthroughEnabled}
              />
              <div className="volume-limits">
                <span>0%</span>
                <span>60%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPanel;
