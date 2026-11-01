# Sokuji mobile: speech on the loudspeaker with echo cancellation — design

**Status:** draft for the owner's review, 2026-11-01. Nothing here is built. The spike code lives on
local branches and is not meant to merge.
**Scope:** `mobile/` only. A new native capture module for iOS and Android, the session changes it
needs, and the change to ruling R13. No backend change.

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
| Android | Library nightly `voiceCommunication` | Echo removed, voice weakened and broken up |
| Android | `MIC` or `VOICE_RECOGNITION` with `AcousticEchoCanceler` | No cancellation, or leaks and weak voice |
| Android | **Own `AudioRecord`, `VOICE_COMMUNICATION`, noise suppression off** | **Soniox matched 100/101 and 106/108 characters, no English leaked; about 8% of playback in muted windows** |
| Android | Own `AudioRecord`, `MIC`, WebRTC AEC3 live, one instance per session | Soniox matched 94/99, no muted windows, about 11% of one core |

The owner also judged the `VOICE_COMMUNICATION` recordings best by ear. Recognition, not correlation,
decides between options: this signal goes to Soniox and to nobody's ears.

## 3. Decisions

| # | Decision |
|---|---|
| D1 | R13 changes: with the setting on, the translation is spoken on the loudspeaker too. Headphones behave as today. |
| D2 | Recording moves to a project module on both platforms. The audio library stays, for playback only, at 0.13.6. The nightly is not used. |
| D3 | iOS records through a VoiceProcessingIO audio unit, with other-audio ducking at its minimum on iOS 17 and later. |
| D4 | Android defaults to `AudioRecord` with `VOICE_COMMUNICATION`, the system `AcousticEchoCanceler`, and `NoiseSuppressor` off, in normal audio mode (no call mode). |
| D5 | Android keeps WebRTC AEC3 as a second chain in the same module, for phones where D4 is missing or fails. |
| D6 | Echo processing runs only while speech can reach the loudspeaker. With headphones, capture stays on the plain path it uses today. |

Open for the owner: see §10.

## 4. The capture module

`modules/audio-capture`, an Expo module, one API on both platforms:

```ts
start(options: { echoCancellation: 'off' | 'auto' | 'software'; sampleRate: 16000 }): Promise<CaptureInfo>;
stop(): Promise<void>;
addListener('audio', (e: { pcm: Int16Array }) => void);   // 100 ms frames
addListener('stopped', (e: { reason: string }) => void);
```

`CaptureInfo` names the chain actually running (`none`, `voiceProcessing`, `vendor`, `aec3`) and, on
Android, the effect implementor and whether noise suppression turned off. `auto` means the platform's
default of §3; `software` forces AEC3 (Android only; iOS treats it as `auto`).

It replaces `AudioRecorder` in `session.ts`. The session keeps sending the same 16 kHz mono 16-bit PCM,
so nothing past the capture changes. The tick that drives the session's waits moves to the module's
audio event: on Android the JS timers stop in the background, and the audio callback must keep coming.

### 4.1 iOS

An `AudioUnit` of subtype `kAudioUnitSubType_VoiceProcessingIO`: input bus on, output bus on and
rendering silence, since the unit needs both directions. Session `playAndRecord`, mode `voiceChat`,
options `defaultToSpeaker` and `allowBluetoothA2DP`. The spike's render callback and format conversion
are the starting point. Audio-session interruptions restart the unit, as the session does today for
the recorder.

### 4.2 Android

The foreground service stays as it is. Capture reads `AudioRecord` on its own thread. Chain selection
at start:

1. `AcousticEchoCanceler.isAvailable()` false, or `create()` returns null → AEC3.
2. Otherwise the vendor chain: create and enable the effect, disable `NoiseSuppressor` if present, read
   both back and report them.

AEC3 uses `webrtc-audio-processing` 2.x built with `-Dneon=enabled`; `auto` silently leaves NEON off
and doubles the CPU. Only echo cancellation is on. One instance lives for the whole session. It needs
every playback sample as reference, so with AEC3 the module has to see the PCM going to the speaker
(§5). The library is built for `arm64-v8a`, with 16 KB page alignment.

## 5. Playback

iOS keeps the library's `AudioContext`: measured, no change.

On Android the vendor chain takes its reference from the system, so the library's `AudioContext`
should work unchanged, but the spike played through `AudioTrack`. This is untested and is the first
check in §8. AEC3 needs the PCM, so the speech player gets a tee: the session passes each chunk to the
module's `feedReference` at the moment it hands it to the player. If timing through the library proves
unstable, Android playback moves into the module for the AEC3 chain only.

## 6. Session and product

- `headphones()` no longer gates speech. The lease asks for the spoken shape whenever `listen` is on.
- Route changes pick the capture mode: loudspeaker → echo cancellation on, headphones → off. Switching
  restarts capture, so a short gap is accepted; speech keeps playing.
- Output on the earpiece must not happen: playback goes to the speaker unless headphones are in.
- Audio devices screen: drop "spoken through headphones only".
- Android's microphone choice stays as it is; §10 covers that.
- Text changes reach all 30 catalogs. R13's lines in the mobile design change with this spec.

## 7. Self-test on Android

The vendor chain can be present and poor, and no public list says where. Before the first spoken
translation of a session on the loudspeaker, the module plays about half a second of a known tone at
low level and measures what capture still holds. Residual above a threshold switches the session to
AEC3. The result goes to PostHog with the model and chain, so we learn which phones misbehave. The
threshold comes from measurement on real phones, not from this document.

Skipped if it proves audible enough to annoy; see §10.

## 8. Verification

First, before building either module fully:

1. Android: `AudioContext` playback with the vendor chain, on the spike's 44-second test.
2. iOS: `createSpeechPlayer` chunked playback with VoiceProcessingIO capture. The spike played the clip
   in one go.

Then, on real phones, in a release build:

| Check | Pass |
|---|---|
| A real person talks over the speech, 2 minutes, both platforms | Soniox keeps up, no echo in the transcript, by the owner's judgment |
| Chain switching | Headphones in and out during a session, no stuck state, session continues |
| Background and lock | Gate A behaviour unchanged with the new capture |
| Long run | 60 minutes on the loudspeaker: battery and heat recorded |
| Other Android phones | At least one Samsung and one Xiaomi, recorded with chain and residual |
| Interruptions | Phone call during a session recovers as today |

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
- **Binary size.** About 1.4 MB for AEC3 on arm64.

## 10. Questions for the owner

1. Ship in the first version, or after it? The estimate: iOS module 1 to 2 days, Android 2 to 3, session
   and product 1, in parallel.
2. Is a short test tone before the first speech acceptable (§7)? Without it, a poor vendor chain is
   invisible until a user reports it.
3. A manual "echo cancellation" setting, for phones the self-test misses?
4. Android microphone choice does nothing today (`setInputDevice` is a no-op). The new module can honour
   it, or the screen can stop offering it. Which?
5. Should the speech on the loudspeaker be on by default when `listen` is on, or opt-in?
