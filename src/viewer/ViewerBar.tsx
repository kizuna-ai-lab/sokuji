// src/viewer/ViewerBar.tsx
/** The top bar on tablets and desktops; on phones, the status line and the bottom dock. */
import React from 'react';
import type { ViewerStatus } from './model';
import type { T } from './strings';

export const STATUS_KEYS: Record<ViewerStatus, string> = {
  waiting: 'viewer.status.waiting',
  live: 'viewer.status.live',
  paused: 'viewer.status.paused',
  reconnecting: 'viewer.status.reconnecting',
  ended: 'viewer.status.ended',
};

export const StatusText: React.FC<{ t: T; status: ViewerStatus }> = ({ t, status }) => (
  <span className={`viewer-status viewer-status--${status}`}>
    <i aria-hidden="true" />
    {t(STATUS_KEYS[status])}
  </span>
);

export const Legend: React.FC<{ t: T }> = ({ t }) => (
  <span className="viewer-legend">
    <span className="viewer-legend__item viewer-legend__item--speaker">{t('viewer.legend.onSite')}</span>
    <span className="viewer-legend__item viewer-legend__item--participant">{t('viewer.legend.remote')}</span>
  </span>
);

interface TopBarProps {
  t: T;
  status: ViewerStatus;
  legend: boolean;
  choice: React.ReactNode;
  onSmaller(): void;
  onLarger(): void;
  onMore(): void;
}

export const TopBar: React.FC<TopBarProps> = ({ t, status, legend, choice, onSmaller, onLarger, onMore }) => (
  <header className="viewer-bar">
    <StatusText t={t} status={status} />
    <span className="viewer-bar__title">{t('viewer.title')}</span>
    {legend && <Legend t={t} />}
    <span className="viewer-bar__grow" />
    {choice}
    <button type="button" className="viewer-icon-btn" aria-label={`${t('viewer.dock.textSize')} −`} onClick={onSmaller}>A−</button>
    <button type="button" className="viewer-icon-btn" aria-label={`${t('viewer.dock.textSize')} +`} onClick={onLarger}>A+</button>
    <button type="button" className="viewer-icon-btn" aria-label={t('viewer.dock.more')} onClick={onMore}>⋯</button>
  </header>
);

interface DockProps { t: T; onView(): void; onTextSize(): void; onMore(): void }

export const Dock: React.FC<DockProps> = ({ t, onView, onTextSize, onMore }) => (
  <nav className="viewer-dock">
    <button type="button" onClick={onView}><b aria-hidden="true">文A</b><span>{t('viewer.dock.view')}</span></button>
    <button type="button" onClick={onTextSize}><b aria-hidden="true">Aa</b><span>{t('viewer.dock.textSize')}</span></button>
    <button type="button" onClick={onMore} aria-label={t('viewer.dock.more')}><b aria-hidden="true">⋯</b><span>{t('viewer.dock.more')}</span></button>
  </nav>
);
