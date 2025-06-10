import React, { useState } from 'react';
import { ArrowRight, Volume2, Mic, RefreshCw, AlertTriangle } from 'react-feather';
import './AudioPanel.scss';
import Modal from '../Modal/Modal';
import { useAudioContext } from '../../contexts/AudioContext';
import { useTranslation } from 'react-i18next';

const AudioPanel: React.FC<{ toggleAudio: () => void }> = ({ toggleAudio }) => {
  const { t } = useTranslation();
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
    selectInputDevice,
    selectMonitorDevice,
    toggleInputDeviceState,
    toggleMonitorDeviceState,
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
    } else {
      selectInputDevice(device);
    }
  };

  // Handle monitor device selection with virtual speaker check
  const handleMonitorDeviceSelection = (device: {deviceId: string; label: string; isDefault?: boolean}) => {
    if (isVirtualSpeaker(device)) {
      setShowVirtualSpeakerWarning(true);
    } else {
      selectMonitorDevice(device);
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
      </div>
    </div>
  );
};

export default AudioPanel;
