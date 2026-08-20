/**
 * Restore double-click-to-maximize on the custom title bar (Windows only).
 *
 * The main window is `frame: false` + `transparent: true` (see createWindow in
 * main.js, introduced with subtitle mode in #225). Electron forces
 * `thick_frame_ = false` for transparent windows and Chromium strips
 * WS_CAPTION | WS_THICKFRAME from the window style. Dragging the title bar
 * still moves the window, but double-clicking it does nothing.
 *
 * What the double-click actually produces, measured on Electron 40 / Win 11:
 * exactly one message reaches the top-level HWND, WM_SYSCOMMAND with wParam
 * 0xf032, and no maximize follows.
 *
 * That is SC_MAXIMIZE: `0xf032 & 0xfff0 === 0xf030`. Windows *does* recognise
 * the double-click and asks the window to maximize. The request then dies
 * downstream, because DefWindowProc will not maximize a window whose
 * WS_CAPTION | WS_MAXIMIZEBOX styles were stripped.
 *
 * Note what does NOT arrive: WM_NCLBUTTONDBLCLK is never seen by the top-level
 * HWND at all, so hooking it (the usual advice for this problem, e.g.
 * electron/electron#16034) cannot work here. Chromium puts the web contents in
 * a child HWND that covers the whole client area; the non-client mouse messages
 * are consumed there and only the resulting WM_SYSCOMMAND is routed up.
 *
 * So the hook goes on WM_SYSCOMMAND and re-issues the request through Electron,
 * whose `maximize()` drives the window directly (ShowWindow) instead of going
 * back through DefWindowProc — the same path the title bar's own maximize
 * button uses, which is why that button works while the double-click does not.
 *
 * The other two platforms need no help. On Linux the draggable region is
 * hit-tested as HTCAPTION and handed to the window manager, which maximizes on
 * double-click. On macOS Electron only swizzles NSThemeFrame's mouseDown and
 * still calls through to AppKit, so the native "double-click a window's title
 * bar to" action (System Settings > Desktop & Dock) applies.
 *
 * This cannot be fixed in the renderer: draggable areas ignore all pointer
 * events, so no dblclick ever reaches the page.
 *
 * The hook covers subtitle mode too, since that reuses the same BrowserWindow.
 */

/** Sent when the user picks a command from the system menu or the caption. */
const WM_SYSCOMMAND = 0x0112;
/**
 * The low four bits of a WM_SYSCOMMAND wParam are reserved for internal use by
 * Windows, so the command must be masked out before comparing.
 */
const SC_MASK = 0xfff0;
const SC_MAXIMIZE = 0xf030;
const SC_RESTORE = 0xf120;

/**
 * Decode the system command out of the hook's WPARAM. Electron boxes it in a
 * pointer-sized Buffer; older and newer versions have used plain numbers, so
 * accept both. Returns null when the shape is unrecognized.
 */
function systemCommand(wParam) {
  let raw = null;
  if (typeof wParam === 'number') raw = wParam;
  else if (typeof wParam === 'bigint') raw = Number(wParam);
  // Windows is little-endian and the command fits in the low 32 bits, so the
  // first four bytes are correct on both x64 and ia32.
  else if (Buffer.isBuffer(wParam) && wParam.length >= 4) raw = wParam.readUInt32LE(0);
  if (raw === null) return null;
  return raw & SC_MASK;
}

/**
 * Install the hook on `win`. No-op off Windows.
 * @returns {boolean} whether a hook was installed.
 */
function setupCaptionDoubleClick(win) {
  if (process.platform !== 'win32') return false;
  if (!win || typeof win.hookWindowMessage !== 'function') return false;

  win.hookWindowMessage(WM_SYSCOMMAND, (wParam) => {
    // Unlike a hit-test code, an undecodable system command must fail closed:
    // this message also carries SC_CLOSE / SC_MINIMIZE / SC_MOVE, and guessing
    // would maximize the window on an unrelated command.
    const command = systemCommand(wParam);
    if (command !== SC_MAXIMIZE && command !== SC_RESTORE) return;
    // The message can still arrive while the window is being torn down.
    if (win.isDestroyed()) return;

    if (command === SC_MAXIMIZE) {
      // A double-click on an *already maximized* window reports SC_MAXIMIZE
      // again, not SC_RESTORE -- measured, both clicks arrive as 0xf032. The
      // child HWND that translates the double-click is not itself maximized,
      // so its DefWindowProc has no restore state to report. That makes
      // SC_MAXIMIZE a toggle rather than a one-way command here; treating it
      // literally leaves the window stuck maximized.
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return;
    }
    // SC_RESTORE also arrives when un-minimizing from the taskbar. Restoring a
    // minimized window is not our business — and un-maximizing it there would
    // throw away the maximized state the user is returning to.
    if (win.isMaximized() && !win.isMinimized()) win.unmaximize();
  });
  return true;
}

module.exports = {
  setupCaptionDoubleClick,
  WM_SYSCOMMAND,
  SC_MASK,
  SC_MAXIMIZE,
  SC_RESTORE,
};
