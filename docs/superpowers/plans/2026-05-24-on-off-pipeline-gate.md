# On/Off Pipeline Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "Mute" UI semantics with explicit On/Off, drop participant device selection on both platforms, change mute behavior from recorder-pause to callback-level pipeline gating so passthrough continues on Extension regardless of state, and listen for system default device changes so Extension passthrough follows the OS default.

**Architecture:** Top-down migration so the build stays green at every commit. Task 1 fixes the Task-11 warning bug by switching session-start to scope-only checks and acquiring system audio lazily. Tasks 2–5 swap mid-session mute behavior to callback-level gating and replace UI labels/structure. Tasks 6–7 cleanup the store and add the device-change listener. Tasks 8–9 close out with i18n + acceptance.

**Tech Stack:** Zustand (`subscribeWithSelector`), TypeScript strict, React 18, Vitest, Web Audio API, Electron loopback / Extension tabCapture.

**Spec reference:** `docs/superpowers/specs/2026-05-24-on-off-pipeline-gate.md`. Read this first.

---

## File Structure

State changes are in `src/stores/audioStore.ts`. Behavior changes are in `src/components/MainPanel/MainPanel.tsx` (session lifecycle + per-frame callbacks) and `src/lib/modern-audio/ModernBrowserAudioService.ts` (device-change listener for Extension). UI changes touch `ModeDevicePopover.tsx`, `SystemAudioSection.tsx`, `AudioDeviceSection.tsx`, and the i18n JSON files.

The fields being removed from the store:
- `selectedParticipantSource` / `selectParticipantSource` action / hooks
- `selectedParticipantOutput` / `selectParticipantOutput` action / hooks
- `systemAudioSources` / `setSystemAudioSources`
- `isSystemAudioCaptureActive` / setter / hook
- `isSystemAudioSourceReady` / setter / hook
- `refreshSystemAudioSources` action

Storage keys `audio.selectedSystemAudioSourceId` and `audio.selectedParticipantAudioOutputDeviceId` are abandoned (not deleted from user storage — harmless residue).

---

## Ordering Rationale (read before starting)

The plan migrates **consumers first**, **store last**. This keeps the build green and tests passing at every commit because no consumer ever reads a field after it's removed.

| Task | Consumers updated | Fields then unreferenced |
|---|---|---|
| 1 | MainPanel (session lifecycle) | `isSystemAudioSourceReady`, `selectedParticipantSource` (in MainPanel only) |
| 2 | MainPanel (mute behavior) | `pauseParticipantAudioRecording` / `resumeParticipantAudioRecording` in MainPanel |
| 3 | ModeDevicePopover | `selectedParticipantSource`, `selectedParticipantOutput`, `systemAudioSources`, `selectSystemAudioSource`, `selectParticipantOutput` in popover |
| 4 | SystemAudioSection | All remaining store refs in this section |
| 5 | AudioDeviceSection | Label-only — no store refs change |
| 6 | (none — pure removal) | Store fields/actions/hooks gone |
| 7 | ModernBrowserAudioService | (additive) |
| 8 | i18n JSON | (additive + cleanup) |
| 9 | Manual acceptance | — |

---

### Task 1: MainPanel — switch session-start gates to mode-only; add lazy acquisition + release

This is the **Task-11 bug fix on its own**. After this task, switching to Participant mode immediately enables Start — no Settings-page mount required.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

**Behavior changes:**
- `participantWillStart`: gate on mode only, drop `selectedParticipantSource` and `isSystemAudioSourceReady` checks.
- `missingDeviceForMode`: same — `hasParticipant = participantInScope`.
- `shouldCaptureParticipantAudio` (session start): gate on mode only.
- Inside the session-start participant block: lazy-acquire the loopback on Electron via `requestLoopbackAudioStream()` + `connectSystemAudioSource('desktop-audio-loopback')`. If permission denied, surface `screen-recording-denied` via the existing event-stream / LogsPanel pattern and skip the participant client; continue with speaker if any.
- On session end (cleanup path): call `audioService.disconnectSystemAudioSource()` on Electron.

**Failing test (component-level, may be skipped if hard to write — see verification):**
This task's behavior is verifiable mainly by integration test or manual run. The unit-testable parts are `participantWillStart` / `missingDeviceForMode` predicate values, but they live inside `MainPanel` as inline useMemo. Acceptable to verify via `npm run test` (no regressions) + manual smoke test instead of a new unit test.

- [ ] **Step 1: Update `participantWillStart`**

Locate around line 374:

```typescript
const participantWillStart = useMemo(() => {
  const inScope = currentMode === 'participant' || currentMode === 'both';
  if (!inScope) return false;
  if (isExtension()) return true;
  return !!selectedParticipantSource && isSystemAudioSourceReady;
}, [currentMode, selectedParticipantSource?.deviceId, isSystemAudioSourceReady]);
```

