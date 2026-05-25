# Mute Semantics Unification + Popover Redesign — Design

**Date:** 2026-05-23
**Status:** Draft
**Builds on:** `2026-05-23-footer-mode-picker-design.md` (ModePicker / ModeDevicePopover / WaveformStrip already shipped).

## Problem

After the footer mode-picker landed, three issues emerged from real-world use:

1. **`navigateToSettings(null)` bug.** The popover's "Full settings →" link doesn't open the settings panel because `MainLayout.tsx:106-116` does `if (settingsNavigationTarget)` — a null target short-circuits, so the panel stays closed.

2. **Three on/off toggles have inconsistent semantics.** `isInputDeviceOn` is a hybrid (gates speaker client AND pauses mic mid-session); `isMonitorDeviceOn` is pure mute; `isSystemAudioCaptureEnabled` is pure start-gate (no mid-session handler at all — toggling it during a running session silently does nothing). After the mode picker took over "which clients to start", the toggles should be unified as **mute** semantics.

3. **Popover UI is functional but not aligned with the rest of the app.** Native `<select>` device pickers don't match the settings `DeviceList` pattern users see elsewhere ("Off" as the first list option, click-to-select rows).

## Goals

1. The three channel toggles are **mute** controls with a single coherent semantic.
2. Mode and mute toggles are **bidirectionally synced pre-session**, **frozen in-session**.
3. Popover redesigned to match the settings `DeviceList` pattern; collapsible rows so a 3-channel popover doesn't tower.
4. "Full settings →" opens the panel.

## Non-Goals

- No new mode beyond the three scenarios.
- No change to client lifecycle (atomic start/teardown stays).
- No localized strings beyond keys this design adds.

## Design

### Semantic unification: mode (which clients) vs mute (signal flow)

| State | Pre-session meaning | In-session meaning |
|---|---|---|
| `isInputDeviceOn` | "include mic channel in next session" | "pass mic audio to speaker client" (true = unmuted) |
| `isSystemAudioCaptureEnabled` | "include participant channel in next session" | "pass participant audio to participant client" (true = unmuted) |
| `isMonitorDeviceOn` | "play translation through monitor speaker" (always meaningful) | same |

**Pre-session**: mode and toggles are bidirectionally synced via existing derivation:
- `currentMode` derives from `(isInputDeviceOn && selectedInputDevice) || (isSystemAudioCaptureEnabled && selectedSystemAudioSource)` (existing logic — no change)
- Clicking a mode picker segment writes both toggles via `handleModeSwitch` (existing — no change)
- Toggling a single channel in the popover OR settings auto-updates the mode (free, via derivation)

**In-session**: mode is frozen, irrelevant channels' toggles are locked, relevant channels' toggles act as runtime mute.

### `lockedMode` state

`MainPanel.tsx` adds:

```tsx
const [lockedMode, setLockedMode] = useState<FooterMode | null>(null);
// On connectConversation success (before setIsSessionActive(true)):
setLockedMode(currentMode);
// On disconnectConversation (alongside other resets):
setLockedMode(null);

// Mode used by picker + popover:
const effectiveMode = lockedMode ?? currentMode;
```

The picker is given `effectiveMode` and `locked={isSessionActive || isInitializing}`. Today it already gets `currentMode` and the same `locked` prop — only the source switches. The popover similarly reads `effectiveMode` for its mode-relevant channel filtering.

### Participant mid-session mute handler (new)

Currently `isSystemAudioCaptureEnabled` has no mid-session effect. Add one that mirrors `isInputDeviceOn`'s pattern (`MainPanel.tsx:2564` area):

```tsx
useEffect(() => {
  if (!isSessionActive || !participantChannelActive || !audioServiceRef.current) return;
  if (isSystemAudioCaptureEnabled) {
    // unmuted — resume participant capture
    void audioServiceRef.current.resumeParticipantAudioRecording?.();
  } else {
    // muted — pause participant capture (client stays connected)
    void audioServiceRef.current.pauseParticipantAudioRecording?.();
  }
}, [isSystemAudioCaptureEnabled, isSessionActive, participantChannelActive]);
```

`ModernBrowserAudioService` needs two new methods that forward to the active participant recorder's `pauseRecording()` / `resumeRecording()` (sister methods to `pauseRecording()` already on the mic recorder side). If the underlying recorder doesn't have pause/resume, fall back to "stop and restart" (heavier, but only for non-pause-capable backends).

### "Missing device" amber semantic

Today: amber fires when mode picker selected a mode but the required device isn't selected.

Unchanged: muted does NOT count as missing — only "no device selected" triggers amber. The `missingDeviceForMode` memo already uses `selectedInputDevice` / `selectedSystemAudioSource` checks (not the mute toggles) so it's already correct.

### Popover redesign — Option C (collapsible summary rows)

Replace native `<select>` rows with summary rows that expand to inline `DeviceList`-style lists. Mockup at `.superpowers/brainstorm/156272-1779528642/content/popover-redesign.html` (option C).

