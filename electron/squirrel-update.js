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

const LOOPBACK_RE = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;

/**
 * The feed: GitHub's "latest release" download URL, where RELEASES and the
 * nupkg live. `SOKUJI_UPDATE_FEED` overrides it for a test machine. A
 * packaged app inherits its environment, and Squirrel trusts whatever the
 * feed's RELEASES names, so a packaged build accepts only a loopback feed
 * (a server on the same machine); a development run also accepts https.
 */
function squirrelFeedUrl({ owner, repo, env, isPackaged = true }) {
  const override = env.SOKUJI_UPDATE_FEED;
  if (override && (LOOPBACK_RE.test(override) || (!isPackaged && /^https:\/\//i.test(override)))) return override;
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
 * One downloader over Electron's autoUpdater. `download({ version })`
 * resolves once Squirrel has applied the package (`update-downloaded`),
 * rejects on its error or when the feed lists nothing newer. A package
 * already applied in this process is remembered: a later download of the
 * same version (after a re-check cleared the renderer's state) resolves at
 * once instead of asking Squirrel, which would now answer "nothing newer";
 * a different version asks again. `quitAndInstall()` hands over to
 * Squirrel, which restarts into the new version.
 *
 * A permanent `error` listener is installed at creation: Node throws on an
 * `error` event with no listener, and Squirrel can still emit one after a
 * download has settled (quitAndInstall, a late failure).
 * @param {{ autoUpdater: import('events').EventEmitter & { setFeedURL(o: { url: string }): void, checkForUpdates(): void, quitAndInstall(): void }, feedUrl: string, onStatus: (s: object) => void, onError?: (e: Error) => void }} deps
 */
function createSquirrelDownload({
  autoUpdater,
  feedUrl,
  onStatus,
  onError = (e) => console.error('[Sokuji] Squirrel updater error:', e),
  timers = { setTimeout, clearTimeout },
  downloadTimeoutMs = 60 * 60 * 1000,
}) {
  let inFlight = null;
  let applied = null;
  let lastWanted;
  // A late error (after quitAndInstall, or with no download running) has no
  // other listener; one a download is handling is not reported twice.
  autoUpdater.on('error', (err) => {
    if (!inFlight) onError(err instanceof Error ? err : new Error(String(err)));
  });
  // Squirrel finishing after a download gave up (slow, not dead): the package
  // is staged, and the next download must know rather than ask again.
  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
    if (!inFlight) applied = { releaseName, version: lastWanted };
  });
  const normalize = (v) => (typeof v === 'string' ? v.replace(/^v/i, '') : v);
  return {
    /** The package Squirrel has applied in this process, if any: Squirrel's release name and the version the check asked for. */
    applied() {
      return applied;
    },
    download({ version } = {}) {
      const wanted = normalize(version);
      lastWanted = wanted;
      // The check now names a different version than the one applied: ask again.
      if (applied && wanted && applied.version && applied.version !== wanted) applied = null;
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
      let timer = null;
      const done = (fn) => (...args) => {
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('update-not-available', onNone);
        autoUpdater.removeListener('error', onFail);
        if (timer !== null) timers.clearTimeout(timer);
        inFlight = null;
        fn(...args);
      };
      const onDownloaded = done((_event, _notes, releaseName) => {
        applied = { releaseName, version: wanted };
        onStatus({ status: 'downloaded' });
        resolve(applied);
      });
      const onNone = done(() => reject(new Error('The update feed lists no version newer than the installed one')));
      const onFail = done((err) => reject(err instanceof Error ? err : new Error(String(err))));
      autoUpdater.on('update-downloaded', onDownloaded);
      autoUpdater.on('update-not-available', onNone);
      autoUpdater.on('error', onFail);
      // Squirrel reports no progress; a download it never reports on would
      // otherwise hold the renderer's bar and this promise forever.
      timer = timers.setTimeout(() => onFail(new Error(`Squirrel reported nothing for ${Math.round(downloadTimeoutMs / 60000)} minutes; giving up on this download`)), downloadTimeoutMs);
      try {
        autoUpdater.setFeedURL({ url: feedUrl });
        // Squirrel reports no byte counts: the renderer shows an indeterminate bar.
        onStatus({ status: 'downloading', indeterminate: true });
        autoUpdater.checkForUpdates();
      } catch (err) {
        onFail(err);
      }
      return promise;
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
  };
}

module.exports = { squirrelFeedUrl, isSquirrelInstall, isSquirrelFirstRun, createSquirrelDownload };
