# Sokuji Audio Stack — Current-State Map

Research note for the client-contract Stage 1 plans 1c-2 (playback) and 1c-3 (capture), taken
on branch `worktree-client-contract-refactor` at `f6ece6df` (2026-09-24). Paths are relative to the
repository root; line numbers are as of that commit. `ModernBrowserAudioService` lives at
`src/lib/modern-audio/ModernBrowserAudioService.ts` (1611 lines), not under `src/services/`.

---

## 1. Microphone capture

### Where it lives
- `src/lib/modern-audio/ModernBrowserAudioService.ts` — orchestrator (`startRecording`,
  `switchRecordingDevice`, `dispatchMicAudio`).
- `src/lib/modern-audio/ModernAudioRecorder.ts` (991 lines) — the mic recorder, extends
  `BaseAudioRecorder`.
- `src/lib/modern-audio/BaseAudioRecorder.ts` (339 lines) — shared AudioWorklet/ScriptProcessor
  plumbing used by both the mic recorder and every participant recorder.

### getUserMedia constraints
`ModernAudioRecorder.getAudioConstraints(deviceId?)` (`ModernAudioRecorder.ts:115-126`):
```ts
const baseConstraints: MediaTrackConstraints = {
  deviceId: deviceId ? { exact: deviceId } : undefined,
  sampleRate: this.internalSampleRate,  // 48000
  channelCount: 1,
};
```
merged with a **performance-mode profile** from `AUDIO_CONSTRAINT_PROFILES` in
`src/lib/config/performance.js:40-54` (default `HIGH_QUALITY`):
```js
HIGH_QUALITY: {
  echoCancellation: true, echoCancellationType: 'system',
  noiseSuppression: true, autoGainControl: true,
  suppressLocalAudioPlayback: true,
  googEchoCancellation: true, googNoiseSuppression: true, googAutoGainControl: true,
  googHighpassFilter: true, googTypingNoiseDetection: true, googAudioMirroring: false,
}
```
`PERFORMANCE` and `MINIMAL` profiles exist too (`PERFORMANCE` turns off `noiseSuppression`/
`googNoiseSuppression`/`googHighpassFilter`/`googTypingNoiseDetection`); selected via
`performanceMode` ctor option, default `'high_quality'` (`ModernAudioRecorder.ts:94-101`).
`echoCancellationType: 'system'` requests OS/system-level AEC on platforms that support it.

Participant/system-audio recorders (`ParticipantRecorder.getAudioConstraints`,
`ParticipantRecorder.ts:19-27`) explicitly **disable** all processing:
```ts
{ sampleRate: this.sampleRate, channelCount: 1,
  echoCancellation: false, noiseSuppression: false, autoGainControl: false }
```
(participant audio is "already processed" — applying AEC/AGC again would degrade it).

`VoiceCreateModal.tsx:253-259` also captures RAW (all three off) for voice-cloning reference
clips, on purpose (the cloning model should hear exactly what the mic picked up).

A **second, independent** getUserMedia call exists for WebRTC-transport providers (Palabra,
GPT-Live-1): `src/lib/modern-audio/WebRTCAudioBridge.ts:46-69`, default
`{ sampleRate: 24000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }`
— this path talks to `navigator.mediaDevices.getUserMedia` directly and is **not** unified with
`ModernAudioRecorder`. Anyone re-planning capture needs to account for this second path too.

### Sample rate / chunking / resampling
- `ModernAudioRecorder` opens the `AudioContext` at **48 kHz** (`internalSampleRate = 48000`,
  set in the constructor, `ModernAudioRecorder.ts:96`) — chosen for RNNoise compatibility.
