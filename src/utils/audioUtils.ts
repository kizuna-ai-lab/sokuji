/**
 * Audio utilities: passthrough audibility policy.
 *
 * Decides when the raw-mic passthrough may be heard on the outputs. The old
 * device-name feedback heuristics that used to live here were removed in favor
 * of signal-based echo detection (see src/lib/modern-audio/echoDetector.ts).
 */

/**
 * Decide whether the raw-mic passthrough should currently be audible to the
 * outputs (local monitor, virtual mic, meeting tab).
 *
 * Mute is a "soft mute": the recorder keeps running and only the AI-bound tap is
 * gated per-frame. The passthrough path is a *separate* output, so it must honor
 * mute here independently — otherwise a muted mic still leaks the user's voice to
 * participants. This is most visible in Push-to-Translate, where passthrough is
 * auto-enabled at full volume while idle.
 *
 * Rules:
 * - Muted always wins → no passthrough (voice must not leave the machine).
 * - Push-to-Translate → on while idle, off while the user holds the key (recording).
 * - Other modes → follow the user's legacy passthrough toggle.
 */
export const isPassthroughActive = ({
  mode,
  isRecording,
  isMicMuted,
  legacyPassthroughEnabled,
}: {
  mode: string;
  isRecording: boolean;
  isMicMuted: boolean;
  legacyPassthroughEnabled: boolean;
}): boolean => {
  if (isMicMuted) {
    return false;
  }
  if (mode === 'Push-to-Translate') {
    return !isRecording;
  }
  return legacyPassthroughEnabled;
};
