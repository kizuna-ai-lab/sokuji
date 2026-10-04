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

interface TopBarProps {
  t: T;
  status: ViewerStatus;
  choice: React.ReactNode;
  onSmaller(): void;
  onLarger(): void;
  onMore(): void;
}

export const TopBar: React.FC<TopBarProps> = ({ t, status, choice, onSmaller, onLarger, onMore }) => (
  <header className="viewer-bar">
    <StatusText t={t} status={status} />
    <span className="viewer-bar__title">{t('viewer.title')}</span>
    <span className="viewer-bar__grow" />
    {choice}
    <button type="button" className="viewer-icon-btn" aria-label={`${t('viewer.dock.textSize')} −`} onClick={onSmaller}>A−</button>
    <button type="button" className="viewer-icon-btn" aria-label={`${t('viewer.dock.textSize')} +`} onClick={onLarger}>A+</button>
    <button type="button" className="viewer-icon-btn" aria-label={t('viewer.dock.more')} onClick={onMore}>⋯</button>
  </header>
);

/**
 * Phones: the status line, with the one button that opens the display
 * settings. No bottom dock (his ruling 2026-10-04): it repeated the sheet
 * twice and took two or three lines of captions.
 */
export const StatusLine: React.FC<{ t: T; status: ViewerStatus; onSettings(): void }> = ({ t, status, onSettings }) => (
  <header className="viewer-statusline">
    <StatusText t={t} status={status} />
    <button type="button" className="viewer-statusline__settings" onClick={onSettings}>
      <b aria-hidden="true">Aa</b>
      <span>{t('viewer.settings.title')}</span>
    </button>
  </header>
);
