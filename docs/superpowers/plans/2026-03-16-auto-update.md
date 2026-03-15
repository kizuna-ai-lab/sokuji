# Auto-Update System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-update to the Sokuji Electron app — version check via `electron-updater` + GitHub Releases, manual download/install via Squirrel, with banner + dialog UI.

**Architecture:** UpdateManager (main process) wraps `electron-updater` for version checking and handles download/install manually due to Squirrel incompatibility. Renderer communicates via IPC through existing `window.electron` bridge. Zustand `updateStore` drives UpdateBanner and UpdateDialog components.

**Tech Stack:** electron-updater, Zustand, React, i18next, Electron IPC, GitHub Releases API

**Spec:** `docs/superpowers/specs/2026-03-16-auto-update-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `electron/update-manager.js` | Main process: wraps electron-updater for version check, handles download via https, install via Squirrel |
| `src/stores/updateStore.ts` | Zustand store: update status, progress, actions, IPC listener lifecycle |
| `src/components/UpdateBanner/UpdateBanner.tsx` | Non-intrusive top banner for update notifications |
| `src/components/UpdateBanner/UpdateBanner.scss` | Banner styles |
| `src/components/UpdateDialog/UpdateDialog.tsx` | Modal dialog with changelog, progress, action buttons |
| `src/components/UpdateDialog/UpdateDialog.scss` | Dialog styles |
| `src/components/Settings/sections/UpdateSection.tsx` | "Check for Updates" button for SimpleSettings |

### Modified Files
| File | Changes |
|------|---------|
| `package.json` | Add `electron-updater` dependency |
| `electron/preload.js` | Add update channels to allowlists (lines 57-64 and 101-127) |
| `electron/main.js` | Import UpdateManager, add Help menu item, register IPC handlers, startup check |
| `src/components/Settings/sections/index.ts` | Export UpdateSection |
| `src/components/Settings/SimpleSettings/SimpleSettings.tsx` | Add UpdateSection at bottom |
| `src/components/MainPanel/MainPanel.tsx` | Render UpdateBanner above conversation area (line ~2492) |
| `src/locales/en/translation.json` | Add `update` namespace keys |
| `src/locales/{30 other dirs}/translation.json` | Add `update` namespace keys (English fallback) |
| `.github/workflows/build.yml` | Change `draft: false` to `draft: true`, add `latest.yml` generation step |

---

## Chunk 1: Foundation — Dependency, IPC Plumbing, UpdateManager

### Task 1: Install electron-updater

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install electron-updater**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/auto-update-design
npm install electron-updater
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('electron-updater')" 2>&1 || echo "OK - electron main process module"
grep '"electron-updater"' package.json
```

Expected: `electron-updater` appears in `dependencies` in package.json.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add electron-updater dependency"
```

---

### Task 2: Add IPC channels to preload allowlists

**Files:**
- Modify: `electron/preload.js` (lines 57-64 for validReceiveChannels, lines 101-127 for validChannels in invoke)

- [ ] **Step 1: Add receive channels**

In `electron/preload.js`, add to the `validReceiveChannels` array (after line 63, before the closing `]`):

```javascript
  // Auto-update channels (main → renderer)
  'update-status',
  'update-progress',
```

- [ ] **Step 2: Add invoke channels**

In `electron/preload.js`, add to the `validChannels` array inside the `invoke` method (after line 126, before the closing `]`):

```javascript
      // Auto-update channels (renderer → main)
      'update-check',
      'update-download',
      'update-install',
      'get-app-version',
```

- [ ] **Step 3: Verify the file is syntactically correct**

```bash
node -c electron/preload.js
```

Expected: No syntax errors.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.js
git commit -m "feat(update): add auto-update IPC channels to preload allowlists"
```

---

### Task 3: Create UpdateManager module

**Files:**
- Create: `electron/update-manager.js`

- [ ] **Step 1: Create the UpdateManager module**

Create `electron/update-manager.js` with:

