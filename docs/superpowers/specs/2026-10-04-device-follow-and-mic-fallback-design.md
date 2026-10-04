# Following the OS's audio devices, and keeping the run when the microphone goes away

Status: approved in conversation 2026-10-04, written for review.
Issue: kizuna-ai-lab/sokuji#593. Builds on `23aa94df` (branch `worktree-mac-repair-refresh-devices`), which ships with this.

## Problem

Sokuji reads the audio device lists once: at startup (`src/routes/Home.tsx:21`) and when the user clicks a settings refresh button. Nothing follows the OS after that. Two visible failures come from it:

- **A virtual device that comes back is not used.** After the macOS banner's Repair (#594) or Linux's Retry brings the virtual device back, the translation reaches it only after a restart, because the virtual sink is found by label in the stale list (`appAudio.ts:67`, `virtualSpeaker.ts`). `23aa94df` patched this one case by refreshing when the audio-system status recovers.
- **A microphone that goes away ends the whole run** (#593). The track's `ended` ends the source (`core.ts:98-108`), and any ended source ends the run (`run.ts:462-463`, `legEnded` 562-566), participant leg included. A failed mid-run device switch does the same (`mic.ts:119`). Field triggers: Bluetooth blips (and Windows moving a headset to its hands-free profile when its mic opens), loose USB mics and webcams, driver resets after sleep.

The existing full refresh (`audioStore.refreshDevices`, `audioStore.ts:336-552`) cannot simply be hooked to device changes. Every call re-reads every persisted audio setting, spawns the native app-list helper on Windows and macOS (`audio-host.js:87`), and on Linux drops any application that has gone quiet from the participant list, resetting a running participant source to whole-system capture (`audioStore.ts:205`). It may also run a `getUserMedia` warm-up that prompts or shows an error toast (`devices.ts:55-56`).

## Goals

1. After Repair or Retry brings the virtual device back, the translation reaches it without a restart.
2. When the microphone in use goes away mid-run, the run continues: Sokuji moves to another real microphone and says which.
3. The device lists in Settings follow plugging and unplugging.
4. With no real microphone at all, the run stays up and waits; the participant leg keeps translating.
5. The same behaviour on Windows, macOS, Linux and the browser extension: everything below lives in the shared renderer code.

## Rulings (jiangzhuo, 2026-10-04)

- When the user's microphone comes back, switch back to it automatically, with a notice (asked: auto switch back vs stay on the fallback).
- With no real microphone left, keep the run and wait for one; the user ends it (asked: wait vs end after 30 s vs end at once).
- The "now using microphone X" notice gets a new neutral **info** level, not the warning style.
- Approach: the device store alone decides which device is in use; the microphone source follows it (rejected: the source picking its own fallback; the store listing and the source choosing).
- Ships together with `23aa94df` in the next release; v0.42.3 went out without it.

## Design

### 1. Device sync (the store decides)

**`syncDevices()`**, a new light action on `audioStore`:

- Re-lists inputs and outputs, then applies the selection rule below. Nothing else: it does not re-read persisted settings, does not touch the participant application list, and does not run the permission warm-up (`listAudioDevices` gains an option to skip it).
- When the inputs come back without labels (no microphone permission yet), it updates the lists but leaves the selections alone: without labels, virtual and loopback inputs cannot be told apart (`devices.ts:69-85`). During a run the permission is always there.
- It never persists a selection and never changes mute. The startup rule that mutes and persists when no real microphone exists at all (`audioStore.ts:490-494`) stays in `refreshDevices` only.

**The selection rule**, one pure function shared by `refreshDevices` (startup, refresh buttons) and `syncDevices`:

- Input:
  1. the saved device (`audio.selectedInputDeviceId`), if listed, not virtual and not marked unusable. This is what switches back automatically.
  2. else the current device, if still listed and not unusable;
  3. else the first real input, by `pickDefaultInputDevice`'s rule (`audioStore.ts:85-88`), also skipping unusable ones;
  4. else none: the waiting state.
- Output (monitor): the same order, ending with the first non-virtual output, then any output.
- Devices match by `deviceId` only. A Bluetooth device keeps its id across reconnects.

**Unusable inputs**: an in-memory set on the store, never persisted. The microphone source adds a device it failed to open (section 2). An id leaves the set when it disappears from the list, so a device that is replugged or reconnects is tried again, or when the user selects it by hand. A sync triggered by `devicechange`, or by the audio system recovering, also clears every mark: the OS reported a change, so the user's device is tried again (the poll and a mark's own sync do not).

**Triggers**:

