// src/components/Subtitle/SubtitleIdle.tsx
//
// What the subtitle window shows while no session is running. Replaces the
// old SubtitleSessionEnded, which only handled the post-session case — the
// window can now be opened before a session exists (issue #324).
//
// Purely presentational: state in, callbacks out. All store access lives in
// SubtitleView.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw, Loader, AlertTriangle } from 'lucide-react';
import type { SubtitleIdleState } from './subtitleIdleState';

interface Props {
  state: SubtitleIdleState;
  onStart: () => void;
  onReturn: () => void;
  // The extension-overlay surface doesn't mirror the start-gate fields or the
  // start/stop request counters, so start/retry would be dead clicks there.
  // When false, this renders only what the pre-#324 SubtitleSessionEnded
  // component rendered: the ended message and a return button.
  allowSessionControl: boolean;
  // Whether the start gate is currently open. `state.kind === 'failed'` only
  // means a fresh start-failure item exists — the gate can independently be
  // closed again by then (e.g. the mic was unplugged after the failure, or
  // the gate is closed with no reason while models are still loading).
  // Retry must not be clickable in that case, since it would just re-express
  // a start the gate already refuses.
  canStart: boolean;
  /** The `unready` state's fix action, at its `target` (plan 1e-3b-1 ruling 13). */
  onOpenSettings?: (target: string) => void;
}

const SubtitleIdle: React.FC<Props> = ({ state, onStart, onReturn, allowSessionControl, canStart, onOpenSettings }) => {
  const { t } = useTranslation();

  if (!allowSessionControl) {
    return (
      <div className="subtitle-idle">
        <p className="subtitle-idle__message">{t('subtitle.sessionEnded', 'Session ended')}</p>
        <button type="button" className="subtitle-idle__return" onClick={onReturn}>
          {t('subtitle.backToMain', 'Return to main window')}
        </button>
      </div>
    );
  }

  if (state.kind === 'starting') {
    const label = state.total !== undefined && state.completed !== undefined
      ? t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', {
          completed: state.completed, total: state.total,
        })
      : t('simplePanel.connecting', 'Connecting...');
    return (
      <div className="subtitle-idle">
        <button type="button" className="subtitle-idle__action" disabled>
          <Loader size={16} className="spinning" />
          <span>{label}</span>
        </button>
      </div>
    );
  }

  if (state.kind === 'unready') {
    // The provider's own reason as the label. The fix action's destination
    // comes from the readiness code (plan 1e-3b-1 ruling 13); no destination
    // means the action is inert.
    const label = state.message.replace(/[.。！!]+$/, '');
    return (
      <div className="subtitle-idle">
        <button
          type="button"
          className="subtitle-idle__action subtitle-idle__action--fix"
          disabled={!state.target || !onOpenSettings}
          onClick={() => { if (state.target) onOpenSettings?.(state.target); }}
        >
          <AlertTriangle size={15} />
          <span>{label}</span>
        </button>
        <button type="button" className="subtitle-idle__link" onClick={onReturn}>
          {t('subtitle.backToMain', 'Return to main window')}
        </button>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="subtitle-idle">
        {/* Single truncated line: the window is user-resizable to arbitrary
            heights, so the body keeps a fixed row structure. The full text is
            one click away in the main window's conversation — the same item. */}
        <p className="subtitle-idle__error" title={state.message}>
          {t('subtitle.idle.failed', 'Failed to start: {{message}}', { message: state.message })}
        </p>
        <div className="subtitle-idle__row">
          <button
            type="button"
            className="subtitle-idle__action"
            disabled={!canStart}
            onClick={onStart}
          >
            <RotateCcw size={15} />
            <span>{t('subtitle.idle.retry', 'Retry')}</span>
          </button>
          <button type="button" className="subtitle-idle__link" onClick={onReturn}>
            {t('subtitle.idle.backForDetails', 'Return to main window for details')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="subtitle-idle">
      <button type="button" className="subtitle-idle__action" onClick={onStart}>
        <Play size={15} />
        <span>{t('subtitle.idle.start', 'Start translating')}</span>
      </button>
      <p className="subtitle-idle__hint">
        {state.kind === 'ended'
          ? t('subtitle.idle.ended', 'This session has ended')
          : t('subtitle.idle.hint', 'Position and size the window before you start')}
      </p>
      <button type="button" className="subtitle-idle__link" onClick={onReturn}>
        {t('subtitle.backToMain', 'Return to main window')}
      </button>
    </div>
  );
};

export default SubtitleIdle;
