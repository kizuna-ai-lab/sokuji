// electron/popover-windows.js
//
// Visibility bridge for the subtitle bar's popover child windows.
//
// The renderer hosts those popovers in frameless child windows it opens with
// window.open (see src/components/Subtitle/ChildWindowPopover.tsx). They are
// created once and reused, so opening a popover costs a show + move instead
// of a native window creation — but a DOM Window has no visibility API, and
// "parking" windows off-screen does not survive the window manager: mutter
// clamps both the initial position and runtime moveTo back onto the screen
// (measured: a window parked at (-10000, 0) sat at (0, 32), fully visible).
// So the main process owns visibility: popover windows are created hidden
// via a setWindowOpenHandler override — show:false from the very first
// frame — and shown/hidden over IPC.
const { ipcMain, shell } = require('electron');

// The renderer names its popover windows with this window.open target prefix.
const POPOVER_PREFIX = 'sokuji-popover:';

/**
 * Popover windows only ever host DOM the parent portals into them, so their
 * document stays blank for life. Anything else is a renderer trying to point
 * a frameless, transparent, always-on-top window at a page — the frame name
 * is renderer-controlled, so matching the prefix cannot be a licence to load
 * arbitrary content.
 */
function isBlankUrl(url) {
  return !url || url === 'about:blank';
}

// Live popover windows by frame name. Module scope for the same reason as
// subtitle-window.js: createWindow() can run more than once per app lifetime,
// and ipcMain.handle throws on a second registration of the same channel, so
// handlers register once at module load and resolve windows at call time.
const popoverWindows = new Map();

ipcMain.handle('popover-window:set-visible', (_event, payload) => {
  const name = payload?.name;
  const win = popoverWindows.get(name);
  if (!win || win.isDestroyed()) return { ok: false };
  if (payload?.visible) {
    // show() also focuses the window — which the renderer wants: focus is
    // what makes its blur-to-dismiss behavior work.
    win.show();
  } else {
    win.hide();
  }
  return { ok: true };
});

function setupPopoverWindowHandlers(mainWindow) {
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.frameName?.startsWith(POPOVER_PREFIX)) {
      if (!isBlankUrl(details.url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { show: false },
      };
    }
    // Everything else is denied: the renderer's own window.open('http…')
    // calls (help links, update downloads) belong in the system browser,
    // and a compromised renderer must not be able to conjure arbitrary
    // Electron windows. Only web URLs reach the OS.
    if (/^https?:\/\//i.test(details.url ?? '')) {
      void shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    const name = details.frameName;
    if (!name?.startsWith(POPOVER_PREFIX)) return;
    popoverWindows.set(name, childWindow);

    // setWindowOpenHandler governs creation only. Re-opening an existing
    // window NAME navigates the live window instead of making a new one, and
    // in-page navigation would likewise swap the popover for a web page in
    // an always-on-top frame. Pin the document to blank for the window's
    // life. (`url` is the second argument on the legacy signature and a
    // field on the newer event object; read both.)
    const blockNavigation = (event, url) => {
      if (isBlankUrl(url ?? event?.url)) return;
      event.preventDefault();
    };
    childWindow.webContents.on('will-navigate', blockNavigation);
    childWindow.webContents.on('will-redirect', blockNavigation);
    childWindow.on('closed', () => {
      // Only forget the window if it is still the registered one — a name
      // can be reused after a close, and the stale closed event must not
      // evict its successor.
      if (popoverWindows.get(name) === childWindow) popoverWindows.delete(name);
    });
  });
}

module.exports = { setupPopoverWindowHandlers };
