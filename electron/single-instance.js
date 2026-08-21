// Single-instance enforcement.
//
// Sokuji looked single-instance on macOS and nowhere else, and the macOS
// behaviour was never ours: Launch Services refuses to start a second copy of
// the same .app bundle (`open -n` bypasses it and does start two). Windows and
// Linux have no equivalent, so every Start-menu click and every .desktop
// activation started another full process.
//
// That is not a cosmetic duplicate-window problem here, because the state a
// second process touches is system-global rather than per-process:
//
//   - PulseAudio virtual devices. Both processes run cleanupOrphanedDevices()
//     and createVirtualAudioDevices() over the same named modules.
//   - The native sidecar, whose Windows file locks are exclusive.
//
// The teardown path is worse than the startup path. removeVirtualAudioDevices()
// ends in cleanupModulesByName(), which unloads every module matching the
// sokuji_* names regardless of who created it -- so *quitting* a second
// instance tears down the first instance's audio. That is why the caller must
// drop a losing instance with app.exit(), not app.quit(): app.quit() emits
// before-quit/will-quit, which is exactly where that cleanup is wired up.

/** Set to "1" to allow several instances side by side. See below. */
const OPT_OUT_ENV = 'SOKUJI_ALLOW_MULTIPLE_INSTANCES';

/**
 * Claim the single-instance lock for this process.
 *
 * Must be called after app.setName() -- the lock lives under userData, whose
 * path is derived from the app name -- and after the Squirrel install/uninstall
 * handling, whose short-lived helper processes legitimately run alongside a
 * live app and must not be turned away.
 *
 * @param {Electron.App} app
 * @param {{ onSecondInstance?: () => void, env?: NodeJS.ProcessEnv }} [deps]
 * @returns {boolean} true if this process owns the instance and may start up;
 *   false if another instance already has it and this one must exit.
 */
function acquireSingleInstanceLock(app, { onSecondInstance, env = process.env } = {}) {
  // The dev build and the installed build both call app.setName('sokuji'), so
  // they share one userData directory and therefore one lock: without an escape
  // hatch, `npm run electron:dev` would exit on the spot whenever the installed
  // Sokuji happened to be open. Opt-in only -- two instances still fight over
  // the virtual audio devices, so this is a debugging tool, not a supported mode.
  if (env[OPT_OUT_ENV] === '1') {
    return true;
  }

  if (!app.requestSingleInstanceLock()) {
    // Electron has already handed our argv to the first instance by the time
    // this returns, which is what fires 'second-instance' over there. Nothing
    // left to register here -- this process is about to go away.
    return false;
  }

  app.on('second-instance', () => {
    // The user asked for Sokuji again; the honest answer to that is the window
    // they already have, brought to the front.
    if (onSecondInstance) onSecondInstance();
  });

  return true;
}

/**
 * Bring an existing window to the user, whatever state it was left in.
 * Null-safe: between window-all-closed and the next launch there is none.
 *
 * @param {Electron.BrowserWindow | null | undefined} win
 */
function focusWindow(win) {
  if (!win || win.isDestroyed()) return;
  // focus() on a minimized window is a no-op on Windows -- it stays in the
  // taskbar and the second launch looks like it did nothing.
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

module.exports = { acquireSingleInstanceLock, focusWindow, OPT_OUT_ENV };
