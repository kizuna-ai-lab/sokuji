# Mobile: speech on the loudspeaker with echo cancellation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The translation is read aloud on the phone's loudspeaker too, and the microphone no longer hears it: capture moves into a project module that runs the platform's echo cancellation (iOS VoiceProcessingIO; Android the system canceller, WebRTC AEC3 when it is missing), while headphones keep today's plain path.

**Architecture:** A new Expo module `modules/audio-capture` owns capture on both platforms and, on Android, speech playback too (the canceller needs every played sample as its reference). `session.ts` swaps `AudioRecorder` for the module, asks for the spoken shape whenever `listen` is on, and restarts capture with the right mode on every route change. Pure decisions (which mode for which route and setting; whether speech may play) live in `src/session/capture.ts` and are unit tested; the native code is verified on the two phones.

**Tech Stack:** Expo modules (Swift, Kotlin, C++ JNI), AudioToolbox VoiceProcessingIO, Android `AudioRecord`/`AudioTrack`/`android.media.audiofx`, `webrtc-audio-processing` 2.x (meson, NEON), react-native-audio-api 0.13.6 kept for iOS playback and previews, vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-mobile-speaker-aec-design.md` (approved 2026-11-01).

**Base:** `mobile` after PR #678 (native navigation stack) merges; the screens below are the post-#678 ones.

## Global Constraints

- The audio library stays at `react-native-audio-api` 0.13.6; the nightly is not used (D2).
- iOS floor stays 16.4; ducking `.min` is applied under `@available(iOS 17, *)` only (D3, §5).
- Android minSdk 29 stays; normal audio mode and the media stream, never `MODE_IN_COMMUNICATION` (D4).
- AEC3 build: `webrtc-audio-processing` 2.x, `-Dneon=enabled` on arm64 (the build script sets and checks it), ABIs `arm64-v8a` and `x86_64`, 16 KB page alignment (§4.2).
- `voiceChat` and `VOICE_COMMUNICATION` only while the switch is on for the current output (§4.1, §4.2, §6); with it off, the plain path.
- One switch, two stored values: `echoCancellation` for the phone's speaker (default on) and `echoCancellationOther` for every other output (default off); the row shows the current output's value and asks before turning on away from the speaker (D7, D8, §6). Capture mode: `listen && wanted(settings, route)`. Speech on: `listen && (!wanted(settings, route) || chain !== 'none')` (§6).
- Which chain runs follows availability only: iOS voice processing; Android the vendor chain when the phone has one, AEC3 when not — the same on every output (§6). On Bluetooth with the switch on, hands-free mode is a known possible side effect; untested, no Bluetooth speaker at hand.
- The session still sends 16 kHz mono 16-bit PCM in 100 ms frames; nothing past the capture changes (§4).
- Every new or changed string reaches all 30 catalogs (`src/locales/*/translation.json` at the repo root); the mobile catalog parity test must pass.
- Public repository: no internal data in commits; commits end with the Co-Authored-By trailer the session uses.

## Review Focus

1. A route change arriving while the OS has capture paused (phone call) — the new mode must be applied when capture resumes, not lost. Pinned in Task 5.
2. Capture that fails to start on the loudspeaker with the setting on (effect creation throws, AEC3 library missing) — the session must stay up with subtitles and say `subtitles_only`, not end. Pinned in Task 5.
3. The setting turned off: the user has chosen plain capture, so speech must still play on the loudspeaker. Pinned in Task 2 and Task 5.
4. A stored `inputDeviceId` for a device that is gone — capture must start on the phone's microphone, not fail. Pinned in Task 4 (adapter) and verified on the Pixel in Task 10.
5. Bluetooth connected mid-session on the loudspeaker route with the Bluetooth value off (the default) — capture must restart without processing and speech must continue (headphones). Pinned in Task 5; device check in Task 11.
6. The switch turned on while the output is not the phone's speaker: the row must ask first, and the stored value written must be the other-outputs one, never the speaker's. Pinned in Task 2 (row state) and Task 6.

---

## File map

| File | Responsibility |
|---|---|
| `mobile/modules/audio-capture/expo-module.config.json`, `src/AudioCaptureModule.ts` | The module's JS surface: `startCapture`, `stopCapture`, audio and stopped events, Android speech playback, Android input list; byte-to-`Int16Array` conversion |
| `mobile/modules/audio-capture/ios/AudioCapture.podspec`, `ios/AudioCaptureModule.swift`, `ios/VoiceProcessingUnit.swift` | iOS: the VoiceProcessingIO unit (from the spike), session options per mode, ducking, interruptions |
| `mobile/modules/audio-capture/android/build.gradle`, `android/src/main/java/ai/kizunaai/sokuji/audiocapture/{AudioCaptureModule,CaptureEngine,SpeechTrack}.kt`, `android/src/main/cpp/{CMakeLists.txt,apm_jni.cc}`, `android/libs/<abi>/*.a`, `android/NOTICE-webrtc.txt` | Android: capture thread with chain selection, the AEC3 JNI wrapper, the stereo speech track; prebuilt APM libraries |
| `mobile/scripts/build-apm-android.sh`, `mobile/scripts/android-arm64.ini`, `mobile/scripts/android-x86_64.ini` | Cross-builds `webrtc-audio-processing` 2.x and checks NEON |
| `mobile/src/session/capture.ts` (+ test) | Pure rules: `headphones`, `echoCancellationFor`, `speakable`, `echoRowState` |
| `mobile/src/session/captureNative.ts` | The session's `Capture` over the module (native, not unit tested) |
| `mobile/src/session/speechNative.ts` | The Android `SpeechPlayer` over the module's track |
| `mobile/src/session/session.ts` (+ test) | Uses `Capture` instead of `AudioRecorder`; spoken shape whenever `listen`; route change restarts capture |
| `mobile/src/session/routeNative.ts` | Android inputs from the module (USB appears) |
| `mobile/src/store/settings.ts` (+ test) | `echoCancellation: boolean` (the phone's speaker, default `true`), `echoCancellationOther: boolean` (every other output, default `false`) |
| `mobile/src/analytics/events.ts` (+ test) | `speech_route`, `aec_chain` |
| `mobile/src/screens/Devices.tsx`, `mobile/src/screens/Main.tsx` | The switch row showing the current output's value, the confirmation away from the speaker; passing the settings and the chain through |
| `src/locales/*/translation.json` (30) | Two changed strings, five new keys |
| `docs/superpowers/specs/2026-10-26-sokuji-mobile-design.md` | R13 row, §3.1 bullet, Gate A addendum amended |
| `mobile/scripts/transcribe.mjs`, `mobile/scripts/score.py` | The Soniox recognition pipeline used for verification |

Phases: Tasks 1–7 are TypeScript and docs (parallel, no device). Tasks 8–10 are the native module (Sophie's Mac, the phones). Task 11 is verification. Tasks 1–7 can land before 8–10 behind the existing library recorder only if `createCapture` keeps a library-backed fallback; this plan does not do that: the session switches to the module in Task 5, so Tasks 5 and 8–10 merge together, and Tasks 1–4, 6, 7 may merge first.

---

### Task 1: The setting

**Files:**
- Modify: `mobile/src/store/settings.ts` (`Settings`, `DEFAULT_SETTINGS`)
- Test: `mobile/src/store/settings.test.ts`

**Interfaces:**
- Produces: `Settings.echoCancellation: boolean` (the phone's speaker, default `true`) and `Settings.echoCancellationOther: boolean` (every other output, default `false`).

- [ ] **Step 1: Write the failing test**

```ts
it('cancels echo on the phone\'s speaker by default and not on other outputs, and keeps a stored change', async () => {
  const storage = memoryStorage();
  const first = (await createSettingsStore(storage)).getState().settings;
  expect([first.echoCancellation, first.echoCancellationOther]).toEqual([true, false]);
  (await createSettingsStore(storage)).getState().set({ echoCancellation: false, echoCancellationOther: true });
  const second = (await createSettingsStore(storage)).getState().settings;
  expect([second.echoCancellation, second.echoCancellationOther]).toEqual([false, true]);
});
```
(use the file's existing store factory and storage helper names.)

- [ ] **Step 2: Run it** — `npx vitest run src/store/settings.test.ts` — Expected: FAIL, the keys are undefined.
- [ ] **Step 3: Add both keys to `Settings` with the comments "D7: cancel the speaker's echo from the microphone" and "D8: the same on any other output, for one that plays aloud (a Bluetooth speaker, a car); off for headphones", defaults `true` and `false`.**
- [ ] **Step 4: Run it** — Expected: PASS; whole file passes.
- [ ] **Step 5: Commit** — `feat(mobile): echo cancellation settings for the speaker and other outputs`

### Task 2: The pure rules

**Files:**
- Create: `mobile/src/session/capture.ts`
- Test: `mobile/src/session/capture.test.ts`
- Modify: `mobile/src/session/session.ts` (remove the local `headphones` lambda; import it)

**Interfaces:**
- Produces:
  - `export type CaptureChain = 'none' | 'voiceProcessing' | 'vendor' | 'aec3';`
  - `export function headphones(route: Route): boolean` — `'headphones' | 'bluetooth'`.
  - `export interface EchoSettings { echoCancellation: boolean; echoCancellationOther: boolean }`
  - `export function wanted(s: EchoSettings, route: Route): boolean` — `echoCancellation` for `'speaker'`, `echoCancellationOther` for every other route (`'bluetooth' | 'headphones' | 'other'`).
  - `export function echoCancellationFor(s: EchoSettings & { listen: boolean; route: Route }): boolean` — `listen && wanted(s, route)`.
  - `export function speakable(s: EchoSettings & { listen: boolean; route: Route; chain: CaptureChain | null }): boolean` — `listen && (!wanted(s, route) || chain !== 'none')`; `chain` null = capture not started yet, which counts as `'none'`.
  - `export function echoRowState(s: EchoSettings, route: Route): { checked: boolean; key: 'echoCancellation' | 'echoCancellationOther'; confirmBeforeOn: boolean }` — the Devices row: `checked = wanted(s, route)`, `key` the value the row writes, `confirmBeforeOn = route !== 'speaker'`.

- [ ] **Step 1: Write the failing tests**

```ts
const defaults = { echoCancellation: true, echoCancellationOther: false };
describe('when the microphone is processed', () => {
  it('on the phone\'s speaker with its value on, on any other output only with the other value on', () => {
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'speaker' })).toBe(true);
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'headphones' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'bluetooth' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, listen: true, route: 'other' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, echoCancellationOther: true, listen: true, route: 'bluetooth' })).toBe(true);
    expect(echoCancellationFor({ ...defaults, listen: false, route: 'speaker' })).toBe(false);
    expect(echoCancellationFor({ ...defaults, echoCancellation: false, listen: true, route: 'speaker' })).toBe(false);
  });
});
describe('whether the translation may be spoken', () => {
  it('whenever no processing is wanted, and otherwise only with a chain running', () => {
    expect(speakable({ ...defaults, listen: true, route: 'headphones', chain: 'none' })).toBe(true);
    expect(speakable({ ...defaults, listen: true, route: 'bluetooth', chain: 'none' })).toBe(true);
    expect(speakable({ ...defaults, echoCancellationOther: true, listen: true, route: 'bluetooth', chain: 'none' })).toBe(false);
    expect(speakable({ ...defaults, echoCancellationOther: true, listen: true, route: 'bluetooth', chain: 'vendor' })).toBe(true);
    expect(speakable({ ...defaults, listen: true, route: 'speaker', chain: 'vendor' })).toBe(true);
    expect(speakable({ ...defaults, listen: true, route: 'speaker', chain: 'none' })).toBe(false);
    expect(speakable({ ...defaults, listen: true, route: 'speaker', chain: null })).toBe(false);
    expect(speakable({ ...defaults, echoCancellation: false, listen: true, route: 'speaker', chain: 'none' })).toBe(true);
    expect(speakable({ ...defaults, listen: false, route: 'speaker', chain: 'vendor' })).toBe(false);
  });
});
describe('the echo cancellation row', () => {
  it('shows the current output\'s value, writes the matching value, and asks before turning on away from the speaker', () => {
    expect(echoRowState(defaults, 'speaker')).toEqual({ checked: true, key: 'echoCancellation', confirmBeforeOn: false });
    expect(echoRowState(defaults, 'bluetooth')).toEqual({ checked: false, key: 'echoCancellationOther', confirmBeforeOn: true });
    expect(echoRowState({ ...defaults, echoCancellationOther: true }, 'headphones')).toEqual({ checked: true, key: 'echoCancellationOther', confirmBeforeOn: true });
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/session/capture.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement the five exports from §6 and D8; `headphones` as in `session.ts` today.**
- [ ] **Step 4: Run** — Expected: PASS. Replace the lambda in `session.ts` with the import; `npx vitest run src/session/session.test.ts` still passes.
- [ ] **Step 5: Commit** — `feat(mobile): capture mode and speakability rules`

### Task 3: Analytics properties

**Files:**
- Modify: `mobile/src/analytics/events.ts` (`sessionStartProperties`, `SessionStartProperties`)
- Test: `mobile/src/analytics/events.test.ts`

**Interfaces:**
- Produces: `sessionStartProperties` accepts `speechRoute?: 'speaker' | 'headphones' | 'bluetooth'` and `aecChain?: CaptureChain`; the properties are `speech_route` and `aec_chain`, both absent when not given.

- [ ] **Step 1: Write the failing test** — `it('carries where the speech goes and which canceller ran')`: with `speechRoute: 'speaker', aecChain: 'vendor'` the result has `speech_route: 'speaker'` and `aec_chain: 'vendor'`; without them neither key exists.
- [ ] **Step 2: Run** — Expected: FAIL on the property names.
- [ ] **Step 3: Implement.** `'other'` routes report as `'speaker'` (the earpiece never plays, §6).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mobile): session start reports the speech route and the echo chain`

### Task 4: The module's JS surface and the session's adapters

**Files:**
- Create: `mobile/modules/audio-capture/expo-module.config.json`, `mobile/modules/audio-capture/src/AudioCaptureModule.ts`
- Create: `mobile/src/session/captureNative.ts`, `mobile/src/session/speechNative.ts`
- Create: `mobile/src/session/captureAdapter.ts` (+ test `captureAdapter.test.ts`) — the testable part of the adapter
- Modify: `mobile/src/session/routeNative.ts` (`devicesInfo`: Android inputs from the module)

**Interfaces:**
- Produces, in `AudioCaptureModule.ts`:
  - `export interface CaptureOptions { echoCancellation: boolean; sampleRate: 16000; inputDeviceId?: string | null }`
  - `export interface CaptureInfo { chain: CaptureChain; sampleRate: number; android?: { implementor: string | null; noiseSuppressionOff: boolean | null; seededDelayMs: number | null } }`
  - `startCapture(o: CaptureOptions): Promise<CaptureInfo>`, `stopCapture(): Promise<void>`
  - `addAudioListener(cb: (pcm: Int16Array) => void): { remove(): void }` — the native event carries `{ bytes: Uint8Array }` (little-endian int16); the wrapper converts.
  - `addStoppedListener(cb: (e: { reason: 'interrupted' | 'error'; message?: string }) => void): { remove(): void }`
  - `listInputs(): Promise<Array<{ id: string; name: string; category: string }>>` (Android; `[]` elsewhere)
  - Android speech: `speechOpen(sampleRate: number): Promise<void>`, `speechWrite(pcm: Int16Array, pan: 'both' | 'left' | 'right'): void`, `speechStop(): void`, `speechQueuedSeconds(): number`, `speechHeld(): number`, `speechClose(): Promise<void>`
- Produces, in `captureAdapter.ts`: `export interface Capture { start(): Promise<CaptureInfo>; stop(): Promise<void>; pause(): Promise<void>; resume(): Promise<CaptureInfo> }` and `createCaptureAdapter(module: ModuleSlice, o: { options: CaptureOptions; onAudio: (pcm: Int16Array) => void; onStopped: (reason: string) => void }): Capture` where `ModuleSlice` is the five functions above the adapter uses (what the test fakes). `pause` = `stopCapture`; `resume` = `startCapture` with the same options (the module re-reports its info).
- `captureNative.ts`: `createCapture(o)` = `createCaptureAdapter(AudioCaptureModule, o)`.
- `speechNative.ts`: `createNativeSpeechPlayer(sampleRate: number): SpeechPlayer & { close(): Promise<void> }` over the `speech*` functions.
- `routeNative.devicesInfo()` on Android: `availableInputs` = `await listInputs()`.

- [ ] **Step 1: Write the failing adapter tests** (`captureAdapter.test.ts`, a fake module recording calls and firing listeners):
  - `it('starts with the options given and hands frames on as Int16')` — fire `{ bytes }` of two samples `[1, -2]` → `onAudio` receives `Int16Array [1, -2]`.
  - `it('stops listening when stopped, and reports why')` — a `stopped` event with `reason: 'interrupted'` reaches `onStopped('interrupted')`; after `stop()` a late frame is dropped.
  - `it('resumes with the same options and returns the fresh info')`.
- [ ] **Step 2: Run** — Expected: FAIL, module not found.
- [ ] **Step 3: Write `AudioCaptureModule.ts` (requireNativeModule('AudioCapture'), the conversion, `Platform` guards for Android-only functions), `captureAdapter.ts`, `captureNative.ts`, `speechNative.ts`, the config json (`apple.modules: ["AudioCaptureModule"]`, `android.modules: ["ai.kizunaai.sokuji.audiocapture.AudioCaptureModule"]`), and the `routeNative` change.**
- [ ] **Step 4: Run** — adapter tests PASS; `npx tsc --noEmit -p .` clean (the native module is typed by the wrapper only).
- [ ] **Step 5: Commit** — `feat(mobile): audio-capture module surface and session adapters`

### Task 5: The session on the module

**Files:**
- Modify: `mobile/src/session/session.ts` (options, start sequence at today's lines 400–520, `applyRoute`, `spokenDetail`, the lease shape, teardown, interruptions)
- Modify: `mobile/src/screens/Main.tsx:153-200` (pass `echo: { echoCancellation: settings.echoCancellation, echoCancellationOther: settings.echoCancellationOther }`; the status event's `route`/`chain` into Task 3's properties)
- Test: `mobile/src/session/session.test.ts` (the recorder fake becomes a capture fake)

**Interfaces:**
- Consumes: Task 2's rules, Task 4's `Capture`, `createCapture`, `createNativeSpeechPlayer`.
- Produces: `startSession` options gain `echo: EchoSettings` (Task 2's type) and `createCapture?: (o: Parameters<typeof createCapture>[0]) => Capture`; the `'listening'` status event gains `route?: Route; chain?: CaptureChain`. Capture starts with `echoCancellation: echoCancellationFor({ ...o.echo, listen: !!o.listen, route })`. `defaultPlayer()` picks the library context on iOS and `createNativeSpeechPlayer(TTS_SAMPLE_RATE)` on Android.

- [ ] **Step 1: Rewrite the fake and write the failing tests.** The fake module records every `start` options object and exposes `emit(pcm)`, `info` (returned by start), and `fail` (reject start). Tests, in the file's style:
  - `it('asks for the spoken shape whenever the translation is to be heard, on any route')` — `listen` on, `getRoute: 'speaker'` → `leaseKey` called with `participantSpeech: true`.
  - `it('starts capture processed on the loudspeaker and plain with headphones')` — first start options `echoCancellation: true` for `'speaker'`, `false` for `'bluetooth'` and `'headphones'` with the defaults.
  - `it('processes another output only by the user\'s choice')` — `echo.echoCancellationOther: true`, route `'bluetooth'` → start options `echoCancellation: true`; `info.chain = 'vendor'` → detail `'spoken'`; `chain = 'none'` → `'subtitles_only'`.
  - `it('keeps the microphone plain when the setting is off, and still speaks')` — `echo.echoCancellation: false`, speaker, `info.chain = 'none'` → start options `echoCancellation: false`; status detail `'spoken'`.
  - `it('shows subtitles only when no chain could run on the loudspeaker')` — setting on, speaker, `info.chain = 'none'` → detail `'subtitles_only'`, session stays `listening`.
  - `it('restarts capture when the route changes, keeps the socket, and stops the player on the way out of the headphones')` — route `'bluetooth'` → `'speaker'`: `player.stopped === 1`, a second start with `echoCancellation: true`, same `streams.length`.
  - `it('applies a route change that arrives while capture is paused when it resumes')` — interruption began → route change → interruption ended with resume → the resume start carries the new mode.
  - `it('ends with microphone_denied only when the module refuses to start, not when a chain is missing')` — `fail` → status error `microphone_denied` as today for permission; a start that resolves with `chain: 'none'` is not an error.
  - Existing tests adjusted: the "headphones in while connecting" rotation tests are deleted (the behaviour is gone).
- [ ] **Step 2: Run** — Expected: FAIL (the session still constructs `AudioRecorder`).
- [ ] **Step 3: Implement:** `restartCapture(echoCancellation)` (stop → create → start → set `captureInfo` → `speech?.setOn(speakable(...))` → status); call it from `applyRoute` after `player?.stop()` when leaving the headphones; the ticker tick and `sendAudio` move into `onAudio`; the first frame logs the delivered sample rate from `info.sampleRate`; `spokenWanted` becomes `!!o.listen`; delete `leaseAskedVoice` and both rotations; interruptions call `capture.pause()` / `capture.resume()` and apply a pending route on resume; teardown stops capture. Keep the Android notification block unchanged.
- [ ] **Step 4: Run** — `npx vitest run src/session/session.test.ts` PASS; whole suite PASS; `tsc` clean.
- [ ] **Step 5: Commit** — `feat(mobile): session captures through the audio module and speaks on the loudspeaker`

### Task 6: Screens and catalogs

**Files:**
- Modify: `mobile/src/screens/Devices.tsx` (a `SwitchRow` "Echo cancellation" under the output group showing `echoRowState(settings, route)`; turning it on while the output is not the phone's speaker opens an `AlertDialog` first; `disabled={locked}`; the notice text), `mobile/src/screens/Listen.tsx:116` (the notice uses the changed string; nothing else)
- Modify: `src/locales/*/translation.json` (30 files)
- Test: the mobile catalog parity test (`src/i18n/languages.test.ts` or the project's parity test) and `mobile/src/screens/deviceText.test.ts` if a text helper is added

**Interfaces:**
- Consumes: Task 1's setting.
- Consumes: Task 2's `echoRowState`; the screen's `route` (already read for the output row).
- Produces keys: `mobile.devices.echoCancellation` = "Echo cancellation"; `mobile.devices.echoCancellationFooter` = "Shown for the current output: on by default for the phone's speaker, off for other outputs. On, Sokuji removes its own voice from the microphone; off lets the translation back in."; `mobile.devices.echoCancellationOtherTitle` = "Cancel echo on this output?"; `mobile.devices.echoCancellationOtherBody` = "For an output that plays aloud, such as a Bluetooth speaker or a car. Earbuds and headphones do not need it. On Bluetooth the audio may drop to call quality."; `mobile.devices.echoCancellationOtherConfirm` = "Turn on"; changed: `mobile.listen.headphones` = "Spoken through headphones or the loudspeaker. On the loudspeaker Sokuji removes its own voice from the microphone."; `mobile.main.status.subtitlesOnly` = "Listening · subtitles only (echo cancellation unavailable)". Cancel uses the existing `common.cancel`.

- [ ] **Step 1: Add the five keys and the two changed strings to `en`, then every other catalog in its language (29 files); run the parity test** — Expected: PASS (it fails first if a catalog is missed).
- [ ] **Step 2: Add the row to `Devices.tsx`** — `const state = echoRowState(settings, route)`; `SwitchRow label={t('mobile.devices.echoCancellation')} checked={state.checked} disabled={locked} disabledReason={t('mobile.settings.locked')} onCheckedChange={(v) => v && state.confirmBeforeOn ? setConfirming(true) : set({ [state.key]: v })}` inside a `RowGroup` with `footer={t('mobile.devices.echoCancellationFooter')}`; the `AlertDialog` (the UI kit's) with the three "Other" keys and `common.cancel`, confirm → `set({ [state.key]: true })`.
- [ ] **Step 3: `tsc` clean; suite PASS.**
- [ ] **Step 4: Commit** — `feat(mobile): echo cancellation row per output, asks first away from the speaker; loudspeaker copy`

### Task 7: Docs and the recognition scripts

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-sokuji-mobile-design.md` (R13 row at line 39, the §3.1 "Hear the translation" bullet at line 58, the Gate A addendum at line 278)
- Create: `mobile/scripts/transcribe.mjs`, `mobile/scripts/score.py` (from the investigation's `reports/mobile/echo/`; no key, no recordings), `mobile/scripts/README.md` (two lines: what they are for, `SONIOX_API_KEY_FILE`)

- [ ] **Step 1: Amend R13:** spoken through headphones and, with the echo cancellation setting on, the loudspeaker; the microphone is processed on the loudspeaker (`2026-11-01-mobile-speaker-aec-design.md`). Amend §3.1 and the Gate A addendum to match ("on the loudspeaker the app speaks and cancels its own voice").
- [ ] **Step 2: Add the scripts; `node --check mobile/scripts/transcribe.mjs`; `python3 -I mobile/scripts/score.py` prints its usage.**
- [ ] **Step 3: Commit** — `docs(mobile): R13 speaks on the loudspeaker; recognition scripts`

### Task 8: iOS module

**Files:**
- Create: `mobile/modules/audio-capture/ios/AudioCapture.podspec` (as `RoutePicker.podspec`, name `AudioCapture`), `ios/AudioCaptureModule.swift`, `ios/VoiceProcessingUnit.swift`

**Interfaces:**
- Consumes: Task 4's module contract (function names, event names and payloads).
- Produces: the native module `AudioCapture`: `AsyncFunction("startCapture")`, `AsyncFunction("stopCapture")`, `Function("listInputs")` (returns `[]`), events `audio` (`bytes: Data`, 100 ms = 3200 bytes) and `stopped`; the speech functions are not defined on iOS (the wrapper never calls them there).

- [ ] **Step 1: `VoiceProcessingUnit.swift` from the spike:** `kAudioUnitSubType_VoiceProcessingIO`, input and output buses on, output renders silence; `setVoiceProcessing(enabled:)` = create the unit with or without `kAUVoiceIOProperty_BypassVoiceProcessing`; on iOS 17+ `kAUVoiceIOProperty_OtherAudioDuckingConfiguration` `.min`, advanced ducking off; capture format converted to 16 kHz mono Int16; frames delivered every 100 ms on a background queue.
- [ ] **Step 2: Audio session per mode in `startCapture`:** `echoCancellation` → `playAndRecord`, `voiceChat`, `[.defaultToSpeaker, .allowBluetoothA2DP]`; otherwise `playAndRecord`, `default`, `[.allowBluetoothA2DP]`. Log the route after activation: with Bluetooth connected and the switch on, the system may move to hands-free (§6, untested). Interruption notifications: `began` → emit `stopped(interrupted)` and tear the unit down; the session resumes by calling `startCapture` again.
- [ ] **Step 3: Verification before the full build (spec §7, first check):** in the dev app, `listen` on, loudspeaker, play a translation through `createSpeechPlayer` while the Mac reads Chinese 20 cm away; record 30 s from the module's frames; score with `mobile/scripts/transcribe.mjs` + `score.py`: Chinese characters matched ≥ 90 % of the voice-only control, no English in the transcript, no 0.25 s window below −70 dBFS. Record the numbers in the PR.
- [ ] **Step 4: Commit** — `feat(mobile): iOS capture through VoiceProcessingIO`

### Task 9: AEC3 for Android

**Files:**
- Create: `mobile/scripts/build-apm-android.sh`, `mobile/scripts/android-arm64.ini`, `mobile/scripts/android-x86_64.ini`
- Create: `mobile/modules/audio-capture/android/libs/arm64-v8a/*.a`, `android/libs/x86_64/*.a`, `android/libs/include/…` (installed headers), `android/NOTICE-webrtc.txt` (BSD-3 text)
- Create: `mobile/modules/audio-capture/android/src/main/cpp/CMakeLists.txt`, `android/src/main/cpp/apm_jni.cc`

**Interfaces:**
- Produces JNI (package `ai.kizunaai.sokuji.audiocapture`, class `Aec3`): `nativeCreate(captureRate: Int, renderRate: Int): Long`, `nativeDestroy(h: Long)`, `nativeSetDelayMs(h: Long, ms: Int)`, `nativeFeedRender(h: Long, pcm: ShortArray)`, `nativeProcess(h: Long, in: ShortArray, out: ShortArray): Int` (10 ms frames; returns 0 on success), `nativeDelayEstimateMs(h: Long): Int`. APM config: echo canceller on, noise suppression off, gain controllers off, high-pass on.

- [ ] **Step 1: The build script:** clone `webrtc-audio-processing` v2.1, `meson setup … --cross-file … -Ddefault_library=static -Dbuildtype=release -Dneon=enabled` for arm64 (x86_64 without the NEON flag), `ninja install`, copy the `.a` files and headers into `android/libs`, and fail if `meson introspect --buildoptions` does not show `neon = enabled` for arm64. Run it on the Mac; commit the outputs with a `SHA256SUMS` file.
- [ ] **Step 2: CMake + JNI:** `add_library(aec3 SHARED apm_jni.cc)`, link the imported archives, `-std=c++20` (the spike built with it; the library's headers are untried under C++17), the verified 16 KB alignment flag `-Wl,-z,max-page-size=16384`; `externalNativeBuild` and `ndk.abiFilters "arm64-v8a","x86_64"` in `android/build.gradle`.
- [ ] **Step 3: Verification:** the module builds in the dev app for both ABIs; `nm -D libaec3.so` shows the JNI symbols; log the cost of a 10 ms round trip through `nativeProcess` on the Pixel — the spike measured about 1.1 ms while playing, a reference for this phone, not a bar for others.
- [ ] **Step 4: Commit** — `feat(mobile): WebRTC AEC3 for Android, prebuilt with NEON`

### Task 10: Android module

**Files:**
- Create: `mobile/modules/audio-capture/android/build.gradle` (from `route-picker`'s), `android/src/main/java/ai/kizunaai/sokuji/audiocapture/AudioCaptureModule.kt`, `CaptureEngine.kt`, `SpeechTrack.kt`

**Interfaces:**
- Consumes: Task 4's contract; Task 9's `Aec3`.
- Produces: the native module `AudioCapture` with the capture functions and events of Task 8 plus `listInputs` (`AudioManager.getDevices(GET_DEVICES_INPUTS)` as `{ id, name, category }` with the platform's type names) and the speech functions `speechOpen`, `speechWrite(bytes: ByteArray, pan: String)`, `speechStop`, `speechQueuedSeconds`, `speechHeld`, `speechClose`.

- [ ] **Step 1: `CaptureEngine.start(options)`:** with `echoCancellation` false: `AudioRecord(MIC, 16000, mono, PCM_16)`, no effects, `chain = none`. With it true: if `AcousticEchoCanceler.isAvailable()` and `create(sessionId)` is non-null → source `VOICE_COMMUNICATION`, effect enabled, `NoiseSuppressor.create(sessionId)?.enabled = false`, read both back, `chain = vendor`, `implementor` from `queryEffects()`; else source `MIC`, `chain = aec3`, one `Aec3` for the engine's life, `setDelayMs` from `AudioTrack.getTimestamp` and `AudioRecord.getTimestamp` once the track runs, zeros fed to the render side when nothing plays. `inputDeviceId`: `setPreferredDevice` when the id matches a current input; otherwise the phone's microphone and a log line. Frames: 100 ms, emitted as `ByteArray`. Reported `CaptureInfo` as Task 4 defines.
- [ ] **Step 2: `SpeechTrack`:** stereo `AudioTrack` (`USAGE_MEDIA`, `CONTENT_TYPE_SPEECH`, streaming, the given rate), `write(pcm, pan)` duplicating mono into both channels or one; every written sample also goes to `Aec3.nativeFeedRender` (mono, resampled to the capture rate if needed) when the AEC3 chain runs; `queuedSeconds` = frames written − `playbackHeadPosition`; `held` = chunks not yet played; `stop` flushes.
- [ ] **Step 3: `AudioCaptureModule.kt`:** the Expo definition (`Name("AudioCapture")`, `Events("audio", "stopped")`, the functions above), `OnDestroy` stops both. A capture error (record state not initialized, read < 0) emits `stopped(error, message)`.
- [ ] **Step 4: Verification on the Pixel (release build):** the 44 s three-clip run of the investigation through the app itself (`listen` on, loudspeaker), scored with the scripts: vendor chain selected (`chain = vendor` in the log), Chinese matched ≥ 95/101 of the control, no English; then force `chain = aec3` by disabling the vendor path in a debug flag and repeat: no window below −70 dBFS, delay estimate within ±20 ms of the seed after 3 s.
- [ ] **Step 5: Commit** — `feat(mobile): Android capture and speech through the audio module`

### Task 11: Device verification (spec §7)

**Files:** none; results go into the PR description and `reports/` outside the repository.

- [ ] Real person over the speech, 2 minutes, both phones, scored with the scripts; owner listens.
- [ ] Route switching: wired and Bluetooth headphones in and out with `listen` on, both phones; capture gap timed from the log (`capture restarted in N ms`); no stuck state.
- [ ] Bluetooth mid-session on the loudspeaker route: microphone stays the phone's (iOS: route log shows the built-in mic), output stays A2DP.
- [ ] Background and lock: Gate A unchanged (60 min locked on each phone with `listen` on).
- [ ] Long run: 60 minutes on the loudspeaker: battery and heat recorded.
- [ ] Interruptions: a phone call during a session recovers as today.
- [ ] Settings off: speech plays on the loudspeaker, the transcript shows the echo (the expected failure, documented).
- [ ] A stored USB microphone that is unplugged: the session starts on the phone's microphone.
- [ ] The switch turned on for a Bluetooth speaker (when one is available; otherwise recorded as untested): which chain ran, whether the link moved to hands-free on either platform, and the recognition score, noted in the PR.

---

## Self-review notes

- Spec coverage: D1 (Task 5, 6), D2 (Tasks 4, 8, 10 keep the library for iOS playback and previews), D3 (Task 8), D4/D5 (Task 10), D6/D7 (Tasks 1, 2, 5, 6), D8 (Tasks 1, 2, 5, 6, 11: the other-outputs value, the confirmation), D9 (Task 11 scope), §4 contract (Task 4), §4.1 (Task 8), §4.2 (Tasks 9, 10, incl. `setPreferredDevice` and the input list), §5 (Task 4 `speechNative`, Task 10 `SpeechTrack`, Task 8 step 3), §6 (Tasks 2, 3, 5, 6, 7), §7 (Task 8 step 3, Task 10 step 4, Task 11).
- Types: `CaptureChain`, `CaptureInfo`, `CaptureOptions` defined in Task 4 and used by name in Tasks 2, 3, 5, 8, 10; `Capture` in Task 4 and 5; `speakable`/`echoCancellationFor` in Tasks 2 and 5.
- Review Focus 1–6 each have a test or device check named in the owning task.
