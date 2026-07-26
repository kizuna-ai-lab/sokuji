import React, { useState, useEffect } from 'react';
import { LayoutGrid, Sliders, Settings as SettingsIcon, Headphones, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIMode, useSetUIMode, useNavigateToSettings, useSettingsNavigationTarget } from '../../stores/settingsStore';
import { useIsSessionActive } from '../../stores/sessionStore';
import { useAnalytics } from '../../lib/analytics';
import SimpleSettings from './SimpleSettings/SimpleSettings';
import AdvancedSettings from './AdvancedSettings/AdvancedSettings';
import PanelBar from './shared/PanelBar';
import type { Tab } from './shared/TabBar';
import './Settings.scss';

interface SettingsProps {
  toggleSettings?: () => void;
  /** External highlight section prop */
  highlightSection?: string | null;
}

const TABS: Tab[] = [
  { id: 'general', labelKey: 'settings.tabs.general', fallback: 'General', icon: SettingsIcon },
  { id: 'audio', labelKey: 'settings.tabs.audio', fallback: 'Audio', icon: Headphones },
  { id: 'provider', labelKey: 'settings.tabs.provider', fallback: 'Provider', icon: Cpu },
];

// Settings unmounts whenever another panel takes its place (MainLayout renders
// panels conditionally), so the active tab lives in sessionStorage like the
// rest of the panelState.* keys.
const TAB_STORAGE_KEY = 'panelState.settingsActiveTab';

function readStoredTab(): string {
  const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
  return stored && TABS.some((tab) => tab.id === stored) ? stored : 'general';
}

const NAVIGATION_TAB_MAP: Record<string, string> = {
  'user-account': 'general',
  'languages': 'general',
  'microphone': 'audio',
  'speaker': 'audio',
  'system-audio': 'audio',
  'participant': 'audio',
  'provider': 'provider',
  'system-instructions': 'provider',
  'voice-settings': 'provider',
  'turn-detection': 'provider',
  'model-management': 'provider',
  'model-asr': 'provider',
  'model-translation': 'provider',
  'model-tts': 'provider',
};

const Settings: React.FC<SettingsProps> = ({ toggleSettings, highlightSection }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const isSessionActive = useIsSessionActive();

  const uiMode = useUIMode();
  const setUIMode = useSetUIMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  // 'basic' maps to Simple/Quick, 'advanced' maps to Advanced.
  const isSimpleMode = uiMode === 'basic';

  const [activeTab, setActiveTab] = useState(readStoredTab);

  useEffect(() => {
    sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  // Advanced-only: switch to the target tab and scroll/highlight its section.
  // Quick mode highlights via SimpleSettings' highlightSection instead.
  useEffect(() => {
    if (isSimpleMode) return;
    if (!settingsNavigationTarget) return;
    const targetTab = NAVIGATION_TAB_MAP[settingsNavigationTarget];
    if (targetTab && targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
    // Wait for the tab switch + DOM update before scrolling. Cancel the
    // pending scroll on cleanup so flipping modes mid-navigation doesn't
    // fire into an unmounted/stale DOM.
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let highlightedEl: HTMLElement | null = null;
    const scrollTimer = setTimeout(() => {
      const element = document.getElementById(`${settingsNavigationTarget}-section`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.classList.add('highlight');
        highlightedEl = element;
        highlightTimer = setTimeout(() => {
          element.classList.remove('highlight');
          highlightedEl = null;
          navigateToSettings(null);
        }, 3000);
      }
    }, 150);
    return () => {
      clearTimeout(scrollTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      // The DOM persists across panel hides (<Activity>), so a highlight
      // interrupted mid-animation must be removed here, not just its timer.
      highlightedEl?.classList.remove('highlight');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsNavigationTarget, navigateToSettings, isSimpleMode]);

  const handleModeToggle = () => {
    const newMode = isSimpleMode ? 'advanced' : 'basic';
    setUIMode(newMode);
    trackEvent('settings_mode_switched', {
      from_mode: uiMode,
      to_mode: newMode,
      during_session: isSessionActive,
    });
  };

  const modeToggle = (
    <div className="mode-toggle">
      <button
        className={`mode-button ${isSimpleMode ? 'active' : ''}`}
        onClick={() => !isSimpleMode && handleModeToggle()}
        title={t('settings.simpleMode', 'Quick')}
        aria-label={t('settings.simple', 'Quick')}
      >
        <LayoutGrid size={14} />
        <span>{t('settings.simple', 'Quick')}</span>
      </button>
      <button
        className={`mode-button ${!isSimpleMode ? 'active' : ''}`}
        onClick={() => isSimpleMode && handleModeToggle()}
        title={t('settings.advancedMode', 'Advanced')}
        aria-label={t('settings.advanced', 'Advanced')}
      >
        <Sliders size={14} />
        <span>{t('settings.advanced', 'Advanced')}</span>
      </button>
    </div>
  );

  return (
    <div className="settings-container">
      <PanelBar
        tabs={isSimpleMode ? undefined : TABS}
        activeTab={isSimpleMode ? undefined : activeTab}
        onTabChange={isSimpleMode ? undefined : setActiveTab}
        actions={modeToggle}
        onClose={toggleSettings ?? (() => {})}
      />

      <div className="settings-body">
        {isSimpleMode ? (
          <SimpleSettings highlightSection={highlightSection || settingsNavigationTarget} />
        ) : (
          <AdvancedSettings toggleSettings={toggleSettings} activeTab={activeTab} />
        )}
      </div>
    </div>
  );
};

export default Settings;
