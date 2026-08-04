# Per-Application Audio Capture — Windows (WASAPI Process Loopback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the audio of one chosen Windows application as participant audio, so games, music and video playing elsewhere never reach the translation pipeline.

**Architecture:** A small self-built CLI helper (`sokuji-audio-host.exe`) wraps WASAPI process loopback: argv in, raw PCM on stdout, JSON events on stderr. No port, no handshake, no daemon — the main process spawns it and kills it. Electron forwards the PCM to the renderer over the existing IPC bridge, where an `AppAudioRecorder` implements the established `IParticipantAudioRecorder` seam. The helper asks WASAPI for 24 kHz mono s16 directly, so no resampling or gap-filling exists anywhere in the pipeline.

**Tech Stack:** C++17 (MSVC, no third-party libraries), Electron 40 main process (CommonJS), TypeScript renderer, Vitest.

**Issue:** https://github.com/kizuna-ai-lab/sokuji/issues/335

## Global Constraints

- **No new npm dependencies and no NuGet packages.** The Microsoft ApplicationLoopback sample depends on `wil` and Media Foundation; this helper deliberately uses neither (see Verified Facts 7). Only `ole32.lib` and `mmdevapi.lib`.
- The helper binary is **built by us and vendored**, following the precedent of
  `resources/drivers/SokujiVirtualAudio.driver/Contents/MacOS/SokujiVirtualAudio` (a
  git-tracked compiled artifact shipped via `forge.config.js:34`'s
  `extraResource: ['assets', 'resources']`, resolved at runtime under
  `Contents/Resources/resources/...` — see `pkg-scripts/postinstall:15`).
- **Windows-only.** Nothing in this plan may change Linux or macOS behaviour. On non-Windows
  platforms every entry point must no-op or return "unsupported" without throwing.
- **stdout carries only PCM.** All logging, format and error reporting goes to stderr as one
  JSON object per line. Anything printed to stdout corrupts the audio stream.
- All comments and documentation are **English only** (project CLAUDE.md).
- Adding a renderer→main IPC channel = add its name to `INVOKE_CHANNELS` in
  `electron/ipc-channels.js`; `preload.js`'s allowlist and `ipc-channels.test.js` follow
  automatically. Main→renderer pushes (`webContents.send`) are received through the
  `on`/`removeListener` bridge already exposed at `electron/preload.js:77`.
- **Do not gate on `tsc`.** ~113 pre-existing type errors; the correctness gate is Vitest.
- Conventional commit format.
- Run single test files with `npx vitest run <path>` (`npm run test` starts watch mode).

## Prerequisite: the shared source-selection seam

This plan implements the Windows **capture** path. The user-facing **picker** — the
participant-source list, the Zustand state, and the routing in
`ModernBrowserAudioService` — is platform-neutral and is specified as **Tasks 6–9 of
`docs/superpowers/plans/2026-08-04-per-app-audio-capture-linux.md`**. Whichever plan runs
first must land those four tasks; the other then reuses them unchanged.

If this Windows plan runs first, execute that plan's Tasks 6, 7, 8 and 9 before this plan's
Task 8 here. They introduce, and this plan depends on:

- `AudioDevice` entries of the form `{ deviceId, label }` returned by
  `list-system-audio-sources`
- `useSelectedParticipantSource()` / `DEFAULT_PARTICIPANT_SOURCE` in `src/stores/audioStore.ts`
- `ModernBrowserAudioService.connectSystemAudioSource(id)` storing
  `currentSystemAudioSinkId`, and `startSystemAudioRecording` branching on it

## Verified Facts (measured on 192.168.1.13, Windows 11 Pro build 26200, 2026-08-04)

Every one of these was proven by building and running a spike on the real machine. Several
contradict what public documentation and the earlier design assumed — **do not "fix" the
plan back toward the assumptions.**

1. **The build works with what is installed:** MSVC 14.29.30133 (VS 2019 Build Tools) via
   `C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat`,
   Windows SDK 10.0.19041.0. That SDK **does** ship `audioclientactivationparams.h` even
   though MSDN lists the API's minimum client as build 20348.
2. **`cl /nologo /EHsc /std:c++17 x.cpp /link ole32.lib mmdevapi.lib` is the whole build.**
   No `wil`, no Media Foundation, no NuGet, no CMake (cmake is not installed).
3. **Process loopback works from Windows session 0.** The helper was activated, initialized,
   started and captured audio entirely over SSH, while the interactive desktop was session 1.
   `ActivateAudioInterfaceAsync` targets the pseudo-device
   `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`, not a session-bound endpoint. **This means the
   whole Windows verification in Task 5 runs over SSH — no PsExec, no scheduled task, and
   nobody has to sit at the machine.**
4. **The caller picks the format; WASAPI converts.** `IAudioClient::Initialize` with
   `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM` accepted a hand-built `WAVEFORMATEX` of
   **24000 Hz, 1 channel, 16-bit** and returned `S_OK`. The capture buffers arrive in exactly
   that format. **There is therefore no resampling and no stereo→mono downmix anywhere** —
   the bytes are already what `client.appendInputAudio()` wants.
5. **The stream is continuous even when the target renders nothing.** Capturing a silent
   `explorer.exe` for 3 s produced **144000 bytes against an expected 144000**, with
   `timeouts:0`, 300 event wakeups (10 ms buffers) and a peak sample amplitude of 1.
   **Process loopback does not stall on silence.** The widely-reported "loopback stops when
   nothing is playing" behaviour applies to *device* loopback, not process loopback, so
   **no wall-clock silence insertion is needed.**
6. **Isolation is real, and this is the issue's acceptance criterion.** With one process
   playing a 440 Hz tone at amplitude 12000:
   - capturing a *different*, quiet process → `peak: 1` (silence)
   - capturing the *playing* process → `peak: 11985` (the tone)
7. The Microsoft sample (`microsoft/Windows-classic-samples`,
   `Samples/ApplicationLoopback/cpp/`) is a useful reference for the activation dance but
   drags in `wil` and Media Foundation work queues and writes a WAV file. The spike
   reproduced the needed behaviour in ~150 lines with a plain
   `WaitForSingleObject` loop. Follow the spike shape, not the sample's.

### Reference: the activation sequence that was proven to work

```cpp
AUDIOCLIENT_ACTIVATION_PARAMS p{};
p.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
p.ProcessLoopbackParams.TargetProcessId = pid;
p.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

PROPVARIANT pv{};
pv.vt = VT_BLOB;
pv.blob.cbSize = sizeof(p);
pv.blob.pBlobData = (BYTE*)&p;

IActivateAudioInterfaceAsyncOperation* op = nullptr;
ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                            __uuidof(IAudioClient), &pv, &completionHandler, &op);
// wait on the handler's event, then GetActivateResult -> IAudioClient

client->Initialize(AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    0, 0, &fmt /* 24000 Hz, 1 ch, 16-bit */, nullptr);
```

