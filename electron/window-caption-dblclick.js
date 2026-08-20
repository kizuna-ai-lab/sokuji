/**
 * Restore double-click-to-maximize on the custom title bar (Windows only).
 *
 * The main window is `frame: false` + `transparent: true` (see createWindow in
 * main.js, introduced with subtitle mode in #225). Electron forces
 * `thick_frame_ = false` for transparent windows and then strips
 * WS_CAPTION | WS_THICKFRAME from the window style, so DefWindowProc no longer
 * recognises a double-click on an HTCAPTION area as a title-bar double-click.
 * The result: dragging the title bar still moves the window, but double-clicking
 * it does nothing.
 *
 * The other two platforms need no help. On Linux the draggable region is
 * hit-tested as HTCAPTION and handed to the window manager, which maximizes on
 * double-click. On macOS Electron only swizzles NSThemeFrame's mouseDown and
 * still calls through to AppKit, so the native "double-click a window's title
 * bar to" action (System Settings > Desktop & Dock) applies.
 *
 * This cannot be fixed in the renderer: draggable areas ignore all pointer
 * events, so no dblclick ever reaches the page. Hooking the raw window message
 * in the main process is the one place the double-click is observable.
 *
 * The hook covers subtitle mode too, since that reuses the same BrowserWindow.
 */

/** Sent when the user double-clicks the non-client area. */
const WM_NCLBUTTONDBLCLK = 0x00a3;
/** WPARAM hit-test code for the title bar / draggable region. */
const HTCAPTION = 2;

/**
 * Decode the hit-test code out of the hook's WPARAM. Electron boxes it in a
 * pointer-sized Buffer; older and newer versions have used plain numbers, so
 * accept both. Returns null when the shape is unrecognized.
 */
function hitTestCode(wParam) {
  if (typeof wParam === 'number') return wParam;
  if (typeof wParam === 'bigint') return Number(wParam);
  // Windows is little-endian and the hit-test code fits in the low 32 bits,
  // so the first four bytes are correct on both x64 and ia32.
  if (Buffer.isBuffer(wParam) && wParam.length >= 4) return wParam.readUInt32LE(0);
  return null;
}

/**
 * True unless we can positively identify the double-click as landing somewhere
 * other than the caption (a resize border, say). An undecodable WPARAM fails
 * open: on a frameless window this message is almost always the drag region,
 * so acting keeps the behaviour working if Electron ever changes the shape,
 * where ignoring would disable it silently.
 */
function isCaptionHit(wParam) {
  const code = hitTestCode(wParam);
  return code === null || code === HTCAPTION;
}

/**
 * Install the hook on `win`. No-op off Windows.
 * @returns {boolean} whether a hook was installed.
 */
function setupCaptionDoubleClick(win) {
  if (process.platform !== 'win32') return false;
  if (!win || typeof win.hookWindowMessage !== 'function') return false;

  win.hookWindowMessage(WM_NCLBUTTONDBLCLK, (wParam) => {
    // The message can still arrive while the window is being torn down.
    if (win.isDestroyed()) return;
    if (!isCaptionHit(wParam)) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  return true;
}

module.exports = {
  setupCaptionDoubleClick,
  WM_NCLBUTTONDBLCLK,
  HTCAPTION,
};