```javascript
const { autoUpdater } = require('electron-updater');
const { app, ipcMain, shell } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');

class UpdateManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.downloadPath = null;

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

      // Store info for later download
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
      // Find the .exe asset URL from the release info
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
                bytesPerSecond: 0, // Simplified — could add rate calculation
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
    // Launch the setup exe — Squirrel handles the rest
    execFile(this.downloadPath, [], (err) => {
      if (err) {
        console.error('Failed to launch installer:', err);
      }
    });
    // Give the installer a moment to start, then quit
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
```

- [ ] **Step 2: Verify syntax**

```bash
node -c electron/update-manager.js
```

Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add electron/update-manager.js
git commit -m "feat(update): create UpdateManager module for version check and download"
```

---

### Task 4: Integrate UpdateManager into main process

**Files:**
- Modify: `electron/main.js` (imports at top, menu at lines 175-212, app.ready at lines 345-420)

- [ ] **Step 1: Add import at top of main.js**

After the existing local imports (around line 12), add:

```javascript
const { UpdateManager } = require('./update-manager');
```

- [ ] **Step 2: Add "Check for Updates..." to Help menu**

In `createApplicationMenu()`, find the Help menu submenu (around line 178). Add a "Check for Updates..." item. The Help menu structure differs per platform:

On **Windows/Linux** (non-macOS), the Help menu has "About Sokuji" first. Add after it:

```javascript
{
  type: 'separator'
},
{
  label: 'Check for Updates...',
  click: () => {
    if (global.updateManager) {
      global.updateManager.checkForUpdates();
    }
  }
},
```

On **macOS**, where About is in the app menu, add "Check for Updates..." at the top of the Help submenu.

Refer to the existing menu structure at lines 175-212 for exact placement.

- [ ] **Step 3: Register get-app-version IPC handler and initialize UpdateManager**

In `electron/main.js`, add a handler for the app version (needed by UpdateDialog to display current version). Place this near the other IPC handlers:

```javascript
ipcMain.handle('get-app-version', () => app.getVersion());
```

Then in the `app.whenReady()` handler (around line 400, after `mainWindow` is created and menu is set), add:

```javascript
// Initialize auto-update manager
global.updateManager = new UpdateManager(mainWindow);
global.updateManager.checkAfterDelay(5000);
```

- [ ] **Step 4: Verify syntax**

```bash
node -c electron/main.js
```

Expected: No syntax errors.

- [ ] **Step 5: Commit**

```bash
git add electron/main.js
git commit -m "feat(update): integrate UpdateManager into main process with Help menu item"
```

---

## Chunk 2: Renderer — Store + i18n

### Task 5: Create updateStore

**Files:**
- Create: `src/stores/updateStore.ts`

- [ ] **Step 1: Create the Zustand store**

Create `src/stores/updateStore.ts`:

```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { isElectron } from '../utils/environment';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';

interface UpdateState {
  status: UpdateStatus;
  newVersion: string | null;
  changelog: string | null;
  downloadProgress: number;
  downloadSpeed: number;
  downloadTransferred: number;
  downloadTotal: number;
  errorMessage: string | null;
  downloadUrl: string | null;
  bannerDismissed: boolean;
  dialogOpen: boolean;
}

interface UpdateActions {
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  dismissBanner: () => void;
  openDialog: () => void;
  closeDialog: () => void;
  initListeners: () => void;
  cleanupListeners: () => void;
}

type UpdateStore = UpdateState & UpdateActions;

// Store handler references for cleanup
let statusHandler: ((...args: any[]) => void) | null = null;
let progressHandler: ((...args: any[]) => void) | null = null;

