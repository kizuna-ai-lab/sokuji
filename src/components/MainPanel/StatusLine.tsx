// src/components/MainPanel/StatusLine.tsx
import { useTranslation } from 'react-i18next';
import { Captions, CircleAlert, KeyRound, MicOff, RefreshCw, TriangleAlert, Wallet, X } from 'lucide-react';
import { actionLabel, type NoticeActionSpec } from '../../lib/view/noticeActions';
import { ECHO_WORDS } from '../../lib/view/echoWords';
import { noticeText } from '../../lib/view/noticeText';
import type { StatusEntry, StatusIcon, StatusWords } from '../../lib/view/statusLine';

const ICON: Record<StatusIcon, typeof MicOff> = {
  'mic-off': MicOff, 'key-round': KeyRound, wallet: Wallet, 'refresh-cw': RefreshCw,
  'triangle-alert': TriangleAlert, captions: Captions, 'circle-alert': CircleAlert,
};

export interface StatusLineProps {
  entry: StatusEntry;
  onAction(spec: NoticeActionSpec): void;
  onDismiss(what: 'echo' | 'subtitle-entry'): void;
}

/**
 * The one line above the control footer (spec 2026-10-05 §3, P1): why the
 * user cannot start, or what is wrong now, with the fix on the right. The
 * same in both modes; it wraps rather than truncates. A line has an action
 * or a dismiss, never both.
 */
export function StatusLine({ entry, onAction, onDismiss }: StatusLineProps) {
  const { t } = useTranslation();
  const Icon = ICON[entry.icon];
  const words = wordsOf(entry.words, t);
  const action = entry.action;
  const label = action ? actionLabel(action) : null;
  return (
    <div className="status-line" role="status" data-status={entry.key}>
      <Icon size={14} aria-hidden="true" />
      <span className="status-line__text">{words}</span>
      {action && label && (
        <button type="button" className="status-line__action" onClick={() => onAction(action)}>
          {t(label.key, label.fallback)}
        </button>
      )}
      {!action && entry.dismiss && (
        <button type="button" className="status-line__dismiss" aria-label={t('common.dismiss', 'Dismiss')} onClick={() => onDismiss(entry.dismiss!)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function wordsOf(words: StatusWords, t: ReturnType<typeof useTranslation>['t']): string {
  switch (words.kind) {
    case 'notice': return noticeText(t, { code: words.code || undefined, params: words.params, message: words.message });
    case 'key': return t(words.key, words.fallback);
    case 'echo': {
      const w = ECHO_WORDS[words.cause];
      return `${t(w.message, w.fallback)} ${t(w.action, w.actionFallback)}`;
    }
  }
}
