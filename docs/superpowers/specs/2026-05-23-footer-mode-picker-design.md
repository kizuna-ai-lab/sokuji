# Footer Mode Picker & Three-Waveform Display — Design

**Date:** 2026-05-23
**Status:** Draft
**Scope:** Replace the footer's three device icons with a Segmented Mode Picker. Add a re-click popover that exposes mode-relevant device configuration directly from the footer. Show the user's mic, participant audio, and translation output as up to three waveforms in advanced mode, with the visible set driven by the active mode.

**Builds on:** `docs/superpowers/specs/2026-05-22-symmetric-channel-architecture-design.md` (channel-state derivation, per-channel active flags, participant icon, settings reorder). This spec **supersedes** the original footer-icon UX from that design — the icons are removed and replaced by the picker.

## Problem

After the symmetric-channel rollout users still can't tell which of the three scenarios they're in from the main panel:

- **Display:** The footer shows three independent device-active icons (mic, participant, speaker). Users have to mentally combine the icon states into a scenario name. The mode is implicit, not stated.
- **Switch:** Toggling channels requires opening the settings panel, scrolling to the right section, and flipping a toggle. The mode switch entry is buried.

The product treats "scenario 1 / 2 / 3" as first-class concepts but the UI doesn't. We need explicit mode display and a one-click switch path on the main panel.

## Goals

1. The active mode is stated explicitly on the main footer, in one glance.
2. Switching modes is one click on the footer, pre-session.
3. Device configuration for the selected mode is one additional click (re-click the active segment).
4. Advanced mode visualizes all three audio streams (mic input, participant input, translation output) when relevant — exactly the streams the active mode uses.
5. In-session: picker becomes a display-only readout; channel composition stays locked.
6. No regression on the channel-architecture invariants from the prior spec (atomic teardown, Kizuna-AI savings in participant-only mode, etc.).

## Non-Goals

- No change to the underlying channel architecture (`speakerWillStart` / `participantWillStart` / `anyChannelWillStart` predicates and per-channel active flags stay as-is).
- No change to the mutual-exclusivity warning between speaker output and system-audio capture on Electron.
- No new mode beyond the three scenarios.
- No mid-session mode switching (locked composition is intentional).
- No change to the Onboarding flow (handled separately).
- No second-pass on i18n strings beyond the new keys needed for this redesign.
- No change to participant client behavior (still text-only, semantic VAD).

## Mode definitions

A **mode** is derived from the existing channel-enable predicates:

| Channel state | Mode label | Mode key |
|---|---|---|
| `speakerWillStart && !participantWillStart` | "我" / "You" | `speaker` |
| `!speakerWillStart && participantWillStart` | "参会者" / "Participants" | `participant` |
| `speakerWillStart && participantWillStart` | "双向" / "Both" | `both` |
| `!speakerWillStart && !participantWillStart` | (none — no mode active) | `none` |

The picker has three segments only. The `none` state corresponds to "no segment is highlighted" and is the trigger for the disabled-Start tooltip ("Enable mic or participant audio").

## Design

### Component 1: ModePicker

A presentational component rendered in the footer.

**Props:**
- `mode`: `'speaker' | 'participant' | 'both' | 'none'` — derived from store state by the caller
- `locked`: `boolean` — true during a session (and during init); disables click handlers
- `missingDeviceForMode`: `'speaker' | 'participant' | 'both' | null` — flags a segment with amber warning when a switch to that mode would land in a misconfigured state
- `onModeClick`: `(target: 'speaker' | 'participant' | 'both') => void` — fired when a non-active segment is clicked, or when the active segment is clicked (caller decides whether to switch or open popover)

**Visual:**
- Segmented control: three pills in a single rounded container
- Active segment: solid `#10a37f`, white text, bold
- Inactive segment: subtle hover (`#333` bg)
- Locked: 60% opacity, cursor not-allowed; active segment retains `#555` solid bg
- Warning segment: amber outline (`1px solid #f59e0b` inset)

**Interaction:**
- Click on inactive segment → fires `onModeClick(target)`; caller writes the corresponding toggle state to the audio store
- Click on active segment → also fires `onModeClick(target)`; caller opens the popover (see Component 2)
- Locked: no click handler fires

