import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppSession } from '../../app/session';
import type { NoticeEntry } from '../../lib/view/filter';
import { actionLabel } from '../../lib/view/noticeActions';
import { noticeActionSpec, panelNoteEntries } from '../../lib/view/panelNotes';
import { usePanelNotes } from '../../stores/panelNotesStore';
import { useExitSubtitleMode, useNavigateToSettings } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
import { useConversationExporter } from '../Conversation/useConversationExporter';
import { useReadable } from '../Conversation/useReadable';
import type { NoticeAction } from '../Conversation/SystemRow';
import { SubtitleView, type SubtitleControls } from './SubtitleView';
import { TakeoverStatusLine } from './TakeoverStatusLine';

/**
 * The Electron subtitle takeover over the app's session (roadmap 1d-2 → 1e):
 * the root's view, karaoke and subtitle session, the runner's controls, and
 * the conversation's export. `MainLayout` mounts it in place of the main
 * layout while subtitle mode is on (plan 1e-3b-2); MainPanel stays mounted
 * behind it, so the Space key keeps working.
 */
export function SubtitleTakeover() {
  const { t } = useTranslation();
  const session = getAppSession();
  const viewState = useReadable(session.view);
  const { lit } = useReadable(session.karaoke);
  const sessionState = useReadable(session.subtitle);
  const exporter = useConversationExporter(viewState);
  const notes = usePanelNotes();
  const exitSubtitleMode = useExitSubtitleMode();
  const navigateToSettings = useNavigateToSettings();
  // Leave subtitle mode first, so the main window is back before Settings scrolls (today's `handleFix`).
  const openSettings = useCallback((target: string) => {
    void exitSubtitleMode();
    navigateToSettings(target);
  }, [exitSubtitleMode, navigateToSettings]);
  const controls = useMemo<SubtitleControls>(() => ({
    // `SubtitleIdle`'s ready/ended button carries no `disabled` of its own:
    // `session.start` is the one start every surface calls (ruling 11) — a
    // click before the selected provider's entry has loaded must not reach
    // the runner at all, or it is refused as `no_provider`.
    start: () => void session.start(),
    stop: () => void session.runner.stop(),
    press: () => session.runner.press(),
    release: () => session.runner.release(),
    clear: () => session.runner.clear(),
    exit: () => void exitSubtitleMode(),
    openSettings,
  }), [session, exitSubtitleMode, openSettings]);
  // The expanded list's actions (Ruling 8): what this window can honour — Settings, leaving
  // subtitle mode first, and a note's Show in folder. The others belong to the title bar,
  // which the takeover hides (as `TakeoverStatusLine`). Rebuilt whenever the notes change,
  // which drops the list's per-notice cache with it.
  const noticeAction = useCallback((notice: NoticeEntry): NoticeAction | null => {
    const spec = noticeActionSpec(notice, notes);
    if (spec?.kind !== 'settings' && spec?.kind !== 'show-in-folder') return null;
    const { key, fallback } = actionLabel(spec);
    const run = spec.kind === 'settings'
      ? () => openSettings(spec.target)
      : () => { if (isElectron()) void window.electron.invoke('open-directory', spec.dir); };
    return { label: t(key, fallback), run };
  }, [t, notes, openSettings]);
  return (
    <SubtitleView
      surface="electron"
      model={{ entries: viewState.entries, lit, session: sessionState, notes: panelNoteEntries(notes) }}
      controls={controls} exporter={exporter} statusLine={<TakeoverStatusLine />} noticeAction={noticeAction}
    />
  );
}