- The client-facing `sampleRate` (constructor option, default `24000`) is what leaves the
  recorder. `ModernBrowserAudioService`'s ctor passes `{ sampleRate: 24000, enablePassthrough:
  true }` (`ModernBrowserAudioService.ts:83-86`).
- Downsampling 48 kHz → 24 kHz happens in `ModernAudioRecorder.downsample48to24()`
  (`ModernAudioRecorder.ts:916-971`): fast path for the exact 2:1 ratio is adjacent-sample
  averaging (`(input[i*2] + input[i*2+1]) >> 1`); a generic linear-interpolation path exists for
  other target rates; if `targetSampleRate === 48000` it's a straight copy.
- Output format: **Int16Array**, mono. `_processAudioData`/worklet handler emits it as
  `{ mono: Int16Array, raw: Int16Array }` (`BaseAudioRecorder.ts:250-261`); `ModernAudioRecorder`
  wraps that into `{ mono, raw, isRecording, isPassthrough, passthroughVolume }`
  (`ModernAudioRecorder.ts:392-399`, interface `AudioDataWithMeta` at `ModernAudioRecorder.ts:21-27`).
- Chunk size at the worklet boundary is driven by the AudioWorklet's own render quantum
  (128 frames per callback by spec) accumulated inside `audio-recorder-worklet-processor.js`
  (not read in full during this pass — file at `src/services/worklets/audio-recorder-worklet-processor.js`);
  `record(chunkProcessor, chunkSize = 100)` (`ModernAudioRecorder.ts:384`) also passes `chunkSize`
  (ms) to `MediaRecorder.start(chunkSize)`, but that MediaRecorder's own encoded output is now
  discarded (see below) — it does not gate the PCM chunk size delivered to `chunkProcessor`.

### AudioWorklet vs ScriptProcessor fallback
- `BaseAudioRecorder.setupRealtimeAudioProcessing()` (`BaseAudioRecorder.ts:114-187`): tries
  `AudioWorkletNode` first (`isAudioWorkletSupported()`, `BaseAudioRecorder.ts:91-95`); on any
  failure falls back to `setupScriptProcessorFallback()` (`BaseAudioRecorder.ts:192-245`), which
  uses `audioContext.createScriptProcessor(bufferSize, 1, 1)` with
  `bufferSize = PERFORMANCE_CONFIG.SCRIPT_PROCESSOR_BUFFER_SIZE` and manually converts Float32 →
  Int16 in `onaudioprocess`.
- `ModernAudioRecorder` has its **own** parallel implementation,
  `setupRealtimeAudioProcessingWithWarmup()` (`ModernAudioRecorder.ts:301-379`), which duplicates
  the AudioWorklet path (adds warmup, noise suppression, downsampling) but calls the **same**
  `setupScriptProcessorFallback()` from the base class on failure (line 373/377) — i.e. the
  ScriptProcessor fallback path does **not** get 48→24 kHz downsampling or noise suppression,
  only the AudioWorklet path does. This is a real asymmetry worth flagging for a redesign.

### Worklet file paths (Electron vs extension)
`BaseAudioRecorder.getAudioWorkletProcessorUrl()` (`BaseAudioRecorder.ts:79-86`):
```ts
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  return chrome.runtime.getURL('worklets/audio-recorder-worklet-processor.js');
}
return new URL('../../services/worklets/audio-recorder-worklet-processor.js', import.meta.url).href;
```
Same pattern in `ModernAudioPlayer.connect()` for `worklets/playback-ring-processor.js`
(`ModernAudioPlayer.js:193-197`) and in `WebRTCAudioBridge.getPCMWorkletProcessorSrc()`
(`WebRTCAudioBridge.ts:20-26`, for `worklets/pcm-audio-worklet-processor.js`).

Source locations: `src/services/worklets/audio-recorder-worklet-processor.js`,
`src/services/worklets/pcm-audio-worklet-processor.js`,
`src/lib/modern-audio/worklets/playback-ring-processor.js`. In Electron/web these are loaded via
Vite's `?url`/`import.meta.url` resolution straight from the built app bundle. In the extension
they are copied to `worklets/` at build time by `viteStaticCopy`
(`extension/vite.config.ts:60-85`) and served via `chrome.runtime.getURL`, which requires the
`web_accessible_resources` entry `"worklets/*"` in `extension/manifest.json` (present, matched
against `<all_urls>`, alongside `"wasm/*"` for RNNoise/GTCRN WASM and `"workers/*"`).

RNNoise's own worklet (`rnnoiseWorklet.js`) and WASM binaries are loaded via Vite `?url` imports
(`ModernAudioRecorder.ts:6-8`) and `loadRnnoise()` from `@sapphi-red/web-noise-suppressor`
(`ModernAudioRecorder.ts:658-667`); GTCRN ("enhanced" noise suppression) runs in a separate
Worker (`new URL('./gtcrn/gtcrn-worker.ts', import.meta.url)`, `ModernAudioRecorder.ts:786-789`)
that itself loads an ONNX Runtime Web module + `gtcrn_simple.onnx` — this is known to fail to
load under `vite dev` (comment at `ModernAudioRecorder.ts:804-813`) and falls back to RNNoise
("standard") automatically, tracked via `gtcrnUnavailable` flag.

### switchRecordingDevice
`ModernBrowserAudioService.switchRecordingDevice(deviceId)` (`ModernBrowserAudioService.ts:843-872`):
saves `wasRecording`/`recordingCallback`, ends the current recorder session if not already ended,
calls `recorder.begin(deviceId)`, updates `currentRecordingDeviceId`, and if it was recording,
re-registers `record((data) => this.dispatchMicAudio(data))` and calls
`updateEchoMonitorLifecycle()`. Comment at line 864-868 notes this exists so passthrough + echo
probe stay wired to the new device (a prior bespoke callback here used to drop the echo probe).
No-ops if `deviceId` is unchanged (line 844-847).

### Muted mic handling
Muting is **not** a recorder-level concept — `isMicMuted` lives only in `src/stores/audioStore.ts`
(field `isMicMuted`, actions `setMicMuted`/`useSetMicMuted`) and is consumed by the UI/session-start
gating layer, not by `ModernAudioRecorder`/`ModernBrowserAudioService` (grep across
`ModernBrowserAudioService.ts` and the recorder classes found no references to mute at all — mute
must be enforced above this layer, e.g. by simply not calling `startRecording`, or by the client
ignoring mic input while muted; this pass did not find where "session running but muted" is wired
for OpenAI/Gemini/etc. clients — worth confirming before building on it). `audioStore.ts:530-541`:
when no real (non-virtual/non-loopback) input device is available, the store **forces**
`isMicMuted: true` and clears `selectedInputDevice`, with the comment "mute state does not block
start" — i.e. `canStartSession` (in `MainPanel.tsx`) gates purely on `!!selectedInputDevice`, not
on mute state.

### Device removal / track.onended
No code anywhere under `src/lib/modern-audio/` or `src/services/` registers a `track.onended`
listener or a MediaStreamTrack `'ended'` event handler (`grep -rn "onended"` returned zero hits).
The only device-loss detection in the whole audio stack is `AppAudioRecorder.onLost`
(Windows/macOS per-application capture helper process dying — see §2), and
`navigator.mediaDevices.addEventListener('devicechange', ...)` in
`ModernAudioRecorder.listenForDeviceChange()` (`ModernAudioRecorder.ts:141-165`), which only
diffs the *device list*, not "the currently-recording device just vanished". This is a real gap:
if the physically-selected mic is unplugged mid-session, nothing in this layer notices; the
`getUserMedia` stream's track presumably just stops emitting data.

### PCM delivery callback shape
`AudioRecordingCallback` (`src/services/interfaces/IAudioService.ts:31-40`):
```ts
export interface AudioRecordingCallback {
  (data: {
    mono: Int16Array;
    raw: Int16Array;
    isPassthrough?: boolean;   // ModernAudioRecorder only
    isRecording?: boolean;     // ModernAudioRecorder only
    passthroughVolume?: number; // ModernAudioRecorder only
  }): void;
}
```
`ModernBrowserAudioService.startRecording(deviceId, callback)` stores `callback` as
`this.recordingCallback` and wires `recorder.record((data) => this.dispatchMicAudio(data))`
(`ModernBrowserAudioService.ts:793-820`); `dispatchMicAudio` (lines 757-778) runs passthrough →
echo-monitor probe → `this.recordingCallback(data)`, in that order (comment explains passthrough
must run first because some clients `postMessage` the buffer to a Worker, detaching it — #177).

---

## 2. Participant / system-audio capture

### Electron capture modes (all behind `ModernBrowserAudioService`)
`startSystemAudioRecording(callback)` (`ModernBrowserAudioService.ts:1088-1109`) branches on
state set by `connectSystemAudioSource`:
1. `currentCaptureMode === 'app'` → `startAppAudioRecording()` (uses `AppAudioRecorder`, IPC-fed
   PCM from a helper **process**) — Windows and **macOS** (macOS routes *both* whole-system and
   per-app capture through this path, see below).
2. else `currentMonitorDeviceId` set → `startDeviceCaptureRecording()` (uses
   `DeviceCaptureRecorder`, a `getUserMedia` capture of a specific **input device id** — the
   monitor of a PipeWire null-sink tap) — **Linux per-application** capture only.
3. else → `startLoopbackRecording()` (uses `LoopbackRecorder`, `getDisplayMedia` loopback via
   `electron-audio-loopback`) — whole-system capture on **Windows** and **Linux**.

`connectSystemAudioSource(sourceDeviceId)` (`ModernBrowserAudioService.ts:999-1045`) calls IPC
channel `connect-system-audio-source` and reads back `{ capture: 'app'|'system', monitorLabel? }`:
- `capture === 'app'` → `currentCaptureMode = 'app'`.
- `monitorLabel` present (Linux per-app tap) → resolves it to a Chromium `deviceId` via
  `resolveMonitorDeviceId()` (`ModernBrowserAudioService.ts:978-991`, up to 10 retries × 100 ms,
  matching `"Monitor of <description>"` against `enumerateDevices()` labels) and stores it as
  `currentMonitorDeviceId`; if the monitor device can't be found within the retry budget it
  **falls back to whole-system capture** (comment + `console.warn` at lines 1024-1028).

### IPC channels (renderer → main), from `electron/ipc-channels.js:33-100`
`supports-system-audio-capture`, `list-system-audio-sources`, `connect-system-audio-source`,
`disconnect-system-audio-source`, `start-app-audio-capture`, `stop-app-audio-capture`,
`fix-monitor-volume` (Linux PipeWire monitor-volume fix, `LoopbackRecorder.ts:63-78`),
`check-screen-recording-permission`, `open-privacy-settings`, `get-tcc-display-name`, plus the
externally-registered `enable-loopback-audio`/`disable-loopback-audio` (owned by the
`electron-audio-loopback` npm package, initialized in `electron/main.js:64-70` via `initMain()`
for **all** platforms including Linux, which uses the `PulseaudioLoopbackForScreenShare` Chromium
flag). Main → renderer *receive* channels for per-app capture (`electron/preload.js:62-78`):
`app-audio:pcm` (raw PCM `Uint8Array`), `app-audio:event` (JSON lifecycle events).

### Main-process wiring (`electron/main.js`)
Platform dispatch at the top of the file (`main.js:28-51`): `audioUtils` is
`./pulseaudio-utils` (Linux), `./windows-audio-utils` (win32), `./macos-audio-utils` (darwin), or
an inline stub. `listSystemAudioSources`/`connectSystemAudioSource`/`disconnectSystemAudioSource`/
`supportsSystemAudioCapture` are re-exported from whichever module and wired directly to
`ipcMain.handle(...)` at `main.js:964-983`.

`start-app-audio-capture` / `stop-app-audio-capture` handlers (`main.js:989-1026`) pick the
helper module by `process.platform` (`'./windows-audio-utils'` or `'./macos-audio-utils'`; **null
on Linux** — "Linux does not come through here: its tap is a PipeWire link", comment at
`main.js:990-991`) and call its re-exported `startCapture`/`stopCapture` (both platforms just
re-export `electron/audio-host.js`'s functions — see `macos-audio-utils.js:360-363`).

### The shared per-application capture helper — `electron/audio-host.js` (285 lines)
Platform-neutral driver for a native helper binary (Windows + macOS only; located via
`electron/audio-host-path.js`). Public API: `listAppSources()`, `startCapture(deviceId, onPcm,
onEvent, deps?)`, `stopCapture()`, `ensureUnityGain(deviceName, deps?)`
(`audio-host.js:64,147,217,248`, `module.exports` at line 285).
- `listAppSources()` spawns `<helper> --list`, parses one JSON array of `{id, label, exe, windows}`
  rows from stdout, filters out Sokuji's own process (`own-app-source.js`'s `isOwnAppSource`) and
  maps each to `{ deviceId: 'app:'+id, label: '<name> (<pid>)', appKey, windowTitles }`.
- `startCapture(deviceId, onPcm, onEvent)` spawns `<helper> --target <pid|system>` (translates the
  renderer's `'desktop-audio-loopback'` sentinel to the helper's `'system'` keyword, line 164);
  on macOS also passes `--exclude-pids <own pids>` so a whole-system tap never sees Sokuji's own
  process as "an app that's rendering" (avoids the #492 false-positive silent-permission warning).
  `onPcm`/`onEvent` fire only while the child is still `current` (guards against a killed-but-not-
  yet-closed helper's late events reaching a *new* capture after a fast source switch, comment at
  lines 190-199).
- Helper protocol: PCM on stdout (raw bytes), newline-delimited JSON events on stderr, parsed by
  `makeLineParser()` (line-buffering across chunk boundaries, `audio-host.js:23-39`).

Format contract (per `AppAudioRecorder.ts:8-14`): the helper emits exactly **24 kHz mono signed
16-bit PCM**, continuously clocked even through silence — `AppAudioRecorder` does *not* resample
or insert silence, only aligns bytes to Int16 samples (leftover-byte handling at
`AppAudioRecorder.ts:203-236`).

### macOS specifics (`electron/macos-audio-utils.js`)
`connectSystemAudioSource()` (`macos-audio-utils.js:340-347`) **always** returns
`{ success: true, capture: 'app' }` — both whole-system *and* per-application capture go through
the helper/`AppAudioRecorder` path on macOS. Comment: this needs only the "audio-capture" TCC
grant, whereas the old `getDisplayMedia` whole-system path needed **Screen Recording** as well;
routing both through one permission is why macOS never uses `LoopbackRecorder`.

### Windows specifics (`electron/windows-audio-utils.js`)
`connectSystemAudioSource(sourceId)` (`windows-audio-utils.js:251-260`): `app:`-prefixed sourceId
→ `{ capture: 'app' }` (drives `AppAudioRecorder`); otherwise stops any running helper and
returns `{ capture: 'system' }` (drives `LoopbackRecorder`/`getDisplayMedia`).

### Linux specifics (`electron/pulseaudio-utils.js`, `electron/pipewire-app-audio.js`)
`connectSystemAudioSource(sourceId)` (`pulseaudio-utils.js:285-289`): `app:`-prefixed → delegates
to `pipewire-app-audio.js`'s `connectAppSource(deviceId)`, which links the target PipeWire node's
output ports into a private null sink and returns `{ success: true, monitorLabel:
CAPTURE_SINK_DESCRIPTION }` (`pipewire-app-audio.js:281,375`) — consumed by
`resolveMonitorDeviceId` above. Whole-system path is unchanged `getDisplayMedia` loopback.

### Fallback: app capture dies mid-session (`ModernBrowserAudioService.ts:1183-1223`, matches
prompt's cited `:1196-1205`)
`startAppAudioRecording()` wires `recorder.onLost = () => {...}` (an `AppAudioRecorder` instance
method, fired from `onHelperEvent` on an unexpected `'exit'`/`'error'` — `AppAudioRecorder.ts:312-
331`, guarded by a `stopping` flag so our own teardown-kill is never mistaken for a loss). On
loss: logs a warning, sets `currentCaptureMode = 'system'`, calls
`this.onParticipantWarning?.('app_capture_lost_using_system_audio')` (surfaced to the UI — this
widens capture from one app to the whole machine, which must be visible, not just logged), then
calls `this.startSystemAudioRecording(callback)` again, which now resolves to whole-system
loopback. There is **no reverse fallback** and no re-detection that the helper could be restarted.

### Participant-stream-end detection
Not implemented in general. The only "stream ended" signal for participant audio is the
`AppAudioRecorder.onLost` case above (Windows/macOS helper process death). `LoopbackRecorder`
(`getDisplayMedia`) has no listener for the user cancelling the OS "stop sharing" prompt or for
the captured screen/window closing; `DeviceCaptureRecorder` (Linux) has no listener for the
tapped PipeWire node disappearing beyond a `NotFoundError`/`OverconstrainedError` thrown
*inside* `acquireStream()` (i.e. only detected on next connect, not while already running,
`DeviceCaptureRecorder.ts:42-48`). No `track.onended` anywhere (see §1).

### Extension: tab capture
- API: `chrome.tabCapture.getMediaStreamId({ targetTabId }, cb)` — **not** `chrome.tabCapture.capture`.
- Context: runs in the **background service worker** (`extension/background/background.js:717-
  735`, function `handleStartTabCapture`, invoked via a `chrome.runtime.onMessage` listener for
  `type: 'START_TAB_CAPTURE'` at `background.js:629-632`). No offscreen document is used anywhere
  in the extension (`grep -rn "offscreen"` found zero hits) — the actual `getUserMedia({ audio:
  { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } })` call that consumes the
  streamId happens in `TabAudioRecorder.acquireStream()` (`TabAudioRecorder.ts:44-77`), which runs
  inside the **side panel page** itself (`fullpage.html`, the extension's `side_panel.default_path`
  per `extension/manifest.json:23-25`) — i.e. the same document that hosts
  `ModernBrowserAudioService`. `TabAudioRecorder.shouldConnectToDestination()` returns `true`
  (`TabAudioRecorder.ts:20-22`) because Chrome's tab capture stops the tab's own audio output, so
  this recorder must re-route captured audio back to a real output device
  (`onAudioContextCreated` calls `audioContext.setSinkId(outputDeviceId)`,
  `TabAudioRecorder.ts:28-42`) or the user hears nothing from the captured tab.
- `getTabIdFromContext()` reads `?tabId=` from the side panel's own URL, falling back to
  `chrome.tabs.query({active:true, currentWindow:true})` (`TabAudioRecorder.ts:88-102`).
- PCM reaches the renderer through the same `ParticipantRecorder`/`BaseAudioRecorder`
  AudioWorklet pipeline as everything else (24 kHz mono Int16, no resampling needed since capture
  constraints set `sampleRate: this.sampleRate` directly — no 48→24 kHz step here, unlike the mic).

### Web build (no Electron, no extension)
`ModernBrowserAudioService.supportsSystemAudioCapture()` (`ModernBrowserAudioService.ts:932-943`)
returns `true` only if `ServiceFactory.isElectron() && window.electron`, or `isExtension()`.
Plain web has **no participant source at all** — confirmed by `getEnvironment()` /
`isWeb()` in `src/utils/environment.ts:87-89` being the exclusive complement of the other two,
and no third branch existing anywhere in the participant-capture code path.

### Settings/store fields choosing the participant source
`src/stores/audioStore.ts`: `participantSources: AudioDevice[]`, `selectedParticipantSource:
AudioDevice | null` (default `DEFAULT_PARTICIPANT_SOURCE = { deviceId: 'desktop-audio-loopback',
label: 'System Audio (All Applications)' }`, lines 65-68/96-97/159), actions
`setParticipantSources`/`selectParticipantSource` (lines 130-131, 184-224). Persistence uses a
**restart-stable app key** (`persistedParticipantAppKey`, storage key
`audio.selectedParticipantAppKey`) rather than `deviceId`, because a per-app `deviceId` embeds a
pid that changes every launch (comment at lines 18-20, re-matching logic at 184-215).
`src/lib/modern-audio/participantSource.ts` has the pure helpers: `resolveParticipantSourceId`,
`isApplicationSource` (id starts with `'app:'`), `needsLoopbackStream` (true only on
Windows/Linux whole-system capture — false for any `app:` source and false on macOS entirely,
lines 33-46).

---

## 3. Output — `ModernAudioPlayer` (`src/lib/modern-audio/ModernAudioPlayer.js`, 1325 lines)

### Architecture (file header comment, lines 1-16)
```
PCM chunks → SharedArrayBuffer ring buffer → AudioWorkletNode
  → AnalyserNode → GainNode → MediaStreamDestinationNode
    → HTMLAudioElement.srcObject → Speakers (AEC-visible)
