import React, { useState } from 'react';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import './MainLayout.scss';

const MainLayout: React.FC = () => {
  const [showLogs, setShowLogs] = useState(false);

  const toggleLogs = () => {
    setShowLogs(!showLogs);
  };

  return (
    <div className="main-layout">
      <div className="main-panel-container">
        <MainPanel toggleLogs={toggleLogs} />
      </div>
      <div className="settings-panel-container">
        {showLogs ? <LogsPanel toggleLogs={toggleLogs} /> : <SettingsPanel />}
      </div>
    </div>
  );
};

export default MainLayout;
