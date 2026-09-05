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
[{"id":"pid:22972","label":"守望先锋","exe":"Overwatch.exe","active":true,"windows":["守望先锋"]}]
```

`id` names the process to tap, and it must be one that lives as long as the application does —
not whichever child happens to hold the audio session (see the Windows notes). `label` is the
**application** name, never a window title: a source is a process tree, one tree owns as many
windows as the user opened, and no platform here can capture them separately. `windows` carries
those titles so the UI can show them on hover; it may be empty, and macOS always leaves it so.

Helpers emit the bare application name and must not disambiguate two copies of it themselves:
`electron/audio-host.js` appends the pid from `id` to every row (`Google Chrome (24088)`), so a
second Chrome profile — a second, separately capturable Chrome — is always distinguishable
without each helper inventing its own rule.
`active` is true when the application currently holds a playing audio session. Labels are
UTF-8 and routinely non-ASCII. An empty array is a valid answer and makes the UI fall back to
whole-system capture; it is not an error.

```
sokuji-audio-host --target pid:22972
sokuji-audio-host --target system
sokuji-audio-host --target system --exclude-pids 4120,4133
```

`--exclude-pids` (macOS only, optional) names processes that must never count as
"rendering" for the `silent_no_permission` check, together with their
descendants, resolved against the live parent chain at every poll. Sokuji passes
its own process tree, because its audio service keeps an output stream open for
the whole session even while it plays nothing, and on a `system` tap that alone
used to satisfy the check (#492). The live walk is what keeps the exclusion
correct when Chromium restarts its audio-service utility process mid-capture:
the replacement is a new pid, but still a child of the app. A token that is not
a positive pid is `bad_exclude_pids`, exit 2.

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
{"event":"error","code":"bad_target|no_such_audio_process|activation_failed|initialize_failed|target_gone"}
{"event":"warning","code":"silent_no_permission|retarget_failed"}
```

