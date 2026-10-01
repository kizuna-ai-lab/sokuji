// src/components/Subtitle/subtitleEnterGate.ts
import { isElectron } from '../../utils/environment';

/**
 * Whether subtitle mode can be entered right now.
 *
 * The Electron subtitle window carries its own Start/Stop control, so it can
 * be opened at any time — users position and size it before the meeting
 * (issue #324). The extension overlay is read-only for the run: it sends its
 * hold, Clear and exit back over its wire but cannot start or stop one (plan
 * 1d-2 ruling 5; plan 1e-4 rulings 2–3). So it opens only while a run is
 * live — an overlay opened idle would be a window with nothing to do.
 *
 * Shared by SubtitleEnterButton (UI gating) and settingsStore.enterSubtitleMode
 * (the actual guard) so the two can never drift — see issue where the button
 * was ungated but the store still refused entry.
 */
export function canEnterSubtitleMode(isSessionActive: boolean): boolean {
  return isElectron() || isSessionActive;
}
