import React, { useState, useRef, useCallback, useEffect, Activity } from 'react';
import { useTranslation } from 'react-i18next';
import MainPanel from '../MainPanel/MainPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import { SettingsPage } from '../SettingsPage/SettingsPage';
import { HistoryPage } from '../History/HistoryPage';
import TourOverlay from '../Tour/TourOverlay';
import VbCableIntro from '../VbCable/VbCableIntro';
import RegionRecommendation from '../Region/RegionRecommendation';
import SetupWizard from '../SetupWizard/SetupWizard';
import TitleBar from '../TitleBar/TitleBar';
import PanelResizer from './PanelResizer';
import { clampPanelWidth, maxPanelWidth, readPanelWidth, savePanelWidth, PANEL_MIN_WIDTH } from './panelWidth';
import { useCloseLogsWhenDisabled } from './useCloseLogsWhenDisabled';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';
import { useSettingsNavigationTarget, useSubtitleModeActive, useDiagnosticLogs } from '../../stores/settingsStore';
import { isElectron, isExtension } from '../../utils/environment';
import NotesQuitDialog from '../Notes/NotesQuitDialog';
import LiveNotesPanel from '../LiveNotes/LiveNotesPanel';
import { useShowSettings, useSetShowSettings, useSetupWizardOpen, useSetSetupWizardOpen, useHistoryOpen, useSetHistoryOpen } from '../../stores/layoutStore';
import { SubtitleTakeover } from '../Subtitle/SubtitleTakeover';
import { useSetupLoaded, useSetupComplete } from '../../stores/setupStore';

type PanelName = 'settings' | 'logs' | 'main';

