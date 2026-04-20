# Linux AppImage Packaging + Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AppImage (x64 + arm64) as the recommended Linux format with native `electron-updater` auto-update. Keep `.deb`; drop `.zip`. `.deb` users see a "migrate to AppImage" banner.

**Architecture:** Linux packaging migrates from Forge (`maker-deb` + `maker-zip`) to `electron-builder` (AppImage + deb). Forge continues to handle Windows (Squirrel) and macOS (PKG). `UpdateManager` branches on `process.env.APPIMAGE`: AppImage users get the full `electron-updater` download/install cycle; `.deb` users get a migration banner with AppImage + deb download links.

**Tech Stack:** electron-builder, electron-updater (already installed, v6.8.3), @electron/fuses (already installed, v2.0.0), Zustand store, React + i18next UI.

**Spec:** `docs/superpowers/specs/2026-04-20-linux-appimage-auto-update-design.md`

---

## Phase 1 — Build system migration

### Task 1: Add electron-builder devDependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install electron-builder**

Run:
```bash
npm install --save-dev electron-builder@^25.1.8
```

Expected: adds `"electron-builder": "^25.x.x"` to `devDependencies`; `package-lock.json` updated.

- [ ] **Step 2: Verify install**

Run: `npx electron-builder --version`
Expected: prints a version number (25.x or newer), no error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add electron-builder for Linux AppImage build"
```

---

### Task 2: Create afterPack Fuses script

Forge's `@electron-forge/plugin-fuses` applies Electron Fuses at package time. electron-builder has no built-in Fuses integration, so we mirror the behavior in an `afterPack` hook.

**Files:**
- Create: `scripts/electron-builder-fuses.js`

- [ ] **Step 1: Create the script**

Create `scripts/electron-builder-fuses.js`:
```js
const path = require('path');
const fs = require('fs');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Apply Electron Fuses to the packaged binary, mirroring the options
// previously set by @electron-forge/plugin-fuses in forge.config.js.
module.exports = async function applyFuses(context) {
  const executableName = context.packager.executableName || context.packager.appInfo.productFilename;
  const execPath = path.join(context.appOutDir, executableName);

  if (!fs.existsSync(execPath)) {
    throw new Error(`[electron-builder-fuses] Executable not found at ${execPath}`);
  }

  await flipFuses(execPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log(`[electron-builder-fuses] Applied Fuses to ${execPath}`);
};
```

- [ ] **Step 2: Commit**

```bash
git add scripts/electron-builder-fuses.js
git commit -m "chore(build): add afterPack Fuses script for electron-builder"
```

---

### Task 3: Add electron-builder build config to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the `build` field**

Add this top-level field to `package.json` (place near `"main"` or at the end of the object):
```jsonc
"build": {
  "appId": "com.kizunaai.sokuji",
  "productName": "Sokuji",
  "asar": true,
  "directories": {
    "output": "out/make-linux"
  },
  "files": [
    "package.json",
    "dist-electron/**/*",
    "build/**/*",
    "!build/**/*.map",
    "!build/assets/test-tone.mp3",
    "!build/wasm/**",
    "build/wasm/sherpa-onnx-asr/**",
    "build/wasm/sherpa-onnx-asr-stream/**",
    "build/wasm/sherpa-onnx-tts/**",
    "build/wasm/ort/**",
    "build/wasm/vad/**",
    "build/wasm/piper-plus/**",
    "build/wasm/gtcrn/**"
  ],
  "extraResources": ["assets", "resources"],
  "linux": {
    "target": [
      { "target": "AppImage", "arch": ["x64", "arm64"] },
      { "target": "deb",      "arch": ["x64", "arm64"] }
    ],
    "category": "AudioVideo",
    "icon": "assets/icon.png",
    "executableName": "sokuji"
  },
  "appImage": {
    "artifactName": "${productName}-${version}-${arch}.${ext}"
  },
  "deb": {
    "artifactName": "${name}_${version}_${arch}.${ext}"
  },
  "publish": null,
  "afterPack": "./scripts/electron-builder-fuses.js"
}
```

Notes for the reader:
- `files` is processed in order; later patterns override earlier ones. The order matters: include `build/**/*` first, then exclude source maps, the test-tone file, and all of `build/wasm/**`, then re-include specific wasm runtime dirs.
- `node_modules/` does not need to be listed — electron-builder auto-includes production node_modules regardless of the `files` value.
- `extraResources` copies `assets/` and `resources/` into `Contents/Resources/` on macOS / `resources/` on Linux — same semantics as Forge's `packagerConfig.extraResource`.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"`
Expected: no output (JSON is valid).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(build): add electron-builder Linux AppImage + deb config"
```

---

### Task 4: Remove Forge Linux makers

Linux output is now handled by electron-builder. Remove the redundant Forge makers.

**Files:**
- Modify: `forge.config.js`
- Modify: `package.json`

- [ ] **Step 1: Remove makers from `forge.config.js`**

Delete the `maker-zip` and `maker-deb` entries from the `makers` array. The resulting `makers` array should contain only `maker-squirrel` and `maker-dmg`:
```js
makers: [
  {
    name: '@electron-forge/maker-squirrel',
    config: { /* unchanged */ }
  },
  {
    name: '@electron-forge/maker-dmg',
    config: { name: 'Sokuji', overwrite: true }
  }
],
```

- [ ] **Step 2: Uninstall the unused Forge maker packages**

Run:
```bash
npm uninstall @electron-forge/maker-deb @electron-forge/maker-zip
```

Expected: both packages removed from `devDependencies` in `package.json`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json forge.config.js
git commit -m "chore(build): remove Forge Linux makers (deb/zip now via electron-builder)"
```

