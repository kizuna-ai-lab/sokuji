# VB-CABLE prompt and the Microsoft Store installer

Status: design, approved in conversation 2026-10-16/17; awaiting review of the written form.
Mock: https://claude.ai/artifact/FGR2Z85T3MasCtph8QGkeP (boards WebOff, Main, WebInstalling, WebInstalled, WebFailed, StorePrompt; en/zh). Source: `.claude/artifact-scratch/vbcable-canvas/project/` (excluded from git).

## Goal

On Windows, the translation reaches a meeting app through VB-CABLE, a free driver from VB-Audio. Today Sokuji offers to install it with a native dialog at every launch. The Microsoft Store rejected v0.45.5 for that offer (policy 10.2.3.2, Software Bundling). This change does three things:

- The website's build keeps a one-click install, but offers it inside the app: once in a modal, and in the Speech settings where the driver is needed.
- The Store's build never installs anything. It explains where to get VB-CABLE and links to VB-Audio.
- Every release ships both installers. One SignPath request signs both.

## Rulings (the owner, 2026-10-16/17)

| # | Question | Ruling |
|---|---|---|
| R1 | Store vs. website | Option B: the website's build keeps the one-click install; the Store's build only links to VB-Audio. |
| R2 | Where the offer appears | "2+3": a one-time in-app modal (2), and a prompt under "Translation the other side hears" while that switch is on and VB-CABLE is missing (3). No native dialog at startup. |
| R3 | Tone | Softer: VB-CABLE is optional, and "Everything else in Sokuji works without it." Localized. |
| R4 | The success notice | "VB-CABLE is ready…" appears only after an install Sokuji started. It has a × and never hides by itself. It is not persisted. |
| R5 | Release artifacts | Two installers per release, signed in one SignPath request. |
| R6 | Backend | The pinned download route also serves the Store installer. |
| R7 | Listing | The Store listing's VB-CABLE sentences change, and the certification notes say the app only links to VB-Audio. |
| R8 | Copy | The mock's boards, as approved (§5). |

## Today (origin/main at c53f836e6, v0.45.5)

- **Startup.** `electron/main.js:547-551` awaits `createVirtualAudioDevices()` inside `app.whenReady`, before the window exists. On Windows, `electron/windows-audio-utils.js:18-50` runs `isVBCableInstalled()`, which tries wmic, then PowerShell `Get-PnpDevice`, then `sc query`, then PowerShell WMI. If VB-CABLE is missing it calls `vb-cable-installer.js` `ensureVBCableInstalled()`.
- **The native dialog.** That shows "VB-CABLE Required" (Install Now / Download Manually / Cancel) at every launch, and up to five more native dialogs during an install.
- **The install.** It downloads `VBCABLE_Driver_Pack45.zip`, extracts it with `Expand-Archive`, and starts `VBCABLE_Setup_x64.exe` through `Start-Process -Verb RunAs`, falling back to VBScript and then `shell.openPath`. It then polls `isVBCableInstalled` 30×2 s.
- **The banner.** When Windows setup "fails", `buildAudioStatus` (`main.js:199-232`) reports `reason: 'other'`. The banner then shows `audioSystem.unavailableBody`, the PulseAudio/PipeWire sentence (`src/components/Banner/useBanners.tsx:39`), which is wrong on Windows.
- **The Speech block.** `SpeechOutputSection.tsx` sets `hasVirtualBus = platform !== 'web'`. On Windows it therefore shows "Virtual microphone · CABLE Output (VB-Audio Virtual Cable)" and the Passthrough row even when VB-CABLE is missing.
- **Routing.** It finds the device by label: `findVirtualSpeaker(audioMonitorDevices)` (`src/lib/audio/virtualSpeaker.ts:10`; `appAudio.ts:58`).
- **IPC.** `check-vbcable` and `install-vbcable` (`main.js:853`, `:879`) have no renderer caller.
- **Release.** Windows runs one `electron-forge make` (`build.yml:315-317`).
  - `windows-unsigned` uploads `out/make/squirrel.windows/x64/*Setup*.exe` (`:599-604`).
  - SignPath's `default` configuration signs `*Setup*.exe`, exactly one match (`.signpath/artifact-configurations/default.xml`).
  - The release job copies every `*.exe` out of `windows-signed` (`:747`), and latest.yml takes the first `*.exe` it finds (`:772`).
  - maker-squirrel always writes `out/make/squirrel.windows/x64`, so a second make overwrites the first.
