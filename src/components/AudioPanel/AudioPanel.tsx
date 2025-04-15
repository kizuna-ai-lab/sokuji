import React from 'react';
import { ArrowRight, Volume2 } from 'react-feather';
import './AudioPanel.scss';

interface AudioPanelProps {
  toggleAudio: () => void;
  audioDevices: Array<{deviceId: string; label: string}>;
  selectedDevice: {deviceId: string; label: string};
  isDeviceOn: boolean;
  isLoading: boolean;
  selectDevice: (device: {deviceId: string; label: string}) => void;
  toggleDeviceState: () => void;
  audioHistory: number[];
}

const DOT_SIZE = 3; // px

const AudioPanel: React.FC<AudioPanelProps> = ({ 
  toggleAudio, 
  audioDevices, 
  selectedDevice, 
  isDeviceOn, 
  isLoading,
  selectDevice,
  toggleDeviceState,
  audioHistory
}) => {
  // Audio waveform history: 5 bars, right is newest
  const AudioWaveform = () => (
    <div className="audio-waveform">
      {audioHistory.map((level, idx) => {
        // 更灵敏的阈值和放大倍数
        const threshold = 0.02; // 降低阈值
        const AMPLIFY = 32;     // 增加放大倍数
        // 可选：非线性提升灵敏度（如开方）
        const enhancedLevel = Math.sqrt(level); // 让低音量更明显
        const height = enhancedLevel < threshold ? DOT_SIZE : Math.max(DOT_SIZE, enhancedLevel * AMPLIFY);
        return (
          <div
            key={idx}
            className="waveform-bar"
            style={{
              height: `${height}px`,
              width: `${DOT_SIZE}px`,
              borderRadius: `${DOT_SIZE / 2}px`,
              opacity: isDeviceOn ? 1 : 0.5
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
        <div className="audio-section">
          <h3>Audio Input Device</h3>
          <div className="device-selector">
            <div className="device-status">
              <div className={`device-icon ${isDeviceOn ? 'active' : 'inactive'}`}>
                <Volume2 size={18} />
              </div>
              <div className="device-info">
                <div className="device-name">{isLoading ? 'Loading devices...' : selectedDevice.label}</div>
                <AudioWaveform />
              </div>
            </div>
            <button 
              className={`device-toggle-button ${isDeviceOn ? 'on' : 'off'}`}
              onClick={toggleDeviceState}
            >
              {isDeviceOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
          
          <div className="device-list">
            <h4>Available Devices</h4>
            {audioDevices.map((device, index) => (
              <div 
                key={index} 
                className={`device-option ${selectedDevice.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => selectDevice(device)}
              >
                <span>{device.label}</span>
                {selectedDevice.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPanel;