const useUpdateStore = create<UpdateStore>()(
  subscribeWithSelector((set) => ({
    // State
    status: 'idle',
    newVersion: null,
    changelog: null,
    downloadProgress: 0,
    downloadSpeed: 0,
    downloadTransferred: 0,
    downloadTotal: 0,
    errorMessage: null,
    downloadUrl: null,
    bannerDismissed: false,
    dialogOpen: false,

    // Actions
    checkForUpdates: () => {
      if (!isElectron()) return;
      set({ status: 'checking', bannerDismissed: false });
      (window as any).electron?.invoke('update-check');
    },

    downloadUpdate: () => {
      if (!isElectron()) return;
      (window as any).electron?.invoke('update-download');
    },

    installUpdate: () => {
      if (!isElectron()) return;
      (window as any).electron?.invoke('update-install');
    },

    dismissBanner: () => set({ bannerDismissed: true }),
    openDialog: () => set({ dialogOpen: true }),
    closeDialog: () => set({ dialogOpen: false }),

    initListeners: () => {
      if (!isElectron()) return;
      const electron = (window as any).electron;
      if (!electron) return;

      statusHandler = (data: any) => {
        const update: Partial<UpdateState> = { status: data.status };
        if (data.version) update.newVersion = data.version;
        if (data.releaseNotes !== undefined) update.changelog = data.releaseNotes;
        if (data.message) update.errorMessage = data.message;
        if (data.downloadUrl) update.downloadUrl = data.downloadUrl;

        // Reset banner dismissed when new update is available
        if (data.status === 'available') {
          update.bannerDismissed = false;
        }

        // Auto-hide error after 5 seconds
        if (data.status === 'error') {
          setTimeout(() => {
            useUpdateStore.setState({ status: 'idle', errorMessage: null });
          }, 5000);
        }

        set(update);
      };

      progressHandler = (data: any) => {
        set({
          downloadProgress: data.percent || 0,
          downloadSpeed: data.bytesPerSecond || 0,
          downloadTransferred: data.transferred || 0,
          downloadTotal: data.total || 0,
        });
      };

      electron.receive('update-status', statusHandler);
      electron.receive('update-progress', progressHandler);
    },

    cleanupListeners: () => {
      if (!isElectron()) return;
      const electron = (window as any).electron;
      if (!electron) return;

      if (statusHandler) {
        electron.removeListener('update-status', statusHandler);
        statusHandler = null;
      }
      if (progressHandler) {
        electron.removeListener('update-progress', progressHandler);
        progressHandler = null;
      }
    },
  }))
);

// Individual selectors (following logStore.ts pattern — avoids new object refs on every render)
export const useUpdateStatus = () => useUpdateStore(state => state.status);
export const useUpdateNewVersion = () => useUpdateStore(state => state.newVersion);
export const useUpdateChangelog = () => useUpdateStore(state => state.changelog);
export const useUpdateProgressPercent = () => useUpdateStore(state => state.downloadProgress);
export const useUpdateProgressSpeed = () => useUpdateStore(state => state.downloadSpeed);
export const useUpdateProgressTransferred = () => useUpdateStore(state => state.downloadTransferred);
export const useUpdateProgressTotal = () => useUpdateStore(state => state.downloadTotal);
export const useUpdateError = () => useUpdateStore(state => state.errorMessage);
export const useUpdateDownloadUrl = () => useUpdateStore(state => state.downloadUrl);
export const useUpdateBannerDismissed = () => useUpdateStore(state => state.bannerDismissed);
export const useUpdateDialogOpen = () => useUpdateStore(state => state.dialogOpen);

// Individual action selectors (stable references — safe for useEffect deps)
export const useCheckForUpdates = () => useUpdateStore(state => state.checkForUpdates);
export const useDismissBanner = () => useUpdateStore(state => state.dismissBanner);
export const useOpenUpdateDialog = () => useUpdateStore(state => state.openDialog);
export const useCloseUpdateDialog = () => useUpdateStore(state => state.closeDialog);
export const useDownloadUpdate = () => useUpdateStore(state => state.downloadUpdate);
export const useInstallUpdate = () => useUpdateStore(state => state.installUpdate);
export const useInitUpdateListeners = () => useUpdateStore(state => state.initListeners);
export const useCleanupUpdateListeners = () => useUpdateStore(state => state.cleanupListeners);

