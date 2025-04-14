import React, { useState } from 'react';
import { Terminal, Check, ChevronDown, Mic, MicOff, PlayCircle, Users } from 'react-feather';
import './MainPanel.scss';

interface MainPanelProps {
  toggleLogs: () => void;
}

const MainPanel: React.FC<MainPanelProps> = ({ toggleLogs }) => {
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('Default');
  const [isDeviceOn, setIsDeviceOn] = useState(true);
  
  const toggleDeviceDropdown = () => {
    setShowDeviceDropdown(!showDeviceDropdown);
  };
  
  const selectDevice = (device: string) => {
    setSelectedDevice(device);
    setShowDeviceDropdown(false);
  };
  
  const toggleDeviceState = () => {
    setIsDeviceOn(!isDeviceOn);
    setShowDeviceDropdown(false);
  };

  return (
    <div className="main-panel">
      <header className="main-panel-header">
        <h1>Realtime</h1>
        <div className="header-controls">
          <button 
            className="logs-button" 
            onClick={toggleLogs}
          >
            <Terminal size={16} />
            <span>Logs</span>
          </button>
        </div>
      </header>

      <div className="conversation-container">
        <div className="conversation-content">
          <div className="conversation-placeholder">
            <div className="placeholder-content">
              <div className="icon-container">
                <Users size={24} />
              </div>
              <span>Conversation will appear here</span>
            </div>
          </div>
        </div>
      </div>

      <div className="floating-controls">
        <button className="start-session-button">
          <PlayCircle size={16} />
          <span>Start session</span>
        </button>
        
        <div className="device-dropdown-container">
          <button 
            className="device-selector-button" 
            onClick={toggleDeviceDropdown}
          >
            {isDeviceOn ? (
              <span className="device-icon"><Mic size={16} /></span>
            ) : (
              <span className="device-icon device-off"><MicOff size={16} /></span>
            )}
            <span>{selectedDevice}</span>
            <ChevronDown size={14} />
          </button>
          
          {showDeviceDropdown && (
            <div className="device-dropdown">
              <div className="device-list">
                <div 
                  className={`device-option ${selectedDevice === 'Default' ? 'selected' : ''}`}
                  onClick={() => selectDevice('Default')}
                >
                  <div className="icon-container">
                    {selectedDevice === 'Default' && <Check size={14} />}
                  </div>
                  <span>Default</span>
                </div>
                <div 
                  className="device-option"
                  onClick={() => selectDevice('HyperX 7.1 Audio Digital Stereo')}
                >
                  <div className="icon-container">
                    {selectedDevice === 'HyperX 7.1 Audio Digital Stereo' && <Check size={14} />}
                  </div>
                  <span>HyperX 7.1 Audio Digital Stereo</span>
                </div>
                <div 
                  className="device-option"
                  onClick={() => selectDevice('Anker PowerConf C200 Digital Stereo')}
                >
                  <div className="icon-container">
                    {selectedDevice === 'Anker PowerConf C200 Digital Stereo' && <Check size={14} />}
                  </div>
                  <span>Anker PowerConf C200 Digital Stereo</span>
                </div>
                <div className="device-state-option" onClick={toggleDeviceState}>
                  <div className="icon-container">
                    {isDeviceOn ? <Mic size={14} /> : <MicOff size={14} />}
                  </div>
                  <span>{isDeviceOn ? 'On' : 'Off'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MainPanel;
