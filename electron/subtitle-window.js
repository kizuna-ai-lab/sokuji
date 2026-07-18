// electron/subtitle-window.js
const { ipcMain, screen } = require('electron');

// Window managers (esp. on Linux/X11/Wayland) apply setBounds() asynchronously.
// During the settling period, the resize event fires with intermediate values
// and mainWindow.getBounds() can still report the pre-setBounds size for
// hundreds of ms. If we forward those events to the renderer, the renderer
// persists the stale bounds as "subtitle bounds", overwriting the true
// subtitle dimensions. The TRANSITION_BLACKOUT_MS window gives the WM time
// to settle before we accept user-driven resize/move events.
const TRANSITION_BLACKOUT_MS = 600;

// Module-scope state shared by the IPC handlers below. createWindow() may be
// called more than once during an app's lifetime (notably on macOS, after
// the user closes the window and clicks the dock icon — see
// `app.on('activate')` in main.js). ipcMain.handle() throws on a second
// registration of the same channel, so registering the handlers inside
// setupSubtitleHandlers() — which runs per createWindow — would crash the
// next time the window is recreated. We register the handlers once at
// module load and have them resolve the *current* mainWindow at call time
// via the activeWindow reference that setupSubtitleHandlers() updates.
let activeWindow = null;
let normalBoundsSnapshot = null;
let transitionUntil = 0;

const beginTransition = () => {
  transitionUntil = Date.now() + TRANSITION_BLACKOUT_MS;
};

function clampToScreen(bounds, work) {
  const width = Math.min(bounds.width, work.width);
  const height = Math.min(bounds.height, work.height);
  const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
  const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
  return { x, y, width, height };
}

function defaultSubtitleBounds(work) {
  const width = Math.round(work.width * 0.8);
  const height = 200;
  return {
    x: work.x + Math.round((work.width - width) / 2),
    y: work.y + work.height - height - 80,
    width,
    height,
  };
}

function getLiveWindow() {
  return activeWindow && !activeWindow.isDestroyed() ? activeWindow : null;
}

// --- Always-on-top enforcement (#326) --------------------------------------
// On Windows, PowerPoint's slideshow / Presenter View re-asserts its own
// HWND_TOPMOST z-order whenever window activation changes. A one-shot
// setAlwaysOnTop() is displaced permanently the moment the pinned bar is
// merely clicked (activating it deactivates PowerPoint, which re-raises
// itself above us), and Electron emits no event for "another window went
// above us". Crucially, the displaced window KEEPS its WS_EX_TOPMOST style —
// isAlwaysOnTop() still returns true (electron/electron#2097) — so the fix
// must re-assert UNCONDITIONALLY while pinned:
//  - a short delayed re-assert on focus/blur — the activation transitions
//    that make PowerPoint re-raise itself — so recovery is near-immediate;
//  - a 1s heartbeat as a safety net for re-raises we get no event for
//    (PowerToys "Always On Top" survives PowerPoint the same way, via
//    WinEvent-triggered SetWindowPos(HWND_TOPMOST) re-pins).
// Each re-assert is one setAlwaysOnTop(true, ...) call — never a false→true
// toggle (drops us out of the topmost band and can knock OTHER topmost
// windows down, electron#31536) and never moveTop() (its SWP_SHOWWINDOW
// flag would force-show a hidden window). Windows-only: on macOS the
// 'floating' NSWindow level is a real window level honored by the WM, and
// periodic raises would be needless churn.
const PIN_REASSERT_INTERVAL_MS = 1000;
const PIN_REASSERT_EVENT_DELAY_MS = 200;

// On Windows, every setAlwaysOnTop with a level in Electron's
// "behind task bar" set — which includes the 'floating' default — ends with
// a second SetWindowPos tucking the window just BELOW the taskbar in the
// topmost band. A PowerPoint slideshow sits ABOVE the taskbar, so a
// 'floating' pin can never beat it. 'screen-saver' skips that demotion and
// leaves the bar at the very top of the topmost band. On macOS the level is
// a real NSWindow level; keep the original 'floating' there.
function pinLevel() {
  return process.platform === 'win32' ? 'screen-saver' : 'floating';
}

let pinHeartbeatTimer = null;
let pinEventTimer = null;

function reassertOnTop() {
  const win = getLiveWindow();
  if (!win) {
    stopPinEnforcement();
    return;
  }
  // Don't churn the z-order of a window the user can't see; enforcement
  // resumes on the next tick once the window is visible again.
  if (!win.isVisible() || win.isMinimized()) return;
  win.setAlwaysOnTop(true, pinLevel());
}

function startPinEnforcement() {
  stopPinEnforcement();
  if (process.platform !== 'win32') return;
  pinHeartbeatTimer = setInterval(reassertOnTop, PIN_REASSERT_INTERVAL_MS);
}

function stopPinEnforcement() {
  if (pinHeartbeatTimer) {
    clearInterval(pinHeartbeatTimer);
    pinHeartbeatTimer = null;
  }
  if (pinEventTimer) {
    clearTimeout(pinEventTimer);
    pinEventTimer = null;
  }
}

// Deferred re-assert after a focus/blur transition: give the other window
// (PowerPoint) a moment to finish its own re-raise, then top it again.
function schedulePinReassert() {
  if (!pinHeartbeatTimer) return; // only while pinned
  if (pinEventTimer) clearTimeout(pinEventTimer);
  pinEventTimer = setTimeout(() => {
    pinEventTimer = null;
    reassertOnTop();
  }, PIN_REASSERT_EVENT_DELAY_MS);
}

ipcMain.handle('subtitle:get-screen-bounds', () => {
  const display = screen.getPrimaryDisplay();
  return display.workArea;
});