export default useUpdateStore;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/stores/updateStore.ts 2>&1 | head -20
```

Note: May show import errors due to module resolution — that's OK at this stage. Check for logical/type errors only.

- [ ] **Step 3: Commit**

```bash
git add src/stores/updateStore.ts
git commit -m "feat(update): create Zustand updateStore with IPC bridge"
```

---

### Task 6: Add i18n keys

**Files:**
- Modify: `src/locales/en/translation.json`
- Modify: `src/locales/{30 other dirs}/translation.json` (English fallback values)

- [ ] **Step 1: Add update keys to English translation**

Add a new top-level `"update"` section to `src/locales/en/translation.json` (before the closing `}`):

```json
  "update": {
    "available": "New version v{{version}} available",
    "downloading": "Downloading update... {{percent}}%",
    "downloaded": "Update ready, restart to complete",
    "checkButton": "Check for Updates",
    "checking": "Checking...",
    "upToDate": "Up to date",
    "notAvailable": "You're running the latest version",
    "downloadNow": "Download Now",
    "later": "Later",
    "restartNow": "Restart and Update",
    "goToDownload": "Go to Download",
    "error": "Failed to check for updates",
    "errorWithMessage": "Update error: {{message}}",
    "currentVersion": "Current version: v{{version}}",
    "newVersion": "New version: v{{version}}"
  }
```

- [ ] **Step 2: Add the same keys to all other locale files**

For each of the 30 other locale directories under `src/locales/`, add the same `"update"` section with English values. i18next will use these as fallback; proper translations can be added later.

Use a script:

```bash
for dir in src/locales/*/; do
  lang=$(basename "$dir")
  if [ "$lang" != "en" ]; then
    # Add update section before closing brace if not already present
    if ! grep -q '"update"' "$dir/translation.json"; then
      # Use node for reliable JSON manipulation
      node -e "
        const fs = require('fs');
        const p = '${dir}translation.json';
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        data.update = {
          available: 'New version v{{version}} available',
          downloading: 'Downloading update... {{percent}}%',
          downloaded: 'Update ready, restart to complete',
          checkButton: 'Check for Updates',
          checking: 'Checking...',
          upToDate: 'Up to date',
          notAvailable: \"You're running the latest version\",
          downloadNow: 'Download Now',
          later: 'Later',
          restartNow: 'Restart and Update',
          goToDownload: 'Go to Download',
          error: 'Failed to check for updates',
          errorWithMessage: 'Update error: {{message}}',
          currentVersion: 'Current version: v{{version}}',
          newVersion: 'New version: v{{version}}'
        };
        fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
      "
    fi
  fi
done
```

- [ ] **Step 3: Verify JSON validity**

```bash
for f in src/locales/*/translation.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" && echo "OK: $f"; done
```

Expected: All files report OK.

- [ ] **Step 4: Commit**

```bash
git add src/locales/
git commit -m "feat(update): add i18n keys for auto-update UI (all locales)"
```

---

## Chunk 3: UI Components

### Task 7: Create UpdateBanner component

**Files:**
- Create: `src/components/UpdateBanner/UpdateBanner.tsx`
- Create: `src/components/UpdateBanner/UpdateBanner.scss`

- [ ] **Step 1: Create UpdateBanner.tsx**

```typescript
import React from 'react';
import { Download, RefreshCw, X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useUpdateStatus,
  useUpdateNewVersion,
  useUpdateProgressPercent,
  useUpdateError,
  useUpdateBannerDismissed,
  useDismissBanner,
  useOpenUpdateDialog,
  useInstallUpdate,
} from '../../stores/updateStore';
import './UpdateBanner.scss';