---

### Task 5: Local build verification

Verify the new electron-builder pipeline produces usable Linux artifacts before touching runtime or CI code.

**Files:** none modified.

- [ ] **Step 1: Build the React bundle**

Run: `npm run build`
Expected: `build/` dir populated with `index.html`, JS bundles, and `build/wasm/**` runtime dirs.

- [ ] **Step 2: Build Linux packages for x64**

Run: `npx electron-builder --linux AppImage deb --x64`
Expected: `out/make-linux/` contains:
- `Sokuji-<version>-x64.AppImage`
- `sokuji_<version>_amd64.deb`
- `latest-linux.yml`

Build log should include `[electron-builder-fuses] Applied Fuses to ...`.

- [ ] **Step 3: Validate `latest-linux.yml` shape**

Run: `cat out/make-linux/latest-linux.yml`
Expected content looks like:
```yaml
version: <current-version>
files:
  - url: Sokuji-<version>-x64.AppImage
    sha512: <base64-hash>
    size: <bytes>
path: Sokuji-<version>-x64.AppImage
sha512: <base64-hash>
releaseDate: '<iso-timestamp>'
```

- [ ] **Step 4: Smoke-test the AppImage**

Run: `chmod +x out/make-linux/Sokuji-*-x64.AppImage && out/make-linux/Sokuji-*-x64.AppImage`
Expected: app window opens. In the main-process console, look for `Initializing Better Auth adapter` and `electron-audio-loopback initialized for linux`. No crashes within first 5 seconds.

- [ ] **Step 5: Smoke-test the deb (only if on a Debian-based dev host)**

