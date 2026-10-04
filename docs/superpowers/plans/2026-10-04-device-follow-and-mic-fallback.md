# Device Follow and Microphone Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sokuji follows the OS's audio devices as they change, and a microphone that goes away mid-run no longer ends the run: the source reopens it, falls back to another real input, or waits. A notice says which, and Sokuji switches back automatically.

**Architecture:**
- The device store alone decides which device is in use. A debounced `devicechange` listener calls a light `syncDevices()`, which re-lists the devices and applies one pure selection rule: the saved device first, so it switches back.
- The microphone source follows the store's selection. On a device problem it marks the device unusable and lets the store choose again; with nothing left it waits instead of ending.
- Three notices carry the device names. One uses a new `info` level, drawn with the existing neutral `.system` bubble.

**Tech Stack:** TypeScript, React, Zustand (`subscribeWithSelector`), Vitest + jsdom, i18next catalogs (`src/locales/*/translation.json`, 30 locales).

**Spec:** `docs/superpowers/specs/2026-10-04-device-follow-and-mic-fallback-design.md`

**Working copy:** worktree `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/mac-driver-adhoc-sign`, branch `worktree-mac-repair-refresh-devices`. It already carries `23aa94df` (refresh on audio-system recovery) and the spec. Run every command from the worktree root.

## Global Constraints

**The selection rule:**
- Input: the saved device (listed, not virtual, not unusable) → the current device (listed, not unusable) → the first real input (not virtual, not loopback, not unusable) → none, which is the waiting state.
- Output: the saved device → the current device → the first non-virtual output → any output → none.
- Devices match by `deviceId` only.

**Selection writes:**
- An automatic choice is never persisted. Only `selectInputDevice` / `selectMonitorDevice` (the user's pick) write `audio.selectedInputDeviceId` / `audio.selectedMonitorDeviceId`.
- `syncDevices` never changes `isMicMuted`. The startup rule (no real mic → mute and persist) stays in `refreshDevices`.
- `syncDevices` never runs the `getUserMedia` warm-up, never lists participant applications, and changes no selection when the listing is incomplete (an input without a label, or the listing failed).

**Timing:** `devicechange` is debounced 500 ms. Sync is single-flight: a change during a sync queues exactly one more.

**Unusable inputs:** in-memory only. A mark clears when the device leaves the list or when the user selects it.

**Notice codes:**

| Code | Level | Params |
|---|---|---|
| `mic_lost_using_other` | warning | `{ lost, device }` |
| `mic_lost_waiting` | warning | `{ lost }` |
| `mic_now_using` | **info** | `{ device }` |

- Every locale catalog carries `notices.<code>`, and `mainPanel.notice` ("Notice").
- `src/locales/en/translation.json`'s `notices` must equal `NOTICE_WORDS` word for word.

**Code style:**
- Record failures with `reportError` / `reportWarning` (`src/lib/diagnostics/report.ts`), never `console.error` / `console.warn`. `consoleLedger.consistency.test.ts` counts them.
- Comments in English. Conventional commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Pushing:** do not push or open a PR. jiangzhuo decides that.

**Baseline:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` printed 96 at `23aa94df` (2026-10-04). Re-measure once before Task 1 and write the number down. A task is clean when it adds none in the files it touched (`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "<touched file>"`).

## Review Focus

1. **A device lost while the mic is muted** (or push-to-talk not held): the source must still fall back or wait, with the same notices, and stay muted on the new device. Covered in Task 8.
2. **Only Sokuji's own virtual mic or an OS loopback input ("Stereo Mix", "Monitor of …") left:** wait. Never fall back to it, or Sokuji transcribes its own speech. Covered in Tasks 1 and 3.
3. **The user stops the session while a loss is being handled:** no recorder is left open and no notice appears afterwards. Covered in Task 8.
4. **A `devicechange` before the microphone permission is granted** (the extension side panel, first run): no permission prompt, no red toast, no selection change. Covered in Tasks 2 and 3.
5. **The device listing itself fails during a sync:** lists and selections stay as they were. A failure must never look like "every device is gone". Covered in Task 3.

---

### Task 1: The selection rule

**Files:**
- Create: `src/lib/audio/deviceChoice.ts`
- Create: `src/lib/audio/deviceChoice.test.ts`
- Modify: `src/stores/audioStore.ts:70-88` (move `pickDefaultInputDevice` out, re-export it)

**Interfaces:**
- Produces:
  - `chooseInput(choice: DeviceChoice): AudioDevice | null`
  - `chooseOutput(choice: DeviceChoice): AudioDevice | null`
  - `pickDefaultInputDevice(inputs: readonly AudioDevice[]): AudioDevice | null`
  - `interface DeviceChoice { devices: readonly AudioDevice[]; savedId: string | null; currentId: string | null; unusable?: ReadonlySet<string> }`

- [ ] **Step 1: Write the failing test**

`src/lib/audio/deviceChoice.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AudioDevice } from '../../stores/audioStore';
import { chooseInput, chooseOutput, pickDefaultInputDevice } from './deviceChoice';

const real = (deviceId: string, label = deviceId): AudioDevice => ({ deviceId, label, isVirtual: false });
const virtualMic: AudioDevice = { deviceId: 'virtual', label: 'Sokuji_Virtual_Mic', isVirtual: true };
const loopback: AudioDevice = { deviceId: 'loop', label: 'Monitor of Built-in Audio', isVirtual: false };