- One `devicechange` listener on `navigator.mediaDevices`, installed once by the main window (not the subtitle window), removed on unload.
- Debounced about 500 ms, since a Bluetooth connect fires a burst.
- Single-flight: a change during a sync queues exactly one more.
- While no input is selected (waiting), or the selection is off the saved input (on a fallback), a 3-second poll runs the same sync. Chromium on Linux announces only udev sound-card changes: a Bluetooth headset or a PipeWire device coming back is seen only when the devices are listed again (found in the Linux live check, 2026-10-04).
- `23aa94df`'s refresh on audio-system recovery calls `syncDevices` instead of `refreshDevices`. It stays as a belt-and-braces trigger, since whether `devicechange` fires after macOS restarts Core Audio is unverified.
- The microphone source asks for a sync after marking a device unusable.

Consequences: the virtual sink re-resolves from the fresh list through the existing routing subscription (`appAudio.ts:73-85`), so Repair and Retry need no restart. The Settings lists follow the OS.

### 2. The microphone source (keeps the run)

`src/lib/audio/capture/mic.ts` keeps following `MicSettings` (`appCapture.ts:31-38`), which gains:

- `markUnusable(deviceId)`;
- `isListed(deviceId)`;
- the label of the selected device.

The source records the label when it opens a device, because a lost device's label can no longer be looked up. `deviceId()` may now return none: waiting.

- **Track ended** (the device went away): the source does not end.
  - If the selection has already moved on (the sync handled `devicechange` first), it follows the selection.
  - Otherwise it closes the recorder and tries to reopen the same device once:
    - success (a blip): carry on, no notice;
    - failure: `markUnusable(id)`, which re-syncs, and the source follows the new selection.
- **A selection change away from a device that is no longer listed, or is marked unusable**, counts as a loss, not as a switch. `devicechange` and the track's `ended` arrive in either order, and both orders must raise the same notice.
- **A switch that fails**, automatic or the user's: the same. Mark the device unusable and follow the next selection. The run no longer ends.
- **No selection (waiting)**: no recorder open. In particular the source never opens the OS default device (`begin(undefined)`), which may be a virtual or loopback input. When the store selects a device, the source opens it.
- **Notices**: the source tracks whether it is on a device it reached because of a loss.
  - After a loss: either "using another device" or "waiting".
  - Leaving a fallback or the waiting state for any device: "now using".
  - A user's switch in normal operation gets no notice, as today.
- **Unchanged**:
  - A microphone that cannot be opened at session start still fails the start.
  - Mute and the push-to-talk / push-to-translate gates still work on the open recorder (`core.ts:85`, `run.ts:483-486`).
  - Participant sources (system audio, tab) keep their own fallback.

The microphone source no longer ends on a device problem; only stop ends it. A failure that is not about the device (for example the noise-suppression mode failing to apply) still ends it, as today. While the speaker leg waits, its provider connection is kept alive by the adapters' existing keepalives:

- Soniox: `sttStream.ts:234-244`;
- Palabra: `adapter.ts:454-494`;
- Volcengine AST2: `adapter.ts:300-319`.

No adapter fails on silence.

### 3. Notices

Three new codes, raised by the microphone source and shown on the speaker leg:

| Code | When | Level | English | 中文 |
|---|---|---|---|---|
| `mic_lost_using_other` | lost, moved to another input | warning | The microphone "{{lost}}" went away, so "{{device}}" is being used instead. | 麦克风「{{lost}}」已断开，现在改用「{{device}}」。 |
| `mic_lost_waiting` | lost, no real input left | warning | The microphone went away. Translation of your speech resumes when a microphone is connected. | 麦克风已断开。接上麦克风后会自动继续翻译你说的话。 |
| `mic_now_using` | waiting or fallback → a device | info | Now using the microphone "{{device}}". | 现在使用麦克风「{{device}}」。 |

Device names are shown as the OS gives them. They appear in the conversation and the local logs only; source notices are not sent to analytics (`run.ts:542-543`).

Plumbing:

- `SourceNotice` (`session/source.ts:5-8`) gains optional `params` and `severity`, carried by `run.ts:464-465` into the conversation. `Conversation.degraded` keeps its 5-second per-code dedupe, so a flapping device does not flood the conversation.
- The words go into `NOTICE_WORDS` (`lib/view/noticeText.ts`) and `notices.<code>` in every locale catalog. `noticeText.test.ts` and `locales.consistency.test.ts` enforce both.

**The info level**: `Notice.severity` becomes `'error' | 'warning' | 'info'`.

