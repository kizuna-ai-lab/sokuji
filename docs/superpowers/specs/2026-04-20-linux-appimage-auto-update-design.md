# Linux AppImage Packaging + Auto-Update Design

GitHub issue: [#124](https://github.com/kizuna-ai-lab/sokuji/issues/124)

## Summary

Add AppImage as the recommended Linux distribution format with full `electron-updater` auto-update support (x64 + arm64). Keep `.deb` for existing Debian/Ubuntu users but drop `.zip`. Users on non-AppImage Linux installs see an update notification that links to both the new AppImage and the new `.deb`, encouraging migration to the auto-updating format over time.

Linux packaging moves entirely from Electron Forge to `electron-builder`; Windows and macOS packaging stay on Forge. This split keeps a single tool per platform boundary and takes advantage of `electron-builder`'s native `electron-updater` integration (auto-generated `latest-linux.yml`, `AppImageUpdater` drop-in) without paying the cost of migrating the already-working Windows/macOS flows.

## Requirements

| Requirement | Decision |
|---|---|
| Linux packaging formats | AppImage (new, recommended) + `.deb` (retain); drop `.zip` |
| Architectures | x64 + arm64 |
| Build tool for Linux | `electron-builder` (replaces Forge `maker-deb` / `maker-zip`) |
| Build tool for Win/Mac | Electron Forge (unchanged) |
| Auto-update for AppImage | Full `electron-updater` flow (download + in-place replace + restart) |
| Auto-update for `.deb` | Not supported by electron-updater; show banner + links to AppImage (recommended) and `.deb` |
| AppImage detection | `process.env.APPIMAGE` at runtime |
| Update channel | Single stable channel (no beta/alpha segmentation for now) |
| ARM64 CI runner | `ubuntu-24.04-arm` (native ARM GitHub-hosted runner) |
| AppImage signing | Unsigned (consistent with current `.deb`); revisit in a future issue |
| FUSE fallback | Documented in release notes; no code change (user runs `--appimage-extract-and-run`) |

## Current Behavior vs After This Change

The existing auto-update spec (`2026-03-16-auto-update-design.md`) describes a "Linux: show update available + GitHub Release link" flow. **In practice this flow never triggers on current .deb builds** — CI only produces `latest.yml` for Windows, so `electron-updater`'s Linux check silently 404s on manifest fetch, `update-available` never fires, and the banner code path stays dormant. A real v0.18.1 `.deb` install shows no update UI at all; logs just include the soft warning `APPIMAGE env is not defined, current application is not an AppImage` from electron-updater's init.

This change fixes that as a side effect: once CI produces `latest-linux.yml` and `latest-linux-arm64.yml`, `update-available` fires on all Linux builds. AppImage users get full auto-update; `.deb` users finally get the "new version + migrate to AppImage" banner the original spec promised.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Build pipeline                           │
│                                                              │
│  Forge                         electron-builder              │
│  ├── Windows (Squirrel)        └── Linux x64/arm64           │
│  └── macOS (PKG)                   ├── AppImage              │
│                                    └── .deb                  │
│                                    + latest-linux.yml        │
│                                    + latest-linux-arm64.yml  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Update runtime (Linux)                   │
│                                                              │
│  isAppImage = !!process.env.APPIMAGE                         │
│                                                              │
│  AppImage path                  .deb / zip / dev path        │
│  ──────────────                 ─────────────────────        │
│  autoUpdater                    autoUpdater                  │
│   .checkForUpdates()             .checkForUpdates()          │
│   → update-available             → update-available          │
│   → downloadUpdate()             → (no auto download)        │
│   → quitAndInstall()             → banner shows 2 links:     │
│                                    AppImage (auto-update)    │
│                                    .deb (manual install)     │
└─────────────────────────────────────────────────────────────┘
```

## Module Design

### 1. electron-builder configuration (`package.json` `build` field)

```jsonc
{
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
}
```

Notes:
- `files` is the glob equivalent of Forge's function-based `ignore`. Exclude `build/wasm/**` then re-include runtime dirs explicitly (same semantics as current whitelist).
- `extraResources` preserves `assets/` and `resources/` in the app resource dir.
- Artifact names:
  - **AppImage**: `Sokuji-${version}-${arch}.AppImage` where `${arch}` is `x64` / `arm64` (electron-builder's internal arch names for AppImage).
  - **deb**: `sokuji_${version}_${arch}.deb` where `${arch}` is auto-mapped by electron-builder's deb target to Debian conventions (`x64` → `amd64`, `arm64` → `arm64`). UpdateManager must use the Debian-mapped value when constructing `debUrl`.
- `publish: null` — we don't use electron-builder's publisher; GitHub Release upload stays in the existing CI workflow.

### 2. Fuses parity (`scripts/electron-builder-fuses.js`)

Forge's `@electron-forge/plugin-fuses` applies Fuse V1 options at package time. electron-builder has no built-in Fuses integration, so we add an `afterPack` hook that calls `@electron/fuses` directly:

```js
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

exports.default = async function applyFuses(context) {
  const execPath = path.join(
    context.appOutDir,
    context.packager.executableName
  );
  await flipFuses(execPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
```

This produces a Linux binary with the same security posture as the Forge-built Linux binary today.

### 3. UpdateManager changes (`electron/update-manager.js`)

Replace the current Linux branch with an AppImage-aware split. Key additions:

```js
const isAppImage = process.platform === 'linux' && !!process.env.APPIMAGE;

// In 'update-available' handler:
if (process.platform === 'linux') {
  const version = info.version;
  const arch = process.arch; // 'x64' or 'arm64'
  const debArch = arch === 'x64' ? 'amd64' : 'arm64';
  const base = `https://github.com/kizuna-ai-lab/sokuji/releases/download/v${version}`;

  payload.supportsAutoUpdate = isAppImage;
  payload.appImageUrl = `${base}/Sokuji-${version}-${arch}.AppImage`;
  payload.debUrl = `${base}/sokuji_${version}_${debArch}.deb`;
  payload.releasePageUrl = `https://github.com/kizuna-ai-lab/sokuji/releases/tag/v${version}`;
}
```

In the `update-download` IPC handler:

```js
if (process.platform === 'linux' && isAppImage) {
  // electron-updater handles AppImage natively
  await autoUpdater.downloadUpdate();
  // success: 'update-downloaded' event fires → UI shows "Restart and Update"
  return { success: true };
}
if (process.platform === 'linux' && !isAppImage) {
  // No auto-download; renderer handles links via shell.openExternal
  return { success: false, error: 'not-supported' };
}
// Windows: existing manual .exe download path — unchanged
```

In the `update-install` IPC handler:

```js
if (process.platform === 'linux' && isAppImage) {
  autoUpdater.quitAndInstall();
  return { success: true };
}
// Non-AppImage Linux: never called (no install button shown)
// Windows: existing Squirrel launch path — unchanged
```

`autoUpdater.autoDownload` stays `false` globally — user always confirms before a download starts, on every platform.

### 4. updateStore changes (`src/stores/updateStore.ts`)

Add three fields to the state:

```ts
interface UpdateState {
  // ... existing fields ...
  supportsAutoUpdate: boolean;   // true on Win / AppImage Linux; false on .deb Linux
  appImageUrl: string | null;    // Linux only
  debUrl: string | null;         // Linux only
  releasePageUrl: string | null; // Linux only (used as fallback)
}
```

Populated from the `update-status` IPC payload when `status === 'available'`.

### 5. UI changes

**UpdateBanner**: when `supportsAutoUpdate === false` and status is `'available'`, render a distinct variant ("New version v{version} — auto-updates supported on AppImage") that opens UpdateDialog.

**UpdateDialog**: when `supportsAutoUpdate === false`, the button row switches from **[Download Now] [Later]** to:
- **[Download AppImage (recommended)]** — opens `appImageUrl` via `shell.openExternal`
- **[Download .deb]** — opens `debUrl`
- **[Later]** — dismiss for session

Include a one-line note: "AppImage supports automatic updates. Installing the AppImage replaces your current installation — no separate uninstall needed."

Existing AppImage auto-update UX (Download Now → progress → Restart and Update) is identical to the Windows path; no UI changes needed there.

### 6. New i18n keys

Under `update` namespace:

- `update.autoUpdateNote` — "AppImage supports automatic updates."
- `update.downloadAppImage` — "Download AppImage (recommended)"
- `update.downloadDeb` — "Download .deb"
- `update.linuxMigrateTitle` — "New version v{{version}} available"
- `update.linuxMigrateBody` — "Auto-updates are available on AppImage. Pick a format to download v{{version}}."

## CI/CD Changes

### Linux build jobs in `.github/workflows/build.yml`

**Matrix update**: change the arm64 row to use the native ARM runner:

```yaml
matrix:
  include:
    - os: ubuntu-latest         # x64
      name: linux-x64
    - os: ubuntu-24.04-arm      # native arm64 runner (was ubuntu-latest)
      name: linux-arm64
      arch: arm64
    # Windows / macOS rows unchanged
```

**Replace the Forge build step on Linux** with an `electron-builder` invocation:

```yaml
- name: Build Linux packages (electron-builder)
  if: runner.os == 'Linux'
  run: npx electron-builder --linux AppImage deb --${{ matrix.arch || 'x64' }}
  env:
    CI: false
    # Same VITE_* env block as the existing Forge step
```

The existing `npx electron-forge make` step stays exclusive to Windows (`runner.os == 'Windows'`); macOS keeps its current `build-pkg.sh` path.

**Upload artifacts** — add AppImage and `latest-linux*.yml` to the Linux uploads:

```yaml
- name: Upload Linux x64 artifacts
  if: startsWith(github.ref, 'refs/tags/v') && matrix.name == 'linux-x64'
  uses: actions/upload-artifact@v4
  with:
    name: linux-x64-artifacts
    path: |
      out/make-linux/*.AppImage
      out/make-linux/*.deb
      out/make-linux/latest-linux.yml
      extension/sokuji-extension-*.zip
      CHANGELOG.md

- name: Upload Linux ARM64 artifacts
  if: startsWith(github.ref, 'refs/tags/v') && matrix.name == 'linux-arm64'
  uses: actions/upload-artifact@v4
  with:
    name: linux-arm64-artifacts
    path: |
      out/make-linux/*.AppImage
      out/make-linux/*.deb
      out/make-linux/latest-linux-arm64.yml
```

**Release job** — extend `Collect release assets` to cp AppImage + `latest-linux*.yml`; drop the old `.zip` copy line:

```yaml
find linux-x64-artifacts -name "*.deb" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "*.AppImage" -exec cp {} release-assets/ \;
find linux-x64-artifacts -name "latest-linux.yml" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "*.deb" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "*.AppImage" -exec cp {} release-assets/ \;
find linux-arm64-artifacts -name "latest-linux-arm64.yml" -exec cp {} release-assets/ \;
# remove previous .zip cp lines
```

`latest.yml` (Windows) is still generated by the existing hand-rolled step — unchanged.

### `forge.config.js` cleanup

Remove `@electron-forge/maker-deb` and `@electron-forge/maker-zip` (Linux output is now electron-builder's job). `maker-squirrel` (Windows) and `maker-dmg` (macOS) stay.

### Dependencies

Add to `devDependencies`:
- `electron-builder` (Linux packaging + `latest-linux.yml` generation)
- `@electron/fuses` (if not already pulled in transitively via Forge's plugin-fuses; explicit dep keeps it stable for the afterPack hook)

Keep `electron-updater` as a runtime `dependency` (already present).

Remove from `devDependencies`:
- `@electron-forge/maker-deb`
- `@electron-forge/maker-zip`

## Audio Compatibility (Pre-Implementation Verification)

Context: the `electron-audio-loopback` migration for system audio capture is **already done** (`LinuxLoopbackRecorder.ts` deleted, `LoopbackRecorder.ts` handles capture on all platforms). The remaining Linux-specific audio surface is the virtual TTS devices created by `electron/pulseaudio-utils.js` (`sokuji_virtual_output` + `sokuji_virtual_mic`), which rely on host `pactl` + `pw-link`.

AppImage runs unsandboxed with the host's `$PATH` and sockets accessible, so these commands are expected to work. Verify on first dev AppImage build:

1. Build a dev AppImage: `npx electron-builder --linux AppImage --x64`
2. Launch it and confirm `process.env.APPIMAGE` is set (print to main log)
3. Confirm `pactl info` succeeds from within the AppImage process (host audio socket reachable)
4. Trigger `createVirtualAudioDevices()` and verify `sokuji_virtual_output` appears in host `pactl list sinks short`
5. Verify `electron-audio-loopback` (`getDisplayMedia`) works — requires `xdg-desktop-portal` on the host, which is present on all target desktop distros
6. Run an end-to-end translation session and confirm TTS output is routed through the virtual mic to the AI provider

**Fallback if `pw-link` fails inside AppImage** (low probability): replace pw-link connection with `pactl load-module module-loopback source=... sink=...`. This is a pure `pactl` call, uses no pipewire-specific tooling, and works on both PulseAudio and PipeWire (PipeWire emulates module-loopback). Implementation-time fallback only; not part of the initial change.

## Edge Cases

- **FUSE missing**: AppImage needs FUSE 2 to mount itself. Every major desktop distro ships it; minimal/container environments may not. Error message from AppImage is self-explanatory. Document in release notes: `./Sokuji.AppImage --appimage-extract-and-run` as fallback. No code change.
- **Executable bit after update**: `electron-updater`'s `AppImageUpdater` sets `chmod +x` on the replacement binary automatically.
- **`--no-sandbox`**: some exotic distros require this flag for Chromium sandbox compatibility. Our app currently doesn't set it in Forge builds; if AppImage users hit sandbox errors in QA, add `--no-sandbox` to the AppRun command (electron-builder config: `linux.executableArgs`). Not pre-emptively added.
- **Filename collisions**: With the pinned `artifactName` patterns, AppImage uses `x64`/`arm64` and `.deb` uses `amd64`/`arm64` (auto-mapped by electron-builder's deb target). Extensions differ anyway; no ambiguity in the release assets.
- **Existing users on `.zip`**: the `.zip` format is dropped. Users who discovered it will see it disappear from releases; the update banner will point them at AppImage. Impact expected to be near-zero (AppImage is strictly more useful than a directory ZIP).

## Out of Scope / Future Work

- **Windows NSIS migration** (Forge `maker-squirrel` → electron-builder NSIS) — would unify with Linux and unlock native `electron-updater` auto-update on Windows too, removing the manual `.exe` download workaround. Tracked as a separate GitHub issue.
- **AppImage GPG signing** — electron-builder supports it via `GPG_NAME` + `CSC_LINK`; we don't have a Linux signing key yet. Keep unsigned, consistent with current `.deb`.
- **Flatpak packaging** — tracked separately as #107.
- **apt repository hosting** — would enable true auto-update for `.deb` users. Infrastructure project, separate from this work.
- **Update channels** (beta / nightly) — not needed yet; single stable channel only.

## Files to Create/Modify

**New files:**
- `scripts/electron-builder-fuses.js` — afterPack hook applying `@electron/fuses` options.

**Modified files:**
- `package.json` — add `build` field (electron-builder config); add `electron-builder` + `@electron/fuses` to devDependencies; remove `@electron-forge/maker-deb` + `@electron-forge/maker-zip`.
- `forge.config.js` — remove Linux makers; keep Windows + macOS.
- `.github/workflows/build.yml` — replace Forge Linux build step with electron-builder; switch arm64 to `ubuntu-24.04-arm`; update artifact paths; update release-asset collection (drop `.zip`, add AppImage + `latest-linux*.yml`).
- `electron/update-manager.js` — add `isAppImage` branch; split download/install flows; populate `appImageUrl` / `debUrl` / `supportsAutoUpdate` on `update-available`.
- `src/stores/updateStore.ts` — add `supportsAutoUpdate`, `appImageUrl`, `debUrl`, `releasePageUrl` state fields.
- `src/components/UpdateBanner.tsx` / `.scss` — variant for non-auto-update Linux.
- `src/components/UpdateDialog.tsx` / `.scss` — variant with two download buttons + migration note.
- `src/i18n/locales/*/translation.json` — add `update.downloadAppImage` / `update.downloadDeb` / `update.linuxMigrateTitle` / `update.linuxMigrateBody` / `update.autoUpdateNote` (35+ locales).

**Unchanged:**
- Windows Squirrel flow (`maker-squirrel`, hand-written `latest.yml`, manual `.exe` download).
- macOS PKG flow (`build-pkg.sh`).
- Audio stack (`electron-audio-loopback`, `LoopbackRecorder.ts`, `pulseaudio-utils.js`).
