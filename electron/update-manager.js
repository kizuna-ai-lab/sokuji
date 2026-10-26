const { autoUpdater } = require('electron-updater');
const { buildUpdatePayload, usesNativeUpdaterFlow } = require('./update-payload');
const { app, ipcMain, autoUpdater: squirrelAutoUpdater } = require('electron');
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { verifyDownloadedInstaller, installerLaunchCommand, staleInstallers, isInstallerName } = require('./update-install-windows');
const { squirrelFeedUrl, isSquirrelInstall, isSquirrelFirstRun, createSquirrelDownload } = require('./squirrel-update');

/** `downloadPath` once Squirrel has applied a package itself: there is no file of ours to run. */
const SQUIRREL_APPLIED = '__squirrel__';
/** Where releases live: the check (electron-updater) and the Windows feed (Squirrel) read the same repository. */
const GITHUB_REPO = { owner: 'kizuna-ai-lab', repo: 'sokuji' };
/** A Setup.exe in the temp directory older than this is a leftover, never a download in progress. */
const STALE_INSTALLER_AGE_MS = 24 * 60 * 60 * 1000;

class UpdateManager {
  /**
   * @param {object} [options]
   * @param {(proceed: () => void) => void} [options.beforeInstall] - Called
   *   before an install starts; the install runs once it calls `proceed`.
   *   main.js ends a running session there first, so the install's own quit
   *   is not held by the close handshake.
   */
  constructor(mainWindow, { beforeInstall = (fn) => fn() } = {}) {
    this.mainWindow = mainWindow;
    this.beforeInstall = beforeInstall;
    this.downloadPath = null;
    this._updateInfo = null;
    this._downloadPromise = null;
    // Windows: Squirrel's own updater when this is a Squirrel install (new
    // version unpacked beside the running one, old one kept — see
    // electron/squirrel-update.js); the full Setup.exe stays as the fallback.
    this._installing = false;
    this._squirrel = process.platform === 'win32' && isSquirrelInstall({ execPath: process.execPath, existsSync: fs.existsSync })
      ? createSquirrelDownload({
          autoUpdater: squirrelAutoUpdater,
          feedUrl: squirrelFeedUrl({ ...GITHUB_REPO, env: process.env }),
          onStatus: (s) => this._sendStatus(s),
        })
      : null;
    if (process.platform === 'win32') this._removeStaleInstallers();

    // Disable auto-download — user must confirm
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Include release notes for all versions between current and latest
    autoUpdater.fullChangelog = true;

    this.isAppImage = process.platform === 'linux' && !!process.env.APPIMAGE;

    // Log once at startup for easier debugging
    if (process.platform === 'linux') {
      console.log(`[Sokuji] [UpdateManager] Linux runtime: isAppImage=${this.isAppImage}, APPIMAGE=${process.env.APPIMAGE || '<unset>'}`);
    }

    // Configure GitHub provider
    autoUpdater.setFeedURL({
      provider: 'github',
      ...GITHUB_REPO,
    });

    this._setupAutoUpdaterEvents();
    this._setupIpcHandlers();
  }

