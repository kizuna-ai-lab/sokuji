# Windows: say why the microphone would not open

Status: approved 2026-10-13, implemented on `worktree-mic-in-use-holder`.

## Problem

On Windows a Start can fail with `The microphone could not be opened (NotReadableError); it may be in use by another application.` In the 30 days to 2026-10-13, 29 desktop users hit it, all on Windows (versions 0.40.3 to 0.43.4, no shared device, driver or OS build), and 6 of them never started a session. One user pressed Start eleven times over an hour and a half before it worked. Nothing told them which application held the microphone, or what else to try.

Reproduced on the Windows test machine: an application that opens the microphone in WASAPI exclusive mode makes Sokuji's Start fail with exactly this error, and Start works again once it lets go.

## Facts this design rests on

- **Chromium's mapping** (`chromium/chromium` main, present in Electron 44): `IAudioClient::Initialize` returning `AUDCLNT_E_DEVICE_IN_USE` becomes `NotReadableError` "Audio capture device already in use"; `E_ACCESSDENIED`, which is what Windows' microphone privacy switch produces, becomes **`NotAllowedError`** "System Permissions prevented access to audio capture device"; any other failure becomes `NotReadableError` "Failed to access audio capture device" (or "…was removed"). So a privacy block never reaches the "in use" sentence, and the DOMException's message separates "in use" from "driver or device".
- **Who holds a device** (measured on the test machine, Windows 11 26200): WASAPI session enumeration on the capture endpoint (`IMMDeviceEnumerator` → `IAudioSessionManager2::GetSessionEnumerator` → `IAudioSessionControl2::GetProcessId` / `GetState`) lists the exclusive holder as an active session, and only while it holds the device. Shared-mode users are listed too (Sokuji's own capture appeared on another microphone). Run as PowerShell with inline C# it takes about 370 ms including PowerShell's start. The registry's `CapabilityAccessManager\ConsentStore\microphone`, which drives Windows' privacy indicator, never recorded the exclusive holder, so it is not used.
- The device label Chromium reports is the endpoint's friendly name (`PKEY_Device_FriendlyName`), with ` (vvvv:pppp)` appended for some USB devices.

## Scope

Windows desktop only, and only the **first** open of the microphone at Start. A device that fails to open later, on a switch or after a lost track, already marks itself unusable and the store picks the next one (`mic.ts` `switchTo`); that stays. macOS, Linux, the extension and the web are unchanged.

## Design

### 1. Which applications are using the device (Electron main)

- New module `electron/mic-users-win.js`: runs one PowerShell process (`-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand`, `windowsHide`, killed after 4 s) whose inline C# lists, for every active capture endpoint, the active audio sessions: endpoint friendly name, process id, process name, and the executable's file description when readable. Output is JSON on UTF-8.
- It keeps the endpoint whose friendly name equals the label with any trailing ` (xxxx:xxxx)` removed, drops process id 0 and every Sokuji process (`app.getAppMetrics()`), names each process by its file description, else `<name>.exe`, and removes duplicates.
- It never throws. It answers `{ ok: true, users: string[] }` when the device was found (an empty list means nobody else), `{ ok: true, users: null }` when no endpoint matched the label, and `{ ok: false, error }` on any failure or timeout.
- New IPC `list-microphone-users` (argument: the label), Windows only.

### 2. Classifying a first-open failure (renderer)

- `MicSettings` gains an optional `appsUsing(label)`, present only on Windows desktop: the applications using that device, or `null` when that cannot be told. `appCapture.ts` binds it to the IPC.
- When the first open throws a `MicrophoneCaptureError` and `appsUsing` is present, `openMic` throws a `SourceOpenError` instead, with the original as its cause:

| DOMException | Lookup | Code | Params |
|---|---|---|---|
| `NotReadableError` or `AbortError` | one or more applications | `mic_in_use` | `device`, `apps` |
| `NotReadableError` or `AbortError` | none, or unknown | `mic_unreadable` | `device` |
| `NotAllowedError`, `PermissionDeniedError` or `SecurityError` | not asked | `mic_blocked` | — |

  Any other failure is thrown unchanged (today's `start_failed`).
- The error's message, which reaches the Logs panel and analytics, carries the DOMException's name and Chromium's message and the number of applications found, **never their names**: e.g. `The microphone is in use by 1 other application (NotReadableError: Audio capture device already in use).` The names travel only in `params`, which only the status line draws.

### 3. What the user reads, and the one button

The status line already draws a start failure's code through `noticeText` and offers one action per code (spec 2026-10-05 §6; a line has an action or a dismiss, never both). Three new notice codes, worded in all 30 catalogs:

| Code | English | Action |
|---|---|---|
| `mic_in_use` | `The microphone “{{device}}” is in use by {{apps}}. Close {{apps}} and start again, or choose another microphone.` | **Settings**: Sokuji's microphone section, to choose another microphone |
| `mic_unreadable` | `Windows could not open the microphone “{{device}}”. Another app may be holding it, or its driver stopped responding. Close apps that use it or reconnect it, then start again.` | **Settings**: Sokuji's microphone section, to choose another microphone |
| `mic_blocked` | `Windows is not letting Sokuji use the microphone. Turn on microphone access for desktop apps in Settings › Privacy & security › Microphone, then start again.` | **Open System Settings**: `ms-settings:privacy-microphone` |

- New action kind `{ kind: 'windows-settings'; page: 'microphone-privacy' }`, dispatched by MainPanel to a new IPC `open-windows-settings`, labelled with the existing `audioPanel.openSystemSettings`.
- No button for exclusive mode (R3): the classic Sound panel opens on a list of devices, two dialogs short of the "Allow applications to take exclusive control" box, and unticking it does not make the application holding the microphone let go; only closing that application does. Exclusive mode is advice for the help pages, not the status line.
- No Retry button: Start sits directly under the status line.
- The subtitle takeover keeps its rule (only Sokuji's own settings get a button there), so `mic_in_use` and `mic_unreadable` show one there and `mic_blocked` does not.

### 4. Telemetry

- `LegOpenError` records whether the leg failed opening its **source** or its **adapter**. A source failure's `api_error` has `error_type: 'device'`, a new value; it was `'server'`. `loopback_denied` joins it.
- `error_code` is the source's code when it has one: the three codes above tell "an application was found" from "none was".
- `error_message` keeps Chromium's words, so "already in use" can be told from "failed to access".
- No application names reach PostHog.

## Rulings (the owner, 2026-10-13)

| # | Question | Ruling |
|---|---|---|
| R1 | Scope of the improvement | All four: name the holder, separate wording when none is found (privacy is `NotAllowedError`), one action per case, telemetry. |
| R2 | New `error_type: 'device'` | Yes; dashboards counting `'server'` lose these failures, which is the correction. |
| R3 | `mic_in_use`'s button | First Open Sound Settings, not Retry; after trying it on the test machine, Settings › microphone (option A): the Sound panel cannot fix a microphone another application already holds. |

## Verification

- Unit tests for the lookup's parsing and label match (Node), the classification, the notice words in all catalogs, the action, the dispatch and the runner's `error_type`.
- On the Windows test machine (2026-10-13): the lookup run by Node against a microphone held exclusively (`["Python"]`, about 350 ms; `[]` when free; `null` for no such device); the dev build with the fake provider: `mic_in_use` naming Python about 1.3 s after Start, a normal start and stop once the microphone was free, and `mic_blocked` with the privacy switch turned off in Settings (the owner; writing the registry value directly does not take effect). `mic_unreadable` is covered by unit tests only: no way was found to make a device fail without a holder.
