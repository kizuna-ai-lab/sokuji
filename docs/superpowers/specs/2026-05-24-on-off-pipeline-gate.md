# On/Off Pipeline Gate

**Status**: Draft
**Date**: 2026-05-24
**Builds on**: `2026-05-23-uniform-mute-semantics.md` (extends the model; doesn't supersede)

## Goal

Replace "Mute" UI semantics with explicit On/Off, drop participant device selection on both platforms, change mute behavior from recorder-pause to callback-level pipeline gating so passthrough continues on Extension regardless of on/off state, and listen for system default device changes so Extension passthrough follows the OS default.

## Motivation

Three problems converge:

1. **Bug found in Task 11 acceptance**: switching to Participant mode displays a "configure devices" warning until the Settings page is mounted — because `isSystemAudioSourceReady` is only set true by `refreshSystemAudioSources`, which gates connect on `!isParticipantMuted` (legacy "off = disconnect" leakage), and is only re-triggered when `SystemAudioSection` mounts. Store state depends on a UI component's mount lifecycle.

2. **"Mute" word doesn't match the model**. After the uniform-mute refactor, the toggle is a pipeline gate — it stops data entering our processing pipeline, not the world. On Electron the system audio plays through the OS regardless; on Extension passthrough plays through a chosen output regardless (in principle). Calling this "Mute" suggests silence-everywhere, which is misleading.

3. **Participant device selection is performative**. On Electron `listSystemAudioSources()` always returns a single hardcoded entry (`'desktop-audio-loopback'` — verified in `pulseaudio-utils.js:269`, `windows-audio-utils.js:230`, `macos-audio-utils.js:261`). On Extension the device list is the passthrough output, which most users want at system default. The list takes screen real estate for a choice that is functionally meaningless (Electron) or rarely exercised (Extension).

## State Model

After this change, `audioStore` exposes:

```
mode: 'speaker' | 'participant' | 'both'           — unchanged
isMicMuted: boolean                                  — unchanged (field name retained; UI labels switch to On/Off)
isMonitorMuted: boolean                              — unchanged
isParticipantMuted: boolean                          — unchanged

selectedInputDevice: AudioDevice | null              — unchanged
selectedMonitorDevice: AudioDevice | null            — unchanged
audioInputDevices: AudioDevice[]                     — unchanged
audioMonitorDevices: AudioDevice[]                   — unchanged
```

Removed entirely from store:
- `selectedParticipantSource` + setter + hooks
- `selectedParticipantOutput` + setter + hooks
- `systemAudioSources` + setter
- `isSystemAudioCaptureActive` + setter + hooks
- `isSystemAudioSourceReady` + setter + hooks
- `refreshSystemAudioSources` action

Removed storage keys:
- `audio.selectedSystemAudioSourceId`
- `audio.selectedParticipantAudioOutputDeviceId`

The legacy on-disk keys above are left to sit (harmless residue); they're never read.

Internal field naming (`is*Muted`) is kept. Renaming to `is*Off` or `is*Enabled` would churn many call sites for no behavioral gain. The fields are internal; the UI labels are what users see.

## Acquisition Lifecycle (Option C-1)

```
Pre-session:
  No system audio acquired. Mode picker mutations and on/off toggles are pure state changes.

Session start (if mode ∈ {participant, both}):
  Electron:
    permissionGranted = await audioService.requestLoopbackAudioStream()
    if (!permissionGranted) → surface error in LogsPanel; skip participant
    await audioService.connectSystemAudioSource('desktop-audio-loopback')
  Extension:
    tab capture acquired by existing tabAudioRecorder.begin() flow.
  Create participant client.
  Start recorder. Recorder runs continuously for the whole session.

Mid-session on/off toggle (any channel):
  Callback-level gate — see "Pipeline Gating" section.
  No recorder pause/resume calls.

Session end:
  Electron: await audioService.disconnectSystemAudioSource()
  Extension: existing tabAudioRecorder.end()
```

## Pipeline Gating

Critical architectural change from the prior uniform-mute work: mute used to call `pauseRecording()` / `pauseParticipantAudioRecording()`. Under this spec it does not. Instead the per-frame audio callback reads the current `is*Muted` flag and skips `client.appendInputAudio(data)` when muted.

The callback closure should read fresh state each invocation:

```typescript
const callback = (data: { mono: Int16Array; raw: Int16Array }) => {
  if (useAudioStore.getState().isParticipantMuted) return;
  client.appendInputAudio(data.mono);
};
```

(Or via a ref kept in sync with React state, if that style is preferred in the file. Either works.)

Consequences:

- **Extension passthrough plays continuously** because `handlePassthroughAudio` is called from inside the recorder callback ahead of the AI-client send and is not gated.
- **Waveform** stays as Task 5 wired it: render loop checks `is*Muted` and renders `[0]` when true. No change needed.
- **CPU**: worklet keeps processing while muted. Cost is small (single 20ms chunk every frame); accept as tradeoff for the uniform model and passthrough continuity.
- **Worklet pause/resume helpers** (`pauseRecording`, `resumeRecording`, `pauseParticipantAudioRecording`, `resumeParticipantAudioRecording`) become dead code for the in-session mute path. They can be retained for session-end / device-switch paths or removed; spec defers to plan/implementation.

The three Task-5 mid-session effects in `MainPanel.tsx` (mic at ~2607, participant at ~2692, monitor at ~3003) get reworked:
- Mic + participant: removed entirely (callback gate replaces them).
- Monitor: unchanged (it already uses `setMonitorVolume(muted ? 0 : 1)` which is intrinsically pipeline-gate).

## Device-Change Listener (Extension Only)

When the system default output device changes (user plugs in headphones, removes them, switches in OS settings), Extension passthrough should follow.

Add to the audio service initialization (Extension branch only):

```typescript
navigator.mediaDevices.addEventListener('devicechange', () => {
  // Re-apply the default sink so passthrough output follows OS default.
  this.passthroughAudioContext?.setSinkId?.('default')
    .catch(err => console.warn('[Sokuji] Failed to re-apply default sink:', err));
});
```

Remove the listener on service teardown.

Electron has no `setSinkId` needs — system audio routes through OS naturally.

## UI

### Mode Device Popover (`ModeDevicePopover.tsx`)

Three rows: mic, monitor, participant.

**Row layout (all rows)**:
- Channel icon
- Channel label (e.g., "Microphone")
- Status text: `<device name> · On` when on; `Off` when off. For participant: subtitle replaces device name (see below).
- On/Off icon toggle button (replaces current mute button; aria-label changes)
- Chevron — mic + monitor only

**Participant row specifics**:
- No expand, no device list, no chevron.
- Subtitle (in place of device name):
  - Electron: "All system audio" (i18n: `popover.participantSubtitleElectron`)
  - Extension: "Plays via system default" (i18n: `popover.participantSubtitleExtension`)

**Toggle button**:
- Icon: a power icon (e.g., `Power` from lucide-react) or `ToggleLeft` / `ToggleRight`. Implementation picks the most legible option.
- `aria-pressed={!is*Muted}` (true when on)
- `aria-label`: `popover.toggleOn` or `popover.toggleOff` interpolated with the channel label

**Summary text styling**: keep the existing `--off` / neutral CSS class pattern; just update the text content (`Off` instead of `Muted`).

### Settings — Audio (`AudioDeviceSection.tsx`)

No structural change. Relabel toggle aria/title strings from mute-vocabulary to on/off-vocabulary. Behavior unchanged.

### Settings — Participant (`SystemAudioSection.tsx`)

Substantially gutted. The new section is:

- Section heading: existing "System audio" or rename to "Participant audio"
- Explanatory text per platform (matches popover subtitles)
- Single On/Off toggle bound to `isParticipantMuted`
- Disabled when `isSessionActive` (session locks settings)
- No refresh button, no source picker, no output picker

The platform branches (`isElectron()` vs `isExtension()`) collapse to just selecting the explanatory subtitle.

The `WarningModal` / `screen-recording-denied` flow currently triggered by `handleSystemAudioSourceSelect` is preserved but moved: it now fires when the user toggles On (which triggers the permission check inside the store/service, lazily — or at session start, where the same warning surfaces). The exact placement is an implementation detail; the spec requires only that the warning still appears when permission is needed.

## i18n

Add (English):
- `popover.statusOn` → "On"
- `popover.statusOff` → "Off"
- `popover.toggleOn` → "Turn on {{label}}"
- `popover.toggleOff` → "Turn off {{label}}"
- `popover.participantSubtitleElectron` → "All system audio"
- `popover.participantSubtitleExtension` → "Plays via system default"
- `settings.participantSectionHeader` → "Participant audio"
- `settings.participantSectionDescriptionElectron` → "Translate audio from any application playing on this system."
- `settings.participantSectionDescriptionExtension` → "Translate audio from the active browser tab. The original audio plays through your system default output."

Remove (now unused — verify with grep before deleting):
- `popover.mute`, `popover.unmute`, `popover.muted`
- `popover.deviceParticipantSource`, `popover.deviceParticipantOutput`
- Any `popover.notSelected` references that were participant-only
- `SystemAudioSection` keys related to source list / refresh button / output selection

## Acceptance Scenarios

1. **Switch-to-Participant works immediately**: cold start, switch to Participant mode. No "configure devices" warning appears. Start button enabled. (Fixes the bug from Task 11.)

2. **Cold start, Speaker mode, never open settings, then start session in Speaker**: capture stream is NOT acquired pre-session, no permission prompts, session starts cleanly.

3. **Cold start, switch to Participant, start session (Electron, macOS first run)**: macOS shows screen-recording permission prompt at session start. User grants. Session connects. Participant client receives audio.

4. **Mid-session toggle (Extension, with passthrough audible)**: start a session in Participant or Both mode. Tab audio plays through system default output (passthrough). Toggle participant Off in popover. Translation stops. **Passthrough continues to play.** Waveform goes flat. Toggle On → translation resumes.

5. **Mid-session toggle (Electron)**: same as above but on Electron. Translation stops/starts. System audio plays through OS independently (always did).

6. **System default output changes mid-session (Extension)**: user changes OS default output (plug headphones / change in OS settings). Passthrough output follows within ~one frame. No re-acquire needed (the existing `AudioContext` re-applies `setSinkId('default')` via the `devicechange` listener).

7. **Settings reflect popover**: opening settings while a session is active shows the same On/Off state as the popover. Toggle in either place updates the other.

## Risks

- **Callback-level gating relies on a one-shot read of `useAudioStore.getState()`** inside the audio callback. If the store API changes, the callback closure could go stale. Mitigated by using `getState()` per invocation (always fresh) rather than capturing the value in the closure.
- **Worklet running while muted** has measurable but small CPU cost. Validated by spec authors as acceptable for the uniform model + passthrough continuity. If observed CPU regression in practice, revisit by reintroducing pause for channels that have no passthrough analogue (mic-only optimization).
- **`devicechange` listener fires aggressively on some platforms** (every keyboard/USB plug). Listener is cheap (one async `setSinkId` call); should not be a problem, but worth monitoring.
- **Storage residue**: legacy keys (`selectedSystemAudioSourceId`, `selectedParticipantAudioOutputDeviceId`) remain in user storage indefinitely. Harmless but not cleaned up.
- **`screen-recording-denied` warning placement** — must verify the existing modal still surfaces when permission denied. The flow that triggered it (`handleSystemAudioSourceSelect` on Electron) is being removed; the equivalent trigger needs to fire at session start (where `requestLoopbackAudioStream()` returns false) OR when the user first toggles On in settings.

## Out of Scope

- Real-voice passthrough (`isRealVoicePassthroughEnabled`) is a separate feature, untouched.
- Mode picker structure / segments — unchanged.
- `lockedMode` and session-locked settings behavior — unchanged.
- Speaker channel mute (mic, monitor) implementation details — only the UI label changes.

## Notes for Implementation

- The Task-10-era `setMonitorMuted` and `setParticipantMuted` mutex code was removed per the original spec's "intent-only mutex" rule. No mutex reintroduced here.
- The `audioStore.ts:245` mute-gate fix that was queued from in-flight debugging is moot — that code path is being removed.
- The plan should sequence the removal of store fields/actions before consumer migration, then the UI changes, with the device-change listener as a separate task.
