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

    // Disable auto-download — user must confirm
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    // Configure GitHub provider
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'kizuna-ai-lab',
      repo: 'sokuji',
    });

    this._setupAutoUpdaterEvents();
    this._setupIpcHandlers();
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
      this._sendStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      const releaseNotes = typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map(n => n.note || n).join('\n')
          : '';

      const payload = {
        status: 'available',
        version: info.version,
        releaseNotes,
      };

      // On Linux, include download URL instead of auto-download
      if (process.platform === 'linux') {
        payload.downloadUrl = `https://github.com/kizuna-ai-lab/sokuji/releases/tag/v${info.version}`;
      }

      this._updateInfo = info;
      this._sendStatus(payload);
    });

    autoUpdater.on('update-not-available', () => {
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
        return { success: false, error: 'No update available' };
      }
      try {
        await this._downloadUpdate();
        return { success: true };
      } catch (err) {
        console.error('Update download failed:', err);
        this._sendStatus({ status: 'error', message: err.message || String(err) });
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('update-install', async () => {
      if (!this.downloadPath) {
        return { success: false, error: 'No downloaded update' };
      }
      try {
        this._installUpdate();
        return { success: true };
      } catch (err) {
        console.error('Update install failed:', err);
        return { success: false, error: err.message };
      }
    });
  }

  /**
   * Download the update installer manually (Squirrel-compatible).
   * electron-updater's autoDownload doesn't work with Forge's Squirrel output,
   * so we download the .exe Setup file directly from GitHub Release assets.
   */
  _downloadUpdate() {
    return new Promise((resolve, reject) => {
      const version = this._updateInfo.version;
      const exeFileName = `Sokuji-${version}-Setup.exe`;
      const downloadUrl = `https://github.com/kizuna-ai-lab/sokuji/releases/download/v${version}/${exeFileName}`;

      const tempDir = app.getPath('temp');
      this.downloadPath = path.join(tempDir, exeFileName);

      this._sendStatus({ status: 'downloading' });

      const file = fs.createWriteStream(this.downloadPath);
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
            reject(new Error(`Download failed with status ${response.statusCode}`));
            return;
          }

          const totalBytes = parseInt(response.headers['content-length'], 10) || 0;

          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            file.write(chunk);

            if (totalBytes > 0) {
              this._sendProgress({
                percent: Math.round((receivedBytes / totalBytes) * 100),
                bytesPerSecond: 0,
                transferred: receivedBytes,
                total: totalBytes,
              });
            }
          });

          response.on('end', () => {
            file.end();
            this._sendStatus({ status: 'downloaded' });
            resolve();
          });

          response.on('error', (err) => {
            fs.unlink(this.downloadPath, () => {});
            reject(err);
          });
        }).on('error', (err) => {
          fs.unlink(this.downloadPath, () => {});
          reject(err);
        });
      };

      doRequest(downloadUrl);
    });
  }

  /**
   * Launch the downloaded Squirrel installer and quit the app.
   */
  _installUpdate() {
    const { execFile } = require('child_process');
    execFile(this.downloadPath, [], (err) => {
      if (err) {
        console.error('Failed to launch installer:', err);
      }
    });
    setTimeout(() => {
      app.quit();
    }, 1000);
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
   */
  checkAfterDelay(delayMs = 5000) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('Startup update check failed:', err);
      });
    }, delayMs);
  }
}

module.exports = { UpdateManager };
