import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import { Settings as SettingsComponent } from '../Settings';
import Onboarding from '../Onboarding/Onboarding';
import UserTypeSelection from '../UserTypeSelection/UserTypeSelection';
import TitleBar from '../TitleBar/TitleBar';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';
import { useProvider, useUIMode, useSetProvider, useSetUIMode, useSettingsNavigationTarget, useSubtitleModeActive } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
import SubtitleApp from '../Subtitle/SubtitleApp';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useAuth } from '../../lib/auth/hooks';
import { Provider } from '../../types/Provider';

type PanelName = 'settings' | 'logs' | 'main';

const MainLayout: React.FC = () => {
  const { trackEvent } = useAnalytics();
  const provider = useProvider();
  const uiMode = useUIMode();
  const setProvider = useSetProvider();
  const setUIMode = useSetUIMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const { userTypeSelected, setUserType } = useOnboarding();
  const { isSignedIn } = useAuth();
  const subtitleActive = useSubtitleModeActive();
  const [showLogs, setShowLogs] = useState(() => {
    return sessionStorage.getItem('panelState.showLogs') === 'true';
  });
  const [showSettings, setShowSettings] = useState(() => {
    return sessionStorage.getItem('panelState.showSettings') === 'true';
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
  const toggleLogs = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showLogs) {
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView(null);
    } else {
      setShowLogs(true);
      setShowSettings(false);
      sessionStorage.setItem('panelState.showLogs', 'true');
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
      setShowLogs(false);
      sessionStorage.setItem('panelState.showSettings', 'true');
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  };


  // Listen for navigation requests from settings context
  useEffect(() => {
    if (settingsNavigationTarget) {
      // Open settings panel when navigation is requested
      setShowSettings(true);
      setShowLogs(false);
      // Save to sessionStorage when programmatically opening settings
      sessionStorage.setItem('panelState.showSettings', 'true');
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  }, [settingsNavigationTarget]);

  // Handle user type selection
  const handleUserTypeSelection = useCallback((type: 'regular' | 'experienced') => {
    // Set UI mode based on user type
    const newMode = type === 'regular' ? 'basic' : 'advanced';
    setUIMode(newMode);

    // Call the onboarding context to handle the selection
    setUserType(type);

    trackEvent('user_type_applied', {
      user_type: type,
      ui_mode: newMode
    });
  }, [setUIMode, setUserType, trackEvent]);

  // Auto-switch to KizunaAI when Basic Mode users log in
  useEffect(() => {
    // Check if user just logged in (was false, now true)
    if (!prevIsSignedInRef.current && isSignedIn) {
      // User just logged in
      if (uiMode === 'basic' && provider !== Provider.KIZUNA_AI) {
        // User is in Basic Mode and not using KizunaAI, switch to KizunaAI
        setProvider(Provider.KIZUNA_AI);

        // Track the auto-switch
        trackEvent('settings_modified', {
          setting_name: 'provider',
          new_value: 'kizunaai',
          old_value: provider,
          category: 'api'
        });

        console.log('[MainLayout] Auto-switched to KizunaAI provider for Basic Mode user on login');
      }
    }

    // Update the ref for next render
    prevIsSignedInRef.current = isSignedIn;
  }, [isSignedIn, uiMode, provider, setProvider, trackEvent]);

  // Show user type selection if not selected yet
  if (!userTypeSelected) {
    return <UserTypeSelection onSelectUserType={handleUserTypeSelection} />;
  }

  return (
    <>
    {/* Electron-only: hide the TitleBar when subtitle mode is active —
        the main process reshapes the BrowserWindow into a tiny bar and
        there's no room for the regular header. In the extension the
        sidepanel keeps its full chrome (Settings / Logs / SubtitleEnter
        stay accessible while the subtitle overlay is up). */}
    {(!subtitleActive || !isElectron()) && (
      <TitleBar
        showSettings={showSettings}
        showLogs={showLogs}
        onToggleSettings={toggleSettings}
        onToggleLogs={toggleLogs}
      />
    )}
    <div
      className="main-layout"
      // Electron-only: when subtitle mode is active the main process reshapes
      // the BrowserWindow into a tiny bar, but hiding the main layout here too
      // avoids a flash of MainPanel before the resize lands. In the extension,
      // the sidepanel must stay visible (MainPanel renders the takeover hint
      // in its conversation area; subtitle UI lives in a content-script iframe).
      style={subtitleActive && isElectron() ? { display: 'none' } : undefined}
    >
      <div className={`main-content ${(showLogs || showSettings) ? 'with-panel' : 'full-width'}`}>
        <div className="main-panel-container">
          <MainPanel />
        </div>
      </div>
      {(showLogs || showSettings) && (
        <div className="settings-panel-container">
          {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
          {showSettings && (
            <SettingsComponent
              toggleSettings={toggleSettings}
              highlightSection={settingsNavigationTarget}
            />
          )}
        </div>
      )}
      <Onboarding />
    </div>
    {/* Electron-only: SubtitleApp renders into the same React tree because */}
    {/* Electron's main process reshapes the BrowserWindow into a tiny bar, */}
    {/* visually replacing MainPanel with this overlay. In the extension, the */}
    {/* SubtitleApp lives inside an iframe injected into the meeting tab by */}
    {/* the content script (see ExtensionContentScriptSubtitleSurface) — */}
    {/* rendering it here too would double-mount it on top of MainPanel. */}
    {subtitleActive && isElectron() && <SubtitleApp />}
    </>
  );
};

export default MainLayout;
