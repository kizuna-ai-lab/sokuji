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

/**
 * The rows worth offering: windows first, then screens, each kind in the order
 * it was listed. A window of this app is left out (a picture of Sokuji sent to
 * the engine is never what a user means, and the picker itself would be in it),
 * and so is a source with no name (nothing to show for it in the list) or one
 * that is neither a window nor a screen.
 *
 * @param {ListedSource[]} sources
 * @param {string[]} ownIds  getMediaSourceId() of each of this app's windows
 * @returns {PickableSource[]}
 */
function pickableSources(sources, ownIds) {
  const own = new Set(ownIds);
  const windows = [];
  const screens = [];
  for (const source of sources) {
    if (own.has(source.id)) continue;
    if (typeof source.name !== 'string' || source.name.trim() === '') continue;
    if (source.id.startsWith('window:')) windows.push({ ...source, kind: 'window' });
    else if (source.id.startsWith('screen:')) screens.push({ ...source, kind: 'screen' });
  }
  return [...windows, ...screens];
}

/**
 * How the picker gets its choices. On a Wayland session the desktopCapturer
 * call goes through PipeWire and the desktop portal: the OS shows its own
 * dialog and the call answers the one source the user picked there, so the
 * picker has no list to draw, only a button that opens the portal.
 *
 * linux-gpu-flags.js sniffs the same variables for the GPU flags; it is not
 * reused because it answers a different question (which ozone platform
 * Chromium rendered with).
 *
 * @param {string} platform  process.platform
 * @param {Record<string, string | undefined>} env  process.env
 * @returns {'portal' | 'list'}
 */
function captureSourceMode(platform, env) {
  if (platform !== 'linux') return 'list';
  const wayland = env.XDG_SESSION_TYPE ? env.XDG_SESSION_TYPE === 'wayland' : Boolean(env.WAYLAND_DISPLAY);
  return wayland ? 'portal' : 'list';
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
 * @param {() => string} o.screenRecording  'granted' off macOS
 * @param {() => Promise<ListedSource[]>} o.getSources
 * @param {() => string[]} o.ownIds  read after the listing, so a window opened meanwhile is still left out
 * @returns {Promise<{ ok: true, sources: PickableSource[] } | { ok: false, error: string }>}
 */
async function listCaptureSources({ screenRecording, getSources, ownIds }) {
  try {
    if (screenRecording() === 'denied') return { ok: false, error: 'screen-recording-denied' };
    const listed = await getSources();
    return { ok: true, sources: pickableSources(listed, ownIds()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  pickableSources,
  captureSourceMode,
  listCaptureSources,
};
