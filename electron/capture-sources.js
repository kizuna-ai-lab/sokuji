// The sources the screen-context picker offers: the windows and screens
// desktopCapturer lists, as plain rows the renderer can draw.
//
// Deliberately does not require('electron'): every Electron object is injected
// by main.js, the one place Electron is touched, so this stays unit testable
// (same reasoning as own-app-source.js).

/**
 * @typedef {{ id: string, name: string, thumbnail: string, appIcon: string | null }} ListedSource
 *   a desktopCapturer source with its thumbnail and icon already data URLs
 * @typedef {ListedSource & { kind: 'window' | 'screen' }} PickableSource
 */

/** The name a portal pick is given when the portal answers it without one. */
const PORTAL_NAME_FALLBACK = 'Shared screen';

/**
 * The rows worth offering: windows first, then screens, each kind in the order
 * it was listed. A window of this app is left out (a picture of Sokuji sent to
 * the engine is never what a user means, and the picker itself would be in it),
 * and so is one that is neither a window nor a screen. A source with no name is
 * left out of a list (nothing to show for it there); in 'portal' mode it is the
 * one source the user already picked in the portal's dialog, so it is kept and
 * named 'Shared screen'.
 *
 * @param {ListedSource[]} sources
 * @param {string[]} ownIds  getMediaSourceId() of each of this app's windows
 * @param {'list' | 'portal'} [mode]
 * @returns {PickableSource[]}
 */
function pickableSources(sources, ownIds, mode = 'list') {
  const own = new Set(ownIds);
  const windows = [];
  const screens = [];
  for (const source of sources) {
    if (own.has(source.id)) continue;
    const named = typeof source.name === 'string' && source.name.trim() !== '';
    if (!named && mode !== 'portal') continue;
    const row = named ? source : { ...source, name: PORTAL_NAME_FALLBACK };
    if (source.id.startsWith('window:')) windows.push({ ...row, kind: 'window' });
    else if (source.id.startsWith('screen:')) screens.push({ ...row, kind: 'screen' });
  }
  return [...windows, ...screens];
}

/**
 * How the picker gets its choices. On a Wayland session the desktopCapturer
 * call goes through PipeWire and the desktop portal: the OS shows its own
 * dialog and the call answers the one source the user picked there, so the
 * picker has no list to draw, only a button that opens the portal.
 *
 * The test is WebRTC's own (DesktopCapturer::IsRunningUnderWayland(), which
 * picks the PipeWire capturer while WebRTCPipeWireCapturer is on, as it is in
 * every branch of linux-gpu-flags.js): XDG_SESSION_TYPE starting with
 * "wayland" and WAYLAND_DISPLAY set. Anything looser answers 'portal' where
 * Chromium lists every window itself. The ozone platform plays no part, so
 * the .deb's --ozone-platform=x11 on a Wayland session is still the portal;
 * linux-gpu-flags.js answers that different question (which platform Chromium
 * renders with) and is not reused.
 *
 * @param {string} platform  process.platform
 * @param {Record<string, string | undefined>} env  process.env
 * @returns {'portal' | 'list'}
 */
function captureSourceMode(platform, env) {
  if (platform !== 'linux') return 'list';
  const wayland = (env.XDG_SESSION_TYPE ?? '').startsWith('wayland') && Boolean(env.WAYLAND_DISPLAY);
  return wayland ? 'portal' : 'list';
}

/**
 * The Screen Recording status the picker acts on: 'granted' off macOS, where
 * nothing gates the listing, and macOS's own status otherwise. 'restricted' (a
 * profile or parental control forbids it) is a refusal like 'denied' and reads
 * as one, so the picker shows the unavailable state rather than a listing of
 * blank windows. 'not-determined' passes through: the listing is what raises
 * the system prompt. So does 'unknown', which the status read after the listing
 * then settles.
 *
 * @param {string} platform  process.platform
 * @param {() => string} read  systemPreferences.getMediaAccessStatus('screen'), read only on macOS
 * @returns {string}
 */
function screenRecordingState(platform, read) {
  if (platform !== 'darwin') return 'granted';
  const status = read();
  return status === 'restricted' ? 'denied' : status;
}

/**
 * The picker's list, or the reason there is none.
 *
 * The Screen Recording status is read before the list is asked for, and
 * 'denied' never reaches getSources(). On macOS a getSources() call while the
 * status is 'not-determined' is what raises the system prompt, and the picker
 * wants that; once the user has refused, asking again only gets back what they
 * refused, so the picker is told instead and can point at the setting that
 * fixes it.
 *
 * @param {object} o
 * @param {'list' | 'portal'} [o.mode]  captureSourceMode(): in 'portal' mode the listing is the portal's one pick
 * @param {() => string} o.screenRecording  'granted' off macOS
 * @param {() => Promise<ListedSource[]>} o.getSources
 * @param {() => string[]} o.ownIds  read after the listing, so a window opened meanwhile is still left out
 * @returns {Promise<{ ok: true, sources: PickableSource[] } | { ok: false, error: string }>}
 */
async function listCaptureSources({ mode = 'list', screenRecording, getSources, ownIds }) {
  try {
    if (screenRecording() === 'denied') return { ok: false, error: 'screen-recording-denied' };
    const listed = await getSources();
    return { ok: true, sources: pickableSources(listed, ownIds(), mode) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  pickableSources,
  captureSourceMode,
  screenRecordingState,
  listCaptureSources,
};