- **Updater.** `electron/update-manager.js:219` installs the first `.exe` listed in latest.yml.
- **Backend.** In sokuji-backend:
  - `pinnedAssetUrl` serves only `Sokuji-X.Y.Z.Setup.exe` (`src/routes/pinned-download.ts:62-67`).
  - `/api/download/windows` picks the asset ending `.Setup.exe` (`src/index.ts:852`).
- **Listing.** The Store listing (`~/Desktop/kizunaai/sokuji-store-listing/master_en.json`) says:
  - "if it is missing, Sokuji offers to install it for you";
  - "which Sokuji can install with your consent".

## Design

### 1. Distribution channel (main process)

`electron/distribution-channel.js` answers `'website'` or `'store'`.

**The marker.** The Store's installer is the website's packaged app with one extra file, `resources/distribution.json`, containing `{"channel":"store"}`. In a packaged app, `process.resourcesPath` points at that `resources` directory.

**Keeping the channel across updates.** The in-app updater installs the website's build over a Store install, and that build has no marker. So on the first launch of a marked build, the module writes the same JSON to `<userData>/distribution.json`. Every later launch reads either file. Only `store` is ever recorded.

**Failures.** The module never throws:
- An unreadable or malformed file counts as absent.
- A failed write still answers `store` for this launch.

**Where main uses it.** main.js resolves the channel once, lazily, after `app.setName`:
- `get-distribution-channel` (new IPC) returns it.
- `install-vbcable` refuses with `{ ok: false, reason: 'not-offered' }` unless the channel is `website`.

**Trade-off.** userData survives an uninstall. A Store user who later installs the website build stays in store mode, which means a link instead of one click. That is accepted (A3).

### 2. The installer (main process, website channel only)

`installVBCable()` is rewritten to run unattended and return a result the renderer draws. It shows no native dialogs.

**Result:** `{ ok: true } | { ok: false, reason: 'cancelled' | 'download-failed' | 'not-detected' | 'failed' }`.

**Steps:**
1. Already installed: `{ ok: true }`.
2. Download the zip with `fetch`. A non-2xx answer gives `download-failed`.
3. `Expand-Archive`.
4. `Start-Process -Verb RunAs -Wait` on `VBCABLE_Setup_x64.exe`. The user approves UAC and clicks "Install Driver" in VB-Audio's window. A declined UAC prompt gives `cancelled`.
5. Poll `isVBCableInstalled()` 5×2 s: `{ ok: true }`, or `not-detected`.

**Other details:**
- Any other error gives `failed`.
- The temp directory is removed on every outcome.
- PowerShell runs through `execFile` with arguments rather than a shell string, and every path is a single-quoted PowerShell literal with `'` doubled. A Windows user name with an apostrophe must not break the command.
- The VBScript and `shell.openPath` fallbacks go. A failure shows the failed state, which offers "Install it yourself".
- The dead exports go too: `ensureVBCableInstalled`, `promptVBCableInstallation`, `waitForInstallation`, `isAdmin`, `getVBCableDownloadUrl`, `getInstallationInstructions`.

### 3. Startup and the banner

On Windows, `createVirtualAudioDevices()` resolves `true` at once: there is nothing to create, and VB-CABLE's presence is the renderer's to read from the device list.

As a result:
- Startup never prompts, never runs PowerShell, and never waits on an install.
- `buildAudioStatus` reports `ok`, so the misworded banner can no longer appear on Windows.
- Linux and macOS are unchanged.

### 4. Renderer

**Presence.** `src/lib/audio/vbCable.ts` exports `vbCablePresence({ electron, windows, devicesLoaded, outputs })`, returning `'not-applicable' | 'unknown' | 'present' | 'missing'`:

| Answer | When |
|---|---|
| `not-applicable` | Anything but Windows Electron |
| `unknown` | The device list has not loaded, or every output label is empty (no media permission yet) |
| `present` | `findVirtualSpeaker(outputs)` finds a device: the same test the routing uses, so the prompt shows exactly when the routing has no virtual device |
| `missing` | Otherwise |

A hook `useVbCablePresence()` binds it to `audioStore`. A new device arrives through the existing `devicechange` → `syncDevices` path, so the prompt disappears by itself when the driver lands.

**Store.** `src/stores/vbCableStore.ts` holds:
- `channel` (`null` until loaded);
- `introSeen` (`null` until loaded; persisted as `audio.vbCableIntroSeen`);
- `attempt` (`'none' | 'running' | 'failed' | 'succeeded'`, this session only);
- `readyDismissed` (this session only).

Its actions:
- `load()` is idempotent. If the channel cannot be read it assumes `store`, which offers no install. If the seen flag cannot be read it assumes seen, so the user is not nagged.
- `install()` runs only in the website channel. It invokes `install-vbcable`, then re-reads the devices (`syncDevices()`).
- `checkAgain()` is `syncDevices()`.
- `dismissReady()` and `markIntroSeen()`.

