/**
 * Why the microphone would not open at Start, in words the user can act on —
 * Windows desktop only (spec 2026-10-13 §2).
 *
 * Chromium tells the cases apart by the DOMException: Windows' privacy switch
 * is a `NotAllowedError`, a device another application holds exclusively a
 * `NotReadableError`, and so is a driver that failed. Windows itself can say
 * which applications are using the device, so a `NotReadableError` asks it.
 */
import { MicrophoneCaptureError } from '../../modern-audio/microphoneCaptureError';
import { SourceOpenError } from '../../session/source';

/** Other applications are using the device: `params.device`, `params.apps`. */
export const MIC_IN_USE = 'mic_in_use';
/** The device would not open and no other application could be named: `params.device`. */
export const MIC_UNREADABLE = 'mic_unreadable';
/** Windows' privacy settings keep desktop apps off the microphone. */
export const MIC_BLOCKED = 'mic_blocked';

/** The applications using the device with this label right now, or null when that cannot be told. */
export type AppsUsing = (label: string) => Promise<string[] | null>;

/**
 * The failure to throw for a first open of `device` that failed with `error`:
 * a `SourceOpenError` with one of the codes above, or `error` itself when it
 * is not one of these cases. The message, which reaches the Logs panel and
 * analytics, keeps the DOMException's name and Chromium's words but never the
 * applications' names; those travel only in `params`, for the status line.
 */
export async function explainMicFailure(error: unknown, device: string, appsUsing: AppsUsing): Promise<unknown> {
  if (!(error instanceof MicrophoneCaptureError)) return error;
  const cause = error.cause as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof cause?.name === 'string' ? cause.name : '';
  const said = typeof cause?.message === 'string' && cause.message !== '' ? `${name}: ${cause.message}` : name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new SourceOpenError(`Windows privacy settings keep desktop apps off the microphone (${said}).`, MIC_BLOCKED, undefined, { cause: error });
    case 'NotReadableError':
    case 'AbortError': {
      const apps = await appsUsing(device).catch(() => null);
      if (apps && apps.length > 0) {
        const others = `${apps.length} other application${apps.length === 1 ? '' : 's'}`;
        return new SourceOpenError(`The microphone is in use by ${others} (${said}).`, MIC_IN_USE, { device, apps: apps.join(', ') }, { cause: error });
      }
      return new SourceOpenError(`Windows could not open the microphone (${said}).`, MIC_UNREADABLE, { device }, { cause: error });
    }
    default:
      return error;
  }
}
