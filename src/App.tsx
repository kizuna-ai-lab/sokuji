import React, { useEffect } from 'react';
import './App.scss';
import './locales'; // Initialize i18n
import MainLayout from './components/MainLayout/MainLayout';
import { LogProvider } from './contexts/LogContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { AudioProvider } from './contexts/AudioContext';
import { AnalyticsConsentBanner } from './components/AnalyticsConsent';
import { useAnalytics } from './lib/analytics';

function App() {
  const { trackEvent } = useAnalytics();

  useEffect(() => {
    // Track app startup
    trackEvent('app_startup', {
      version: '1.0.0', // TODO: Get from package.json
      platform: navigator.platform || 'unknown'
    });

    // Track app shutdown on beforeunload
    const handleBeforeUnload = () => {
      const sessionStart = sessionStorage.getItem('session_start');
      const sessionDuration = sessionStart 
        ? Date.now() - parseInt(sessionStart, 10)
        : 0;
      
      trackEvent('app_shutdown', {
        session_duration: sessionDuration
      });
    };

    // Store session start time
    if (!sessionStorage.getItem('session_start')) {
      sessionStorage.setItem('session_start', Date.now().toString());
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [trackEvent]);

  return (
    <div className="App">
      <SettingsProvider>
        <LogProvider>
          <AudioProvider>
            <MainLayout />
            <AnalyticsConsentBanner />
          </AudioProvider>
        </LogProvider>
      </SettingsProvider>
    </div>
  );
}

export default App;
