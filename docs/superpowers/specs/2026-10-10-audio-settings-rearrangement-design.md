# Audio Settings Rearrangement — Design

**Date**: 2026-10-10
**Status**: boards approved on the canvas (owner, 2026-10-10); spec approved with the five
rulings under "Open questions" (owner, 2026-10-10).
**Scope**: the Audio settings page (Advanced's Audio tab and the Simple list), the mode picker's
device popover, the playback routing behind them, the setup wizard's presets, and the conversation
surfaces that read the routing (ear tags, the ears strip, replay). Every provider; every platform.
**Evidence**: the design canvas https://claude.ai/artifact/AYCKtFSu9FNbRzFwMgU78z — boards 1–7 are
the page and the popovers in each state, board 8 the row-layout comparison the owner chose from;
a read-only map of today's code (routes, graph, playback, stores, components, tests) taken on
2026-10-10 from `feat/soniox-face-to-face`.
**Builds on**: `docs/superpowers/specs/2026-10-08-soniox-speaker-labels-face-to-face-design.md`
(kizuna-ai-lab/sokuji#613 — face-to-face's ears, the participant's voice, `par_tts`); this spec's
branch starts from that one and lands after it.
**Related**: #579 (participant TTS; the switch this spec finally shows), `routingStore.ts`'s
2026-10-01 note (why it was hidden), #614 (`echoCancellation: 'all'`, independent).

## Summary

The Audio page becomes three blocks — **麦克风 → 语音 → 对方音频** — and every switch about spoken
translation moves into **语音**, named by *who hears what* instead of by device:

```
语音 ⓘ
默认播放设备 ⓘ                 [AirPods Pro                       ▾]
对方听到的翻译 ⓘ               [on]    虚拟麦克风 · SokujiVirtualAudio     (read-only in a meeting)
  └ 我也听 ⓘ                   [on]    [跟随默认（AirPods Pro）          ▾]
  └ 原声直通 ⓘ                 [on]    ━━━━●━━━━━━━━━━━  音量 20%
我听到的翻译 ⓘ                 [off]   [跟随默认（AirPods Pro）          ▾]
保留译音以便回放 ⓘ             [off]
```

Each spoken row has its own output device, chosen from a list where every device appears three
times — `A`, `A · 左声道`, `A · 右声道` — plus 「跟随默认」. Face-to-face no longer has an ears block
or a swap button: 对方听到的翻译 and 我听到的翻译 each name a device and a channel (right and left by
default) and carry a 试听 button. **Text Only disappears**: 对方听到的翻译's switch is the same
setting, read the other way. The participant-speech switch, hidden since 2026-10-01, is
我听到的翻译. 原声直通 joins the 对方听到的翻译 group (it, too, is what the other side hears).
保留回放 is the block's last row. Descriptions move into the ⓘ tooltips; only state lines stay
visible.

Under the page, the route table gains **outlets**: instead of one "real" bus for everything the
user hears, the graph has one bus per spoken row — `other` (face-to-face only), `me`, `them` — each
on its own device with its own channel, beside the `virtual` bus the meeting hears. Replay and
preview go to the outlet of the row they belong to.

Out of scope: a volume per row (a row is a switch; passthrough keeps its ratio); listening to
my own translation in face-to-face (我也听 is hidden there); a participant voice per language;
the Others-mode "voice" wizard scenario; dropping 保留回放 for a memory cap (the owner kept the
switch); the LAN viewer and the subtitle window (they do not play audio).

## Decisions

| # | Decision | Owner's ruling (2026-10-10) |
|---|---|---|
| D1 | Blocks | 麦克风 (device, noise suppression) → 语音 → 对方音频 (unchanged: 对方在哪里 + source); the old Output block and the General tab's output switches go |
| D2 | Row names | by who hears: 对方听到的翻译 / 我也听 / 原声直通 / 我听到的翻译 / 保留译音以便回放; never 「译音」 as a noun, never 「会议」 in a label |
| D3 | Where my translation goes in a meeting | a read-only field 「虚拟麦克风 · \<device name\>」 (option a); the real name stays visible so routing can be checked |
| D4 | Row layout | two-line (board 8 column B): line 1 = label + ⓘ … switch at the right edge; line 2 = the parameter, full width, left edge on the label text; captions move into the ⓘ tooltips |
| D5 | Text Only | removed; 对方听到的翻译 = `!textOnly`, same storage key |
| D6 | 原声直通 | a sub-row of 对方听到的翻译, after 我也听 ("this group is what the other side hears"); it leaves the microphone block (#613 put it there) |
| D7 | 保留回放 | the last row of 语音 (option A); not a memory cap |
| D8 | Devices and channels | every spoken row picks its device; each stereo device lists three times (A / A·左声道 / A·右声道); 跟随默认 follows 默认播放设备; the swap button goes |
| D9 | Replay | my translation replays on 我也听's outlet (in face-to-face, 对方听到的翻译's); the other's on 我听到的翻译's; previews play on the row's outlet |
| D10 | Disabled reasons | one line when both 我也听 and 我听到的翻译 are blocked for the same cause; an app source blocks neither |
| D11 | Default device | 默认播放设备 is today's monitor device (same key); its caption moves into its tooltip |
| D12 | 我也听 in Both | allowed unless the other side's source is the whole system (the recapture rule); today it is locked to Me mode |
| D13 | 我听到的翻译 | shown in every mode that runs the participant leg; blocked by the whole-system rule; default on in face-to-face, off elsewhere (§4) |
| D14 | Channel defaults | unset = "auto": face-to-face gives 对方听到的翻译 the right channel and 我听到的翻译 the left; everywhere else both channels (§4) |

D13's and D14's defaults, the popovers of §6.3, and the field text per platform in §7 are the
parts the owner has not ruled on; they are listed again under "Open questions".

## 1. The page

### 1.1 Blocks and rows

**麦克风** — as today's microphone block minus passthrough: the input list with its Off row, and
噪声抑制. (`AudioDeviceSection` with `showMicrophone`, no `children`.)

**语音** — six rows, in this order. "Switch" means the two-line row of D4.

| Row | Control | What it is |
|---|---|---|
| 默认播放设备 | select (devices; no channel entries) | the device every 「跟随默认」 resolves to; today's `selectedMonitorDevice` |
| 对方听到的翻译 | switch + a read-only field (meeting) or a device·channel select + 试听 (face-to-face) | my words, translated and spoken to the other side; `!textOnly` |
| └ 我也听 | switch + device·channel select | the same clips, also on an outlet of mine; today's monitor |
| └ 原声直通 | switch + slider 「音量 N%」 | passthrough, unchanged in meaning; hidden in face-to-face and on the web |
| 我听到的翻译 | switch + device·channel select (+ 试听 in face-to-face) | the other's words, translated and spoken to me; the participant-speech switch |
| 保留译音以便回放 | switch | `keepReplayAudio` |

The ⓘ tooltips (the only descriptions on the page; strings in §6.5):

| Row | Tooltip |
|---|---|
| 默认播放设备 | 未单独指定设备的声音，从这里播放。 |
| 对方听到的翻译 | 我说的话翻译后朗读给对方。送进虚拟麦克风时，对方在自己的软件里把它选作麦克风就能听到。 |
| 我也听 | 我这边也播放一遍对方听到的翻译（是译音，不是我的原声）。 |
| 原声直通 | 把我的原声以较低音量混在译音下面，一起送进虚拟麦克风。最大 60%。 |
| 我听到的翻译 | 对方说的话翻译后朗读给我。 |
| 保留译音以便回放 | 译音留在内存里，每条消息的 ▶ 才能用；长会话会多占内存。 |

**对方音频** — unchanged from #613: 对方在哪里 (when Both and the provider offers face-to-face),
then the source list or the extension's toggle, or the beside note. `ParticipantSpeechSwitch` is
deleted; its switch is 我听到的翻译.

### 1.2 State per mode

"Greyed" = the whole row at 50 %, controls disabled, the mode reason in the title
(`audioPanel.monitorLockedByMode` reworded, §6.5). "Blocked" = disabled with the shared reason
line of D10.

| Row | 我 | 对方 | 两者 · 在线会议 · 整个系统 | 两者 · 在线会议 · 应用 | 两者 · 就在身边 |
|---|---|---|---|---|---|
| 对方听到的翻译 | on/off; field | greyed (my leg does not run) | on/off; field | on/off; field | on/off; device·channel + 试听 |
| 我也听 | on/off | greyed | blocked | on/off | hidden |
| 原声直通 | on/off | greyed | on/off | on/off | hidden |
| 我听到的翻译 | greyed (the other's leg does not run) | on/off, blocked on a whole-system source | blocked | on/off | on/off; device·channel + 试听 |
| 保留译音以便回放 | on/off | on/off | on/off | on/off | on/off |

The whole-system rule is Electron's (`participantSpeechHeard`): the extension's tab and the web's
face-to-face never block. 我也听 and 原声直通 are greyed with their parent when 对方听到的翻译 is off
(there is nothing to hear or mix under). A provider whose `speech` is `'always'` shows
对方听到的翻译 on and disabled with the tooltip 「此服务总是朗读」; `'never'` shows it off and
disabled (no registered provider is either today; the rule stays). During a run every switch and
select stays live — they are routing, applied on the next clip — except 对方听到的翻译 and
我听到的翻译, which the run froze into its shape (`textOnly`, `participantSpeech`): those two lock
with the session-active reason.

Blocked reason line (D10), after 我听到的翻译, with the info icon:
「正在录制整个系统的声音，为避免翻译音频循环，已禁用这些播放选项。」

Face-to-face keeps its headphones hint line after 我听到的翻译 (`faceToFace.speakersHint`).

### 1.3 The device list

Built from `audioMonitorDevices` with the virtual devices filtered as today. Entries, in order:
「跟随默认」, then for each device `A`, `A · 左声道`, `A · 右声道`. The channel entries are offered
for every device: nothing today knows an output's channel count (D of the map), and a mono device
simply hears the pan collapsed. The current value renders as 「跟随默认（AirPods Pro）」 when
following, naming the resolved device; a stored device that is not present renders as
「跟随默认（…）」 too, and the stored id is kept until the user picks again (the same "saved →
current" rule `chooseOutput` applies to the default device).

In face-to-face the two selects also show the channel in their value (「跟随默认 · 右声道」), and
each row's 试听 plays the chime (`earTone`) on that row's outlet.

### 1.4 Simple settings

Same three blocks after the session settings (languages, provider, speech mode), in the same
order, with the same rows (board 6). `OutputToggles` leaves `SessionSettingsGeneral`: the Simple
list and Advanced's General tab lose Text Only and Keep audio for replay.

## 2. Outlets — the model under the page

### 2.1 Types

`src/lib/audio/routes.ts`:

```ts
/** What plays on a route. Replay and preview are not routed (§2.3). */
export type Feed = 'speaker' | 'participant' | 'passthrough';

/** Where it goes: the meeting's virtual microphone, or one of the user's three outlets. */
export type Outlet = 'virtual' | 'other' | 'me' | 'them';

export interface Edge { from: Feed; to: Outlet; gain: number }

/** An outlet's device and channel, resolved (§2.4). `device` undefined: the browser default. */
export interface OutletSink { device?: string; pan?: -1 | 1 }

export interface RoutingSettings {
  meeting: boolean;                                   // unchanged: the dev switch
  faceToFace: boolean;                                // replaces `ears`
  /** The three switches, already gated by mode, source and provider (§4). */
  speak: { other: boolean; me: boolean; them: boolean };
  passthrough: { on: boolean; ratio: number; gate?: 'idle' | 'held' };  // unchanged
  sinks: { virtual?: string; other: OutletSink; me: OutletSink; them: OutletSink };
}
```

`Bus`, `Ear`, `earsFor` and `RoutingSettings.ears/monitor/participantSpeech` go.

### 2.2 The route table

```
face-to-face:  speaker → other      if speak.other
               participant → them  if speak.them
               (no virtual, no me, no passthrough)
otherwise:     speaker → virtual    if meeting && speak.other
               speaker → me        if speak.other && speak.me
               participant → them  if speak.them
               passthrough → virtual  as today (on, ratio, gate, held)
```

Pan is no longer on the edge: it belongs to the outlet (§2.4), so every clip entering an outlet is
panned the same way, replay and preview included.

### 2.3 Replay and preview

`graph.ts` keeps one `<audio>` element per bus, now four at most: `virtual` (Electron only; the
extension's tabs tap and the web's nothing, as today), `other`, `me`, `them`. Each outlet bus is
`GainNode → [StereoPannerNode when pan is set] → MediaStreamAudioDestinationNode → element`, and
`setSinks` switches each element with the same one-at-a-time, 1.5 s-deadline rules as today's
real bus. Two outlets on the same device are two elements on that device; nothing merges them.

Replay (`playback.replay(leg, segment)`) and preview (`playback.preview(clip, outlet)`) connect
straight to an outlet's bus, not through the route table:

| What | Outlet |
|---|---|
| replay of my translation | `me` in a meeting, `other` in face-to-face |
| replay of the other's translation | `them` |
| 试听 on a row | that row's outlet |
| the provider voice preview (`voicePreview.ts`) and the dev test tone | `me` |

A replay plays even when the outlet's switch is off (today's rule: monitor mute does not gate
replay), on the device the row names. The echo reference (`ttsTap`) keeps tapping speaker,
participant and replay before routing.

### 2.4 Sink resolution (`appAudio.readRouting`)

```
default  = audioStore.selectedMonitorDevice?.deviceId        (默认播放设备)
outlet X: device  = outlets[X].device ?? default              (an absent stored device → default)
          channel = outlets[X].channel === 'auto'
                      ? (faceToFace ? (X === 'other' ? 'right' : X === 'them' ? 'left' : 'both') : 'both')
                      : outlets[X].channel
          pan     = left → -1, right → 1, both → undefined
virtual  = findVirtualSpeaker(audioMonitorDevices) on Electron, else undefined   (unchanged)
```

`createAppRouting` subscribes as today (audio, routing, turn mode, the provider entry when
face-to-face flips); the outlet fields live in `audioStore`, so no new subscription.

## 3. Settings and storage

No migration code; an unknown or malformed stored value falls to its default
([memory: no one-time migration code]).

| Setting | Key | Type / default | Change |
|---|---|---|---|
| 默认播放设备 | `audio.selectedMonitorDeviceId` | device id | unchanged |
| 对方听到的翻译 | `settings.common.textOnly` | boolean, `false` | unchanged key; the row shows `!textOnly` |
| 我也听 | `audio.isMonitorMuted` | boolean, `true` (off) | unchanged key; the row shows `!isMonitorMuted` |
| 原声直通 | `audio.isRealVoicePassthroughEnabled`, `audio.realVoicePassthroughVolume` | unchanged | unchanged |
| 我听到的翻译 | `settings.routing.participantSpeech` | `boolean \| null`, `null` (= auto, §4) | now loaded; `PARTICIPANT_SPEECH_SHOWN` deleted |
| 保留译音以便回放 | `settings.common.keepReplayAudio` | boolean, `false` | unchanged |
| outlet device | `audio.outlet.{other,me,them}.device` | device id \| null, `null` | new |
| outlet channel | `audio.outlet.{other,me,them}.channel` | `'auto' \| 'both' \| 'left' \| 'right'`, `'auto'` | new |
| face-to-face swap | `settings.routing.faceToFaceSwap` | — | deleted (orphaned key, never read) |
| meeting (dev) | `settings.routing.meeting` | unchanged | unchanged |

`audioStore` gains `outlets` and `setOutletDevice(name, id | null)` / `setOutletChannel(name, c)`;
`routingStore` drops `faceToFaceSwap` and `PARTICIPANT_SPEECH_SHOWN`, and `setParticipantSpeech`
takes `boolean | null`. `isMonitorMuted`'s legacy derivation from `audio.isMonitorDeviceOn` stays.

## 4. The session shape

`speak` (§2.1) and the run shape's inputs come from one function, `speechFromStores(provider,
platform)` in `appShape.ts`, replacing `participantSpeechFromStores` / `participantSpeechSwitchFromStores`:

```
other = provider.speech === 'always' ? true : provider.speech === 'never' ? false : !textOnly
them  = provider.participantSpeech === false ? false
      : (participantSpeech ?? faceToFace)            // null = auto: on in face-to-face, off elsewhere
        && participantSpeechHeard(platform, sourceId, faceToFace)
me    = !isMonitorMuted && other && !faceToFace && (mode !== 'both' || participantSpeechHeard(...))
```

`textOnly` and `participantSpeech` freeze into `RunShape` at Start as today; `legSpeaks` is
unchanged (`speaker` from `textOnly`, `participant` from the frozen `participantSpeech`). Face-to-face
stops forcing `participantSpeech = !textOnly` (appShape.ts:63): the switch decides, defaulting on.
`effectiveTextOnly` stays for the pair sentence and Local Native's readiness. The balance floor
(`balanceRefusal`, `useBalanceShortfall`) reads `them` for the `par_tts` stream as it reads
`participantSpeech` today.

Setup wizard presets (`scenarios.ts`) gain `participantSpeech`: `two-way-voice` and
`face-to-face-voice` → `true`; `two-way-text` and `face-to-face-text` → `false`; the speaker-only and
`understand-others` presets leave it untouched (`null` stays). `applySetupDraft` writes it with
`setParticipantSpeech`. `providerFitForScenario` and `textOnlyCapabilityOf` are unchanged.

## 5. Conversation surfaces

- **Ear tags** (`ConversationList.earTagOf`): the letter is the channel of the outlet that played
  the clip — L/R when it is `left`/`right`, no tag when `both`. The "not played" mark is unchanged.
- **Ears strip** (`PanelFooter.EarsLegend`): one entry per voiced outlet in face-to-face —
  language, who, the channel letter when set, the resolved device name; it reads the outlets, not
  `earsFor`. Shown in face-to-face only, as today.
- **Replay gate** (`replayGate.ts`): unchanged rules; `MainPanel.onReplay` passes the leg and
  `playback` picks the outlet (§2.3). `replayLegs` reads `speak.them` instead of
  `f2f.speaks.participant`.
- **Karaoke** and the footer's output meter: unchanged (`queues`, the `virtual` bus).
- `useFaceToFace`: `swap`, `me`, `other`, `earsLegend`, `voicedEars` go; `speaks` becomes `speak`
  from §4.

## 6. Components

### 6.1 New: `SpeechOutputSection` (`src/components/Settings/sections/SpeechOutputSection.tsx`)

The 语音 block: id `speech-section`, heading `audioPanel.speechTitle` with ⓘ, the six rows of
§1.1 as two-line rows (one `SettingRow` helper: label, ⓘ with the tooltip, optional switch; then
the parameter line). It binds `settingsStore` (`textOnly`, `keepReplayAudio`), `audioStore`
(`selectedMonitorDevice`, `audioMonitorDevices`, `isMonitorMuted`, `outlets`, passthrough fields,
`mode`, `selectedParticipantSource`), `routingStore.participantSpeech`, `turnModeStore` (the
push-to-translate lock on 原声直通), `useFaceToFace().offered/active` and the provider's `speech`
flags. `VoicePassthroughSection` becomes its 原声直通 sub-row (the slider, its `disabled` form under
push-to-translate). The 试听 buttons call `getAppAudio().playback.preview(earTone(), outlet)`.

### 6.2 Changed

- `AudioDeviceSection`: microphone only; `showSpeaker`, the Output block, the ears block and the
  monitor logic go. `AdvancedSettings` and `SimpleSettings` render 麦克风 → `SpeechOutputSection` →
  `SystemAudioSection`; `Settings.tsx` maps the `speaker` navigation target to `speech-section`
  (`#speaker-section` is gone; the Tour's `monitor` step anchors `speech-section`).
- `OutputToggles` (SpeechSection.tsx:153-206) is deleted; `SessionSettingsGeneral` keeps languages,
  provider and the speech mode.
- `SystemAudioSection`: drops `ParticipantSpeechSwitch`.
- `EarsBlock` is deleted; `OtherSideChoice` stays.
- `LanguageSection.tsx` (unmounted old shell): its Text Only and keep-replay controls stay as they
  are — it is Local Native's until #578 and nothing mounts it.

### 6.3 The mode picker's popover (`ModeDevicePopover`)

Rows per mode (board 7 for 我 and 两者·就在身边; the other two keep today's shape):

| Mode | Rows |
|---|---|
| 我 | 麦克风 (power = mic mute) · 我也听 (device·channel select; power = the switch) |
| 对方 | 对方音频 (as today) · 我听到的翻译 (device·channel; power = the switch; blocked state as §1.2) |
| 两者 · 在线会议 | 麦克风 · 对方在哪里 · 对方音频 — the speech rows are on the page (footer link) |
| 两者 · 就在身边 | 麦克风 · 对方在哪里 · 对方听到的翻译 (device·channel, ▶ 试听) · 我听到的翻译 (device·channel, ▶ 试听) |

The ears block and the swap button leave the popover. A pick in a device·channel row writes the
outlet; it never flips the switch (today's "a pick unmutes" stays only for the microphone).

### 6.4 Telemetry (`telemetry.sessionStartProperties`)

`monitor_device_on` keeps its name (我也听); add `participant_speech` (them) and
`outlet_channels` (`{ other, me, them }` resolved channels). Passthrough fields unchanged.

### 6.5 Strings (30 catalogs)

New keys under `audioPanel.*`: `speechTitle` (语音), `speechTooltip`, `defaultPlayback`,
`defaultPlaybackTip`, `otherHears`, `otherHearsTip`, `otherHearsAlwaysSpeaks` (此服务总是朗读),
`meToo`, `meTooTip`, `passthroughTip` (replaces `realVoicePassthroughDescription`), `passthroughVolume`
(音量 {{percent}}%), `iHear`, `iHearTip`, `keepReplay`, `keepReplayTip`, `followDefault`
(跟随默认), `followDefaultNamed` (跟随默认（{{device}}）), `channelLeft` (左声道), `channelRight`
(右声道), `preview` (试听), `blockedWholeSystem` (the D10 line), `virtualMicField`
(虚拟麦克风 · {{device}}), `virtualMicTabs`, `virtualMicNone` (§7), `lockedByMode` (reworded
`monitorLockedByMode`: 「此行由模式决定」+ the mode name), `speechRowLockedByRun`.

Removed: `simpleConfig.textOnly*`, `simpleConfig.keepReplayAudio*`, `simpleConfig.output*`,
`audioPanel.turnOnMonitor`, `audioPanel.turnOffMonitor`,
`audioPanel.participantSpeech*` (four keys), `audioPanel.realVoicePassthroughDescription`,
`audioPanel.monitorLockedByMode`, `faceToFace.swap`, `faceToFace.earsTitle`, `faceToFace.previewLeft`,
`faceToFace.previewRight`, `modePicker.deviceSpeakerMonitor`, `popover.output`. Kept:
`faceToFace.earLeft/earRight/leftEar/rightEar/legendMe/legendOther/speakersHint/notPlayed/playedLeft/playedRight`,
`audioPanel.realVoicePassthrough`, `audioPanel.realVoiceVolume` (the slider's aria),
`audioPanel.passthroughManagedByPushToTranslate`, everything under `popover.otherSide*`.

The Tour's monitor step text and `settings.participantSectionDescriptionExtension` (which says
"system default output" while the code uses the chosen device) are reworded in the same pass.

## 7. Platforms

| | 对方听到的翻译's field (meeting) | virtual bus | whole-system rule |
|---|---|---|---|
| Electron | 「虚拟麦克风 · \<name\>」, the name the user picks in their meeting app: Linux `Sokuji_Virtual_Mic`, macOS `SokujiVirtualAudio`, Windows `CABLE Output (VB-Audio Virtual Cable)` — from one table beside `findVirtualSpeaker`, not from the device list | a device (`findVirtualSpeaker`) | applies |
| Extension | 「虚拟麦克风 · 会议标签页」 (`virtualMicTabs`) | the tabs tap, unchanged | never blocks |

There is no web build (owner, 2026-10-10): where the graph has no virtual bus the field and
原声直通 are simply not rendered, with no string of their own. The extension's tab passthrough
(`TabAudioRecorder.setSinkId`) keeps using 默认播放设备.

## 8. Tests

Moved or rewritten (from the map's §F): `routes.test.ts` (outlets, the new table, no pan on edges),
`appAudio.test.ts` (sink resolution per outlet, channel auto, `speak`), `graph.test.ts` (four
elements, per-bus pan, sink switching per outlet), `playback.test.ts` (replay/preview by outlet),
`routingStore.test.ts` (`participantSpeech` null/boolean, no swap), `audioStore.test.ts` (outlets
persist, defaults, absent device), `appShape.test.ts` / `shape.test.ts` (`speechFromStores`, the
face-to-face default), `AudioDeviceSection.test.tsx` (mic only), `SpeechSection.test.tsx` (no
OutputToggles), `SystemAudioSection.test.tsx` (no speech switch), `SimpleSettings.order.test.tsx`
and `Settings.highlight.test.tsx` (`speech-section`), `AdvancedSettings.test.tsx` (passthrough in
语音), `ProviderArea.test.tsx`, `ModeDevicePopover.test.tsx` (§6.3 rows), `EarsBlock.test.tsx`
(deleted), `useFaceToFace.test.ts`, `PanelFooter.test.tsx`, `MainPanel.test.tsx`,
`ConversationList.test.tsx` (tags from channels), `applySetup.test.ts` / `scenarios.test.ts`
(`participantSpeech`), `steps.test.ts` (tour anchor), `telemetry.test.ts`,
`useBalanceShortfall.test.tsx`, `SessionControls.test.tsx`, `ParticipantSpeechSwitch.test.tsx`
(deleted), `kizunaParticipantSpeech.test.tsx` (the switch is the row now).

New: `SpeechOutputSection.test.tsx` — the six rows per mode of §1.2 (greyed, blocked, hidden,
locked during a run), the provider `speech` rules, the device list's entries and the 跟随默认
rendering, tooltips present, the 试听 outlet; a render check against boards 1–6 at 450 and 300 px
([memory: settle UI decisions by rendering]).

## 9. Slices

1. **Model.** Outlets in `routes`/`graph`/`playback`/`appAudio`; `audioStore.outlets`;
   `routingStore` changes; `speechFromStores`; replay/preview by outlet; the existing UI mapped onto
   the model (EarsBlock's swap becomes writing the two channels) so the branch stays green.
2. **The page.** `SpeechOutputSection`, the two-line row helper and tooltips, passthrough's move,
   `OutputToggles` gone, Simple/Advanced order, navigation ids, the Tour anchor, strings ×30, the
   render check.
3. **Edges.** The popover rows, `EarsBlock` deleted, ear tags and the ears strip from outlets, wizard
   presets, telemetry, the orphaned keys and `PARTICIPANT_SPEECH_SHOWN` removed, CLAUDE.md.

Each slice merges on its own; slice 1 changes no visible behaviour except that face-to-face's swap
now writes channels.

## Open questions — ruled (owner, 2026-10-10)

1. **我听到的翻译's default (D13).** As proposed: `null` = on in face-to-face, off in a meeting, so
   #613's behaviour (the other person is voiced unless Text Only) survives and meetings stay silent
   until asked.
2. **Channel auto (D14).** As proposed: face-to-face gives the other the right channel and me the
   left; both channels elsewhere. A channel picked in a meeting applies in face-to-face too, and
   the other way round.
3. **Popover rows** for 对方 and 两者·在线会议: as §6.3.
4. **Field text**: the extension's 「虚拟麦克风 · 会议标签页」 and Windows' `CABLE Output (VB-Audio
   Virtual Cable)` stand; there is no web build, so no web wording (§7).
5. **我也听's default**: off, as today (`isMonitorMuted: true`).