const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const newVersion = useUpdateNewVersion();
  const percent = useUpdateProgressPercent();
  const errorMessage = useUpdateError();
  const bannerDismissed = useUpdateBannerDismissed();
  const dismissBanner = useDismissBanner();
  const openDialog = useOpenUpdateDialog();
  const installUpdate = useInstallUpdate();

  // Don't show banner for idle, checking, or not-available states
  if (status === 'idle' || status === 'checking' || status === 'not-available') {
    return null;
  }

  // Don't show if user dismissed for this session
  if (bannerDismissed && status !== 'downloading' && status !== 'downloaded') {
    return null;
  }

  // Error state — auto-hides via store timeout
  if (status === 'error') {
    return (
      <div className="update-banner error">
        <div className="update-banner-content">
          <AlertCircle size={14} />
          <span>{errorMessage || t('update.error')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`update-banner ${status}`}>
      <div
        className="update-banner-content"
        onClick={() => {
          if (status === 'available') openDialog();
          if (status === 'downloaded') installUpdate();
        }}
        role="button"
        tabIndex={0}
      >
        {status === 'available' && (
          <>
            <Download size={14} />
            <span>{t('update.available', { version: newVersion })}</span>
          </>
        )}

        {status === 'downloading' && (
          <>
            <RefreshCw size={14} className="spinning" />
            <span>{t('update.downloading', { percent: Math.round(percent) })}</span>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </>
        )}

        {status === 'downloaded' && (
          <>
            <RefreshCw size={14} />
            <span>{t('update.downloaded')}</span>
          </>
        )}
      </div>

      {(status === 'available' || status === 'downloaded') && (
        <button className="dismiss-button" onClick={dismissBanner} aria-label="Dismiss">
          <X size={12} />
        </button>
      )}
    </div>
  );
};

