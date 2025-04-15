import React, { useState } from 'react';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import './MainLayout.scss';

const MainLayout: React.FC = () => {
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const toggleLogs = () => {
    setShowLogs(!showLogs);
    if (!showLogs) setShowSettings(false); // Close settings when opening logs
  };

  const toggleSettings = () => {
    setShowSettings(!showSettings);
    if (!showSettings) setShowLogs(false); // Close logs when opening settings
  };

  return (
    <div className="main-layout">
      <div className={`main-panel-container ${(showLogs || showSettings) ? 'with-panel' : 'full-width'}`}>
        <MainPanel toggleLogs={toggleLogs} toggleSettings={toggleSettings} />
      </div>
      {(showLogs || showSettings) && (
        <div className="settings-panel-container">
          {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
          {showSettings && <SettingsPanel toggleSettings={toggleSettings} />}
        </div>
      )}
    </div>
  );
};

export default MainLayout;
