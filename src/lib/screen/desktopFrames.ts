/**
 * The desktop app's screen capture: the sources the main process lists, and the
 * one the user picked as a `Capture` for the sampler.
 *
 * The pick is captured through `getUserMedia` with the desktop source id
 * (`chromeMediaSource: 'desktop'`), video only. That is deliberately not
 * `getDisplayMedia`: the display-media request handler belongs to
 * electron-audio-loopback (`session.setDisplayMediaRequestHandler`, which is how
 * Windows system audio is captured, with no source id at all), and a capture
 * that never asks for display media never reaches it.
 *
 * Nothing here reports a failure: a refusal or a listing that failed comes back
 * to the caller, which owns what the user is told.
 */
import { canvasCapture } from './canvasCapture';
import type { Capture } from './sampler';

/** The renderer's bridge to the main process: `window.electron.invoke`. */
export type Invoke = (channel: string, data?: unknown) => Promise<unknown>;

export interface CaptureSourceInfo {
  id: string;
  name: string;
  kind: 'window' | 'screen';
  /** A data URL. */
  thumbnail: string;
  /** A data URL, or null when the source has no icon. */
  appIcon: string | null;
}

/** How the picker gets its choices: 'list' draws Sokuji's own, 'portal' hands over to the OS's. */
export function captureSourceMode(invoke: Invoke): Promise<{ mode: 'list' | 'portal'; screenRecording: string }> {
  return invoke('capture-source-mode') as Promise<{ mode: 'list' | 'portal'; screenRecording: string }>;
}

/** The windows and screens to pick from, or the reason there are none (`'screen-recording-denied'` on macOS). */
export function listCaptureSources(invoke: Invoke): Promise<{ ok: true; sources: CaptureSourceInfo[] } | { ok: false; error: string }> {
  return invoke('list-capture-sources') as Promise<{ ok: true; sources: CaptureSourceInfo[] } | { ok: false; error: string }>;
}

/**
 * macOS: Sokuji's Screen Recording entry reset and the prompt raised (the picker's Ask macOS again); `status` is the
 * permission read afterwards, which a new grant changes only after a restart. `resetError` says why the reset failed.
 */
export function reaskScreenRecording(invoke: Invoke): Promise<{ asked: boolean; status: string; resetError?: string }> {
  return invoke('reask-screen-recording') as Promise<{ asked: boolean; status: string; resetError?: string }>;
}

/** The pick as a stream, through the desktop source id — never the display-media handler, which electron-audio-loopback owns. */
export function desktopConstraints(sourceId: string): MediaStreamConstraints {
  // `mandatory` is Chromium's legacy constraint form, the one desktop capture takes; lib.dom does not type it.
  return {
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 2 } },
  } as MediaStreamConstraints;
}

export interface DesktopCaptureDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /** The `Capture` over a video track; `close`, when it has one, is called with the capture's own. */
  capture(track: MediaStreamTrack): Omit<Capture, 'name' | 'kind'> & { close?(): void };
}

const browserDeps: DesktopCaptureDeps = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  capture: canvasCapture,
};

/**
 * Opens the picked source. Once its track ends (the window closed, the screen
 * went away, the portal's share was stopped) every `grab()` resolves null, which
 * the sampler tells as a loss; `close()` stops the track and does the same.
 * Rejects when the stream cannot be opened, or has no video track.
 */
export async function openDesktopCapture(
  source: Pick<CaptureSourceInfo, 'id' | 'name' | 'kind'>,
  deps: DesktopCaptureDeps = browserDeps,
): Promise<Capture & { close(): void }> {
  const stream = await deps.getUserMedia(desktopConstraints(source.id));
  const track = stream.getVideoTracks()[0];
  if (!track) {
    for (const stray of stream.getTracks()) stray.stop();
    // No title: the message reaches the Logs panel (`reportWarning`), and from there bug reports.
    throw new Error('The picked capture has no video track');
  }

  let ended = false;
  let closed = false;
  const onEnded = () => { ended = true; };
  track.addEventListener('ended', onEnded);

  let inner: ReturnType<DesktopCaptureDeps['capture']>;
  try {
    inner = deps.capture(track);
  } catch (error) {
    // Nothing would ever close a stream that never became a capture: the system's screen-share indicator would stay on.
    track.removeEventListener('ended', onEnded);
    for (const opened of stream.getTracks()) opened.stop();
    throw error;
  }

  return {
    name: source.name,
    kind: source.kind,
    // `readyState` is read too: an event that fired before the listener was added is not coming again.
    grab: async () => (ended || track.readyState === 'ended' ? null : inner.grab()),
    encode: (picture, quality) => inner.encode(picture, quality),
    close() {
      if (closed) return;
      closed = true;
      // stop() fires no ended event, so a stopped capture is marked here; a track that ended on its own is stopped all the same.
      ended = true;
      track.removeEventListener('ended', onEnded);
      track.stop();
      inner.close?.();
    },
  };
}