```
Requires `SharedArrayBuffer` (throws if unavailable, `connect()` line 179-181). Extension
deliberately does **not** set COOP/COEP in `manifest.json` because that would make the side panel
cross-origin-isolated, which breaks `chrome.tabCapture` MediaStream consumption (comment lines
172-178, issue #184) — yet `SharedArrayBuffer` is still usable there today (per the same comment).

### Public API (method name — signature, from source)
- `connect(): Promise<boolean>` (line 112) — idempotent; builds the whole graph, including a
  **second**, smaller SharedArrayBuffer ring dedicated to passthrough (`_ptCapacity = sampleRate *
  10`, ~10 s, line 88) so passthrough audio is *mixed*, not queued behind, TTS audio (#177).
- `addStreamingAudio(audioData, trackId = 'default', volume = 1.0, metadata = {}): Int16Array`
  (line 482) — the core streaming entry point; buffers small chunks (`_accumulateChunk`) and
  flushes to the ring once ≥20 ms accumulated (`_checkAndTriggerPlayback`, `minBufferSize =
  sampleRate * 0.02`, line 698) or after a 20 ms timeout; supports out-of-order delivery via
  `metadata.sequenceNumber` (`_handleSequencedAudio`, lines 598-669, 100 ms gap timeout before
  force-flushing what it has).
- `add16BitPCM(audioData, trackId = 'default', volume = 1.0, metadata = {}): Int16Array` (line
  502) — immediate, no accumulation (manual play buttons / replay).
- `addToPassthroughBuffer(audioData, volume = 1.0, delay = 50)` (line 515) — writes to the
  **separate** passthrough ring, optionally after `setTimeout(delay)`; below `volume < 0.01` it's
  a no-op (line 521); NOT gated by `globalVolumeMultiplier` (monitor mute) — passthrough always
  reaches the ring so the pre-gain output waveform (used for the virtual mic) stays faithful
  (comment lines 516-520); a producer-side silence skip drops near-silent chunks so the ring can
  never accumulate unbounded backlog during quiet passthrough (lines 549-571, threshold `0.003`
  mean-abs-amplitude ≈ −50 dBFS).
- `createPlayedAudioTap(): { read: () => Float32Array }` (line 953) — the echo detector's
  reference-signal reader; deliberately reads the **main** ring only, never the passthrough ring
  (passthrough IS the mic, so using it as a reference would false-positive on plain speech even
  with headphones on — comment lines 926-928). Each tap owns its own read cursor and fills gaps
  with computed silence based on wall-clock elapsed time vs. samples actually consumed (detailed
  algorithm, lines 953-1008); capped at 30 s per read (line 959).
- `interrupt(): Promise<{trackId, offset, currentTime}>` (line 1154) — clears the ring
  (`_clearRingBuffer`) and marks `'default'` interrupted; returns `{ trackId: null, offset: 0,
  currentTime: 0 }` if nothing is currently audible (preserves a no-op contract for callers).
- `clearStreamingTrack(trackId)` (line 1179), `clearInterruptedTracks()` (line 1232).
- `setGlobalVolume(volume: number)` (line 761) — clamps to `[0,1]`, sets `gainNode.gain` via
  `setValueAtTime`. This is the **monitor on/off** control (see §9).
- `setSinkId(deviceId): Promise<boolean>` (line 776) — de-duplicates concurrent calls to the same
  device via `deviceChangePromise`/`pendingDeviceId`; sets sink on both the `HTMLAudioElement`
  (failure propagates) and the `AudioContext` itself (failure swallowed — historical behavior,
  comment lines 894-907); the ctx sink "drives the consumer-side clock of the passthrough ring."
- `setPlaybackStatusCallback(callback)` (line 1042) and `getCurrentPlaybackStatus()` (line 1050)
  — `{ itemId, trackId: '', currentTime, duration, isPlaying, bufferedTime }`, computed from an
  in-memory `itemQueue` of `{itemId, startSample, totalSamples}` entries built up as
  metadata-tagged chunks are written (`_writeToRingBuffer`, lines 363-424) and evicted once the
  worklet's reported `totalPlayedSamples` passes their end (`_checkAudibleItemChange`, lines
  300-335) — this is exactly the karaoke/progress data source (see §6).
- `getBufferedDuration(itemId): number` (line 1074), `isTrackPlaying(_trackId): boolean` (line
  1239, actually reflects worklet-global `_workletState`, param unused).
- `stopAll()` (line 1250), `cleanup()` (line 1265) — full teardown, including a wedged-
  `AudioContext` recovery path `_recreateContext()` (lines 806-882, up to 3 attempts, triggered by
  a `statechange` listener that detects a `'suspended'` state that never self-clears within
  ~1.75 s — issue #246 — closes and rebuilds the whole graph, re-applying the saved sink/volume).

### `trackId: 'passthrough'`
Not a distinct code path inside `ModernAudioPlayer` — it is purely a **label** convention used by
callers (`ModernBrowserAudioService.handlePassthroughAudio` calls `sendPcmDataToTabs(data,
'passthrough')`, `ModernBrowserAudioService.ts:904`) and by the extension's virtual-mic content
script, which treats `trackId === 'immediate' || trackId === 'passthrough'` as bypassing the
regular playback queue (`extension/content/virtual-microphone.js:116`, see below). Inside
`ModernAudioPlayer` itself, passthrough audio goes through `addToPassthroughBuffer` → the
dedicated passthrough SAB ring, entirely separate from the `trackId`-keyed `streamingBuffers` map
used by `addStreamingAudio`.

### Two player instances
`ModernBrowserAudioService` constructs **two** `ModernAudioPlayer`s (`ModernBrowserAudioService.ts:
83-99`): `this.player` (real/monitor output, always created) and `this.virtualSpeakerPlayer`
(only if `ServiceFactory.isElectron()`, feeds the Electron virtual speaker device). Every
playback call (`addAudioData`, `interruptAudio`, `clearStreamingTrack`,
`clearInterruptedTracks`, `handlePassthroughAudio`) fans out to **both** instances when
`virtualSpeakerPlayer` exists (e.g. `addAudioData`, lines 508-523).

### Volume as a control — `virtualSpeakerPlayer` pinned to 1.0
`setMonitorVolume(enabled)` (`ModernBrowserAudioService.ts:490-499`, matches prompt's cited
`:497`):
```ts
public setMonitorVolume(enabled: boolean): void {
  const volume = enabled ? 1.0 : 0.0;
  this.player.setGlobalVolume(volume);
  if (this.virtualSpeakerPlayer) {
    this.virtualSpeakerPlayer.setGlobalVolume(1.0);   // always full volume
  }
}
```
Comment: "Virtual speaker always plays at full volume (not affected by monitor toggle)" — i.e.
the monitor mute only silences what the *user* hears locally; the virtual mic / virtual speaker
feed (what the meeting/other app receives) is never muted this way.

### Monitor volume / mute in `audioStore`
`isMonitorMuted: boolean` (default `true` — "monitor off (opt-in audio)", `audioStore.ts:169`),
setter `setMonitorMuted(muted)` (`audioStore.ts:355-362`) calls
`audioService.setMonitorVolume(!muted)` directly. Actual audibility is additionally gated by
`mode` — the monitor is audible **only** in pure `'speaker'` mode (mutex with `'participant'`
mode to prevent feedback); this gating is applied in `setMode` (lines 312-314) and again at
`initializeAudioService` (lines 630-637): `monitorAudible = mode === 'speaker' && !isMonitorMuted`.

### Extension virtual microphone — `sendPcmDataToTabs`
`ModernBrowserAudioService.sendPcmDataToTabs(data: Int16Array, trackId?: string)`
(`ModernBrowserAudioService.ts:529-581`): chunks `data` into 4800-sample (200 ms) pieces if
`data.length > 48000` (i.e. >2 s), else 9600-sample (400 ms) pieces; wraps each chunk as
```ts
{ type: 'PCM_DATA', pcmData: Array.from(chunkData), chunkIndex, totalChunks,
  sampleRate: this.player?.sampleRate ?? 24000, trackId: trackId || 'default', timestamp: Date.now() }