The completion handler must answer `QueryInterface` for `IUnknown`,
`IActivateAudioInterfaceCompletionHandler` **and `IAgileObject`**; without `IAgileObject` the
callback cannot marshal and activation hangs until the timeout.

## Prerequisite: environment

Building and verifying happens on the Windows box over SSH:

```bash
ssh jiang@192.168.1.13   # key auth, no password
```

`ping` to that host fails — the default firewall drops ICMP while port 22 is allowed. Do not
read that as the host being down.

Drive PowerShell with `-EncodedCommand` (base64 UTF-16LE). Piping a script to
`powershell -Command -` over this SSH truncates or returns nothing:

```bash
B=$(node -e "process.stdout.write(Buffer.from(require('fs').readFileSync(process.argv[1],'utf8'),'utf16le').toString('base64'))" script.ps1)
ssh jiang@192.168.1.13 "powershell -NoProfile -EncodedCommand $B"
```

Put `$ProgressPreference='SilentlyContinue'` at the top of every script, or output is
polluted with `#< CLIXML` progress records.

---

### Task 1: Decide how `--list` enumerates candidate applications

**This task is a spike with a decision, not a guess.** Two enumeration strategies exist and
the plan does not assume which works, because the one with better UX may not function in the
context the helper runs in.

**Files:**
- Create: `native/audio-host/win/spike_enum.cpp` (throwaway — deleted in Step 4)

**Interfaces:**
- Produces: a recorded decision, written into this plan file and into Task 2's implementation.

- [ ] **Step 1: Write a spike that tries the audio-session strategy**

Strategy A enumerates only processes that actually hold an audio session, which is the better
list to show a user. It needs a render endpoint, and the helper may run without one.

```cpp
// native/audio-host/win/spike_enum.cpp — strategy A
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <cstdio>

int main() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    IMMDeviceEnumerator* en = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                  __uuidof(IMMDeviceEnumerator), (void**)&en);
    printf("CoCreateInstance hr=0x%08X\n", hr);
    if (FAILED(hr)) return 1;

    IMMDevice* dev = nullptr;
    hr = en->GetDefaultAudioEndpoint(eRender, eConsole, &dev);
    printf("GetDefaultAudioEndpoint hr=0x%08X\n", hr);
    if (FAILED(hr)) return 1;   // <- if this fails, strategy A is not usable here

    IAudioSessionManager2* mgr = nullptr;
    hr = dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&mgr);
    printf("Activate(SessionManager2) hr=0x%08X\n", hr);
    if (FAILED(hr)) return 1;

    IAudioSessionEnumerator* sessions = nullptr;
    hr = mgr->GetSessionEnumerator(&sessions);
    int count = 0;
    if (SUCCEEDED(hr)) sessions->GetCount(&count);
    printf("session count=%d\n", count);

    for (int i = 0; i < count; i++) {
        IAudioSessionControl* ctl = nullptr;
        if (FAILED(sessions->GetSession(i, &ctl))) continue;
        IAudioSessionControl2* ctl2 = nullptr;
        if (SUCCEEDED(ctl->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&ctl2))) {
            DWORD pid = 0; ctl2->GetProcessId(&pid);
            printf("  session pid=%lu\n", pid);
            ctl2->Release();
        }
        ctl->Release();
    }
    return 0;
}
```

- [ ] **Step 2: Build and run it on the Windows box**

```bash
scp native/audio-host/win/spike_enum.cpp jiang@192.168.1.13:C:/Users/jiang/spike_enum.cpp
```

Then compile with `vcvars64.bat` + `cl /nologo /EHsc /std:c++17 spike_enum.cpp /link ole32.lib`
and run it.

Expected outcomes and what each means:
- `GetDefaultAudioEndpoint hr=0x00000000` and a non-zero session count → **strategy A works**;
  Task 2 lists only processes holding audio sessions.
- `GetDefaultAudioEndpoint` fails (commonly `0x80070490`, element not found) or the count is
  always 0 → **strategy A is unusable in this context**; Task 2 must use strategy B below.

- [ ] **Step 3: Record the decision in this file**

Edit this task in the plan and write the observed HRESULT and session count, plus the chosen
strategy, so Task 2's implementer does not re-run the spike.

> **Decision (fill in):** `GetDefaultAudioEndpoint hr=______`, session count `______`.
> Chosen strategy: **A (audio sessions)** / **B (visible windows)**.

**Strategy B, the fallback**, enumerates top-level visible windows and maps them to PIDs —
this is what the Microsoft sample's companion tool does and it needs no audio endpoint:

```cpp
struct Row { DWORD pid; wchar_t title[256]; };
BOOL CALLBACK OnWindow(HWND hwnd, LPARAM lp) {
    if (!IsWindowVisible(hwnd)) return TRUE;
    if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;   // skip tool/child windows
    wchar_t title[256] = {};
    if (GetWindowTextW(hwnd, title, 255) == 0) return TRUE;  // skip untitled windows
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) return TRUE;
    reinterpret_cast<std::vector<Row>*>(lp)->push_back(Row{pid, {}});
    wcscpy_s(reinterpret_cast<std::vector<Row>*>(lp)->back().title, title);
    return TRUE;
}
```

Strategy B lists applications that are not playing anything, which is acceptable: the picker
is "which app do you want to translate", and a meeting window is present before anyone speaks.

- [ ] **Step 4: Delete the spike and commit the decision**

```bash
rm native/audio-host/win/spike_enum.cpp
git add docs/superpowers/plans/2026-08-04-per-app-audio-capture-windows.md
git commit -m "docs(audio): record Windows enumeration strategy decision"
```

---

### Task 2: The `sokuji-audio-host.exe` helper

**Files:**
- Create: `native/audio-host/win/main.cpp`
- Create: `native/audio-host/win/build.bat`
- Create: `native/audio-host/README.md`

**Interfaces:**
- Produces the command-line contract every later task depends on:
  - `sokuji-audio-host.exe --list`
    → one JSON array on stdout, then exit 0:
    `[{"id":"pid:12345","label":"Zoom Meetings","exe":"Zoom.exe"}]`
  - `sokuji-audio-host.exe --target pid:12345`
    → raw PCM on stdout until killed; on stderr, first
    `{"event":"format","sampleRate":24000,"channels":1,"encoding":"s16le"}`
    then `{"event":"error","code":"..."}` on failure.
  - Exit codes: `0` clean, `1` runtime failure, `2` bad usage.
  - Error codes: `bad_target`, `activation_failed`, `initialize_failed`, `target_gone`.

**There is no `--rate`/`--channels` flag.** The format is fixed at 24 kHz mono s16 because
that is exactly what the pipeline consumes (Verified Fact 4); a flag would only create ways
to be wrong.

- [ ] **Step 1: Write `main.cpp`**

Use the activation sequence from the Verified Facts section verbatim. Structure:

