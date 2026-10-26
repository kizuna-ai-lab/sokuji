// electron/squirrel-update.js
//
// The Windows update through Squirrel's own updater. An installed app has
// `%LocalAppData%\Sokuji\Update.exe` beside its app-<version> folder; given a
// feed that serves a RELEASES file, Electron's built-in autoUpdater has it
// download the release's nupkg, check it against the SHA1 in RELEASES, and
// unpack it into app-<new version> next to the running one. The old version
// stays until the new one has run, so a failure leaves a working app — unlike
// running the full Setup.exe, whose --install deletes the install directory
// first and left one machine with no app at all (2026-10-27).
//
// Pure wiring with injected dependencies; update-manager.js owns the Electron
// objects.
const path = require('path');

/**
 * The feed: GitHub's "latest release" download URL, where RELEASES and the
 * nupkg live. `SOKUJI_UPDATE_FEED` overrides it for a test machine, but only
 * to https or a loopback host: a packaged app inherits the environment, and
 * a plain-http remote feed would hand package selection to the network.
 */
function squirrelFeedUrl({ owner, repo, env }) {
  const override = env.SOKUJI_UPDATE_FEED;
  if (override && /^(?:https:\/\/|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$))/i.test(override)) return override;
  return `https://github.com/${owner}/${repo}/releases/latest/download`;
}

/** Whether this process runs from a Squirrel install: Update.exe one level above the executable's folder. */
function isSquirrelInstall({ execPath, existsSync, sep = path.sep }) {
  const p = sep === '\\' ? path.win32 : path.posix;
  const appDir = p.dirname(execPath);
  if (appDir === '.' || appDir === execPath) return false; // a bare name: nowhere to look
  return existsSync(p.join(p.dirname(appDir), 'Update.exe'));
}

/** The launch right after an install: Update.exe still holds its lock and refuses updates (Electron docs). */
function isSquirrelFirstRun(argv) {
  return argv.includes('--squirrel-firstrun');
}

/**
 * One downloader over Electron's autoUpdater. `download()` resolves once
 * Squirrel has applied the package (`update-downloaded`), rejects on its
 * error or when the feed lists nothing newer; a package already applied in
 * this process is remembered, so a later download (after a re-check cleared
 * the renderer's state) resolves at once instead of asking Squirrel, which
 * would now answer "nothing newer". `quitAndInstall()` hands over to
 * Squirrel, which restarts into the new version.
 * @param {{ autoUpdater: import('events').EventEmitter & { setFeedURL(o: { url: string }): void, checkForUpdates(): void, quitAndInstall(): void }, feedUrl: string, onStatus: (s: object) => void }} deps
 */
function createSquirrelDownload({ autoUpdater, feedUrl, onStatus }) {
  let inFlight = null;
  let applied = null;
  return {
    /** The package Squirrel has applied in this process, if any. */
    applied() {
      return applied;
    },
    download() {
      if (applied) {
        onStatus({ status: 'downloaded' });
        return Promise.resolve(applied);
      }
      if (inFlight) return inFlight;
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      // Assigned before anything can settle it: a synchronous throw below
      // must clear it, not be overwritten by a later assignment.
      inFlight = promise;
      const done = (fn) => (...args) => {
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('update-not-available', onNone);
        autoUpdater.removeListener('error', onError);
        inFlight = null;
        fn(...args);
      };
      const onDownloaded = done((_event, _notes, releaseName) => {
        applied = { releaseName };
        onStatus({ status: 'downloaded' });
        resolve(applied);
      });
      const onNone = done(() => reject(new Error('The update feed lists no version newer than the installed one')));
      const onError = done((err) => reject(err instanceof Error ? err : new Error(String(err))));
      autoUpdater.on('update-downloaded', onDownloaded);
      autoUpdater.on('update-not-available', onNone);
      autoUpdater.on('error', onError);
      try {
        autoUpdater.setFeedURL({ url: feedUrl });
        // Squirrel reports no byte counts: the renderer shows an indeterminate bar.
        onStatus({ status: 'downloading', indeterminate: true });
        autoUpdater.checkForUpdates();
      } catch (err) {
        onError(err);
      }
      return promise;
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
  };
}

module.exports = { squirrelFeedUrl, isSquirrelInstall, isSquirrelFirstRun, createSquirrelDownload };
