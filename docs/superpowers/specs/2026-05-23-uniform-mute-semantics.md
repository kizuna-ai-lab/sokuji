# Uniform Mute Semantics

**Status**: Draft
**Date**: 2026-05-23
**Supersedes (partial)**: `2026-05-23-mute-semantics-and-popover-redesign.md` — extends the popover work with a coherent underlying model.

## Goal

Replace the three legacy "on/off" channel flags (`isInputDeviceOn`, `isMonitorDeviceOn`, `isSystemAudioCaptureEnabled`) and the separate extension "passthrough" channel with one explicit intent field (`mode`) plus three uniform per-channel mute flags. The popover and settings expose **mute / unmute** for every channel; intent (which channels are in scope) is changed only via the mode picker. All references to "off" in channel toggles disappear from the UI and the underlying state.

## Motivation

`isSystemAudioCaptureEnabled` is overloaded across three roles — UI intent (mode formula), session-start gate, and mid-session mute — and they don't compose. Clicking the participant "Off" button pre-session collapses the mode; if the user starts a session with participant off, the participant client is never created, so unmuting mid-session silently fails. The participant waveform also keeps showing live signal when paused because the render loop reads the analyser unconditionally, unlike the mic loop which gates on `isRecording()`.

Mic and monitor have a softer version of the same disease — their "off" toggles also drive intent. Mid-session they happen to land on mute behavior, but the seam shows pre-session (toggling collapses the mode). Cleaning up only participant would leave the same inconsistency lurking in the other two channels and in `currentMode` derivation. Fix it once for all three.

A second inconsistency lives in the participant channel itself: electron and extension expose different controls — electron picks an input source (`selectedSystemAudioSource`), extension picks an output device for passthrough (`participantAudioOutputDevice`) and is modeled as a separate `passthrough` row. Both are aspects of one logical channel and should be presented (and named) as such.

## State Model

`audioStore` exposes:

```
mode: 'speaker' | 'participant' | 'both'
  — single source of truth for which channels are in scope.
  — set ONLY by the mode picker (or migration on first load).
  — default 'speaker'. There is no 'none' mode; if every channel is muted, mode still names the channels whose clients spin up.

isMicMuted: boolean           — default false
isMonitorMuted: boolean       — default true   (matches prior isMonitorDeviceOn=false default)
isParticipantMuted: boolean   — default false
```

Per-channel device fields (renamed for clarity; semantics unchanged from existing fields):

```
selectedInputDevice          AudioDevice | null       — mic
selectedMonitorDevice        AudioDevice | null       — speaker monitor
selectedParticipantSource    AudioDevice | null       — electron only: system audio source to capture
selectedParticipantOutput    AudioDevice | null       — extension only: device to passthrough captured tab audio to
```

`selectedParticipantSource` is the renamed `selectedSystemAudioSource`. `selectedParticipantOutput` is the renamed `participantAudioOutputDevice`. Together they form the participant channel's platform-dependent secondary control. The popover renders one participant row whose expanded device list is whichever of the two is meaningful on the current platform.

The legacy fields are deleted from state, storage, and types:

- `isInputDeviceOn`, `isMonitorDeviceOn`, `isSystemAudioCaptureEnabled`
- `selectedSystemAudioSource`, `participantAudioOutputDevice` (renamed, not deleted)
- The `passthrough` row in the popover is removed (merged into participant row in extension)

Helper selectors:

- `isSpeakerChannelInScope` ≡ `mode === 'speaker' || mode === 'both'`
- `isParticipantChannelInScope` ≡ `mode === 'participant' || mode === 'both'`
- `isMonitorChannelInScope` ≡ `mode === 'speaker'` (monitor stays mutex-excluded from Both)

Consumers migrate to read either `mode` (intent question) or `is*Muted` (signal question), never a hybrid.

## Storage Migration

On store hydration, run once:

1. Read legacy keys `audio.isInputDeviceOn`, `audio.isMonitorDeviceOn`, `audio.isSystemAudioCaptureEnabled`, `audio.selectedSystemAudioSourceId`, plus any extension-side participant-output key.
2. Derive:
   - `mode`: speaker if mic-on-only, participant if participant-on-only, both if both, **speaker if all off** (per "no none mode" rule).
   - `isMicMuted = !legacy.isInputDeviceOn` (defaults to `false`)
   - `isMonitorMuted = !legacy.isMonitorDeviceOn` (defaults to `true`)
   - `isParticipantMuted = !legacy.isSystemAudioCaptureEnabled` (defaults to `false`)
   - `selectedParticipantSource = legacy.selectedSystemAudioSource`
   - `selectedParticipantOutput = legacy.participantAudioOutputDevice`