```
and sends via `chrome.tabs.sendMessage` to either one specific `targetTabId` (URL param) or every
non-`chrome://`/non-`chrome-extension://` tab (`sendMessageToTabs`/`sendToAllTabs`, lines 587-655)
— silent no-op if `chrome` isn't defined (Electron/web). **It is called unconditionally from
`addAudioData`** for every call (`ModernBrowserAudioService.ts:522`, `this.sendPcmDataToTabs(result,
trackId)`) — replay (`MainPanel.handlePlayAudio`) and the test tone (`playTestTone`, `trackId:
'test-tone'`) both go through `addAudioData` and therefore both get broadcast to every tab's fake
mic exactly like live AI/TTS audio. There is no gate distinguishing "real session audio" from
"local-only preview/test audio" at this layer.

Receiving side: `extension/content/content.js:194-210`'s `chrome.runtime.onMessage` listener
relays `PCM_DATA` messages verbatim via `window.postMessage(message, '*')` into the page; the
page-injected `extension/content/virtual-microphone.js` (`window.addEventListener('message', ...)`,
line 618) is what actually implements the fake mic:
- Uses `MediaStreamTrackGenerator({kind:'audio'})` + `WritableStreamDefaultWriter` (line 66-67),
  registered with a page-level "device emulator" library (`navigator.mediaDevices.
  addEmulatedDevice`) as an `audioinput` device with fixed id `'sokuji-virtual-microphone'`.
- Expects **Int16 PCM at 24 kHz mono** (`SAMPLE_RATE = 24000`, `CHANNEL_COUNT = 1`, lines 24-25),
  converts to Float32 in `[-1,1]` before feeding `AudioData` (`format: 'f32'`, lines 561-568).
- Two independent queues — `playbackQueue` (regular) and `immediateQueue` (`trackId === 'immediate'
  || trackId === 'passthrough'`, line 116) — are **mixed** together every playback tick
  (`mixAudioBatches`, lines 513-552, additive mix + soft clip to `[-1,1]`), batched with a 20 ms
  minimum / 2 s maximum batch size (`MIN_BATCH_SIZE`/`MAX_BATCH_SIZE`, lines 28-29).
