# Sokuji mobile: speech on the loudspeaker with echo cancellation — design

**Status:** draft for the owner's review, 2026-11-01. Nothing here is built. The spike code lives on
local branches and is not meant to merge.
**Scope:** `mobile/` only. A new native capture module for iOS and Android (on Android also the speech
player), the session changes it needs, and the change to ruling R13. No backend change.

## 1. Intent

R13 reads the translation aloud through headphones only, because the phone's microphone would hear
its own speaker: the translated speech is transcribed again and pushes the real speaker's words out.
On 2026-11-01 the owner asked whether that limit can go. The spikes below say yes on the two phones
tested, provided recording leaves the audio library.

The user this is for puts the phone on a table, with no headphones, and hears the translation while
the other person keeps talking. Speech over speech is the normal case, not an edge case: nobody waits
for the translation to finish.

## 2. What the spikes showed

Full table and recordings: `sokuji-aec-compare.html` (attached in #sokuji, not in the repository).
All numbers come from an iPhone 11 and a Pixel 9a, about 20 cm from a Mac speaker playing fixed
Chinese, with the phone playing English.

| Platform | Option | Result |
|---|---|---|
| iOS | Current app, no processing | Echo louder than the voice |
| iOS | `voiceChat` mode alone | Gain drop only, no cancellation |
| iOS | Library nightly `iosVoiceProcessing`; own `AVAudioEngine` | Echo removed, voice muted about a third of playback |
| iOS | **Own VoiceProcessingIO capture, library `AudioContext` playback** | **Echo removed, no muted windows in three rounds** |
| Android | Library nightly `voiceCommunication` | Echo removed, 7/36 muted windows, voice reshaped (correlation 0.30 to 0.10) |
| Android | `MIC` or `VOICE_RECOGNITION` with `AcousticEchoCanceler` | No cancellation, or leaks and weak voice |
| Android | **Own `AudioRecord`, `VOICE_COMMUNICATION`, noise suppression off** | **Soniox matched 100/101 and 106/108 characters, no English leaked; 18 of 222 windows muted across two 44 s takes, about 8% of playback** |
| Android | Own `AudioRecord`, `MIC`, WebRTC AEC3 live, one instance per session | Soniox matched 94/99, the loss in the cold-start segment; 0 of 222 windows muted; about 11% of one core with NEON |

The owner also judged the `VOICE_COMMUNICATION` recordings best by ear. Recognition, not correlation,
decides between options: this signal goes to Soniox and to nobody's ears.

## 3. Decisions

| # | Decision |
|---|---|
| D1 | R13 changes: with the setting on, the translation is spoken on the loudspeaker too. Headphones behave as today. |
| D2 | Recording moves to a project module on both platforms. The audio library stays at 0.13.6, for playback on iOS and previews on both. The nightly is not used. |
| D3 | iOS records through a VoiceProcessingIO audio unit, with other-audio ducking at its minimum on iOS 17 and later. The library's player stays outside the unit: that is what avoids the muting, not the unit by itself. |
| D4 | Android defaults to `AudioRecord` with `VOICE_COMMUNICATION`, the system `AcousticEchoCanceler`, and `NoiseSuppressor` off, in normal audio mode at media volume (no call mode). |
| D5 | Android keeps WebRTC AEC3 as a second chain in the same module, for phones where D4 is missing or fails. |
| D6 | Echo processing runs only while speech can reach the loudspeaker. With headphones, capture stays on the plain path it uses today. |

Open for the owner: see §10.

## 4. The capture module

`modules/audio-capture`, an Expo module, one API on both platforms:

```ts
start(options: { echoCancellation: 'off' | 'auto' | 'software'; sampleRate: 16000; inputDeviceId?: string | null }): Promise<CaptureInfo>;
stop(): Promise<void>;
addListener('audio', (e: { pcm: Int16Array }) => void);   // 100 ms frames
addListener('stopped', (e: { reason: string }) => void);
```

`CaptureInfo` names the chain actually running (`none`, `voiceProcessing`, `vendor`, `aec3`), the sample
rate delivered and, on Android, the effect implementor, whether noise suppression turned off and, with
AEC3, the seeded delay. `inputDeviceId` depends on §10 question 6. `auto` means the platform's
default of §3; `software` forces AEC3 (Android only; iOS treats it as `auto`).

It replaces `AudioRecorder` in `session.ts`. The session keeps sending the same 16 kHz mono 16-bit PCM,
so nothing past the capture changes. The tick that drives the session's waits moves to the module's
audio event: on Android the JS timers stop in the background, and the audio callback must keep coming.

### 4.1 iOS

An `AudioUnit` of subtype `kAudioUnitSubType_VoiceProcessingIO`: input bus on, output bus on and
rendering silence, since the unit needs both directions. Session `playAndRecord`, mode `voiceChat`,
options `defaultToSpeaker` and `allowBluetoothA2DP`. The spike's render callback and format conversion
are the starting point. Audio-session interruptions restart the unit, as the session does today for
the recorder. With headphones the unit is created without voice processing (D6), so a route change
recreates it. The first half second after the loudspeaker starts leaks a little while the canceller
adapts (measured), which is accepted.

`voiceChat` is used on the loudspeaker route only, when no Bluetooth device is connected: Apple's QA1803
says the mode implicitly allows Bluetooth hands-free input (a headset microphone, mono). Headphone routes
use mode `default` with `allowBluetoothA2DP`, and connecting Bluetooth mid-session switches back to it.

### 4.2 Android

The foreground service stays as it is. Capture reads `AudioRecord` on its own thread. Chain selection
at start:

1. `AcousticEchoCanceler.isAvailable()` false, or `create()` returns null → AEC3.
2. Otherwise the vendor chain: create and enable the effect, disable `NoiseSuppressor` if present, read
   both back and report them.

AEC3 uses `webrtc-audio-processing` 2.x. `-Dneon=enabled` is a build requirement: `auto` silently leaves
NEON off and doubles the CPU, so the build script sets it and checks it. Only echo cancellation is on.
One instance lives for the whole session, the render stream gets zeros between utterances, and the
initial `set_stream_delay_ms` comes from the track and record timestamps: the persistent instance is
what passed. The reference is every sample written to the track (§5). The library is built for
`arm64-v8a`, plus `x86_64` for the emulator, with 16 KB page alignment.

Like iOS, a processing chain runs only with no Bluetooth device connected; `VOICE_COMMUNICATION` is used
on the loudspeaker route alone.

## 5. Playback

**iOS.** The library's `AudioContext` stays as the speech player: its output runs in the library's own
engine, outside the VoiceProcessingIO unit, so to the unit it is "other audio" — cancelled from the
system reference and never used to gate the microphone (the measured arrangement: four double-talk
rounds, no muted windows). The unit's own output bus renders silence. On iOS 17 and later the module
sets other-audio ducking to its minimum; on iOS 16.4–16.x (the app's floor) the system ducks other
audio by about 10 dB while voice processing runs, so the translation plays quieter there. Accepted.
The 100 ms chunk scheduling of `createSpeechPlayer` is unchanged; the verification in §8 confirms the
chunked player behaves like the whole-clip spike.

**Android.** Speech playback moves into the capture module, for both chains (my call, open to the
owner): the module owns `AudioRecord`, `AudioTrack` and the canceller. Reasons: the AEC3 chain needs
every played sample as its reference at the moment it is written, and a tee from the JS player cannot
say when a chunk scheduled on the `AudioContext` actually reaches the speaker; `AudioTrack.getTimestamp`
and `AudioRecord.getTimestamp` give the fixed delay the canceller is seeded with; the spike that passed
had exactly this shape (both the vendor chain and AEC3 rounds played through the module's `AudioTrack`,
`USAGE_MEDIA`, `CONTENT_TYPE_SPEECH`, normal audio mode, so this is the path measured); one code path instead of two. The library plays nothing on Android during a
session; it still plays the voice preview (no capture then) and stays the player on iOS. The module's
`AudioTrack` is stereo and takes the player's pan (`both` | `left` | `right`, R14), so the face-to-face
scene keeps its path. Volume: normal audio mode, the media stream (no call volume).

The session therefore talks to one `SpeechPlayer` interface on both platforms: on iOS backed by the
library's context, on Android by the module. `queuedSeconds()` and `held()` keep their meaning (the
module reports what it has written minus what the track has played).

## 6. Session and product

**Capture.** `AudioRecorder` goes; `session.ts` starts the module (§4) with
`echoCancellation: o.listen && !headphones(route) ? 'auto' : 'off'`: with `listen` off nothing plays, so subtitles-only sessions, the majority today, stay on the plain path. `listen` cannot change during a session, so this adds no restart path. The session feeds its 100 ms
frames where the recorder's buffers went: the ticker tick, the first-buffer log, the rotation check,
`sendAudio`. The Android foreground notification (`RecordingNotificationManager`, part of the library,
independent of its recorder) stays. Interruptions: `pauseCapture` / `resumeCapture` map to the module's
stop and start; a resumed capture re-reports its `CaptureInfo`.

**The spoken shape.** The lease asks for `participantSpeech` whenever `listen` is on; the route no longer
decides it (today: `spokenWanted = headphones(route)` at Start, a rotation when headphones come in).
`leaseAskedVoice` and the two "headphones in" rotations go. Speech is on when `listen` is on and the
capture reports a chain other than `none` on the loudspeaker, or any chain with headphones:
`speakable = o.listen && (headphones(route) || captureInfo.chain !== 'none')`.

**Route changes.** `applyRoute(next)` now: (1) `player.stop()` if the route just left the headphones
(the translation must not jump to the loudspeaker mid-sentence through an unprocessed microphone);
(2) restart capture with the mode for the new route — the socket, the lease and the TTS leg are kept;
the gap is one module stop/start (expected under half a second; measured in §8), during which no audio
is sent and the ticker still ticks on the foreground interval; (3) `speech.setOn(speakable)` and the
status line. Earpiece never: iOS `defaultToSpeaker`, Android normal media routing. A route change while
the OS interruption has capture paused is applied when capture resumes.

**Status and copy.** `spokenDetail()` returns `'spoken'` whenever speech is on; `'subtitles_only'` only
when `listen` is on and no chain could start on the loudspeaker (capture start failure, or AEC3 missing
on a device without a vendor canceller) — its text changes from "(no headphones)" to "(echo cancellation
unavailable)". The two notices `mobile.listen.headphones` (Listen screen) and the same key on the
Devices screen become: "Spoken through headphones or the loudspeaker. On the loudspeaker Sokuji removes
its own voice from the microphone." Thirty catalogs. The design spec's R13 row, §3.1's "Hear the
translation" bullet and the Gate A addendum are amended in the same change; R14 is untouched.

