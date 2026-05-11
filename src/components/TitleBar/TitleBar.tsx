// src/components/TitleBar/TitleBar.tsx
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Settings, Terminal } from 'lucide-react';
import { isElectron, isMacOS } from '../../utils/environment';
import SubtitleEnterButton from '../Subtitle/SubtitleEnterButton';
import './TitleBar.scss';

interface TitleBarProps {
  showSettings: boolean;
  showLogs: boolean;
  onToggleSettings: () => void;
  onToggleLogs: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({
  showSettings,
  showLogs,
  onToggleSettings,
  onToggleLogs,
}) => {
  const { t } = useTranslation();

  const minimize = useCallback(() => {
    void window.electron?.invoke('window:minimize');
  }, []);
  const maximizeToggle = useCallback(() => {
    void window.electron?.invoke('window:maximize-toggle');
  }, []);
  const close = useCallback(() => {
    void window.electron?.invoke('window:close');
  }, []);

  const settingsLabel = t('settings.title', 'Settings');
  const logsLabel = t('common.logs', 'Logs');
  const minimizeLabel = t('titleBar.minimize', 'Minimize');
  const maximizeLabel = t('titleBar.maximize', 'Maximize');
  const closeLabel = t('titleBar.close', 'Close');

  // Only Electron Win/Linux render the in-app min/max/close buttons. On
  // macOS the OS draws traffic-light buttons (titleBarStyle: hiddenInset),
  // and the browser extension lives inside the browser chrome which already
  // provides window controls.
  const showInAppWindowControls = isElectron() && !isMacOS();
  // macOS-specific left padding (to clear the OS traffic-light area) only
  // applies inside Electron on macOS — the extension's macOS context has
  // no traffic-light cutout.
  const platformClass = isElectron() && isMacOS() ? 'platform-darwin' : 'platform-other';

  return (
    <div
      className={`title-bar ${platformClass}${showInAppWindowControls ? ' has-window-controls' : ''}`}
      role="banner"
    >
      <span className="title-bar__title">Sokuji</span>
      <div className="title-bar__actions">
        <SubtitleEnterButton />
        <button
          type="button"
          // Keep the legacy `settings-button` class so onboarding's
          // `.settings-button` step target keeps matching after the
          // button moved from main-panel-header into the TitleBar.
          className={`title-bar__action settings-button ${showSettings ? 'is-active' : ''}`}
          onClick={onToggleSettings}
          title={settingsLabel}
          aria-label={settingsLabel}
        >
          <Settings size={14} />
          <span className="title-bar__action-label">{settingsLabel}</span>
        </button>
        <button
          type="button"
          // Keep the legacy `logs-button` class for the same reason as
          // settings-button above — preserves any selector consumers.
          className={`title-bar__action logs-button ${showLogs ? 'is-active' : ''}`}
          onClick={onToggleLogs}
          title={logsLabel}
          aria-label={logsLabel}
        >
          <Terminal size={14} />
          <span className="title-bar__action-label">{logsLabel}</span>
        </button>
      </div>
      {showInAppWindowControls && (
        <div className="title-bar__buttons">
          <button
            type="button"
            className="title-bar__btn title-bar__minimize"
            aria-label={minimizeLabel}
            title={minimizeLabel}
            onClick={minimize}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="title-bar__btn title-bar__maximize"
            aria-label={maximizeLabel}
            title={maximizeLabel}
            onClick={maximizeToggle}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Square size={12} />
          </button>
          <button
            type="button"
            className="title-bar__btn title-bar__close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={close}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default TitleBar;
