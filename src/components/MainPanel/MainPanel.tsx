import React from 'react';
import { Terminal, PlayCircle, Users, Settings, Volume2 } from 'react-feather';
import './MainPanel.scss';

interface MainPanelProps {
  toggleLogs: () => void;
  toggleSettings: () => void;
  toggleAudio: () => void;
}

const MainPanel: React.FC<MainPanelProps> = ({ 
  toggleLogs, 
  toggleSettings, 
  toggleAudio
}) => {
  return (
    <div className="main-panel">
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
      </div>
    </div>
  );
};

export default MainPanel;
