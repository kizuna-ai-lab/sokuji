# Uniform Mute Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three legacy on/off channel flags (`isInputDeviceOn`, `isMonitorDeviceOn`, `isSystemAudioCaptureEnabled`) and the extension's separate passthrough channel with one explicit `mode` field plus three uniform per-channel mute flags. Mode picker becomes the sole source of intent; popover and settings expose mute / unmute only.

**Architecture:** Phase the refactor in three stages to keep the build green at every commit. Phase 1 (Tasks 1–3): add new state alongside legacy and bridge legacy setters to it — no consumer changes yet. Phase 2 (Tasks 4–9): migrate consumers one bounded area at a time; each commit leaves the app fully functional via the bridge. Phase 3 (Tasks 10–11): delete legacy state, setters, hooks, and storage keys; run acceptance scenarios.

**Tech Stack:** Zustand (`subscribeWithSelector`), TypeScript strict, React 18, Vitest, vite. SettingsService for persistence.

**Spec reference:** `docs/superpowers/specs/2026-05-23-uniform-mute-semantics.md`. Read this first.

---

## File Structure

State is owned by `src/stores/audioStore.ts`. New fields, actions, selectors, hook bindings, storage keys, and migration logic all live there. The bridge layer (Task 3) is also store-internal. `sessionStore.ts` owns `lockedMode` and gets a type narrowing.

UI surfaces consume the store:
- `MainPanel.tsx` — mode read + handler, mid-session mute effects, render-loop participant gate, session-start gate.
- `ModePicker.tsx` — drops `'none'` rendering.
- `ModeDevicePopover.tsx` — biggest UI change: rows gain a mute button, the `passthrough` row is merged into participant.
- `AudioDeviceSection.tsx`, `SystemAudioSection.tsx` — replace device-on toggles with mute toggles; drop monitor-mutex `disabled` flag.
- `LanguageSection.tsx`, `ProviderSection.tsx` — switch from `isSystemAudioCaptureEnabled` to a derived `isParticipantChannelInScope`.
- `SimpleSettings.tsx`, `AdvancedSettings.tsx` — lock formulas (already use `lockedMode`) — no structural change, but verify reads.

Service layer:
- `ModernBrowserAudioService.ts` — ensure mic has a `resumeRecording` mirror of `pauseRecording`.
- `IAudioService.ts` — update interface if a method is added.

i18n: `src/locales/*/translation.json` — new keys `popover.mute`, `popover.unmute`, `popover.muted`. Obsolete keys identified during Task 7 are deleted as part of that task.

Tests: `src/stores/audioStore.test.ts` — extended with new state, bridge, migration cases.

---

## Bridge Strategy (read before Task 3)

During Phase 2, legacy and new state coexist. To prevent consumer asymmetry, **every existing setter that mutates a legacy field also writes the corresponding new field**, and **every new setter writes the matching legacy field**. Readers can be on either side until they're migrated.

Specifically the bridge maintains:

| Legacy field | New field | Relation |
|---|---|---|
| `isInputDeviceOn` | `isMicMuted` | `isMicMuted === !isInputDeviceOn` |
| `isMonitorDeviceOn` | `isMonitorMuted` | `isMonitorMuted === !isMonitorDeviceOn` |
| `isSystemAudioCaptureEnabled` | `isParticipantMuted` | `isParticipantMuted === !isSystemAudioCaptureEnabled` |
| `(derived from legacy)` | `mode` | computed from legacy flags using the migration formula on every legacy setter call |

`setMode(target)` (new) also writes the legacy flags so legacy readers stay correct: `isInputDeviceOn = target ∈ {speaker, both}`, `isSystemAudioCaptureEnabled = target ∈ {participant, both}`, `isMonitorDeviceOn` unchanged (monitor is intra-speaker preference).

This bridge is deleted in Task 10.

---

## Mode-Switch Behavior (read before Task 4)

`setMode(target)`:

1. Persist `mode = target`.
2. For each channel **newly in scope** (was out, now in), reset its mute flag to false:
   - mic newly in scope (target ∈ {speaker, both} and prev ∉ {speaker, both}) → `isMicMuted = false`
   - participant newly in scope (target ∈ {participant, both} and prev ∉ {participant, both}) → `isParticipantMuted = false`
   - **Monitor mute is sticky** — never auto-reset, since `isMonitorMuted` default is `true` and historical behavior is opt-in audio.
3. For each channel newly in scope without a selected device, auto-pick the first available:
   - mic: if `!selectedInputDevice && audioInputDevices.length` → `selectInputDevice(audioInputDevices[0])`
   - participant on electron: if `!isExtension() && !selectedParticipantSource && systemAudioSources.length` → `selectSystemAudioSource(systemAudioSources[0])`
   - participant on extension: no source list (implicit tab capture) — nothing to pick
4. Bridge writes to legacy fields (see Bridge Strategy).

---

### Task 1: Rename `selectedSystemAudioSource` → `selectedParticipantSource`

Mechanical rename. No behavior change. Run `tsc` and tests after.

**Files:**
- Modify: `src/stores/audioStore.ts` (field, action `selectSystemAudioSource`, selector hook `useSelectedSystemAudioSource`, storage key `SELECTED_SYSTEM_AUDIO_SOURCE_ID`)
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/MainPanel/ModeDevicePopover.tsx`
- Modify: `src/components/Settings/sections/SystemAudioSection.tsx`
- Modify: `src/stores/audioStore.test.ts` (if referenced)

- [ ] **Step 1: Find every reference**

```bash
rg -n 'selectedSystemAudioSource|useSelectedSystemAudioSource' src/ -g '*.ts' -g '*.tsx'
```

Save the list. Every hit becomes a rename target. (Note: `selectSystemAudioSource` the action keeps its name per Step 2 — only field/hook readers rename.)

- [ ] **Step 2: Rename in store**

In `src/stores/audioStore.ts`:
- Field `selectedSystemAudioSource` → `selectedParticipantSource`
- Action `selectSystemAudioSource` keeps the same name (it's a verb-noun describing a source; rename is optional). **Decision: keep `selectSystemAudioSource` — the verb describes the user action, the noun is the source kind, both still accurate.**
- Hook `useSelectedSystemAudioSource` → `useSelectedParticipantSource`
- Storage key constant name stays the same (`SELECTED_SYSTEM_AUDIO_SOURCE_ID`); only the in-memory field name changes. (The on-disk key value stays `'audio.selectedSystemAudioSourceId'` so existing user state survives.)

- [ ] **Step 3: Update consumers**

Apply the rename in `MainPanel.tsx`, `ModeDevicePopover.tsx`, `SystemAudioSection.tsx`, and `audioStore.test.ts`. Use the grep result from Step 1 as the checklist.

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Verify tests**

```bash
npm run test -- src/stores/audioStore.test.ts
```

Expected: all pass.

- [ ] **Step 6: Verify no stragglers**

```bash
rg -n 'selectedSystemAudioSource' src/
```

Expected: no results.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(audio): rename selectedSystemAudioSource to selectedParticipantSource"
```

