import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import './Banner.scss';

export interface BannerProps {
  /** Stable per condition (`'audio-system'`, `'update'`). */
  id: string;
  /** `attention`: the user has to fix something (amber). `brand`: good news with an optional action (the brand green). */
  tone: 'attention' | 'brand';
  icon: ReactNode;
  text: ReactNode;
  action?: { label: string; icon?: ReactNode; onClick(): void; busy?: boolean };
  /** 0–100: a progress bar after the text. */
  progress?: number;
  onDismiss?(): void;
  dismissLabel: string;
}

/**
 * The one app-level banner (spec 2026-10-05 §4): an environment condition
 * unrelated to the session, drawn at the top of the panel. Today's
 * AudioSystemBanner geometry; the text is never a button — the action is.
 * Every line of words is an element of its own (a plain string is wrapped,
 * the action's label too): the stylesheet centres a line by trimming its box,
 * which cannot reach bare text inside a flex container.
 */
export function Banner({ tone, icon, text, action, progress, onDismiss, dismissLabel }: BannerProps) {
  return (
    <div className={`banner banner--${tone}`}>
      <div className="banner__content">
        {icon}
        <div className="banner__text">{typeof text === 'string' ? <span>{text}</span> : text}</div>
        {progress !== undefined && (
          <div className="banner__progress"><div className="banner__progress-fill" style={{ width: `${progress}%` }} /></div>
        )}
      </div>
      <div className="banner__actions">
        {action && (
          <button type="button" className="banner__btn" onClick={action.onClick} disabled={action.busy}>
            {action.icon}<span className="banner__btn-label">{action.label}</span>
          </button>
        )}
        {onDismiss && (
          <button type="button" className="banner__dismiss" onClick={onDismiss} aria-label={dismissLabel}><X size={12} /></button>
        )}
      </div>
    </div>
  );
}
