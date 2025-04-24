import React, { useState } from 'react';
import { ArrowRight, Volume2, Mic, RefreshCw, AlertTriangle } from 'react-feather';
import './AudioPanel.scss';
import Modal from '../Modal/Modal';
import { useAudioContext } from '../../contexts/AudioContext';

const AudioPanel: React.FC<{ toggleAudio: () => void }> = ({ toggleAudio }) => {
  const [showVirtualMicWarning, setShowVirtualMicWarning] = useState(false);
  const [showVirtualSpeakerWarning, setShowVirtualSpeakerWarning] = useState(false);

  const {
    audioInputDevices,
    audioOutputDevices,
    selectedInputDevice,
    selectedOutputDevice,
    isInputDeviceOn,
    isOutputDeviceOn,
    isLoading,
    selectInputDevice,
    selectOutputDevice,
    toggleInputDeviceState,
    toggleOutputDeviceState,
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

  // Handle output device selection with virtual speaker check
  const handleOutputDeviceSelection = (device: {deviceId: string; label: string; isDefault?: boolean}) => {
    if (isVirtualSpeaker(device)) {
      setShowVirtualSpeakerWarning(true);
    } else {
      selectOutputDevice(device);
    }
  };

  return (
    <div className="audio-panel">
      <Modal 
        isOpen={showVirtualMicWarning} 
        onClose={() => setShowVirtualMicWarning(false)}
        title="Virtual Microphone Notice"
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>This is a virtual microphone created by Sokuji.</strong>
          </p>
          <p>
            Please do not select this device here. Instead, use this virtual microphone in your video conferencing 
            applications (like Google Meet, Zoom, Microsoft Teams, etc.) to receive the simultaneous interpretation output.
          </p>
          <p>
            For Sokuji to work properly, please select your actual physical microphone from the list.
          </p>
          <button 
            className="understand-button" 
            onClick={() => setShowVirtualMicWarning(false)}
          >
            I understand
          </button>
        </div>
      </Modal>

      <Modal 
        isOpen={showVirtualSpeakerWarning} 
        onClose={() => setShowVirtualSpeakerWarning(false)}
        title="Virtual Speaker Notice"
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>This is a virtual speaker created by Sokuji.</strong>
          </p>
          <p>
            Please do not select this device as your monitor. The Sokuji_Virtual_Speaker is used by Sokuji to output audio to your conferencing applications.
          </p>
          <p>
            Connecting your monitor to Sokuji's output device would create an audio feedback loop, causing your input to contain your own monitored output.
          </p>
          <p>
            The "Turn On" switch connects the virtual speaker to your selected output device, allowing you to hear what's being sent to your conferencing application. The "Turn Off" switch disconnects this monitoring connection.
          </p>
          <p>
            For proper operation, please select a different output device (like your headphones or speakers) from the list.
          </p>
          <button 
            className="understand-button" 
            onClick={() => setShowVirtualSpeakerWarning(false)}
          >
            I understand
          </button>
        </div>
      </Modal>

      <div className="audio-panel-header">
        <h2>Audio Settings</h2>
        <button className="close-audio-button" onClick={toggleAudio}>
          <ArrowRight size={16} />
          <span>Close</span>
        </button>
      </div>
      <div className="audio-content">
        {/* Input Device Section */}
        <div className="audio-section">
          <h3>Audio Input Device</h3>
          <div className="device-selector">
            <div className="device-status">
              <div className={`device-icon ${isInputDeviceOn ? 'active' : 'inactive'}`}>
                <Mic size={18} />
              </div>
              <div className="device-info">
                <div className="device-name">{isLoading ? 'Loading devices...' : selectedInputDevice.label}</div>
              </div>
            </div>
            <button 
              className={`device-toggle-button ${isInputDeviceOn ? 'on' : 'off'}`}
              onClick={toggleInputDeviceState}
            >
              {isInputDeviceOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
          
          <div className="device-list">
            <div className="device-list-header">
              <h4>Available Input Devices</h4>
              <button 
                className="refresh-button"
                onClick={() => refreshDevices()}
                disabled={isLoading}
                title="Refresh input devices"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {audioInputDevices.map((device, index) => (
              <div 
                key={index} 
                className={`device-option ${selectedInputDevice.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => handleInputDeviceSelection(device)}
              >
                <span>{device.label}</span>
                {isVirtualMic(device) && (
                  <div className="virtual-indicator" title="Virtual microphone">
                    <AlertTriangle size={14} color="#f0ad4e" />
                  </div>
                )}
                {selectedInputDevice.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* Output Device Section */}
        <div className="audio-section">
          <h3>Virtual Speaker Monitor Device</h3>
          <div className="device-selector">
            <div className="device-status">
              <div className={`device-icon ${isOutputDeviceOn ? 'active' : 'inactive'}`}>
                <Volume2 size={18} />
              </div>
              <div className="device-info">
                <div className="device-name">{isLoading ? 'Loading devices...' : selectedOutputDevice.label}</div>
              </div>
            </div>
            <button 
              className={`device-toggle-button ${isOutputDeviceOn ? 'on' : 'off'}`}
              onClick={toggleOutputDeviceState}
            >
              {isOutputDeviceOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
          
          <div className="device-list">
            <div className="device-list-header">
              <h4>Available Output Devices</h4>
              <button 
                className="refresh-button"
                onClick={() => refreshDevices()}
                disabled={isLoading}
                title="Refresh output devices"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {audioOutputDevices.map((device, index) => (
              <div 
                key={index} 
                className={`device-option ${selectedOutputDevice.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => handleOutputDeviceSelection(device)}
              >
                <span>{device.label}</span>
                {isVirtualSpeaker(device) && (
                  <div className="virtual-indicator" title="Virtual speaker - do not select">
                    <AlertTriangle size={14} color="#f0ad4e" />
                  </div>
                )}
                {selectedOutputDevice.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPanel;
