import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import AudioPanel from '../AudioPanel/AudioPanel';
import Onboarding from '../Onboarding/Onboarding';
import { Terminal, Settings, Volume2 } from 'lucide-react';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';

type PanelName = 'settings' | 'audio' | 'logs' | 'main';

const MainLayout: React.FC = () => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  
  // Track panel view times
  const panelOpenTimeRef = useRef<number | null>(null);
  const currentPanelRef = useRef<PanelName | null>(null);
  
  // Helper function to track panel view events
  const trackPanelView = (panelName: PanelName | null) => {
    // Track closing of previous panel
    if (currentPanelRef.current && panelOpenTimeRef.current) {
      const viewDuration = Date.now() - panelOpenTimeRef.current;
      trackEvent('panel_viewed', {
        panel_name: currentPanelRef.current,
        view_duration_ms: viewDuration
      });
    }
    
    // Track opening of new panel
    if (panelName) {
      trackEvent('panel_viewed', {
        panel_name: panelName
      });
      panelOpenTimeRef.current = Date.now();
      currentPanelRef.current = panelName;
    } else {
      // Going back to main panel
      trackEvent('panel_viewed', {
        panel_name: 'main'
      });
      panelOpenTimeRef.current = null;
      currentPanelRef.current = null;
    }
  };

  // Modify toggle functions to ensure only one panel is displayed at a time
  const toggleAudio = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showAudio) {
      setShowAudio(false);
      trackPanelView(null);
    } else {
      setShowAudio(true);
      setShowLogs(false);
      setShowSettings(false);
      trackPanelView('audio');
    }
  };
  
  const toggleLogs = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showLogs) {
      setShowLogs(false);
      trackPanelView(null);
    } else {
      setShowLogs(true);
      setShowAudio(false);
      setShowSettings(false);
      trackPanelView('logs');
    }
  };
  
  const toggleSettings = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showSettings) {
      setShowSettings(false);
      trackPanelView(null);
    } else {
      setShowSettings(true);
      setShowAudio(false);
      setShowLogs(false);
      trackPanelView('settings');
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