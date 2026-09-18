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
//
// An update install asks the same question first (endSessionThen): the
// updater's own quit must not be held, because a held quit keeps the old
// instance alive while the new one starts.
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
  // What to run instead of a close or quit once the session has ended (an
  // update install). While set, the wait is not for a close.
  let pendingAction = null;
  let sessionBusy = false;
  let timer = null;

  const hasLivePage = () =>
    !!win && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed();

  function finish(timedOut = false) {
    if (state !== 'waiting') return;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (pendingAction) {
      const action = pendingAction;
      pendingAction = null;
      quitPending = false;
      // Back to idle, not approved: if the install fails, closing behaves as
      // before. The renderer reports not-busy before it answers; after a
      // timeout it never did, and the install's own quit must not wait on it
      // a second time.
      state = 'idle';
      if (timedOut) sessionBusy = false;
      action();
      return;
    }
    state = 'approved';
    if (quitPending) {
      quitApp();
    } else if (win && !win.isDestroyed()) {
      win.close();
    }
  }

  function askRenderer() {
    state = 'waiting';
    win.webContents.send('app:close-requested');
    timer = setTimer(() => finish(true), timeoutMs);
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
    quitPending = quit;
    askRenderer();
    return false;
  }

  return {
    /** A new main window starts a fresh handshake, and a fresh page is idle. */
    attachWindow(nextWin) {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      const action = pendingAction;
      win = nextWin;
      state = 'idle';
      quitPending = false;
      pendingAction = null;
      sessionBusy = false;
      // The page that was ending its session is gone; do not strand the action.
      if (action) action();
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
    /**
     * Runs `fn` once the renderer has ended its session (or at once when there
     * is none), in place of any close or quit waiting on the same answer. A
     * later call made while one waits replaces it, so a second click on
     * Install does not install twice.
     */
    endSessionThen(fn) {
      if (state === 'approved' || !hasLivePage() || !sessionBusy) {
        fn();
        return;
      }
      pendingAction = fn;
      if (state === 'idle') askRenderer();
    },
  };
}

module.exports = { createCloseHandshake, DEFAULT_TIMEOUT_MS };