Replace with:

```typescript
const participantWillStart = useMemo(
  () => currentMode === 'participant' || currentMode === 'both',
  [currentMode]
);
```

- [ ] **Step 2: Update `missingDeviceForMode`**

Locate around lines 395–409 (the `useMemo` returning `'speaker' | 'participant' | 'both' | null`). Find the `hasParticipant` derivation:

```typescript
const hasParticipant = participantInScope && (
  isExtension() || (!!selectedParticipantSource && isSystemAudioSourceReady)
);
```

Replace with:

```typescript
// Under the on/off pipeline-gate model, participant has no pre-session
// device requirement. Electron acquires the single hardcoded loopback
// source at session start; Extension uses tab capture (implicit).
const hasParticipant = participantInScope;
```

Update the dependency array of that `useMemo` — remove `selectedParticipantSource?.deviceId` and `isSystemAudioSourceReady`.

- [ ] **Step 3: Update `shouldCaptureParticipantAudio` (session start, around line 1685)**

Find:

```typescript
const shouldCaptureParticipantAudio = participantInScope && audioServiceRef.current && (
  isExtension() ||
  (selectedParticipantSource && isSystemAudioSourceReady)
);
```

Replace with:

```typescript
const shouldCaptureParticipantAudio = participantInScope && audioServiceRef.current !== null;
```

- [ ] **Step 4: Inside `if (shouldCaptureParticipantAudio)` — add lazy acquisition for Electron**

Inside the block (around line 1690, before participant client creation), add:

```typescript
// Electron: lazy-acquire the loopback stream at session start.
// (Extension uses tab capture via the existing tabAudioRecorder path.)
if (isElectron() && !isExtension()) {
  try {
    if (isLoopbackPlatform()) {
      const granted = await audioServiceRef.current!.requestLoopbackAudioStream();
      if (!granted) {
        console.warn('[Sokuji] [MainPanel] Loopback permission denied; skipping participant');
        addRealtimeEvent(
          { type: 'session.init_error', data: { message: t('audioPanel.screenRecordingDenied', 'Screen recording permission denied. Cannot capture participant audio.') } },
          'client', 'session.init_error'
        );
        // Skip participant block; continue with speaker if any.
        participantClientRef.current = null;
      } else {
        await audioServiceRef.current!.connectSystemAudioSource('desktop-audio-loopback');
      }
    } else {
      await audioServiceRef.current!.connectSystemAudioSource('desktop-audio-loopback');
    }
  } catch (error) {
    console.error('[Sokuji] [MainPanel] Failed to acquire participant audio:', error);
    participantClientRef.current = null;
  }
}

// Only continue with participant client setup if acquisition succeeded
if (audioServiceRef.current && (isExtension() || /* electron acquired successfully */ true)) {
  // ... existing participant client creation code ...
}
```

Note: the conditional-skip is tricky inside the existing structure. The cleanest pattern is: if Electron acquisition fails, set a local flag and skip the rest of the participant block via that flag. Adjust to fit the existing control flow without restructuring beyond what the change requires.

- [ ] **Step 5: Add `disconnectSystemAudioSource` on session end**

Find the session-end / disconnect cleanup path (typically in `disconnectConversation` or in the `tabAudioCallback` cleanup). After the tab recorder/system recorder is stopped, add:

```typescript
// Release the loopback stream on Electron.
if (isElectron() && !isExtension() && audioServiceRef.current) {
  try {
    await audioServiceRef.current.disconnectSystemAudioSource();
  } catch (error) {
    console.warn('[Sokuji] [MainPanel] Failed to disconnect system audio source:', error);
  }
}
```

Locate the cleanup path by searching for `pauseParticipantAudioRecording` or `participantClientRef.current?.disconnect()` — the disconnect-system-audio call goes alongside those.

- [ ] **Step 6: Remove now-unused destructure entries (if any)**

If `selectedParticipantSource` / `isSystemAudioSourceReady` / `selectedParticipantOutput` / `systemAudioSources` are still destructured from `useAudioContext()` at the top of MainPanel but no longer referenced, remove them. Use grep:

```bash
grep -n 'selectedParticipantSource\|isSystemAudioSourceReady\|selectedParticipantOutput\|systemAudioSources' src/components/MainPanel/MainPanel.tsx
```

Remove any entries that are no longer read in the file. Keep the destructure block tidy.

- [ ] **Step 7: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | grep -i 'MainPanel' | head -10
npm run test 2>&1 | tail -5
```

Expect: no new MainPanel errors; tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(mainpanel): scope-only participant gates; lazy session-start loopback acquisition"
```

