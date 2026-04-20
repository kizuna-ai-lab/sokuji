const { autoUpdater } = require('electron-updater');
const { app, ipcMain, shell } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');

class UpdateManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.downloadPath = null;
    this._updateInfo = null;
    this._downloadPromise = null;

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
      owner: 'kizuna-ai-lab',
      repo: 'sokuji',
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
      // Clear stale state before each new check
      this._updateInfo = null;
      this.downloadPath = null;
      this._sendStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      // With fullChangelog=true, releaseNotes is an array of {version, note} objects
      // where note is already HTML (rendered by GitHub). Sorted newest-first.
      let releaseNotes;
      if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes;
      } else if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes;
      } else {
        releaseNotes = '';
      }

      const payload = {
        status: 'available',
        version: info.version,
        releaseNotes,
      };

      if (process.platform === 'linux') {
        const version = info.version;
        // electron-builder names AppImage artifacts with `x86_64` (not `x64`) for
        // x64 Linux builds, and `arm64` for arm64. Translate Node's process.arch.
        const appImageArch = process.arch === 'x64' ? 'x86_64' : 'arm64';
        const debArch = process.arch === 'x64' ? 'amd64' : 'arm64';
        const base = `https://github.com/kizuna-ai-lab/sokuji/releases/download/v${version}`;

        payload.supportsAutoUpdate = this.isAppImage;
        payload.appImageUrl = `${base}/Sokuji-${version}-${appImageArch}.AppImage`;
        payload.debUrl = `${base}/sokuji_${version}_${debArch}.deb`;
        payload.releasePageUrl = `https://github.com/kizuna-ai-lab/sokuji/releases/tag/v${version}`;
        // Legacy field kept for Windows / backward compat callers of updateStore:
        if (!this.isAppImage) {
          payload.downloadUrl = payload.releasePageUrl;
        }
      }

      this._updateInfo = info;
      this._sendStatus(payload);
    });

    autoUpdater.on('update-not-available', () => {
      // Clear stale update info so a previous check's data can't trigger a download
      this._updateInfo = null;
      this.downloadPath = null;
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

      // Linux AppImage: use electron-updater's native AppImageUpdater flow
      if (process.platform === 'linux' && this.isAppImage) {
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
            this.downloadPath = '__appimage__'; // sentinel so install handler proceeds
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
      if (process.platform === 'linux' && !this.isAppImage) {
        return { success: false, error: 'auto-update-not-supported' };
      }

      // Windows (existing Squirrel-compatible manual download) — unchanged
      if (this._downloadPromise) return this._downloadPromise;
      this._downloadPromise = (async () => {
        try {
          await this._downloadUpdate();
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

      // Linux AppImage: native quitAndInstall replaces the AppImage in place
      if (process.platform === 'linux' && this.isAppImage) {
        try {
          autoUpdater.quitAndInstall();
          return { success: true };
        } catch (err) {
          this._sendStatus({ status: 'error', message: err.message || String(err) });
          return { success: false, error: err.message };
        }
      }

      // Windows (existing Squirrel launch path) — unchanged
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

      // #3: Wait for file stream to fully flush before resolving
      file.on('finish', () => {
        this._sendStatus({ status: 'downloaded' });
        resolve();
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
   * Launch the downloaded installer and quit the app.
   * #7: Use shell.openPath for reliable launch, then quit.
   */
  _installUpdate() {
    return shell.openPath(this.downloadPath).then((errorMessage) => {
      if (errorMessage) {
        throw new Error(`Failed to launch installer: ${errorMessage}`);
      }
      // Give the installer a moment to initialize, then quit
      setTimeout(() => app.quit(), 500);
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
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('Startup update check failed:', err);
        this._sendStatus({ status: 'error', message: err.message || String(err) });
      });
    }, delayMs);
  }
}

module.exports = { UpdateManager };
