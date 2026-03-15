# Auto-Update System Design

## Summary

Implement auto-update for the Sokuji Electron desktop app (Windows primary, Linux future notification support, macOS not planned). Uses `electron-updater` with GitHub Releases as the distribution channel. CI builds create Draft releases; updates go live only when manually published.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Platforms | Windows auto-update; Linux future notification/download link; macOS not planned |
| Distribution | GitHub Releases via `electron-updater` |
| Release control | CI creates Draft releases; manual Publish when ready |
| Check timing | App startup (5s delay) + manual button |
| Manual check locations | Help menu "Check for Updates..." + SimpleConfigPanel |
| Notification UI | Non-intrusive banner → click to open detail dialog |
| Dialog content | New version number + GitHub Release changelog (markdown) |
| "Later" behavior | Dismiss for current session; re-prompt on next startup |
| Download trigger | User confirms before download starts |
| Download UI | Progress bar with percent, speed, transferred/total in banner and dialog |
| Post-download | Prompt "Restart and Update" / "Later" |
| Linux behavior | Show update available + link to GitHub Release for manual download |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Main Process                       │
│                                                      │
│  ┌─────────────┐    ┌──────────────────────┐        │
│  │ app.ready()  │───→│  UpdateManager       │        │
│  │ (5s delay)   │    │  - checkForUpdates() │        │
│  └─────────────┘    │  - downloadUpdate()  │        │
│                     │  - installUpdate()   │        │
│                     └──────┬───────────────┘        │
│                            │ IPC                     │
│  ┌─────────────────────────┼──────────────────────┐ │
│  │              Help Menu                          │ │
│  │  - About Sokuji                                 │ │
│  │  - Check for Updates...  ←── triggers IPC check │ │
│  └─────────────────────────┼──────────────────────┘ │
├────────────────────────────┼─────────────────────────┤
│                   Renderer Process                   │
│                            │                         │
│  ┌─────────────────────────▼──────────────────────┐ │
│  │              updateStore (Zustand)               │ │
│  │  status | newVersion | changelog                │ │
│  │  downloadProgress | errorMessage | downloadUrl  │ │
│  └──────┬──────────────────────┬──────────────────┘ │
│         │                      │                     │
│  ┌──────▼──────┐    ┌─────────▼────────────┐       │
│  │ UpdateBanner │    │ UpdateDialog          │       │
│  │ (top bar)    │───→│ (changelog + buttons) │       │
│  └─────────────┘    └──────────────────────┘       │
│                                                      │
│  ┌──────────────────┐                               │
│  │ SimpleConfigPanel │                               │
│  │ [Check for Updates]                              │ │
│  └──────────────────┘                               │
└─────────────────────────────────────────────────────┘
```

## Module Design

### 1. UpdateManager (`electron/update-manager.js`)

Main process module wrapping `electron-updater`.

**Initialization:**
- Created after `app.ready`
- Sets `autoUpdater.autoDownload = false` (user must confirm)
- Sets `autoUpdater.autoInstallOnAppQuit = false`
- Configures GitHub as provider with repo info

**Event mapping from autoUpdater to IPC:**

| autoUpdater event | IPC payload |
|-------------------|-------------|
| `checking-for-update` | `{status: 'checking'}` |
| `update-available` | `{status: 'available', version, releaseNotes}` |
| `update-not-available` | `{status: 'not-available'}` |
| `download-progress` | `{status: 'downloading', progress: {percent, bytesPerSecond, transferred, total}}` |
| `update-downloaded` | `{status: 'downloaded'}` |
| `error` | `{status: 'error', message}` |

**Startup check:** 5-second delay after `app.ready` to avoid impacting launch performance.

**Linux handling:** On Linux, `update-available` includes `downloadUrl` pointing to GitHub Release page. Auto-download/install is not triggered.

### 2. IPC Channels

Follow existing project convention of hyphen-separated channel names (consistent with `check-audio-system`, `volcengine-ast2-connect`, etc.):

| Direction | Channel | Purpose |
|-----------|---------|---------|
| renderer → main | `update-check` | Trigger version check |
| renderer → main | `update-download` | Start download after user confirmation |
| renderer → main | `update-install` | Quit and install update |
| main → renderer | `update-status` | Push status changes |
| main → renderer | `update-progress` | Push download progress |

### 3. Preload Extension (`electron/preload.js`)

Follow existing `window.electron` bridge pattern with allowlist-based security:

**Add to `validChannels` (invoke allowlist):**
```javascript
'update-check',
'update-download',
'update-install',
```

**Add to `validReceiveChannels`:**
```javascript
'update-status',
'update-progress',
```

The renderer uses the existing `window.electron.invoke()` and `window.electron.receive()` / `window.electron.removeListener()` APIs — no new top-level methods needed. This preserves the existing `listenerMap` WeakMap pattern for proper listener cleanup.

### 4. updateStore (`src/stores/updateStore.ts`)

Zustand store for update state.

```typescript
interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
  newVersion: string | null
  changelog: string | null
  downloadProgress: number        // 0-100
  downloadSpeed: number           // bytes/sec
  downloadTransferred: number     // bytes
  downloadTotal: number           // bytes
  errorMessage: string | null
  downloadUrl: string | null      // Linux: GitHub Release URL
}

