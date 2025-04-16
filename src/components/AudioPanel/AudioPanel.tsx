import React, { useState } from 'react';
import { ArrowRight, Volume2, Mic, RefreshCw, AlertTriangle } from 'react-feather';
import './AudioPanel.scss';
import Modal from '../Modal/Modal';

interface AudioPanelProps {
  toggleAudio: () => void;
  audioInputDevices: Array<{deviceId: string; label: string}>;
  audioOutputDevices: Array<{deviceId: string; label: string}>;
  selectedInputDevice: {deviceId: string; label: string};
  selectedOutputDevice: {deviceId: string; label: string};
  isInputDeviceOn: boolean;
  isOutputDeviceOn: boolean;
  isLoading: boolean;
  selectInputDevice: (device: {deviceId: string; label: string}) => void;
  selectOutputDevice: (device: {deviceId: string; label: string}) => void;
  toggleInputDeviceState: () => void;
  toggleOutputDeviceState: () => void;
  inputAudioHistory: number[];
  refreshDevices: () => void;
}

const DOT_SIZE = 3; // px

const AudioPanel: React.FC<AudioPanelProps> = ({ 
  toggleAudio, 
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
  inputAudioHistory,
  refreshDevices
}) => {
  const [showVirtualMicWarning, setShowVirtualMicWarning] = useState(false);

  // Audio waveform history: 5 bars, right is newest
  const InputAudioWaveform = () => (
    <div className="audio-waveform">
      {inputAudioHistory.map((level, idx) => {
        // More suitable threshold and amplification factor
        const threshold = 0.02; // Lower threshold
        const AMPLIFY = 4;     // Reduce amplification factor to prevent excessive height
        // Non-linear sensitivity enhancement (e.g., square root)
        const enhancedLevel = Math.sqrt(level); // Make low volume more visible
        // Limit maximum height to 16px
        const height = enhancedLevel < threshold ? DOT_SIZE : Math.min(16, Math.max(DOT_SIZE, enhancedLevel * AMPLIFY));
        return (
          <div
            key={idx}
            className="waveform-bar"
            style={{
              height: `${height}px`,
              width: `${DOT_SIZE}px`,
              borderRadius: `${DOT_SIZE / 2}px`,
              opacity: isInputDeviceOn ? 1 : 0.5
            }}
          />
        );
      })}
    </div>
  );

  // Check if a device is the virtual microphone
  const isVirtualMic = (device: {deviceId: string; label: string}) => {
    return device.label.toLowerCase().includes('sokuji_virtual_mic');
  };

  // Handle input device selection with virtual mic check
  const handleInputDeviceSelection = (device: {deviceId: string; label: string}) => {
    if (isVirtualMic(device)) {
      setShowVirtualMicWarning(true);
    } else {
      selectInputDevice(device);
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
                <InputAudioWaveform />
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
          <h3>Audio Output Device</h3>
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
                onClick={() => selectOutputDevice(device)}
              >
                <span>{device.label}</span>
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
