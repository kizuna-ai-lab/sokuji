import React from 'react';
import './App.scss';
import MainLayout from './components/MainLayout/MainLayout';
import { LogProvider } from './contexts/LogContext';

function App() {
  return (
    <div className="App">
      <LogProvider>
        <MainLayout />
      </LogProvider>
    </div>
  );
}

export default App;