---

### Task 2: Rename `participantAudioOutputDevice` → `selectedParticipantOutput`

Same shape as Task 1.

**Files:**
- Modify: `src/stores/audioStore.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/MainPanel/ModeDevicePopover.tsx`

- [ ] **Step 1: Find every reference**

```bash
rg -n 'participantAudioOutputDevice|selectParticipantAudioOutputDevice|useParticipantAudioOutputDevice|useSelectParticipantAudioOutputDevice|SELECTED_PARTICIPANT_AUDIO_OUTPUT_DEVICE_ID' src/
```

- [ ] **Step 2: Rename in store**

In `src/stores/audioStore.ts`:
- Field `participantAudioOutputDevice` → `selectedParticipantOutput`
- Action `selectParticipantAudioOutputDevice` → `selectParticipantOutput`
- Hook `useParticipantAudioOutputDevice` → `useSelectedParticipantOutput`
- Hook `useSelectParticipantAudioOutputDevice` → `useSelectParticipantOutput`
- Storage key constant name stays the same; on-disk key value stays `'audio.selectedParticipantAudioOutputDeviceId'`.

- [ ] **Step 3: Update consumers**

`MainPanel.tsx`, `ModeDevicePopover.tsx`, and any other hits from Step 1.

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Verify tests**

```bash
npm run test
```

Expected: all pass.

- [ ] **Step 6: Verify no stragglers**

```bash
rg -n 'participantAudioOutputDevice|selectParticipantAudioOutputDevice' src/
```

Expected: no results.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(audio): rename participantAudioOutputDevice to selectedParticipantOutput"
```

---

### Task 3: Add `mode` + mute flags to audioStore (with migration and bridge)

Pure additive: new state fields, new actions, hydration migration, bridge from legacy setters. **Consumers unchanged in this task** — the bridge keeps both halves in sync.

**Files:**
- Modify: `src/stores/audioStore.ts`
- Modify: `src/stores/audioStore.test.ts`

- [ ] **Step 1: Write the failing test for new state shape**

Append to `src/stores/audioStore.test.ts`:

```typescript
import type { AudioMode } from './audioStore';

describe('audioStore — mode + mute flags', () => {
  beforeEach(() => {
    useAudioStore.setState({
      mode: 'speaker' as AudioMode,
      isMicMuted: false,
      isMonitorMuted: true,
      isParticipantMuted: false,
      isInputDeviceOn: true,
      isMonitorDeviceOn: false,
      isSystemAudioCaptureEnabled: false,
      audioInputDevices: [],
      systemAudioSources: [],
      selectedInputDevice: null,
      selectedParticipantSource: null,
    } as any);
  });

  it('defaults: mode=speaker, isMicMuted=false, isMonitorMuted=true, isParticipantMuted=false', () => {
    // Reset by reinitializing through the store creator pathway
    const s = useAudioStore.getState();
    expect(s.mode).toBe('speaker');
    expect(s.isMicMuted).toBe(false);
    expect(s.isMonitorMuted).toBe(true);
    expect(s.isParticipantMuted).toBe(false);
  });

  it('setMode("participant") updates mode and bridges legacy fields', () => {
    useAudioStore.getState().setMode('participant');
    const s = useAudioStore.getState();
    expect(s.mode).toBe('participant');
    expect(s.isInputDeviceOn).toBe(false);
    expect(s.isSystemAudioCaptureEnabled).toBe(true);
  });

  it('setMode resets newly-in-scope mute flags to false but leaves monitor sticky', () => {
    useAudioStore.setState({
      mode: 'speaker',
      isMicMuted: true,
      isMonitorMuted: true,
      isParticipantMuted: true,
    } as any);
    useAudioStore.getState().setMode('both');
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(false); // newly in scope
    expect(s.isMicMuted).toBe(true);          // was already in scope
    expect(s.isMonitorMuted).toBe(true);      // sticky
  });

  it('setMicMuted(true) bridges to isInputDeviceOn=false', () => {
    useAudioStore.getState().setMicMuted(true);
    const s = useAudioStore.getState();
    expect(s.isMicMuted).toBe(true);
    expect(s.isInputDeviceOn).toBe(false);
  });

  it('setInputDeviceOn(false) bridges to isMicMuted=true', () => {
    useAudioStore.getState().setInputDeviceOn(false);
    const s = useAudioStore.getState();
    expect(s.isInputDeviceOn).toBe(false);
    expect(s.isMicMuted).toBe(true);
  });

  it('setParticipantMuted(true) bridges to isSystemAudioCaptureEnabled=false', () => {
    useAudioStore.setState({ isSystemAudioCaptureEnabled: true } as any);
    useAudioStore.getState().setParticipantMuted(true);
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(true);
    expect(s.isSystemAudioCaptureEnabled).toBe(false);
  });

  it('setSystemAudioCaptureEnabled(false) bridges to isParticipantMuted=true', () => {
    useAudioStore.setState({ isSystemAudioCaptureEnabled: true } as any);
    useAudioStore.getState().setSystemAudioCaptureEnabled(false);
    const s = useAudioStore.getState();
    expect(s.isSystemAudioCaptureEnabled).toBe(false);
    expect(s.isParticipantMuted).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test -- src/stores/audioStore.test.ts
```

Expected: failures on `mode`, `setMode`, `isMicMuted`, `setMicMuted`, etc. (undefined / missing).

- [ ] **Step 3: Add types and storage keys in `src/stores/audioStore.ts`**

Near the top, add to `STORAGE_KEYS`:

```typescript
const STORAGE_KEYS = {
  // ... existing keys
  MODE: 'audio.mode',
  IS_MIC_MUTED: 'audio.isMicMuted',
  IS_MONITOR_MUTED: 'audio.isMonitorMuted',
  IS_PARTICIPANT_MUTED: 'audio.isParticipantMuted',
};
```

Export the mode type below `NoiseSuppressionMode`:

```typescript
export type AudioMode = 'speaker' | 'participant' | 'both';
```

In the `AudioStore` interface, add:

```typescript
interface AudioStore {
  // ... existing fields
  mode: AudioMode;
  isMicMuted: boolean;
  isMonitorMuted: boolean;
  isParticipantMuted: boolean;

  // ... existing actions
  setMode: (mode: AudioMode) => void;
  setMicMuted: (muted: boolean) => void;
  setMonitorMuted: (muted: boolean) => void;
  setParticipantMuted: (muted: boolean) => void;
}
```

In the initial state object:

```typescript
mode: 'speaker',
isMicMuted: false,
isMonitorMuted: true,
isParticipantMuted: false,
```

- [ ] **Step 4: Implement `setMode` with bridge + reset logic**

Add to the actions block:

```typescript
setMode: (target) => {
  const settingsService = ServiceFactory.getSettingsService();
  set((state) => {
    const prev = state.mode;
    const prevSpeakerInScope = prev === 'speaker' || prev === 'both';
    const prevParticipantInScope = prev === 'participant' || prev === 'both';
    const nextSpeakerInScope = target === 'speaker' || target === 'both';
    const nextParticipantInScope = target === 'participant' || target === 'both';

    const patch: Partial<AudioStore> = { mode: target };

    // Bridge to legacy fields (consumers still reading legacy must see the change).
    patch.isInputDeviceOn = nextSpeakerInScope;
    patch.isSystemAudioCaptureEnabled = nextParticipantInScope;
    // isMonitorDeviceOn unchanged here — monitor is a sub-preference of speaker.

    // Reset mute flags for newly-in-scope channels (monitor is sticky).
    if (nextSpeakerInScope && !prevSpeakerInScope) {
      patch.isMicMuted = false;
    }
    if (nextParticipantInScope && !prevParticipantInScope) {
      patch.isParticipantMuted = false;
    }

    // Auto-pick first device for channels newly in scope.
    if (nextSpeakerInScope && !state.selectedInputDevice && state.audioInputDevices.length > 0) {
      patch.selectedInputDevice = state.audioInputDevices[0];
    }
    if (nextParticipantInScope && !isExtension()
        && !state.selectedParticipantSource && state.systemAudioSources.length > 0) {
      patch.selectedParticipantSource = state.systemAudioSources[0];
    }

    // Persist (best-effort; errors logged).
    settingsService.setSetting(STORAGE_KEYS.MODE, target)
      .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist mode:', error));
    if ('isMicMuted' in patch) {
      settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, patch.isMicMuted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMicMuted:', error));
    }
    if ('isParticipantMuted' in patch) {
      settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, patch.isParticipantMuted)
        .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
    }

    return patch;
  });
},
```

- [ ] **Step 5: Implement mute setters with bridges**

```typescript
setMicMuted: (muted) => {
  const settingsService = ServiceFactory.getSettingsService();
  settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, muted)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMicMuted:', error));
  settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, !muted)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isInputDeviceOn:', error));
  set({ isMicMuted: muted, isInputDeviceOn: !muted });
},

setMonitorMuted: (muted) => {
  const settingsService = ServiceFactory.getSettingsService();
  settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_MUTED, muted)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorMuted:', error));
  settingsService.setSetting(STORAGE_KEYS.IS_MONITOR_DEVICE_ON, !muted)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMonitorDeviceOn:', error));
  set((state) => {
    const { audioService } = state;
    if (audioService) audioService.setMonitorVolume(muted ? 0 : 1);
    return { isMonitorMuted: muted, isMonitorDeviceOn: !muted };
  });
},

