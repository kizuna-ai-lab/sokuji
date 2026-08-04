# sokuji-audio-host

Per-application audio capture helpers for Sokuji (issue
[#335](https://github.com/kizuna-ai-lab/sokuji/issues/335)).

Sokuji normally captures **all** system audio as participant audio, so a game or a music
player bleeds into the translation. These helpers capture exactly one application instead.

The helper is a short-lived CLI filter, not a daemon: argv in, PCM on stdout, JSON on stderr.
There is no port, no handshake and no control protocol — the main process spawns it and kills
it. That is deliberate; a socket would be reachable by every other process on the machine and
would effectively lend Sokuji's capture permission to anything that connects.

## Contract

Every platform implementation must honour the same command line.

```
sokuji-audio-host --list
```

Writes one JSON array to stdout and exits 0:

```json
[{"id":"pid:22972","label":"守望先锋","exe":"Overwatch.exe","active":true}]
```

`active` is true when the application currently holds a playing audio session. Labels are
UTF-8 and routinely non-ASCII. An empty array is a valid answer and makes the UI fall back to
whole-system capture; it is not an error.

```
sokuji-audio-host --target pid:22972
sokuji-audio-host --target system
```

`system` captures everything the machine plays. Windows and Linux serve that
through the renderer instead (getDisplayMedia / PipeWire), so only macOS
implements it here - and doing so is what lets macOS ask for a single
permission.

Writes **raw PCM to stdout until killed**, fixed at **24000 Hz, 1 channel, signed 16-bit
little-endian** — exactly what Sokuji's pipeline consumes, so nothing downstream resamples.
Before the first PCM byte it writes one line to stderr:

```json
{"event":"format","sampleRate":24000,"channels":1,"encoding":"s16le"}
```

and on failure:

```json
{"event":"error","code":"bad_target|activation_failed|initialize_failed|target_gone"}
```

Exit codes: `0` clean, `1` runtime failure, `2` bad usage.

**stdout carries only PCM.** Anything else printed there corrupts the audio stream.

## Windows (`win/`)

Uses WASAPI process loopback: `ActivateAudioInterfaceAsync` against the pseudo-device
`VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` with
`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, in
`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` mode so browsers and Electron apps —
which render audio from a child process — are captured too.

### Build

```
win\build.bat
```

One `cl` invocation, output in `win\out\sokuji-audio-host.exe`, which the script then copies
over `resources\bin\win32-x64\sokuji-audio-host.exe`. That committed copy is what the app
actually loads, so the copy is part of the build rather than a step to remember: rebuilding
without it leaves the app running the stale binary, which looks exactly like the fix not
working.

Requires Visual Studio Build Tools with the C++ workload and a Windows SDK. **No CMake, no
NuGet, no WIL, no Media Foundation** — unlike the Microsoft ApplicationLoopback sample this is
modelled on, which pulls in all of the above to do the same job.

### Verify

```
powershell -ExecutionPolicy Bypass -File win\verify.ps1
```

Plays a 440 Hz tone in one process, captures a *different* silent process, and asserts the
tone did not leak in. Needs no interactive desktop. Expected output ends with `VERIFY OK`.

### Things learned the hard way

- **Requirements.** The API's documented floor is Windows 10 build 20348, i.e. Windows 11 in
  practice; the header ships in SDK 10.0.19041.0 regardless. On older Windows `--list` simply
  returns `[]` and the UI degrades to whole-system capture.
- **`IAgileObject` is mandatory.** The activation completion handler must answer
  `QueryInterface` for it, or the callback cannot marshal and activation hangs until timeout.
- **The caller picks the format.** `Initialize` with `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`
  accepts a hand-built 24 kHz mono `WAVEFORMATEX` and WASAPI converts. Do not call
  `GetMixFormat` and resample afterwards.
- **The stream does not stall on silence.** Process loopback delivers a continuous,
  correctly-clocked stream even when the target renders nothing (measured: 144000 of 144000
  expected bytes over 3 s). The widely-cited "loopback stops when nothing plays" reports
  describe *device* loopback. Nothing downstream needs to fill gaps.
- **Capture is not session-bound, but enumeration is.** Capture works from Windows session 0;
  `--list` only sees the session it runs in. That is correct — Sokuji runs in the user's
  session — but it means `--list` cannot be tested over SSH. Use a scheduled task with
  `/ru <user> /it` to observe it from the interactive desktop.
- **`_setmode(_fileno(stdout), _O_BINARY)` is required**, or Windows turns every `0x0A` byte
  in the PCM into `0x0D 0x0A` and silently corrupts the audio.
- **Build with `/utf-8`.** Without it MSVC decodes the source with the machine's ANSI code
  page (932 on the Japanese-locale test box) and warns C4819.

## macOS (`mac/`)

Uses Core Audio process taps: `CATapDescription(monoMixdownOfProcesses:)` +
`AudioHardwareCreateProcessTap`, wrapped in a private aggregate device whose IOProc
delivers the audio. Requires macOS 14.2 or later.

### Build

```
mac/build.sh
```

`swiftc` plus an ad-hoc `codesign`, output in `mac/out/`, then copied to
`resources/bin/darwin-arm64` or `darwin-x64` depending on the build machine's architecture.
As on Windows the copy is part of the build, not a step to remember.

### Things learned the hard way

- **TCC denies by silence, not by error.** Without the "System Audio Recording Only" grant
  the tap is created successfully, the aggregate device appears, the IOProc fires on schedule
  and every buffer is the right size — and every sample is zero. Measured both ways: the same
  binary returns real audio (peak 0.20 over 2.4 M frames) once granted. This is why the helper
  emits `{"event":"warning","code":"silent_no_permission"}` after three seconds of unbroken
  silence: the app cannot otherwise tell a missing permission from a quiet application.
- **The grant follows the *responsible* process.** A bare CLI run from a shell can never
  obtain it — there is no app identity to attach it to. The helper must be spawned by
  Sokuji.app, and the permission is granted to Sokuji.app.
- **An app only appears in the System Settings list after it first requests access.** Sokuji
  will not be listed under "System Audio Recording Only" until it has attempted a tap once.
- **The tap's format is not negotiable** the way WASAPI's is. It hands over 48 kHz float32
  (mono, because of the mono mixdown); this helper decimates to 24 kHz and converts to s16
  itself.
- **Enumeration needs filtering.** `kAudioHardwarePropertyProcessObjectList` returns ~30
  objects, mostly daemons (`CoreSpeech`, `loginwindow`, `universalaccessd`,
  `systemsoundserverd`). Restricting to `NSRunningApplication` with a `.regular` activation
  policy — "has a Dock icon" — cut that to the 3 real applications.
- **Whole-system capture uses a global tap, not getDisplayMedia.** Screen
  Recording is a second, heavier permission, and a `stereoGlobalTapButExcludeProcesses: []`
  tap does the same job under the audio-capture grant the per-application path
  already needs. That tap is stereo where the per-process one is a mono mixdown,
  so the helper folds it down and the output stays 24 kHz mono either way.
- **Window titles are not worth their price.** `kCGWindowName` is gated behind Screen
  Recording (measured: 23 windows, all titles nil without it), whereas the localized
  application name is free. macOS therefore labels sources by application name only, unlike
  Linux and Windows which can read window titles cheaply.
