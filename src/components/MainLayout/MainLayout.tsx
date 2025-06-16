import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import AudioPanel from '../AudioPanel/AudioPanel';
import Onboarding from '../Onboarding/Onboarding';
import { Terminal, Settings, Volume2 } from 'lucide-react';
import './MainLayout.scss';

const MainLayout: React.FC = () => {
  const { t } = useTranslation();
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudio, setShowAudio] = useState(false);

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
          <h1>{t('app.title')}</h1>
          <div className="header-controls">
            <button className={`settings-button ${showSettings ? 'active' : ''}`} onClick={toggleSettings}>
              <Settings size={16} />
              <span>{t('settings.title')}</span>
            </button>
            <button className={`audio-button ${showAudio ? 'active' : ''}`} onClick={toggleAudio}>
              <Volume2 size={16} />
              <span>{t('settings.audio')}</span>
            </button>
            <button className={`logs-button ${showLogs ? 'active' : ''}`} onClick={toggleLogs}>
              <Terminal size={16} />
              <span>{t('common.logs')}</span>
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
      <Onboarding />
    </div>
  );
};

export default MainLayout;