setParticipantMuted: (muted) => {
  const settingsService = ServiceFactory.getSettingsService();
  settingsService.setSetting(STORAGE_KEYS.IS_PARTICIPANT_MUTED, muted)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isParticipantMuted:', error));
  settingsService.setSetting(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED, !muted)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isSystemAudioCaptureEnabled:', error));
  set({ isParticipantMuted: muted, isSystemAudioCaptureEnabled: !muted });
},
```

- [ ] **Step 6: Bridge existing legacy setters to new state**

Locate `setInputDeviceOn`, `setMonitorDeviceOn`, `setSystemAudioCaptureEnabled`, `toggleInputDeviceState`, `toggleMonitorDeviceState`, `toggleSystemAudioCapture` in the store. In each `set(...)` call, also include the corresponding new-state field.

For example, change:

```typescript
setInputDeviceOn: (on) => {
  // ... existing persistence
  set({ isInputDeviceOn: on });
},
```

to:

```typescript
setInputDeviceOn: (on) => {
  const settingsService = ServiceFactory.getSettingsService();
  settingsService.setSetting(STORAGE_KEYS.IS_INPUT_DEVICE_ON, on)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to save input device state:', error));
  settingsService.setSetting(STORAGE_KEYS.IS_MIC_MUTED, !on)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist isMicMuted:', error));
  set({ isInputDeviceOn: on, isMicMuted: !on });
},
```

Apply the same pattern to `setMonitorDeviceOn` (also `isMonitorMuted`) and `setSystemAudioCaptureEnabled` (also `isParticipantMuted`). For toggle actions, compute `next = !state.isXxx` then call the matching setter so bridge logic runs in one place.

- [ ] **Step 7: Migration in hydration block**

Locate `initializeAudioService` around line 427. After the existing legacy reads, add:

```typescript
// Migration: derive new mode + mute fields from legacy flags.
const savedMode = await settingsService.getSetting<AudioMode | null>(STORAGE_KEYS.MODE, null);
if (savedMode === 'speaker' || savedMode === 'participant' || savedMode === 'both') {
  set({ mode: savedMode });
} else {
  // First run after upgrade: derive mode from legacy flags.
  const micOn = savedInputDeviceOn === true;
  const partOn = savedSystemAudioCaptureEnabled === true;
  const derived: AudioMode =
    micOn && partOn ? 'both' :
    partOn ? 'participant' :
    'speaker'; // includes "all off" per spec
  set({ mode: derived });
  settingsService.setSetting(STORAGE_KEYS.MODE, derived)
    .catch(error => console.error('[Sokuji] [AudioStore] Failed to persist initial mode:', error));
}

const savedIsMicMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_MIC_MUTED, null);
if (typeof savedIsMicMuted === 'boolean') {
  set({ isMicMuted: savedIsMicMuted });
} else {
  set({ isMicMuted: savedInputDeviceOn === false });
}

const savedIsMonitorMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_MONITOR_MUTED, null);
if (typeof savedIsMonitorMuted === 'boolean') {
  set({ isMonitorMuted: savedIsMonitorMuted });
} else {
  set({ isMonitorMuted: savedMonitorDeviceOn !== true });
}