- Every consumer takes it: `conversation/types.ts:38`, `projection/types.ts:42`, `export/transcript.ts:143`, and `ConversationList.tsx:191`.
- `NoticeBubble` draws info with a neutral colour, lucide's `Info` icon and the header "Notice" (`mainPanel.notice`, in every catalog). The bubble is rendered and screenshotted for review before merge.

**Their lifetime** (jiangzhuo, 2026-10-05, after the live tests): all three device notices are transient.

- **What hides them:** the conversation list (main window and expanded subtitles) and the compact subtitle bands hide them `TRANSIENT_NOTICE_MS` (8 s) after they were recorded.
- **What keeps them:** the conversation, its export and the session-end auto-save keep them.
- **How it is modelled:** the lifetime is a kind, not a per-call duration. `Notice.lifetime: 'transient'` is set by the source, and the one duration lives in the view (`lib/view/filter.ts`). That follows #481 (a notice's lifetime follows its kind, not its call site), so another notice can join by setting the same field.
- **Accepted trade-off:** the waiting notice hides too, while the microphone is still missing. jiangzhuo chose that over keeping it on screen.

### 4. Platforms

All of the above runs in the renderer, so Electron on Windows, macOS and Linux and the extension's side panel behave alike. What differs is how a device disappears:

- **Windows**: Bluetooth blips; the hands-free switch when an app opens a headset's mic (automatic, nothing to configure); USB unplug. VB-CABLE must never be picked (`isVirtualMic` already matches `cable`).
- **macOS**: unplug and reconnect; Repair restarting Core Audio.
- **Linux**: USB unplug; PipeWire and PulseAudio nodes; Retry recreating the virtual devices.
- **Extension**: the side panel's microphone. The tabs' virtual microphone is messaging, not a device, and is unaffected.

## Testing

Unit tests come first, each failing before its change:

- **Selection rule:**
  - the saved device is picked when listed (switch-back);
  - otherwise the current device;
  - otherwise the first real input, skipping virtual, loopback and unusable ones;
  - otherwise none;
  - selections are unchanged when labels are missing;
  - outputs follow the same order.
- **`syncDevices`:** it persists nothing, changes no mute, does not call `listSystemAudioSources`, and does not warm up the permission. An unusable mark clears when its device disappears and when the user selects it.
- **Watcher** (fake timers): debounce; single-flight with one trailing run; installed once; removed on unload.
- **Microphone source** (fake recorder and settings):
  - ended → reopened, with no notice and no end;
  - ended → reopen fails → marked unusable → the next device opens, with `mic_lost_using_other` and its params, the lost device's label taken from when it was opened;
  - the selection moves off a device that is no longer listed before its track ends → the same `mic_lost_using_other`, raised once;
  - nothing left → waiting, and the OS default is never opened;
  - a device appears → opened, with `mic_now_using`;
  - leaving a fallback → `mic_now_using`;
  - a user's switch in normal operation → no notice;
  - a failed switch → not ended.
- **Runner:** a lost or waiting microphone does not end the run, and the participant leg continues.
- **Notices:** params and the info level reach the conversation and the transcript export. The locale and wording consistency tests cover the new codes. `23aa94df`'s store test asserts the recovery calls `syncDevices`.

Live checks:

| Where | Who | What |
|---|---|---|
| Linux (GB10) | Claude, over CDP, development build with the fake provider | `pactl load-module module-null-sink` + `module-remap-source` create inputs that look like real microphones; unloading and reloading them simulates unplug and replug. Drive: select A → start → remove A (fallback to B, notice) → remove B (waiting, participant continues) → add A back (now using A) |
| Windows (.13) | jiangzhuo | Unplug and replug whatever mic is at hand (USB mic or webcam) mid-session. If a Bluetooth headset is around, use it as the mic and turn it off and on. VB-CABLE never selected |
| macOS (M4) | jiangzhuo | Unplug and replug a USB or webcam mic. Break the driver → Repair → the virtual mic receives the translation without a restart. Claude reads the logs for whether `devicechange` fired after the Core Audio restart |
| Extension | jiangzhuo | In Meet, unplug and replug the mic mid-session |

Every check confirms three things: the run continued; the notice was right; the participant leg kept translating.

## Out of scope

- Participant sources going away (system audio, tab): their existing handling stays.
- Refreshing the participant application list automatically: it stays manual.
- A microphone that fails at session start: it still fails the start.
- Re-finding a device whose id changed, by its label.
- Saving a fallback device as the user's choice.

## Delivery

One PR on `worktree-mac-repair-refresh-devices` (already carrying `23aa94df`), "Fixes #593", released with the next app version. Push and PR only with jiangzhuo's go.