const MainLayout: React.FC = () => {
  const { trackEvent } = useAnalytics();
  const diagnosticLogs = useDiagnosticLogs();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const setupLoaded = useSetupLoaded();
  const setupComplete = useSetupComplete();
  const setupWizardOpen = useSetupWizardOpen();
  const setSetupWizardOpen = useSetSetupWizardOpen();
  // A sign-in in Basic mode moves the user onto the managed provider — never under either wizard (ruling 4).
  const subtitleActive = useSubtitleModeActive();
  const [showLogs, setShowLogs] = useState(() => {
    return sessionStorage.getItem('panelState.showLogs') === 'true';
  });
  const showSettings = useShowSettings();
  const historyOpen = useHistoryOpen();
  const setHistoryOpen = useSetHistoryOpen();
  /** The record History opens at, when the live notes led there: for that opening only. */
  const [historyRecord, setHistoryRecord] = useState<string | null>(null);
  // History left any way (its own close, the title bar, the logs, the settings) opens at its list next time.
  useEffect(() => { if (!historyOpen) setHistoryRecord(null); }, [historyOpen]);
  const setShowSettings = useSetShowSettings();
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth));

  // Track panel view times
  const panelOpenTimeRef = useRef<number | null>(null);
  const currentPanelRef = useRef<PanelName | null>(null);

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
      // The logs are a side panel of the conversation: they leave History for it.
      setHistoryOpen(false);
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


  // The logs button only exists while diagnostic logs are on (Help), so a
  // panel left open when they are switched off would have nothing to close it
  // with.
  // Closing means all three of these, not just the state: the persisted flag
  // would otherwise reopen the panel next session, and skipping trackPanelView
  // would leave the analytics believing logs were still on screen and charge
  // the next panel's duration to them.
  const closeLogsPanel = useCallback(() => {
    setShowLogs(false);
    sessionStorage.setItem('panelState.showLogs', 'false');
    trackPanelView(null);
  }, [trackPanelView]);

  useCloseLogsWhenDisabled(diagnosticLogs, showLogs, closeLogsPanel);
  // Opening History closes the logs too (Settings closes in the store's setter).
  useEffect(() => {
    if (historyOpen && showLogs) closeLogsPanel();
  }, [historyOpen, showLogs, closeLogsPanel]);

  // Visibility is derived, not just persisted. showLogs is restored from
  // sessionStorage during the first render, so a panel saved while diagnostic
  // logs were on would flash once after they were switched off, before the
  // effect above could close it.
  const logsVisible = showLogs && diagnosticLogs;

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

  // Nothing until setup state is known: a migrated user must never see the
  // wizard flash. Then the wizard in place of the layout on a fresh install.
  if (!setupLoaded) return null;
  if (!setupComplete) return <SetupWizard variant="first-run" />;

  // In Electron subtitle mode the main process reshapes the BrowserWindow
  // into a tiny bar. Hide TitleBar and the main-layout tree (display:none
  // keeps MainPanel mounted, so its Space key keeps holding turns) and mount
  // the takeover in their place: the same app session's view and runner, so
  // the run carries on untouched. Extension subtitle mode is handled inside
  // an injected iframe — sidepanel chrome stays visible.
  const electronSubtitleTakeover = subtitleActive && isElectron();
  // On the desktop the settings page takes the place of the conversation (which stays mounted underneath); in the
  // extension it sits in the side panel next to the conversation, as the old settings did.
  const pageInPlace = showSettings && !isExtension();
  // History (desktop) takes the place of the conversation and of the side panels; the conversation stays mounted.
  const historyInPlace = historyOpen && isElectron();
  const sidePanelOpen = !historyInPlace && (logsVisible || (showSettings && !pageInPlace));

  return (
    <>
    {!electronSubtitleTakeover && (
      <TitleBar
        showSettings={showSettings}
        showLogs={logsVisible}
        showLogsButton={diagnosticLogs}
        onToggleSettings={toggleSettings}
        onToggleLogs={toggleLogs}
      />
    )}
    <div
      className="main-layout"
      style={electronSubtitleTakeover ? { display: 'none' } : undefined}
    >
      <div
        className={`main-content ${sidePanelOpen ? 'with-panel' : 'full-width'}`}
        style={pageInPlace || historyInPlace ? { display: 'none' } : undefined}
      >
        {/* The conversation, with the live notes in its area (owner, 2026-11-18; MainPanel). */}
        <div className="main-panel-container">
          <MainPanel liveNotes={<LiveNotesPanel onOpenHistory={(id) => { setHistoryRecord(id); setHistoryOpen(true); }} />} />
        </div>
      </div>
      {/* Kept mounted behind an <Activity> boundary, like the side panels, so its open category and scroll survive a close. */}
      {!isExtension() && (
        <Activity mode={pageInPlace ? 'visible' : 'hidden'}>
          <div className="settings-page-container">
            <SettingsPage onClose={toggleSettings} />
          </div>
        </Activity>
      )}
      {historyInPlace && (
        <div className="history-page-container">
          <HistoryPage onClose={() => setHistoryOpen(false)} recordId={historyRecord} />
        </div>
      )}
      {sidePanelOpen && !pageInPlace && (
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
          ...(sidePanelOpen && !pageInPlace ? null : { display: 'none' }),
        }}
      >
        <Activity mode={logsVisible ? 'visible' : 'hidden'}>
          <LogsPanel toggleLogs={toggleLogs} />
        </Activity>
        {isExtension() && (
          <Activity mode={showSettings ? 'visible' : 'hidden'}>
            <SettingsPage onClose={toggleSettings} />
          </Activity>
        )}
      </div>
    </div>
    {setupWizardOpen && <SetupWizard variant="rerun" onClose={() => setSetupWizardOpen(false)} />}
    {/* Closing the app while notes are being written asks first (desktop). */}
    {isElectron() && <NotesQuitDialog />}
    {/* The gate, not the placement, is what matters: TourOverlay portals to
        document.body, so it would escape the main-layout subtree (and its
        takeover display:none) wherever it sat. During an Electron subtitle
        takeover the anchored UI is gone, so the tour does not render at all. */}
    {!electronSubtitleTakeover && <TourOverlay />}
    {!electronSubtitleTakeover && <VbCableIntro />}
    {!electronSubtitleTakeover && <RegionRecommendation />}
    {electronSubtitleTakeover && <SubtitleTakeover />}
    </>
  );
};

export default MainLayout;
