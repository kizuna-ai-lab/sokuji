// src/components/TitleBar/TitleBar.tsx
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Settings, Terminal } from 'lucide-react';
import { isMacOS } from '../../utils/environment';
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

  const actions = (
    <div className="title-bar__actions">
      <SubtitleEnterButton />
      <button
        type="button"
        className={`title-bar__action ${showSettings ? 'is-active' : ''}`}
        onClick={onToggleSettings}
        title={settingsLabel}
        aria-label={settingsLabel}
      >
        <Settings size={14} />
        <span className="title-bar__action-label">{settingsLabel}</span>
      </button>
      <button
        type="button"
        className={`title-bar__action ${showLogs ? 'is-active' : ''}`}
        onClick={onToggleLogs}
        title={logsLabel}
        aria-label={logsLabel}
      >
        <Terminal size={14} />
        <span className="title-bar__action-label">{logsLabel}</span>
      </button>
    </div>
  );

  if (isMacOS()) {
    // macOS: traffic-light buttons drawn by the OS via titleBarStyle: 'hiddenInset'.
    // Title on the left, action buttons pushed to the right.
    return (
      <div className="title-bar platform-darwin" role="banner">
        <span className="title-bar__title">Sokuji</span>
        {actions}
      </div>
    );
  }

  return (
    <div className="title-bar platform-other" role="banner">
      <span className="title-bar__title">Sokuji</span>
      {actions}
      <div className="title-bar__buttons">
        <button
          type="button"
          className="title-bar__btn title-bar__minimize"
          aria-label="Minimize"
          onClick={minimize}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="title-bar__btn title-bar__maximize"
          aria-label="Maximize"
          onClick={maximizeToggle}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          className="title-bar__btn title-bar__close"
          aria-label="Close"
          onClick={close}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
