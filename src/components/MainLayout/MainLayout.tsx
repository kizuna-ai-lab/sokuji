import React, { useState, useRef, useCallback, useEffect, Activity } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import { Settings as SettingsComponent } from '../Settings';
import Onboarding from '../Onboarding/Onboarding';
import UserTypeSelection from '../UserTypeSelection/UserTypeSelection';
import TitleBar from '../TitleBar/TitleBar';
import PanelResizer from './PanelResizer';
import { clampPanelWidth, maxPanelWidth, readPanelWidth, savePanelWidth, PANEL_MIN_WIDTH } from './panelWidth';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';
import { useProvider, useUIMode, useSetProvider, useSetUIMode, useSettingsNavigationTarget, useSubtitleModeActive } from '../../stores/settingsStore';
import { isElectron, isKizunaAIEnabled } from '../../utils/environment';
import SubtitleApp from '../Subtitle/SubtitleApp';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useAuth } from '../../lib/auth/hooks';
import { Provider, isKizunaManagedProvider } from '../../types/Provider';

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
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth));

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


  // Re-clamp the saved/active width when the window shrinks so a wide panel
  // can never strand MainPanel below its minimum.
  useEffect(() => {
    const onResize = () => setPanelWidth((w) => clampPanelWidth(w, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePanelResize = useCallback((next: number) => {
    setPanelWidth(clampPanelWidth(next, window.innerWidth));
  }, []);
  const handlePanelResizeCommit = useCallback((next: number) => {
    const clamped = clampPanelWidth(next, window.innerWidth);
    setPanelWidth(clamped);
    savePanelWidth(clamped);
  }, []);

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
      // User just logged in. Only auto-switch when the Kizuna twins are actually
      // registered (isKizunaAIEnabled); otherwise we'd strand non-Kizuna builds on
      // a provider that ProviderConfigFactory/ClientFactory never registered.
      if (isKizunaAIEnabled() && uiMode === 'basic' && !isKizunaManagedProvider(provider)) {
        // User is in Basic Mode and not using a Kizuna-managed provider; switch
        // to the default relay-managed provider (the Translate twin).
        setProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE);

        // Track the auto-switch
        trackEvent('settings_modified', {
          setting_name: 'provider',
          new_value: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
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

  // In Electron subtitle mode the main process reshapes the BrowserWindow
  // into a tiny bar. Hide TitleBar and the main-layout tree (display:none
  // keeps MainPanel mounted so the active session survives) and mount
  // SubtitleApp in their place. Extension subtitle mode is handled inside
  // an injected iframe — sidepanel chrome stays visible.
  const electronSubtitleTakeover = subtitleActive && isElectron();

  return (
    <>
    {!electronSubtitleTakeover && (
      <TitleBar
        showSettings={showSettings}
        showLogs={showLogs}
        onToggleSettings={toggleSettings}
        onToggleLogs={toggleLogs}
      />
    )}
    <div
      className="main-layout"
      style={electronSubtitleTakeover ? { display: 'none' } : undefined}
    >
      <div className={`main-content ${(showLogs || showSettings) ? 'with-panel' : 'full-width'}`}>
        <div className="main-panel-container">
          <MainPanel />
        </div>
      </div>
      {(showLogs || showSettings) && (
        <PanelResizer
          width={panelWidth}
          min={PANEL_MIN_WIDTH}
          max={maxPanelWidth(window.innerWidth)}
          onResize={handlePanelResize}
          onCommit={handlePanelResizeCommit}
        />
      )}
      {/* The panel container stays mounted; each panel lives inside an
          <Activity> boundary so hidden panels keep their state (active tab,
          scroll positions, collapsed sections) while their effects are
          unmounted and their rendering is deprioritized. */}
      <div
        className="settings-panel-container"
        style={{
          width: panelWidth,
          ...((showLogs || showSettings) ? null : { display: 'none' }),
        }}
      >
        <Activity mode={showLogs ? 'visible' : 'hidden'}>
          <LogsPanel toggleLogs={toggleLogs} />
        </Activity>
        <Activity mode={showSettings ? 'visible' : 'hidden'}>
          <SettingsComponent
            toggleSettings={toggleSettings}
            highlightSection={settingsNavigationTarget}
          />
        </Activity>
      </div>
      <Onboarding />
    </div>
    {electronSubtitleTakeover && <SubtitleApp />}
    </>
  );
};

export default MainLayout;