### Component 2: ModeDevicePopover

A floating popover anchored to the active segment, opened by re-clicking the active segment. Uses `@floating-ui/react` (already a project dependency, used by `Tooltip` and `DisplaySettingsPopover`).

**Props:**
- `mode`: `'speaker' | 'participant' | 'both'` — determines which device rows render
- `anchorEl`: `HTMLElement | null` — element to anchor floating UI to
- `open`: `boolean`
- `onClose`: `() => void`

**Contents per mode:**

| Mode | Rows shown |
|---|---|
| `speaker` | Mic device picker • Speaker monitor device picker |
| `participant` | Participant audio source picker • (extension only) Original audio passthrough device |
| `both` | Mic device picker • Participant audio source picker • Speaker monitor device picker |

**Common footer row:** "完整设置面板 →" link that calls `navigateToSettings(null)` to scroll to the SimpleSettings panel (open if not already open).

**Visual:**
- Dark popover card matching the project's `Tooltip` palette
- Header: small uppercase label "[Mode] 模式所需设备" / "[Mode] mode devices"
- Each row: 14×14 icon + label (left) + current device name dropdown (right)
- Dropdown trigger: same compact pattern as `DeviceList` shorthand
- Unset/unavailable device: amber italic placeholder ("Not selected" / "未选择")
- Click outside or Escape closes; `useDismiss` from floating-ui

**Why a popover and not a dialog:** the change is small (1–3 dropdowns), the user wants to stay in the main view, and the popover dismisses the moment they pick a device. A modal would be heavyweight.

### Component 3: WaveformStrip

A presentational wrapper around a single canvas + its label, ready to be placed by the footer layout.

**Props:**
- `kind`: `'mic' | 'system' | 'output'` — picks color and label
- `canvasRef`: ref forwarded to the canvas DOM node (the existing visualization loop in MainPanel writes here)
- `width`: `'full' | 'half'` — `full` = 110px / max 140px; `half` = 50px (used when mic and sys are both visible in `both` mode)

**Visual:**
- 26-32px tall (advanced only — basic mode does not render waveforms)
- Background tinted by kind: blue (mic), amber (system), green (output)
- Small uppercase label inside the canvas (top-left corner) — `mic` / `sys` / `out`

The new canvas is `system` — capturing the participant audio input. Existing `clientCanvasRef` (mic input) and `serverCanvasRef` (translation output) are reused. A new `systemCanvasRef` is added.

### Footer layouts (A2H + center buttons + right metadata)

The unified structure across basic and advanced — advanced just adds waveforms on either side of the central action cluster. Picker is always left of the waveforms, anchored to the status dot. Buttons are centered between two flex spacers. Language pair and duration form a metadata cluster on the far right.