---

### Task 2: MainPanel — callback-level pipeline gating; remove mid-session mute effects

Switch mic + participant mid-session mute from `pauseRecording` / `pauseParticipantAudioRecording` to callback-level gating. The recorder runs continuously while in scope; the per-frame callback reads `is*Muted` via `useAudioStore.getState()` and skips `appendInputAudio` when on. Passthrough continues uninterrupted on Extension because `handlePassthroughAudio` is called from inside the recorder callback ahead of the gate.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Update participant audio callback (around line 1740)**

Locate `createAudioDataCallback`:

```typescript
const createAudioDataCallback = (client: IClient) => (data: { mono: Int16Array; raw: Int16Array }) => {
  if (client) {
    if (participantAudioCallbackCount % 100 === 0) {
      console.debug(`[Sokuji] [MainPanel] Sending ${captureMode} audio to client: chunk ${participantAudioCallbackCount}, PCM length: ${data.mono.length}`);
    }
    participantAudioCallbackCount++;
    client.appendInputAudio(data.mono);
  }
};
```

Replace with:

```typescript
const createAudioDataCallback = (client: IClient) => (data: { mono: Int16Array; raw: Int16Array }) => {
  if (!client) return;
  // Pipeline gate: skip sending to AI client when participant is off.
  // Read state per invocation to avoid stale closures.
  if (useAudioStore.getState().isParticipantMuted) return;
  if (participantAudioCallbackCount % 100 === 0) {
    console.debug(`[Sokuji] [MainPanel] Sending ${captureMode} audio to client: chunk ${participantAudioCallbackCount}, PCM length: ${data.mono.length}`);
  }
  participantAudioCallbackCount++;
  client.appendInputAudio(data.mono);
};
```

- [ ] **Step 2: Remove the participant initial-mute apply (around line 1748)**

Find:

```typescript
const startMuted = useAudioStore.getState().isParticipantMuted;
if (startMuted) {
  await audioServiceRef.current.pauseParticipantAudioRecording?.()
    .catch(err => console.warn('...', err));
}
```

Delete this block entirely. With callback-level gating, the recorder runs but the gate suppresses sends — no need for an initial pause.

- [ ] **Step 3: Remove the mid-session participant mute useEffect (around line 2692)**

Delete the entire useEffect:

```typescript
useEffect(() => {
  if (!isSessionActive || !participantChannelActive || !audioServiceRef.current) return;
  const audioService = audioServiceRef.current;
  if (!isParticipantMuted) {
    void audioService.resumeParticipantAudioRecording?.()
      .catch(err => console.warn('...', err));
  } else {
    void audioService.pauseParticipantAudioRecording?.()
      .catch(err => console.warn('...', err));
  }
}, [isParticipantMuted, isSessionActive, participantChannelActive]);
```

Including its preceding comment block.

- [ ] **Step 4: Update mic session-start (around line 1481, 1497)**

Inside the `if (speakerWillStart)` block, find the nested `if (!isMicMuted)` guard (around line 1497) that currently skips the mic setup when muted. Remove the guard so mic device setup always runs when speaker is in scope.

If the guard wraps only a `console.debug` / device-presence comment, just unwrap it. If it wraps a substantive setup branch, keep the substantive code but always run it.

- [ ] **Step 5: Update mic audio callback (around line 2643+ inside the mic startRecording branches in the connectConversation flow)**

The mic recording callback is defined in two places (push-to-translate vs automatic mode). Find both inside `connectConversation`. In each callback, gate `client.appendInputAudio(data.mono)` on `!useAudioStore.getState().isMicMuted`:

```typescript
await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
  if (!client) return;
  if (useAudioStore.getState().isMicMuted) return;  // ← new gate
  if (data.isPassthrough) return;
  // ... existing chunk-counting and appendInputAudio ...
});
```

There are two callbacks (around lines 2652 and 2672 — verify by searching `audioService.startRecording`). Both need the gate.