Run: `sudo dpkg -i out/make-linux/sokuji_*_amd64.deb && sokuji`
Expected: installs without errors; `sokuji` binary launches the app. (Skip if dev host isn't Debian-based; CI will cover this.)

- [ ] **Step 6: Commit (no changes expected)**

No changes to commit from this task unless build surfaced issues. If build issues were found, fix them now and commit fixes under `fix(build): ...` before proceeding.

---

## Phase 2 — Audio runtime verification in AppImage

### Task 6: AppImage audio compatibility check

Spec pre-requisite verification. The electron-audio-loopback migration is already done for the `.deb` path (confirmed from real v0.18.1 logs); we now verify the remaining `pactl` / `pw-link` calls for virtual TTS devices still work from within an AppImage process.

**Files:** none modified (verification only).

- [ ] **Step 1: Ensure `process.env.APPIMAGE` detection works**

With the AppImage from Task 5 step 4 still running, check its stdout for any log line emitted from `electron/main.js` startup. Add one if none exists — temporarily insert at the top of `app.whenReady()` in `electron/main.js`:
```js
console.log('[Sokuji] [Main] process.env.APPIMAGE =', process.env.APPIMAGE || '<unset>');
```

Re-build (`npx electron-builder --linux AppImage --x64`) and launch again.

Expected stdout: `[Sokuji] [Main] process.env.APPIMAGE = /tmp/.mount_Sokuji...` (a real path, not `<unset>`).

- [ ] **Step 2: Verify `pactl` is reachable from inside AppImage**

In the same AppImage session, check the main-process logs for `[Sokuji] [PulseAudio] Checking sinks: pactl list sinks short`. Confirm the subsequent `Orphaned device check completed` line appears without any `ENOENT` / `command not found` errors.

- [ ] **Step 3: Verify virtual TTS devices are created**

Check logs for:
- `[Sokuji] [PulseAudio] virtual sink created (ID: <n>)`
- `[Sokuji] [PulseAudio] virtual mic created (ID: <n>)`
- `[Sokuji] [PulseAudio] Connected: sokuji_virtual_output:monitor_FL -> input.sokuji_virtual_mic:input_FL`
- `[Sokuji] [PulseAudio] Virtual audio devices created successfully`

From a separate host terminal, also confirm: `pactl list sinks short | grep sokuji_virtual_output` returns a line.

- [ ] **Step 4: End-to-end translation session**

In the running AppImage: sign in (if needed), select Kizuna AI or any provider, start a translation session, speak into the mic, confirm TTS output is audible and also reaches the virtual mic. (Follow existing CLAUDE.md guidance — monitor LogsPanel.)

Expected: full pipeline works identically to the `.deb` install.

- [ ] **Step 5: Revert the temporary debug log**

Remove the `console.log('[Sokuji] [Main] process.env.APPIMAGE ...')` line added in Step 1. (We will re-add it as a real field in Task 8, not as a console.log.)

- [ ] **Step 6: Commit if any fixes were required**

If any audio check failed and required a code fix (e.g., falling back to `module-loopback` as documented in the spec), commit those fixes now. Otherwise, no commit.

---

## Phase 3 — updateStore extensions

### Task 7: Add new fields to updateStore

New state fields: `supportsAutoUpdate`, `appImageUrl`, `debUrl`, `releasePageUrl`. Existing `downloadUrl` is retained (used by Windows / legacy path).

**Files:**
- Modify: `src/stores/updateStore.ts`
- Test: `src/stores/updateStore.test.ts` (create new)

- [ ] **Step 1: Write the failing test**

Create `src/stores/updateStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import useUpdateStore from './updateStore';

describe('updateStore', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      status: 'idle',
      newVersion: null,
      changelog: null,
      downloadProgress: 0,
      downloadSpeed: 0,
      downloadTransferred: 0,
      downloadTotal: 0,
      errorMessage: null,
      downloadUrl: null,
      supportsAutoUpdate: true,
      appImageUrl: null,
      debUrl: null,
      releasePageUrl: null,
      bannerDismissed: false,
      dialogOpen: false,
    });
  });

  it('defaults supportsAutoUpdate to true (matches Windows behavior)', () => {
    expect(useUpdateStore.getState().supportsAutoUpdate).toBe(true);
  });

  it('exposes appImageUrl, debUrl, releasePageUrl as null by default', () => {
    const s = useUpdateStore.getState();
    expect(s.appImageUrl).toBeNull();
    expect(s.debUrl).toBeNull();
    expect(s.releasePageUrl).toBeNull();
  });

  it('allows setting the new fields', () => {
    useUpdateStore.setState({
      supportsAutoUpdate: false,
      appImageUrl: 'https://example.com/app.AppImage',
      debUrl: 'https://example.com/app.deb',
      releasePageUrl: 'https://example.com/release',
    });
    const s = useUpdateStore.getState();
    expect(s.supportsAutoUpdate).toBe(false);
    expect(s.appImageUrl).toBe('https://example.com/app.AppImage');
    expect(s.debUrl).toBe('https://example.com/app.deb');
    expect(s.releasePageUrl).toBe('https://example.com/release');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/stores/updateStore.test.ts`
Expected: all three tests fail with TypeScript errors / undefined property access on the new fields.

- [ ] **Step 3: Add fields to the `UpdateState` interface**

In `src/stores/updateStore.ts`, extend the `UpdateState` interface:
```ts
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
  // NEW fields for Linux AppImage/deb split:
  supportsAutoUpdate: boolean;
  appImageUrl: string | null;
  debUrl: string | null;
  releasePageUrl: string | null;
  bannerDismissed: boolean;
  dialogOpen: boolean;
}
```

- [ ] **Step 4: Add default values to the store creator**

In the `create<UpdateStore>()(...)` call, add the new defaults to the state initialization block:
```ts
supportsAutoUpdate: true,
appImageUrl: null,
debUrl: null,
releasePageUrl: null,
```

Add these alongside the existing `downloadUrl: null,` line.

- [ ] **Step 5: Populate from IPC payload in `statusHandler`**

Find the `statusHandler = (data: any) => {` block. After the existing `if (data.downloadUrl) update.downloadUrl = data.downloadUrl;` line, add:
```ts
if (typeof data.supportsAutoUpdate === 'boolean') update.supportsAutoUpdate = data.supportsAutoUpdate;
if (data.appImageUrl !== undefined) update.appImageUrl = data.appImageUrl;
if (data.debUrl !== undefined) update.debUrl = data.debUrl;
if (data.releasePageUrl !== undefined) update.releasePageUrl = data.releasePageUrl;
```

- [ ] **Step 6: Add selectors**

Add these to the selector-exports block at the bottom of `updateStore.ts`:
```ts
export const useUpdateSupportsAutoUpdate = () => useUpdateStore(state => state.supportsAutoUpdate);
export const useUpdateAppImageUrl = () => useUpdateStore(state => state.appImageUrl);
export const useUpdateDebUrl = () => useUpdateStore(state => state.debUrl);
export const useUpdateReleasePageUrl = () => useUpdateStore(state => state.releasePageUrl);
```

- [ ] **Step 7: Run the test — expect pass**

Run: `npx vitest run src/stores/updateStore.test.ts`
Expected: all three tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/stores/updateStore.ts src/stores/updateStore.test.ts
git commit -m "feat(updateStore): add supportsAutoUpdate + AppImage/deb url fields"
```

---

## Phase 4 — UpdateManager Linux branching

### Task 8: Populate AppImage/deb URLs on `update-available`

**Files:**
- Modify: `electron/update-manager.js`

- [ ] **Step 1: Add `isAppImage` constant near the top of the class**

In `electron/update-manager.js`, inside the `UpdateManager` constructor (after the `fullChangelog = true` line), add:
```js
this.isAppImage = process.platform === 'linux' && !!process.env.APPIMAGE;
```

Also log it once for easier debugging:
```js
if (process.platform === 'linux') {
  console.log(`[Sokuji] [UpdateManager] Linux runtime: isAppImage=${this.isAppImage}, APPIMAGE=${process.env.APPIMAGE || '<unset>'}`);
}
```

- [ ] **Step 2: Replace the existing Linux `update-available` block**

Find the block in `_setupAutoUpdaterEvents()` inside the `autoUpdater.on('update-available', ...)` handler:
```js
// On Linux, include download URL instead of auto-download
if (process.platform === 'linux') {
  payload.downloadUrl = `https://github.com/kizuna-ai-lab/sokuji/releases/tag/v${info.version}`;
}
```

Replace with:
```js
if (process.platform === 'linux') {
  const version = info.version;
  const appImageArch = process.arch; // 'x64' or 'arm64'
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
```

- [ ] **Step 3: Smoke-test the IPC payload shape**

Run: `npm test` (full test suite; currently should still pass — no Update-Manager unit tests exist yet, and updateStore tests from Task 7 should pass).

Expected: all existing tests pass. No new test in this step — we verify end-to-end in Task 17.

- [ ] **Step 4: Commit**

```bash
git add electron/update-manager.js
git commit -m "feat(update-manager): add AppImage detection + Linux url payload"
```

---

### Task 9: Route `update-download` and `update-install` by AppImage flag

**Files:**
- Modify: `electron/update-manager.js`

- [ ] **Step 1: Branch the `update-download` handler**

Find the `ipcMain.handle('update-download', async () => { ... })` block. Replace its body with:
```js
ipcMain.handle('update-download', async () => {
  if (!this._updateInfo) {
    this._sendStatus({ status: 'error', message: 'No update available to download' });
    return { success: false, error: 'No update available' };
  }

  // Linux AppImage: use electron-updater's native AppImageUpdater flow
  if (process.platform === 'linux' && this.isAppImage) {
    if (this._downloadPromise) return this._downloadPromise;
    this._downloadPromise = (async () => {
      try {
        this._sendStatus({ status: 'downloading' });
        // Hook download-progress events from autoUpdater to IPC
        const onProgress = (p) => this._sendProgress({
          percent: p.percent || 0,
          bytesPerSecond: p.bytesPerSecond || 0,
          transferred: p.transferred || 0,
          total: p.total || 0,
        });
        const onDownloaded = () => this._sendStatus({ status: 'downloaded' });
        autoUpdater.on('download-progress', onProgress);
        autoUpdater.once('update-downloaded', onDownloaded);

        await autoUpdater.downloadUpdate();
        // `update-downloaded` event is what flips status to 'downloaded';
        // it also populates this.downloadPath implicitly via electron-updater.
        this.downloadPath = '__appimage__'; // sentinel so install handler proceeds
        return { success: true };
      } catch (err) {
        this._sendStatus({ status: 'error', message: err.message || String(err) });
        return { success: false, error: err.message };
      } finally {
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
```

- [ ] **Step 2: Branch the `update-install` handler**

Replace the body of `ipcMain.handle('update-install', ...)` with:
```js
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
```

- [ ] **Step 3: Commit**

```bash
git add electron/update-manager.js
git commit -m "feat(update-manager): route download/install by AppImage vs legacy"
```

---

## Phase 5 — UI variants

### Task 10: Add i18n keys in English first

Spec keys: `update.autoUpdateNote`, `update.downloadAppImage`, `update.downloadDeb`, `update.linuxMigrateTitle`, `update.linuxMigrateBody`.

**Files:**
- Modify: `src/locales/en/translation.json`

- [ ] **Step 1: Add the new keys to the English locale**

In `src/locales/en/translation.json`, find the existing `"update": { ... }` block. Add these keys inside it (alongside the existing keys):
```json
"autoUpdateNote": "AppImage supports automatic updates. Installing the AppImage replaces your current installation — no separate uninstall needed.",
"downloadAppImage": "Download AppImage (recommended)",
"downloadDeb": "Download .deb",
"linuxMigrateTitle": "New version v{{version}} available",
"linuxMigrateBody": "Auto-updates are available on AppImage. Pick a format to download v{{version}}."
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json', 'utf8'))"`
Expected: no output (valid JSON).

- [ ] **Step 3: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "feat(i18n): add Linux AppImage/deb update keys (en)"
```

---

### Task 11: Propagate i18n keys to all 29 other locales

English fallback covers missing translations, but we want first-class localization in all 30 locales. Use English copy as a safe placeholder; native speakers can tighten later.

**Files:**
- Modify: `src/locales/{ar,bn,de,es,fa,fi,fil,fr,he,hi,id,it,ja,ko,ms,nl,pl,pt_BR,pt_PT,ru,sv,ta,te,th,tr,uk,vi,zh_CN,zh_TW}/translation.json`

- [ ] **Step 1: Script the copy (ensures exact consistency)**

Run this shell one-liner from the repo root:
```bash
node -e "
const fs = require('fs');
const path = require('path');
const keys = {
  autoUpdateNote: 'AppImage supports automatic updates. Installing the AppImage replaces your current installation — no separate uninstall needed.',
  downloadAppImage: 'Download AppImage (recommended)',
  downloadDeb: 'Download .deb',
  linuxMigrateTitle: 'New version v{{version}} available',
  linuxMigrateBody: 'Auto-updates are available on AppImage. Pick a format to download v{{version}}.',
};
const dirs = fs.readdirSync('src/locales', { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'en')
  .map(d => d.name);
for (const locale of dirs) {
  const p = path.join('src/locales', locale, 'translation.json');
  if (!fs.existsSync(p)) continue;
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  json.update = json.update || {};
  for (const [k, v] of Object.entries(keys)) {
    if (!(k in json.update)) json.update[k] = v;
  }
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
  console.log('Updated', p);
}
"
```

Expected: prints `Updated src/locales/<locale>/translation.json` for 29 locales.

- [ ] **Step 2: Validate all locales parse as JSON**

Run:
```bash
for f in src/locales/*/translation.json; do node -e "JSON.parse(require('fs').readFileSync('$f', 'utf8'))" || echo "BAD: $f"; done
```

Expected: no `BAD:` lines.

- [ ] **Step 3: Localize native strings where convenient (optional)**

For `zh_CN`, `zh_TW`, `ja`, `ko`, `de`, `fr`, `es`, `pt_BR`, `ru` — translate the five keys inline. (Use existing translation style in each file as reference. This is cosmetic; English fallback handles missed locales.)

Skip if time-pressed; other locales will fall back to English.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(i18n): add Linux AppImage/deb update keys to all locales"
```

---

### Task 12: UpdateDialog — non-AppImage Linux variant

**Files:**
- Modify: `src/components/UpdateDialog/UpdateDialog.tsx`
- Modify: `src/components/UpdateDialog/UpdateDialog.scss` (add tertiary-button class)

- [ ] **Step 1: Add the tertiary button style**

In `src/components/UpdateDialog/UpdateDialog.scss`, add a tertiary button style matching the existing secondary style. Find the `.secondary-button` rule and add adjacent:
```scss
.tertiary-button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #ccc;
  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
}
```

- [ ] **Step 2: Import the new selectors**

In `src/components/UpdateDialog/UpdateDialog.tsx`, extend the imports from `../../stores/updateStore`:
```ts
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
  // NEW:
  useUpdateSupportsAutoUpdate,
  useUpdateAppImageUrl,
  useUpdateDebUrl,
} from '../../stores/updateStore';
```

- [ ] **Step 3: Consume the new state in the component**

Inside the `UpdateDialog` component body (near the other hook calls):
```ts
const supportsAutoUpdate = useUpdateSupportsAutoUpdate();
const appImageUrl = useUpdateAppImageUrl();
const debUrl = useUpdateDebUrl();
```

- [ ] **Step 4: Render the migration variant in the footer**

Find the `status === 'available'` block in the footer (starts with `{status === 'available' && (<>...</>)}`). Replace the inner JSX with this logic:
```tsx
{status === 'available' && (
  <>
    {!supportsAutoUpdate && (appImageUrl || debUrl) ? (
      // Non-AppImage Linux: offer two download paths
      <>
        {appImageUrl && (
          <button
            className="primary-button"
            onClick={() => {
              if (isElectron() && (window as any).electron?.invoke) {
                (window as any).electron.invoke('open-external', appImageUrl);
              } else {
                window.open(appImageUrl, '_blank');
              }
              closeDialog();
            }}
          >
            {t('update.downloadAppImage')}
          </button>
        )}
        {debUrl && (
          <button
            className="tertiary-button"
            onClick={() => {
              if (isElectron() && (window as any).electron?.invoke) {
                (window as any).electron.invoke('open-external', debUrl);
              } else {
                window.open(debUrl, '_blank');
              }
              closeDialog();
            }}
          >
            {t('update.downloadDeb')}
          </button>
        )}
        <button className="secondary-button" onClick={closeDialog}>
          {t('update.later')}
        </button>
      </>
    ) : downloadUrl ? (
      // Legacy (any platform passing a generic downloadUrl, e.g. old callers)
      <>
        <button
          className="primary-button"
          onClick={() => {
            if (isElectron() && (window as any).electron?.invoke) {
              (window as any).electron.invoke('open-external', downloadUrl);
            } else {
              window.open(downloadUrl, '_blank');
            }
            closeDialog();
          }}
        >
          {t('update.goToDownload')}
        </button>
        <button className="secondary-button" onClick={closeDialog}>
          {t('update.later')}
        </button>
      </>
    ) : (
      // Windows / AppImage Linux: full auto-update flow
      <>
        <button className="primary-button" onClick={downloadUpdate}>
          {t('update.downloadNow')}
        </button>
        <button className="secondary-button" onClick={closeDialog}>
          {t('update.later')}
        </button>
      </>
    )}
  </>
)}
```

- [ ] **Step 5: Add the auto-update note to the body for non-AppImage Linux**

Find the `status === 'available' && newVersion && (...)` block in `update-dialog-body`. Right after the `version-info` div (and before the `changelog` render), add:
```tsx
{status === 'available' && !supportsAutoUpdate && (
  <div className="auto-update-note">
    {t('update.autoUpdateNote')}
  </div>
)}
```

Add minimal styling to `UpdateDialog.scss`:
```scss
.auto-update-note {
  margin: 12px 0;
  padding: 12px;
  border-radius: 6px;
  background: rgba(16, 163, 127, 0.08);
  color: #b8d4c9;
  font-size: 0.9em;
  line-height: 1.5;
}
```

- [ ] **Step 6: Build and smoke-test in the dev renderer**

Run: `npm run dev`
In browser dev tools console:
```js
window.__updateStore.setState({
  status: 'available',
  newVersion: '0.99.0',
  supportsAutoUpdate: false,
  appImageUrl: 'https://example.com/test.AppImage',
  debUrl: 'https://example.com/test.deb',
  dialogOpen: true,
});
```

Expected: dialog renders with "Download AppImage (recommended)", "Download .deb", "Later" buttons plus the auto-update note.

Also test the normal AppImage path:
```js
window.__updateStore.setState({
  status: 'available',
  newVersion: '0.99.0',
  supportsAutoUpdate: true,
  appImageUrl: null,
  debUrl: null,
  dialogOpen: true,
});
```

Expected: classic "Download Now", "Later" buttons; no migration note.

- [ ] **Step 7: Commit**

```bash
git add src/components/UpdateDialog
git commit -m "feat(UpdateDialog): add Linux deb → AppImage migration variant"
```

---

### Task 13: UpdateBanner — non-AppImage Linux variant

Minimal change: the banner message text swaps to the migrate title when `supportsAutoUpdate === false`. Clicking it still opens the dialog.

**Files:**
- Modify: `src/components/UpdateBanner/UpdateBanner.tsx`

- [ ] **Step 1: Extend imports**

Extend the store imports to include `useUpdateSupportsAutoUpdate`:
```ts
import {
  useUpdateStatus,
  useUpdateNewVersion,
  useUpdateProgressPercent,
  useUpdateError,
  useUpdateBannerDismissed,
  useDismissBanner,
  useOpenUpdateDialog,
  useInstallUpdate,
  useUpdateSupportsAutoUpdate,   // NEW
} from '../../stores/updateStore';
```

- [ ] **Step 2: Read the flag**

Add near the other hook calls:
```ts
const supportsAutoUpdate = useUpdateSupportsAutoUpdate();
```

- [ ] **Step 3: Swap the banner label for non-AppImage Linux**

Find the `{status === 'available' && (<>...</>)}` JSX block. Replace the `span` label line:
```tsx
<span>{t('update.available', { version: newVersion })}</span>
```
With:
```tsx
<span>
  {supportsAutoUpdate
    ? t('update.available', { version: newVersion })
    : t('update.linuxMigrateTitle', { version: newVersion })}
</span>
```

- [ ] **Step 4: Smoke-test in the dev renderer**

Run: `npm run dev` and in dev-tools console:
```js
window.__updateStore.setState({
  status: 'available',
  newVersion: '0.99.0',
  supportsAutoUpdate: false,
});
```

Expected: banner shows "New version v0.99.0 available" (migrate title). Clicking opens the dialog (which shows the two-button migration variant from Task 12).

- [ ] **Step 5: Commit**

```bash
git add src/components/UpdateBanner
git commit -m "feat(UpdateBanner): relabel non-AppImage Linux banner"
```

---

## Phase 6 — CI changes

### Task 14: Matrix + native ARM runner + electron-builder Linux step

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Switch arm64 matrix row to native runner**

In the `build.matrix.include` list, change the arm64 Linux row. Replace:
```yaml
- os: ubuntu-latest
  artifact_name: linux-arm64
  name: linux-arm64
  arch: arm64
```
With:
```yaml
- os: ubuntu-24.04-arm
  artifact_name: linux-arm64
  name: linux-arm64
  arch: arm64
```

- [ ] **Step 2: Make the existing Forge build step Linux-exempt**

Find the `- name: Build Electron app with Forge` step. Change its `if:` from `runner.os != 'macOS'` to:
```yaml
if: runner.os == 'Windows'
```

- [ ] **Step 3: Add a new electron-builder step for Linux**

Immediately after the Forge step, add:
```yaml
- name: Build Linux packages (electron-builder)
  if: runner.os == 'Linux'
  run: npx electron-builder --linux AppImage deb --${{ matrix.arch || 'x64' }}
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    CI: false
    VITE_BACKEND_URL: ${{ secrets.VITE_BACKEND_URL_PROD || 'https://sokuji-api.kizuna.ai' }}
    VITE_ENVIRONMENT: production
    VITE_POSTHOG_KEY: ${{ secrets.VITE_POSTHOG_KEY }}
    VITE_ENABLE_VOLCENGINE_ST: ${{ secrets.VITE_ENABLE_VOLCENGINE_ST }}
    VITE_ENABLE_VOLCENGINE_AST2: ${{ secrets.VITE_ENABLE_VOLCENGINE_AST2 }}
    VITE_ENABLE_PALABRA_AI: ${{ secrets.VITE_ENABLE_PALABRA_AI }}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: switch Linux build to electron-builder (AppImage + deb)"
```

---

### Task 15: Update CI artifact uploads for Linux

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Update Linux x64 upload paths**

Find the `- name: Upload Linux x64 artifacts` step. Replace its `path:` block with:
```yaml
path: |
  out/make-linux/*.AppImage
  out/make-linux/*.deb
  out/make-linux/latest-linux.yml
  extension/sokuji-extension-*.zip
  CHANGELOG.md
```

- [ ] **Step 2: Update Linux ARM64 upload paths**

Find the `- name: Upload Linux ARM64 artifacts` step. Replace its `path:` block with:
```yaml
path: |
  out/make-linux/*.AppImage
  out/make-linux/*.deb
  out/make-linux/latest-linux-arm64.yml
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: upload AppImage + latest-linux*.yml in Linux artifacts"
```

---

### Task 16: Update release-job asset collection

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Replace Linux asset-collection lines**

Find the `- name: Collect release assets` step. In its `run:` block, locate these lines:
```bash
find linux-x64-artifacts -name "*.deb" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "*.zip" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "sokuji-extension-*.zip" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "*.deb" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "*.zip" -exec cp {} release-assets/ \;
```

Replace them with:
```bash
find linux-x64-artifacts -name "*.deb" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "*.AppImage" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "latest-linux.yml" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "sokuji-extension-*.zip" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "*.deb" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "*.AppImage" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "latest-linux-arm64.yml" -exec cp {} release-assets/ \;
```

Note: the chromium `.zip` from Forge `maker-zip` is gone; we no longer cp it.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: replace .zip with AppImage + latest-linux*.yml in release assets"
```

---

## Phase 7 — End-to-end validation

### Task 17: Pre-release test tag (AppImage self-update cycle)

Validate the full AppImage auto-update cycle on a real Linux host before calling the feature done.

**Files:** no code changes (validation only).

- [ ] **Step 1: Cut a pre-release tag `vX.Y.Z-rc1`**

Run (replace version):
```bash
git tag -a v0.20.0-rc1 -m "Release v0.20.0-rc1 (AppImage auto-update test)"
git push origin v0.20.0-rc1
```

Expected: CI builds kick off; after build + sign-windows + release jobs succeed, a draft release is created with `Sokuji-0.20.0-rc1-x64.AppImage`, `Sokuji-0.20.0-rc1-arm64.AppImage`, two `.deb` files, `latest-linux.yml`, `latest-linux-arm64.yml`, and the existing Windows `.exe` + `latest.yml` + macOS `.pkg` assets.

- [ ] **Step 2: Publish the draft release (required for electron-updater to see it)**

On GitHub, find the draft release, edit it, un-check "Set as a pre-release" if needed, and click "Publish release". electron-updater only reads from published (non-draft) releases.

- [ ] **Step 3: Install `Sokuji-0.20.0-rc1-x64.AppImage` on a Linux host, verify it runs**

Download the AppImage from the release, `chmod +x`, run. Confirm basic function (audio, translation).

- [ ] **Step 4: Cut a second tag `vX.Y.Z-rc2`**

Make a trivial change (e.g., bump version number in `package.json`), commit, tag, and push:
```bash
npm version --no-git-tag-version 0.20.0-rc2
git add package.json package-lock.json
git commit -m "chore(release): v0.20.0-rc2"
git tag -a v0.20.0-rc2 -m "Release v0.20.0-rc2 (AppImage auto-update test)"
git push origin main
git push origin v0.20.0-rc2
```

Wait for CI → publish release.

- [ ] **Step 5: Trigger auto-update from running rc1 AppImage**

With rc1 still running, click "Check for Updates" in the app (or wait for startup check). Expected behavior:
- Banner appears: "New version v0.20.0-rc2 available"
- Click banner → UpdateDialog → "Download Now" → progress bar
- On completion → "Restart and Update" → app quits, relaunches as rc2
- Verify in rc2 the version number in Settings → About shows 0.20.0-rc2

- [ ] **Step 6: Confirm the old AppImage binary was replaced in place**

Check that the AppImage file you originally downloaded now has the rc2 version string inside it (e.g., `strings Sokuji-0.20.0-rc1-x64.AppImage | grep -o '0\.20\.0-rc[12]'` should show `0.20.0-rc2`). This confirms AppImageUpdater did in-place replacement.

- [ ] **Step 7: Commit the rc2 version bump if it's still dangling**

(Already committed in step 4; nothing extra here.)

---

### Task 18: .deb migration banner validation

**Files:** no code changes (validation only).

- [ ] **Step 1: Install `sokuji_0.20.0-rc1_amd64.deb`**

Run:
```bash
sudo dpkg -i sokuji_0.20.0-rc1_amd64.deb
sokuji
```

Expected: app starts, main log shows `[UpdateManager] Linux runtime: isAppImage=false, APPIMAGE=<unset>` once rc2 is the latest published release.

- [ ] **Step 2: Wait for startup update check (or click "Check for Updates")**

Expected:
- Main log shows `APPIMAGE env is not defined, current application is not an AppImage` (still emitted by electron-updater — expected noise)
- `update-status` IPC fires with `status: 'available'`, `supportsAutoUpdate: false`, `appImageUrl: '...AppImage'`, `debUrl: '...deb'`
- Banner appears with text "New version v0.20.0-rc2 available"
- Click banner → UpdateDialog opens with: auto-update note, "Download AppImage (recommended)", "Download .deb", "Later"
- Click "Download AppImage (recommended)" → browser opens the AppImage release asset URL
- Dialog closes

- [ ] **Step 3: Confirm no auto-download/install is attempted**

In logs, confirm there is NO `download-progress` event, NO `update-downloaded` event, and NO `autoUpdater.quitAndInstall` call. The .deb user's update flow is entirely browser-based.

- [ ] **Step 4: Cleanup — final commit if anything adjusted during validation**

If validation surfaced bugs, fix and commit. Otherwise this task has no commit.

---

## Completion Criteria

- [ ] Local `npx electron-builder --linux AppImage deb --x64` produces valid artifacts with `latest-linux.yml`
- [ ] AppImage build launches, audio pipeline works end-to-end, `process.env.APPIMAGE` is set
- [ ] `npx vitest run src/stores/updateStore.test.ts` passes
- [ ] CI green on Linux x64 (`ubuntu-latest`) and arm64 (`ubuntu-24.04-arm`)
- [ ] Draft release contains 2 AppImages, 2 debs, `latest-linux.yml`, `latest-linux-arm64.yml`, and all existing Windows/macOS assets
- [ ] AppImage self-update cycle: rc1 → rc2 via in-app "Restart and Update" works
- [ ] .deb user sees migration banner with both download links; no auto-download happens
- [ ] No regressions in Windows Squirrel update path or macOS PKG build
