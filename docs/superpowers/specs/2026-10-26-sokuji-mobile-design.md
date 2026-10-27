# Sokuji mobile, first version — design

**Status:** approved by the owner, 2026-10-26, through rulings R1–R12 (§2) after the builder check (§8). Gate A (§6) passed on the iPhone on 2026-10-27, with the Android rerun on a release build pending (§6); the first version's plan is `docs/superpowers/plans/2026-10-27-sokuji-mobile-phase2-mvp.md`.
**Scope:** a new app under `mobile/` in this repository (iOS and Android from one codebase), with a small additive change in the backend (auth for the app). Product data, account details and the test-device inventory that informed the decisions are kept in the team's internal notes, not here.

## 1. Intent

Sokuji today runs on a desktop and in a browser extension. A user who sits in a lecture hall, a
classroom or a meeting room without a laptop has nothing. The request that started this came from a
paying desktop user who wants to take a phone instead of a laptop to in-person lectures: listen to one
language, read subtitles in another (or both), for one to two hours at a time; it must keep running
with the phone locked or with a notes app in front; no offline mode (speed matters more); export the
record afterwards to hand to an AI for a summary; and, later, a recording synced to the translation so
a badly heard sentence can be replayed.

Desktop usage data says this user is typical: the large majority of sessions use the microphone only,
long microphone sessions are common, and translating another application's audio is rare.

So the first mobile version is for one scene, done well: **a person in a room, listening to a
language they do not understand, reading subtitles in one they do**, for an hour or two, with the
phone locked or in their pocket for most of it, and a document to keep at the end.

## 2. Rulings (the owner, 2026-10-26)

| # | Question | Ruling |
|---|---|---|
| R1 | Platforms | iOS and Android together, from the start. |
| R2 | The scene | As in §1: listen to others through the microphone, read subtitles. |
| R3 | Stack | React Native (Expo) with a thin native layer for audio and background execution, one codebase (§4). Recommended by the planner; the owner's approval of this document is the ruling. |
| R4 | Devices | One real iPhone (iOS 18) and one real Android phone (Android 15) for the device gates (§6). |
| R5 | Build machine | Both platforms build on a macOS machine with Xcode and Android Studio; Linux hosts keep the TypeScript, the tests and the backend work. |
| R6 | Apple account | An Apple Developer Program membership is in place; the store developer name is decided outside this document. |
| R7 | Backend for the prototype | The prototype talks to the production backend with a real account; so the Expo auth plugin and the `sokuji://` trusted origin ship to production first, as a small additive PR. |
| R8 | Reconnect | As the desktop: a dropped socket is followed by a fresh lease, with the gap that implies; the desktop has no seamless resume either, and the first mobile version does not add one. The resume of §5.3 is a later improvement for both clients. |
| R9 | Google Play | A Play Console account exists; Google's closed-test requirement for new accounts (§5.4) is planned for, starting with the first Android build. |
| R10 | Name and scheme | "Sokuji", URL scheme `sokuji`. |
| R11 | Sign-in | Email and password accounts, as the desktop (revised by the owner on 2026-10-27; the 2026-10-26 ruling was one-time code only): sign-up with email and password, then a 6-digit code sent to the address verifies it inside the app, which is what grants the trial credit; sign-in with the password, which sends no mail, so the mail quota is spent on registrations and password resets only; a forgotten password is reset with a code. No code-only sign-in. No third-party sign-in in the first version (§8.7). |
| R12 | Purchases | The first version shows the balance only: sells nothing, links nowhere (§5.4). |
| R13 | Hearing the translation (owner, 2026-10-27) | The first version also reads the other side's translation aloud to the listener, as the desktop's "Voice I hear" does: the backend's `participant-spoken` shape (`par_stt` + `par_tts`), Soniox speech synthesis streamed as PCM and played by the app. A setting, off by default; the subtitles stay on while it is on. Confirmed by the owner (2026-10-27, 08:17): spoken only through headphones (wired or Bluetooth), since the phone's loudspeaker would feed the spoken translation back into the microphone; on the loudspeaker the app shows subtitles only and says so. The user's own speech translated for others (§3.2) stays out. |
| R14 | Audio devices (owner, 2026-10-27) | The user may choose the microphone in the app: the phone's own (the default), a wired headset's, a USB microphone, or a Bluetooth headset's. The Bluetooth microphone is there for a scene the owner wants in a later version (two people face to face, the phone between them on its own microphone, one earbud each in stereo, each hearing the other's translation: the desktop's face-to-face shape, one mixed stream with the language telling who speaks, and the two translations panned to the two ears over A2DP; a Bluetooth microphone cannot serve that scene, because the hands-free profile it needs plays mono and uses one earbud's microphone only — it is for one person wearing the headset); on most devices it needs the hands-free profile, which drops playback to call quality, so the choice says so beside it, and the app uses high-quality Bluetooth recording where the OS and the earbuds offer it (iOS 18 with recent AirPods). The output device is chosen through the system's own picker, opened from the app (iOS does not let an app pick the output itself). |

