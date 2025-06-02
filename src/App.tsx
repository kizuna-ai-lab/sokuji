import React from 'react';
import './App.scss';
import './locales'; // Initialize i18n
import MainLayout from './components/MainLayout/MainLayout';
import { LogProvider } from './contexts/LogContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { AudioProvider } from './contexts/AudioContext';

function App() {
  return (
    <div className="App">
      <SettingsProvider>
        <LogProvider>
          <AudioProvider>
            <MainLayout />
          </AudioProvider>
        </LogProvider>
      </SettingsProvider>
    </div>
  );
}

export default App;