- `zoom-content.js` has its own, separate copy of this same relay pattern (its own
  `injectVirtualMicrophoneScript`/`PCM_DATA` handler, `zoom-content.js:63-71,422-423`) because Zoom
  requires a dedicated content-script profile.

### Electron virtual speaker
Device is auto-detected by label, not user-picked by default:
`detectAndSetVirtualSpeaker()` (`ModernBrowserAudioService.ts:364-396`) scans `getDevices()`
outputs in priority order: `label.includes('Sokuji_Virtual_Speaker')` (Linux, created by
`electron/pulseaudio-utils.js:204-241` via `pactl load-module module-null-sink
sink_name=sokuji_virtual_output ...` + `module-remap-source` for the paired virtual mic) → label
`.includes('SokujiVirtualAudio')` (macOS, a real CoreAudio virtual driver — see
`macos-audio-utils.js`) → label `.toUpperCase().includes('CABLE')` (Windows, VB-CABLE, installed/
managed by `electron/vb-cable-installer.js`). Once found, `virtualSpeakerPlayer.setSinkId(...)`
routes that player's `HTMLAudioElement`/`AudioContext` to it — same `setSinkId` mechanism as any
other output device (§ above), i.e. audio reaches the virtual sink via a second
`AudioContext`/`HTMLAudioElement` pair, not a separate transport.

---

## 4. Passthrough (original-voice-through)

- Settings: `audioStore.isRealVoicePassthroughEnabled` (bool, default `false`) and
  `realVoicePassthroughVolume` (default `0.2`, clamped to `[0, 0.6]` in
  `setRealVoicePassthroughVolume`, `audioStore.ts:257-272`). `ModernAudioRecorder.setupPassthrough
  (enabled, volume)` (`ModernAudioRecorder.ts:214-218`) stores `_passthroughEnabled`/
  `_passthroughVolume` (also clamped `[0,1]` here) and is called from
  `ModernBrowserAudioService.setupPassthrough` (`ModernBrowserAudioService.ts:884-886`), itself
  invoked once at `doInitialize()` with `(false, 0.3)` as placeholder defaults
  (`ModernBrowserAudioService.ts:140`) — actual enabled/volume presumably pushed in later by the
  settings wiring (not traced further in this pass).
- Every mic chunk carries `isPassthrough`/`passthroughVolume` from the recorder
  (`AudioDataWithMeta`, `ModernAudioRecorder.ts:392-398`); `ModernBrowserAudioService.
  dispatchMicAudio` (lines 757-778) checks `data.isPassthrough && data.mono` and, if so, calls
  `handlePassthroughAudio(data.mono, data.passthroughVolume || 0.3)` **before** invoking the
  session client's callback (ordering matters because some clients transfer/detach the buffer —
  comment lines 764-765, issue #177).
- `handlePassthroughAudio(audioData, volume)` (`ModernBrowserAudioService.ts:891-905`): the
  **150 ms delayed copy** referenced in the prompt is exactly here —
  `const delay = 150; // ms delay for echo cancellation` — fed to
  `player.addToPassthroughBuffer(audioData, volume, delay)` and, if present,
  `virtualSpeakerPlayer.addToPassthroughBuffer(audioData, volume, delay)`. Separately (no delay
  needed there), `applyPassthroughVolume(audioData, volume)` scales the Int16 samples by `volume`
  and sends the result to `sendPcmDataToTabs(volumeAdjustedData, 'passthrough')` for the
  extension's virtual mic.
- The 150 ms delay's purpose: giving local AEC time to have already "seen"/cancelled the physical
  loudspeaker leakage before this delayed passthrough copy reaches the monitor speaker again
  (comment says "for echo cancellation").
- Push-to-talk / push-to-translate: not found under this name anywhere in `src/lib/modern-audio/`
  or `src/stores/audioStore.ts` in this pass — likely lives in a session/turn-mode layer
  (`src/lib/session/` per the recent commit history in this worktree, e.g. "the global turn mode,
  the stores behind a runner") rather than in the audio-capture layer itself. Not confirmed;
  flag as an open question for whoever plans the new layer.

---

## 5. Participant TTS

**Current code has no participant-TTS playback at all.** In `MainPanel.tsx`,
`createParticipantEventHandlers`'s `onConversationUpdated` handler explicitly discards audio
deltas from the participant client:
```ts
// Skip audio delta - participant client is text-only
if (delta?.audio) {
  return;
}
```
(`MainPanel.tsx:1040-1047`). The participant leg only ever calls `setParticipantItems(...)` with
text/transcript conversation items; nothing calls `audioService.addAudioData` for the participant
direction anywhere in this codebase (only the speaker leg does, at `MainPanel.tsx:1686`, and the
manual-replay/test-tone paths at `MainPanel.tsx:3577`/`3746`).

A participant-TTS opt-in (default off) was approved on 2026-09-06 but never built: no toggle and no
code path exist. Its blocking defect was the one noted above — on today's path `addAudioData` fans
out to the virtual microphone, so participant speech would be injected into the meeting. The
client-contract spec's route table gives it its own route (participant translation → the real
device only), which plan 1c-2 builds.

---

## 6. Replay and karaoke (`src/components/MainPanel/MainPanel.tsx`, 4940 lines)

### Live path (`MainPanel.tsx:1670-1695`, matches prompt's `:1686`)
Inside `setupClientListeners`'s speaker-client `onConversationUpdated` handler: on `delta?.audio`,
calls
```ts
audioService.addAudioData(delta.audio, 'ai-assistant', shouldPlayAudio, {
  itemId: item.id, sequenceNumber: delta.sequenceNumber, timestamp: delta.timestamp
});
```
(`shouldPlayAudio = item.role === 'assistant'`) and returns early, skipping the React state
update for audio-only deltas (perf: avoids re-rendering on every audio chunk).

### Replay path (`handlePlayAudio`, `MainPanel.tsx:3535-3635`, matches prompt's `:3577` for the
`addAudioData` call)
Triggered by the inline per-message play button. Interrupts any current playback first
(`audioService.interruptAudio()` + `setPlayingItem(null)`), toggles off if replaying the same
item, clears interrupted tracks, then:
```ts
audioService.addAudioData(itemAudioData, item.id, /*shouldPlayAudio*/ true, { itemId: item.id });
```
— note the **trackId is `item.id`** here (not `'ai-assistant'`), and `itemAudioData` is only
available at all when `keepReplayAudio` was on during the session (see below) — `item.
formatted.audio` is `undefined` otherwise and the handler bails at line 3558-3561. Also manually
computes an estimated duration from the audio length (`durationMs = audioLength/24000*1000`,
`actualDurationMs = max(durationMs, 1000)`) and sets a `setTimeout` fallback to clear
`playingItemId` (`MainPanel.tsx:3623-3628`) independent of the player's own status callback.

### `playingItemId` / progress → karaoke (`MainPanel.tsx:3770-3849`)
A `useEffect` calls `player.setPlaybackStatusCallback(status => ...)`:
- `status.status === 'playing'` → cancels any pending debounce, `setPlayingItem(status.itemId)`.
- `status.status === 'ended'`: if `player.getCurrentPlaybackStatus()` shows a *different* item now
  audible, clears immediately; if it shows *no* item audible, debounces the clear (see below); if
  it shows the *same* item, does nothing (rare — another entry for the same item is already
  playing).
- A second `setInterval(..., PROGRESS_UPDATE_INTERVAL /* 100 ms */)` polls
  `player.getCurrentPlaybackStatus()` and calls `setProgress({currentTime, duration,
  bufferedTime})` — this is literally the karaoke progress bar's data source.

### The 2500 ms debounce (`MainPanel.tsx:3804-3821`, matches prompt's `:3806-3821`)
```ts
const ITEM_END_DEBOUNCE_MS = 2500;          // line 1522
const ITEM_END_DEBOUNCE_COMPLETED_MS = 0;   // line 1529
...
const endedItem = itemsRef.current.find((i) => i.id === status.itemId);
const isItemCompleted = endedItem?.status === 'completed';
const delay = isItemCompleted ? ITEM_END_DEBOUNCE_COMPLETED_MS : ITEM_END_DEBOUNCE_MS;
itemEndDebounceRef.current = setTimeout(() => { setPlayingItem(null); setProgress(null); ... }, delay);
```
Rationale (comment lines 1508-1529, 3805-3810): the player's `'ended'` event fires on *every*
`itemQueue` entry eviction, including a chunk-boundary within one still-streaming item (translate
streams 200-400 ms chunks with up to ~2 s silence between them) — the player itself can't tell a
true end from a mid-stream gap, but the *producing client* can (it flips `item.status` to
`'completed'` only once no more audio is coming), so: still-streaming → wait up to 2.5 s for the
next chunk before clearing the karaoke highlight; already-`'completed'` → clear immediately (paired
with the worklet's starving-transition flush so `'ended'` fires the instant the buffer empties,
per the playback-ring-processor.js comment cross-referenced here).

