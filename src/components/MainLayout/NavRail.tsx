import React, { useCallback, useState } from 'react';
import { ChevronRight, MessageSquare, Settings, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import gmLogoMark from '../../assets/logo-gm-mark.png';
import './NavRail.scss';

export type ShellView = 'session' | 'settings';

const EXPANDED_KEY = 'panelState.navRailExpanded';

interface NavRailProps {
  activeView: ShellView;
  logsOpen: boolean;
  onSelectSession: () => void;
  onToggleSettings: () => void;
  onToggleLogs: () => void;
}

const NavRail: React.FC<NavRailProps> = ({
  activeView,
  logsOpen,
  onSelectSession,
  onToggleSettings,
  onToggleLogs,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem(EXPANDED_KEY);
    return stored === null ? true : stored === 'true';
  });

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(EXPANDED_KEY, String(next));
      return next;
    });
  }, []);

  const sessionLabel = t('nav.session', 'Session');
  const settingsLabel = t('settings.title', 'Settings');
  const logsLabel = t('common.logs', 'Logs');
  const collapseLabel = t('nav.collapse', 'Collapse menu');
  const expandLabel = t('nav.expand', 'Expand menu');

  return (
    <aside
      className={`nav-rail ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label={t('nav.primary', 'Primary')}
    >
      <div className="nav-rail__brand">
        <div className="nav-rail__brand-mark" title="GM Solutions">
          <img src={gmLogoMark} alt="" width={28} height={28} />
        </div>
        {expanded && (
          <div className="nav-rail__brand-text">
            <p className="nav-rail__brand-name">MeetMind</p>
            <p className="nav-rail__brand-sub">GM Solutions</p>
          </div>
        )}
        <button
          type="button"
          className="nav-rail__toggle"
          onClick={toggleExpanded}
          title={expanded ? collapseLabel : expandLabel}
          aria-label={expanded ? collapseLabel : expandLabel}
          aria-expanded={expanded}
        >
          <ChevronRight
            size={16}
            strokeWidth={1.75}
            className={`nav-rail__toggle-icon ${expanded ? 'is-expanded' : ''}`}
          />
        </button>
      </div>

      <nav className="nav-rail__nav">
        <button
          type="button"
          className={`nav-rail__item ${activeView === 'session' ? 'is-active' : ''}`}
          onClick={onSelectSession}
          title={sessionLabel}
          aria-label={sessionLabel}
          aria-current={activeView === 'session' ? 'page' : undefined}
        >
          <MessageSquare size={20} strokeWidth={1.75} />
          {expanded && <span className="nav-rail__label">{sessionLabel}</span>}
        </button>
        <button
          type="button"
          className={`nav-rail__item settings-button ${activeView === 'settings' ? 'is-active' : ''}`}
          onClick={onToggleSettings}
          title={settingsLabel}
          aria-label={settingsLabel}
          aria-current={activeView === 'settings' ? 'page' : undefined}
        >
          <Settings size={20} strokeWidth={1.75} />
          {expanded && <span className="nav-rail__label">{settingsLabel}</span>}
        </button>
        <button
          type="button"
          className={`nav-rail__item logs-button ${logsOpen ? 'is-active' : ''}`}
          onClick={onToggleLogs}
          title={logsLabel}
          aria-label={logsLabel}
          aria-pressed={logsOpen}
        >
          <Terminal size={20} strokeWidth={1.75} />
          {expanded && <span className="nav-rail__label">{logsLabel}</span>}
        </button>
      </nav>
    </aside>
  );
};

export default NavRail;
