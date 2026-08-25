import React, { useState, useRef, useCallback, useEffect, Activity } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import { Settings as SettingsComponent } from '../Settings';
import TourOverlay from '../Tour/TourOverlay';
import SetupWizard from '../SetupWizard/SetupWizard';
import TitleBar from '../TitleBar/TitleBar';
import PanelResizer from './PanelResizer';
import { clampPanelWidth, maxPanelWidth, readPanelWidth, savePanelWidth, PANEL_MIN_WIDTH } from './panelWidth';
import { useCloseLogsOutsideAdvanced } from './useCloseLogsOutsideAdvanced';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';
import { useProvider, useUIMode, useSetProvider, useSettingsNavigationTarget, useSubtitleModeActive } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
import { useShowSettings, useSetShowSettings, useSetupWizardOpen, useSetSetupWizardOpen } from '../../stores/layoutStore';
import SubtitleApp from '../Subtitle/SubtitleApp';
import { useSetupLoaded, useSetupComplete } from '../../stores/setupStore';
import { useAuth } from '../../lib/auth/hooks';
import { isKizunaManagedProvider } from '../../types/Provider';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';

type PanelName = 'settings' | 'logs' | 'main';

const MainLayout: React.FC = () => {
  const { trackEvent } = useAnalytics();
  const provider = useProvider();
  const uiMode = useUIMode();
  const setProvider = useSetProvider();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const setupLoaded = useSetupLoaded();
  const setupComplete = useSetupComplete();
  const setupWizardOpen = useSetupWizardOpen();
  const setSetupWizardOpen = useSetSetupWizardOpen();
  const { isSignedIn } = useAuth();
  const subtitleActive = useSubtitleModeActive();
  const [showLogs, setShowLogs] = useState(() => {
    return sessionStorage.getItem('panelState.showLogs') === 'true';
  });
  const showSettings = useShowSettings();
  const setShowSettings = useSetShowSettings();
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth));

  // Track panel view times
  const panelOpenTimeRef = useRef<number | null>(null);
  const currentPanelRef = useRef<PanelName | null>(null);

  // Track previous auth state to detect login
  const prevIsSignedInRef = useRef(isSignedIn);

  // Helper function to track panel view events.
  // useCallback so it can be a dependency of the mode-change effect below
  // without re-arming it on every render.
  const trackPanelView = useCallback((panelName: PanelName | null) => {
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
  }, [trackEvent]);

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
      trackPanelView('logs');
    }
  };

  const toggleSettings = () => {
    // If already shown, close it; otherwise open it and close other panels
    if (showSettings) {
      setShowSettings(false);
      trackPanelView(null);
    } else {
      setShowSettings(true);
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  };


  // The logs button only exists in advanced mode, so a panel left open across
  // a switch to basic would have nothing to close it with.
  // Closing means all three of these, not just the state: the persisted flag
  // would otherwise reopen the panel next session, and skipping trackPanelView
  // would leave the analytics believing logs were still on screen and charge
  // the next panel's duration to them.
  const closeLogsPanel = useCallback(() => {
    setShowLogs(false);
    sessionStorage.setItem('panelState.showLogs', 'false');
    trackPanelView(null);
  }, [trackPanelView]);

  useCloseLogsOutsideAdvanced(uiMode, showLogs, closeLogsPanel);

  // Visibility is derived, not just persisted. showLogs is restored from
  // sessionStorage during the first render, so a panel saved in advanced mode
  // would flash once in basic before the effect above could close it.
  const logsVisible = showLogs && uiMode === 'advanced';

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
      sessionStorage.setItem('panelState.showLogs', 'false');
      trackPanelView('settings');
    }
  }, [settingsNavigationTarget, setShowSettings]);

  // Auto-switch to KizunaAI when Basic Mode users log in
  useEffect(() => {
    // Check if user just logged in (was false, now true)
    if (!prevIsSignedInRef.current && isSignedIn) {
      // User just logged in. The target is derived from what is REGISTERED, not
      // from a feature flag: the managed providers are gated independently now,
      // so isKizunaAIEnabled() no longer implies the Translate twin exists. In
      // the shipping build (Kizuna on, relay twins off) selecting it would set
      // a provider ProviderConfigFactory never registered, and the getDescriptor
      // calls throughout MainPanel/ProviderSection throw on the next render —
      // signing in would break the app outright.
      const managedDefault = ProviderConfigFactory.getDefaultManagedProvider();
      if (managedDefault && uiMode === 'basic' && !isKizunaManagedProvider(provider)) {
        // User is in Basic Mode and not using a Kizuna-managed provider; switch
        // to whichever managed provider this build actually offers.
        setProvider(managedDefault);

        // Track the auto-switch
        trackEvent('settings_modified', {
          setting_name: 'provider',
          new_value: managedDefault,
          old_value: provider,
          category: 'api'
        });

        console.log('[MainLayout] Auto-switched to KizunaAI provider for Basic Mode user on login');
      }
    }

    // Update the ref for next render
    prevIsSignedInRef.current = isSignedIn;
  }, [isSignedIn, uiMode, provider, setProvider, trackEvent]);

  // Nothing until setup state is known: a migrated user must never see the
  // wizard flash. Then the wizard in place of the layout on a fresh install.
  if (!setupLoaded) return null;
  if (!setupComplete) return <SetupWizard variant="first-run" />;

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
        showLogs={logsVisible}
        showLogsButton={uiMode === 'advanced'}
        onToggleSettings={toggleSettings}
        onToggleLogs={toggleLogs}
      />
    )}
    <div
      className="main-layout"
      style={electronSubtitleTakeover ? { display: 'none' } : undefined}
    >
      <div className={`main-content ${(logsVisible || showSettings) ? 'with-panel' : 'full-width'}`}>
        <div className="main-panel-container">
          <MainPanel />
        </div>
      </div>
      {(logsVisible || showSettings) && (
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
          ...((logsVisible || showSettings) ? null : { display: 'none' }),
        }}
      >
        <Activity mode={logsVisible ? 'visible' : 'hidden'}>
          <LogsPanel toggleLogs={toggleLogs} />
        </Activity>
        <Activity mode={showSettings ? 'visible' : 'hidden'}>
          <SettingsComponent
            toggleSettings={toggleSettings}
            highlightSection={settingsNavigationTarget}
          />
        </Activity>
      </div>
    </div>
    {setupWizardOpen && <SetupWizard variant="rerun" onClose={() => setSetupWizardOpen(false)} />}
    {/* The gate, not the placement, is what matters: TourOverlay portals to
        document.body, so it would escape the main-layout subtree (and its
        takeover display:none) wherever it sat. During an Electron subtitle
        takeover the anchored UI is gone, so the tour does not render at all. */}
    {!electronSubtitleTakeover && <TourOverlay />}
    {electronSubtitleTakeover && <SubtitleApp />}
    </>
  );
};

export default MainLayout;