**Settings.** No new user-facing setting in the default design: `listen` on means spoken on any route.
Two optional rows are the owner's call (§10): an advanced "echo cancellation: auto / software / off" row
on the Devices screen (Android only; iOS has one chain), and what the Android microphone row does.

**Analytics.** The existing session start event gains `speech_route` (`speaker` | `headphones` |
`bluetooth`) and `aec_chain` (`none` | `voiceProcessing` | `vendor` | `aec3`); the self-test (§7)
sends `aec_selftest` with model, Android version, chain, residual and the decision. No audio leaves the
phone for this.

## 7. Self-test on Android

The vendor chain can be present and poor, and no public list says where. The probe is the first
spoken translation itself, not a tone: for the first two seconds of speech the module keeps the
played PCM and the captured PCM, computes the residual (normalised cross-correlation, the measure of
today's evaluation: unprocessed 0.32–0.35, cancelled 0.02–0.03) and the share of 10 ms frames below
−70 dBFS while the far end plays. Residual above 0.10, or more than 15 % of frames muted, switches the
session to AEC3 at the next utterance boundary and logs why; the result goes to PostHog (§6). One
probe per session; a session that switched stays on AEC3; the next session probes the vendor chain
again (a phone call or a system update can change it). The thresholds are initial values from the
2026-11-01 measurements and are tuned on real phones in §8. Known blind spot: someone talking nearby lowers the correlation and reduces the muted frames, so a poor
vendor chain can pass. So the probe spans up to the first three spoken sentences and takes the largest
residual. What it still misses falls to the Devices setting (§10 question 5) and the PostHog data, and
threshold tuning separates takes with and without near speech.

If the owner wants a check before the
first spoken sentence instead, the probe plays 400 ms of band-limited noise at −20 dBFS; this is the
only version a user could hear, and it is the alternative in §10.

## 8. Verification

First, before building the iOS module fully: `createSpeechPlayer` chunked playback with
VoiceProcessingIO capture. The spike played the clip in one go. On Android the module-owned player is
the shape the spike tested, so no separate check is needed.

Then, on real phones, in a release build:

| Check | Pass |
|---|---|
| A real person talks over the speech, 2 minutes, both platforms | Recordings scored by the Soniox pipeline (`transcribe.mjs`, `score.py`), no echo in the transcript, and the owner's ear |
| Route switching | Wired and Bluetooth headphones in and out with `listen` on, both platforms; capture gap timed; no stuck state; session continues |
| iOS 16 | One phone on the app's floor, for the ducking behaviour |
| Bluetooth mid-session | Connect and disconnect during a session on both platforms: the microphone stays the phone's, output stays A2DP |
| Background and lock | Gate A behaviour unchanged with the new capture |
| Long run | 60 minutes on the loudspeaker: battery and heat recorded |
| Other Android phones | At least one Samsung and one Xiaomi, recorded with chain and residual |
| Interruptions | Phone call during a session recovers as today |

The estimates in §10 assume starting from the spike code. If the owner agrees, the spike branches are
pushed as `spike/…` and `transcribe.mjs` and `score.py` move to `mobile/scripts/`; the recordings stay in
the comparison page.

Unit tests cover chain selection, route-to-mode logic and the session's lease behaviour. The native
code is not unit tested.

## 9. Risks

- **Results come from two phones and a Mac speaker.** No real person has been tested. A chain that
  worked here may not work elsewhere.
- **The vendor chain mutes briefly.** About 8% of playback, with almost no lost characters on this text.
  Other speech may do worse.
- **AEC3 starts cold.** The delay took 6 to 7 seconds to lock at the start of a session, and the first
  segment lost the most characters. The fixed-delay start value is untested.
- **AEC3 cost.** About 11% of one core on a Pixel 9a. Battery and low-end phones are unmeasured.
- **Loud playback.** Tested at one volume on each phone.
- **Binary size.** About 1.4 MB for AEC3 on arm64 alone.
- **iOS 16.** The translation is expected to be about 10 dB quieter on the loudspeaker, with no ducking setting before 17. This comes from the default ducking, not a measurement on iOS 16.
- **Android playback moves into the module.** The library's player is no longer exercised there during
  sessions, so the module owns everything that used to be the library's: scheduling, pan, volume.

## 10. Questions for the owner

1. Ship in the first version or after it? Estimate: iOS module 1–2 days, Android module 2–3 days,
   session and product 1 day, in parallel; plus the verification in §8.
2. Default behaviour: `listen` on means spoken on the loudspeaker too, with no extra switch — agreed?
3. Android speech playback inside the module (§5, my call): any objection?
4. The self-test probes the first spoken sentence silently (§7). Keep it, or prefer a 400 ms test
   noise before the first sentence?
5. An advanced "echo cancellation: auto / software / off" row on the Devices screen (Android only) for
   phones the self-test misjudges — yes or no?
6. The Android microphone choice does nothing today. Have the module honour it (wired/USB selection via
   `setPreferredDevice`), or show the microphone as "chosen by the system" on Android?
7. Bluetooth speakers and car systems: Bluetooth output counts as headphones today (spoken, no
   cancellation), so a Bluetooth speaker would echo, and the system cannot tell the two apart. Leave this
   unsupported in the first version and say so, or treat it as loudspeaker and test AEC3 over A2DP delay?
   Recommended: leave it.
8. Test phones: §8 needs an iOS 16 iPhone, a Samsung and a Xiaomi. We have an iPhone 11 and a Pixel 9a.
   Can they be borrowed? If not, the release relies on the Pixel data and the self-test, and says so.