## 3. The product, as decided

### 3.1 In the first version

- **Account**: the existing Kizuna AI account and balance. **Sign-up with email and password,
  verified by a code; sign-in with the password** (R11). The sign-in screen has two tabs, as the
  desktop. Sign-up asks for the address and a password, then for the 6-digit code the backend mails;
  the app asks for a code rather than the website's link, so a new account is verified without
  leaving the phone, and the trial credit is granted on that verification. An account that skipped
  the code can still sign in; it sees a "verify your email" line until it enters one. A forgotten
  password is reset with a code. The account screen shows the balance, the last 30 days' spend and
  the hours the balance buys, computed as the website's billing page computes them, and offers
  in-app account deletion, which both stores require of an app that offers sign-up.
- **One job**: pick the language you will hear and the language you read (the desktop's
  "participant" leg, through the microphone), press Start, and read. Subtitles are bilingual by
  default (what was said, then the translation), with a translation-only toggle.
- **Hear the translation** (R13): with the setting on and headphones connected, the translation is
  also read aloud to the listener (the desktop's "Voice I hear"), with a choice of voice and speed
  worded as the desktop words them; the subtitles stay. On the loudspeaker the app falls back to
  subtitles and says why. The session then costs the speech synthesis on top, and the hours
  estimate follows the setting.
- **Keeps running**: with the phone locked, in the pocket, or while another app is in front, for
  the whole session (one to two hours is the target; §6 sets the gate). The OS shows its own
  "microphone in use" indicator; on Android a persistent notification names the session.
- **Managed Soniox only** (`kizunaai_soniox`), through the backend's session-key lease, exactly as
  the desktop does it. No own-key providers in this version.
- **Export**: at the end of a session, the transcript as text and as the desktop's JSON, through the
  system share sheet (save to Files, AirDrop, send to another app). Sessions are kept on the device
  until the user deletes them.
- **Costs**: the session is billed as a desktop session is. Nothing is sold inside the app: no
  top-up button and no store purchase (§5.4 says why). The balance screen says, in words, that
  top-ups are made on the website.
- **Languages and copy**: the 30 catalogs the desktop ships, through the same i18next setup.
- **Settings**: source and target language, bilingual or translation-only, hearing the translation
  (R13: on or off, the voice, the speed), subtitle text size, appearance (light, dark or the
  system's), keep the screen awake while the app is in front, Soniox region (the desktop's
  setting), audio devices (R14: the microphone, and the system's output picker), sign out.
- **Analytics**: PostHog through its React Native SDK, the same event names as the desktop, with
  `platform` = `ios` or `android`.

### 3.2 Not in the first version (and why)

- **Translating the audio of other apps on the phone** (Zoom, Teams): iOS does not let an app
  record another app's audio without a ReplayKit broadcast extension written in Swift, and the
  desktop data shows almost nobody does this (§1). Second version at the earliest.
- **Speaking for the user / TTS of the user's own words** ("speaker" leg): not part of the scene.
  (Reading the *other* side's translation aloud to the listener is in, R13; it reuses the desktop's
  TTS stream and needs playback, but not the speaker leg's capture-and-send path.)
- **Offline models**: no demand, slower, hot and heavy on a phone.
- **A floating window or picture-in-picture** (the iPad wish): iOS allows PiP only for video
  content; apps do it by rendering text into a video layer. Live Activities cannot carry a subtitle
  stream (iOS budgets their updates; a line every few seconds exhausts it). Second version, iPad first.
- **Recording synced to the transcript, with replay**: second version.
- **Own-key providers** (Soniox own key, OpenAI, Qwen, …): later; most need custom request headers
  the desktop only has in Electron and the extension.
- **In-app purchase of credits**: see §5.4.

## 4. Why React Native, and what the alternatives would cost

What the scene demands of the stack, in order: (1) microphone capture and a WebSocket that survive
one to two hours with the screen locked; (2) one codebase for iOS and Android (R1); (3) reuse of the
desktop's TypeScript where it is platform-neutral; (4) a team that already writes React and
TypeScript.

| Option | Background capture | Both platforms | Reuse of desktop TS | Verdict |
|---|---|---|---|---|
| **React Native (Expo dev client)** | Documented: iOS `audio` background mode, Android microphone foreground service (expo-audio `enableBackgroundRecording`; react-native-audio-api `iosBackgroundMode` + foreground service). Must still be proven on our devices (§6). | One codebase | The non-UI TypeScript (§5.2); the UI is rewritten, which a phone needs anyway | **Chosen** |
| Swift native | Best | A second app in Kotlin | None; ports of the segmentation and export logic | Fallback if the React Native background gate fails: build the iOS core natively first |
| Capacitor (WKWebView) | WKWebView loses the microphone in the background; an open WebKit bug (241480), `audio` background mode helps only sometimes | One codebase | UI and TS, but the capture, the socket and the transcript would all have to leave the WebView to be reliable, and the desktop UI is not phone-shaped | No |
| Flutter | Good | One codebase | None (Dart) | No: nothing reused, no Dart on the team |
| PWA | Safari suspends the page when locked | — | All | No |

Two facts settle the Soniox side. Soniox publishes SDKs for Python, Node, Web, React and React
Native, and none for Swift or Kotlin; a native app would carry its own WebSocket protocol code on
each platform. And the protocol itself is small (one JSON config message, then raw PCM frames, JSON
tokens back), which is what the desktop's `sttStream.ts` already speaks over a standard WebSocket.

## 5. The design

### 5.1 Shape of the app

- `mobile/` in this repository: an Expo app (TypeScript, Expo SDK current at build time, a
  development client rather than Expo Go, since native modules are needed). Metro is configured to
  resolve the shared code under `../src/lib/...`, `../src/providers/soniox/...` and
  `../src/locales/...` directly; extracting a workspace package is a later refactor, once the second
  consumer shows where the seam is (planner's call; the builder may start with the package if
  Metro's resolution fights back).
- Both platforms build on a macOS machine (R5). EAS Build is optional, not required.
- **Which backend the app talks to**: the app cannot sign in until the backend carries the Expo
  plugin and the `sokuji://` trusted origin (§5.3). That small, additive auth change ships to
  production in its own PR before the prototype, and the prototype runs against production (R7).
- Minimum OS: iOS 16.4 (Expo SDK 58's floor), Android 10 (API 29) — planner's call, high enough for
  modern audio session and foreground-service behaviour, low enough for the two test devices and
  most users.
- State: one small store (Zustand, as the desktop) for the session; the shared transcript types.

### 5.2 Shared with the desktop (`src/lib/...`), and what is not

Reusable as it stands or with a DOM-free seam, to be audited by the builder (a few files reference
`window`/`document`; those references are isolated or replaced by injected callbacks):

- the Soniox protocol layer (`src/providers/soniox/sttStream.ts`, `socket.ts`, `utterances.ts`):
  config message (`model`, `audio_format: pcm_s16le`, `sample_rate`, `num_channels: 1`, endpoint
  detection, language identification, `language_hints`, `translation`), provisional and final
  tokens, endpoints;
- the managed lease client (`src/providers/soniox/lease.ts`, `leaseRequest.ts`): `POST
  /api/soniox/session-key` → `{ leaseId, clientReferenceId, region, maxSessionDurationSeconds,
  streams: [{ role, apiKey, clientReferenceId }] }`, then `session-started` and `session-end`, with
  the retry and timeout rulings it already encodes;
- sentence segmentation (`src/lib/segmentation/`: `SentenceStream`, `continuousSegments`,
  `sentenceEnd`, `silenceDeferral`), without the punctuation worker (Soniox punctuates);
- the transcript and export renderers (`src/lib/export/transcript.ts`: text and JSON);
- the 30 locale catalogs and the i18next initialisation;
- the auth client (`better-auth/react`), re-wrapped with the Expo plugin (§5.3).

Not reused: everything under `src/components/` (DOM, SCSS), the audio graph (`src/lib/audio/`,
AudioWorklet), local inference, the Electron and extension glue, the stores that persist through
Electron or `chrome.storage`, and the i18n initialisation (`src/locales/index.ts`, which uses the
browser language detector and `document`; the app initialises i18next itself with
`expo-localization` and the same catalogs).

The list of what the app may import is pinned by `src/lib/mobileShared.test.ts`: it walks each
root's import graph with `scripts/mobile-shared-audit.mjs` and fails on anything a phone bundle
cannot carry (Vite-only environment syntax, workers, stylesheets, DOM, Electron or extension
globals, Web Audio, React through a desktop store). Two seams were cut for it: the lease client
takes its API root as a dependency, and the Soniox model name lives in `src/providers/soniox/sttStream.ts` (`SONIOX_STT_MODEL`).

### 5.3 Auth and the backend

- **Client**: `@better-auth/expo`'s `expoClient` (secure storage through `expo-secure-store`, the
  app scheme `sokuji`), over the existing `better-auth/react` client. Backend calls carry
  `Authorization: Bearer <session token>` as the desktop does (`src/lib/auth/hooks.ts`); the backend
  already has the `bearer()` plugin.
- **Backend**: add the `expo()` server plugin from `@better-auth/expo` (it copies the app's
  `expo-origin` header into `Origin` when the request has none) and add the app's origin,
  `sokuji://`, to `trustedOrigins` (better-auth ≥ 1.6.16 refuses sign-in without a trusted Origin;
  the desktop sends a synthesised `file://` origin for the same reason); nothing else in auth changes.
- **The lease over a flaky network**: the managed Soniox key is single-use and the backend's lease
  is the account's exclusive lock, so after a dropped socket the app can neither reconnect with the
  old key nor get a new lease until the old one is released, and the desktop client already waits
  on that conflict for up to a minute. So "a fresh lease" costs a visible gap per drop, and each
  fragment is a session of its own. Phones drop sockets (Wi-Fi to cellular, elevators, a locked
  phone's radio, a phone call suspending the app). The designed next step is a backend **resume**:
  `session-key` with `{ resumeLeaseId }` issues a fresh key under the same, still-live lease,
  bounded by the lease's `maxSessionDurationSeconds` and a cap on issues per lease; billing stays per
  lease. The builder check found this is not a small change (a second stream under one lease needs
  its own client reference so the lease is not released when the first stream ends, and the app must
  know whether a resumed stream reports `session-started` again), so it is the backend's own short spec.
  **Resume is not in the first version (R8)**: the app reconnects with a fresh lease, shows
  "reconnecting" over the gap and keeps the subtitles already shown; the prototype measures how
  long the gap is on a phone (Gate A.2).
- **A long session is a chain of leases.** A grant's `maxSessionDurationSeconds` is what the
  balance buys at the backend's conservative rate, capped at five hours for transcription-only; the
  Soniox key stops at that point (a `403` and a close). The desktop ends the session there and the
  user presses Start again. The phone must keep running (§3.1), so it rotates shortly before each
  grant's end: it ends the stream (which flushes the final words), ends the lease, takes the next
  lease and reconnects — the same path as a drop, with the same gap. A refused lease for lack of
  balance ends the session with a clear message. Found by the prototype's Gate A run (a test account
  with 26 minutes of balance). The app's reconnect loop (backoff, a fresh lease, an in-app
  "reconnecting" state that keeps the subtitles already shown) is the builder's. The prototype
  measured the gap on an iPhone after an airplane-mode drop: once the network was back, the next
  subtitles took at most 18 seconds (new lease 2 s, reconnect 1 s, and up to one 15-second retry
  interval). The first version also listens for the OS's "network restored" event and retries at
  once, so that last interval disappears.

### 5.4 Store policy

- **Microphone in the background**: both stores allow it when the user started the recording and
  the app shows what it is doing: iOS's `audio` background mode with the system microphone
  indicator; Android's foreground service of type `microphone` with a persistent notification
  (required since Android 14), plus `RECORD_AUDIO` at run time.
- **Buying credits**: Apple requires in-app purchase for digital goods consumed inside an app
  (3.1.1), and its multiplatform clause (3.1.3(b)) lets users spend credits bought on the web
  "provided those items are also available as in-app purchases within the app"; external purchase
  links are barred except, since 2025, on the US, EU and Japanese storefronts under conditions of
  their own. Google Play requires Play Billing for in-app digital goods, and lets a consumption-only
  app mention outside purchase options in words, without links. So the "consume a balance bought
  elsewhere" pattern is tolerated in practice but, read strictly, Apple can ask for in-app purchase
  of the same credits. The first version therefore sells nothing and links nowhere: it shows the
  balance and says, in words, that top-ups are made on the website (R12); in-app purchase of credit
  packs (StoreKit and Play Billing receipts credited to the wallet by the backend) is a
  second-version item, pulled forward if App Review asks.
- **Privacy**: audio goes to Soniox in the chosen region, as the published policy already says for
  the desktop; the store listings' data disclosures say the same.
- **Google Play's closed test**: since late 2023 a newly registered personal developer account must
  run a closed test (at least 12 testers, opted in for 14 consecutive days) before it may apply for
  production access; the Play Console's own prompts rule. The closed test therefore starts on the
  first Android build, not after the MVP, or the release waits two weeks or more.

### 5.5 Audio, concretely

- Capture with `react-native-audio-api`'s recorder (or expo-audio's streaming recorder if it proves
  equal): mono, 16 kHz, 16-bit PCM, 100 ms buffers, straight into the Soniox socket (the desktop
  sends 24 kHz because its TTS runs at 24 kHz; the phone has no TTS in this version, so 16 kHz
  halves the upload). Planner's call; the builder may keep 24 kHz if resampling is awkward.
- iOS audio session: record category, `audio` background mode; on Android the library's foreground
  service. The first version always records from the phone's own microphone, even with a Bluetooth
  headset connected: a headset microphone is far from the person speaking, so Bluetooth voice input
  (HFP) is not enabled; recording through a headset is a later setting. Interruptions (a phone call,
  another app taking the microphone) pause and resume the stream with the session kept alive.

## 6. Before building, and before shipping: the gates

**Gate A, the prototype (before the plan is executed in full).** A throwaway Expo app on both test
phones that does only: sign in → session-key → microphone → Soniox → tokens on screen. Pass means:

1. On both phones, locked, 60 minutes of continuous recognition without a gap longer than the
   socket's reconnect.
2. Airplane mode toggled for 30 seconds mid-session: the app reconnects with a fresh lease and
   keeps what it had; the length of the gap is written down.
3. Another app in front for 5 minutes (screen on, the lecture-notes case): recognition continues.
4. Optional, not deciding: an incoming call (capture resumes after hang-up); a Bluetooth headset
   connected and disconnected (the callback keeps running; the input stays the phone microphone).

Battery, heat, the 120-minute run and cellular/pocket conditions move to Gate B, where the owner's
own long session measures them on the near-final build.

If 1 fails on iOS with React Native after the known settings are applied, the iOS core is built in
Swift (§4, row 2) and the plan is rewritten; the prototype's findings go into this document.

**Outcome (2026-10-27): Gate A passed on the iPhone, on a development build; the React Native
route stands.** On the iPhone: 62 minutes locked without a drop, recovery after a 30-second
airplane-mode drop, and 5 minutes behind another app. On the Android phone the 66-minute locked run
kept capture, foreground service and socket uninterrupted, but it is the run whose screen froze (the
rendering finding below), so the Android rows are rerun on a release build with the bounded
rendering and recorded in the prototype's Gate A record before the plan's device tasks. Real
drops (a network blip, a server-side close) recovered in about 9 seconds with the earlier
subtitles kept. Two findings shaped the first version: a grant ends when the balance it
was sized for runs out, so a long session is a chain of leases (§5.3); and drawing a growing
transcript into text blocks is what froze the Android phone and grew memory on iOS — with nothing
drawn while the app is not in the foreground, memory stayed flat for 30 minutes, so the first
version renders subtitles as a virtualized list and draws nothing in the background.

**Gate A addendum (R13).** Hearing the translation changes the iOS audio session from `record` to
`playAndRecord` (Bluetooth output over A2DP, the phone's own microphone kept as input), so the
60-minute locked run is repeated on the iPhone in that mode with the setting on, and the echo rule
is checked once on each phone: with headphones the spoken translation is not transcribed again; on
the loudspeaker the app does not speak.

**Gate B, before TestFlight / Play internal testing.** The MVP checklist in §3.1 on both devices,
in a real 90-minute session on cellular, phone in a pocket, with battery and heat written down,
including at least one forced drop recovered with a fresh lease and the subtitles before it kept
(R8); export opened on a computer; a fresh account's one-time-code
sign-up, trial credit and first session, from the phone's cellular connection; the balance screen's
wording reviewed against the stores' rules.

## 7. Left to the builder

The folder layout under `mobile/`; the Metro configuration for the shared code; the exact audio
library once both are tried; the resampling, if any; the reconnect loop's timings; the screens'
layout and the subtitle typography (the desktop's ruby and readings are not in this version); how
sessions are stored on the device and for how long; the share sheet file names; error copy; the
test split between vitest (shared code) and the Expo app's own tests; the release signing setup.

## 8. Open for the owner (brought with the builder check's questions, 2026-10-26)

1–6. Settled by R6–R12 above.

7. **Third-party sign-in**: the backend has email sign-in only. Adding Google and Apple sign-in
   means backend providers, native sign-in flows in the app, and a trial grant that does not depend
   on the email-verification hook. Apple's guideline 4.8 requires Sign in with Apple whenever any
   third-party sign-in is offered; Sign in with Apple cannot demand a real address (Hide My Email
   gives a relay address, `privaterelay.appleid.com`, moving to `private.icloud.com` in 2026, which
   must be accepted and can be written to once the sender domain is registered). Settled by R11:
   email and password with code verification in the first version; Apple and Google together are
   a second-version item.

Checked by the builder and not open: the Soniox protocol and lease modules are DOM-free apart from
two injectable spots (the API URL and the locale detector); the segmentation runtime is not on the
Soniox path (Soniox's own endpoints drive the desktop's utterances), so the builder audits what to
reuse; the export JSON has no importer, so its shape is the builder's; `platform` is already a
PostHog super property.