**Structure per channel row (collapsed):**

```
[icon] [label]                    [current device | "Off"]  [chevron]
```

Click the row → expands a `DeviceList` underneath:

```
  Off                      [indicator if selected]
  Device A                 [indicator]
  Device B                 [indicator]
```

Click a device row → selects + auto-unmutes (writes both the device select action and `setInputDeviceOn(true)`). Click "Off" → mutes (writes `setInputDeviceOn(false)`); device selection is preserved (visible but unselected indicator).

**Mode-relevant filtering** (unchanged from current popover): mode = speaker shows mic + monitor; mode = participant shows participant source (+ extension passthrough); mode = both shows all three.

**In-session**: popover stays openable. Rows for the active mode's channels remain editable (device + mute). Irrelevant channels are not rendered at all (already the case via mode filtering).

**Popover state**: only one row expanded at a time (collapse others on expand). Initial state: all collapsed.

### Component changes

- `ModeDevicePopover.tsx` — rewrite the body to render `PopoverDeviceRow` components per relevant channel.
- New: `PopoverDeviceRow` — collapsible row that owns its own `expanded` state. Props: `{ icon, label, devices, selectedDevice, isOn, onSelectDevice, onMute }`.
- Or inline the row logic in `ModeDevicePopover.tsx` if the component doesn't grow beyond ~60 lines.

### "Full settings →" fix

Two options; pick (a) for minimal scope:

**(a) Pass a non-null target.** Change `navigateToSettings(null)` to `navigateToSettings('participant')` (or the currently active mode's section). Already-working consumer — no other code changes.

**(b) Fix `MainLayout.tsx:106-116`** to open the panel when `settingsNavigationTarget` becomes any non-undefined value (including null). More invasive, affects other call sites.

Use (a). The popover always has a "current mode" context, and the relevant section is the obvious target.

## Affected files

| File | Change |
|---|---|
| `src/components/MainPanel/MainPanel.tsx` | `lockedMode` state, `effectiveMode` derivation, participant mid-session mute useEffect, pass `effectiveMode` to ModePicker + ModeDevicePopover |
| `src/components/MainPanel/ModeDevicePopover.tsx` | Replace `<select>` rows with collapsible DeviceList rows; fix nav link target |
| `src/components/MainPanel/ModeDevicePopover.scss` | New styles for collapsible row + inline DeviceList |
| `src/lib/modern-audio/ModernBrowserAudioService.ts` | Add `pauseParticipantAudioRecording` / `resumeParticipantAudioRecording` forwarding to active participant recorder |
| `src/services/interfaces/IAudioService.ts` | Declare the two new methods |
| `src/lib/modern-audio/BaseAudioRecorder.ts` or per-recorder | Expose pause/resume if not already present (mic recorder may share base) |

## Edge cases

1. **Mute all mid-session** (mode=both, user mutes both relevant channels). Session continues with no audio. Acceptable — user can unmute. No special warning beyond the existing mode picker visual.
2. **Mute irrelevant channel via API** (programmatic only — UI prevents it). The mid-session effect for `isInputDeviceOn` already early-returns if `!speakerChannelActive`. Same guard for the new participant effect.
3. **Switch mode mid-session via state mutation** (not via UI). `effectiveMode` reads from `lockedMode` when session is active, so the picker stays stable. The new derived `currentMode` calculations still fire but don't surface.
4. **`pauseParticipantAudioRecording` not implemented by a recorder backend.** Method should silently no-op (return Promise.resolve()) if the recorder lacks pause. Audio continues to flow — non-fatal degradation. Document.

## Acceptance criteria

- [ ] "Full settings →" link opens the settings panel.
- [ ] Pre-session: clicking a mode picker segment writes both toggles; toggling a channel in the popover auto-updates the picker (existing — confirm not broken).
- [ ] In-session: mode picker is visually locked but still reflects active mode; popover opens normally, only shows relevant channel rows, allows device change + mute toggle.
- [ ] In-session mute of mic stops mic audio flow without disconnecting the speaker client (existing behavior).
- [ ] **NEW**: In-session mute of participant audio stops participant audio flow without disconnecting the participant client.
- [ ] Mute does NOT trigger amber missing-device warning on the picker.
- [ ] Popover rows are collapsed by default; clicking a row expands its DeviceList; opening another row collapses the previous.
- [ ] Selecting "Off" in the device list mutes the channel (sets toggle false) without clearing the prior device selection.
- [ ] Selecting a device unmutes and selects it in one action.
- [ ] 795+ tests still pass.
- [ ] Build clean.

## Out of scope

- Add unit tests for the new collapsible popover (RTL with floating-ui is finicky; covered by manual).
- Localize new strings beyond en (existing flow).
- Save which row was last expanded across sessions (YAGNI).
- Audio recorder pause/resume abstraction beyond what's needed for participant mute.