Also: the mic recorder needs to actually START when speaker is in scope, even if muted at session-start. Verify the session-start flow (Task 1's speaker block) starts the recorder unconditionally when speaker is in scope + device selected. If it currently gates on `!isMicMuted`, drop that gate.

- [ ] **Step 6: Remove mid-session mic mute useEffect (around line 2607)**

Delete the entire useEffect that watches `isMicMuted` and calls `pauseRecording`/`startRecording`. Mic now follows the same callback-gate model.

```typescript
useEffect(() => {
  if (!isSessionActive) return;
  // ... pause/resume body ...
}, [isMicMuted, isSessionActive, currentTurnDetectionMode, selectedInputDevice?.deviceId]);
```

This effect goes away entirely.

- [ ] **Step 7: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | grep -i 'MainPanel' | head -10
npm run test 2>&1 | tail -5
```

Expect: no new errors. Some existing tests may have asserted on the mid-session pause/resume effects — they shouldn't (those were component-level effects, not store-level), but if any do, update them.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): callback-level pipeline gating; drop mid-session mute pause/resume"
```

---

### Task 3: ModeDevicePopover — drop participant device list; On/Off labels

**Files:**
- Modify: `src/components/MainPanel/ModeDevicePopover.tsx`

- [ ] **Step 1: Update imports**

Remove the no-longer-used `AudioLines` and `MicOff` from lucide-react if they're not used by other rows. Add a power-style icon for the toggle button — `Power` from lucide-react is the canonical choice:

```typescript
import { Mic, Volume2, AudioLines, Power, ChevronDown, ChevronUp } from 'lucide-react';
```

Remove the `selectedParticipantSource` / `selectedParticipantOutput` / `systemAudioSources` / `selectSystemAudioSource` / `selectParticipantOutput` entries from the `useAudioContext()` destructure — they no longer exist in the store after Task 6 (but are still readable until then via the bridge-free store).

- [ ] **Step 2: Update `ChannelRowSpec`**

For the participant row, the row spec no longer needs `devices` or `selectedDevice`. Split the interface (or branch in the row builder):

```typescript
interface ChannelRowSpec {
  key: ChannelKey;
  icon: LucideIcon;
  label: string;
  // Mic + monitor: device list + selected device. Participant: empty list, null device, subtitle text instead.
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  /** Participant only: descriptive subtitle to show in place of the device name. */
  subtitle?: string;
  isMuted: boolean;
  onMuteToggle: () => void;
  /** Mic + monitor only — participant has no device picker. */
  onSelectDevice?: (d: AudioDevice) => void;
  isMissing: boolean;
}
```

- [ ] **Step 3: Update the `rows` useMemo**

Replace the participant row construction:

```typescript
if (showParticipant) {
  list.push({
    key: 'participant',
    icon: AudioLines,
    label: t('modePicker.deviceParticipantAudio', 'Participant audio'),
    devices: [],
    selectedDevice: null,
    subtitle: isExtension()
      ? t('popover.participantSubtitleExtension', 'Plays via system default')
      : t('popover.participantSubtitleElectron', 'All system audio'),
    isMuted: isParticipantMuted,
    onMuteToggle: () => setParticipantMuted(!isParticipantMuted),
    isMissing: false, // participant has no pre-session device requirement
  });
}
```

Drop the entire previous participant branch with its platform-conditional device list and source/output references. Update the `useMemo` dep array — remove the now-unused entries.

- [ ] **Step 4: Update `summaryText`**

```typescript
const summaryText = (row: ChannelRowSpec): { text: string; cls: string } => {
  // Participant: always show subtitle; status indicated by toggle icon
  if (row.subtitle) {
    return { text: row.subtitle, cls: row.isMuted ? 'mode-device-popover__summary--off' : '' };
  }
  if (row.isMuted) {
    return { text: t('popover.statusOff', 'Off'), cls: 'mode-device-popover__summary--off' };
  }
  if (!row.selectedDevice) {
    if (row.isMissing) {
      return { text: t('modePicker.notSelected', 'Not selected'), cls: 'mode-device-popover__summary--missing' };
    }
    return { text: t('modePicker.notSelected', 'Not selected'), cls: '' };
  }
  return { text: row.selectedDevice.label || row.selectedDevice.deviceId, cls: '' };
};
```

- [ ] **Step 5: Update row markup**

The participant row should:
- Skip the chevron (no expand)
- Skip the expanded device list
- Show the on/off toggle button

For mic + monitor rows, the structure stays as it was. Only the toggle button visuals change (use `Power` icon, swap aria-label to `popover.toggleOn` / `popover.toggleOff`).

For the toggle button across all rows:

```tsx
<button
  type="button"
  className={`mode-device-popover__mute-btn${row.isMuted ? ' mode-device-popover__mute-btn--off' : ''}`}
  onClick={(e) => { e.stopPropagation(); row.onMuteToggle(); }}
  aria-pressed={!row.isMuted}
  aria-label={row.isMuted
    ? t('popover.toggleOn', 'Turn on {{label}}', { label: row.label })
    : t('popover.toggleOff', 'Turn off {{label}}', { label: row.label })}
  title={row.isMuted
    ? t('popover.toggleOn', 'Turn on {{label}}', { label: row.label })
    : t('popover.toggleOff', 'Turn off {{label}}', { label: row.label })}
>
  <Power size={14} />
</button>
```

Note: a single `Power` icon for both states with `--off` modifier CSS class is simpler than two different icons. The CSS class can apply a "dimmed" style when off.

For the participant row's expand area (skip):

```tsx
{row.key === 'participant' ? null : (isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
```

And in the expand-content render, also skip for participant:

```tsx
{isExpanded && row.key !== 'participant' && (
  <div className="mode-device-popover__device-list" role="listbox" aria-label={row.label}>
    {/* existing device list rendering */}
  </div>
)}
```

For mic + monitor, when picking a device, call `row.onSelectDevice!(d)` (the `!` is safe because participant doesn't render this code path).

- [ ] **Step 6: Update SCSS for the new visuals**

In `src/components/MainPanel/ModeDevicePopover.scss`:
- Add `.mode-device-popover__mute-btn--off` modifier (e.g., dimmed color / lower opacity).
- Add or update `.mode-device-popover__row` styles to handle the participant row (no expand UI). If existing styles assume all rows are expandable, ensure participant row still aligns.

Inspect the existing classes and adjust minimally. The diff should be small.

- [ ] **Step 7: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | grep -i 'ModeDevicePopover' | head -10
npm run test 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/ModeDevicePopover.tsx src/components/MainPanel/ModeDevicePopover.scss
git commit -m "refactor(popover): drop participant device list; on/off toggle labels"
```

---

### Task 4: SystemAudioSection — gut to On/Off toggle with descriptive text

**Files:**
- Modify: `src/components/Settings/sections/SystemAudioSection.tsx`

- [ ] **Step 1: Replace the file body with the simplified section**

The new component reads `isParticipantMuted` + `setParticipantMuted` + `isSessionActive` from props/store, plus `isExtension()` for the subtitle. Everything related to source enumeration, output device picking, refresh, screen-recording warning modal (now handled at session start in Task 1), and tab capture wiring goes.

Sketch of the new render:

```tsx
const SystemAudioSection: React.FC<SystemAudioSectionProps> = ({
  isSessionActive,
  className = ''
}) => {
  const { t } = useTranslation();
  const isParticipantMuted = useIsParticipantMuted();
  const setParticipantMuted = useSetParticipantMuted();

  const description = isExtension()
    ? t('settings.participantSectionDescriptionExtension', 'Translate audio from the active browser tab. The original audio plays through your system default output.')
    : t('settings.participantSectionDescriptionElectron', 'Translate audio from any application playing on this system.');

  return (
    <div className={`settings-section ${className}`} id="system-audio-section">
      <div className="settings-section__header">
        <AudioLines size={16} />
        <h3>{t('settings.participantSectionHeader', 'Participant audio')}</h3>
      </div>
      <p className="settings-section__description">{description}</p>
      <div className="settings-section__toggle-row">
        <span>{t('settings.participantToggleLabel', 'Participant translation')}</span>
        <ToggleSwitch
          isOn={!isParticipantMuted}
          onChange={() => setParticipantMuted(!isParticipantMuted)}
          disabled={isSessionActive}
          ariaLabel={isParticipantMuted
            ? t('settings.turnOnParticipant', 'Turn on participant translation')
            : t('settings.turnOffParticipant', 'Turn off participant translation')}
        />
      </div>
    </div>
  );
};
```

`ToggleSwitch` is whatever toggle component the codebase already uses elsewhere (check `DeviceList` for the toggle pattern; if no separate component, inline a `<button>` with appropriate ARIA). Use the project's existing toggle look — do not introduce a new visual.

Remove all remaining unused imports (`useState`, `useCallback`, `RefreshCw`, `Tooltip`, `DeviceList`, `WarningModal`, `WarningType`, `useAnalytics`, `useProvider`, `useSetSystemAudioSourceReady`, `ServiceFactory`, `isElectron`, `isLoopbackPlatform`, `isMacOS`, `Provider`, etc.).

- [ ] **Step 2: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | grep -i 'SystemAudioSection' | head -10
npm run test 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/sections/SystemAudioSection.tsx
git commit -m "refactor(settings): gut SystemAudioSection to On/Off toggle with platform-specific description"
```

---

### Task 5: AudioDeviceSection — relabel mute → on/off

Pure label / aria change. Behavior unchanged.

**Files:**
- Modify: `src/components/Settings/sections/AudioDeviceSection.tsx`

- [ ] **Step 1: Update toggle aria-label / title**

Locate the two `DeviceList` props (mic + monitor) at the existing positions. Update the `toggleAriaLabel` (or equivalent prop — verify name in `DeviceList`):

```tsx
// Mic
<DeviceList
  // ... existing
  isDeviceOn={!isMicMuted}
  onToggleOff={() => setMicMuted(!isMicMuted)}
  toggleAriaLabel={isMicMuted
    ? t('audioPanel.turnOnMicrophone', 'Turn on microphone')
    : t('audioPanel.turnOffMicrophone', 'Turn off microphone')}
/>

// Monitor
<DeviceList
  // ... existing
  isDeviceOn={!isMonitorMuted}
  onToggleOff={() => setMonitorMuted(!isMonitorMuted)}
  toggleAriaLabel={isMonitorMuted
    ? t('audioPanel.turnOnMonitor', 'Turn on speaker monitor')
    : t('audioPanel.turnOffMonitor', 'Turn off speaker monitor')}
/>
```

Verify the actual prop name on `DeviceList` (check the component file) — if there's no `toggleAriaLabel` prop, find the equivalent and update it. If `DeviceList` has hardcoded aria text, file a follow-up; for this task, update what's accessible.

- [ ] **Step 2: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | grep -i 'AudioDeviceSection' | head -10
npm run test 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/sections/AudioDeviceSection.tsx
git commit -m "refactor(settings): relabel mic/monitor toggles to On/Off vocabulary"
```

---

### Task 6: Remove now-unused store fields, actions, hooks, and storage keys

**Files:**
- Modify: `src/stores/audioStore.ts`
- Modify: `src/stores/audioStore.test.ts`

- [ ] **Step 1: Verify no remaining consumers**

```bash
rg -n 'selectedParticipantSource|selectParticipantSource|useSelectedParticipantSource|systemAudioSources|setSystemAudioSources|refreshSystemAudioSources|isSystemAudioCaptureActive|setSystemAudioCaptureActive|useIsSystemAudioCaptureActive|isSystemAudioSourceReady|setSystemAudioSourceReady|useIsSystemAudioSourceReady|useSetSystemAudioSourceReady|selectedParticipantOutput|selectParticipantOutput|useSelectedParticipantOutput|useSelectParticipantOutput' src/ -g '*.ts' -g '*.tsx'
```

Expect: hits ONLY in `audioStore.ts` (definitions to be removed) and `audioStore.test.ts` (tests to be updated). If hits appear elsewhere, STOP and fix that file first.

- [ ] **Step 2: Remove interface entries**

From `src/stores/audioStore.ts` `AudioStore` interface, delete:
- `systemAudioSources: AudioDevice[];`
- `selectedParticipantSource: AudioDevice | null;`
- `isSystemAudioCaptureActive: boolean;`
- `isSystemAudioSourceReady: boolean;`
- `selectedParticipantOutput: AudioDevice | null;`
- `setSystemAudioSources: (sources: AudioDevice[]) => void;`
- `selectSystemAudioSource: (source: AudioDevice | null) => void;`
- `setSystemAudioCaptureActive: (active: boolean) => void;`
- `setSystemAudioSourceReady: (ready: boolean) => void;`
- `refreshSystemAudioSources: () => Promise<void>;`
- `selectParticipantOutput: (device: AudioDevice | null) => void;`

- [ ] **Step 3: Remove initial state entries**

In the `create(...)` initial state object, delete:
- `systemAudioSources: [],`
- `selectedParticipantSource: null,`
- `isSystemAudioCaptureActive: false,`
- `isSystemAudioSourceReady: false,`
- `selectedParticipantOutput: null,`

- [ ] **Step 4: Remove action implementations**

Delete the action bodies for:
- `setSystemAudioSources`
- `selectSystemAudioSource`
- `setSystemAudioCaptureActive`
- `setSystemAudioSourceReady`
- `refreshSystemAudioSources` (entire ~50-line block)
- `selectParticipantOutput`

- [ ] **Step 5: Remove auto-pick branch from `setMode`**

In `setMode`, find the auto-pick for participant (around line 307):

```typescript
if (nextParticipantInScope && !isExtension()
    && !state.selectedParticipantSource && state.systemAudioSources.length > 0) {
  patch.selectedParticipantSource = state.systemAudioSources[0];
}
```

Delete this block. Keep the mic auto-pick (still meaningful).

- [ ] **Step 6: Remove the `await get().refreshSystemAudioSources()` call from `initializeAudioService`**

Around line 624:

```typescript
await get().refreshSystemAudioSources();
```

Delete this line and the preceding comment block. Initialization no longer enumerates system audio sources.

- [ ] **Step 7: Remove hooks**

Delete the exports:
- `useSystemAudioSources`
- `useSelectedParticipantSource`
- `useIsSystemAudioCaptureActive`
- `useIsSystemAudioSourceReady`
- `useSelectedParticipantOutput`
- `useSetSystemAudioSources`
- `useSelectSystemAudioSource`
- `useSetSystemAudioCaptureActive`
- `useSetSystemAudioSourceReady`
- `useRefreshSystemAudioSources`
- `useSelectParticipantOutput`

Remove the corresponding `const` declarations and entries from the `useAudioContext` / `useAudioActions` aggregate hooks (and their useMemo dep arrays).

- [ ] **Step 8: Remove storage key constants**

From the `STORAGE_KEYS` object, delete:
- `SELECTED_SYSTEM_AUDIO_SOURCE_ID: 'audio.selectedSystemAudioSourceId',`
- `SELECTED_PARTICIPANT_AUDIO_OUTPUT_DEVICE_ID: 'audio.selectedParticipantAudioOutputDeviceId',`

Verify no other code references them (grep).

- [ ] **Step 9: Update `audioStore.test.ts`**

Remove the auto-pick assertion in the `setMode` test that referenced `selectedParticipantSource`. Update or remove any test that touches the deleted fields/actions.

Example: the test `'setMode resets newly-in-scope mute flags...'` may still pass unchanged, but the test `beforeEach` may reset fields that no longer exist — clean those out.

- [ ] **Step 10: Verify build + tests**

```bash
npx tsc --noEmit 2>&1 | head -20
npm run test 2>&1 | tail -10
```

Expect: zero new errors. All tests pass.

- [ ] **Step 11: Re-grep for leftover references**

```bash
rg -n 'selectedParticipantSource|selectedParticipantOutput|systemAudioSources|isSystemAudioCaptureActive|isSystemAudioSourceReady|refreshSystemAudioSources' src/ -g '*.ts' -g '*.tsx'
```

Expect: zero results.

- [ ] **Step 12: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts
git commit -m "refactor(audio): remove participant device state and refresh action"
```

---

### Task 7: Add Extension passthrough `devicechange` listener

**Files:**
- Modify: `src/lib/modern-audio/ModernBrowserAudioService.ts`
- Possibly: `src/lib/modern-audio/ModernAudioPlayer.js` (depending on where passthrough's `AudioContext` lives)

- [ ] **Step 1: Locate the passthrough `AudioContext`**

```bash
grep -n 'setSinkId\|passthrough.*AudioContext\|new AudioContext' src/lib/modern-audio/ModernBrowserAudioService.ts src/lib/modern-audio/ModernAudioPlayer.js 2>/dev/null | head -20
```

Identify which class/method holds the AudioContext used for passthrough output. The listener registration should live in the same class / scope so it can call `setSinkId('default')` on it.

- [ ] **Step 2: Add the listener at service initialization**

In `ModernBrowserAudioService.initialize()` (or wherever the passthrough AudioContext is created), add a private field for the listener handle and register it on the navigator only when running in Extension:

```typescript
private deviceChangeHandler: (() => void) | null = null;

private setupExtensionPassthroughListener(): void {
  if (!isExtension() || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
  this.deviceChangeHandler = () => {
    // Re-apply the default sink so passthrough output follows the
    // OS default device. Best-effort — log on failure.
    const ctx = this.getPassthroughAudioContext?.();
    if (ctx && typeof (ctx as any).setSinkId === 'function') {
      (ctx as any).setSinkId('default').catch((err: unknown) => {
        console.warn('[Sokuji] [ModernBrowserAudio] Failed to re-apply default sink:', err);
      });
    }
  };
  navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
}

private teardownExtensionPassthroughListener(): void {
  if (this.deviceChangeHandler && navigator?.mediaDevices) {
    navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
    this.deviceChangeHandler = null;
  }
}
```

Where `getPassthroughAudioContext()` returns the context to re-route (add a getter if one doesn't exist, or inline the access). If the passthrough AudioContext is `this.passthroughAudioContext` or lives on `this.tabAudioRecorder`, adjust accordingly.

- [ ] **Step 3: Call setup at initialization, teardown at destroy**

In `initialize()` (or constructor), call `this.setupExtensionPassthroughListener()`. In `destroy()` / cleanup path, call `this.teardownExtensionPassthroughListener()`.

If there's no explicit `destroy()`, register the teardown in whatever lifecycle the service has (window unload event, etc.). At minimum, ensure the listener doesn't double-register on hot reload.

- [ ] **Step 4: Verify the listener fires (best-effort manual)**

There's no easy unit test for `devicechange`. Manual verification: start a session in Extension with passthrough, change OS default output (plug headphones, unplug). Expect audio to follow within ~1 frame.

For now, satisfy the build/test gate:

```bash
npx tsc --noEmit 2>&1 | grep -i 'ModernBrowserAudio' | head -10
npm run test 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/modern-audio/
git commit -m "feat(audio): Extension passthrough follows OS default device via devicechange listener"
```

---

### Task 8: i18n cleanup — new On/Off keys; remove dead keys

**Files:**
- Modify: `src/locales/en/translation.json`
- Modify: other `src/locales/*/translation.json` (English fallback acceptable)

- [ ] **Step 1: Add new keys to `src/locales/en/translation.json`**

Locate the `popover` namespace and add:

```json
"statusOn": "On",
"statusOff": "Off",
"toggleOn": "Turn on {{label}}",
"toggleOff": "Turn off {{label}}",
"participantSubtitleElectron": "All system audio",
"participantSubtitleExtension": "Plays via system default"
```

Locate `modePicker` namespace and add (if popover.deviceParticipantAudio doesn't exist):

```json
"deviceParticipantAudio": "Participant audio"
```

Locate `settings` namespace (or wherever `audioPanel` lives) and add:

```json
"participantSectionHeader": "Participant audio",
"participantSectionDescriptionElectron": "Translate audio from any application playing on this system.",
"participantSectionDescriptionExtension": "Translate audio from the active browser tab. The original audio plays through your system default output.",
"participantToggleLabel": "Participant translation",
"turnOnParticipant": "Turn on participant translation",
"turnOffParticipant": "Turn off participant translation",
"turnOnMicrophone": "Turn on microphone",
"turnOffMicrophone": "Turn off microphone",
"turnOnMonitor": "Turn on speaker monitor",
"turnOffMonitor": "Turn off speaker monitor",
"screenRecordingDenied": "Screen recording permission denied. Cannot capture participant audio."
```

(Adjust namespace paths to match what the codebase actually uses — verify by grepping for an existing nearby key.)

- [ ] **Step 2: Remove dead keys from `src/locales/en/translation.json`**

After Tasks 3–4 are committed, grep for the dead keys to confirm they're no longer referenced:

```bash
for key in mute unmute muted deviceParticipantSource deviceParticipantOutput; do
  echo "=== $key ==="
  rg "modePicker\.$key|popover\.$key|'$key'\|\"$key\"" src/ -g '*.ts' -g '*.tsx' | head -3
done
```

For each key with zero hits in the source code, remove it from the `popover` / `modePicker` namespaces in `en/translation.json`.

Be careful: `modePicker.notSelected` is still used by mic + monitor rows in the popover ("Not selected" when no device picked). Don't delete that one.

- [ ] **Step 3: Mirror to other locales (English fallback acceptable)**

If the other locales already have these namespaces and you have time, add the new keys with translations. If no translation handy, leave them missing — `i18next` fallback to English handles the gap.

Other locales likely don't have the `popover.*` namespace at all (verified in Task 7 of the previous plan). Same expectation here.

- [ ] **Step 4: Verify build + tests**

```bash
npm run test 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/locales/
git commit -m "i18n: add On/Off + participant subtitles; remove dead mute keys"
```

---

### Task 9: Acceptance walkthrough — 7 spec scenarios

Manual verification. Document results.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Scenario 1 — switch-to-Participant**

Cold start. Switch to Participant mode via picker. Verify no "configure devices" warning. Verify Start button enabled.

- [ ] **Step 3: Scenario 2 — Speaker-only session, no settings opened**

Cold start. Mode is Speaker. Without opening settings, start a session. Verify no participant-related I/O fires (check LogsPanel for `requestLoopbackAudioStream` — should NOT appear).

- [ ] **Step 4: Scenario 3 — Electron Participant + first-run permission**

macOS: cold start, switch to Participant, click Start. Verify screen-recording permission prompt appears. Grant. Verify session connects and participant client receives audio.

If on Linux/Windows, skip the permission part — verify Participant session starts cleanly.

- [ ] **Step 5: Scenario 4 — Extension mid-session toggle preserves passthrough**

Start a session in Participant or Both mode in the Extension. Verify tab audio plays through system default (passthrough). Toggle Participant Off in popover. Verify:
- Translation stops (no new participant items)
- Passthrough continues to play
- Waveform goes flat
Toggle On → translation resumes.

- [ ] **Step 6: Scenario 5 — Electron mid-session toggle**

Same flow on Electron. Translation stops/starts. System audio continues to play through OS independently (always did).

- [ ] **Step 7: Scenario 6 — System default change (Extension)**

Start a session with passthrough audible. Change the OS default output (plug headphones, switch in OS settings). Verify passthrough follows within ~1 frame.

- [ ] **Step 8: Scenario 7 — Settings reflect popover**

Open settings while a session is active. Verify the On/Off state shown matches the popover. Toggle in either UI and confirm both update.

- [ ] **Step 9: Document and commit**

If any scenarios failed, fix in a follow-up task. If all passed:

```bash
git commit --allow-empty -m "chore(audio): on/off pipeline gate acceptance verified"
```

End of plan.
