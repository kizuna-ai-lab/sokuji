import type { AudioDevice } from '../../stores/audioStore';
import { isLoopbackPlatform, isMacOS } from '../../utils/environment';

/** Whole-system capture - the participant source used when nothing else is chosen. */
export const SYSTEM_PARTICIPANT_SOURCE_ID = 'desktop-audio-loopback';

/**
 * Resolve the participant source id from a stored device selection, the way
 * the old `ModernBrowserAudioService.connectSystemAudioSource()` did
 * (deleted in plan 1e-3c).
 *
 * Falls back to whole-system capture rather than throwing, so a session still
 * starts when the previously selected application has quit.
 */
export function resolveParticipantSourceId(
  selected: AudioDevice | null | undefined
): string {
  return selected?.deviceId || SYSTEM_PARTICIPANT_SOURCE_ID;
}

/**
 * True when the id names one application rather than the whole system.
 *
 * Callers use this to skip the whole-system loopback acquisition entirely.
 * That path asks for a getDisplayMedia stream - which on macOS requires Screen
 * Recording permission - and per-application capture needs neither: it runs
 * through the capture helper on Windows and macOS, and through a PipeWire link
 * on Linux.
 */
export function isApplicationSource(deviceId: string | null | undefined): boolean {
  return typeof deviceId === 'string' && deviceId.startsWith('app:');
}

/**
 * Whether starting this participant source needs a whole-system getDisplayMedia
 * stream, which on macOS additionally demands Screen Recording.
 *
 * Per-application capture never does. Neither does whole-system capture on
 * macOS any more: it runs through a global Core Audio tap, so the whole feature
 * needs one permission there ("System Audio Recording Only") instead of two.
 */
export function needsLoopbackStream(deviceId: string | null | undefined): boolean {
  if (!isLoopbackPlatform()) return false;
  if (isApplicationSource(deviceId)) return false;
  if (isMacOS()) return false;
  return true;
}

/**
 * Whether Other's translation, read aloud on the real device, is actually
 * heard rather than recaptured and translated again as Other (1e-3b-2 ruling
 * 7, completed): on Electron, a whole-system participant capture hears the
 * real device too — Sokuji's own output included — so it is heard only off
 * Electron, or on Electron while the chosen source is one application. The
 * one predicate the participant-speech switch, the run's shape
 * (`appShape.ts`'s `readShapeFromStores`), the playback route (`appAudio.ts`'s
 * `readRouting`) and the replay slot (`MainPanel.tsx`'s `replayLegs`) all
 * share, so what the switch shows is what the run does.
 */
export function participantSpeechHeard(platform: string, participantSourceId: string | null | undefined): boolean {
  return platform !== 'electron' || isApplicationSource(participantSourceId);
}