export default UpdateBanner;
```

- [ ] **Step 2: Create UpdateBanner.scss**

```scss
.update-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  color: #fff;
  background-color: #10a37f;
  cursor: default;
  flex-shrink: 0;

  &.error {
    background-color: #e74c3c;
  }

  &.downloading {
    cursor: default;
  }

  .update-banner-content {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    cursor: pointer;

    .spinning {
      animation: spin 1s linear infinite;
    }

    .progress-bar {
      flex: 1;
      max-width: 200px;
      height: 4px;
      background-color: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      overflow: hidden;

      .progress-fill {
        height: 100%;
        background-color: #fff;
        border-radius: 2px;
        transition: width 0.3s ease;
      }
    }
  }

  .dismiss-button {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;

    &:hover {
      color: #fff;
    }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/UpdateBanner/
git commit -m "feat(update): create UpdateBanner component"
```

---

### Task 8: Create UpdateDialog component

**Files:**
- Create: `src/components/UpdateDialog/UpdateDialog.tsx`
- Create: `src/components/UpdateDialog/UpdateDialog.scss`

- [ ] **Step 1: Create UpdateDialog.tsx**

```typescript
import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../utils/environment';
import {
  useUpdateStatus,
  useUpdateNewVersion,
  useUpdateChangelog,
  useUpdateProgressPercent,
  useUpdateProgressTransferred,
  useUpdateProgressTotal,
  useUpdateDownloadUrl,
  useUpdateDialogOpen,
  useCloseUpdateDialog,
  useDownloadUpdate,
  useInstallUpdate,
} from '../../stores/updateStore';
import './UpdateDialog.scss';

const UpdateDialog: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const newVersion = useUpdateNewVersion();
  const changelog = useUpdateChangelog();
  const percent = useUpdateProgressPercent();
  const transferred = useUpdateProgressTransferred();
  const total = useUpdateProgressTotal();
  const downloadUrl = useUpdateDownloadUrl();
  const dialogOpen = useUpdateDialogOpen();
  const closeDialog = useCloseUpdateDialog();
  const downloadUpdate = useDownloadUpdate();
  const installUpdate = useInstallUpdate();

  const [currentVersion, setCurrentVersion] = React.useState('?');

  // Fetch current app version from main process
  React.useEffect(() => {
    if (isElectron() && dialogOpen) {
      (window as any).electron?.invoke('get-app-version')?.then((v: string) => {
        if (v) setCurrentVersion(v);
      });
    }
  }, [dialogOpen]);

  if (!dialogOpen) return null;

  const isLinux = navigator.platform.toLowerCase().includes('linux');

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getTitle = (): string => {
    switch (status) {
      case 'available': return t('update.available', { version: newVersion });
      case 'downloading': return t('update.downloading', { percent: Math.round(progress.percent) });
      case 'downloaded': return t('update.downloaded');
      case 'not-available': return t('update.notAvailable');
      default: return t('update.checkButton');
    }
  };

  return (
    <div className="update-dialog-overlay" onClick={closeDialog}>
      <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-dialog-header">
          <h3>{getTitle()}</h3>
          <button className="close-button" onClick={closeDialog}>
            <X size={16} />
          </button>
        </div>

        <div className="update-dialog-body">
          {/* Version info */}
          {status === 'available' && newVersion && (
            <div className="version-info">
              <span>{t('update.currentVersion', { version: currentVersion })}</span>
              <span className="arrow">→</span>
              <span className="new-version">{t('update.newVersion', { version: newVersion })}</span>
            </div>
          )}

          {/* Changelog */}
          {changelog && (status === 'available' || status === 'downloading' || status === 'downloaded') && (
            <div className="changelog">
              <pre>{changelog}</pre>
            </div>
          )}

          {/* Download progress */}
          {status === 'downloading' && (
            <div className="download-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-details">
                <span>{formatBytes(transferred)} / {formatBytes(total)}</span>
                <span>{Math.round(percent)}%</span>
              </div>
            </div>
          )}

          {/* Not available message */}
          {status === 'not-available' && (
            <div className="up-to-date">
              <p>{t('update.notAvailable')}</p>
            </div>
          )}
        </div>

        <div className="update-dialog-footer">
          {status === 'available' && (
            <>
              {isLinux && downloadUrl ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    window.open(downloadUrl, '_blank');
                    closeDialog();
                  }}
                >
                  {t('update.goToDownload')}
                </button>
              ) : (
                <button className="primary-button" onClick={downloadUpdate}>
                  {t('update.downloadNow')}
                </button>
              )}
              <button className="secondary-button" onClick={closeDialog}>
                {t('update.later')}
              </button>
            </>
          )}

          {status === 'downloaded' && (
            <>
              <button className="primary-button" onClick={installUpdate}>
                {t('update.restartNow')}
              </button>
              <button className="secondary-button" onClick={closeDialog}>
                {t('update.later')}
              </button>
            </>
          )}

          {status === 'not-available' && (
            <button className="secondary-button" onClick={closeDialog}>
              {t('common.close', 'Close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateDialog;
```

- [ ] **Step 2: Create UpdateDialog.scss**

```scss
.update-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.update-dialog {
  background-color: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  color: #e0e0e0;

  .update-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid #333;

    h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }

    .close-button {
      background: none;
      border: none;
      color: #999;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;

      &:hover {
        color: #fff;
      }
    }
  }

  .update-dialog-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;

    .version-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 13px;
      color: #999;

      .arrow {
        color: #10a37f;
      }

      .new-version {
        color: #10a37f;
        font-weight: 600;
      }
    }

    .changelog {
      background-color: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 4px;
      padding: 12px;
      max-height: 300px;
      overflow-y: auto;

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.6;
        color: #ccc;
        font-family: inherit;
      }
    }

    .download-progress {
      margin-top: 12px;

      .progress-bar {
        height: 6px;
        background-color: #333;
        border-radius: 3px;
        overflow: hidden;

        .progress-fill {
          height: 100%;
          background-color: #10a37f;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
      }

      .progress-details {
        display: flex;
        justify-content: space-between;
        margin-top: 8px;
        font-size: 11px;
        color: #999;
      }
    }

    .up-to-date {
      text-align: center;
      padding: 20px 0;
      color: #999;
      font-size: 13px;
    }
  }

  .update-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #333;

    .primary-button {
      background-color: #10a37f;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 13px;
      cursor: pointer;

      &:hover {
        background-color: #0d8a6a;
      }
    }

    .secondary-button {
      background-color: transparent;
      color: #999;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 13px;
      cursor: pointer;

      &:hover {
        color: #fff;
        border-color: #666;
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/UpdateDialog/
git commit -m "feat(update): create UpdateDialog component with changelog and progress"
```

---

### Task 9: Create UpdateSection for SimpleSettings

**Files:**
- Create: `src/components/Settings/sections/UpdateSection.tsx`
- Modify: `src/components/Settings/sections/index.ts`

- [ ] **Step 1: Create UpdateSection.tsx**

```typescript
import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isElectron } from '../../../utils/environment';
import { useUpdateStatus, useCheckForUpdates, useOpenUpdateDialog } from '../../../stores/updateStore';
import './UpdateSection.scss';

const UpdateSection: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const checkForUpdates = useCheckForUpdates();
  const openDialog = useOpenUpdateDialog();
  const [showUpToDate, setShowUpToDate] = useState(false);

  // Only show in Electron
  if (!isElectron()) return null;

  // Show "Up to date" briefly after check completes
  useEffect(() => {
    if (status === 'not-available') {
      setShowUpToDate(true);
      const timer = setTimeout(() => setShowUpToDate(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // When update is available, open dialog instead
  useEffect(() => {
    if (status === 'available') {
      openDialog();
    }
  }, [status, openDialog]);

  const handleClick = () => {
    if (status === 'checking') return;
    checkForUpdates();
  };

  const getButtonText = (): string => {
    if (status === 'checking') return t('update.checking');
    if (showUpToDate) return t('update.upToDate');
    return t('update.checkButton');
  };

  return (
    <div className="config-section" id="update-section">
      <h3>
        <RefreshCw size={18} />
        <span>{t('update.checkButton')}</span>
      </h3>
      <button
        className={`check-update-button ${status === 'checking' ? 'checking' : ''} ${showUpToDate ? 'up-to-date' : ''}`}
        onClick={handleClick}
        disabled={status === 'checking'}
      >
        {status === 'checking' && <RefreshCw size={14} className="spinning" />}
        {getButtonText()}
      </button>
    </div>
  );
};

export default UpdateSection;
```

- [ ] **Step 2: Create UpdateSection.scss**

Create `src/components/Settings/sections/UpdateSection.scss`:

```scss
.check-update-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background-color: #2a2a2a;
  color: #e0e0e0;
  border: 1px solid #444;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: #333;
    border-color: #555;
  }

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  &.up-to-date {
    color: #10a37f;
    border-color: #10a37f;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Export UpdateSection from index**

Add to `src/components/Settings/sections/index.ts`:

```typescript
export { default as UpdateSection } from './UpdateSection';
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/sections/UpdateSection.tsx src/components/Settings/sections/UpdateSection.scss src/components/Settings/sections/index.ts
git commit -m "feat(update): create UpdateSection for SimpleSettings"
```

---

## Chunk 4: Integration — Wire Components Into Existing Pages

### Task 10: Add UpdateBanner and UpdateDialog to MainPanel

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (imports at top, JSX around line 2491)

- [ ] **Step 1: Add imports**

At the top of `MainPanel.tsx`, after the existing imports (around line 42), add:

```typescript
import UpdateBanner from '../UpdateBanner/UpdateBanner';
import UpdateDialog from '../UpdateDialog/UpdateDialog';
import { useInitUpdateListeners, useCleanupUpdateListeners } from '../../stores/updateStore';
```

- [ ] **Step 2: Initialize update listeners**

Inside the component function, add a `useEffect` to initialize and cleanup IPC listeners. Use individual selectors (stable references) to avoid infinite re-render loops:

```typescript
// Initialize auto-update listeners (individual selectors = stable refs, safe for useEffect)
const initUpdateListeners = useInitUpdateListeners();
const cleanupUpdateListeners = useCleanupUpdateListeners();
useEffect(() => {
  initUpdateListeners();
  return () => cleanupUpdateListeners();
}, [initUpdateListeners, cleanupUpdateListeners]);
```

- [ ] **Step 3: Add components to JSX**

Find the return statement around line 2490-2492:

```jsx
return (
    <div className="main-panel-wrapper">
      <div className="main-panel">
```

Insert `<UpdateBanner />` and `<UpdateDialog />` right after `<div className="main-panel">`:

```jsx
return (
    <div className="main-panel-wrapper">
      <UpdateBanner />
      <UpdateDialog />
      <div className="main-panel">
```

This places the banner above the main panel content and the dialog as a modal overlay.

- [ ] **Step 4: Verify the app builds**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds without errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(update): integrate UpdateBanner and UpdateDialog into MainPanel"
```

---

### Task 11: Add UpdateSection to SimpleSettings

**Files:**
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx`

- [ ] **Step 1: Add import**

In `SimpleSettings.tsx`, update the sections import (line 9-15):

```typescript
import {
  AccountSection,
  ProviderSection,
  LanguageSection,
  AudioDeviceSection,
  SystemAudioSection,
  UpdateSection
} from '../sections';
```

- [ ] **Step 2: Add UpdateSection to JSX**

After the `SystemAudioSection` (line 114) and before the closing `</div>` of `settings-content`, add:

```jsx
        {/* Check for Updates (Electron only) */}
        <UpdateSection />
```

- [ ] **Step 3: Verify the app builds**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/SimpleSettings/SimpleSettings.tsx
git commit -m "feat(update): add Check for Updates section to SimpleSettings"
```

---

## Chunk 5: CI/CD Changes

### Task 12: Update GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Change release to draft**

In `.github/workflows/build.yml`, find the "Create Release" step (line 312-320). Change `draft: false` to `draft: true`:

```yaml
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          files: release-assets/*
          body_path: linux-x64-artifacts/CHANGELOG.md
          draft: true
          prerelease: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Add latest.yml generation step**

Before the "Create Release" step (after "Collect release assets" at line 310), add:

```yaml
      - name: Generate latest.yml for auto-updater
        run: |
          # Find the signed Windows .exe
          EXE_FILE=$(find release-assets -name "*.exe" | head -1)
          if [ -z "$EXE_FILE" ]; then
            echo "Warning: No .exe found, skipping latest.yml generation"
            exit 0
          fi

          EXE_NAME=$(basename "$EXE_FILE")
          VERSION=${GITHUB_REF_NAME#v}
          SHA512=$(sha512sum "$EXE_FILE" | awk '{print $1}')
          SIZE=$(stat -c%s "$EXE_FILE")
          DATE=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

          cat > release-assets/latest.yml <<EOF
version: ${VERSION}
files:
  - url: ${EXE_NAME}
    sha512: ${SHA512}
    size: ${SIZE}
path: ${EXE_NAME}
sha512: ${SHA512}
releaseDate: '${DATE}'
EOF

          echo "=== latest.yml ==="
          cat release-assets/latest.yml
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add latest.yml generation and draft releases for auto-update"
```

---

## Chunk 6: Verification

### Task 13: Full build verification

- [ ] **Step 1: Run full build**

```bash
npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit 2>&1 | tail -30
```

Expected: No new type errors introduced.

- [ ] **Step 3: Run existing tests**

```bash
npm run test 2>&1 | tail -30
```

Expected: All existing tests still pass.

- [ ] **Step 4: Verify all new files exist**

```bash
echo "=== New files ===" && \
ls -la electron/update-manager.js && \
ls -la src/stores/updateStore.ts && \
ls -la src/components/UpdateBanner/UpdateBanner.tsx && \
ls -la src/components/UpdateBanner/UpdateBanner.scss && \
ls -la src/components/UpdateDialog/UpdateDialog.tsx && \
ls -la src/components/UpdateDialog/UpdateDialog.scss && \
ls -la src/components/Settings/sections/UpdateSection.tsx && \
ls -la src/components/Settings/sections/UpdateSection.scss && \
echo "=== All files present ==="
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git status
# If clean, no action needed
# If there are fixes, stage and commit them
```
