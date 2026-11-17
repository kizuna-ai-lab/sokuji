/**
 * What the page needs to know to draw the main window's edge
 * (src/components/WindowEdge): whether the window is maximized or full screen.
 *
 * The main window has no system frame and is transparent (subtitle mode shows
 * the desktop through it), so on Linux and Windows nothing outlines it, and a
 * dark window on a dark desktop has no visible edge. The page draws one, but
 * not when the window fills the screen. No Electron import: main.js passes the
 * window in.
 */

/** @param {import('electron').BrowserWindow} win */
function windowStateOf(win) {
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen() };
}

const STATE_EVENTS = ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'];

/** Sends the page `window:state` each time the window is maximized, restored, or enters or leaves full screen. */
function watchWindowState(win) {
  const push = () => {
    if (!win.isDestroyed()) win.webContents.send('window:state', windowStateOf(win));
  };
  for (const name of STATE_EVENTS) win.on(name, push);
}

module.exports = { windowStateOf, watchWindowState };
