/**
 * How to present the capture helper's `silent_no_permission` warning.
 *
 * The helper raises it when the target is "running output" yet every sample
 * is zero. That is what a macOS TCC denial looks like — the tap is created
 * fine and delivers silence — but it is also what a quiet source with an open
 * output stream looks like: a meeting between utterances, a browser tab with a
 * paused player. Nothing in the signal tells the two apart (#492).
 *
 * What does tell them apart is history. Until a tap has ever delivered
 * audible audio on this machine, the denial reading is the useful one — on a
 * first attempt macOS silently adds the app to the "System Audio Recording
 * Only" list, switched off, and nothing else will tell the user. Once a tap has
 * proven the permission works, later silence is a quiet source, and a modal
 * that says "permission needed" is simply wrong.
 */
export type SilentNoPermissionPresentation = 'modal' | 'notice';

export function silentNoPermissionPresentation(
  { tapAudioSeen }: { tapAudioSeen: boolean }
): SilentNoPermissionPresentation {
  return tapAudioSeen ? 'notice' : 'modal';
}
