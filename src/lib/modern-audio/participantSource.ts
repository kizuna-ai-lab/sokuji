import type { AudioDevice } from '../../stores/audioStore';

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