**Basic mode footer** (no waveforms — pre-session and in-session differ only by what's shown in the button slot and metadata):

```
Pre-session:
[dot] [ModePicker] · · · [PTT*] [Start] · · · [lang-pair]

In-session:
[dot] [ModePicker (locked)] · · · [PTT*] [Stop] · · · [lang-pair] [duration]
```

**Advanced mode footer** — mode-aware waveform set, mirror layout for input vs output:

```
mode = speaker:
[dot] [ModePicker] [mic-wf]                 · · · [PTT*] [Stop] · · · [out-wf] [lang-pair] [duration]

mode = participant:
[dot] [ModePicker] [sys-wf]                 · · ·         [Stop] · · · [out-wf] [lang-pair] [duration]

mode = both:
[dot] [ModePicker] [mic-wf-½] [sys-wf-½]   · · · [PTT*] [Stop] · · · [out-wf] [lang-pair] [duration]

mode = none (pre-session only):
[dot] [ModePicker]                          · · ·         [Start (disabled)] · · · [lang-pair]
```

Rules:
- `· · ·` = `flex: 1` spacer
- `PTT*` only renders when `mode ∈ {speaker, both} AND canHoldToSpeak AND speakerChannelActive` (existing logic). When absent, the right spacer absorbs the freed space — Start position stays centered.
- `lang-pair` is always clickable to `navigateToSettings('languages')`. `duration` only renders when `isSessionActive`.

**Waveform width rule (the "H" in A2H):**

When mic and sys are both visible (mode = both), each shrinks so their **combined width ≈ out-wf width**. Concrete spec:

| Waveform | Width when alone in its slot | Width when sharing with another input |
|---|---|---|
| `mic-wf` | 110px (flex-basis, max-width 140px) | 50px (`mic-wf-½`) |
| `sys-wf` | 110px | 50px (`sys-wf-½`) |
| `out-wf` | 110px (always alone — there is only one output channel) | — |

Rationale: keeps the visual "weight" of the input side equal to the output side regardless of mode. The two inputs are conceptually one unit ("what the system is hearing"); the single output is the result. Total footer width is also more stable across mode changes.

Pre-session, the waveform set animates in/out (CSS transition on opacity + width) when mode changes. In-session the layout is stable (composition is locked).

### State & glue logic

**Derived state added to MainPanel (or co-located helpers):**

```ts
const currentMode: 'speaker' | 'participant' | 'both' | 'none' = useMemo(() => {
  if (speakerWillStart && participantWillStart) return 'both';
  if (speakerWillStart) return 'speaker';
  if (participantWillStart) return 'participant';
  return 'none';
}, [speakerWillStart, participantWillStart]);
```

**Mode switch handler (writes to audio store toggles):**

```ts
const handleModeSwitch = (target: 'speaker' | 'participant' | 'both') => {
  // The audio store actions are already exposed:
  //   toggleInputDeviceState, toggleSystemAudioCapture (or set variants)
  // We need set-style actions (force on/off) — add to audioStore if not present.
  const wantSpeaker = target === 'speaker' || target === 'both';
  const wantParticipant = target === 'participant' || target === 'both';
  setInputDeviceOn(wantSpeaker);
  setSystemAudioCaptureEnabled(wantParticipant);
};
```

**Popover trigger logic:**

```ts
const handleSegmentClick = (target) => {
  if (target === currentMode) {
    setPopoverOpen(true);                // re-click active → open popover
  } else {
    handleModeSwitch(target);
    setPopoverOpen(false);
  }
};
```

**Missing-device-for-current-mode:**

```ts
const missingDeviceForMode: 'speaker' | 'participant' | 'both' | null = useMemo(() => {
  if (currentMode === 'none') return null;
  const needSpeaker = currentMode === 'speaker' || currentMode === 'both';
  const needParticipant = currentMode === 'participant' || currentMode === 'both';
  const hasSpeaker = isInputDeviceOn && !!selectedInputDevice;
  const hasParticipant = isSystemAudioCaptureEnabled && (
    isExtension() || (selectedSystemAudioSource && isSystemAudioSourceReady)
  );
  if (needSpeaker && !hasSpeaker) return 'speaker';
  if (needParticipant && !hasParticipant) return 'participant';
  return null;
}, [currentMode, isInputDeviceOn, selectedInputDevice, isSystemAudioCaptureEnabled, ...]);
```

In practice this is mostly redundant with the existing `*WillStart` predicates because `currentMode` is itself derived from them — but a switch attempt that *would have* turned a toggle on while no device is selected can leave `selectedInputDevice` unset. The mode picker's amber warning surfaces this state.

### System audio waveform capture

The participant client already receives system audio via `ParticipantRecorder` / `TabAudioRecorder`. We need to tap that data stream for visualization without interfering with the client's audio pipeline.

**Approach:** add a Web Audio `AnalyserNode` in the participant capture path. The recorder's existing audio routing splits into:

```
captured source → existing pipeline → participant client
              → AnalyserNode → WavRenderer (writes to systemCanvasRef)
```

This mirrors the mic side, where `audioServiceRef.current.getRecorder()` already exposes an analyser used to drive `clientCanvasRef`.

**File changes:**
- `ParticipantRecorder.ts` / `TabAudioRecorder.ts` (or `IParticipantAudioRecorder.ts`): add a `getAnalyser(): AnalyserNode | null` method
- `MainPanel.tsx`: in the existing render loop that drives mic/output canvases, also drive `systemCanvasRef` when `participantChannelActive` is true and the analyser is available

The render loop is the existing `requestAnimationFrame` driver — no new loop, no new perf cost beyond one extra `analyser.getByteTimeDomainData()` per frame.

### Removal of existing footer device icons

These elements from `MainPanel.tsx` are deleted:

**Basic mode footer** (currently approximately lines 3120-3155 of the post-channel-spec MainPanel):

```tsx
<span className="device-icon ... mic">...</span>
<span className="device-icon ... participant">...</span>   ← added by Task 7 of previous spec
<span className="device-icon ... speaker">...</span>
```

**Advanced mode footer** (currently approximately lines 3196-3240):

```tsx
<div className="input-viz">[mic icon + canvas]</div>
<div className="participant-viz">[participant icon]</div>   ← added by Task 8 of previous spec
<div className="output-viz">[canvas + speaker icon]</div>
```

The mic icon (basic and advanced), speaker icon, and participant icon (both modes) are removed entirely. The canvases stay but move into `WaveformStrip` components arranged per the new layout.

`navigateToSettings('microphone' | 'speaker' | 'participant')` call sites in the deleted icon JSX are also removed. The popover's "完整设置面板 →" link takes over the navigation role.

### i18n strings

New keys (`src/locales/en/translation.json`):

```json
"modePicker": {
  "modeYou": "You",
  "modeParticipants": "Participants",
  "modeBoth": "Both",
  "switchDisabled": "Mode is locked during a session.",
  "missingDevice": "Configure devices for this mode to start.",
  "popoverHeader": "{{mode}} mode — devices",
  "popoverFooter": "Full settings →"
}
```

Default Chinese fallback strings shipped inline at call sites for development. Other languages picked up via existing i18n flow over time.

### Mode label text — internal vs displayed

Internally `mode: 'speaker' | 'participant' | 'both'` is the canonical machine value. The displayed label is i18n-driven (English: "You / Participants / Both"; Chinese: "我 / 参会者 / 双向").

Analytics from the previous spec already records `channels: ['speaker' | 'participant']` — no change needed.

### Mutual exclusivity warning (Electron speaker out ↔ system audio capture)

When the user picks `both` and that activates a state that would trigger the existing mutual-exclusivity warning, the existing warning modal (`mutual-exclusivity-speaker`) still fires. The picker doesn't bypass it. Users may need to disable speaker monitor before starting `both`.

This stays as-is for this spec. Future work: smarter detection (e.g., allow `both` with headphones).

### Tooltip / hint behavior

- Hover an inactive segment: tooltip "Switch to [mode]" (or "[mode] (currently configured)").
- Hover the active segment: tooltip "Click to configure devices".
- Hover the active segment when locked: tooltip "Mode is locked during a session."
- Hover a segment with amber warning: tooltip "Select a [mic/participant source] to use this mode."

These map to the strings in `modePicker.*`.

## Affected files

| File | Change |
|---|---|
| `src/components/MainPanel/MainPanel.tsx` | Remove footer device icons (basic + advanced). Add ModePicker, popover state, currentMode/missingDevice memos, system canvas ref, mode-aware waveform layout. |
| `src/components/MainPanel/MainPanel.scss` | Remove device-icon footer styles. Add segmented-control styles. Add waveform-strip styles. Update advanced footer flex layout to mode-aware. |
| `src/components/MainPanel/ModePicker.tsx` (new) | Segmented picker presentational component. |
| `src/components/MainPanel/ModeDevicePopover.tsx` (new) | Mode-relevant device config popover. |
| `src/components/MainPanel/WaveformStrip.tsx` (new) | Canvas + tinted background + label. |
| `src/stores/audioStore.ts` | Add `setInputDeviceOn(boolean)` and `setSystemAudioCaptureEnabled(boolean)` set-style actions (replaces toggle-only API for picker use; keep toggles for backwards compatibility). |
| `src/lib/modern-audio/ParticipantRecorder.ts` `/TabAudioRecorder.ts` `/IParticipantAudioRecorder.ts` | Expose `getAnalyser()`. |
| `src/lib/modern-audio/ModernBrowserAudioService.ts` | Pass through `getParticipantAnalyser()` accessor. |
| `src/contexts/OnboardingContext.tsx` | Update targets that previously pointed at the removed device icons (if any onboarding step references them). |
| `src/locales/en/translation.json` | New `modePicker.*` keys. |

## Edge cases

1. **Pre-session, user clicks "我" but mic device was previously deselected.** Mode becomes "我", `isInputDeviceOn=true`, but `selectedInputDevice` is null. `speakerWillStart` stays false → `canStartSession` false → amber warning on "我" segment, Start disabled with existing tooltip.
2. **Mid-session, user clicks any segment.** Picker locked, click ignored. Tooltip explains.
3. **Mid-session, user clicks the active segment.** Locked, no popover. (Re-click only opens popover pre-session.)
4. **Popover open, user clicks Start.** Popover dismisses (focus loss), Start fires normally.
5. **Popover open, user changes mode by clicking another segment.** Popover closes, mode switches.
6. **Window resized narrow** (extension side panel can be very narrow). Picker stays one row, waveforms shrink to `min-width: 60px`. If still too narrow, output waveform hides first; mic/sys hide next.
7. **Advanced mode in `none` state pre-session.** No waveforms render (the audio pipeline isn't connected). Only the picker + disabled Start.
8. **Switching from `speaker` to `participant` pre-session.** `isInputDeviceOn` flips false, `isSystemAudioCaptureEnabled` flips true. Mic canvas hides, system canvas appears (with no live data until session starts).
9. **System audio source not yet ready (Electron, async loopback).** `participantWillStart` is false until ready. Picker's `participant` segment shows amber until ready.
10. **User has an in-progress device dropdown open inside the popover, clicks outside.** Standard floating-ui dismiss closes everything; selection up to that point is retained (the store action fires on each dropdown change, not on popover close).

## Acceptance criteria

- [ ] Basic-mode footer renders: `[dot] [ModePicker] · · · [PTT?] [Start] · · · [lang-pair] [duration?]`. No mic/participant/speaker icon spans remain.
- [ ] Advanced-mode footer renders the A2H layout per mode (per the layouts section); no mic/participant/speaker icon spans remain.
- [ ] PTT button slot does not displace the Start button when toggled — center cluster stays centered.
- [ ] When mode = `both`, mic-wf and sys-wf each render at ~50px width. When mode = `speaker` or `participant`, the visible input wf renders at ~110px.
- [ ] Pre-session: clicking a non-active segment switches mode (toggles audio-store state correctly).
- [ ] Pre-session: clicking the active segment opens the popover anchored to that segment.
- [ ] Popover content matches the mode (no mic or speaker monitor for `participant`).
- [ ] Popover device dropdowns commit to the existing audio-store selectors.
- [ ] Popover "完整设置面板 →" link calls `navigateToSettings(null)`.
- [ ] Switching to a mode that requires an unconfigured device shows amber on that segment and keeps Start disabled with the existing `noChannelConfigured` / device-specific tooltip.
- [ ] In-session: picker is locked, click handlers no-op, popover does not open.
- [ ] PTT button still gates on `mode ∈ {speaker, both}` × `canHoldToSpeak` × `speakerChannelActive`.
- [ ] System audio waveform draws live data when `participantChannelActive` is true.
- [ ] Existing channel-architecture invariants hold: scenario 2 still skips the speaker client (no regression on Kizuna AI token savings).
- [ ] `npm run test -- --run` 785/785 still pass (no expected new test additions; current tests cover store and IPC, not UI layout).
- [ ] Build clean.

## Out of scope / future work

- Smarter mutual-exclusivity detection on Electron (allow `both` with headphones, disable for speakers).
- Drag-to-reorder mode picker or favorite mode default.
- Persistent "last selected device per mode" memory inside the popover.
- Animated waveform-set transition on mode switch (basic CSS opacity transition is in scope; more elaborate motion isn't).
- Onboarding flow update to teach the picker (separate spec).
- Other-language translations of the new keys (handled by existing i18n flow over time).