```cpp
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>

// stdout MUST be binary, or Windows translates 0x0A bytes into 0x0D 0x0A and
// silently corrupts every PCM sample that happens to contain a newline byte.
static void SetBinaryStdout() { _setmode(_fileno(stdout), _O_BINARY); }

static void Emit(const char* json) { fprintf(stderr, "%s\n", json); fflush(stderr); }
```

The completion handler is the `Handler` class from the Verified Facts section — it must
answer `QueryInterface` for `IAgileObject`.

The capture loop, which was measured to deliver a continuous stream:

```cpp
    while (!stopRequested) {
        if (WaitForSingleObject(ready, 500) != WAIT_OBJECT_0) continue;
        for (;;) {
            BYTE* data = nullptr; UINT32 frames = 0; DWORD flags = 0;
            HRESULT hr = cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr) || hr == AUDCLNT_S_BUFFER_EMPTY || frames == 0) {
                if (SUCCEEDED(hr) && frames == 0) cap->ReleaseBuffer(0);
                break;
            }
            // AUDCLNT_BUFFERFLAGS_SILENT means "the buffer contents are undefined,
            // treat as silence" — write zeros rather than whatever is in memory,
            // and never skip the write: the downstream clock relies on every
            // buffer being forwarded.
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                static const char zeros[4096] = {};
                DWORD remaining = frames * blockAlign;
                while (remaining > 0) {
                    DWORD chunk = remaining < sizeof(zeros) ? remaining : sizeof(zeros);
                    fwrite(zeros, 1, chunk, stdout);
                    remaining -= chunk;
                }
            } else {
                fwrite(data, 1, (size_t)frames * blockAlign, stdout);
            }
            fflush(stdout);
            cap->ReleaseBuffer(frames);
        }
    }
```

Parse `--target pid:<n>`; reject anything else with `{"event":"error","code":"bad_target"}`
and exit 2. Emit the `format` event **after** `Initialize` succeeds and **before** the first
PCM byte.

- [ ] **Step 2: Write `build.bat`**

```bat
@echo off
setlocal
set VCVARS="C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist %VCVARS% (
  echo ERROR: VS 2019 Build Tools not found at %VCVARS%
  exit /b 1
)
call %VCVARS% >nul
cd /d "%~dp0"
if not exist out mkdir out
cl /nologo /EHsc /std:c++17 /O2 main.cpp /Fo:out\ /link ole32.lib mmdevapi.lib /out:out\sokuji-audio-host.exe
exit /b %ERRORLEVEL%
```

- [ ] **Step 3: Build it on the Windows box**

```bash
ssh jiang@192.168.1.13 'mkdir C:\Users\jiang\audio-host' 2>/dev/null
scp native/audio-host/win/main.cpp native/audio-host/win/build.bat jiang@192.168.1.13:C:/Users/jiang/audio-host/
```

Run `build.bat` via the `-EncodedCommand` pattern.
Expected: exit 0 and `out\sokuji-audio-host.exe` present.

- [ ] **Step 4: Write `native/audio-host/README.md`**

Document the command-line contract, the exact `cl` line, why there is no `wil`/MF dependency,
and that the binary is committed under `resources/bin/win32-x64/` by Task 4.

- [ ] **Step 5: Commit**

```bash
git add native/audio-host
git commit -m "feat(audio): add Windows process-loopback capture helper"
```

---

### Task 3: Helper contract tests on real hardware

The helper is a binary, so its tests are executions against the real machine, not Vitest.

**Files:**
- Create: `native/audio-host/win/verify.ps1`

**Interfaces:**
- Consumes: `sokuji-audio-host.exe` from Task 2.
- Produces: a repeatable verification script committed alongside the helper.

- [ ] **Step 1: Write `verify.ps1`**

This mirrors the spike that established Verified Facts 5 and 6.

```powershell
$ProgressPreference = 'SilentlyContinue'
$exe = "$PSScriptRoot\out\sokuji-audio-host.exe"

# A 440 Hz tone at amplitude 12000, 5 s, 44.1 kHz mono — deliberately NOT the
# capture rate, so the run also proves AUTOCONVERTPCM resampling works.
$rate=44100; $secs=5; $n=$rate*$secs
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([char[]]'RIFF'); $bw.Write([int](36+$n*2)); $bw.Write([char[]]'WAVE')
$bw.Write([char[]]'fmt '); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]1)
$bw.Write([int]$rate); $bw.Write([int]($rate*2)); $bw.Write([int16]2); $bw.Write([int16]16)
$bw.Write([char[]]'data'); $bw.Write([int]($n*2))
for ($i=0; $i -lt $n; $i++) { $bw.Write([int16]([math]::Sin(2*[math]::PI*440*$i/$rate)*12000)) }
$bw.Flush(); [System.IO.File]::WriteAllBytes("$env:TEMP\sokuji_tone.wav", $ms.ToArray())

function Peak([string]$path) {
  $b = [System.IO.File]::ReadAllBytes($path); $p = 0
  for ($i=0; $i+1 -lt $b.Length; $i+=2) {
    $v = [BitConverter]::ToInt16($b, $i); $a = [math]::Abs($v); if ($a -gt $p) { $p = $a }
  }
  return $p
}

$noisy = Start-Process powershell -PassThru -ArgumentList @('-NoProfile','-Command',
  "(New-Object System.Media.SoundPlayer '$env:TEMP\sokuji_tone.wav').PlaySync()")
$quiet = Start-Process powershell -PassThru -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 12')
Start-Sleep -Milliseconds 700

foreach ($case in @(@{n='NOISY';p=$noisy.Id}, @{n='QUIET';p=$quiet.Id})) {
  $out = "$env:TEMP\sokuji_$($case.n).pcm"
  $proc = Start-Process $exe -PassThru -NoNewWindow -RedirectStandardOutput $out `
          -RedirectStandardError "$env:TEMP\sokuji_$($case.n).log" -ArgumentList "--target","pid:$($case.p)"
  Start-Sleep -Seconds 3
  Stop-Process -Id $proc.Id -Force
  Start-Sleep -Milliseconds 300
  $len = (Get-Item $out).Length
  Write-Output ("{0}: bytes={1} expected~144000 peak={2}" -f $case.n, $len, (Peak $out))
}

foreach ($x in @($noisy,$quiet)) { Stop-Process -Id $x.Id -Force -ErrorAction SilentlyContinue }
Remove-Item "$env:TEMP\sokuji_tone.wav","$env:TEMP\sokuji_*.pcm","$env:TEMP\sokuji_*.log" -Force -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Run it and check the two acceptance numbers**

Copy it next to the built exe and run it over SSH.

Required outcome — these are the numbers the spike produced, and the feature is not working
if they differ:
- `NOISY: bytes≈144000 peak≈11985` — real audio captured, and 44.1 kHz was resampled to 24 kHz
- `QUIET: bytes≈144000 peak≤2` — **isolation holds**; the tone did not leak in

