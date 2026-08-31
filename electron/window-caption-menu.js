/**
 * Replace the system window menu on the custom title bar (Linux only).
 *
 * The main window is `frame: false` (see createWindow in main.js), so its
 * title bar is a `-webkit-app-region: drag` area. Right-clicking a drag area
 * on Linux makes Chromium send `_GTK_SHOW_WINDOW_MENU` to the window manager,
 * which shows the desktop's window menu — under GNOME that menu includes
 * "Take Screenshot".
 *
 * Measured on GNOME Shell 46.0 / mutter 46.2, Ubuntu 24.04, X11 (2026-09-01):
 * picking "Take Screenshot" from that menu on a client-side-decorated window
 * wedges mutter — its synchronous passive button-1 grab activates and is
 * never thawed with XIAllowEvents, so the pointer device stays frozen in the
 * X server and every click and key in the whole session goes dead until
 * gnome-shell is restarted. The Xorg grab dump shows gnome-shell as the
 * owner: `(from passive grab) (device frozen, state 6), passive grab type 4,
 * detail 0x1`. Server-side-decorated windows (a native title bar) take a
 * different path inside mutter and are not affected — which is why every
 * other app on the desktop seems fine and only this app "freezes the system".
 *
 * Chromium the browser is immune for a different reason: its caption
 * right-click never reaches the window manager at all — it draws its own
 * Minimize/Maximize/Close menu. This module does the same through Electron's
 * `system-context-menu` event: `preventDefault()` stops the
 * `_GTK_SHOW_WINDOW_MENU` request (verified on Electron 40.8.5: the event
 * fires for frameless drag regions on X11 and suppression works), and a
 * small Electron menu takes the system menu's place.
 *
 * Windows keeps its native system menu — it works fine there and losing it
 * would be a regression (the event exists on win32 too, so the gate matters).
 * On macOS the event never fires. Popover windows are frameless as well but
 * declare no drag region, so the event cannot fire for them and they need no
 * hook.
 */

/**
 * The replacement menu: what the system menu's safe core offered. Items check
 * the window again at click time because the popup can outlive it — the
 * window can be closed from elsewhere (tray, IPC) while the menu is open.
 *
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function captionMenuTemplate(win) {
  const whileAlive = (action) => () => {
    if (!win.isDestroyed()) action();
  };
  return [
    {
      label: 'Minimize',
      enabled: win.isMinimizable(),
      click: whileAlive(() => win.minimize()),
    },
    win.isMaximized()
      ? { label: 'Restore', click: whileAlive(() => win.unmaximize()) }
      : {
          label: 'Maximize',
          enabled: win.isMaximizable(),
          click: whileAlive(() => win.maximize()),
        },
    { type: 'separator' },
    { label: 'Close', click: whileAlive(() => win.close()) },
  ];
}

/**
 * Install the replacement on `win`. No-op off Linux.
 *
 * @param {Electron.BrowserWindow} win
 * @param {{ menuApi?: Pick<typeof Electron.Menu, 'buildFromTemplate'> }} [deps]
 *   test seam; defaults to Electron's Menu.
 * @returns {boolean} whether the listener was installed.
 */
function setupCaptionContextMenu(win, { menuApi = null } = {}) {
  if (process.platform !== 'linux') return false;
  if (!win || typeof win.on !== 'function') return false;

  win.on('system-context-menu', (event) => {
    // Suppress first, unconditionally: letting the system menu through is the
    // freeze; a menu-less right-click is merely inert.
    event.preventDefault();
    console.log('[Sokuji] [CaptionMenu] Replacing system window menu');

    // Deferred: popping up synchronously from inside this event shows nothing
    // on Linux (measured on Electron 40.8.5 — the call no-ops without error).
    setImmediate(() => {
      if (win.isDestroyed()) return;
      const Menu = menuApi ?? require('electron').Menu;
      // No coordinates: popup() defaults to the cursor position, which is
      // where the right-click happened. The event's `point` is in physical
      // screen pixels and would need a DIP conversion to be usable here.
      Menu.buildFromTemplate(captionMenuTemplate(win)).popup({ window: win });
    });
  });
  return true;
}

module.exports = {
  setupCaptionContextMenu,
  captionMenuTemplate,
};
