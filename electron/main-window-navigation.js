// The main window shows the app's own page and nothing else.
//
// A link the page renders without a target (the release notes in the update
// dialog are GitHub's HTML, full of them) would otherwise navigate the main
// window itself: the app's interface gone, no frame and no Back button to
// return with, and the page it went to still holding the preload's
// `window.electron.invoke`. setWindowOpenHandler (popover-windows.js) governs
// new windows only; in-place navigation is stopped here, and a web or mail
// link is opened by the system instead.

const { shell } = require('electron');

/**
 * Whether `url` is the app's page `appUrl`: under file://, the same file;
 * under http(s) (the dev server), the same origin.
 */
function isAppPage(url, appUrl) {
  let target;
  let app;
  try {
    target = new URL(url);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (app.protocol === 'file:') return target.protocol === 'file:' && filePath(target) === filePath(app);
  return target.origin === app.origin;
}

/** A file URL's path, decoded: the URL the window reports and the one built from the path may escape it differently. */
function filePath(url) {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

/**
 * A link the system may be asked to open: a web page, in the browser, or a
 * mail address, in the mail program. Nothing else: any other scheme would
 * start whatever program is registered for it, with a URL the page chose.
 */
function isSystemLink(url) {
  return /^(https?:\/\/|mailto:)/i.test(url ?? '');
}

/**
 * Keeps `win` on the app's page: a navigation elsewhere is cancelled, and a
 * web or mail link is opened by the system instead. (`url` is the second
 * argument on the legacy signature and a field on the newer event object;
 * read both.)
 */
function guardMainWindowNavigation(win, appUrl) {
  win.webContents.on('will-navigate', (event, url) => {
    const target = url ?? event?.url;
    if (isAppPage(target, appUrl)) return;
    event.preventDefault();
    // A program that cannot be launched (no xdg-open, say) rejects: caught, or the unhandled rejection quits the app.
    if (isSystemLink(target)) {
      shell.openExternal(target).catch((error) => console.error('[Sokuji] [Main] Could not open the link:', error));
    }
  });
}

module.exports = { isAppPage, guardMainWindowNavigation };
