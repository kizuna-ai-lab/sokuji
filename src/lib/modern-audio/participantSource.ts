import type { AudioDevice } from '../../stores/audioStore';
import { isLoopbackPlatform, isMacOS } from '../../utils/environment';

/** Whole-system capture - the participant source used when nothing else is chosen. */
export const SYSTEM_PARTICIPANT_SOURCE_ID = 'desktop-audio-loopback';

/**
 * Resolve the participant source id to hand to
 * ModernBrowserAudioService.connectSystemAudioSource().
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