interface UpdateActions {
  checkForUpdates: () => void
  downloadUpdate: () => void
  installUpdate: () => void
  initListeners: () => void       // Register IPC listeners
  cleanupListeners: () => void    // Remove IPC listeners
}
```

**IPC usage in store:**
```typescript
// Triggering actions
checkForUpdates: () => window.electron?.invoke('update-check')
downloadUpdate: () => window.electron?.invoke('update-download')
installUpdate: () => window.electron?.invoke('update-install')

// Listening for updates (via existing receive/removeListener pattern)
initListeners: () => {
  window.electron?.receive('update-status', handler)
  window.electron?.receive('update-progress', handler)
}
cleanupListeners: () => {
  window.electron?.removeListener('update-status', handler)
  window.electron?.removeListener('update-progress', handler)
}
```

**Platform safety:** All actions check for `window.electron` existence; no-ops in non-Electron environments (extension/web).

### 5. UI Components

#### UpdateBanner (`src/components/UpdateBanner.tsx`)

- **Position:** Fixed at top of MainPanel, above conversation area
- **Style:** Dark theme consistent, `#10a37f` background
- **States:**
  - `available`: "New version v{version} available" — clickable, opens UpdateDialog
  - `downloading`: "Downloading update... {percent}%" with progress bar
  - `downloaded`: "Update ready, restart to complete" — clickable, triggers restart
  - `error`: Error message, auto-hides after 3 seconds
- **Close button:** Hides banner for current session only

#### UpdateDialog (`src/components/UpdateDialog.tsx`)

- **Trigger:** Click on banner or "Check for Updates" button
- **Content:**
  - Title: changes based on status (Update Available / Downloading / Ready / Up to Date)
  - Version: current → new
  - Changelog: rendered from GitHub Release markdown
  - Download progress: bar + speed + transferred/total (when downloading)
- **Buttons by status:**
  - `available`: "Download Now" + "Later"
  - `downloading`: progress display only
  - `downloaded`: "Restart and Update" + "Later"
  - `not-available`: "Already up to date" message with close button
  - `available` on Linux: "Go to Download" (opens GitHub Release URL)

#### Check for Updates Button (SimpleConfigPanel)

- In settings panel, triggers `updateStore.checkForUpdates()`
- States: "Check for Updates" → "Checking..." → "Up to Date" (2s) or opens UpdateDialog

#### Help Menu Item (main process)

- "Check for Updates..." menu item in Help menu
- On Windows/Linux: placed below the "About Sokuji" item with a separator
- On macOS: placed at the top of the Help submenu (since "About" is in the app menu, not Help menu). Only triggers a version check notification — no auto-download/install since macOS is not a target platform
- Triggers `autoUpdater.checkForUpdates()` and sends result to renderer via IPC

## CI/CD Changes

### GitHub Actions (`.github/workflows/build.yml`)

Change release creation from `draft: false` to `draft: true`. Workflow:

1. Tag push triggers build
2. All platform artifacts built and uploaded
3. Release created as **Draft**
4. Developer tests manually
5. Developer publishes release on GitHub when ready

### `latest.yml` Generation

`electron-updater` requires a `latest.yml` file in GitHub Release assets to detect available updates. This file is NOT automatically generated by `electron-forge make`.