A cancelled UAC prompt is not recorded as a failure; any other failure is recorded with `reportError`.

**`VbCableNotice`** (`src/components/VbCable/`) draws one state, `variant: 'row' | 'modal'`:

| Presence | Channel / attempt | Draws |
|---|---|---|
| `present` | attempt ≠ `none`, not dismissed | Ready: "VB-CABLE is ready." + the meeting-app line; × in the row variant |
| `present` | otherwise | nothing |
| `missing` | `store` | Store prompt: title, body, three steps, Open VB-Audio website, Check again, foot |
| `missing` | `website`, `none` | Prompt: title, body, Install VB-CABLE, About VB-CABLE, foot |
| `missing` | `website`, `running` | Installing: title, body, a disabled "Installing…" |
| `missing` | `website`, `succeeded` | Installing, with Check again in place of the busy button |
| `missing` | `website`, `failed` | Failed: title, body, Try again, Install it yourself |
| `unknown` / `not-applicable` | — | nothing |

**`succeeded` with the device still missing.** This means Windows reports the driver but Chromium has not listed it yet. The user gets Check again rather than a button stuck in its busy state.

**The Speech block.** `SpeechOutputSection` reads the presence:
- `hasVirtualBus` becomes `platform !== 'web' && presence !== 'missing'`. A missing VB-CABLE hides the "Virtual microphone · …" field and the Passthrough row, which can do nothing without it.
- The row's footer draws `VbCableNotice` above the voice line, only when the row is spoken (`otherOn`), not in face-to-face, and only where presence applies.
- SettingRow already leaves out the footer while the row is greyed, as in "Other" mode.

**The modal.** `VbCableIntro` mounts in `MainLayout` beside `TourOverlay`, and never in the subtitle takeover. It opens once all of these hold:
- presence is `missing`;
- the channel is loaded;
- `introSeen === false`;
- the tour is not active;
- the translation is spoken into the virtual microphone: `speechFromStores().other && !faceToFaceFromStores()`.

The `Modal` title is the prompt's title. Its body is `VbCableNotice variant="modal"`, which drops its own title and adds "Not now". Once open, it stays open through the install states until closed. Closing marks it seen, and dismisses a ready notice it showed. MainLayout renders it only after setup is complete, so it never meets the wizard.

### 5. Copy

New keys under `vbCable.*`. The other side's device name is the `{{mic}}` value, `virtualMicrophoneName()`, so it is never translated. Step 2 renders the file name in `<code>` through `Trans`.

| Key | en | zh_CN |
|---|---|---|
| title | Let the other side hear the translation | 让对方听到翻译 |
| body | Meeting apps take the spoken translation through a virtual microphone. On Windows that is VB-CABLE, a free driver from VB-Audio. Everything else in Sokuji works without it. | 会议软件通过虚拟麦克风接收翻译语音。在 Windows 上，这需要 VB-CABLE——VB-Audio 提供的免费驱动。不装它，Sokuji 的其他功能照常可用。 |
| install | Install VB-CABLE | 安装 VB-CABLE |
| about | About VB-CABLE | 了解 VB-CABLE |
| adminOnce | Windows asks for administrator permission once. | Windows 会请求一次管理员权限。 |
| installingTitle | Installing VB-CABLE… | 正在安装 VB-CABLE… |
| installingBody | Approve the Windows prompt, then click "Install Driver" in the VB-CABLE window. Sokuji picks it up as soon as it is installed. | 请在 Windows 的提示中点“是”，然后在 VB-CABLE 的窗口里点 “Install Driver”。装好后 Sokuji 会立刻识别。 |
| installingBusy | Installing… | 正在安装… |
| failedTitle | VB-CABLE wasn't installed | VB-CABLE 没有装上 |
| failedBody | The installation was cancelled or didn't finish. Try again, or install it yourself from VB-Audio's website. | 安装被取消，或者没有完成。可以重试，也可以去 VB-Audio 官网自己安装。 |
| retry | Try again | 重试 |
| installYourself | Install it yourself | 自己安装 |
| readyTitle | VB-CABLE is ready. | VB-CABLE 已就绪。 |
| readyBody | In your meeting app, choose "{{mic}}" as the microphone. | 在会议软件里，把麦克风选为 “{{mic}}”。 |
| storeStep1 | Download the VB-CABLE pack (zip) from VB-Audio's website. | 在 VB-Audio 官网下载 VB-CABLE 安装包（zip）。 |
| storeStep2 | Unzip it, right-click `<code>{{file}}</code>` and choose "Run as administrator". | 解压后，右键 `<code>{{file}}</code>`，选“以管理员身份运行”。 |
| storeStep3 | Click "Install Driver", then restart your PC. | 点 “Install Driver”，然后重启电脑。 |
| openWebsite | Open VB-Audio website | 打开 VB-Audio 官网 |
| checkAgain | Check again | 重新检测 |
| picksUp | Sokuji picks it up automatically once it is installed. | 装好后 Sokuji 会自动识别。 |
| notNow | Not now | 以后再说 |

