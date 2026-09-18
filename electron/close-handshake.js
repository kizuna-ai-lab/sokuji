// electron/close-handshake.js
//
// Closing the main window, or quitting, while a session runs used to drop the
// session: nothing ended it, so nothing captured its final lines and the
// session-end auto-save never ran. The main process now holds the close, asks
// the renderer to end its session, and lets the close through when the
// renderer answers — or after a timeout, so a hung teardown can never leave a
// window that will not close.
//
// The hold applies only while the renderer reports a session as running or
// tearing down ('app:session-busy'). Anything else — the setup wizard, a page
// still loading, an error screen, an idle main panel — closes at once: there is
// nothing to save, and there may be no listener to answer.
const DEFAULT_TIMEOUT_MS = 5000;

function createCloseHandshake({
  quitApp,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let win = null;
  let state = 'idle'; // 'idle' | 'waiting' | 'approved'
  let quitPending = false;
  let sessionBusy = false;
  let timer = null;

  const hasLivePage = () =>
    !!win && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed();

  function finish() {
    if (state !== 'waiting') return;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    state = 'approved';
    if (quitPending) {
      quitApp();
    } else if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  /** True when the close/quit may proceed now; otherwise it is held. */
  function hold(event, quit) {
    if (state === 'approved') return true;
    if (state === 'waiting') {
      event.preventDefault();
      if (quit) quitPending = true;
      return false;
    }
    if (!hasLivePage() || !sessionBusy) return true;
    event.preventDefault();
    state = 'waiting';
    quitPending = quit;
    win.webContents.send('app:close-requested');
    timer = setTimer(finish, timeoutMs);
    return false;
  }

  return {
    /** A new main window starts a fresh handshake, and a fresh page is idle. */
    attachWindow(nextWin) {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      win = nextWin;
      state = 'idle';
      quitPending = false;
      sessionBusy = false;
    },
    /** The main window's 'close' listener. */
    onWindowClose(event) {
      hold(event, false);
    },
    /** From 'before-quit': true means proceed with the quit (and its cleanup). */
    onBeforeQuit(event) {
      return hold(event, true);
    },
    /** The renderer has ended its session ('app:close-ready'). */
    ready() {
      finish();
    },
    /** The renderer's session is running or tearing down ('app:session-busy'). */
    setSessionBusy(busy) {
      sessionBusy = !!busy;
    },
  };
}

module.exports = { createCloseHandshake, DEFAULT_TIMEOUT_MS };