### `keepReplayAudio`
Setting in `settingsStore.ts` (`keepReplayAudio: boolean`, default `false`,
`src/stores/settingsStore.ts:117/208/340/383/820-824`), surfaced in
`src/components/Settings/sections/LanguageSection.tsx:733-737` as "Keep audio for replay" /
"Store translated audio in memory so you can replay it later from each message. Off by default to
reduce memory use during long sessions." Threaded through to every AI client's `config.
keepReplayAudio` (via `ProviderDescriptor.buildSessionConfig`'s `shell: { keepReplayAudio: boolean
}` parameter, present in every provider config under `src/services/providers/`), each of which
gates its own per-item audio accumulation on this flag (e.g. `OpenAIClient.ts:495,529,841,859,990`,
`GeminiClient.ts:1115-1344`, `LocalInferenceClient.ts:1269-1351`, `SonioxClient.ts:1285-1291`,
`VolcengineAST2Client.ts:929-932`). When off, `item.formatted.audio` is never populated for
completed items, so `handlePlayAudio`'s replay button effectively has nothing to play (silently
returns, line 3558-3561) — the UI presumably disables/hides the button in that state (not traced
in this pass).

---

## 7. Echo monitor

### `EchoMonitor` (`src/lib/modern-audio/EchoMonitor.ts`, 184 lines)
Constructed lazily by `ModernBrowserAudioService.ensureEchoMonitor()`
(`ModernBrowserAudioService.ts:723-734`, matches prompt's cited `:70-74` for the field
declarations at lines 70-77):
```ts
new EchoMonitor({
  readPlayedTts: () => this.echoTtsTap?.read() ?? new Float32Array(0),
  onChange: (state) => this.echoNoticeCallback?.(state),
  onDiagnostic: (line) => { if (this.echoDiagnostics) console.info(...) },
})
```
Constructor `EchoMonitor(hooks: EchoMonitorHooks, sampleRate = 24000)` (`EchoMonitor.ts:81-105`)
builds **three** `EchoDetector` instances (from `src/lib/modern-audio/echoDetector.ts`), each a
(probe × reference × lag-band) triple, per the file's own doc comment (lines 4-31):

| Detector | Probe | Reference(s) | Fires as |
|---|---|---|---|
| `micAcoustic` (M1) | mic | `tts` @20-600ms, `participant` @20-600ms | `'tts-echo'` / `'meeting-echo'` |
| `participantVsTts` (M2) | participant | `tts` @0-5000ms (decoys 8/10/12/15 s) | `'self-capture'` (lag<600ms) / `'far-end-echo'` (lag≥600ms) |
| `micLoop` (M3) | mic | `tts` @0-40ms, `rhoThreshold: 0.9`, `historyTicks/clearAfterTicks: 40`, `minVotes: 8` | `'routing-loop'` |

Public API: `pushMic(pcm)` (line 108, feeds `micAcoustic` + `micLoop`), `pushParticipant(pcm)`
(line 114, feeds `micAcoustic`'s participant reference + `participantVsTts`'s probe),
`start()`/`stop()` (lines 119-137, `ECHO_TICK_MS = 250` interval), `running` getter (line 139-141),
`tickOnce()` (line 144-183, exposed for tests; pulls `readPlayedTts()` once per tick and feeds it
as the TTS reference into all three detectors, then reduces the three verdicts via a fixed
`CAUSE_PRIORITY` order — `['routing-loop','self-capture','tts-echo','meeting-echo','far-end-echo']`,
line 56-62 — calling `hooks.onChange` only when the winning cause actually changes).

### Where each tap is fed from
- **mic** → `ModernBrowserAudioService.dispatchMicAudio` (line 771-773): `if
  (this.echoMonitor?.running && data.mono) this.echoMonitor.pushMic(data.mono);` — runs on every
  mic chunk, passthrough or not.
- **participant** → `ModernBrowserAudioService.dispatchParticipantAudio` (lines 781-787, used by
  system-audio/loopback/device-capture/app-capture) and inline in `startTabAudioRecording`'s
  callback (lines 1487-1494, extension tab-capture path) — both call
  `this.echoMonitor.pushParticipant(data.mono)`.
- **TTS reference** → `ModernAudioPlayer.createPlayedAudioTap()` (see §3), created fresh on every
  capture-lifecycle transition (`updateEchoMonitorLifecycle`, `ModernBrowserAudioService.ts:737-
  754`: `this.echoTtsTap = this.player.createPlayedAudioTap()` when starting from a fully-stopped
  state, `= null` when all capture stops) — explicitly the **main** ring only, never the
  passthrough ring (comment in `ModernAudioPlayer.ts`/`.js`, see §3).
- `updateEchoMonitorLifecycle()` treats the monitor as "should run" whenever *any* capture is
  active: `this.recordingCallback !== null || this.systemAudioRecordingActive ||
  this.tabAudioRecordingActive` (lines 738-741).

### Detector internals (`src/lib/modern-audio/echoDetector.ts`)
Exported types `CorrelationResult` (`rho`, `lagFrames`, `decoyRho`, `contrast`, `valid`) and
`EchoVerdict` (`detected`, `cause`, `rho`, `contrast`, `lagMs`, `votes`) — see file header
(lines 1-89) for the full envelope-domain / dB / decoy-contrast / voting-history rationale. Not
re-read in full detail beyond this in this pass; `echoDetector.sweep.test.ts` is the offline
threshold-calibration test the module's own comments reference (94% TPR / 0 FP claim).

### Reaching `EchoNotice` and the `echo_detected` analytics event
`src/components/EchoNotice/useEchoNotice.ts` (`useEchoNotice(service, onDetected)`, line 19):
subscribes via `service.onEchoNotice(next => ...)` (line 35), applies **per-cause dismissal**
semantics (dismissing hides only the current cause; a different cause notifies immediately even
if the old one is still dismissed; an all-clear resets the dismissal so the same cause can
re-notify later — doc comment lines 8-17). `MainPanel.tsx:1469-1476` wires the `onDetected`
callback to analytics:
```ts
trackEvent('echo_detected', { cause: state.cause, lag_ms: Math.round(state.lagMs) });
```
and renders `<EchoNotice state={echoNotice} onDismiss={dismissEchoNotice} />` at line 4910.

### `sokuji.echoDiagnostics` flag
`useEchoNotice.ts:6,44-50`: `localStorage.getItem('sokuji.echoDiagnostics') === 'true'` (read
inside a `try`, since `localStorage` is unavailable in extension worker contexts) →
`service.setEchoDiagnostics(true)` → `ModernBrowserAudioService.setEchoDiagnostics(enabled)`
(`ModernBrowserAudioService.ts:719-721`) just flips `this.echoDiagnostics`, gating whether
`ensureEchoMonitor`'s `onDiagnostic` hook actually `console.info`s the once-per-second detector
stats line built in `EchoMonitor.tickOnce()` (lines 175-181).

---

## 8. Voice preview and test tone

### Shared preview *playback* — `VoiceLibrarySection.tsx` (`togglePreview`, lines 187-231)
This is the **one** place actual audio playback happens for voice previews; the other three
sites below only *produce* the `{audio: Float32Array, sampleRate: number}` payload or handle
raw-clip review, not preview of a synthesized voice sample.
```ts
const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AudioCtx());
const buffer = ctx.createBuffer(1, payload.audio.length, payload.sampleRate);
buffer.copyToChannel(payload.audio, 0);
const src = ctx.createBufferSource();
src.buffer = buffer; src.connect(ctx.destination); src.start();
```
(lines 218-229) — a **fresh, dedicated `AudioContext`** per section instance, connected straight
to `ctx.destination` (the OS default output). **No `setSinkId` call anywhere in this file** — it
does **not** honour the user's selected monitor/output device; preview always plays on the
system default. Cancellation: `stopPreview()` (lines 153-165) bumps a monotonic `previewTokenRef`,
aborts an `AbortController` (so an in-flight *network* request for the sample is itself cancelled,
not just its result discarded — Soniox synthesis is billed per call, comment lines 148-151), and
calls `src.stop()`.

### `NativeVoiceSection.tsx` — `handlePreview` (lines 299-368+)
Supplies the payload consumed above. Two branches:
- `builtin:<name>` — synthesizes a short sample sentence via a native TTS sidecar client
  (`previewTtsRef.current.synthesize({modelId, language, text, speed, voice:{kind:'name',name},
  signal})`, lines 321-336), cached by `previewCacheKey(...)` (in-memory cache, `getCachedPreview`/
  `setCachedPreview`).
- `custom:<id>` — resolves a stored voice clip via `store.resolveApply(numId)`
  (`nativeVoiceStores.ts`, `ClipVoiceStore`/similar) and returns `{audio, sampleRate}` from the
  raw stored clip (lines 350-368) — no synthesis, this previews the **reference clip itself**.

### `nativeVoiceStores.ts` (`src/lib/local-inference/native/nativeVoiceStores.ts`)
Does not itself play audio; provides `ClipVoiceStore` (`onImport`/`onRecord`/`storeClip`, lines
142-192) which decodes an uploaded `File` via a throwaway `new AudioContext()` +
`decodeAudioData()` (line 163-169), downmixes to mono (`downmixToMono`, lines 116-127), and
**peak-normalizes** the clip (`normalizePeak(clip, target=0.95)`, lines 100-113) — comment: "so a
quiet recording isn't near-inaudible on preview and clones well." `resolveApply()` (referenced by
`NativeVoiceSection`) is what later hands the *stored, normalized* clip back for the preview
payload described above.

### `SonioxCloneReviewStep.tsx` — raw-clip review player (not a "voice preview" of a synthesized
sample; this previews the user's own just-recorded/uploaded reference clip before cloning)
Uses a **hidden native `<audio>` element** (`audioRef`, line 99; `<audio ref={audioRef} ...>` at
line 153) with a `Blob` URL:
```ts
const url = URL.createObjectURL(audioBlob);   // line 111
...
audio.play();  // togglePlay, line 119-127
```
One object URL per blob, revoked on change/unmount (lines 109-117) to avoid leaking `blob:` URLs.
Custom progress/seek UI driven by the audio element's own `play`/`pause`/`timeupdate`/
`loadedmetadata`/`ended` events (comment lines 95-98) rather than React state written eagerly. No
`setSinkId` call in this file either — also plays on the OS default output.

### `VoiceCreateModal.tsx`
Does not itself preview/play a voice sample — it hosts the **recording** UI
(`startRecording`/`stopRecording`, lines 240-330ish) that captures a raw reference clip via
`getUserMedia({echoCancellation:false, noiseSuppression:false, autoGainControl:false,
channelCount:1})` + a `ScriptProcessorNode(4096,1,1)` (Float32 chunks accumulated in JS, not an
AudioWorklet — this recorder does **not** reuse `ModernAudioRecorder`/`BaseAudioRecorder` at all,
it's a third, independent capture implementation) and then renders `SonioxCloneReviewStep` (line
422, `audioBlob={review.audioBlob}`) for the actual playback/review step described above.

### Soniox preview (`SonioxVoiceSection.tsx:413-462`)
Same shared-payload pattern: `source.preview({id, language, text, speed, signal})` returns
`{audio, sampleRate}`, cached the same way, ultimately played by `VoiceLibrarySection.togglePreview`.

### Test tone
Generated/decoded in `MainPanel.tsx`'s `playTestTone` (lines 3640-3765, right after
`handlePlayAudio`): fetches a **static MP3 asset** (`/assets/test-tone.mp3`, or
`chrome.runtime.getURL('assets/test-tone.mp3')` in the extension, lines 3674-3683), decodes it via
a throwaway `new AudioContext({sampleRate: 24000})` + `decodeAudioData` (lines 3690-3691),
resamples to 24 kHz via an `OfflineAudioContext` if the decoded rate differs (lines 3696-3713),
downmixes stereo→mono by channel averaging (lines 3717-3734), converts to Int16 PCM with a 10%
headroom reduction (lines 3736-3743), then plays it through the **real** audio pipeline —
`audioService.addAudioData(pcm16bit, 'test-tone', true)` (line 3746) — i.e. unlike the voice
previews above, the test tone **does** go through `ModernAudioPlayer`/the virtual mic/passthrough
fan-out (see §3's note on `sendPcmDataToTabs` being unconditional), and **does** honour whichever
output device is currently selected as the monitor (it explicitly calls `selectMonitorDevice(...)`
to (re)connect it, lines 3751-3758) — the opposite characteristic from the voice-preview sites.

---

## 9. `audioStore` (`src/stores/audioStore.ts`, 822 lines)

### Every device/monitor/mute/passthrough/participant field (interface `AudioStore`, lines 90-149)
- Devices: `audioInputDevices`, `audioMonitorDevices`, `selectedInputDevice`,
  `selectedMonitorDevice`, `participantSources`, `selectedParticipantSource`,
  `persistedParticipantAppKey`.
- Loading: `isLoading`.
- Passthrough: `isRealVoicePassthroughEnabled`, `realVoicePassthroughVolume`.
- Noise suppression: `noiseSuppressionMode: NoiseSuppressionMode` ('off'|'standard'|'enhanced').
- Mode + per-channel mute: `mode: AudioMode` ('speaker'|'participant'|'both'), `isMicMuted`,
  `isMonitorMuted`, `isParticipantMuted`.
- `participantTapAudioSeen: boolean` — "has a per-app capture ever delivered audible audio on this
  machine" (macOS TCC silent-denial workaround for issue #492, doc comment lines 111-119).
- `audioService: IAudioService | null`.

### Actions (all on the interface, implementations at lines 176-653)
`setAudioService`, `markParticipantTapAudioSeen`, `setInputDevices`, `setMonitorDevices`,
`selectInputDevice`, `selectMonitorDevice` (also calls `audioService.connectMonitoringDevice`),
`setParticipantSources` (re-matching logic described in §2), `selectParticipantSource`,
`toggleRealVoicePassthrough`, `setRealVoicePassthroughVolume` (clamped `[0,0.6]`),
`setNoiseSuppressionMode`, `setIsLoading`, `setMode` (the big one — resets mute flags for
newly-in-scope channels, re-gates monitor volume, auto-picks a first real mic when speaker comes
into scope, lines 282-348), `setMicMuted`, `setMonitorMuted` (drives
`audioService.setMonitorVolume`), `setParticipantMuted`, `refreshDevices` (async — the main
"load everything from settings + enumerate + migrate legacy keys" routine, lines 370-600),
`connectMonitorDevice`, `initializeAudioService` (calls `audioService.initialize()`, then
`refreshDevices()`, then applies the mode-gated initial monitor volume and connects the monitor
device if in scope, lines 611-653).

### Default export shape
`create<AudioStore>()(subscribeWithSelector((set, get) => ({ ...initial state..., ...actions
})))` (lines 151-655), default-exported as `useAudioStore` (line 822) plus ~25 individual
selector/action hooks (`useAudioInputDevices`, `useSelectedInputDevice`, `useIsMicMuted`,
`useSetMode`, etc., lines 658-820) and two compound hooks: `useAudioActions()` (memoized action
bundle) and `useAudioContext()` (memoized full-state + actions bundle grouped by channel: mic,
monitor, participant, mode, ancillary, globals).

### Persistence (`STORAGE_KEYS`, lines 15-36, via `src/services/persistSetting.ts` /
`ISettingsService`)
Every field above has a matching `audio.*` storage key. Notably: the participant application
selection persists by **`appKey`** (`audio.selectedParticipantAppKey`), not by `deviceId` (see
§2). `refreshDevices()` contains an explicit **migration** from three legacy boolean flags
(`IS_INPUT_DEVICE_ON`, `IS_MONITOR_DEVICE_ON`, `IS_SYSTEM_AUDIO_CAPTURE_ENABLED`) to the newer
`mode`/`isMicMuted`/`isMonitorMuted`/`isParticipantMuted` quartet (lines 451-504) — the legacy keys
are nulled out after migration rather than deleted (no `removeSetting` API), kept only for a
future grep-for-residue cleanup pass (comment lines 467-473). A persisted **virtual** input device
is explicitly rejected on restore (`savedInputDevice = ... && !d.isVirtual`, lines 514-516) to
avoid silently reintroducing a TTS-feedback loop for users who once hit the auto-select bug this
guards against.

---

## 10. Tests and environment mocking

### Test files covering this area (rough `it(`/`test(` counts via grep)
| File | Count |
|---|---|
| `src/lib/modern-audio/ModernBrowserAudioService.test.ts` | 28 |
| `src/lib/modern-audio/AppAudioRecorder.test.ts` | 26 |
| `src/lib/modern-audio/participantSource.test.ts` | 10 |
| `src/lib/modern-audio/echoDetector.test.ts` | 10 |
| `src/lib/modern-audio/EchoMonitor.test.ts` | 8 |
| `src/lib/modern-audio/ModernAudioRecorder.test.ts` | 7 |
| `src/lib/modern-audio/DeviceCaptureRecorder.test.ts` | 7 |
| `src/lib/modern-audio/playedAudioTap.test.ts` | 7 |
| `src/lib/modern-audio/WebRTCAudioBridge.test.ts` | 4 |
| `src/lib/modern-audio/echoDetector.sweep.test.ts` | 1 (offline threshold-sweep harness) |
| `src/stores/audioStore.test.ts` | (present, not counted in this pass) |

**`ModernAudioPlayer.js` has zero test coverage** — confirmed by `find` for any
`*ModernAudioPlayer*` file: only `ModernAudioPlayer.js` itself exists, no `.test.` counterpart
anywhere in the repo. `playedAudioTap.test.ts` exercises
`createPlayedAudioTap()`'s logic but (per its name/scope) is testing the tap-reading algorithm in
isolation, not `ModernAudioPlayer` as a whole — worth double-checking whether it imports the real
class or a re-implementation before assuming it closes the gap.

### How tests fake browser audio APIs
No shared/global mock helper exists (`src/setupTests.ts` only resets `logStore` and the report
throttle between tests — no `AudioContext`/`MediaStream`/`navigator.mediaDevices` stubbing at
all, `src/setupTests.ts:1-15`; no `test-utils`/`mocks` directory found under `src/`). Every test
file that needs these APIs stubs them **locally**, ad hoc:
- `ModernAudioRecorder.test.ts:4-16`: `Object.defineProperty(globalThis.navigator, 'mediaDevices',
  {configurable:true, value:{getUserMedia}})` in a `beforeEach`, plain `vi.fn()` mocks per test;
  `vi.stubGlobal('AudioContext', class {...})` for a specific failure-path test
  (line 68), cleaned up via `vi.unstubAllGlobals()` in `afterEach`.
- `ModernBrowserAudioService.test.ts:20-32`: a local `setMediaDevices(getUserMedia,
  enumerateDevices)` helper doing the same `Object.defineProperty` pattern, plus a `makeStream()`
  factory returning `{getTracks: () => [{stop: vi.fn()}]}`. Because these tests only exercise
  `getDevices()` (never `initialize()`/`begin()`), they never need to mock `AudioContext`,
  `AudioWorkletNode`, or `SharedArrayBuffer` at all — the real `ModernAudioRecorder`/
  `ModernAudioPlayer` instances are constructed by `new ModernBrowserAudioService()` but never
  touch audio hardware APIs during these particular tests.
- No evidence in this pass of any test mocking `SharedArrayBuffer` or `AudioWorkletNode` directly
  — which is consistent with `ModernAudioPlayer` (the one class that needs both) having no tests.

---

## 11. Platform detection and `window.electron` IPC surface

### `src/utils/environment.ts`
- `isElectron()` (lines 31-58): checks `window.electronAPI`, `window.require`, `navigator.
  userAgent.includes('Electron')`, `window.process?.type === 'renderer'`, `window.process?.
  versions?.electron` — any one true.
- `isExtension()` (lines 65-79): `!isElectron()` AND `window.chrome?.runtime?.id` is a non-empty
  string.
- `isWeb()` (line 87-89): `!isElectron() && !isExtension()`.
- `getEnvironment()` (lines 92-96): `'electron' | 'extension' | 'web'`, same precedence order.
- `hasChromeTabs()`, `hasChromeRuntime()` (lines 101-110).
- `getBackendUrl()`/`getApiUrl()`/`getRelayWsUrl()` (lines 113-146).
- `isDevelopmentMode()`/`isProductionMode()` (lines 148-176) — `isDevelopmentMode` uses Vite's
  `import.meta.env.DEV` rather than `MODE === 'development'` specifically so `vitest`'s `MODE ===
  'test'` still counts as "development" for feature-flagged provider registration.
- `isWindows()`/`isMacOS()`/`isLinux()`/`isLoopbackPlatform()` (lines 333-357) — all desktop
  platforms are "loopback platforms" (all use `electron-audio-loopback`).

### `window.electron` IPC surface (exposed by `electron/preload.js`, consumed via
`ServiceFactory.isElectron() && window.electron`)
- `invoke(channel, data)` — allowlisted against `INVOKE_CHANNELS` (`electron/ipc-channels.js:33-
  100`; full list reproduced in §2's IPC section above plus non-audio channels for sidecar/update/
  window/subtitle/popover control). Rejects with an `Error` and `console.warn`s on any
  unallowlisted channel (`preload.js:130-139`) — a hard security boundary, not silent.
- `send(channel, data)` — a **separate**, much smaller allowlist: `['toMain', 'audio-check',
  'audio-start', 'audio-stop']` (`preload.js:87`) — none of these fire in the audio code paths
  examined in this pass; likely legacy/unused (search across `src/` for `.send(` calls to this
  channel set would confirm, not done here).
- `receive(channel, func)` / `removeListener(channel, func)` / `removeAllListeners(channel)` —
  allowlisted against `validReceiveChannels` (`preload.js:62-78`): `'fromMain'`, `'audio-status'`,
  `'update-status'`, `'update-progress'`, `'subtitle:window-bounds-changed'`,
  `'subtitle:fullscreen-changed'`, `'sidecar-bundle-progress'`, **`'app-audio:pcm'`**,
  **`'app-audio:event'`** (the two channels `AppAudioRecorder` subscribes to, `AppAudioRecorder.ts:
  120-121`), `'app:close-requested'`.
- `osInfo: { platform, arch, systemVersion }` — read synchronously off the preload's own
  `process`, no IPC round-trip (`preload.js:114-129`).

Audio-relevant `invoke` channels, restated from §2/§1: `check-audio-system`,
`create-virtual-speaker`, `check-vbcable`, `install-vbcable`, `check-sokuji-audio`,
`supports-system-audio-capture`, `list-system-audio-sources`, `connect-system-audio-source`,
`disconnect-system-audio-source`, `start-app-audio-capture`, `stop-app-audio-capture`,
`open-privacy-settings`, `get-tcc-display-name`, `check-screen-recording-permission`,
`fix-monitor-volume`, plus the externally-registered `enable-loopback-audio`/
`disable-loopback-audio` (owned by the `electron-audio-loopback` package).

---

## Open questions / gaps flagged for the planner

1. **Two independent mic-capture stacks exist**: `ModernAudioRecorder` (48 kHz→24 kHz downsample,
   AudioWorklet/ScriptProcessor, RNNoise/GTCRN) for OpenAI/Gemini/Soniox/etc., and
   `WebRTCAudioBridge` (direct 24 kHz `getUserMedia`, its own PCM worklet) for WebRTC-transport
   providers (Palabra, GPT-Live-1). A new capture layer needs to decide whether to unify these.
2. **`VoiceCreateModal.tsx`'s recording path is a third, independent capture implementation**
   (`ScriptProcessorNode(4096,1,1)`, no AudioWorklet, no `BaseAudioRecorder` reuse) — a fourth
   producer of "mic PCM" alongside the two above and the participant recorders.
3. **No device-loss / `track.onended` detection anywhere** in the mic or participant capture
   layers (only `AppAudioRecorder.onLost`, which detects the *helper process* dying, not the OS
   device disappearing).
4. **Mute is enforced only above the audio-service layer** (or not clearly enforced at all — not
   located in this pass); `audioStore.isMicMuted` has no listener inside
   `ModernBrowserAudioService`/`ModernAudioRecorder`.
5. **Voice-preview playback never honours the selected output/monitor device** (`VoiceLibrarySection`,
   `SonioxCloneReviewStep` both play on the OS default sink), while the **test tone** deliberately
   does honour it and also unconditionally fans out to the virtual mic — inconsistent by design or
   by accident; worth a decision either way in the new plan.
6. **Participant TTS playback does not exist in this codebase today**: the opt-in approved on
   2026-09-06 was never built (see §5).
7. **Push-to-talk / push-to-translate was not located** under `src/lib/modern-audio/` or
   `src/stores/audioStore.ts`; likely in `src/lib/session/` (not explored in this pass).
8. **ScriptProcessor fallback path skips noise suppression and the 48→24 kHz downsample** that the
   AudioWorklet path applies (`ModernAudioRecorder.ts:370-378` falls through to the *base class's*
   `setupScriptProcessorFallback`, which emits raw samples at whatever rate the `AudioContext` runs
   at, with no RNNoise/GTCRN insertion) — likely an unintentional quality regression on any browser/
   device that can't use AudioWorklet.
