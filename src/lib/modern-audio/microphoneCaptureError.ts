import { isElectron } from '../../utils/environment';
import { describeCause } from '../diagnostics/describeCause';

/** The DOMException kind, when the caught value carries one. */
function kindOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null) {
    const name = (cause as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/**
 * One sentence a user can act on for a failed microphone capture, keyed on the
 * DOMException kind getUserMedia rejects with. The kind stays in the text so a
 * pasted LogsPanel line still says which one it was.
 *
 * The permission case matters most: in Electron there is no per-site prompt,
 * so a NotAllowedError means the OS itself said no -- and on macOS it can say
 * no without ever having asked (#458), so the only fix is the privacy pane.
 */
export function describeMicrophoneFailure(cause: unknown): string {
  const kind = kindOf(cause);
  switch (kind) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return isElectron()
        ? `Microphone access is blocked (${kind}). Allow Sokuji to use the microphone in your system's privacy settings (macOS: System Settings › Privacy & Security › Microphone), then start again.`
        : `Microphone access is blocked (${kind}). Allow the microphone for Sokuji in your browser's site permissions, then start again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `The selected microphone is no longer available (${kind}). Choose another input device and start again.`;
    case 'NotReadableError':
    case 'AbortError':
      return `The microphone could not be opened (${kind}); it may be in use by another application.`;
    default:
      return `Could not start the microphone: ${describeCause(cause)}`;
  }
}

/**
 * Thrown by `ModernAudioRecorder.begin()` when capture cannot start. The
 * original rejection rides along as `cause` for the console; the message is
 * what reaches the user through the session-start failure path.
 */
export class MicrophoneCaptureError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(describeMicrophoneFailure(cause));
    this.name = 'MicrophoneCaptureError';
    this.cause = cause;
  }
}
