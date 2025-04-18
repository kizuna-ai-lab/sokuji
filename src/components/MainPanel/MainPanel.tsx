import React, { useState, useEffect } from 'react';
import { Terminal, PlayCircle, Users, Settings, Volume2, Square } from 'react-feather';
import './MainPanel.scss';
import TokenGenerator from './TokenGenerator';

interface MainPanelProps {
  toggleLogs: () => void;
  toggleSettings: () => void;
  toggleAudio: () => void;
  toggleSession: () => void;
  isSessionActive: boolean;
}

const MainPanel: React.FC<MainPanelProps> = ({ 
  toggleLogs, 
  toggleSettings, 
  toggleAudio,
  toggleSession,
  isSessionActive
}) => {
  // These state variables are required for TokenGenerator component
  // TokenGenerator needs these values to generate API tokens with the correct voice and model settings
  const [voice, setVoice] = useState<string>('alloy');
  const [model, setModel] = useState<string>('gpt-4o-realtime-preview');
  
  // Load voice setting from config - this is essential for TokenGenerator to use the user's preferred voice
  // This ensures TokenGenerator uses the same voice setting across app restarts
  useEffect(() => {
    const loadVoiceSetting = async () => {
      try {
        if (window.electron && window.electron.config) {
          const savedVoice = await window.electron.config.get('settings.voice', 'alloy');
          if (savedVoice) setVoice(savedVoice);
          
          const savedModel = await window.electron.config.get('settings.model', 'gpt-4o-realtime-preview');
          if (savedModel) setModel(savedModel);
        }
      } catch (error) {
        console.error('Error loading voice setting:', error);
      }
    };
    
    loadVoiceSetting();
  }, []);

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
          <TokenGenerator voice={voice} model={model} />
        </div>
      </div>
      <div className="floating-controls">
        <button 
          className={`start-session-button ${isSessionActive ? 'active' : ''}`} 
          onClick={toggleSession}
        >
          {isSessionActive ? (
            <>
              <Square size={16} />
              <span>Stop session</span>
            </>
          ) : (
            <>
              <PlayCircle size={16} />
              <span>Start session</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default MainPanel;
