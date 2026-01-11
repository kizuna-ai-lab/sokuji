import React, { useState, useEffect } from 'react';
import { ArrowRight, Save, Check, AlertCircle, AlertTriangle, Info, LayoutGrid, Sliders } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIMode, useSetUIMode, useNavigateToSettings, useSettingsNavigationTarget } from '../../stores/settingsStore';
import { useIsSessionActive } from '../../stores/sessionStore';
import { useAnalytics } from '../../lib/analytics';
import SimpleSettings from './SimpleSettings/SimpleSettings';
import AdvancedSettings from './AdvancedSettings/AdvancedSettings';
import './Settings.scss';

interface SettingsProps {
  toggleSettings?: () => void;
  /** External highlight section prop */
  highlightSection?: string | null;
}

const Settings: React.FC<SettingsProps> = ({ toggleSettings, highlightSection }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const isSessionActive = useIsSessionActive();

  // UI mode from settings store
  const uiMode = useUIMode();
  const setUIMode = useSetUIMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  // Determine if we're in simple or advanced mode
  // 'basic' maps to Simple, 'advanced' maps to Advanced
  const isSimpleMode = uiMode === 'basic';

  const handleModeToggle = () => {
    const newMode = isSimpleMode ? 'advanced' : 'basic';
    setUIMode(newMode);
    trackEvent('settings_mode_switched', {
      from_mode: uiMode,
      to_mode: newMode,
      during_session: isSessionActive
    });
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>{t('settings.title')}</h2>
        <div className="header-actions">
          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button
              className={`mode-button ${isSimpleMode ? 'active' : ''}`}
              onClick={() => !isSimpleMode && handleModeToggle()}
              disabled={isSessionActive}
              title={t('settings.simpleMode', 'Simple')}
            >
              <LayoutGrid size={14} />
              <span>{t('settings.simple', 'Simple')}</span>
            </button>
            <button
              className={`mode-button ${!isSimpleMode ? 'active' : ''}`}
              onClick={() => isSimpleMode && handleModeToggle()}
              disabled={isSessionActive}
              title={t('settings.advancedMode', 'Advanced')}
            >
              <Sliders size={14} />
              <span>{t('settings.advanced', 'Advanced')}</span>
            </button>
          </div>

          {/* Close Button */}
          <button className="close-button" onClick={toggleSettings}>
            <ArrowRight size={16} />
            <span>{t('common.close')}</span>
          </button>
        </div>
      </div>

      <div className="settings-body">
        {isSimpleMode ? (
          <SimpleSettings highlightSection={highlightSection || settingsNavigationTarget} />
        ) : (
          <AdvancedSettings toggleSettings={toggleSettings} />
        )}
      </div>
    </div>
  );
};

export default Settings;
