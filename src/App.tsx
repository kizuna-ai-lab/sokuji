import React from 'react';
import './App.scss';
import './locales'; // Initialize i18n
import MainLayout from './components/MainLayout/MainLayout';
// import LanguageSwitcher from './components/LanguageSwitcher';
// import I18nExample from './components/I18nExample';
import { LogProvider } from './contexts/LogContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { AudioProvider } from './contexts/AudioContext';

function App() {
  return (
    <div className="App">
      <SettingsProvider>
        <LogProvider>
          <AudioProvider>
            {/* <div className="app-header">
              <LanguageSwitcher />
            </div> */}
            {/* <I18nExample /> */}
            <MainLayout />
          </AudioProvider>
        </LogProvider>
      </SettingsProvider>
    </div>
  );
}

export default App;