const savedIsParticipantMuted = await settingsService.getSetting<boolean | null>(STORAGE_KEYS.IS_PARTICIPANT_MUTED, null);
if (typeof savedIsParticipantMuted === 'boolean') {
  set({ isParticipantMuted: savedIsParticipantMuted });
} else {
  set({ isParticipantMuted: savedSystemAudioCaptureEnabled === false });
}
```

Note: relies on `savedInputDeviceOn`, `savedMonitorDeviceOn`, `savedSystemAudioCaptureEnabled` being read earlier in the same hydration block (they already are). Add reads if missing.

After the migration completes successfully (new keys written), schedule legacy key deletion:

```typescript
// Once-only cleanup of legacy on-disk keys. Safe to delete because the
// new keys are now populated and authoritative.
settingsService.removeSetting?.(STORAGE_KEYS.IS_INPUT_DEVICE_ON)
  .catch(error => console.warn('[Sokuji] [AudioStore] Failed to remove legacy isInputDeviceOn key:', error));
settingsService.removeSetting?.(STORAGE_KEYS.IS_MONITOR_DEVICE_ON)
  .catch(error => console.warn('[Sokuji] [AudioStore] Failed to remove legacy isMonitorDeviceOn key:', error));
settingsService.removeSetting?.(STORAGE_KEYS.IS_SYSTEM_AUDIO_CAPTURE_ENABLED)
  .catch(error => console.warn('[Sokuji] [AudioStore] Failed to remove legacy isSystemAudioCaptureEnabled key:', error));
```

If `removeSetting` doesn't exist on the SettingsService interface, add it (one-line method) in this same task. If adding the method is non-trivial, fall back to setting the legacy keys to `null` and document the deferred cleanup.

- [ ] **Step 8: Add selector hooks at the bottom of the file**

```typescript
export const useMode = () => useAudioStore((state) => state.mode);
export const useIsMicMuted = () => useAudioStore((state) => state.isMicMuted);
export const useIsMonitorMuted = () => useAudioStore((state) => state.isMonitorMuted);
export const useIsParticipantMuted = () => useAudioStore((state) => state.isParticipantMuted);
export const useSetMode = () => useAudioStore((state) => state.setMode);
export const useSetMicMuted = () => useAudioStore((state) => state.setMicMuted);
export const useSetMonitorMuted = () => useAudioStore((state) => state.setMonitorMuted);
export const useSetParticipantMuted = () => useAudioStore((state) => state.setParticipantMuted);
```

Also add them to `useAudioContext` / `useAudioActions` aggregate hooks alongside their legacy counterparts.

- [ ] **Step 9: Run tests to verify they pass**

```bash
npm run test -- src/stores/audioStore.test.ts
```

Expected: all pass, including the new mode/mute tests.

- [ ] **Step 10: Run full test suite + tsc**

```bash
npm run test && npx tsc --noEmit
```

Expected: zero failures.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(audio): add mode + mute flags with legacy bridge and migration"
```

---

### Task 4: Migrate MainPanel mode logic to store

`currentMode` becomes a store read; `handleModeSwitch` becomes `setMode`. Session-start gate keys on intent (`mode`), not legacy flags.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Replace `currentMode` derivation with store read**

Find the `currentMode` useMemo (around line 386):

```typescript
const currentMode = useMemo<'speaker' | 'participant' | 'both' | 'none'>(() => {
  if (isInputDeviceOn && isSystemAudioCaptureEnabled) return 'both';
  if (isInputDeviceOn) return 'speaker';
  if (isSystemAudioCaptureEnabled) return 'participant';
  return 'none';
}, [isInputDeviceOn, isSystemAudioCaptureEnabled]);
```

Replace with:

```typescript
import { useMode, useSetMode } from '../../stores/audioStore';
// ...
const currentMode = useMode();
const setMode = useSetMode();
```

There is no longer a `'none'` case — narrow downstream types accordingly (the next steps update consumers).

- [ ] **Step 2: Replace `handleModeSwitch` body**

Find `handleModeSwitch` (around line 437–457). The old body manually flips `setInputDeviceOn` / `setSystemAudioCaptureEnabled` / auto-picks. Replace with:

```typescript
const handleModeSwitch = useCallback((target: 'speaker' | 'participant' | 'both') => {
  if (isSessionActive) return;
  setMode(target);
}, [isSessionActive, setMode]);
```

The store's `setMode` handles auto-pick + legacy bridge.

- [ ] **Step 3: Update `canStartSession` and `missingDeviceForMode` to read `mode`**

The existing implementations already key off `currentMode` (now from store). They should compile after Step 1. Verify by reading lines 374–416 and confirming dependencies are correct. If `'none'` appears in any guard, remove it — `mode` is now always one of three values.

- [ ] **Step 4: Update session-start participant gate (line ~1713)**

Find:

```typescript
const shouldCaptureParticipantAudio = isSystemAudioCaptureEnabled && audioServiceRef.current && (
  isExtension() ||
  (selectedSystemAudioSource && isSystemAudioSourceReady)
);
```

Replace `isSystemAudioCaptureEnabled` with the intent derivation:

```typescript
const participantInScope = currentMode === 'participant' || currentMode === 'both';
const shouldCaptureParticipantAudio = participantInScope && audioServiceRef.current && (
  isExtension() ||
  (selectedParticipantSource && isSystemAudioSourceReady)
);
```

(`selectedParticipantSource` is the renamed field from Task 1.)

- [ ] **Step 4b: Apply initial mute state after participant recorder starts**

Inside the `if (shouldCaptureParticipantAudio) { ... }` block, after the existing `tabAudioRecorder.record(...)` / `systemAudioRecorder.record(...)` call (whichever branch runs), add:

```typescript
// If the user started the session with participant muted, pause the
// recorder immediately so the analyser is wired (mid-session unmute
// resumes via the useEffect) but no audio flows to the AI client.
if (isParticipantMuted) {
  await audioService.pauseParticipantAudioRecording?.()
    .catch(err => console.warn('[Sokuji] [MainPanel] Failed to apply initial participant mute:', err));
}
```

`isParticipantMuted` will be available in MainPanel after Task 5 Step 1; if Task 4 runs first, add the read inline at the top of the session-start function:

```typescript
const isParticipantMuted = useAudioStore.getState().isParticipantMuted;
```

(Read via `getState()` to avoid forcing the start handler to re-run on mute changes — mid-session changes are handled by the dedicated effect.)

- [ ] **Step 5: Verify build and tests**

```bash
npx tsc --noEmit && npm run test
```

Expected: zero errors. Other consumers still on legacy state work because the bridge propagates writes.

- [ ] **Step 6: Manual smoke check**

```bash
npm run dev
```

