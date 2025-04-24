import React, { useState } from 'react';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import AudioPanel from '../AudioPanel/AudioPanel';
import { Terminal, Settings, Volume2 } from 'react-feather';
import './MainLayout.scss';
import { useAudioContext } from '../../contexts/AudioContext';

const MainLayout: React.FC = () => {
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudio, setShowAudio] = useState(false);

  const {
    toggleInputDeviceState,
    toggleOutputDeviceState,
  } = useAudioContext();

  // Modify toggle functions to ensure only one panel is displayed at a time
  const toggleAudio = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showAudio) {
      setShowAudio(false);
    } else {
      setShowAudio(true);
      setShowLogs(false);
      setShowSettings(false);
    }
  };
  
  const toggleLogs = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showLogs) {
      setShowLogs(false);
    } else {
      setShowLogs(true);
      setShowAudio(false);
      setShowSettings(false);
    }
  };
  
  const toggleSettings = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showSettings) {
      setShowSettings(false);
    } else {
      setShowSettings(true);
      setShowAudio(false);
      setShowLogs(false);
    }
  };

  return (
    <div className="main-layout">
      <div className={`main-content ${(showLogs || showSettings || showAudio) ? 'with-panel' : 'full-width'}`}>
        <header className="main-panel-header">
          <h1>Realtime</h1>
          <div className="header-controls">
            <button className="settings-button" onClick={toggleSettings}>
              <Settings size={16} />
              <span>Settings</span>
            </button>
            <button className="audio-button" onClick={toggleAudio}>
              <Volume2 size={16} />
              <span>Audio</span>
            </button>
            <button className="logs-button" onClick={toggleLogs}>
              <Terminal size={16} />
              <span>Logs</span>
            </button>
          </div>
        </header>
        <div className="main-panel-container">
          <MainPanel />
        </div>
      </div>
      {(showLogs || showSettings || showAudio) && (
        <div className="settings-panel-container">
          {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
          {showSettings && <SettingsPanel toggleSettings={toggleSettings} />}
          {showAudio && (
            <AudioPanel toggleAudio={toggleAudio} />
          )}
        </div>
      )}
    </div>
  );
};

export default MainLayout;