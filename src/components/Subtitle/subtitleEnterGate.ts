// src/components/Subtitle/subtitleEnterGate.ts
import { isElectron } from '../../utils/environment';

/**
 * Whether subtitle mode can be entered right now.
 *
 * The Electron subtitle window carries its own Start/Stop control, so it can
 * be opened at any time — users position and size it before the meeting
 * (issue #324). The extension overlay has no such control: its stores are
 * mirrored from the side panel over a chrome.runtime port that does not
 * carry the start/stop plumbing, so it stays gated on an active session
 * (otherwise its controls would be dead clicks).
 *
 * Shared by SubtitleEnterButton (UI gating) and settingsStore.enterSubtitleMode
 * (the actual guard) so the two can never drift — see issue where the button
 * was ungated but the store still refused entry.
 */
export function canEnterSubtitleMode(isSessionActive: boolean): boolean {
  return isElectron() || isSessionActive;
}