  /**
   * Update the mainWindow reference (e.g. after macOS window recreation).
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  _sendStatus(payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', payload);
    }
  }

  _sendProgress(payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-progress', payload);
    }
  }

  _setupAutoUpdaterEvents() {
    autoUpdater.on('checking-for-update', () => {
      // Clear stale state before each new check — except a package Squirrel
      // has already applied: it will run on the next launch whatever the
      // check says, and Install must stay reachable.
      this._updateInfo = null;
      if (this.downloadPath !== SQUIRREL_APPLIED) this.downloadPath = null;
      this._sendStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      const payload = buildUpdatePayload(info, {
        platform: process.platform,
        arch: process.arch,
        isAppImage: this.isAppImage,
      });

      this._updateInfo = info;
      this._sendStatus(payload);
    });

    autoUpdater.on('update-not-available', () => {
      // Clear stale update info so a previous check's data can't trigger a download
      this._updateInfo = null;
      if (this.downloadPath !== SQUIRREL_APPLIED) this.downloadPath = null;
      this._sendStatus({ status: 'not-available' });
    });

    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err);
      this._sendStatus({ status: 'error', message: err.message || String(err) });
    });
  }

  _setupIpcHandlers() {
    ipcMain.handle('update-check', async () => {
      try {
        await autoUpdater.checkForUpdates();
        return { success: true };
      } catch (err) {
        console.error('Update check failed:', err);
        this._sendStatus({ status: 'error', message: err.message || String(err) });
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('update-download', async () => {
      if (!this._updateInfo) {
        this._sendStatus({ status: 'error', message: 'No update available to download' });
        return { success: false, error: 'No update available' };
      }

      // Platforms electron-updater can install in place: Linux AppImage, and
      // macOS now that builds carry a stable signature (docs/build/macos-auto-update.md).
      if (usesNativeUpdaterFlow({ platform: process.platform, isAppImage: this.isAppImage })) {
        if (this._downloadPromise) return this._downloadPromise;

        // Hook download-progress events from autoUpdater to IPC
        const onProgress = (p) => this._sendProgress({
          percent: p.percent || 0,
          bytesPerSecond: p.bytesPerSecond || 0,
          transferred: p.transferred || 0,
          total: p.total || 0,
        });
        const onDownloaded = () => this._sendStatus({ status: 'downloaded' });

        this._downloadPromise = (async () => {
          this._sendStatus({ status: 'downloading' });
          autoUpdater.on('download-progress', onProgress);
          autoUpdater.once('update-downloaded', onDownloaded);

          try {
            await autoUpdater.downloadUpdate();
            // `update-downloaded` event is what flips status to 'downloaded';
            // it also populates this.downloadPath implicitly via electron-updater.
            this.downloadPath = '__native__'; // sentinel so install handler proceeds
            return { success: true };
          } catch (err) {
            this._sendStatus({ status: 'error', message: err.message || String(err) });
            return { success: false, error: err.message };
          } finally {
            autoUpdater.removeListener('download-progress', onProgress);
            // removeListener on a `.once` registration is a no-op if it already fired
            autoUpdater.removeListener('update-downloaded', onDownloaded);
            this._downloadPromise = null;
          }
        })();
        return this._downloadPromise;
      }

      // Non-AppImage Linux: no auto-download; renderer opens links manually
      if (process.platform === 'linux') {
        return { success: false, error: 'auto-update-not-supported' };
      }

      // Windows: Squirrel downloads, verifies and unpacks the package itself;
      // without Update.exe, the Setup.exe fallback.
      if (this._downloadPromise) return this._downloadPromise;
      this._downloadPromise = (async () => {
        try {
          if (this._squirrel) {
            await this._squirrel.download();
            this.downloadPath = SQUIRREL_APPLIED;
          } else {
            await this._downloadUpdate();
          }
          return { success: true };
        } catch (err) {
          console.error('Update download failed:', err);
          this._sendStatus({ status: 'error', message: err.message || String(err) });
          return { success: false, error: err.message };
        } finally {
          this._downloadPromise = null;
        }
      })();
      return this._downloadPromise;
    });

    ipcMain.handle('update-install', async () => {
      if (!this.downloadPath) {
        this._sendStatus({ status: 'error', message: 'No downloaded update to install' });
        return { success: false, error: 'No downloaded update' };
      }

      await new Promise((resolve) => this.beforeInstall(resolve));

      // Native flow: quitAndInstall replaces the AppImage / .app bundle in place.
      // On macOS electron-updater hands the downloaded zip to Squirrel.Mac,
      // which swaps the bundle after the app quits.
      if (usesNativeUpdaterFlow({ platform: process.platform, isAppImage: this.isAppImage })) {
        try {
          autoUpdater.quitAndInstall();
          return { success: true };
        } catch (err) {
          this._sendStatus({ status: 'error', message: err.message || String(err) });
          return { success: false, error: err.message };
        }
      }

      // Windows: Squirrel restarts into the applied package, or the fallback
      // runs Setup.exe once every Sokuji process has exited.
      try {
        await this._installUpdate();
        return { success: true };
      } catch (err) {
        console.error('Update install failed:', err);
        this._sendStatus({ status: 'error', message: err.message || String(err) });
        return { success: false, error: err.message };
      }
    });
  }

  /**
   * Resolve the .exe download URL from update info.
   * #8: Dynamically resolve filename from info.files if available,
   * falling back to constructed name.
   */
  _resolveDownloadUrl() {
    const version = this._updateInfo.version;
    const files = this._updateInfo.files || [];

    // Try to find .exe from the update info files array
    const exeFile = files.find(f => f.url && f.url.endsWith('.exe'));
    if (exeFile) {
      return {
        fileName: exeFile.url,
        url: `https://github.com/kizuna-ai-lab/sokuji/releases/download/v${version}/${exeFile.url}`,
      };
    }

    // Fallback: matches Squirrel's naming with dots (spaces are replaced in CI)
    const exeFileName = `Sokuji-${version}.Setup.exe`;
    return {
      fileName: exeFileName,
      url: `https://github.com/kizuna-ai-lab/sokuji/releases/download/v${version}/${exeFileName}`,
    };
  }