`bytes≈144000` in *both* rows is the second acceptance criterion: it proves the stream stays
continuous while the target is silent, which is why no gap-filling exists downstream.

- [ ] **Step 3: Verify `--list` and the error paths**

```
sokuji-audio-host.exe --list             -> a JSON array, exit 0
sokuji-audio-host.exe --target pid:999999 -> {"event":"error","code":...} on stderr, non-zero exit
sokuji-audio-host.exe --target garbage    -> {"event":"error","code":"bad_target"}, exit 2
sokuji-audio-host.exe                     -> usage on stderr, exit 2
```

- [ ] **Step 4: Commit**

```bash
git add native/audio-host/win/verify.ps1
git commit -m "test(audio): add Windows capture helper verification script"
```

---

### Task 4: Vendor the binary and resolve its path

**Files:**
- Create: `resources/bin/win32-x64/sokuji-audio-host.exe` (committed binary)
- Create: `electron/audio-host-path.js`
- Test: `electron/audio-host-path.test.js`

**Interfaces:**
- Produces: `resolveAudioHostPath({ platform, resourcesPath, appPath, existsSync }) => string | null`
  — returns `null` on unsupported platforms and when the binary is absent, never throws.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { resolveAudioHostPath } from './audio-host-path.js';

const yes = () => true;
const no = () => false;

describe('resolveAudioHostPath', () => {
  it('resolves the packaged location on win32', () => {
    const p = resolveAudioHostPath({
      platform: 'win32', resourcesPath: 'C:\\app\\resources', appPath: 'C:\\app',
      existsSync: yes,
    });
    expect(p).toContain('resources');
    expect(p).toContain('win32-x64');
    expect(p.endsWith('sokuji-audio-host.exe')).toBe(true);
  });

  it('falls back to the repo tree in development', () => {
    // Packaged path missing, dev path present.
    let calls = 0;
    const existsSync = () => (++calls > 1);
    const p = resolveAudioHostPath({
      platform: 'win32', resourcesPath: '/nope', appPath: '/repo', existsSync,
    });
    expect(p).toContain('resources');
  });

  it('returns null when the binary is nowhere', () => {
    expect(resolveAudioHostPath({
      platform: 'win32', resourcesPath: 'C:\\app\\resources', appPath: 'C:\\app', existsSync: no,
    })).toBeNull();
  });

  it('returns null on linux and darwin', () => {
    for (const platform of ['linux', 'darwin']) {
      expect(resolveAudioHostPath({
        platform, resourcesPath: '/r', appPath: '/a', existsSync: yes,
      })).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/audio-host-path.test.js`
Expected: FAIL — cannot resolve `./audio-host-path.js`.

- [ ] **Step 3: Write the implementation**

```javascript
const path = require('path');
const fsDefault = require('fs');

const REL = path.join('resources', 'bin', 'win32-x64', 'sokuji-audio-host.exe');

/**
 * Locate the per-application capture helper.
 *
 * Packaged builds get it from extraResource (forge.config.js copies the whole
 * `resources` directory into Contents/Resources), development from the repo tree.
 * Returns null rather than throwing so callers can degrade to whole-system capture.
 */
function resolveAudioHostPath({
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  appPath = path.join(__dirname, '..'),
  existsSync = fsDefault.existsSync,
} = {}) {
  if (platform !== 'win32') return null;

  const candidates = [
    resourcesPath ? path.join(resourcesPath, REL) : null,
    path.join(appPath, REL),
  ].filter(Boolean);

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

module.exports = { resolveAudioHostPath, AUDIO_HOST_REL_PATH: REL };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/audio-host-path.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Copy the built binary into the repo**

```bash
scp jiang@192.168.1.13:C:/Users/jiang/audio-host/out/sokuji-audio-host.exe resources/bin/win32-x64/sokuji-audio-host.exe
```

Confirm it is a PE binary and a sane size:

```bash
file resources/bin/win32-x64/sokuji-audio-host.exe
ls -l resources/bin/win32-x64/sokuji-audio-host.exe
```

- [ ] **Step 6: Commit**

```bash
git add resources/bin/win32-x64/sokuji-audio-host.exe electron/audio-host-path.js electron/audio-host-path.test.js
git commit -m "feat(audio): vendor the Windows capture helper and resolve its path"
```

---

### Task 5: Main-process spawn wrapper

**Files:**
- Create: `electron/win-audio-host.js`
- Test: `electron/win-audio-host.test.js`

**Interfaces:**
- Consumes: `resolveAudioHostPath` (Task 4).
- Produces:
  - `async listAppSources(deps) => Array<{deviceId,label}>` where `deviceId` is `app:pid:<n>`
  - `startCapture(deviceId, onPcm, onEvent, deps) => boolean`
  - `stopCapture(deps) => void`

  `deps` is `{ spawn, resolvePath }`, injected for tests. `onPcm(buffer: Buffer)` is called
  for every stdout chunk; `onEvent(obj)` for every parsed stderr JSON line.

  `deviceId` uses the `app:` prefix so it flows through the *same* picker and the same
  `connectSystemAudioSource` contract the Linux plan established; the part after `app:` is
  opaque to the renderer.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { listAppSources, startCapture, stopCapture } from './win-audio-host.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = vi.fn();
  return c;
}

const resolvePath = () => 'C:\\app\\sokuji-audio-host.exe';

describe('listAppSources', () => {
  it('parses the JSON array and prefixes ids with app:', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const p = listAppSources({ spawn, resolvePath });

    child.stdout.emit('data', Buffer.from('[{"id":"pid:42","label":"Zoom","exe":"Zoom.exe"}]'));
    child.emit('close', 0);

    expect(await p).toEqual([{ deviceId: 'app:pid:42', label: 'Zoom' }]);
    expect(spawn.mock.calls[0][1]).toEqual(['--list']);
  });

  it('returns an empty array when the helper is missing', async () => {
    expect(await listAppSources({ spawn: vi.fn(), resolvePath: () => null })).toEqual([]);
  });

  it('returns an empty array on malformed output rather than throwing', async () => {
    const child = fakeChild();
    const p = listAppSources({ spawn: () => child, resolvePath });
    child.stdout.emit('data', Buffer.from('not json'));
    child.emit('close', 0);
    expect(await p).toEqual([]);
  });
});

describe('startCapture', () => {
  it('spawns with the pid stripped of the app: prefix and forwards PCM', () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const onPcm = vi.fn();
    const onEvent = vi.fn();

    expect(startCapture('app:pid:42', onPcm, onEvent, { spawn, resolvePath })).toBe(true);
    expect(spawn.mock.calls[0][1]).toEqual(['--target', 'pid:42']);

    const pcm = Buffer.from([1, 2, 3, 4]);
    child.stdout.emit('data', pcm);
    expect(onPcm).toHaveBeenCalledWith(pcm);
  });

  it('parses stderr JSON lines into events, ignoring partial lines', () => {
    const child = fakeChild();
    const onEvent = vi.fn();
    startCapture('app:pid:42', vi.fn(), onEvent, { spawn: () => child, resolvePath });

    // A chunk boundary must not lose or corrupt an event.
    child.stderr.emit('data', Buffer.from('{"event":"format","sampleRate":240'));
    expect(onEvent).not.toHaveBeenCalled();
    child.stderr.emit('data', Buffer.from('00,"channels":1}\n'));
    expect(onEvent).toHaveBeenCalledWith({ event: 'format', sampleRate: 24000, channels: 1 });
  });

  it('reports the helper exiting as an event', () => {
    const child = fakeChild();
    const onEvent = vi.fn();
    startCapture('app:pid:42', vi.fn(), onEvent, { spawn: () => child, resolvePath });

    child.emit('close', 1);

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'exit', code: 1 }));
  });

  it('returns false when the helper binary is missing', () => {
    expect(startCapture('app:pid:42', vi.fn(), vi.fn(), { spawn: vi.fn(), resolvePath: () => null }))
      .toBe(false);
  });
});