**Rules for the other 28 catalogs:**
- Keep "VB-CABLE", "VB-Audio" and "Install Driver" verbatim: they are VB-Audio's names and its English-only UI.
- Write "Run as administrator" as Windows itself names it in that language.

The × uses the existing `common.dismiss`.

### 6. Release pipeline

**The second installer (Windows build job).** After the existing make:
1. Move `out/make` to `out/make-web`.
2. Write the marker into the packaged app.
3. Run `electron-forge make --from-package`.
4. Check that only the new package contains `resources/distribution.json`; the two installers are the same size, because Setup.exe is padded.
5. Rename the new Setup to `Sokuji-X.Y.Z-store-installer.exe`.

This runs on every Windows build, so a PR exercises it. Only a tag uploads.

**The name.** It deliberately contains neither `Setup` nor `.Setup.exe`:
- latest.yml, the updater and `/api/download/windows` keep finding only the website's installer;
- SignPath's two patterns each match exactly one file.

**Upload and signing.**
- Both installers are copied into one directory and uploaded as `windows-unsigned`, so both sit at the zip's root.
- SignPath's `default` configuration gets a second `<pe-file path="*-store-installer.exe">`. The owner updates the configuration in the SignPath UI to the repo's `.signpath/artifact-configurations/default.xml` before the next tag.
- One signing request means one manual approval.

**Release job.** It copies both signed installers. latest.yml is generated from `*.Setup.exe` only, and the job fails if it does not find exactly one. The nupkg comes from the website make.

### 7. Backend (kizuna-ai-lab/sokuji-backend)

`pinnedAssetUrl` also accepts `Sokuji-X.Y.Z-store-installer.exe` for tag `vX.Y.Z`. Everything else about the route is unchanged. The Store submission's installer URL becomes `https://sokuji.kizuna.ai/api/download/vX.Y.Z/Sokuji-X.Y.Z-store-installer.exe`.

### 8. Listing and certification notes

**Description.** The sentence becomes: "On Windows this uses VB-CABLE, a free virtual audio driver from VB-Audio that you install separately; Sokuji links to it and picks it up automatically."

**License terms.** They become: "The VB-CABLE virtual audio driver, which you can install separately for the virtual microphone, is third-party software from VB-Audio under its own license."

Both change in the 29 translations, and the CSV is regenerated.

**Certification notes:** "Sokuji does not install any third-party software. One optional feature, sending the translated voice into meeting apps as a microphone, works when the user has installed the free VB-CABLE driver from VB-Audio. The app only links to vb-audio.com for that. Every other feature works without it."

## Assumptions (made in writing; the owner may overrule)

- **A1.** The modal shows only when the translation is spoken into the virtual microphone, not to a user who chose only to understand others. The row prompt covers them if they turn it on later.
- **A2.** In the Store build the modal shows too, with the Store prompt (link and steps, no install).
- **A3.** The sticky Store record lives in userData (§1).
- **A4.** The install stays interactive (the user clicks "Install Driver"), as the mock's copy says. VB-Audio's silent `-i -h` switches are not used.
- **A5.** The Store build keeps the in-app updater, unchanged.

## Out of scope

- The dead `check-vbcable` handler.
- MSIX.
- A standalone audio-host release.
- The tour's `output-routing` step ("You need a virtual audio cable (for example VB-Cable)…"), which offers no install.

## Live test (Windows, .13)

1. Website build, VB-CABLE absent: no dialog at launch; after setup, the modal once; Install → UAC → VB-Audio window → the ready notice in the modal and in Speech; × hides it; it is not back after a restart.
2. Declining UAC → the failed state; Try again works.
3. The Store build (the store installer, or `distribution.json` written by hand into `%LocalAppData%\sokuji\app-X.Y.Z\resources`): link and steps, no install button; `install-vbcable` refuses; after an in-app update to the website build, still store.
4. VB-CABLE present: no modal, no prompt; the field reads "Virtual microphone · CABLE Output (VB-Audio Virtual Cable)".
5. Smart App Control on: both installers install.