An `error` tells Sokuji its capture is gone and it tears the recorder down; a
`warning` does not. Anything degraded-but-still-capturing must therefore be a
warning.

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
tone did not leak in. It also builds a two-level same-image process tree (cmd → powershell →
powershell, a browser's shape) and asserts `--list` reports the root, hides the audio-holding
child, and that a tap on the root survives that child's death. Needs no interactive desktop.
Expected output ends with `VERIFY OK`.

### Things learned the hard way

- **The audio session's pid is not the application's pid.** Chrome renders through a
  `--type=utility` audio service child, and `IAudioSessionControl2::GetProcessId` returns
  *that*. Chrome recycles it around playback: measured Aug 2026, killing it made the helper
  exit `target_gone`, and the replacement came back under a different pid. Sokuji answers a
  dead helper by falling back to whole-system capture, so the symptom was one selected
  application quietly turning into every application, with the picker still naming the app.
  `--list` therefore reports the topmost ancestor running the *same executable*, which
  `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` covers along with every child it later
  spawns. The same-image bound is load-bearing: walk past it and a window-less player launched
  from Explorer would root at the desktop shell, and its tree is nearly everything the user
  has open.
- **A window title is not an application name.** Two Chrome windows are one process tree and
  therefore one capturable source — Windows offers no way to split them — so labelling the row
  with the first window title found promised a granularity that does not exist. The label is
  the executable's `FileDescription` ("Google Chrome", the name Task Manager shows), and the
  window titles are listed separately in `windows`.
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

### Verify

```
mac/verify.sh [binary]
```

Captures a process that only starts playing after the session does, captures one
whose audio child is replaced mid-session, and captures a silent process while
another one plays. Expected output ends with `VERIFY OK`; it fails five
assertions on the pre-#393 binary. The audio-content assertions need the
"System Audio Recording Only" grant, which TCC attributes to the terminal running
the script — without it the script says so and keeps only the structural checks.

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
- **A per-application tap must cover the process tree.** Multi-process apps do
  not render audio from the process the user picked - Chrome plays through a
  "Google Chrome Helper" child - and a tap on the parent alone never fires, so
  the helper produces no data at all rather than silence. Windows gets this for
  free via PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE and Linux links
  every one of the app's streams; macOS has to expand the tree itself. The same
  applies to `IsRunningOutput`: asked of the parent it is always false, so any
  browser reads as idle.
- **That tree is a snapshot, and it goes stale on its own.** An audio process
  object is destroyed when its process stops rendering and a *new* object is
  created for the replacement. Measured Aug 2026 on 15.7.3: killing Chrome's
  `audio.mojom.AudioService` child removed object 199 from Chrome's tree and the
  respawned service arrived as object 202 under a new pid. A tap resolved once at
  capture start then covers only dead objects — and the HAL prunes those, leaving
  the tap with an empty process list. The symptom is the nastiest one available:
  correctly-clocked buffers of pure zeros, forever, with the session looking
  perfectly healthy. This is the macOS half of the Windows "audio session's pid is
  not the application's pid" defect above; Windows failed loudly by exiting, macOS
  failed silently.
- **A live tap can be re-pointed in place.** Writing `kAudioTapPropertyDescription`
  on a running tap with a new process list returns `noErr` and the HAL re-reads it:
  measured, audio from the newly named processes resumes within one 0.25 s poll,
  and the aggregate device keeps its IOProc, its clock and its sample rate — no
  rebuild, no gap in the frame count. Rebuilding the tap and aggregate device was
  the fallback plan and turned out to be unnecessary.
- **An empty mixdown list is not a global tap** — the two initialisers set
  different flags and do not collapse into each other. Measured: a
  `monoMixdownOfProcesses: []` tap reads peak 0.0000 while another process is
  audibly playing, where a global tap on the same audio reads 11994. So the helper
  can safely create the tap before its target owns any audio object, which is what
  lets an idle application be picked at all. **But** such a tap delivers no buffers
  whatsoever — not even silent ones, unlike the Windows path — so the writer thread
  synthesises silence against the wall clock to keep the stream from stalling.
- **`IsRunningOutput` leads the first audible sample.** Core Audio marks a process
  as running output a poll or two before the tap hands over anything non-zero, so
  a naive reading fires `silent_no_permission` at the exact moment playback starts
  — the one moment the permission is provably fine. The warning requires the
  contradiction to hold for two seconds.
- **`IsRunningOutput` is about streams, not content.** A process whose output
  stream is open but carries digital silence is "running output" — a meeting app
  between utterances, a browser tab with a paused player, and Sokuji itself: a
  running `AudioContext` keeps Chromium's audio-service stream open (measured on
  Electron 40: ~30 s after the last sound before Chromium suspends it, and a
  fresh context is created at every session start). So the contradiction is
  weaker than it looks: on a `system` tap the app must pass `--exclude-pids`
  with its own process tree, and even then a silent target with an open stream
  still fires the warning. The app therefore treats the warning as a hint, not
  a verdict (#492).
- **Whole-system capture uses a global tap, not getDisplayMedia.** Screen
  Recording is a second, heavier permission, and a `stereoGlobalTapButExcludeProcesses: []`
  tap does the same job under the audio-capture grant the per-application path
  already needs. That tap is stereo where the per-process one is a mono mixdown,
  so the helper folds it down and the output stays 24 kHz mono either way.
- **Window titles are not worth their price.** `kCGWindowName` is gated behind Screen
  Recording (measured: 23 windows, all titles nil without it), whereas the localized
  application name is free. macOS therefore labels sources by application name only, unlike
  Linux and Windows which can read window titles cheaply.

## The binaries are not committed

`resources/bin/**` is gitignored. Build the helper for your platform with:

```sh
npm run build:audio-host
```

CI runs the same script on each platform runner before packaging, and fails the
build if the binary is missing - shipping without it produces an app that
silently falls back to whole-system capture, which is invisible until someone
tries to pick an application.

Nothing breaks without it: `resolveAudioHostPath()` returns null, the source
list comes back empty, and the app captures the whole system as it always did.