ipcMain.handle('subtitle:enter', (_event, payload) => {
  const win = getLiveWindow();
  if (!win) return { ok: false };
  const work = screen.getPrimaryDisplay().workArea;
  const requested = payload?.bounds ?? defaultSubtitleBounds(work);
  const clamped = clampToScreen(requested, work);

  normalBoundsSnapshot = win.getBounds();
  beginTransition();
  win.setBounds(clamped);
  win.setAlwaysOnTop(Boolean(payload?.alwaysOnTop), pinLevel());
  if (payload?.alwaysOnTop) {
    startPinEnforcement();
  } else {
    stopPinEnforcement();
  }
  win.setResizable(!payload?.locked);
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false);
  }
  return { ok: true, bounds: clamped };
});

ipcMain.handle('subtitle:exit', (_event, payload) => {
  const win = getLiveWindow();
  if (!win) return { ok: false };
  // If the user exits subtitle mode while fullscreen, drop fullscreen first;
  // otherwise setBounds() fights the fullscreen state and the window can be
  // left stuck. Guarded to avoid a needless transition on the common path.
  //
  // KNOWN, ACCEPTED limitation (macOS): setFullScreen(false) animates
  // asynchronously, so the synchronous setBounds() below can land before the
  // Space transition finishes, leaving the window slightly mis-sized when
  // exiting subtitle mode DIRECTLY from fullscreen via the ✕ button. The
  // layered-ESC path (fullscreen → windowed → exit) is unaffected. We keep
  // native setFullScreen (not setSimpleFullScreen) because it emits
  // enter/leave-full-screen, which the subtitle:fullscreen-changed sync relies
  // on. If revisited, defer setBounds to the leave-full-screen event rather
  // than switching fullscreen modes.
  if (win.isFullScreen()) win.setFullScreen(false);
  const restore = payload?.restoreBounds ?? normalBoundsSnapshot ?? { width: 1200, height: 800 };
  beginTransition();
  if (restore.x !== undefined && restore.y !== undefined) {
    win.setBounds(restore);
  } else {
    const display = screen.getPrimaryDisplay().workArea;
    win.setBounds({
      x: display.x + Math.round((display.width - 1200) / 2),
      y: display.y + Math.round((display.height - 800) / 2),
      width: 1200,
      height: 800,
    });
  }
  stopPinEnforcement();
  win.setAlwaysOnTop(false);
  win.setResizable(true);
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(true);
  }
  normalBoundsSnapshot = null;
  return { ok: true };
});

ipcMain.handle('subtitle:set-always-on-top', (_event, flag) => {
  const win = getLiveWindow();
  if (!win) return { ok: false };
  win.setAlwaysOnTop(Boolean(flag), pinLevel());
  if (flag) {
    startPinEnforcement();
  } else {
    stopPinEnforcement();
  }
  return { ok: true };
});

ipcMain.handle('subtitle:set-locked', (_event, locked) => {
  const win = getLiveWindow();
  if (!win) return { ok: false };
  win.setResizable(!locked);
  return { ok: true };
});

ipcMain.handle('subtitle:set-fullscreen', (_event, flag) => {
  const win = getLiveWindow();
  if (!win) return { ok: false };
  // Suppress the resize/move broadcaster while the WM animates in/out of
  // fullscreen, so the fullscreen geometry is never persisted as the bar's
  // windowBounds. The isFullScreen() guard added to onChange backs this up.
  beginTransition();
  win.setFullScreen(Boolean(flag));
  return { ok: true };
});

function setupSubtitleHandlers(mainWindow) {
  // Rebind the active window. Resize/move listeners are per-window and need
  // to be attached on every createWindow() call.
  activeWindow = mainWindow;
  // Reset snapshot/transition for the fresh window so a stale snapshot
  // from a previous window can't leak in. A fresh window starts unpinned,
  // so any enforcement left over from a previous window must stop too.
  normalBoundsSnapshot = null;
  transitionUntil = 0;
  stopPinEnforcement();

  // Debounced bounds-changed broadcaster. Suppressed during transition
  // windows so we don't capture intermediate WM-reported sizes as the
  // user's intended bounds.
  let debounceTimer = null;
  const onChange = () => {
    // resize/move can fire synchronously during window teardown; isFullScreen()
    // throws on a destroyed window, so bail before touching it.
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isFullScreen()) return; // never persist fullscreen geometry as bar bounds
    if (Date.now() < transitionUntil) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed() && Date.now() >= transitionUntil) {
        mainWindow.webContents.send('subtitle:window-bounds-changed', mainWindow.getBounds());
      }
    }, 200);
  };
  mainWindow.on('resize', onChange);
  mainWindow.on('move', onChange);
  const onEnterFullScreen = () =>
    mainWindow.webContents.send('subtitle:fullscreen-changed', true);
  const onLeaveFullScreen = () =>
    mainWindow.webContents.send('subtitle:fullscreen-changed', false);
  mainWindow.on('enter-full-screen', onEnterFullScreen);
  mainWindow.on('leave-full-screen', onLeaveFullScreen);
  // Activation transitions are the moments PowerPoint re-raises itself
  // above a pinned bar — respond to them promptly (see enforcement above).
  mainWindow.on('focus', schedulePinReassert);
  mainWindow.on('blur', schedulePinReassert);
  mainWindow.on('closed', () => {
    stopPinEnforcement();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // Drop the reference so handlers know there's no live window until the
    // next createWindow() rebinds it.
    if (activeWindow === mainWindow) {
      activeWindow = null;
      normalBoundsSnapshot = null;
    }
  });
}

module.exports = { setupSubtitleHandlers };
