import React from 'react';
import './App.scss';
import MainLayout from './components/MainLayout/MainLayout';
import { LogProvider } from './contexts/LogContext';
import { SettingsProvider } from './contexts/SettingsContext';

function App() {
  return (
    <div className="App">
      <SettingsProvider>
        <LogProvider>
          <MainLayout />
        </LogProvider>
      </SettingsProvider>
    </div>
  );
}

export default App;