Open browser, switch modes pre-session: mode picker should still respond, legacy popover "Off" still works (because legacy setters bridge to new state and back).

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): read mode from store; handleModeSwitch delegates to setMode"
```

---

### Task 5: Migrate MainPanel mid-session mute effects + waveform render gate

Mid-session effects switch from legacy flags to `is*Muted`. The participant waveform render loop gains a `recorder.isRecording()` gate (parity with mic).

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Pull mute flags into MainPanel**

Add imports:

```typescript
import { useIsMicMuted, useIsMonitorMuted, useIsParticipantMuted } from '../../stores/audioStore';
```

And bind:

```typescript
const isMicMuted = useIsMicMuted();
const isMonitorMuted = useIsMonitorMuted();
const isParticipantMuted = useIsParticipantMuted();
```

- [ ] **Step 2: Update mic mid-session effect (line ~2618)**

Find:

```typescript
useEffect(() => {
  if (!isSessionActive) return;
  // ...
  if (!isInputDeviceOn) {
    // pause
  } else {
    // resume
  }
}, [isInputDeviceOn, isSessionActive, currentTurnDetectionMode, selectedInputDevice?.deviceId]);
```

Replace `isInputDeviceOn` reads with `!isMicMuted` and update the dependency array:

```typescript
}, [isMicMuted, isSessionActive, currentTurnDetectionMode, selectedInputDevice?.deviceId]);
```

Change the body's `!isInputDeviceOn` checks to `isMicMuted` and `isInputDeviceOn` to `!isMicMuted`. (Two callsites in that effect.)

- [ ] **Step 3: Update participant mid-session effect (line ~2703)**

Find:

```typescript
useEffect(() => {
  if (!isSessionActive || !participantChannelActive || !audioServiceRef.current) return;
  const audioService = audioServiceRef.current;
  if (isSystemAudioCaptureEnabled) {
    void audioService.resumeParticipantAudioRecording?.()...
  } else {
    void audioService.pauseParticipantAudioRecording?.()...
  }
}, [isSystemAudioCaptureEnabled, isSessionActive, participantChannelActive]);
```

Replace `isSystemAudioCaptureEnabled` with `!isParticipantMuted`:

```typescript
useEffect(() => {
  if (!isSessionActive || !participantChannelActive || !audioServiceRef.current) return;
  const audioService = audioServiceRef.current;
  if (!isParticipantMuted) {
    void audioService.resumeParticipantAudioRecording?.()
      .catch(err => console.warn('[Sokuji] [MainPanel] Failed to resume participant audio:', err));
  } else {
    void audioService.pauseParticipantAudioRecording?.()
      .catch(err => console.warn('[Sokuji] [MainPanel] Failed to pause participant audio:', err));
  }
}, [isParticipantMuted, isSessionActive, participantChannelActive]);
```

- [ ] **Step 4: Update monitor mute effect (line ~3025)**

Find:

```typescript
useEffect(() => {
  if (!isSessionActive || !isUsingWebRTC) return;
  const client = speakerClientRef.current;
  if (client && typeof client.setOutputMuted === 'function') {
    client.setOutputMuted(!isMonitorDeviceOn);
  }
}, [isMonitorDeviceOn, isSessionActive, isUsingWebRTC]);
```

Replace with mute-flag semantics:

```typescript
useEffect(() => {
  if (!isSessionActive || !isUsingWebRTC) return;
  const client = speakerClientRef.current;
  if (client && typeof client.setOutputMuted === 'function') {
    client.setOutputMuted(isMonitorMuted);
  }
}, [isMonitorMuted, isSessionActive, isUsingWebRTC]);
```

- [ ] **Step 5: Gate participant waveform render on recorder state**

Find the participant analyser block (line ~2500):

```typescript
const participantAnalyser = audioService.getParticipantAnalyser?.() ?? null;
let values: Float32Array;
if (participantAnalyser) {
  // ... reads bytes
  values = systemFloatBuffer!;
} else {
  values = new Float32Array([0]);
}
```

Wrap with a recorder-state check so muted = flat (mirrors mic at line 2469). The simplest gate is the `isParticipantMuted` flag, which is the user-facing source of truth:

```typescript
const participantAnalyser = audioService.getParticipantAnalyser?.() ?? null;
let values: Float32Array;
if (participantAnalyser && !isParticipantMuted) {
  const bins = participantAnalyser.frequencyBinCount;
  if (!systemByteBuffer || systemByteBuffer.length !== bins) {
    systemByteBuffer = new Uint8Array(bins);
    systemFloatBuffer = new Float32Array(bins);
  }
  participantAnalyser.getByteFrequencyData(systemByteBuffer as Uint8Array<ArrayBuffer>);
  for (let i = 0; i < bins; i++) {
    systemFloatBuffer![i] = systemByteBuffer[i] / 255;
  }
  values = systemFloatBuffer!;
} else {
  values = new Float32Array([0]);
}
```

The render loop is rAF-driven and reads the React-state closure each frame; the gate updates as soon as the user toggles.

- [ ] **Step 6: Verify build and tests**

```bash
npx tsc --noEmit && npm run test
```

- [ ] **Step 7: Manual smoke check**

Start a session, toggle mic / participant mute through the (legacy) popover Off button. Audio should pause/resume and the participant waveform should now flatten when muted.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): mid-session effects read mute flags; participant waveform gates on mute"
```

---

### Task 6: Migrate ModePicker — drop `'none'` mode rendering

`FooterMode` type narrows; picker assumes mode is always one of three.

**Files:**
- Modify: `src/components/MainPanel/ModePicker.tsx`

- [ ] **Step 1: Narrow `FooterMode` type**

In `src/components/MainPanel/ModePicker.tsx` line 6:

```typescript
export type FooterMode = 'speaker' | 'participant' | 'both';
```

Remove `'none'`.

- [ ] **Step 2: Update consumers' type imports**

```bash
rg -n "FooterMode|'none'" src/components/MainPanel/MainPanel.tsx src/stores/sessionStore.ts
```

In `sessionStore.ts`, narrow `LockedFooterMode`:

```typescript
export type LockedFooterMode = 'speaker' | 'participant' | 'both';
```

(Drop `'none'`.) Verify no MainPanel code still checks for `'none'`.

- [ ] **Step 3: Verify build and tests**

```bash
npx tsc --noEmit && npm run test
```

