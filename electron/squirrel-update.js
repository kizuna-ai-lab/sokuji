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

/** The feed: GitHub's "latest release" download URL, where RELEASES and the nupkg live, unless a test machine says otherwise. */
function squirrelFeedUrl({ owner, repo, env }) {
  return env.SOKUJI_UPDATE_FEED || `https://github.com/${owner}/${repo}/releases/latest/download`;
}

/** Whether this process runs from a Squirrel install: Update.exe one level above the executable's folder. */
function isSquirrelInstall({ execPath, existsSync, sep = path.sep }) {
  const appDir = execPath.slice(0, execPath.lastIndexOf(sep));
  const root = appDir.slice(0, appDir.lastIndexOf(sep));
  return existsSync(`${root}${sep}Update.exe`);
}

/** The launch right after an install: Update.exe still holds its lock and refuses updates (Electron docs). */
function isSquirrelFirstRun(argv) {
  return argv.includes('--squirrel-firstrun');
}

/**
 * One downloader over Electron's autoUpdater. `download()` resolves once
 * Squirrel has applied the package (`update-downloaded`), rejects on its
 * error or when the feed lists nothing newer; `quitAndInstall()` hands over
 * to Squirrel, which restarts into the new version.
 * @param {{ autoUpdater: import('events').EventEmitter & { setFeedURL(o: { url: string }): void, checkForUpdates(): void, quitAndInstall(): void }, feedUrl: string, onStatus: (s: object) => void }} deps
 */
function createSquirrelDownload({ autoUpdater, feedUrl, onStatus }) {
  let inFlight = null;
  return {
    download() {
      if (inFlight) return inFlight;
      inFlight = new Promise((resolve, reject) => {
        const done = (fn) => (...args) => {
          autoUpdater.removeListener('update-downloaded', onDownloaded);
          autoUpdater.removeListener('update-not-available', onNone);
          autoUpdater.removeListener('error', onError);
          inFlight = null;
          fn(...args);
        };
        const onDownloaded = done((_event, _notes, releaseName) => {
          onStatus({ status: 'downloaded' });
          resolve({ releaseName });
        });
        const onNone = done(() => reject(new Error('The update feed lists no newer version (RELEASES missing or not yet published?)')));
        const onError = done((err) => reject(err instanceof Error ? err : new Error(String(err))));
        autoUpdater.on('update-downloaded', onDownloaded);
        autoUpdater.on('update-not-available', onNone);
        autoUpdater.on('error', onError);
        autoUpdater.setFeedURL({ url: feedUrl });
        // Squirrel reports no byte counts: the renderer shows an indeterminate bar.
        onStatus({ status: 'downloading', indeterminate: true });
        autoUpdater.checkForUpdates();
      });
      return inFlight;
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
  };
}

module.exports = { squirrelFeedUrl, isSquirrelInstall, isSquirrelFirstRun, createSquirrelDownload };