describe('stopCapture', () => {
  it('kills a running helper and is safe to call twice', () => {
    const child = fakeChild();
    startCapture('app:pid:42', vi.fn(), vi.fn(), { spawn: () => child, resolvePath });

    stopCapture();
    expect(child.kill).toHaveBeenCalledTimes(1);
    stopCapture();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/win-audio-host.test.js`
Expected: FAIL — cannot resolve `./win-audio-host.js`.

- [ ] **Step 3: Write the implementation**

```javascript
const { spawn: nodeSpawn } = require('child_process');
const { resolveAudioHostPath } = require('./audio-host-path.js');

let current = null;

/** Split a stream of stderr chunks into whole JSON lines. */
function makeLineParser(onLine) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { onLine(JSON.parse(line)); } catch { /* helper logged something non-JSON */ }
    }
  };
}

async function listAppSources({ spawn = nodeSpawn, resolvePath = resolveAudioHostPath } = {}) {
  const exe = resolvePath();
  if (!exe) return [];

  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(exe, ['--list']); } catch { return resolve([]); }
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        const rows = JSON.parse(out);
        if (!Array.isArray(rows)) return resolve([]);
        resolve(rows
          .filter((r) => r && typeof r.id === 'string')
          .map((r) => ({ deviceId: `app:${r.id}`, label: r.label || r.exe || r.id })));
      } catch {
        resolve([]);
      }
    });
  });
}

function startCapture(deviceId, onPcm, onEvent, { spawn = nodeSpawn, resolvePath = resolveAudioHostPath } = {}) {
  const exe = resolvePath();
  if (!exe) return false;

  stopCapture({ spawn, resolvePath });

  const target = String(deviceId).replace(/^app:/, '');
  let child;
  try { child = spawn(exe, ['--target', target]); } catch { return false; }

  current = child;
  child.stdout.on('data', (d) => onPcm(d));
  child.stderr.on('data', makeLineParser(onEvent));
  child.on('error', (e) => onEvent({ event: 'error', code: 'spawn_failed', message: e.message }));
  child.on('close', (code) => {
    if (current === child) current = null;
    onEvent({ event: 'exit', code });
  });
  return true;
}

function stopCapture() {
  if (!current) return;
  try { current.kill(); } catch { /* already gone */ }
  current = null;
}

module.exports = { listAppSources, startCapture, stopCapture };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/win-audio-host.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/win-audio-host.js electron/win-audio-host.test.js
git commit -m "feat(audio): spawn and parse the Windows capture helper"
```

---

### Task 6: Wire the helper into the Windows platform module and IPC

**Files:**
- Modify: `electron/windows-audio-utils.js:230-262` (the three system-audio stubs)
- Modify: `electron/main.js` (register the PCM forwarding)
- Modify: `electron/ipc-channels.js` (add one invoke channel)
- Test: `electron/windows-audio-utils.appaudio.test.js`

**Interfaces:**
- Consumes: `listAppSources`, `startCapture`, `stopCapture` (Task 5).
- Produces:
  - `listSystemAudioSources()` → whole-system entry first, then `app:` entries
  - `connectSystemAudioSource(id)` → `{ success, capture: 'app'|'system' }`
  - new invoke channel `'start-app-audio-capture'` / `'stop-app-audio-capture'`
  - main→renderer push channel `'app-audio:pcm'` carrying a `Uint8Array`, and
    `'app-audio:event'` carrying the helper's JSON events

  Windows returns `capture: 'app'` rather than the Linux plan's `monitorLabel`, because there
  is no monitor device to resolve — the renderer reads PCM from IPC instead of `getUserMedia`.

- [ ] **Step 1: Write the failing test**

`windows-audio-utils.js` reaches `win-audio-host.js` through a CommonJS `require()`, exactly
like the Linux module in the other plan. Intercepting that with `vi.mock` is unreliable, so
these functions take the same optional trailing `deps` argument and the test injects fakes.
No module mocking.

```javascript
import { describe, it, expect, vi } from 'vitest';
import { listSystemAudioSources, connectSystemAudioSource, disconnectSystemAudioSource }
  from './windows-audio-utils.js';

const host = () => ({
  listAppSources: vi.fn(async () => [{ deviceId: 'app:pid:42', label: 'Zoom' }]),
  startCapture: vi.fn(() => true),
  stopCapture: vi.fn(),
});