Expected: zero errors. If a `case 'none'` survived in a switch, tsc will flag it.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/ModePicker.tsx src/stores/sessionStore.ts
git commit -m "refactor(mode-picker): narrow FooterMode to three values"
```

---

### Task 7: Redesign ModeDevicePopover — per-row mute buttons; merge passthrough into participant row

**Files:**
- Modify: `src/components/MainPanel/ModeDevicePopover.tsx`
- Modify: `src/components/MainPanel/ModeDevicePopover.scss`
- Modify: `src/locales/en/translation.json` (+ other language JSONs)

- [ ] **Step 1: Replace the channel-row spec to use mute semantics**

Open `src/components/MainPanel/ModeDevicePopover.tsx`. Update imports:

```typescript
import {
  useAudioContext,
  useIsMicMuted, useIsMonitorMuted, useIsParticipantMuted,
  useSetMicMuted, useSetMonitorMuted, useSetParticipantMuted,
} from '../../stores/audioStore';
```

Drop the `ChannelKey` value `'passthrough'`:

```typescript
type ChannelKey = 'mic' | 'participant' | 'monitor';
```

Adjust `ChannelRowSpec`:

```typescript
interface ChannelRowSpec {
  key: ChannelKey;
  icon: LucideIcon;
  label: string;
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  isMuted: boolean;
  onMuteToggle: () => void;
  onSelectDevice: (d: AudioDevice) => void;
  /** True when row is in scope and has no device picked. */
  isMissing: boolean;
}
```

- [ ] **Step 2: Build the rows from mode + mute flags**

Replace the existing `rows` `useMemo` body:

```typescript
const isMicMuted = useIsMicMuted();
const isMonitorMuted = useIsMonitorMuted();
const isParticipantMuted = useIsParticipantMuted();
const setMicMuted = useSetMicMuted();
const setMonitorMuted = useSetMonitorMuted();
const setParticipantMuted = useSetParticipantMuted();