describe('chooseInput', () => {
  it('picks the saved device when it is listed, over the current one: this is what switches back', () => {
    const devices = [real('b'), real('a')];
    expect(chooseInput({ devices, savedId: 'a', currentId: 'b' })?.deviceId).toBe('a');
  });

  it('keeps the current device when the saved one is gone', () => {
    expect(chooseInput({ devices: [real('c'), real('b')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('b');
  });

  it('falls back to the first real input, skipping virtual and loopback inputs, when both are gone', () => {
    expect(chooseInput({ devices: [virtualMic, loopback, real('c')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('c');
  });

  it('never restores a saved virtual device', () => {
    expect(chooseInput({ devices: [virtualMic, real('c')], savedId: 'virtual', currentId: null })?.deviceId).toBe('c');
  });

  it('skips inputs marked unusable, the saved and the current one included', () => {
    const devices = [real('a'), real('b'), real('c')];
    expect(chooseInput({ devices, savedId: 'a', currentId: 'b', unusable: new Set(['a', 'b']) })?.deviceId).toBe('c');
  });

  it('returns null — the waiting state — when only virtual and loopback inputs are left', () => {
    expect(chooseInput({ devices: [virtualMic, loopback], savedId: 'a', currentId: 'a' })).toBeNull();
    expect(chooseInput({ devices: [], savedId: null, currentId: null })).toBeNull();
  });
});

describe('chooseOutput', () => {
  const virtualSpeaker: AudioDevice = { deviceId: 'vs', label: 'Sokuji_Virtual_Speaker', isVirtual: true };

  it('picks the saved output, then the current one, then the first non-virtual, then any', () => {
    expect(chooseOutput({ devices: [real('b'), real('a')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('a');
    expect(chooseOutput({ devices: [real('b')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('b');
    expect(chooseOutput({ devices: [virtualSpeaker, real('c')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('c');
    expect(chooseOutput({ devices: [virtualSpeaker], savedId: null, currentId: null })?.deviceId).toBe('vs');
    expect(chooseOutput({ devices: [], savedId: null, currentId: null })).toBeNull();
  });
});

describe('pickDefaultInputDevice', () => {
  it('is still exported from the audio store, for its existing callers', async () => {
    const store = await import('../../stores/audioStore');
    expect(store.pickDefaultInputDevice).toBe(pickDefaultInputDevice);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio/deviceChoice.test.ts`
Expected: FAIL — `Failed to resolve import "./deviceChoice"`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/audio/deviceChoice.ts`:

```ts
/**
 * Which device to use, given the OS's list (spec 2026-10-04 "device follow",
 * section 1). One rule for the startup refresh, the refresh buttons and the
 * automatic sync, so the three agree — and the saved device comes first, which
 * is what switches back to the user's own device when it returns.
 */
import type { AudioDevice } from '../../stores/audioStore';
import { isLoopbackInput } from '../../utils/audioDevices';

export interface DeviceChoice {
  devices: readonly AudioDevice[];
  /** The user's own pick, as persisted; never a fallback. */
  savedId: string | null;
  /** What is selected now. */
  currentId: string | null;
  /** Inputs that failed to open this session (`audioStore.markInputUnusable`). */
  unusable?: ReadonlySet<string>;
}

/**
 * Pick a default microphone from an enumerated input list, excluding virtual
 * ones (e.g. Sokuji's own "Sokuji_Virtual_Mic" — the monitor of Sokuji's own
 * virtual speaker, meant for other apps to consume, not for Sokuji to listen
 * to itself). Returns null when only virtual/loopback devices are available
 * rather than falling back to one — auto-selecting a loopback device as the
 * mic would feed Sokuji's own TTS output back into ASR as "user speech",
 * creating a self-sustaining transcription loop (observed on machines with
 * no physical microphone, where a virtual device is the only input listed).
 *
 * OS loopback-style inputs ("Stereo Mix", PulseAudio sink monitors,
 * VoiceMeeter outputs) carry isVirtual: false — they are real OS devices and
 * must stay manually selectable (warned) — but they re-capture system output
 * just the same, so automatic selection skips them by label too.
 */
export function pickDefaultInputDevice(inputs: readonly AudioDevice[]): AudioDevice | null {
  return inputs.find((device) => !device.isVirtual && !isLoopbackInput(device)) ?? null;
}

/** The microphone to use: the saved one, else the current one, else the first real input; null when none is left. */
export function chooseInput({ devices, savedId, currentId, unusable = new Set() }: DeviceChoice): AudioDevice | null {
  const usable = devices.filter((device) => !unusable.has(device.deviceId));
  // A saved virtual device is refused: an old auto-select bug persisted Sokuji's own virtual mic.
  const saved = savedId ? usable.find((device) => device.deviceId === savedId && !device.isVirtual) : undefined;
  const current = currentId ? usable.find((device) => device.deviceId === currentId) : undefined;
  return saved ?? current ?? pickDefaultInputDevice(usable);
}

/** The monitor output to use: the saved one, else the current one, else the first non-virtual, else any. */
export function chooseOutput({ devices, savedId, currentId }: DeviceChoice): AudioDevice | null {
  const byId = (id: string | null) => (id ? devices.find((device) => device.deviceId === id) : undefined);
  return byId(savedId) ?? byId(currentId) ?? devices.find((device) => !device.isVirtual) ?? devices[0] ?? null;
}
```

In `src/stores/audioStore.ts`:
- Delete the `pickDefaultInputDevice` function and its doc comment (lines 70–88). The doc comment moved verbatim above.
- After the imports, add:

```ts
import { chooseInput, chooseOutput, pickDefaultInputDevice } from '../lib/audio/deviceChoice';
export { pickDefaultInputDevice };
```

(`chooseInput` / `chooseOutput` are used from Task 3 on; importing them now is fine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/audio/deviceChoice.test.ts src/stores/audioStore.test.ts`
Expected: PASS. The existing `pickDefaultInputDevice` tests in `audioStore.test.ts` now exercise the moved function.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/deviceChoice.ts src/lib/audio/deviceChoice.test.ts src/stores/audioStore.ts
git commit -m "refactor(audio): one rule for which device to use, saved device first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A listing that can skip the permission warm-up and says whether it is complete

**Files:**
- Modify: `src/lib/audio/devices.ts:20-93` (`listAudioDevices`)
- Test: `src/lib/audio/devices.test.ts`

**Interfaces:**
- Produces:
  - `listAudioDevices(options?: { warmUp?: boolean }): Promise<DeviceLists>`
  - `interface DeviceLists { inputs: AudioDevice[]; outputs: AudioDevice[]; complete: boolean }`

  `complete` is true when enumeration succeeded and every input carries its label. `warmUp` defaults to true, today's behaviour.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('listAudioDevices', …)` block in `src/lib/audio/devices.test.ts`:

```ts
  it('reports a labelled listing as complete', async () => {
    setMediaDevices(vi.fn(async () => makeStream()), vi.fn(async () => LABELED));
    expect((await listAudioDevices()).complete).toBe(true);
  });

  it('with warmUp: false, never opens the microphone and reports an unlabelled listing as incomplete', async () => {
    const getUserMedia = vi.fn(async () => makeStream());
    setMediaDevices(getUserMedia, vi.fn(async () => UNLABELED));

    const devices = await listAudioDevices({ warmUp: false });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(document.getElementById('sokuji-mic-error')).toBeNull();
    expect(devices.complete).toBe(false);
    expect(devices.inputs.map((d) => d.deviceId)).toEqual(['mic-1']);
  });
```

Change the assertion in `'records an error and returns empty lists when enumeration itself throws'` from
`expect(devices).toEqual({ inputs: [], outputs: [] });` to
`expect(devices).toEqual({ inputs: [], outputs: [], complete: false });`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio/devices.test.ts`
Expected: FAIL — `complete` is `undefined`; the `warmUp: false` case calls `getUserMedia`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/audio/devices.ts`:
- Above `listAudioDevices`, add:

```ts
/** The OS's audio devices, and whether the list can be trusted to tell virtual and loopback inputs apart. */
export interface DeviceLists {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  /** Enumeration succeeded and every input carries its label: without labels, virtual and loopback inputs look like real ones. */
  complete: boolean;
}
```

- Change the signature to:

```ts
export async function listAudioDevices({ warmUp = true }: { warmUp?: boolean } = {}): Promise<DeviceLists> {
```

- Change `if (needsMicrophoneWarmup) {` to `if (needsMicrophoneWarmup && warmUp) {`. The comment above it stays.
- Replace `return { inputs, outputs };` with:

```ts
    const complete = !devices.some((d) => d.kind === 'audioinput' && d.label === '');
    return { inputs, outputs, complete };
```

- In the `catch`, replace `return { inputs: [], outputs: [] };` with `return { inputs: [], outputs: [], complete: false };`.
- Update the module comment's "`audioStore.refreshDevices` is the only caller." to "`audioStore.refreshDevices` and `audioStore.syncDevices` are the only callers."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/audio/devices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/devices.ts src/lib/audio/devices.test.ts
git commit -m "feat(audio): list devices without the permission warm-up, and say whether the list is complete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The store follows the OS (`syncDevices`, unusable inputs, saved ids in memory)

**Files:**
- Modify: `src/stores/audioStore.ts`:
  - state and actions interface (`interface AudioStore`, ~lines 88-143);
  - initial state (~146-162);
  - `selectInputDevice` / `selectMonitorDevice` (~216-229);
  - `refreshDevices` (~336-552).
- Test: `src/stores/audioStore.test.ts`

**Interfaces:**
- Consumes:
  - `chooseInput`, `chooseOutput` (Task 1);
  - `listAudioDevices({ warmUp })`, `DeviceLists.complete` (Task 2).
- Produces, on the store:
  - `syncDevices(): Promise<void>`
  - `markInputUnusable(deviceId: string): void`
  - state:
    - `savedInputDeviceId: string | null`
    - `savedMonitorDeviceId: string | null`
    - `unusableInputIds: readonly string[]`
    - `devicesLoaded: boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/audioStore.test.ts`:

```ts
describe('audioStore — following the OS (syncDevices)', () => {
  const real = (deviceId: string, label = deviceId): AudioDevice => ({ deviceId, label, isVirtual: false });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({
      devicesLoaded: true,
      audioInputDevices: [real('mic-a'), real('mic-b')],
      audioMonitorDevices: [real('spk-a')],
      selectedInputDevice: real('mic-a'),
      selectedMonitorDevice: real('spk-a'),
      savedInputDeviceId: 'mic-a',
      savedMonitorDeviceId: 'spk-a',
      unusableInputIds: [],
      isMicMuted: false,
    } as any);
  });

  it('falls back to another real microphone when the selected one leaves the list, without saving it', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    await flush();
    const s = useAudioStore.getState();
    expect(s.selectedInputDevice?.deviceId).toBe('mic-b');
    expect(s.savedInputDeviceId).toBe('mic-a');
    expect(localStorage.getItem('audio.selectedInputDeviceId') ?? '').not.toContain('mic-b');
  });

  it('switches back to the saved microphone when it returns', async () => {
    useAudioStore.setState({ selectedInputDevice: real('mic-b') });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-b'), real('mic-a')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('waits — no selection — when only virtual or loopback inputs remain, and leaves mute alone', async () => {
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'v', label: 'Sokuji_Virtual_Mic', isVirtual: true }, { deviceId: 'l', label: 'Monitor of Built-in Audio', isVirtual: false }],
      outputs: [real('spk-a')],
      complete: true,
    });
    await useAudioStore.getState().syncDevices();
    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(false);
  });

  it('changes no selection when the listing has no labels, and keeps the lists when the listing failed', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('Microphone 12345...')], outputs: [], complete: false });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');

    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [], complete: false });
    useAudioStore.setState({ audioInputDevices: [real('mic-a')] });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().audioInputDevices.map((d) => d.deviceId)).toEqual(['mic-a']);
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('never warms up the permission, lists applications or re-reads settings', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(mockListAudioDevices).toHaveBeenCalledWith({ warmUp: false });
    expect(mockListSystemAudioSources).not.toHaveBeenCalled();
  });

  it('does nothing before the first refresh has loaded the saved devices', async () => {
    useAudioStore.setState({ devicesLoaded: false });
    await useAudioStore.getState().syncDevices();
    expect(mockListAudioDevices).not.toHaveBeenCalled();
  });

  it('leaves an unusable input out until it leaves the list; back again, it is chosen again', async () => {
    useAudioStore.setState({ unusableInputIds: ['mic-a'] });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-b');

    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-b')], outputs: [], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().unusableInputIds).toEqual([]);

    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('markInputUnusable leaves the device out and re-syncs at once', async () => {
    mockListAudioDevices.mockResolvedValue({ inputs: [real('mic-a'), real('mic-b')], outputs: [], complete: true });
    useAudioStore.getState().markInputUnusable('mic-a');
    await flush();
    expect(useAudioStore.getState().unusableInputIds).toEqual(['mic-a']);
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-b');
  });

  it("a user's pick clears its unusable mark and becomes the saved device", () => {
    useAudioStore.setState({ unusableInputIds: ['mic-b'] });
    useAudioStore.getState().selectInputDevice(real('mic-b'));
    const s = useAudioStore.getState();
    expect(s.unusableInputIds).toEqual([]);
    expect(s.savedInputDeviceId).toBe('mic-b');
  });

  it('keeps the same device object when the choice did not change, so subscribers see no churn', async () => {
    const before = useAudioStore.getState().selectedInputDevice;
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice).toBe(before);
  });
});

describe('audioStore — refreshDevices and the saved device', () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-b', label: 'B', isVirtual: false }, devicesLoaded: false } as any);
  });

  it('prefers the saved microphone over the current one, remembers the saved ids, and marks the devices loaded', async () => {
    localStorage.setItem('audio.selectedInputDeviceId', 'mic-a');
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'mic-b', label: 'B', isVirtual: false }, { deviceId: 'mic-a', label: 'A', isVirtual: false }],
      outputs: [],
      complete: true,
    });
    await useAudioStore.getState().refreshDevices();
    const s = useAudioStore.getState();
    expect(s.selectedInputDevice?.deviceId).toBe('mic-a');
    expect(s.savedInputDeviceId).toBe('mic-a');
    expect(s.devicesLoaded).toBe(true);
  });
});
```

Also widen the module mock at the top of the file, so the new `complete` field and the `{ warmUp }` argument type-check while the existing tests' two-field values still compile. Replace the `mockListAudioDevices` line with:

```ts
const mockListAudioDevices = vi.hoisted(() => vi.fn(async (_options?: { warmUp?: boolean }): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[]; complete?: boolean }> => ({ inputs: [], outputs: [] })));
```

and in the file's top-level `beforeEach`, make the default listing complete: `mockListAudioDevices.mockReset().mockResolvedValue({ inputs: [], outputs: [], complete: true });`.

(The existing test `'does not restore a persisted device id that resolves to a virtual device'` already writes `audio.selectedInputDeviceId` as a plain `localStorage` value, and the new refresh test does the same.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/audioStore.test.ts`
Expected: FAIL — `syncDevices is not a function`, `markInputUnusable is not a function`, `savedInputDeviceId` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/stores/audioStore.ts`:

1. In `interface AudioStore`, after `persistedParticipantAppKey`, add:

```ts
  /** The user's own picks, as persisted: the devices the choice returns to (spec 2026-10-04 §1). */
  savedInputDeviceId: string | null;
  savedMonitorDeviceId: string | null;
  /** Inputs that failed to open this session; never persisted. A mark clears when its device leaves the list or the user picks it. */
  unusableInputIds: readonly string[];
  /** Set once the first `refreshDevices` has loaded the saved devices; `syncDevices` waits for it. */
  devicesLoaded: boolean;
```

and in the actions, after `refreshDevices`:

```ts
  /** Follows the OS (spec 2026-10-04 §1): re-lists the devices and applies the choice. Never persists, never mutes, never prompts. */
  syncDevices: () => Promise<void>;
  /** The microphone could not open this device: leave it out of the choice, and choose again now. */
  markInputUnusable: (deviceId: string) => void;
```

2. In the initial state, after `persistedParticipantAppKey: null,`:

```ts
    savedInputDeviceId: null,
    savedMonitorDeviceId: null,
    unusableInputIds: [],
    devicesLoaded: false,
```

3. Replace `selectInputDevice` and `selectMonitorDevice` with:

```ts
    selectInputDevice: (device) => {
      console.info(`[Sokuji] [AudioStore] Selected input device: ${device.label} (${device.deviceId})`);
      set({
        selectedInputDevice: device,
        savedInputDeviceId: device.deviceId,
        // The user asked for this one: try it again even if it failed before.
        unusableInputIds: get().unusableInputIds.filter((id) => id !== device.deviceId),
      });

      // Persist the selected device ID
      void persistSetting(STORAGE_KEYS.SELECTED_INPUT_DEVICE_ID, device.deviceId);
    },
    selectMonitorDevice: (device) => {
      console.info(`[Sokuji] [AudioStore] Selected monitor device: ${device.label} (${device.deviceId})`);
      set({ selectedMonitorDevice: device, savedMonitorDeviceId: device.deviceId });

      // Persist the selected device ID
      void persistSetting(STORAGE_KEYS.SELECTED_MONITOR_DEVICE_ID, device.deviceId);
    },
```

4. In `refreshDevices`, right after the two `const saved…DeviceId = await settingsService.getSetting…` lines:

```ts
        set({ savedInputDeviceId: savedInputDeviceId || null, savedMonitorDeviceId: savedMonitorDeviceId || null });
```

5. In `refreshDevices`, replace the whole input block — from `// Try to restore saved input device, or select default` down to the end of its `if (!currentInputDevice || …) { … }` — with:

```ts
        // Restore the saved input device, or choose one (deviceChoice.ts: the
        // same rule the automatic sync applies).
        const input = chooseInput({
          devices: devices.inputs,
          savedId: savedInputDeviceId || null,
          currentId: get().selectedInputDevice?.deviceId ?? null,
          unusable: new Set(get().unusableInputIds),
        });
        if (input) {
          if (input.deviceId !== get().selectedInputDevice?.deviceId) set({ selectedInputDevice: input });
        } else {
          // No real microphone available — either no input devices were
          // enumerated at all, or the only ones present are virtual/loopback
          // (e.g. Sokuji's own "Sokuji_Virtual_Mic"). Clear the selection
          // AND mute: canStartSession (MainPanel.tsx) gates purely on
          // !!selectedInputDevice — by design "mute state does not block
          // start" — so leaving a stale device object in place would let
          // a session start (and later unmute) against a device that's
          // no longer connected or was never meant to be listened to.
          // The automatic sync never does this: only a refresh mutes.
          const currentlyMuted = get().isMicMuted;
          set({ selectedInputDevice: null, isMicMuted: true });
          if (!currentlyMuted) {
            reportWarning('AudioStore', 'No real microphone found — clearing selection and turning mic off');
            void persistSetting(STORAGE_KEYS.IS_MIC_MUTED, true);
          }
        }
```

6. In `refreshDevices`, replace the whole monitor block — from `// Try to restore saved monitor device, or select default` through the end of its `if (!currentMonitorDevice || …) { … }` — with:

```ts
        // Restore the saved monitor device, or choose one (deviceChoice.ts).
        const defaultMonitorDevice = chooseOutput({
          devices: devices.outputs,
          savedId: savedMonitorDeviceId || null,
          currentId: get().selectedMonitorDevice?.deviceId ?? null,
        });
        if (defaultMonitorDevice?.deviceId !== get().selectedMonitorDevice?.deviceId) set({ selectedMonitorDevice: defaultMonitorDevice });
```

7. In `refreshDevices`'s `finally`, change `set({ isLoading: false });` to `set({ isLoading: false, devicesLoaded: true });`.

8. After `refreshDevices`, add:

```ts
    syncDevices: async () => {
      // Before the first refresh the saved devices are unknown: a choice now
      // would bypass them. That refresh reads the devices itself.
      if (!get().devicesLoaded) return;
      const { inputs, outputs, complete } = await listAudioDevices({ warmUp: false });
      if (!complete) {
        // A failed listing, or one without labels (no microphone permission
        // yet): virtual and loopback inputs cannot be told from real ones, so
        // the lists may change but no choice does — and a failure that looks
        // like "every device is gone" changes nothing at all.
        if (inputs.length > 0 || outputs.length > 0) set({ audioInputDevices: inputs, audioMonitorDevices: outputs });
        return;
      }
      const state = get();
      // A mark lasts until its device leaves the list: replugged, it is tried again.
      const unusableInputIds = state.unusableInputIds.filter((id) => inputs.some((device) => device.deviceId === id));
      const input = chooseInput({
        devices: inputs,
        savedId: state.savedInputDeviceId,
        currentId: state.selectedInputDevice?.deviceId ?? null,
        unusable: new Set(unusableInputIds),
      });
      const monitor = chooseOutput({ devices: outputs, savedId: state.savedMonitorDeviceId, currentId: state.selectedMonitorDevice?.deviceId ?? null });
      // The same object when the choice did not change: subscribers see no churn.
      const keep = (current: AudioDevice | null, next: AudioDevice | null) =>
        current && next && current.deviceId === next.deviceId ? current : next;
      set({
        audioInputDevices: inputs,
        audioMonitorDevices: outputs,
        unusableInputIds,
        selectedInputDevice: keep(state.selectedInputDevice, input),
        selectedMonitorDevice: keep(state.selectedMonitorDevice, monitor),
      });
    },

    markInputUnusable: (deviceId) => {
      if (!get().unusableInputIds.includes(deviceId)) set({ unusableInputIds: [...get().unusableInputIds, deviceId] });
      void get().syncDevices();
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/audioStore.test.ts src/lib/audio/deviceChoice.test.ts`
Expected: PASS, including every pre-existing `refreshDevices` test.

- [ ] **Step 5: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts
git commit -m "feat(audio): syncDevices follows the OS's devices without persisting, muting or prompting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Watch `devicechange`, and sync when the virtual device recovers

**Files:**
- Create: `src/lib/audio/deviceWatch.ts`
- Create: `src/lib/audio/deviceWatch.test.ts`
- Modify: `src/routes/Home.tsx:18-38`
- Modify: `src/stores/audioSystemStore.ts` (the `recovered` refresh from `23aa94df`)
- Test: `src/stores/audioSystemStore.test.ts`

**Interfaces:**
- Consumes: `useAudioStore.getState().syncDevices()` (Task 3).
- Produces: `watchDevices(options: DeviceWatchOptions): () => void`, where `interface DeviceWatchOptions { sync(): Promise<unknown>; mediaDevices?: Pick<MediaDevices, 'addEventListener' | 'removeEventListener'>; delayMs?: number }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/deviceWatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchDevices } from './deviceWatch';

const devices = () => new EventTarget() as unknown as Pick<MediaDevices, 'addEventListener' | 'removeEventListener'> & EventTarget;
const change = (target: EventTarget) => target.dispatchEvent(new Event('devicechange'));

describe('watchDevices', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('syncs once after a burst of changes settles', async () => {
    const target = devices();
    const sync = vi.fn(async () => {});
    watchDevices({ sync, mediaDevices: target, delayMs: 500 });
    change(target);
    await vi.advanceTimersByTimeAsync(200);
    change(target);
    change(target);
    await vi.advanceTimersByTimeAsync(499);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('runs one sync at a time, and a change during a sync queues exactly one more', async () => {
    const target = devices();
    let finish!: () => void;
    const sync = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    watchDevices({ sync, mediaDevices: target, delayMs: 10 });
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(1);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('stops listening when unwatched, a pending sync included', async () => {
    const target = devices();
    const sync = vi.fn(async () => {});
    const unwatch = watchDevices({ sync, mediaDevices: target, delayMs: 10 });
    change(target);
    unwatch();
    await vi.advanceTimersByTimeAsync(50);
    change(target);
    await vi.advanceTimersByTimeAsync(50);
    expect(sync).not.toHaveBeenCalled();
  });

  it('survives a sync that throws', async () => {
    const target = devices();
    const sync = vi.fn(async () => { throw new Error('boom'); });
    watchDevices({ sync, mediaDevices: target, delayMs: 10 });
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    change(target);
    await vi.advanceTimersByTimeAsync(10);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('does nothing where there are no media devices', () => {
    expect(() => watchDevices({ sync: vi.fn(), mediaDevices: undefined })()).not.toThrow();
  });
});
```

In `src/stores/audioSystemStore.test.ts`, change the test `'re-reads the device list when the virtual device comes back'` to assert `syncDevices`:

```ts
  it('re-reads the device list when the virtual device comes back', () => {
    const syncDevices = vi.fn(async () => {});
    useAudioStore.setState({ syncDevices });
    const { receivedHandlers } = mockElectron();
    useAudioSystemStore.setState({ status: 'unavailable', reason: 'mac-driver-not-loaded' });

    useAudioSystemStore.getState().initListeners();
    receivedHandlers['audio-status']({ ok: true, platform: 'darwin' });

    expect(syncDevices).toHaveBeenCalledTimes(1);
  });
```

Change `'leaves the device list alone when the status is first learned or did not change'` the same way: replace `refreshDevices` with `syncDevices` (`const syncDevices = vi.fn(async () => {}); useAudioStore.setState({ syncDevices }); … expect(syncDevices).not.toHaveBeenCalled();`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/audio/deviceWatch.test.ts src/stores/audioSystemStore.test.ts`
Expected: FAIL — `./deviceWatch` does not resolve; `syncDevices` is not called (the store still calls `refreshDevices`).

- [ ] **Step 3: Write minimal implementation**

`src/lib/audio/deviceWatch.ts`:

```ts
/**
 * Follows the OS's audio devices (spec 2026-10-04 §1): `devicechange`,
 * debounced — a Bluetooth connect fires a burst — and one sync at a time, a
 * change during a sync queuing exactly one more.
 */
import { describeCause, reportWarning } from '../diagnostics/report';

export interface DeviceWatchOptions {
  sync(): Promise<unknown>;
  mediaDevices?: Pick<MediaDevices, 'addEventListener' | 'removeEventListener'>;
  delayMs?: number;
}

export function watchDevices({ sync, mediaDevices = globalThis.navigator?.mediaDevices, delayMs = 500 }: DeviceWatchOptions): () => void {
  if (!mediaDevices?.addEventListener) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let stopped = false;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await sync();
        } catch (error) {
          reportWarning('DeviceWatch', `Following the audio devices failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'devices:sync' });
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };

  const onChange = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  };

  mediaDevices.addEventListener('devicechange', onChange);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    mediaDevices.removeEventListener('devicechange', onChange);
  };
}
```

`src/routes/Home.tsx`:
- Add `import { watchDevices } from '../lib/audio/deviceWatch';`.
- At the end of the existing mount effect (after `void loadSessionStores();`), add:

```ts

    // Follow the OS's devices from here on (spec 2026-10-04): plugging,
    // unplugging, a Bluetooth reconnect, a repaired virtual device.
    return watchDevices({ sync: () => useAudioStore.getState().syncDevices() });
```

`src/stores/audioSystemStore.ts`: in `applyStatus`, change `if (recovered) void useAudioStore.getState().refreshDevices();` to `if (recovered) void useAudioStore.getState().syncDevices();`. Keep its comment, adding a final sentence: "It stays beside the `devicechange` watch: whether macOS fires that after Core Audio restarts is unverified."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/audio/deviceWatch.test.ts src/stores/audioSystemStore.test.ts src/components/AudioSystemBanner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/deviceWatch.ts src/lib/audio/deviceWatch.test.ts src/routes/Home.tsx src/stores/audioSystemStore.ts src/stores/audioSystemStore.test.ts
git commit -m "feat(audio): follow devicechange, and sync when the virtual device recovers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Source notices carry params and an `info` level to the conversation

**Files:**
- Modify:
  - `src/lib/session/source.ts:4-8` (`SourceNotice`)
  - `src/lib/conversation/types.ts:38` (`Notice.severity`)
  - `src/lib/projection/types.ts:42` (notice entry `severity`)
  - `src/lib/conversation/Conversation.ts:128-132` (`degraded`)
  - `src/lib/session/run.ts:464-465` (`onDegraded`)
  - `src/providers/fake/source.ts:11-12, 57-59` (`degrade`)
- Test: `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces:
  - `SourceNotice { code; message; params?: Record<string, string | number>; severity?: 'warning' | 'info' }`
  - `Notice.severity: 'error' | 'warning' | 'info'`
  - `Conversation.degraded(code, message, extra?: { params?; severity? })`
  - `FakeSource.degrade(message, code?, extra?: { params?; severity? })`

- [ ] **Step 1: Write the failing test**

In `src/lib/session/runner.test.ts`, after `"records a degraded source on its leg with the source's code, throttled, and keeps running"`, add:

```ts
  it("carries a source notice's params and level onto its leg", async () => {
    const { runner, sources } = setup();
    await runner.start();
    sources[0].degrade('Now using the microphone "USB Mic".', 'mic_now_using', { params: { device: 'USB Mic' }, severity: 'info' });
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].notices).toEqual([
      expect.objectContaining({ severity: 'info', code: 'mic_now_using', params: { device: 'USB Mic' } }),
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/session/runner.test.ts -t "params and level"`
Expected: FAIL — the notice has `severity: 'warning'` and no `params`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/session/source.ts`:

```ts
/** A degradation a source reports: still delivering, but worse. The code lets a surface localize it. */
export interface SourceNotice {
  code: string;
  message: string;
  /** Filled into the notice's words, e.g. a device's name. */
  params?: Record<string, string | number>;
  /** 'warning' unless said; 'info' is good news, e.g. a microphone back in use. */
  severity?: 'warning' | 'info';
}
```

`src/lib/conversation/types.ts:38`: `severity: 'error' | 'warning' | 'info';`

`src/lib/projection/types.ts:42`: `severity: 'error' | 'warning' | 'info';`

`src/lib/conversation/Conversation.ts`, replace `degraded`:

```ts
  /** A degradation from outside the adapter's stream (a source's): a warning unless said, throttled per code like `degraded`. */
  degraded(code: string, message: string, extra: { params?: Record<string, string | number>; severity?: 'warning' | 'info' } = {}): void {
    if (!this.admitDegraded(code)) return;
    this.batch(() => this.addNotice({ severity: extra.severity ?? 'warning', message, code, params: extra.params }));
  }
```

`src/lib/session/run.ts`, the degradation watch:

```ts
    this.stack.defer(`${leg} degradation watch`, source.onDegraded(({ code, message, params, severity }) =>
      conversation.degraded(code, message, { params, severity })));
```

`src/providers/fake/source.ts`:
- Interface:

```ts
  /** Reports the capture as degraded, with a code (default 'source_degraded'), and optionally its params and level. */
  degrade(message: string, code?: string, extra?: Pick<SourceNotice, 'params' | 'severity'>): void;
```

- Implementation:

```ts
    degrade(message, code = 'source_degraded', extra = {}) {
      for (const listener of degradedListeners) listener({ code, message, ...extra });
    },
```

(Import `SourceNotice` as a type in the interface's file if it is not imported there already. The file already uses it for `degradedListeners`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/session src/lib/conversation src/lib/projection src/lib/export`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/source.ts src/lib/conversation/types.ts src/lib/projection/types.ts src/lib/conversation/Conversation.ts src/lib/session/run.ts src/providers/fake/source.ts src/lib/session/runner.test.ts
git commit -m "feat(session): a source notice carries params and an info level to its leg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The microphone notices' codes and words, in every locale

**Files:**
- Modify:
  - `src/lib/audio/capture/mic.ts` (export the three code constants only)
  - `src/lib/view/noticeText.ts` (`NOTICE_WORDS`)
  - `src/locales/*/translation.json` (30 catalogs: `notices.mic_*` ×3 and `mainPanel.notice`)
- Test: `src/lib/view/noticeText.test.ts`

**Interfaces:**
- Produces, in `mic.ts`:
  - `MIC_LOST_USING_OTHER = 'mic_lost_using_other'`
  - `MIC_LOST_WAITING = 'mic_lost_waiting'`
  - `MIC_NOW_USING = 'mic_now_using'`
- Catalog key `mainPanel.notice`, which Task 7 uses.

- [ ] **Step 1: Write the failing test**

In `src/lib/view/noticeText.test.ts`:
- Add `import { MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING } from '../audio/capture/mic';`.
- In `'has words for every code the runner, the capture and the adapters record'`, add `MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING` to the array after `LOOPBACK_DENIED`.
- Add a test:

```ts
  it("names the microphone's devices in its notices", () => {
    expect(noticeText(plainT, { code: 'mic_lost_using_other', message: 'x', params: { lost: 'AirPods', device: 'MacBook Microphone' } }))
      .toBe('The microphone “AirPods” went away, so “MacBook Microphone” is being used instead.');
    expect(noticeText(plainT, { code: 'mic_now_using', message: 'x', params: { device: 'AirPods' } })).toBe('Now using the microphone “AirPods”.');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/view/noticeText.test.ts`
Expected: FAIL — the `mic.ts` imports are undefined, and the codes have no words.

- [ ] **Step 3: Write minimal implementation**

`src/lib/audio/capture/mic.ts`, after the imports:

```ts
/** The notices the microphone raises when its device changes under it (#593; spec 2026-10-04 §3). */
export const MIC_LOST_USING_OTHER = 'mic_lost_using_other';
export const MIC_LOST_WAITING = 'mic_lost_waiting';
export const MIC_NOW_USING = 'mic_now_using';
```

`src/lib/view/noticeText.ts`, in `NOTICE_WORDS`, at the end of the capture's degradations (after `loopback_denied`):

```ts
  // The microphone's device changing under it (#593).
  mic_lost_using_other: 'The microphone “{{lost}}” went away, so “{{device}}” is being used instead.',
  mic_lost_waiting: 'The microphone went away. Translation of your speech resumes when a microphone is connected.',
  mic_now_using: 'Now using the microphone “{{device}}”.',
```

Catalogs: save this script as `$CLAUDE_JOB_DIR/tmp/add-mic-notices.cjs`, or any scratch path outside the repo. Run it from the worktree root with `node <path>`. It inserts each key after its anchor and leaves every other byte alone, since the catalogs round-trip through `JSON.stringify(…, null, 2) + '\n'` exactly.

```js
const fs = require('fs');
const W = {
  en: ['The microphone “{{lost}}” went away, so “{{device}}” is being used instead.', 'The microphone went away. Translation of your speech resumes when a microphone is connected.', 'Now using the microphone “{{device}}”.', 'Notice'],
  zh_CN: ['麦克风「{{lost}}」已断开，现在改用「{{device}}」。', '麦克风已断开。接上麦克风后会自动继续翻译你说的话。', '现在使用麦克风「{{device}}」。', '提示'],
  zh_TW: ['麥克風「{{lost}}」已中斷連線，現在改用「{{device}}」。', '麥克風已中斷連線。接上麥克風後會自動繼續翻譯你說的話。', '現在使用麥克風「{{device}}」。', '提示'],
  ja: ['マイク「{{lost}}」が切断されたため、代わりに「{{device}}」を使用しています。', 'マイクが切断されました。マイクが接続されると、あなたの音声の翻訳を自動的に再開します。', 'マイク「{{device}}」を使用しています。', 'お知らせ'],
  ko: ['마이크 ‘{{lost}}’의 연결이 끊어져 대신 ‘{{device}}’을(를) 사용합니다.', '마이크 연결이 끊어졌습니다. 마이크가 연결되면 내 음성의 번역이 자동으로 다시 시작됩니다.', '이제 마이크 ‘{{device}}’을(를) 사용합니다.', '알림'],
  de: ['Das Mikrofon „{{lost}}“ wurde getrennt, daher wird stattdessen „{{device}}“ verwendet.', 'Das Mikrofon wurde getrennt. Die Übersetzung Ihrer Sprache wird fortgesetzt, sobald ein Mikrofon verbunden ist.', 'Jetzt wird das Mikrofon „{{device}}“ verwendet.', 'Hinweis'],
  es: ['El micrófono «{{lost}}» se desconectó, así que ahora se usa «{{device}}».', 'El micrófono se desconectó. La traducción de tu voz se reanudará cuando se conecte un micrófono.', 'Ahora se usa el micrófono «{{device}}».', 'Aviso'],
  fr: ['Le microphone « {{lost}} » a été déconnecté ; « {{device}} » est utilisé à la place.', 'Le microphone a été déconnecté. La traduction de votre voix reprendra dès qu’un microphone sera connecté.', 'Le microphone « {{device}} » est maintenant utilisé.', 'Information'],
  it: ['Il microfono «{{lost}}» è stato scollegato, quindi ora viene usato «{{device}}».', 'Il microfono è stato scollegato. La traduzione della tua voce riprenderà quando verrà collegato un microfono.', 'Ora viene usato il microfono «{{device}}».', 'Nota'],
  pt_BR: ['O microfone “{{lost}}” foi desconectado, então “{{device}}” está sendo usado no lugar.', 'O microfone foi desconectado. A tradução da sua fala será retomada quando um microfone for conectado.', 'Agora usando o microfone “{{device}}”.', 'Informação'],
  pt_PT: ['O microfone “{{lost}}” foi desligado, pelo que está agora a ser utilizado “{{device}}”.', 'O microfone foi desligado. A tradução da sua fala será retomada quando for ligado um microfone.', 'A utilizar agora o microfone “{{device}}”.', 'Informação'],
  ru: ['Микрофон «{{lost}}» отключён, поэтому вместо него используется «{{device}}».', 'Микрофон отключён. Перевод вашей речи продолжится, когда будет подключён микрофон.', 'Теперь используется микрофон «{{device}}».', 'Уведомление'],
  uk: ['Мікрофон «{{lost}}» від’єднано, тому замість нього використовується «{{device}}».', 'Мікрофон від’єднано. Переклад вашого мовлення продовжиться, щойно буде під’єднано мікрофон.', 'Тепер використовується мікрофон «{{device}}».', 'Сповіщення'],
  pl: ['Mikrofon „{{lost}}” został odłączony, więc zamiast niego używany jest „{{device}}”.', 'Mikrofon został odłączony. Tłumaczenie Twojej mowy zostanie wznowione po podłączeniu mikrofonu.', 'Teraz używany jest mikrofon „{{device}}”.', 'Informacja'],
  nl: ['De microfoon “{{lost}}” is losgekoppeld, dus wordt nu “{{device}}” gebruikt.', 'De microfoon is losgekoppeld. De vertaling van je spraak gaat verder zodra er een microfoon is aangesloten.', 'Nu wordt de microfoon “{{device}}” gebruikt.', 'Melding'],
  sv: ['Mikrofonen ”{{lost}}” kopplades från, så ”{{device}}” används i stället.', 'Mikrofonen kopplades från. Översättningen av ditt tal fortsätter när en mikrofon ansluts.', 'Nu används mikrofonen ”{{device}}”.', 'Meddelande'],
  fi: ['Mikrofoni ”{{lost}}” irrotettiin, joten sen sijaan käytetään mikrofonia ”{{device}}”.', 'Mikrofoni irrotettiin. Puheesi kääntäminen jatkuu, kun mikrofoni yhdistetään.', 'Nyt käytetään mikrofonia ”{{device}}”.', 'Ilmoitus'],
  tr: ['“{{lost}}” mikrofonunun bağlantısı kesildi, bu yüzden bunun yerine “{{device}}” kullanılıyor.', 'Mikrofonun bağlantısı kesildi. Bir mikrofon bağlandığında konuşmanızın çevirisi devam edecek.', 'Artık “{{device}}” mikrofonu kullanılıyor.', 'Bildirim'],
  ar: ['انقطع الميكروفون «{{lost}}»، لذا يُستخدم «{{device}}» بدلاً منه.', 'انقطع الميكروفون. ستُستأنف ترجمة كلامك عند توصيل ميكروفون.', 'يُستخدم الآن الميكروفون «{{device}}».', 'إشعار'],
  he: ['המיקרופון “{{lost}}” נותק, ולכן נעשה שימוש ב־“{{device}}” במקומו.', 'המיקרופון נותק. תרגום הדיבור שלך יימשך כשיחובר מיקרופון.', 'כעת נעשה שימוש במיקרופון “{{device}}”.', 'הודעה'],
  fa: ['میکروفون «{{lost}}» قطع شد، بنابراین اکنون به جای آن از «{{device}}» استفاده می‌شود.', 'میکروفون قطع شد. ترجمه صحبت شما پس از اتصال یک میکروفون ادامه می‌یابد.', 'اکنون از میکروفون «{{device}}» استفاده می‌شود.', 'اطلاعیه'],
  hi: ['माइक्रोफोन “{{lost}}” डिस्कनेक्ट हो गया, इसलिए अब उसकी जगह “{{device}}” का उपयोग हो रहा है।', 'माइक्रोफोन डिस्कनेक्ट हो गया। माइक्रोफोन जुड़ते ही आपकी बोली का अनुवाद फिर से शुरू हो जाएगा।', 'अब माइक्रोफोन “{{device}}” का उपयोग हो रहा है।', 'सूचना'],
  bn: ['মাইক্রোফোন “{{lost}}” সংযোগ বিচ্ছিন্ন হয়েছে, তাই এখন এর বদলে “{{device}}” ব্যবহার করা হচ্ছে।', 'মাইক্রোফোনের সংযোগ বিচ্ছিন্ন হয়েছে। একটি মাইক্রোফোন সংযুক্ত হলে আপনার কথার অনুবাদ আবার চালু হবে।', 'এখন মাইক্রোফোন “{{device}}” ব্যবহার করা হচ্ছে।', 'বিজ্ঞপ্তি'],
  ta: ['மைக்ரோஃபோன் “{{lost}}” துண்டிக்கப்பட்டது, எனவே அதற்குப் பதிலாக “{{device}}” பயன்படுத்தப்படுகிறது.', 'மைக்ரோஃபோன் துண்டிக்கப்பட்டது. ஒரு மைக்ரோஃபோன் இணைக்கப்பட்டதும் உங்கள் பேச்சின் மொழிபெயர்ப்பு தொடரும்.', 'இப்போது “{{device}}” மைக்ரோஃபோன் பயன்படுத்தப்படுகிறது.', 'அறிவிப்பு'],
  te: ['మైక్రోఫోన్ “{{lost}}” డిస్‌కనెక్ట్ అయింది, కాబట్టి దానికి బదులుగా “{{device}}” ఉపయోగించబడుతోంది.', 'మైక్రోఫోన్ డిస్‌కనెక్ట్ అయింది. మైక్రోఫోన్ కనెక్ట్ అయిన వెంటనే మీ మాటల అనువాదం మళ్లీ కొనసాగుతుంది.', 'ఇప్పుడు మైక్రోఫోన్ “{{device}}” ఉపయోగించబడుతోంది.', 'నోటీసు'],
  th: ['ไมโครโฟน “{{lost}}” ถูกตัดการเชื่อมต่อ จึงเปลี่ยนไปใช้ “{{device}}” แทน', 'ไมโครโฟนถูกตัดการเชื่อมต่อ การแปลเสียงพูดของคุณจะดำเนินต่อเมื่อเชื่อมต่อไมโครโฟน', 'กำลังใช้ไมโครโฟน “{{device}}”', 'ข้อมูล'],
  vi: ['Micrô “{{lost}}” đã bị ngắt kết nối, nên “{{device}}” đang được dùng thay thế.', 'Micrô đã bị ngắt kết nối. Việc dịch giọng nói của bạn sẽ tiếp tục khi có micrô được kết nối.', 'Đang dùng micrô “{{device}}”.', 'Thông báo'],
  id: ['Mikrofon “{{lost}}” terputus, jadi “{{device}}” digunakan sebagai gantinya.', 'Mikrofon terputus. Terjemahan ucapan Anda akan dilanjutkan saat mikrofon tersambung.', 'Sekarang menggunakan mikrofon “{{device}}”.', 'Pemberitahuan'],
  ms: ['Mikrofon “{{lost}}” terputus, jadi “{{device}}” digunakan sebagai ganti.', 'Mikrofon terputus. Terjemahan pertuturan anda akan bersambung apabila mikrofon disambungkan.', 'Kini menggunakan mikrofon “{{device}}”.', 'Notis'],
  fil: ['Nadiskonekta ang mikroponong “{{lost}}”, kaya “{{device}}” na ang ginagamit.', 'Nadiskonekta ang mikropono. Magpapatuloy ang pagsasalin ng iyong pananalita kapag may nakakonektang mikropono.', 'Ginagamit na ngayon ang mikroponong “{{device}}”.', 'Paunawa'],
};
const after = (obj, anchor, entries) => {
  if (!(anchor in obj)) throw new Error(`anchor ${anchor} missing`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === anchor) Object.assign(out, entries);
  }
  return out;
};
const dirs = fs.readdirSync('src/locales').filter((d) => fs.existsSync(`src/locales/${d}/translation.json`));
if (dirs.length !== Object.keys(W).length || dirs.some((d) => !W[d])) throw new Error(`locales differ: ${dirs.join(' ')}`);
for (const d of dirs) {
  const path = `src/locales/${d}/translation.json`;
  const cat = JSON.parse(fs.readFileSync(path, 'utf8'));
  const [usingOther, waiting, nowUsing, notice] = W[d];
  cat.notices = after(cat.notices, 'loopback_denied', { mic_lost_using_other: usingOther, mic_lost_waiting: waiting, mic_now_using: nowUsing });
  cat.mainPanel = after(cat.mainPanel, 'warning', { notice });
  fs.writeFileSync(path, JSON.stringify(cat, null, 2) + '\n');
}
console.log(`updated ${dirs.length} catalogs`);
```

Then check the diff only adds lines: `git diff --numstat -- src/locales | awk '$2 != 0'` must print nothing, and every locale file must show `4` added lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/view/noticeText.test.ts src/locales`
Expected: PASS. The tests cover `en.notices` equalling `NOTICE_WORDS`, every locale having en's keys, the `{{lost}}` / `{{device}}` placeholders preserved verbatim, and no empty strings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/capture/mic.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/locales
git commit -m "feat(i18n): words for the microphone's device notices, and a Notice label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Draw an `info` notice as a neutral bubble

**Files:**
- Modify: `src/components/Conversation/ConversationList.tsx:3` (icons) and `:189-213` (`NoticeBubble`)
- Test: `src/components/Conversation/ConversationList.test.tsx`

**Interfaces:**
- Consumes:
  - `Notice.severity === 'info'` (Task 5);
  - `mainPanel.notice` (Task 6);
  - the existing `.message-bubble.system` style (`MainPanel.scss:136`: grey, centred, italic, header shown).

- [ ] **Step 1: Write the failing test**

In `src/components/Conversation/ConversationList.test.tsx`, inside `describe('ConversationList — notices and the empty state', …)`, add:

```ts
  it('draws an info notice as the neutral system bubble, headed "Notice", not as an error', () => {
    const notice: DisplayItem = {
      kind: 'notice',
      notice: { kind: 'notice', id: 'n', leg: 'speaker', severity: 'info', message: 'Now using the microphone "USB Mic".', code: 'mic_now_using', params: { device: 'USB Mic' }, at: 0 },
    };
    const { container } = render(<ConversationList {...props({ items: [notice] })} />);
    expect(container.querySelector('.message-bubble.system')).not.toBeNull();
    expect(container.querySelector('.message-bubble.error')).toBeNull();
    expect(container.querySelector('.message-header')?.textContent).toBe('Notice');
    expect(container.querySelector('.error-content')).toBeNull();
    expect(container.querySelector('.message-content')?.textContent).toContain('Now using the microphone');
  });
```

(This file mocks `react-i18next` so that `t` returns its fallback string without interpolating. That is why the header reads `Notice`, and why the words are checked only up to the `{{device}}` placeholder. `noticeText.test.ts` checks the filled-in sentence.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Conversation/ConversationList.test.tsx -t "info notice"`
Expected: FAIL — the bubble renders with `.error` and the header `Error`.

- [ ] **Step 3: Write minimal implementation**

In `ConversationList.tsx`:
- Change the icon import to `import { AlertCircle, Info, Play, User, Users } from 'lucide-react';`.
- Replace `NoticeBubble`'s body:

```tsx
const NoticeBubble = memo(function NoticeBubble({ notice, action }: { notice: NoticeEntry; action: NoticeAction | null }) {
  const { t } = useTranslation();
  // A code-less notice with an empty message has no words at all: today's
  // bubble falls back to the same "Unknown error" rather than an empty line.
  const words = noticeText(t, notice) || t('mainPanel.unknownError', 'Unknown error');
  // Good news (a microphone back in use, spec 2026-10-04 §3): the neutral
  // system bubble, not the error one.
  if (notice.severity === 'info') {
    return (
      <div className="message-bubble system">
        <div className="message-header">
          <Info size={12} />
          {t('mainPanel.notice', 'Notice')}
        </div>
        <div className="message-content">{words}</div>
        {action && (
          <button type="button" className="message-action" onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
    );
  }
  const warning = notice.severity === 'warning';
  return (
    <div className={`message-bubble error${warning ? ' warning' : ''}`}>
      <div className="message-header">
        <AlertCircle size={12} />
        {warning ? t('mainPanel.warning', 'Warning') : t('mainPanel.error', 'Error')}
      </div>
      <div className="message-content error-content">{words}</div>
      {action && (
        <button type="button" className="message-action" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Conversation`
Expected: PASS.

- [ ] **Step 5: Render the three bubbles and look**

Render a page with `mic_lost_using_other` (warning), `mic_lost_waiting` (warning) and `mic_now_using` (info), in `zh_CN` and `en`. Use the headless-Chromium + CDP recipe from memory `sokuji-ui-decisions-by-rendering` (`npm run dev` page, or a scratch harness that mounts `ConversationList`). Save the screenshots under `$CLAUDE_JOB_DIR/tmp/mic-notices/`. Check:
- the info bubble is grey, centred and italic, with the ⓘ icon and the header 提示 / Notice;
- the warnings keep today's red style;
- a long device name wraps inside the bubble.

These screenshots go to jiangzhuo before merge.

- [ ] **Step 6: Commit**

```bash
git add src/components/Conversation/ConversationList.tsx src/components/Conversation/ConversationList.test.tsx
git commit -m "feat(ui): draw an info notice as the neutral system bubble

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The microphone keeps the run: reopen, fall back, wait

**Files:**
- Modify:
  - `src/lib/audio/capture/core.ts:14-15, 98-109` (`watch` takes an optional handler)
  - `src/lib/audio/capture/mic.ts` (whole `openMic`, and `MicSettings`)
  - `src/lib/audio/appCapture.ts:31-38` (`micSettings` binding)
- Test:
  - `src/lib/audio/capture/mic.test.ts`
  - `src/lib/audio/capture/core.test.ts`
  - `src/lib/audio/appCapture.test.ts`

**Interfaces:**
- Consumes:
  - `useAudioStore.getState().markInputUnusable(id)` (Task 3);
  - `SourceNotice.params / severity` (Task 5);
  - `MIC_*` constants (Task 6).
- Produces: `MicSettings`, which gains:
  - `deviceLabel(): string | undefined`
  - `isListed(deviceId: string): boolean`
  - `markUnusable(deviceId: string): void`
- Produces: `SourceCore.watch(stream, onEnded?: () => void): () => void`.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/capture/core.test.ts`: add

```ts
  it('hands an ended track to the given handler instead of ending the source', () => {
    const core = createSourceCore({ muted: () => false, release: async () => {} });
    const track = Object.assign(new EventTarget(), { readyState: 'live' }) as unknown as MediaStreamTrack;
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const handler = vi.fn();
    core.watch(stream, handler);
    track.dispatchEvent(new Event('ended'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(core.ended).toBe(false);
  });
```

(Use the file's existing imports; add `vi` and `createSourceCore` if they are not imported yet.)

`src/lib/audio/capture/mic.test.ts`:

1. Replace `settingsFixture` with this version, which also simulates the store's list, labels and unusable marks:

```ts
function settingsFixture(initial: { deviceId?: string; noiseSuppression?: NoiseSuppression; muted?: boolean } = {}, options: { onUnusable?: (id: string) => void } = {}) {
  let current = { deviceId: 'mic-1' as string | undefined, noiseSuppression: 'off' as NoiseSuppression, muted: false, ...initial };
  const labels: Record<string, string> = { 'mic-1': 'Built-in Mic', 'mic-2': 'USB Mic', 'mic-3': 'Webcam Mic' };
  const listed = new Set(['mic-1', 'mic-2', 'mic-3']);
  const unusable: string[] = [];
  const listeners = new Set<() => void>();
  const settings: MicSettings = {
    deviceId: () => current.deviceId,
    deviceLabel: () => (current.deviceId === undefined ? undefined : labels[current.deviceId] ?? current.deviceId),
    isListed: (id) => listed.has(id),
    markUnusable: (id) => {
      unusable.push(id);
      options.onUnusable?.(id);
    },
    noiseSuppression: () => current.noiseSuppression,
    muted: () => current.muted,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const set = (patch: Partial<typeof current>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  return { settings, set, listeners, listed, unusable };
}
```

2. Update the import line to:

```ts
import { MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING, openMic, type MicRecorder, type MicSettings, type NoiseSuppression } from './mic';
```

Drop the `TRACK_ENDED` import if nothing else in the file uses it.

3. Delete the tests `'ends with the reason when a device switch fails'` and `'ends when its device goes away'`.

4. In `'moves to a newly selected device in place, …'`, add `const degraded = vi.fn(); source.onDegraded(degraded);` after `source.onPcm(heard);`, and `expect(degraded).not.toHaveBeenCalled();` at the end. A user's switch in normal operation raises no notice.

5. Add a new `describe` at the end of the file:

```ts
describe('openMic — its device going away (#593)', () => {
  it('reopens the same device when its track ends and it opens again: no notice, no end', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-1', 'record']);
    expect(ended).not.toHaveBeenCalled();
    expect(degraded).not.toHaveBeenCalled();
  });

  it('moves to the device the store chooses next when the lost one will not reopen, and says which', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: 'mic-2' }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-1', 'begin:mic-2', 'record']);
    expect(fixture.unusable).toEqual(['mic-1']);
    expect(ended).not.toHaveBeenCalled();
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, severity: 'warning', params: { lost: 'Built-in Mic', device: 'USB Mic' } }));
  });

  it('raises the same notice, once, when the store moves on before the track ends', async () => {
    const fake = fakeRecorder();
    const fixture = settingsFixture();
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    fixture.listed.delete('mic-1');
    fixture.set({ deviceId: 'mic-2' });
    fake.endTrack();
    await settle();
    expect(fake.calls.filter((c) => c.startsWith('begin:'))).toEqual(['begin:mic-1', 'begin:mic-2']);
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'Built-in Mic', device: 'USB Mic' } }));
  });

  it('waits without opening any device when none is left, keeps the run, and picks up the next one with a notice', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: undefined }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls).not.toContain('begin:default');
    expect(ended).not.toHaveBeenCalled();
    expect(degraded).toHaveBeenLastCalledWith(expect.objectContaining({ code: MIC_LOST_WAITING, severity: 'warning', params: { lost: 'Built-in Mic' } }));

    fixture.set({ deviceId: 'mic-3' });
    await settle();
    expect(fake.calls.slice(-2)).toEqual(['begin:mic-3', 'record']);
    expect(degraded).toHaveBeenLastCalledWith(expect.objectContaining({ code: MIC_NOW_USING, severity: 'info', params: { device: 'Webcam Mic' } }));
    expect(degraded).toHaveBeenCalledTimes(2);
  });

  it('says "now using" once it leaves the fallback for the user\'s device coming back', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: 'mic-2' }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    fixture.listed.add('mic-1');
    fixture.set({ deviceId: 'mic-1' });
    await settle();
    expect(degraded).toHaveBeenLastCalledWith(expect.objectContaining({ code: MIC_NOW_USING, severity: 'info', params: { device: 'Built-in Mic' } }));
    // Back on the user's device: a later switch of theirs is a plain switch again.
    fixture.set({ deviceId: 'mic-3' });
    await settle();
    expect(degraded).toHaveBeenCalledTimes(2);
  });

  it('no longer ends the run when a switch fails: the device is marked unusable and the next one opens', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: () => fixture.set({ deviceId: 'mic-3' }) });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fixture.set({ deviceId: 'gone' });
    await settle();
    expect(ended).not.toHaveBeenCalled();
    expect(fixture.unusable).toEqual(['gone']);
    expect(fake.calls.slice(-2)).toEqual(['begin:mic-3', 'record']);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'gone', device: 'Webcam Mic' } }));
  });

  it('stays muted through a fallback', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({ muted: true }, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: 'mic-2' }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    fake.endTrack();
    await settle();
    fake.push();
    expect(heard).not.toHaveBeenCalled();
    fixture.set({ muted: false });
    await settle();
    fake.push();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('a stop during a loss leaves nothing open and says nothing more', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: () => fixture.set({ deviceId: 'mic-2' }) });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    fake.endTrack();
    await source.stop();
    await settle();
    expect(fake.calls[fake.calls.length - 1]).toBe('quit');
    expect(fake.calls).not.toContain('begin:mic-2');
    expect(degraded).not.toHaveBeenCalled();
  });

  it('refuses to start with no microphone selected, opening nothing', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture({ deviceId: undefined });
    await expect(openMic(settings, live(), () => fake.recorder)).rejects.toThrow(/no microphone/i);
    expect(fake.calls.filter((c) => c.startsWith('begin'))).toEqual([]);
  });
});
```

`src/lib/audio/appCapture.test.ts`, inside `describe('the settings the sources follow', …)`, add:

```ts
  it("reads the microphone's label and listing from the audio store, and marks a device unusable through it", () => {
    const markInputUnusable = vi.fn();
    useAudioStore.setState({
      selectedInputDevice: { deviceId: 'mic-1', label: 'USB Mic' },
      audioInputDevices: [{ deviceId: 'mic-1', label: 'USB Mic' }],
      markInputUnusable,
    } as never);
    const settings = micSettings();
    expect(settings.deviceLabel()).toBe('USB Mic');
    expect(settings.isListed('mic-1')).toBe(true);
    expect(settings.isListed('mic-2')).toBe(false);
    settings.markUnusable('mic-1');
    expect(markInputUnusable).toHaveBeenCalledWith('mic-1');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/audio/capture/mic.test.ts src/lib/audio/capture/core.test.ts src/lib/audio/appCapture.test.ts`
Expected: FAIL. `watch` ignores the handler; the source ends on a lost track and on a failed switch; there are no notices; `deviceLabel` / `isListed` / `markUnusable` are missing from the binding.

- [ ] **Step 3: Write minimal implementation**

`src/lib/audio/capture/core.ts`:
- Interface:

```ts
  /** Ends the source when the stream's audio track ends — or hands the end to `onEnded` instead; returns the unwatch. */
  watch(stream: MediaStream | null, onEnded?: () => void): () => void;
```

- Implementation:

```ts
    watch(stream, onEnded = () => end(TRACK_ENDED)) {
      const track = stream?.getAudioTracks()[0];
      if (!track) return () => {};
      // Already gone by the time anyone watched it: nothing will ever fire 'ended'.
      if (track.readyState === 'ended') {
        onEnded();
        return () => {};
      }
      const listener = () => onEnded();
      track.addEventListener('ended', listener);
      return () => track.removeEventListener('ended', listener);
    },
```

`src/lib/audio/capture/mic.ts`:
- Replace `MicSettings`:

```ts
/** The settings a microphone follows, read live. */
export interface MicSettings {
  /** The selected device; undefined while none is, and the source waits for one. */
  deviceId(): string | undefined;
  /** The selected device's name, for the notices. */
  deviceLabel(): string | undefined;
  /** Whether the OS still lists the device. */
  isListed(deviceId: string): boolean;
  /** The device would not open: the store leaves it out and chooses again (spec 2026-10-04 §2). */
  markUnusable(deviceId: string): void;
  noiseSuppression(): NoiseSuppression;
  muted(): boolean;
  /** Called when any of them may have changed. */
  subscribe(listener: () => void): () => void;
}
```

- Replace `openMic`'s body from `const recorder = createRecorder();` to the end:

```ts
  const recorder = createRecorder();
  let deviceId = settings.deviceId();
  /** The open device's name, kept from when it opened: a device that went away can no longer be looked up. */
  let label = settings.deviceLabel() ?? deviceId ?? '';
  let mode = settings.noiseSuppression();
  /** Whether the recorder has begun and not ended: only then is there anything to end. */
  let open = false;
  /** Which `begin` the watched track belongs to: a late `ended` from an earlier stream is ignored. */
  let generation = 0;
  /** The name of a device that went away, until the notice that says where the microphone went next. */
  let lost: string | null = null;
  /** On a fallback, or waiting: the next device the source opens gets a "now using" notice. */
  let displaced = false;
  let unwatch = () => {};
  let unsubscribe = () => {};
  let chain: Promise<void> = Promise.resolve();

  const close = async () => {
    unwatch();
    unwatch = () => {};
    if (!open) return;
    open = false;
    await recorder.end();
  };

  const core = createSourceCore({
    muted: () => settings.muted(),
    release: async () => {
      // `Source.stop` stops capturing before its first `await` (roadmap 1e-1): a
      // `pagehide` never awaits this, and a device switch in flight must not keep
      // the microphone open while it settles. `quit()` below still ends the recorder.
      for (const track of recorder.getStream()?.getTracks() ?? []) track.stop();
      unsubscribe();
      // A switch in flight finishes (or fails) before the recorder is disposed.
      await chain;
      unwatch();
      unwatch = () => {};
      open = false;
      // `quit()`, not `end()`: this recorder is not reused after this, so its GTCRN
      // worker (kept alive across `end()` for the device switch above) must go too.
      try {
        await recorder.quit();
      } catch (error) {
        reportWarning('Microphone', `Stopping the microphone failed: ${describeCause(error)}`, { dedupeKey: 'mic:end' });
      }
    },
  });

  /** Steps run one at a time, in order: a switch, a lost track, a noise-mode change. A failure not about a device ends the source. */
  const queue = (step: () => Promise<void>) => {
    chain = chain
      .then(step)
      .catch((error: unknown) => core.end(`The microphone failed: ${describeCause(error)}`));
  };

  const begin = async () => {
    if (!(await recorder.begin(deviceId))) throw new Error('The microphone could not be opened. Reload the page and try again.');
    open = true;
    label = settings.deviceLabel() ?? deviceId ?? '';
    const mine = ++generation;
    unwatch = core.watch(recorder.getStream(), () => queue(() => trackEnded(mine)));
    await recorder.record((data) => core.deliver(data.mono));
  };

  const notice = (code: string, message: string, params: Record<string, string>, severity: 'warning' | 'info' = 'warning') =>
    core.degrade({ code, message, params, severity });

  /** Opens `next` (or waits, for none) and says where the microphone went, when it went there because of a loss. */
  const switchTo = async (next: string | undefined) => {
    deviceId = next;
    await close();
    if (core.stopped) return;
    if (next === undefined) {
      if (lost !== null) {
        notice(MIC_LOST_WAITING, `The microphone "${lost}" went away; waiting for one to be connected.`, { lost });
        lost = null;
        displaced = true;
      }
      return;
    }
    try {
      await begin();
    } catch {
      // This device will not open: the store leaves it out and selects the
      // next one, which `follow` then opens. The failed one is reported as the
      // device that went away, unless one already did.
      lost ??= settings.deviceLabel() ?? next;
      settings.markUnusable(next);
      return;
    }
    if (lost !== null) {
      notice(MIC_LOST_USING_OTHER, `The microphone "${lost}" went away; using "${label}" instead.`, { lost, device: label });
      lost = null;
      displaced = true;
    } else if (displaced) {
      notice(MIC_NOW_USING, `Now using the microphone "${label}".`, { device: label }, 'info');
      displaced = false;
    }
  };

  /** The store's settings changed: follow the noise mode and the device. */
  const follow = async () => {
    if (core.stopped || core.ended) return;
    const nextMode = settings.noiseSuppression();
    if (nextMode !== mode) {
      mode = nextMode;
      await recorder.setNoiseSuppressionMode(mode);
    }
    const next = settings.deviceId();
    if (next === deviceId && (open || next === undefined)) return;
    // A move off a device the OS no longer lists is a loss, whether the sync
    // or the track's `ended` got here first.
    if (open && deviceId !== undefined && !settings.isListed(deviceId)) lost ??= label;
    await switchTo(next);
  };

  /** The open device's track ended: reopen it if it is still there, else let the store choose again. */
  const trackEnded = async (which: number) => {
    if (core.stopped || core.ended || which !== generation || !open) return;
    const gone = deviceId as string;
    lost ??= label;
    // The sync handled `devicechange` first and already chose another device.
    if (settings.deviceId() !== gone) {
      await switchTo(settings.deviceId());
      return;
    }
    await close();
    if (core.stopped) return;
    try {
      await begin();
      // A blip: the same device opened again, nothing to tell.
      lost = null;
    } catch {
      settings.markUnusable(gone);
    }
  };

  if (deviceId === undefined) {
    await core.stop();
    throw new Error('No microphone is selected. Choose one in Settings and try again.');
  }
  // Recorded now and applied when `begin` builds the graph.
  await recorder.setNoiseSuppressionMode(mode);
  try {
    await begin();
  } catch (error) {
    await core.stop();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }

  unsubscribe = settings.subscribe(() => queue(follow));
  return core;
```

Update the module's top comment to add: "When its device goes away it reopens it, follows the store's next choice, or waits for one (spec 2026-10-04 §2, #593); only `stop()`, or a failure that is not about a device, ends it."

`src/lib/audio/appCapture.ts`, `micSettings()`:

```ts
export function micSettings(): MicSettings {
  return {
    deviceId: () => audio().selectedInputDevice?.deviceId,
    deviceLabel: () => audio().selectedInputDevice?.label,
    isListed: (id) => audio().audioInputDevices.some((device) => device.deviceId === id),
    markUnusable: (id) => audio().markInputUnusable(id),
    noiseSuppression: () => audio().noiseSuppressionMode,
    muted: () => audio().isMicMuted,
    subscribe: onAudioChange,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/audio src/lib/session`
Expected: PASS, including the unchanged tests in `mic.test.ts`: open, mute, noise, a switch in place, stop once, and stop before a switch settles.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/capture/core.ts src/lib/audio/capture/core.test.ts src/lib/audio/capture/mic.ts src/lib/audio/capture/mic.test.ts src/lib/audio/appCapture.ts src/lib/audio/appCapture.test.ts
git commit -m "fix(capture): keep the run when the microphone goes away — reopen, fall back or wait

Fixes #593.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Whole-branch verification, and the live check on Linux

**Files:** none changed, unless a check fails.

- [ ] **Step 1: The full suite, types, build**

Run:
```bash
npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
npm run build > "$CLAUDE_JOB_DIR/tmp/build.log" 2>&1; echo "build exit=$?"
```

Expected:
- every test file passes;
- the error count equals the baseline written down before Task 1;
- the build exits 0.

- [ ] **Step 2: Simulated unplug and replug on this Linux box (PipeWire with the PulseAudio API)**

Create two inputs that look like real microphones:

```bash
pactl load-module module-null-sink sink_name=sk_test_a sink_properties=device.description=SkTestSinkA
pactl load-module module-null-sink sink_name=sk_test_b sink_properties=device.description=SkTestSinkB
pactl load-module module-remap-source master=sk_test_a.monitor source_name=sk_test_mic_a source_properties=device.description=SkTestMicA
pactl load-module module-remap-source master=sk_test_b.monitor source_name=sk_test_mic_b source_properties=device.description=SkTestMicB
pactl list short modules | grep sk_test
```

Record each module id: unloading the `remap-source` module is the unplug.

Run the development build with Vite (`npm run dev`, port 5173; if another worktree holds 5173 it moves to 5174, see memory `sokuji-worktree-vite-stale-transforms`). Then drive headless Chrome over CDP:

```bash
google-chrome --headless=new --remote-debugging-port=9333 --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --user-data-dir="$CLAUDE_JOB_DIR/tmp/sk-chrome" http://localhost:5173/
```

The driver is a Node script using the `ws` dev dependency. In order:
1. Pick the `fake` provider (development builds include it) and select **SkTestMicA** as the microphone in Settings.
2. Start a session.
3. Unload SkTestMicA's remap module. Expect: the session keeps running; the speaker leg shows the warning bubble "The microphone “SkTestMicA” went away, so “SkTestMicB” is being used instead."; the Settings microphone shows SkTestMicB.
4. Unload SkTestMicB's remap module. Expect: the warning "The microphone went away. …", and the session still running.
5. Reload SkTestMicA (`pactl load-module module-remap-source master=sk_test_a.monitor source_name=sk_test_mic_a source_properties=device.description=SkTestMicA`). Expect: the neutral "Notice" bubble "Now using the microphone “SkTestMicA”." and SkTestMicA selected again.
6. Stop the session. Expect no further bubbles.

Capture a screenshot after steps 3, 4 and 5 (`Page.captureScreenshot`) into `$CLAUDE_JOB_DIR/tmp/live-linux/`.

The host default source must not change: `pactl info | grep "Default Source"` reads the same before and after.

Clean up: `pactl unload-module` every `sk_test` module, close Chrome and stop Vite.

- [ ] **Step 3: Record the outcome**

If every expectation held, write the result into the PR description draft (`$CLAUDE_JOB_DIR/tmp/pr-device-follow-body.md`): the live steps and the screenshots' paths.

If one failed, return to the owning task under superpowers:systematic-debugging. Do not patch here.

---

## Live checks for jiangzhuo (after the branch is pushed and a build exists)

These need hands on hardware.

| Platform | Steps | Expect |
|---|---|---|
| Windows (.13) | Start a session on a USB mic or webcam mic. Unplug it, wait for the notice, replug it. If a Bluetooth headset is at hand: choose it as the microphone (Windows moves it to its hands-free mode by itself), then switch the headset off and on. | The run continues. "…went away, so … is being used instead", then "Now using …" on replug. The participant side keeps translating. VB-CABLE is never chosen. |
| macOS (M4) | The same unplug and replug with a USB or webcam mic. Then break the driver (the three `mv` / `killall coreaudiod` commands), click Repair, and do not restart Sokuji. | The same notices. After Repair the meeting app hears the translation through SokujiVirtualAudio without a restart. Claude reads the logs to see whether `devicechange` fired after the Core Audio restart. |
| Extension (Chrome side panel) | In a Meet call, unplug and replug the mic mid-session. | The same notices, and Meet keeps receiving the translation. |