describe('listSystemAudioSources (Windows)', () => {
  it('keeps whole-system capture first, then the applications', async () => {
    const s = await listSystemAudioSources({ host: host() });
    expect(s[0].deviceId).toBe('desktop-audio-loopback');
    expect(s.map(x => x.deviceId)).toContain('app:pid:42');
  });

  it('still returns whole-system capture when the helper is unavailable', async () => {
    const h = host();
    h.listAppSources.mockResolvedValue([]);
    expect(await listSystemAudioSources({ host: h }))
      .toEqual([{ deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' }]);
  });
});

describe('connectSystemAudioSource (Windows)', () => {
  it('marks app: ids as application capture', async () => {
    expect(await connectSystemAudioSource('app:pid:42', { host: host() }))
      .toEqual({ success: true, capture: 'app' });
  });

  it('marks the loopback id as system capture and releases any helper', async () => {
    const h = host();
    expect(await connectSystemAudioSource('desktop-audio-loopback', { host: h }))
      .toEqual({ success: true, capture: 'system' });
    expect(h.stopCapture).toHaveBeenCalled();
  });
});

describe('disconnectSystemAudioSource (Windows)', () => {
  it('always stops the helper', async () => {
    const h = host();
    await disconnectSystemAudioSource({ host: h });
    expect(h.stopCapture).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/windows-audio-utils.appaudio.test.js`
Expected: FAIL — `listSystemAudioSources` returns only the single hardcoded entry.

- [ ] **Step 3: Write the implementation**

In `electron/windows-audio-utils.js`, add near the other requires:

```javascript
const audioHost = require('./win-audio-host.js');
```

Replace the three stubs at lines 230-262. The `host` dep defaults to the real module so
`main.js` calls them with one argument (or none) and gets production behaviour:

```javascript
/**
 * Whole-system capture first (unchanged default), then one entry per application
 * the helper can target. An absent or failing helper degrades to just the former.
 */
async function listSystemAudioSources({ host = audioHost } = {}) {
  const system = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };
  return [system, ...(await host.listAppSources())];
}

/**
 * Records which capture path the renderer should take. Nothing is spawned here —
 * the helper starts only when the session starts, via start-app-audio-capture.
 */
async function connectSystemAudioSource(sourceId, { host = audioHost } = {}) {
  if (String(sourceId).startsWith('app:')) return { success: true, capture: 'app' };
  host.stopCapture();
  return { success: true, capture: 'system' };
}

async function disconnectSystemAudioSource({ host = audioHost } = {}) {
  host.stopCapture();
  return { success: true };
}
```

Export `startCapture` and `stopCapture` from the module so `main.js` can reach them, adding
them to the existing `module.exports`.

In `electron/ipc-channels.js`, add to `INVOKE_CHANNELS` beside the other system-audio entries:

```javascript
  'start-app-audio-capture',
  'stop-app-audio-capture',
```

In `electron/main.js`, beside the other system-audio handlers (around line 851):

```javascript
ipcMain.handle('start-app-audio-capture', async (event, deviceId) => {
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported platform' };
  const { startCapture } = require('./windows-audio-utils');
  const wc = event.sender;
  const ok = startCapture(
    deviceId,
    // Buffer is not structured-cloneable as-is across the bridge; a Uint8Array view is.
    (pcm) => { if (!wc.isDestroyed()) wc.send('app-audio:pcm', new Uint8Array(pcm)); },
    (evt) => { if (!wc.isDestroyed()) wc.send('app-audio:event', evt); },
  );
  return ok ? { ok: true } : { ok: false, error: 'capture helper unavailable' };
});

ipcMain.handle('stop-app-audio-capture', async () => {
  if (process.platform !== 'win32') return { ok: true };
  const { stopCapture } = require('./windows-audio-utils');
  stopCapture();
  return { ok: true };
});
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run electron/windows-audio-utils.appaudio.test.js
npx vitest run electron/ipc-channels.test.js
```

Expected: both PASS. The IPC guard must agree that both new channels have handlers.

- [ ] **Step 5: Commit**

```bash
git add electron/windows-audio-utils.js electron/main.js electron/ipc-channels.js electron/windows-audio-utils.appaudio.test.js
git commit -m "feat(audio): expose Windows per-application capture over IPC"
```

---

### Task 7: `AppAudioRecorder` — participant capture from pushed PCM

**Files:**
- Create: `src/lib/modern-audio/AppAudioRecorder.ts`
- Test: `src/lib/modern-audio/AppAudioRecorder.test.ts`

**Interfaces:**
- Consumes: `IParticipantAudioRecorder`, `ParticipantAudioOptions`, `AudioDataCallback`
  (`src/lib/modern-audio/IParticipantAudioRecorder.ts`).
- Produces: `class AppAudioRecorder implements IParticipantAudioRecorder`, constructed as
  `new AppAudioRecorder(24000)`.

**Why this implements the interface directly instead of extending `ParticipantRecorder`:**
`ParticipantRecorder`'s contract is `acquireStream(): Promise<MediaStream>` and its whole
pipeline is MediaStream → AudioContext → worklet → PCM. Here the PCM already exists. Forcing
it through a synthetic MediaStream would add a buffering stage and a pointless conversion
round-trip. The interface is the seam; `ParticipantRecorder` is just the base the two
MediaStream-based recorders happen to share.

**No resampling and no silence insertion.** The helper emits exactly 24 kHz mono s16
(Verified Fact 4) and the stream is continuous even when the app is silent (Verified Fact 5).
The recorder's job is byte-alignment and dispatch, nothing more.

**Known limitation — no participant waveform in this mode.** `getAnalyser()` returns `null`
because there is no `AudioContext` in this path; the PCM arrives over IPC and goes straight to
the client. `ModernBrowserAudioService.getParticipantAnalyser()` already returns
`this.systemAudioRecorder?.getAnalyser() ?? null` and MainPanel is documented to handle
`null`, so the advanced-mode participant waveform simply does not animate while an application
source is selected on Windows. Audio and translation are unaffected. Restoring the waveform
means pushing the PCM through an `AudioWorkletNode` (the repo has
`src/lib/modern-audio/worklets/playback-ring-processor.js`) into an `AnalyserNode` that is not
connected to the destination — deliberately deferred so this plan ships capture first. Confirm
the missing waveform is acceptable during Task 10 Step 4 rather than discovering it in review.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppAudioRecorder } from './AppAudioRecorder';

const invoke = vi.fn();
const listeners: Record<string, (e: unknown, p: unknown) => void> = {};

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ ok: true });
  for (const k of Object.keys(listeners)) delete listeners[k];
  (globalThis as any).window = {
    electron: {
      invoke,
      on: (ch: string, fn: (e: unknown, p: unknown) => void) => { listeners[ch] = fn; },
      removeListener: (ch: string) => { delete listeners[ch]; },
    },
  };
});

const push = (bytes: number[]) => listeners['app-audio:pcm']?.({}, new Uint8Array(bytes));

describe('AppAudioRecorder', () => {
  it('starts the helper for the selected source', async () => {
    const rec = new AppAudioRecorder(24000);
    await rec.begin({ deviceId: 'app:pid:42' });
    expect(invoke).toHaveBeenCalledWith('start-app-audio-capture', 'app:pid:42');
    expect(rec.getStatus()).toBe('paused');
  });

  it('fails to begin when the main process reports no helper', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'capture helper unavailable' });
    const rec = new AppAudioRecorder(24000);
    expect(await rec.begin({ deviceId: 'app:pid:42' })).toBe(false);
  });

  it('delivers pushed PCM as Int16Array to the callback', async () => {
    const rec = new AppAudioRecorder(24000);
    await rec.begin({ deviceId: 'app:pid:42' });
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    // 0x0100 = 256, 0xFF7F = -129 little-endian
    push([0x00, 0x01, 0x7f, 0xff]);

    expect(seen).toHaveLength(1);
    expect(Array.from(seen[0])).toEqual([256, -129]);
    expect(rec.getStatus()).toBe('recording');
  });

  it('carries an odd trailing byte into the next chunk instead of dropping it', async () => {
    const rec = new AppAudioRecorder(24000);
    await rec.begin({ deviceId: 'app:pid:42' });
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    // A chunk boundary that splits a sample must not corrupt the stream.
    push([0x00, 0x01, 0x7f]);
    expect(Array.from(seen[0])).toEqual([256]);
    push([0xff]);
    expect(Array.from(seen[1])).toEqual([-129]);
  });

  it('drops audio while paused and resumes afterwards', async () => {
    const rec = new AppAudioRecorder(24000);
    await rec.begin({ deviceId: 'app:pid:42' });
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    await rec.pause();
    push([0x00, 0x01]);
    expect(seen).toHaveLength(0);

    await rec.record(({ mono }) => seen.push(mono));
    push([0x00, 0x01]);
    expect(seen).toHaveLength(1);
  });

  it('stops the helper and unsubscribes on end', async () => {
    const rec = new AppAudioRecorder(24000);
    await rec.begin({ deviceId: 'app:pid:42' });
    await rec.end();

    expect(invoke).toHaveBeenCalledWith('stop-app-audio-capture');
    expect(listeners['app-audio:pcm']).toBeUndefined();
    expect(rec.getStatus()).toBe('ended');
  });

  it('surfaces a helper exit through the onLost hook', async () => {
    const rec = new AppAudioRecorder(24000);
    const onLost = vi.fn();
    rec.onLost = onLost;
    await rec.begin({ deviceId: 'app:pid:42' });

    listeners['app-audio:event']?.({}, { event: 'exit', code: 1 });

    expect(onLost).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/modern-audio/AppAudioRecorder.test.ts`
Expected: FAIL — cannot resolve `./AppAudioRecorder`.

- [ ] **Step 3: Write the implementation**

```typescript
import {
  IParticipantAudioRecorder,
  ParticipantAudioOptions,
  AudioDataCallback,
} from './IParticipantAudioRecorder';

/**
 * Participant recorder fed by the Windows capture helper.
 *
 * The helper already emits 24 kHz mono signed 16-bit PCM and keeps the stream
 * continuous while the captured application is silent, so this class neither
 * resamples nor inserts silence — it aligns bytes to samples and dispatches.
 */
export class AppAudioRecorder implements IParticipantAudioRecorder {
  private callback: AudioDataCallback | null = null;
  private status: 'ended' | 'paused' | 'recording' = 'ended';
  private pcmListener: ((e: unknown, payload: unknown) => void) | null = null;
  private eventListener: ((e: unknown, payload: unknown) => void) | null = null;
  /** A chunk can split a 16-bit sample; the odd byte waits here for its partner. */
  private leftover: Uint8Array = new Uint8Array(0);

  /** Called when the helper dies, so the caller can fall back to system capture. */
  public onLost: (() => void) | null = null;

  constructor(private readonly sampleRate: number = 24000) {}

  getSampleRate(): number { return this.sampleRate; }
  getStatus(): 'ended' | 'paused' | 'recording' { return this.status; }

  /** The waveform is driven from PCM directly; there is no AudioContext here. */
  getAnalyser(): AnalyserNode | null { return null; }

  async begin(options?: ParticipantAudioOptions): Promise<boolean> {
    const deviceId = options?.deviceId;
    if (!deviceId) {
      console.error('[Sokuji] [AppAudioRecorder] A deviceId is required');
      return false;
    }

    this.pcmListener = (_e, payload) => this.onPcm(payload as Uint8Array);
    this.eventListener = (_e, payload) => this.onHelperEvent(payload as { event?: string });
    window.electron.on('app-audio:pcm', this.pcmListener);
    window.electron.on('app-audio:event', this.eventListener);

    const result = await window.electron.invoke('start-app-audio-capture', deviceId);
    if (!result?.ok) {
      console.error('[Sokuji] [AppAudioRecorder] Failed to start capture:', result?.error);
      await this.end();
      return false;
    }

    this.status = 'paused';
    return true;
  }

  async record(callback: AudioDataCallback): Promise<boolean> {
    this.callback = callback;
    this.status = 'recording';
    return true;
  }

  async pause(): Promise<boolean> {
    this.status = 'paused';
    return true;
  }

  async end(): Promise<void> {
    if (this.pcmListener) {
      window.electron.removeListener('app-audio:pcm', this.pcmListener);
      this.pcmListener = null;
    }
    if (this.eventListener) {
      window.electron.removeListener('app-audio:event', this.eventListener);
      this.eventListener = null;
    }
    try {
      await window.electron.invoke('stop-app-audio-capture');
    } catch (e) {
      console.warn('[Sokuji] [AppAudioRecorder] Failed to stop capture:', e);
    }
    this.callback = null;
    this.leftover = new Uint8Array(0);
    this.status = 'ended';
  }

  private onPcm(payload: Uint8Array): void {
    if (this.status !== 'recording' || !this.callback) return;

    let bytes: Uint8Array = payload;
    if (this.leftover.length > 0) {
      const merged = new Uint8Array(this.leftover.length + payload.length);
      merged.set(this.leftover, 0);
      merged.set(payload, this.leftover.length);
      bytes = merged;
      this.leftover = new Uint8Array(0);
    }

    const usable = bytes.length - (bytes.length % 2);
    if (usable < bytes.length) {
      this.leftover = bytes.slice(usable);
    }
    if (usable === 0) return;

    // Copy into a fresh buffer: the view may be unaligned, and consumers
    // transfer (detach) the ArrayBuffer when posting to a worker.
    const aligned = new Uint8Array(usable);
    aligned.set(bytes.subarray(0, usable));
    const mono = new Int16Array(aligned.buffer);

    this.callback({ mono, raw: mono });
  }

  private onHelperEvent(payload: { event?: string }): void {
    if (payload?.event === 'exit' || payload?.event === 'error') {
      console.warn('[Sokuji] [AppAudioRecorder] Capture helper reported:', payload);
      this.onLost?.();
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/modern-audio/AppAudioRecorder.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/modern-audio/AppAudioRecorder.ts src/lib/modern-audio/AppAudioRecorder.test.ts
git commit -m "feat(audio): add AppAudioRecorder for pushed-PCM participant capture"
```

---

### Task 8: Route the audio service to `AppAudioRecorder` on Windows

**Prerequisite:** Tasks 6–9 of the Linux plan (the shared picker/store/routing seam).

**Files:**
- Modify: `src/lib/modern-audio/ModernBrowserAudioService.ts` — `connectSystemAudioSource`
  and `startSystemAudioRecording`
- Test: `src/lib/modern-audio/ModernBrowserAudioService.test.ts` (append)

**Interfaces:**
- Consumes: `AppAudioRecorder` (Task 7); the `{ success, capture }` result from Task 6.
- Produces: a private field `currentCaptureMode: 'system' | 'app'`.
  `startSystemAudioRecording` picks `AppAudioRecorder` when it is `'app'`,
  `DeviceCaptureRecorder` when a monitor deviceId was resolved (Linux), and
  `LoopbackRecorder` otherwise.

- [ ] **Step 1: Write the failing test**

```typescript
describe('windows application capture routing', () => {
  function arrange(invokeResult: any) {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(invokeResult),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    return new ModernBrowserAudioService();
  }

  afterEach(() => vi.restoreAllMocks());

  it('records app capture mode when the main process reports it', async () => {
    const svc = arrange({ success: true, capture: 'app' });
    await svc.connectSystemAudioSource('app:pid:42');
    expect(svc['currentCaptureMode']).toBe('app');
  });

  it('stays in system mode for whole-system capture', async () => {
    const svc = arrange({ success: true, capture: 'system' });
    await svc.connectSystemAudioSource('desktop-audio-loopback');
    expect(svc['currentCaptureMode']).toBe('system');
  });

  it('resets to system mode on disconnect', async () => {
    const svc = arrange({ success: true, capture: 'app' });
    await svc.connectSystemAudioSource('app:pid:42');
    await svc.disconnectSystemAudioSource();
    expect(svc['currentCaptureMode']).toBe('system');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/modern-audio/ModernBrowserAudioService.test.ts`
Expected: FAIL — `currentCaptureMode` is undefined.

- [ ] **Step 3: Write the implementation**

Add the import:

```typescript
import { AppAudioRecorder } from './AppAudioRecorder';
```

Add the field beside `currentMonitorDeviceId`:

```typescript
  // 'app' means a helper process is pushing PCM over IPC (Windows); 'system'
  // means whole-system loopback or a Linux monitor device.
  private currentCaptureMode: 'system' | 'app' = 'system';
```

In `connectSystemAudioSource`, after the existing `monitorLabel` handling:

```typescript
      this.currentCaptureMode = result?.capture === 'app' ? 'app' : 'system';
```

In `disconnectSystemAudioSource` and in `connectSystemAudioSource`'s `catch`, add:

```typescript
    this.currentCaptureMode = 'system';
```

In `startSystemAudioRecording`, put the app branch first:

```typescript
    if (this.currentCaptureMode === 'app') {
      await this.startAppAudioRecording(this.currentSystemAudioSinkId!, callback);
      return;
    }
    if (this.currentMonitorDeviceId) {
      await this.startDeviceCaptureRecording(this.currentMonitorDeviceId, callback);
      return;
    }
    await this.startLoopbackRecording(callback);
```

Add the method beside `startDeviceCaptureRecording`:

```typescript
  /**
   * Record participant audio pushed from the Windows capture helper.
   *
   * A helper that dies mid-session must not silently kill participant audio, so
   * the recorder's onLost hook restarts capture as whole-system loopback.
   */
  private async startAppAudioRecording(
    deviceId: string,
    callback: AudioRecordingCallback
  ): Promise<void> {
    try {
      console.info(`[Sokuji] [ModernBrowserAudio] Starting application capture for ${deviceId}`);
      const recorder = new AppAudioRecorder(24000);
      this.systemAudioRecorder = recorder;
      this.systemAudioCallback = callback;

      recorder.onLost = () => {
        console.warn('[Sokuji] [ModernBrowserAudio] Capture helper lost; falling back to system audio');
        this.currentCaptureMode = 'system';
        this.startSystemAudioRecording(callback).catch((e) =>
          console.error('[Sokuji] [ModernBrowserAudio] Fallback to system audio failed:', e));
      };

      const success = await recorder.begin({ deviceId });
      if (!success) {
        throw new Error('Failed to begin application audio capture');
      }

      await recorder.record((data: { mono: Int16Array; raw: Int16Array }) => {
        if (this.systemAudioCallback) {
          this.systemAudioCallback(data);
        }
      });

      this.systemAudioRecordingActive = true;
      console.info('[Sokuji] [ModernBrowserAudio] Application capture started');
    } catch (error) {
      console.error('[Sokuji] [ModernBrowserAudio] Failed to start application capture:', error);
      await this.stopSystemAudioRecording();
      throw error;
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/modern-audio/ModernBrowserAudioService.test.ts`
Expected: PASS, including the pre-existing tests and the Linux plan's routing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modern-audio/ModernBrowserAudioService.ts src/lib/modern-audio/ModernBrowserAudioService.test.ts
git commit -m "feat(audio): route Windows participant capture to the helper"
```

---

### Task 9: Full suite green

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS with no new failures against the pre-existing baseline.

- [ ] **Step 2: Fix any regression**

The likeliest breakage is `electron/ipc-channels.test.js` if a channel name drifted between
`ipc-channels.js` and `main.js`. Fix, do not skip.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -am "test: fix regressions from Windows application capture"
```

---

### Task 10: End-to-end verification in the real app

**Files:** none — manual verification on 192.168.1.13.

Everything up to here was tested with fakes or against the helper in isolation. This proves
the whole chain.

- [ ] **Step 1: Get the branch onto the Windows box and install**

```bash
ssh jiang@192.168.1.13 'cd C:\Users\jiang\sokuji && git fetch && git checkout <branch> && npm install'
```

- [ ] **Step 2: Launch Sokuji in the interactive session**

The Electron app needs a desktop, so this step **cannot** run over SSH even though capture
can (Verified Fact 3). Launch it from the console session — jiangzhuo is logged in there.

- [ ] **Step 3: Confirm the picker lists applications**

Open audio settings. The participant source list must show "System Audio (All Applications)"
plus one row per application. Start a browser playing speech and a second application playing
music, then select the browser.

- [ ] **Step 4: Confirm isolation end-to-end**

Start a session. The participant transcript must follow the browser's speech and must **not**
pick up the music. This is the acceptance criterion for issue #335.

- [ ] **Step 5: Confirm the fallback**

Close the captured application mid-session. Sokuji must log the helper exit and continue with
whole-system audio rather than dropping participant audio entirely.

- [ ] **Step 6: Confirm no orphan processes**

End the session and quit Sokuji, then over SSH:

```powershell
Get-Process sokuji-audio-host -ErrorAction SilentlyContinue
```

Expected: nothing. A surviving helper holds a capture handle and is a release blocker.

- [ ] **Step 7: Commit any fixes found**

```bash
git commit -am "fix(audio): <what the end-to-end run exposed>"
```

---

## Out of Scope

1. **macOS per-application capture** — Core Audio process taps, macOS 14.2+. The verification
   host `192.168.1.15` runs macOS 15.7.3 with Swift 6.2.3 and full Xcode, so the same CLI
   contract this plan defines (`--list` / `--target`, PCM on stdout, JSON on stderr) can be
   implemented there. Its extra cost is the "System Audio Recording Only" TCC permission,
   which cannot be granted over SSH, and the packaging entitlements.
2. **Signing the helper binary.** It ships unsigned inside the app bundle initially; whether
   it needs its own Authenticode signature depends on the installer story and is a separate
   decision.
3. **Windows 10.** The API's documented floor is build 20348, which consumer Windows 10 never
   reaches. The picker degrades to whole-system capture there because `--list` returns an
   empty array, which is the correct behaviour without extra code.