  /**
   * Download the update installer manually (Squirrel-compatible).
   * electron-updater's autoDownload doesn't work with Forge's Squirrel output,
   * so we download the .exe Setup file directly from GitHub Release assets.
   */
  _downloadUpdate() {
    return new Promise((resolve, reject) => {
      const { fileName, url: downloadUrl } = this._resolveDownloadUrl();
      // What latest.yml announced for this file, read now: a check that lands
      // while the stream runs replaces _updateInfo with another version's.
      const expected = ((this._updateInfo && this._updateInfo.files) || []).find((f) => f.url === fileName) || {};

      const tempDir = app.getPath('temp');
      this.downloadPath = path.join(tempDir, fileName);

      this._sendStatus({ status: 'downloading' });

      const file = fs.createWriteStream(this.downloadPath);

      // #5: Handle file stream errors
      file.on('error', (err) => {
        console.error('File write error:', err);
        fs.unlink(this.downloadPath, () => {});
        reject(err);
      });

      // #3: Wait for file stream to fully flush, then check the file against
      // what latest.yml announced: a truncated, altered or unannounced
      // installer is never run.
      file.on('finish', () => {
        const discard = (reason) => {
          fs.unlink(this.downloadPath, () => {});
          this.downloadPath = null;
          reject(new Error(`Downloaded installer rejected: ${reason}`));
        };
        verifyDownloadedInstaller(this.downloadPath, { size: expected.size, sha512: expected.sha512 }).then((check) => {
          if (!check.ok) return discard(check.reason);
          this._sendStatus({ status: 'downloaded' });
          resolve();
        }, (err) => discard(err.message || String(err)));
      });

      let receivedBytes = 0;

      const doRequest = (url) => {
        https.get(url, (response) => {
          // Handle redirects (GitHub releases redirect to CDN)
          if (response.statusCode === 302 || response.statusCode === 301) {
            response.resume(); // Drain the redirect response to free the socket
            doRequest(response.headers.location);
            return;
          }

          if (response.statusCode !== 200) {
            file.destroy();
            fs.unlink(this.downloadPath, () => {});
            reject(new Error(`Download failed with status ${response.statusCode}`));
            return;
          }

          const totalBytes = parseInt(response.headers['content-length'], 10) || 0;

          // #5: Use pipe for backpressure handling
          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              this._sendProgress({
                percent: Math.round((receivedBytes / totalBytes) * 100),
                bytesPerSecond: 0,
                transferred: receivedBytes,
                total: totalBytes,
              });
            }
          });

          response.pipe(file);

          response.on('error', (err) => {
            file.destroy();
            fs.unlink(this.downloadPath, () => {});
            reject(err);
          });
        }).on('error', (err) => {
          file.destroy();
          fs.unlink(this.downloadPath, () => {});
          reject(err);
        });
      };

      doRequest(downloadUrl);
    });
  }

  /**
   * Install what was downloaded. Squirrel: hand over, it restarts the app
   * from app-<new version>. Setup.exe fallback: its --install deletes the
   * install directory before writing the new version, so it must not start
   * until every Sokuji process is gone — a detached PowerShell waits for that,
   * then runs it (electron/update-install-windows.js). Opening the installer
   * and quitting 500 ms later is what left a machine with no app (2026-10-27).
   */
  _installUpdate() {
    if (this.downloadPath === SQUIRREL_APPLIED) {
      this._squirrel.quitAndInstall();
      return Promise.resolve();
    }
    if (this._installing) return Promise.resolve(); // a second click must not spawn a second installer
    this._installing = true;
    return new Promise((resolve, reject) => {
      const { file, args } = installerLaunchCommand({
        installerPath: this.downloadPath,
        pid: process.pid,
        installRoot: path.resolve(path.dirname(process.execPath), '..'),
        systemRoot: process.env.SystemRoot || 'C:\\Windows',
      });
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', (err) => {
        this._installing = false;
        reject(new Error(`Failed to launch installer: ${err.message}`));
      });
      child.once('spawn', () => {
        // From here the helper is on its own: a failure inside its script is
        // written to <installer>.launch.log, and the app has already left.
        child.unref();
        app.quit();
        resolve();
      });
    });
  }

  /**
   * Every update left its Setup.exe in the temp directory (a dozen of
   * 150–280 MB each on one machine). Best effort, at startup.
   */
  _removeStaleInstallers() {
    const tempDir = app.getPath('temp');
    fs.readdir(tempDir, (err, names) => {
      if (err) return;
      const entries = [];
      for (const name of names) {
        if (!isInstallerName(name)) continue;
        try { entries.push({ name, mtimeMs: fs.statSync(path.join(tempDir, name)).mtimeMs }); } catch { /* gone already */ }
      }
      for (const name of staleInstallers(entries, { now: Date.now(), maxAgeMs: STALE_INSTALLER_AGE_MS })) {
        fs.unlink(path.join(tempDir, name), () => {});
      }
    });
  }

  /**
   * Public method to check for updates (used by Help menu).
   */
  checkForUpdates() {
    return autoUpdater.checkForUpdates().catch((err) => {
      console.error('Update check failed:', err);
      this._sendStatus({ status: 'error', message: err.message || String(err) });
    });
  }

  /**
   * Check for updates with a delay (used at startup).
   * #10: Send error status to renderer on failure (consistent with manual check).
   */
  checkAfterDelay(delayMs = 5000) {
    if (isSquirrelFirstRun(process.argv)) {
      // The launch right after an install. The check itself is an HTTPS read,
      // but a download it led to would run Update.exe while the install still
      // holds its lock (Electron docs); the next launch checks as usual.
      console.log('[Sokuji] [UpdateManager] first run after install: skipping the startup update check');
      return;
    }
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('Startup update check failed:', err);
        this._sendStatus({ status: 'error', message: err.message || String(err) });
      });
    }, delayMs);
  }
}

module.exports = { UpdateManager };
