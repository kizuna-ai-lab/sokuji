import React, { useState, useRef, useCallback, useEffect, Activity } from 'react';
import MainPanel from '../MainPanel/MainPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import { Settings as SettingsComponent } from '../Settings';
import Onboarding from '../Onboarding/Onboarding';
import UserTypeSelection from '../UserTypeSelection/UserTypeSelection';
import TitleBar from '../TitleBar/TitleBar';
import PanelResizer from './PanelResizer';
import NavRail, { type ShellView } from './NavRail';
import { clampPanelWidth, maxPanelWidth, readPanelWidth, savePanelWidth, PANEL_MIN_WIDTH } from './panelWidth';
import './MainLayout.scss';
import { useAnalytics } from '../../lib/analytics';
import { useProvider, useUIMode, useSetProvider, useSetUIMode, useSettingsNavigationTarget, useSubtitleModeActive } from '../../stores/settingsStore';
import { isElectron, isKizunaAIEnabled, isMacOS } from '../../utils/environment';
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

  const [activeView, setActiveView] = useState<ShellView>(() =>
    sessionStorage.getItem('panelState.showSettings') === 'true' ? 'settings' : 'session'
  );
  const [showLogs, setShowLogs] = useState(() =>
    sessionStorage.getItem('panelState.showLogs') === 'true'
  );
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(readPanelWidth(), window.innerWidth));

  const panelOpenTimeRef = useRef<number | null>(null);
  const currentPanelRef = useRef<PanelName | null>(null);
  const prevIsSignedInRef = useRef(isSignedIn);

  const trackPanelView = (panelName: PanelName | null) => {
    if (currentPanelRef.current && panelOpenTimeRef.current) {
      const viewDuration = Date.now() - panelOpenTimeRef.current;
      trackEvent('panel_viewed', {
        panel_name: currentPanelRef.current,
        view_duration_ms: viewDuration,
      });
    }

    if (panelName) {
      trackEvent('panel_viewed', { panel_name: panelName });
      panelOpenTimeRef.current = Date.now();
      currentPanelRef.current = panelName;
    } else {
      trackEvent('panel_viewed', { panel_name: 'main' });
      panelOpenTimeRef.current = null;
      currentPanelRef.current = null;
    }
  };

  const openSession = useCallback(() => {
    setActiveView('session');
    sessionStorage.setItem('panelState.showSettings', 'false');
    if (currentPanelRef.current === 'settings') {
      trackPanelView(null);
    }
  }, [trackEvent]);

  const toggleSettings = useCallback(() => {
    setActiveView((prev) => {
      if (prev === 'settings') {
        sessionStorage.setItem('panelState.showSettings', 'false');
        trackPanelView(null);
        return 'session';
      }
      sessionStorage.setItem('panelState.showSettings', 'true');
      trackPanelView('settings');
      return 'settings';
    });
  }, [trackEvent]);

  const toggleLogs = useCallback(() => {
    setShowLogs((prev) => {
      const next = !prev;
      sessionStorage.setItem('panelState.showLogs', String(next));
      if (next) {
        trackPanelView('logs');
      } else if (currentPanelRef.current === 'logs') {
        trackPanelView(activeView === 'settings' ? 'settings' : null);
      }
      return next;
    });
  }, [activeView, trackEvent]);

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

  useEffect(() => {
    if (settingsNavigationTarget) {
      setActiveView('settings');
      sessionStorage.setItem('panelState.showSettings', 'true');
      trackPanelView('settings');
    }
  }, [settingsNavigationTarget]);

  const handleUserTypeSelection = useCallback((type: 'regular' | 'experienced') => {
    const newMode = type === 'regular' ? 'basic' : 'advanced';
    setUIMode(newMode);
    setUserType(type);
    trackEvent('user_type_applied', {
      user_type: type,
      ui_mode: newMode,
    });
  }, [setUIMode, setUserType, trackEvent]);

  useEffect(() => {
    if (!prevIsSignedInRef.current && isSignedIn) {
      if (isKizunaAIEnabled() && uiMode === 'basic' && !isKizunaManagedProvider(provider)) {
        setProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
        trackEvent('settings_modified', {
          setting_name: 'provider',
          new_value: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
          old_value: provider,
          category: 'api',
        });
        console.log('[MainLayout] Auto-switched to KizunaAI provider for Basic Mode user on login');
      }
    }
    prevIsSignedInRef.current = isSignedIn;
  }, [isSignedIn, uiMode, provider, setProvider, trackEvent]);

  if (!userTypeSelected) {
    return <UserTypeSelection onSelectUserType={handleUserTypeSelection} />;
  }

  const electronSubtitleTakeover = subtitleActive && isElectron();
  const showSettings = activeView === 'settings';
  const shellClass = [
    'main-layout',
    isElectron() && isMacOS() ? 'main-layout--darwin' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div
        className={shellClass}
        style={electronSubtitleTakeover ? { display: 'none' } : undefined}
      >
        <NavRail
          activeView={activeView}
          logsOpen={showLogs}
          onSelectSession={openSession}
          onToggleSettings={toggleSettings}
          onToggleLogs={toggleLogs}
        />

        <div className="main-shell">
          <TitleBar activeView={activeView} logsOpen={showLogs} />

          {/* Session stays mounted (display:none) so an active call survives Settings. */}
          <div
            className={`main-slot main-slot--session ${showSettings ? 'is-hidden' : 'is-visible'}`}
            aria-hidden={showSettings}
          >
            <div className="main-panel-container">
              <MainPanel />
            </div>
          </div>

          <div
            className={`main-slot main-slot--settings ${showSettings ? 'is-visible' : 'is-hidden'}`}
            aria-hidden={!showSettings}
          >
            <Activity mode={showSettings ? 'visible' : 'hidden'}>
              <div className="settings-full-slot">
                <SettingsComponent
                  toggleSettings={openSession}
                  highlightSection={settingsNavigationTarget}
                  closeMode="back"
                />
              </div>
            </Activity>
          </div>
        </div>

        {showLogs && (
          <button
            type="button"
            className="logs-drawer-backdrop"
            aria-label="Close logs"
            onClick={toggleLogs}
          />
        )}

        <aside
          className={`logs-drawer ${showLogs ? 'is-open' : ''}`}
          style={{ width: panelWidth }}
          aria-hidden={!showLogs}
        >
          {showLogs && (
            <PanelResizer
              width={panelWidth}
              min={PANEL_MIN_WIDTH}
              max={maxPanelWidth(window.innerWidth)}
              onResize={handlePanelResize}
              onCommit={handlePanelResizeCommit}
            />
          )}
          <div className="logs-drawer__body">
            <Activity mode={showLogs ? 'visible' : 'hidden'}>
              <LogsPanel toggleLogs={toggleLogs} />
            </Activity>
          </div>
        </aside>

        <Onboarding />
      </div>
      {electronSubtitleTakeover && <SubtitleApp />}
    </>
  );
};

export default MainLayout;
