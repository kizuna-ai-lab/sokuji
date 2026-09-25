import { useMemo } from 'react';
import { getAppSession } from '../../app/session';
import { useExitSubtitleMode, useNavigateToSettings } from '../../stores/settingsStore';
import { useConversationExporter } from '../Conversation/useConversationExporter';
import { useReadable } from '../Conversation/useReadable';
import { SubtitleView, type SubtitleControls } from './SubtitleView';

/**
 * The Electron subtitle takeover over the app's session (roadmap 1d-2 → 1e):
 * the root's view, karaoke and subtitle session, the runner's controls, and
 * the conversation's export. `MainLayout` mounts it in place of the main
 * layout while subtitle mode is on (plan 1e-3b-2); MainPanel stays mounted
 * behind it, so the Space key keeps working.
 */
export function SubtitleTakeover() {
  const session = getAppSession();
  const viewState = useReadable(session.view);
  const { lit } = useReadable(session.karaoke);
  const sessionState = useReadable(session.subtitle);
  const exporter = useConversationExporter(viewState);
  const exitSubtitleMode = useExitSubtitleMode();
  const navigateToSettings = useNavigateToSettings();
  const controls = useMemo<SubtitleControls>(() => ({
    start: () => void session.runner.start(),
    stop: () => void session.runner.stop(),
    press: () => session.runner.press(),
    release: () => session.runner.release(),
    clear: () => session.runner.clear(),
    exit: () => void exitSubtitleMode(),
    // Leave subtitle mode first, so the main window is back before Settings scrolls (today's `handleFix`).
    openSettings: (target) => {
      void exitSubtitleMode();
      navigateToSettings(target);
    },
  }), [session, exitSubtitleMode, navigateToSettings]);
  return <SubtitleView surface="electron" model={{ entries: viewState.entries, lit, session: sessionState }} controls={controls} exporter={exporter} />;
}
