import React from 'react';
import { ArrowRight, Volume2, Mic, RefreshCw } from 'react-feather';
import './AudioPanel.scss';

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
  outputAudioHistory: number[];
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
  outputAudioHistory,
  refreshDevices
}) => {
  // Audio waveform history: 5 bars, right is newest
  const InputAudioWaveform = () => (
    <div className="audio-waveform">
      {inputAudioHistory.map((level, idx) => {
        // 更适合的阈值和放大倍数
        const threshold = 0.02; // 降低阈值
        const AMPLIFY = 4;     // 减小放大倍数，防止过高
        // 非线性提升灵敏度（如开方）
        const enhancedLevel = Math.sqrt(level); // 让低音量更明显
        // 限制最大高度为16px
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

  // Output Audio waveform
  const OutputAudioWaveform = () => (
    <div className="audio-waveform">
      {outputAudioHistory.map((level, idx) => {
        // 更适合的阈值和放大倍数
        const threshold = 0.02; // 降低阈值
        const AMPLIFY = 4;     // 减小放大倍数，防止过高
        // 非线性提升灵敏度（如开方）
        const enhancedLevel = Math.sqrt(level); // 让低音量更明显
        // 限制最大高度为16px
        const height = enhancedLevel < threshold ? DOT_SIZE : Math.min(16, Math.max(DOT_SIZE, enhancedLevel * AMPLIFY));
        return (
          <div
            key={idx}
            className="waveform-bar"
            style={{
              height: `${height}px`,
              width: `${DOT_SIZE}px`,
              borderRadius: `${DOT_SIZE / 2}px`,
              opacity: isOutputDeviceOn ? 1 : 0.5
            }}
          />
        );
      })}
    </div>
  );

  return (
    <div className="audio-panel">
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
                onClick={() => selectInputDevice(device)}
              >
                <span>{device.label}</span>
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
                <OutputAudioWaveform />
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
