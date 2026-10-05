import { useCallback } from 'react';
import { getAppSession } from '../../app/session';
import { useRunState } from '../../app/useRun';
import type { NoticeActionSpec } from '../../lib/view/noticeActions';
import { useExitSubtitleMode, useNavigateToSettings } from '../../stores/settingsStore';
import { useSetSubtitleEntryHint } from '../../stores/subtitleStore';
import { useReadable } from '../Conversation/useReadable';
import { StatusLine } from '../MainPanel/StatusLine';
import { useStatusLine } from '../MainPanel/useStatusLine';

/**
 * The status line in the Electron takeover (spec 2026-10-05 §7): the same
 * selector as MainPanel's, without the echo (the takeover watches no
 * capture). Of the actions, Settings is the one this window can honour; the
 * others belong to the title bar, which the takeover hides. Settings leaves
 * subtitle mode first, as the takeover's own `openSettings` does, so the main
 * window is back before the section scrolls.
 */
export function TakeoverStatusLine() {
  const run = useRunState();
  const subtitle = useReadable(getAppSession().subtitle);
  const exitSubtitleMode = useExitSubtitleMode();
  const navigateToSettings = useNavigateToSettings();
  const setEntryHint = useSetSubtitleEntryHint();
  const entry = useStatusLine({ run, idle: subtitle.idle, canStart: subtitle.canStart, dismissedEnd: null, echo: null });
  const onAction = useCallback((spec: NoticeActionSpec) => {
    if (spec.kind !== 'settings') return;
    void exitSubtitleMode();
    navigateToSettings(spec.target);
  }, [exitSubtitleMode, navigateToSettings]);
  const onDismiss = useCallback(() => setEntryHint(null), [setEntryHint]);
  if (!entry) return null;
  return <StatusLine entry={entry} onAction={onAction} onDismiss={onDismiss} />;
}
