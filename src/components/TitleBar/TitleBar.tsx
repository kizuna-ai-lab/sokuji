// src/components/TitleBar/TitleBar.tsx
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Settings, Terminal } from 'lucide-react';
import { isElectron, isMacOS } from '../../utils/environment';
import SubtitleEnterButton from '../Subtitle/SubtitleEnterButton';
import AccountButton from './AccountButton';
import HistoryButton from './HistoryButton';
import { nextFit, overflowOf, type Fit } from './titleBarFit';
import './TitleBar.scss';

interface TitleBarProps {
  showSettings: boolean;
  showLogs: boolean;
  // Logs live behind advanced mode. Removing the button from basic mode is
  // what pays for the account slot: measured, Electron Win/Linux goes from
  // "safe only above 685px" to "safe above 335px".
  showLogsButton: boolean;
  onToggleSettings: () => void;
  onToggleLogs: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({
  showSettings,
  showLogs,
  showLogsButton,
  onToggleSettings,
  onToggleLogs,
}) => {
  const { t, i18n } = useTranslation();

  // How much the bar spells out: everything while it fits, then who pays as an icon, then icons alone (owner,
  // 2026-11-17; titleBarFit.ts). Checked after each change of step, before the screen is painted, and whenever the bar
  // or its actions change size.
  const barRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<Fit>({ level: 0, needed: [] });
  const [fitLevel, setFitLevel] = useState(0);
  // Bumped to measure from everything again: what each step needed is not known any more.
  const [measureTurn, setMeasureTurn] = useState(0);
  const checkFit = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const next = nextFit(fitRef.current, overflowOf(bar), bar.clientWidth);
    fitRef.current = next;
    if (next.level !== fitLevel) setFitLevel(next.level);
  }, [fitLevel]);
  useLayoutEffect(() => { checkFit(); }, [checkFit, measureTurn]);
  const remeasure = useCallback(() => {
    fitRef.current = { level: 0, needed: [] };
    setFitLevel(0);
    setMeasureTurn((n) => n + 1);
  }, []);
  // Another language words everything anew (its first value is no change).
  const language = i18n?.language;
  const shownLanguage = useRef(language);
  useLayoutEffect(() => {
    if (shownLanguage.current === language) return;
    shownLanguage.current = language;
    remeasure();
  }, [language, remeasure]);
  // So does a change in what the bar holds (review): the logs button coming or going, who pays, the balance. Without
  // it a bar that fits again would stay on icons until the window was widened past what it needed before.
  useEffect(() => {
    const actions = barRef.current?.querySelector('.title-bar__actions');
    if (!actions || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => remeasure());
    observer.observe(actions, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [remeasure]);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => checkFit());
    observer.observe(bar);
    const actions = bar.querySelector('.title-bar__actions');
    if (actions) observer.observe(actions);
    return () => observer.disconnect();
  }, [checkFit]);

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
      ref={barRef}
      className={`title-bar ${platformClass}${showInAppWindowControls ? ' has-window-controls' : ''}`}
      role="banner"
      data-fit={fitLevel}
    >
      <span className="title-bar__title">Sokuji</span>
      <div className="title-bar__actions">
        <AccountButton />
        <SubtitleEnterButton />
        <HistoryButton />
        <button
          type="button"
          data-tour="settings-button"
          className={`title-bar__action ${showSettings ? 'is-active' : ''}`}
          onClick={onToggleSettings}
          title={settingsLabel}
          aria-label={settingsLabel}
        >
          <Settings size={14} />
          <span className="title-bar__action-label">{settingsLabel}</span>
        </button>
        {showLogsButton && (
          <button
            type="button"
            // Keep the legacy `logs-button` class: TitleBar.test.tsx selects
            // the advanced-mode toggle by it.
            className={`title-bar__action logs-button ${showLogs ? 'is-active' : ''}`}
            onClick={onToggleLogs}
            title={logsLabel}
            aria-label={logsLabel}
          >
            <Terminal size={14} />
            <span className="title-bar__action-label">{logsLabel}</span>
          </button>
        )}
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