**Approach:** Add a CI step after building to generate `latest.yml` and upload it as a release asset. The file contains:

```yaml
version: 0.16.0
files:
  - url: Sokuji-0.16.0-Setup.exe
    sha512: <sha512-hash>
    size: <file-size>
path: Sokuji-0.16.0-Setup.exe
sha512: <sha512-hash>
releaseDate: '2026-03-16T00:00:00.000Z'
```

The CI workflow will:
1. Run `electron-forge make` (as currently)
2. Sign the Windows `.exe` (existing `sign-windows` job)
3. In the `release` job, after downloading `windows-signed` artifacts, generate `latest.yml` from the **signed** `.exe` (compute sha512, file size) — this ensures the hash matches the actual distributed file
4. Upload `latest.yml` alongside other release assets

### Squirrel.Windows Compatibility

The project uses `@electron-forge/maker-squirrel` which produces Squirrel.Windows packages (`.nupkg` + `RELEASES` format). `electron-updater`'s `quitAndInstall()` is designed for NSIS installers and is **incompatible** with Forge's Squirrel output.

**Primary approach:** Use `electron-updater` only for version checking (reads `latest.yml` from GitHub Release assets), then handle download and install manually:

1. `electron-updater` checks `latest.yml` → detects new version available → sends `update-available` event with version and release notes
2. User confirms download → UpdateManager downloads the `.exe` Setup installer via Node.js `https` module (with progress events)
3. Download complete → user clicks "Restart and Update" → launch installer via `child_process.execFile()` with Squirrel's `--update` flag or `shell.openPath()`, then `app.quit()`
4. Squirrel handles the upgrade silently; existing `squirrel-events.js` manages shortcuts on `--squirrel-updated`

This approach uses `electron-updater` for its robust version-checking and `latest.yml` parsing, while relying on the existing Squirrel infrastructure for actual installation.

**Alternative (future):** Switching from `maker-squirrel` to `maker-wix` or an NSIS-based maker would enable `electron-updater`'s full `autoDownload` + `quitAndInstall()` flow. This is a larger build system change and is out of scope for this feature.

### New Dependencies

- `electron-updater`: Auto-update library for main process

## i18n

New keys under `update` namespace, added to all 35+ language files (English first, others follow):

- `update.available`: "New version v{{version}} available"
- `update.downloading`: "Downloading update... {{percent}}%"
- `update.downloaded`: "Update ready, restart to complete"
- `update.checkButton`: "Check for Updates"
- `update.checking`: "Checking..."
- `update.upToDate`: "Up to date"
- `update.notAvailable`: "You're running the latest version"
- `update.downloadNow`: "Download Now"
- `update.later`: "Later"
- `update.restartNow`: "Restart and Update"
- `update.goToDownload`: "Go to Download"
- `update.error`: "Failed to check for updates"
- `update.menuItem`: "Check for Updates..."

## Error Handling

- **Network failure:** Push `error` status, show in banner, do not block app
- **GitHub API rate limit (403):** Catch and suggest retry later
- **Download interruption:** `electron-updater` supports resume
- **Installation failure:** Catch error, suggest manual download with GitHub Release link
- **All errors:** Logged to `logStore` for LogsPanel visibility

## Files to Create/Modify

### New Files
- `electron/update-manager.js` — UpdateManager module
- `src/stores/updateStore.ts` — Zustand update state store
- `src/components/UpdateBanner.tsx` — Banner component
- `src/components/UpdateBanner.scss` — Banner styles
- `src/components/UpdateDialog.tsx` — Dialog component
- `src/components/UpdateDialog.scss` — Dialog styles

### Modified Files
- `electron/main.js` — Import UpdateManager, add Help menu item, add IPC handlers
- `electron/preload.js` — Add update channels to `validChannels` and `validReceiveChannels`
- `.github/workflows/build.yml` — Change release to draft, add `latest.yml` generation step
- `src/components/SimpleConfigPanel.tsx` — Add "Check for Updates" button
- `src/components/MainPanel.tsx` — Render UpdateBanner
- `package.json` — Add `electron-updater` dependency
- Translation files (`src/i18n/locales/*/translation.json`) — Add update keys