3. Write new keys (`audio.mode`, `audio.isMicMuted`, `audio.isMonitorMuted`, `audio.isParticipantMuted`, renamed device keys).
4. Delete legacy keys.

After the migration block runs, code never reads legacy keys again. The migration block can be deleted in a follow-up release after a reasonable adoption window.

## Behavior Rules

| Action | Effect |
|---|---|
| Mode picker click on segment X (pre-session) | `mode = X`; for each channel newly in scope, if no device selected auto-pick `devices[0]`; **reset all three mute flags to false** (per the "always start unmuted on mode switch" decision) |
| Mode picker click (in-session) | Locked — only the active segment is clickable, to open the popover |
| Popover "Mute" / "Unmute" toggle on a channel | Flips that channel's `is*Muted` flag only. Never touches `mode`. Available pre- and mid-session. |
| Popover device pick | `is*Muted = false` for that channel + select device |
| Settings audio sections | Same semantics: mute toggle replaces the "device on/off" toggle. Greyed when channel not in scope per `mode`. |
| Session start | For each channel in scope per `mode`: connect client, start recorder. If muted at start, recorder is `record()` then immediately `pause()` so the analyser is wired and unmute mid-session works trivially. |
| Mid-session mute change (mic) | `audioService.pauseRecording()` / `resumeRecording()`. Client stays connected. |
| Mid-session mute change (participant) | `audioService.pauseParticipantAudioRecording()` / `resumeParticipantAudioRecording()`. Client stays connected. On extension this also stops the tab capture, which means the tab's audio reverts to playing through the browser's normal route — it just no longer flows into our participant pipeline. On electron the system audio capture stops the same way. |
| Mid-session mute change (monitor) | `setMonitorVolume(muted ? 0 : 1)`. Connection unchanged. |
| Waveform render | Mic and participant render loops both check `recorder.isRecording()`. When false → render `[0]` (flat). Monitor has no waveform. |
| Mutex (monitor ↔ participant) | Enforced via `mode` only: monitor is implicitly out of scope in `participant` and `both` modes (UI hides the row). No runtime mute mutex needed. |
| `canStartSession` | True iff every in-scope channel has a device selected. Mute state does not block start. |

## UI Changes

### Mode Picker

- No `'none'` segment; the three segments are always one-of-three.
- `currentMode` is read directly from store, not derived from toggle flags. `handleModeSwitch` calls `setMode(target)`.
- Active-segment-clickable-while-locked behavior unchanged.

### Mode Device Popover

- Channel rows: mic → monitor → participant. The `passthrough` row is gone; on extension the participant row's expanded list shows the output devices (`selectedParticipantOutput`); on electron it shows system audio sources (`selectedParticipantSource`). Same row, platform-conditional list.
- Row summary shows: device name when unmuted, **"Muted"** when muted, **"Not selected"** when in scope and no device picked. The string "Off" disappears everywhere.
- Expanded device list shows real devices only — no `Off` pseudo-entry. (Extension previously used the `Off` entry to mean "use default output for passthrough." After the refactor, passthrough has no separate mute concept — pick a device or leave the default selection in place.)
- Each row has a dedicated **Mute / Unmute** action (icon button — placement decided during implementation, kept consistent across rows).
- Picking a device unmutes that row.
- "Missing device" warning fires when a row is in scope and has no device picked, regardless of mute state.

### Settings (AudioDeviceSection, SystemAudioSection)

- Replace the `isDeviceOn` toggle with a mute toggle that flips the corresponding `is*Muted` flag.
- The "this section is locked" greying is driven by `mode` (channel-in-scope check) plus `isSessionActive`, exactly as today — only the label changes.
- The `disabled={isSessionActive || isMonitorDeviceOn}` flag on system audio is replaced by `disabled={isSessionActive}` since the mutex is now intent-only.

## Files Touched (expected)

Implementation files:

- `src/stores/audioStore.ts` — state, actions, selectors, hooks, storage keys, migration, rename of `selectedSystemAudioSource` → `selectedParticipantSource` and `participantAudioOutputDevice` → `selectedParticipantOutput`
- `src/stores/audioStore.test.ts` — refit tests to new state shape
- `src/stores/sessionStore.ts` — `lockedMode` becomes `'speaker' | 'participant' | 'both' | null` (drop `'none'`)
- `src/components/MainPanel/MainPanel.tsx` — replace `currentMode` derivation with store read; `handleModeSwitch` calls `setMode`; mute-watch effects switch to the new flags; participant render loop gates on `recorder.isRecording()`; `shouldCaptureParticipantAudio` keys on intent only
- `src/components/MainPanel/ModePicker.tsx` — no `'none'` rendering; otherwise unchanged
- `src/components/MainPanel/ModeDevicePopover.tsx` — row UI: mute button per row, summary text, expanded list without `Off` entry, drop separate `passthrough` row, conditional source-vs-output list inside participant row
- `src/components/Settings/sections/AudioDeviceSection.tsx` — mute-toggle UI; read `mode` for scope check
- `src/components/Settings/sections/SystemAudioSection.tsx` — mute-toggle UI; drop monitor-mutex `disabled`; rename to participant-section semantics
- `src/components/Settings/sections/LanguageSection.tsx` — `isSystemAudioCaptureEnabled` → `isParticipantChannelInScope`
- `src/components/Settings/sections/ProviderSection.tsx` — same
- `src/components/Settings/SimpleSettings/SimpleSettings.tsx` and `AdvancedSettings.tsx` — `lockMic`/`lockParticipant`/`lockMonitor` formulas read `mode`
- `src/services/interfaces/IAudioService.ts` — confirm `pause/resumeParticipantAudioRecording` and `pauseRecording/resumeRecording` are stable; add `resumeRecording` (mic) if it doesn't already exist with that name
- `src/lib/modern-audio/ModernBrowserAudioService.ts` — ensure mic side has a `resumeRecording` mirror of `pauseRecording`, and the participant pause hook works when the recorder was started already-paused

i18n:

- `src/locales/en/translation.json` and friends — new keys `popover.mute`, `popover.unmute`, `popover.muted`, `settings.muteChannel`; remove obsolete strings.

## Out of Scope

- The real-voice passthrough feature (`isRealVoicePassthroughEnabled`, `voicePassthroughVolume`) is unrelated to extension's tab-audio passthrough output and is left alone.
- Mode picker visual design — unchanged.
- Mode picker mid-session unlock behavior — unchanged.
- Per-channel volume control — not a goal.

## Acceptance

A session is verified by four scenarios:

1. **Pre-session, all muted** — open the app, switch to Both mode, mute all three rows in popover, start the session. Clients for both directions connect; no audio flows. Unmuting any row mid-session causes that channel's translation to begin. Re-muting it pauses cleanly.
2. **Mode switch with all muted** — confirm switching never falls through to a `'none'` state, the picker always has an active segment, and the mute flags reset to false on each mode change.
3. **Mid-session waveform parity** — mute mic during a session: mic waveform goes flat. Mute participant during a session: participant waveform goes flat. Unmute either: waveform resumes live signal within one frame.
4. **Platform parity for participant** — on extension, the participant row's expanded list shows output devices and the mute toggle works the same as on electron. Muting on extension stops the tab capture (tab audio plays via the browser's default route); unmuting restores capture and the selected passthrough output device.

## Risks

- **Migration correctness** — users with `isSystemAudioCaptureEnabled=true` but no selected source today will land in a state where `mode` includes participant but no device is picked; `canStartSession` will block them and the popover will show the missing-device warning. Correct behavior, small UX regression for that population. Acceptable.
- **Extension passthrough behavior change** — today, passthrough plays whenever a device is selected, regardless of any "mute"-equivalent state. After the refactor, muting participant also stops the tab capture entirely: the tab's audio reverts to the browser's default output route (so the user still hears the tab normally) but it no longer reaches our selected passthrough output device or the participant client. Users who relied on routing tab audio to a non-default device without translating will see the route change on mute. Acceptable per the unified-mute design.
- **In-flight worktree state** — earlier commits on `docs/symmetric-channel-spec` introduced helpers (`setMonitorDeviceOn`, `setSystemAudioCaptureEnabled` actions, etc.) that this spec deletes. The plan should fold cleanup into the same commits so no half-renamed symbols leak.
- **Test churn** — `audioStore.test.ts` and any component tests that poke the old flags will all need rewriting. Tests should drive the implementation (TDD) so this is also a verification surface.
- **Field renames are noisy** — `selectedSystemAudioSource` and `participantAudioOutputDevice` rename across many files. The plan should sequence the rename as one mechanical pass before behavioral changes, so review diffs stay readable.