const rows = useMemo<ChannelRowSpec[]>(() => {
  const list: ChannelRowSpec[] = [];
  const showMic = mode === 'speaker' || mode === 'both';
  const showMonitor = mode === 'speaker';                               // mutex-hidden in Both
  const showParticipant = mode === 'participant' || mode === 'both';

  if (showMic) {
    list.push({
      key: 'mic',
      icon: Mic,
      label: t('modePicker.deviceMic', 'Microphone'),
      devices: audioInputDevices,
      selectedDevice: selectedInputDevice,
      isMuted: isMicMuted,
      onMuteToggle: () => setMicMuted(!isMicMuted),
      onSelectDevice: (d) => { selectInputDevice(d); setMicMuted(false); },
      isMissing: !selectedInputDevice,
    });
  }

  if (showMonitor) {
    list.push({
      key: 'monitor',
      icon: Volume2,
      label: t('modePicker.deviceSpeakerMonitor', 'Speaker monitor'),
      devices: audioMonitorDevices,
      selectedDevice: selectedMonitorDevice,
      isMuted: isMonitorMuted,
      onMuteToggle: () => setMonitorMuted(!isMonitorMuted),
      onSelectDevice: (d) => { selectMonitorDevice(d); setMonitorMuted(false); },
      isMissing: false, // monitor is optional
    });
  }

  if (showParticipant) {
    // Platform-conditional secondary control:
    //   - electron: pick the system audio source to capture
    //   - extension: pick the passthrough output device (tab capture is implicit)
    const devices = isExtension() ? audioMonitorDevices : (systemAudioSources ?? []) as AudioDevice[];
    const selectedDevice = isExtension()
      ? selectedParticipantOutput
      : ((selectedParticipantSource ?? null) as AudioDevice | null);
    const onSelectDevice = (d: AudioDevice) => {
      if (isExtension()) {
        selectParticipantOutput(d);
      } else {
        selectSystemAudioSource(d as any);
      }
      setParticipantMuted(false);
    };
    list.push({
      key: 'participant',
      icon: AudioLines,
      label: isExtension()
        ? t('modePicker.deviceParticipantOutput', 'Participant output')
        : t('modePicker.deviceParticipantSource', 'Participant source'),
      devices,
      selectedDevice,
      isMuted: isParticipantMuted,
      onMuteToggle: () => setParticipantMuted(!isParticipantMuted),
      onSelectDevice,
      isMissing: !isExtension() && !selectedDevice, // extension always has implicit source
    });
  }

  return list;
}, [
  mode,
  audioInputDevices, selectedInputDevice, isMicMuted,
  audioMonitorDevices, selectedMonitorDevice, isMonitorMuted,
  systemAudioSources, selectedParticipantSource, selectedParticipantOutput, isParticipantMuted,
  selectInputDevice, selectMonitorDevice, selectSystemAudioSource, selectParticipantOutput,
  setMicMuted, setMonitorMuted, setParticipantMuted,
  t,
]);
```

Also pull `mode` from store at the top:

```typescript
const mode = useMode();
```

- [ ] **Step 3: Replace the row render — add a mute button, drop the Off device-list entry**

In the JSX `rows.map(...)` body, replace the device-list rendering. The summary text becomes:

```typescript
const summaryText = (row: ChannelRowSpec): { text: string; cls: string } => {
  if (row.isMuted) {
    return { text: t('modePicker.muted', 'Muted'), cls: 'mode-device-popover__summary--off' };
  }
  if (!row.selectedDevice) {
    return { text: t('modePicker.notSelected', 'Not selected'), cls: 'mode-device-popover__summary--missing' };
  }
  return { text: row.selectedDevice.label || row.selectedDevice.deviceId, cls: '' };
};
```

In the row header button, add an icon mute toggle as a sibling — keep the row click-to-expand intact:

```tsx
<div className={`mode-device-popover__row${isExpanded ? ' mode-device-popover__row--expanded' : ''}`}>
  <button
    type="button"
    className="mode-device-popover__row-main"
    onClick={() => setExpanded(isExpanded ? null : row.key)}
    aria-expanded={isExpanded}
  >
    <Icon size={14} className="mode-device-popover__row-icon" />
    <span className="mode-device-popover__row-label">{row.label}</span>
    <span className={`mode-device-popover__summary ${summary.cls}`}>{summary.text}</span>
  </button>
  <button
    type="button"
    className="mode-device-popover__mute-btn"
    onClick={(e) => { e.stopPropagation(); row.onMuteToggle(); }}
    aria-pressed={row.isMuted}
    aria-label={row.isMuted
      ? t('modePicker.unmute', 'Unmute {{label}}', { label: row.label })
      : t('modePicker.mute', 'Mute {{label}}', { label: row.label })}
    title={row.isMuted ? t('modePicker.unmute', 'Unmute {{label}}') : t('modePicker.mute', 'Mute {{label}}')}
  >
    {row.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
  </button>
  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
</div>
```

Add `MicOff` to the lucide-react import. Note: re-use `MicOff` icon for all three rows is OK (visual intent is the same — "muted"); if a designer wants per-channel icons later, swap then.

In the expanded device list, remove the `--off` pseudo-entry entirely (the leading Off button block):

```tsx
{isExpanded && (
  <div className="mode-device-popover__device-list" role="listbox" aria-label={row.label}>
    {row.devices.map((d) => {
      const selected = row.selectedDevice?.deviceId === d.deviceId;
      return (
        <button
          key={d.deviceId}
          type="button"
          className={`mode-device-popover__device-row${selected ? ' mode-device-popover__device-row--selected' : ''}`}
          onClick={() => row.onSelectDevice(d)}
        >
          <span>{d.label || d.deviceId}</span>
          {selected && <span className="mode-device-popover__indicator" />}
        </button>
      );
    })}
  </div>
)}
```

- [ ] **Step 4: Update SCSS for the mute button and the row layout split**

In `src/components/MainPanel/ModeDevicePopover.scss`, add styles for `.mode-device-popover__row-main` (the click-to-expand region, flex-1) and `.mode-device-popover__mute-btn` (icon button, neutral hover, pressed-state ring). Keep visual weight similar to existing row controls.

If the current `.mode-device-popover__row` uses a `<button>` directly, split into a wrapping `<div>` and an inner clickable region as shown above so the mute button isn't nested inside another button (HTML invariance).

- [ ] **Step 5: Add new i18n keys to `src/locales/en/translation.json`**

Locate the `modePicker` namespace and add:

```json
"mute": "Mute {{label}}",
"unmute": "Unmute {{label}}",
"muted": "Muted",
"deviceParticipantOutput": "Participant output"
```

- [ ] **Step 6: Mirror the keys in every other locale file**

For each `src/locales/<lang>/translation.json` (35 locales), add the same keys with translations — minimum English fallback if no translation is provided. The build should still pass with English fallback per i18next config.

```bash
for f in src/locales/*/translation.json; do
  echo "=== $f ==="
  rg '"modePicker"' "$f" | head -1
done
```

Use this list to verify all locales contain the namespace. For each, add the four new keys (with English text as fallback if no translation is on hand).

- [ ] **Step 7: Verify build and tests**

```bash
npx tsc --noEmit && npm run test
```

- [ ] **Step 8: Manual smoke check**

```bash
npm run dev
```

Open popover in Speaker mode — three rows: mic / monitor / (no participant). Click mic mute → mic row shows "Muted". Click again → unmute. Verify electron and extension popover behavior; in extension's Participants/Both mode, the participant row's expanded list shows output devices.

- [ ] **Step 9: Commit**

```bash
git add src/components/MainPanel/ModeDevicePopover.tsx src/components/MainPanel/ModeDevicePopover.scss src/locales/
git commit -m "refactor(popover): per-row mute buttons; merge passthrough into participant row"
```

---

### Task 8: Migrate AudioDeviceSection + SystemAudioSection

Replace `isDeviceOn` toggles with mute toggles. Drop monitor-mutex `disabled`. Use `mode` to drive "in scope" greying.

**Files:**
- Modify: `src/components/Settings/sections/AudioDeviceSection.tsx`
- Modify: `src/components/Settings/sections/SystemAudioSection.tsx`

- [ ] **Step 1: AudioDeviceSection — replace `isDeviceOn` with mute flag**

In `src/components/Settings/sections/AudioDeviceSection.tsx`, update the `useAudioContext` destructure to add `isMicMuted`, `isMonitorMuted`, `setMicMuted`, `setMonitorMuted`. Replace the two `DeviceList` props:

```tsx
<DeviceList
  // ... existing
  isDeviceOn={!isMicMuted}
  onDeviceToggle={() => setMicMuted(!isMicMuted)}
  toggleAriaLabel={t('audioPanel.muteMicrophone', 'Mute microphone')}
/>
```

(And the equivalent for the monitor list using `isMonitorMuted` / `setMonitorMuted`.)

The `disabled={isSessionActive}` flag — already implemented via the `lockMic` / `lockMonitor` props passed from `SimpleSettings` / `AdvancedSettings` — remains correct. Mode-based scope is handled there.

- [ ] **Step 2: SystemAudioSection — replace `isSystemAudioCaptureEnabled` toggle with participant mute**

In `src/components/Settings/sections/SystemAudioSection.tsx`, add to the destructure:

```typescript
const isParticipantMuted = useIsParticipantMuted();
const setParticipantMuted = useSetParticipantMuted();
```

Find the `DeviceList`/toggle that currently keys on `isSystemAudioCaptureEnabled` (lines 247, 263). Switch its `isDeviceOn` to `!isParticipantMuted` and `onDeviceToggle` to `() => setParticipantMuted(!isParticipantMuted)`.

Remove the monitor-mutex `disabled` flag at line 255 (`disabled={isSessionActive || isMonitorDeviceOn}` → `disabled={isSessionActive}`). The mutex is now intent-only and enforced by mode visibility.

If the section still relies on `toggleSystemAudioCapture` or `setSystemAudioCaptureEnabled` for additional behavior (auto-loading sources etc., lines 100–135), keep the calls but trigger them off `setParticipantMuted` instead — when unmuting, re-load sources if needed.

- [ ] **Step 3: Verify build and tests**

```bash
npx tsc --noEmit && npm run test
```

- [ ] **Step 4: Manual smoke check**

Toggle the mute switches in settings; verify the popover and waveform mirror the change.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/AudioDeviceSection.tsx src/components/Settings/sections/SystemAudioSection.tsx
git commit -m "refactor(settings): replace device on/off toggles with mute toggles"
```

---

### Task 9: Migrate LanguageSection + ProviderSection + Simple/AdvancedSettings

Drop reads of `isSystemAudioCaptureEnabled` for the intent question; use a derived `isParticipantChannelInScope`.

**Files:**
- Modify: `src/components/Settings/sections/LanguageSection.tsx`
- Modify: `src/components/Settings/sections/ProviderSection.tsx`
- Modify: `src/components/Settings/SimpleSettings/SimpleSettings.tsx`
- Modify: `src/components/Settings/AdvancedSettings/AdvancedSettings.tsx`

- [ ] **Step 1: Add `isParticipantChannelInScope` selector to the store**

In `src/stores/audioStore.ts`, after the hook declarations, add:

```typescript
export const useIsParticipantChannelInScope = () =>
  useAudioStore((state) => state.mode === 'participant' || state.mode === 'both');

export const useIsSpeakerChannelInScope = () =>
  useAudioStore((state) => state.mode === 'speaker' || state.mode === 'both');

export const useIsMonitorChannelInScope = () =>
  useAudioStore((state) => state.mode === 'speaker');
```

- [ ] **Step 2: Update LanguageSection**

In `src/components/Settings/sections/LanguageSection.tsx` line 77, replace:

```typescript
const isSystemAudioCaptureEnabled = useIsSystemAudioCaptureEnabled();
```

with:

```typescript
const isParticipantChannelInScope = useIsParticipantChannelInScope();
```

And update the consumers (lines 313, 316) to use the new variable. Semantics match — both ask "is the participant channel relevant to this UI right now?"

- [ ] **Step 3: Update ProviderSection**

In `src/components/Settings/sections/ProviderSection.tsx`, replace `isSystemAudioCaptureEnabled` (line 103, 129, 134, 471) with `isParticipantChannelInScope` and update reads accordingly.

- [ ] **Step 4: Update SimpleSettings + AdvancedSettings lock formulas**

These already read `lockedMode` from sessionStore. Confirm the formulas at:

- `SimpleSettings.tsx`: `lockMic`/`lockParticipant`/`lockMonitor` derived from `lockedMode`
- `AdvancedSettings.tsx` (lines 73–75): same formulas

The formulas reference `'speaker'`, `'participant'`, `'both'`. With `lockedMode` narrowed in Task 6, the `'none'` cases are dead and tsc will flag them. Delete the dead arms.

- [ ] **Step 5: Verify build and tests**

```bash
npx tsc --noEmit && npm run test
```

- [ ] **Step 6: Commit**

```bash
git add src/stores/audioStore.ts src/components/Settings/sections/LanguageSection.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/SimpleSettings/SimpleSettings.tsx src/components/Settings/AdvancedSettings/AdvancedSettings.tsx
git commit -m "refactor(settings): consumers read isParticipantChannelInScope"
```

---

### Task 10: Cleanup — remove legacy state, setters, hooks, storage keys

After all consumers migrated (Tasks 4–9), the legacy fields and bridge are unused. Delete them.

**Files:**
- Modify: `src/stores/audioStore.ts`
- Modify: `src/stores/audioStore.test.ts`

- [ ] **Step 1: Verify no remaining consumers**

```bash
rg -n 'isInputDeviceOn|setInputDeviceOn|useIsInputDeviceOn|useSetInputDeviceOn|toggleInputDeviceState' src/ -g '*.ts' -g '*.tsx' 2>/dev/null
rg -n 'isMonitorDeviceOn|setMonitorDeviceOn|useIsMonitorDeviceOn|useSetMonitorDeviceOn|toggleMonitorDeviceState' src/ -g '*.ts' -g '*.tsx' 2>/dev/null
rg -n 'isSystemAudioCaptureEnabled|setSystemAudioCaptureEnabled|useIsSystemAudioCaptureEnabled|useSetSystemAudioCaptureEnabled|toggleSystemAudioCapture' src/ -g '*.ts' -g '*.tsx' 2>/dev/null
```

Expected: hits only inside `audioStore.ts` (the bridge implementation), `audioStore.test.ts` (legacy tests being removed), and the migration block (still reads legacy storage keys to derive new state — keep until the next major release).

If hits appear in other files, fix them before deleting.

- [ ] **Step 2: Delete legacy state fields, setters, and hooks**

Remove from `src/stores/audioStore.ts`:

- Interface fields `isInputDeviceOn`, `isMonitorDeviceOn`, `isSystemAudioCaptureEnabled`
- Initial state for those fields
- Actions `setInputDeviceOn`, `toggleInputDeviceState`, `setMonitorDeviceOn`, `toggleMonitorDeviceState`, `setSystemAudioCaptureEnabled`, `toggleSystemAudioCapture`
- Hooks `useIsInputDeviceOn`, `useSetInputDeviceOn`, `useIsMonitorDeviceOn`, `useSetMonitorDeviceOn`, `useIsSystemAudioCaptureEnabled`, `useSetSystemAudioCaptureEnabled`
- Aggregate-hook entries in `useAudioContext` / `useAudioActions` for the above

Remove the bridge writes from the **new** setters (`setMode`, `setMicMuted`, `setMonitorMuted`, `setParticipantMuted`) — they no longer need to keep legacy fields in sync.

Keep the **migration reads** in hydration (legacy storage keys → new state). These are now the only legacy code left and can be removed in a future release after the adoption window.

- [ ] **Step 3: Remove legacy tests**

In `src/stores/audioStore.test.ts`, delete the `describe('audioStore — set-style actions', ...)` block (the four legacy tests at the top of the file). Keep the mode/mute tests.

- [ ] **Step 4: Verify build and full tests**

```bash
npx tsc --noEmit && npm run test
```

Expected: zero errors, all tests pass.

- [ ] **Step 5: Re-grep for leftover references**

```bash
rg -n 'isInputDeviceOn|isMonitorDeviceOn|isSystemAudioCaptureEnabled' src/ -g '*.ts' -g '*.tsx' 2>/dev/null
```

Expected: only hits in `audioStore.ts` migration block, no consumer reads.

- [ ] **Step 6: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts
git commit -m "refactor(audio): remove legacy on/off flags and bridge"
```

---

### Task 11: Acceptance walkthrough

Execute the four scenarios from the spec and document results. Fix any regressions discovered.

**Files:**
- Read-only verification. Document in commit message or PR description.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Open in browser. Sign in or use existing session.

- [ ] **Step 2: Scenario 1 — pre-session, all muted**

- Switch to Both mode via mode picker.
- Open popover. Mute mic, mute participant.
- Verify start button is enabled (devices selected for both channels).
- Click start. Both clients should connect (check LogsPanel).
- Verify waveforms are flat.
- Unmute mic from popover. Verify mic waveform comes alive; speaking produces translation.
- Re-mute mic. Verify waveform flattens, no further translation chunks sent.
- Repeat for participant on a tab/system source.

- [ ] **Step 3: Scenario 2 — mode switch with all muted**

- End the session if active.
- Mute all three channels.
- Cycle through Speaker → Participant → Both → Speaker via picker.
- Verify the picker always has an active segment (no `'none'`).
- Verify that on each switch, the newly-in-scope channel's mute flag flips back to false (its row in popover shows the device, not "Muted").
- Verify monitor mute is sticky across mode changes (re-enter Speaker mode and monitor still shows "Muted" if it was).

- [ ] **Step 4: Scenario 3 — mid-session waveform parity**

- Start a session in Both mode with mic and participant both unmuted.
- Speak into mic — mic waveform animates.
- Mute mic — mic waveform goes flat within one frame. Speaking produces nothing.
- Unmute mic — waveform animates again, translation resumes.
- Repeat for participant.

- [ ] **Step 5: Scenario 4 — platform parity for participant**

- On electron: open popover in Participants mode. The participant row's expanded list shows system audio sources. Mute / unmute works.
- On extension (Chrome): the participant row's expanded list shows output devices (audio monitor devices). Mute stops the tab capture entirely; tab audio plays via the browser's default route (verify by listening to the tab's normal audio).
- Unmute restores capture to the selected output device.

- [ ] **Step 6: Document and commit**

If any scenarios failed, fix them in a follow-up task and re-run. If all passed:

```bash
git commit --allow-empty -m "chore(audio): uniform-mute-semantics acceptance verified"
```

End of plan.
