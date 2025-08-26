import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import AudioPanel from '../AudioPanel/AudioPanel';
import SimpleConfigPanel from '../SimpleConfigPanel/SimpleConfigPanel';
import Onboarding from '../Onboarding/Onboarding';
import UserTypeSelection from '../UserTypeSelection/UserTypeSelection';
import { Terminal, Settings, Volume2, LayoutGrid, Sliders } from 'lucide-react';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';
import { useSettings } from '../../contexts/SettingsContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useAuth } from '../../lib/clerk/ClerkProvider';
import { Provider } from '../../types/Provider';

type PanelName = 'settings' | 'audio' | 'logs' | 'main';

const MainLayout: React.FC = () => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const { commonSettings, updateCommonSettings, settingsNavigationTarget } = useSettings();
  const { userTypeSelected, setUserType } = useOnboarding();
  const { isSignedIn } = useAuth();
  const [showLogs, setShowLogs] = useState(() => {
    return sessionStorage.getItem('panelState.showLogs') === 'true';
  });
  const [showSettings, setShowSettings] = useState(() => {
    return sessionStorage.getItem('panelState.showSettings') === 'true';
  });
  const [showAudio, setShowAudio] = useState(() => {
    return sessionStorage.getItem('panelState.showAudio') === 'true';
  });
  
  // Track panel view times
  const panelOpenTimeRef = useRef<number | null>(null);
  const currentPanelRef = useRef<PanelName | null>(null);
  
  // Track previous auth state to detect login
  const prevIsSignedInRef = useRef(isSignedIn);
  
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
      sessionStorage.setItem('panelState.showAudio', 'false');
      trackPanelView(null);
    } else {
      setShowAudio(true);
      setShowLogs(false);
      setShowSettings(false);
      sessionStorage.setItem('panelState.showAudio', 'true');
      sessionStorage.setItem('panelState.showLogs', 'false');
      sessionStorage.setItem('panelState.showSettings', 'false');
      trackPanelView('audio');
    }
  };
  
  const toggleLogs = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showLogs) {
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView(null);
    } else {
      setShowLogs(true);
      setShowAudio(false);
      setShowSettings(false);
      sessionStorage.setItem('panelState.showLogs', 'true');
      sessionStorage.setItem('panelState.showAudio', 'false');
      sessionStorage.setItem('panelState.showSettings', 'false');
      trackPanelView('logs');
    }
  };
  
  const toggleSettings = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showSettings) {
      setShowSettings(false);
      sessionStorage.setItem('panelState.showSettings', 'false');
      trackPanelView(null);
    } else {
      setShowSettings(true);
      setShowAudio(false);
      setShowLogs(false);
      sessionStorage.setItem('panelState.showSettings', 'true');
      sessionStorage.setItem('panelState.showAudio', 'false');
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  };

  // Toggle between basic and advanced mode
  const toggleUIMode = useCallback(() => {
    const newMode = commonSettings.uiMode === 'basic' ? 'advanced' : 'basic';
    updateCommonSettings({ uiMode: newMode });
    
    trackEvent('ui_mode_toggled', {
      from_mode: commonSettings.uiMode,
      to_mode: newMode
    });
  }, [commonSettings.uiMode, updateCommonSettings, trackEvent]);

  // Listen for navigation requests from settings context
  useEffect(() => {
    if (settingsNavigationTarget) {
      // Open settings panel when navigation is requested
      setShowSettings(true);
      setShowAudio(false);
      setShowLogs(false);
      // Save to sessionStorage when programmatically opening settings
      sessionStorage.setItem('panelState.showSettings', 'true');
      sessionStorage.setItem('panelState.showAudio', 'false');
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  }, [settingsNavigationTarget]);

  // Handle user type selection
  const handleUserTypeSelection = useCallback((type: 'regular' | 'experienced') => {
    // Set UI mode based on user type
    const newMode = type === 'regular' ? 'basic' : 'advanced';
    updateCommonSettings({ uiMode: newMode });
    
    // Call the onboarding context to handle the selection
    setUserType(type);
    
    trackEvent('user_type_applied', {
      user_type: type,
      ui_mode: newMode
    });
  }, [updateCommonSettings, setUserType, trackEvent]);

  // Auto-switch to KizunaAI when Basic Mode users log in
  useEffect(() => {
    // Check if user just logged in (was false, now true)
    if (!prevIsSignedInRef.current && isSignedIn) {
      // User just logged in
      if (commonSettings.uiMode === 'basic' && commonSettings.provider !== Provider.KIZUNA_AI) {
        // User is in Basic Mode and not using KizunaAI, switch to KizunaAI
        updateCommonSettings({ provider: Provider.KIZUNA_AI });
        
        // Track the auto-switch
        trackEvent('settings_modified', {
          setting_name: 'provider',
          new_value: 'kizunaai',
          old_value: commonSettings.provider,
          category: 'api'
        });
        
        console.log('[MainLayout] Auto-switched to KizunaAI provider for Basic Mode user on login');
      }
    }
    
    // Update the ref for next render
    prevIsSignedInRef.current = isSignedIn;
  }, [isSignedIn, commonSettings.uiMode, commonSettings.provider, updateCommonSettings, trackEvent]);

  // Show user type selection if not selected yet
  if (!userTypeSelected) {
    return <UserTypeSelection onSelectUserType={handleUserTypeSelection} />;
  }

  return (
    <div className="main-layout">
      <div className={`main-content ${(showLogs || showSettings || showAudio) ? 'with-panel' : 'full-width'}`}>
        <header className="main-panel-header">
          <h1>{t('app.title')}</h1>
          <div className="header-controls">
            <button 
              id="ui-mode-toggle"
              className={`ui-mode-toggle-icon ${commonSettings.uiMode}`}
              onClick={toggleUIMode}
              title={t(commonSettings.uiMode === 'basic' ? 'mainPanel.switchToAdvanced' : 'mainPanel.switchToBasic')}
              aria-label={t(commonSettings.uiMode === 'basic' ? 'mainPanel.switchToAdvanced' : 'mainPanel.switchToBasic')}
            >
              {commonSettings.uiMode === 'basic' ? <LayoutGrid size={16} /> : <Sliders size={16} />}
            </button>
            <button className={`settings-button ${showSettings ? 'active' : ''}`} onClick={toggleSettings}>
              <Settings size={16} />
              <span>{t('settings.title')}</span>
            </button>
            {commonSettings.uiMode === 'advanced' && (
              <button className={`audio-button ${showAudio ? 'active' : ''}`} onClick={toggleAudio}>
                <Volume2 size={16} />
                <span>{t('settings.audio')}</span>
              </button>
            )}
            {commonSettings.uiMode === 'advanced' && (
              <button className={`logs-button ${showLogs ? 'active' : ''}`} onClick={toggleLogs}>
                <Terminal size={16} />
                <span>{t('common.logs')}</span>
              </button>
            )}
          </div>
        </header>
        <div className="main-panel-container">
          <MainPanel />
        </div>
      </div>
      {(showLogs || showSettings || showAudio) && (
        <div className="settings-panel-container">
          {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
          {showSettings && (
            commonSettings.uiMode === 'basic' ? (
              <SimpleConfigPanel 
                toggleSettings={toggleSettings} 
                highlightSection={settingsNavigationTarget}
              />
            ) : (
              <SettingsPanel toggleSettings={toggleSettings} />
            )
          )}
          {showAudio && (
            commonSettings.uiMode === 'basic' ? (
              <SimpleConfigPanel 
                toggleSettings={toggleAudio} 
                highlightSection={settingsNavigationTarget}
              />
            ) : (
              <AudioPanel toggleAudio={toggleAudio} />
            )
          )}
        </div>
      )}
      <Onboarding />
    </div>
  );
};

export default MainLayout;