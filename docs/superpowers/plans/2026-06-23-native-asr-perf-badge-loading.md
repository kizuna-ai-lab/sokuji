# Native ASR Perf Badge + Loading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the sidecar's resolved ASR device + RTF as a perf badge on the active model, and show a "Loading model…" state during the (up to ~56s) native model load.

**Architecture:** The sidecar `ready` reply already carries `device`/`rtf` (Phase 1/2); `NativeAsrClient.init` currently discards them. This increment: (1) `init` returns those fields; (2) `LocalNativeClient.connect` flips a `nativeModelStore` loading flag around `asr.init` and stores the resolved `{model, device, rtf}`; (3) the settings UI shows a perf badge on the active ASR card; (4) MainPanel's connecting button shows "Loading model…" while the flag is set. Plus the items-1-3 final-review minors.

**Tech Stack:** TypeScript, React, Zustand, vitest 4 (correctness gate — NOT tsc). Renderer under `src/`.

## Global Constraints

- **Correctness gate is vitest** (`npx vitest run <file>`); React wiring verified with `npm run build`. Do NOT gate on tsc.
- **The store channel is the seam:** `nativeModelStore` gains `asrLoading: boolean` and `asrResolved: { model: string; device: string; rtf?: number } | null`. `LocalNativeClient` (a renderer service) writes them; the UI reads them via selectors. No new store file.
- **Reuse `tierLabel`** for the device label (device `'cuda'` → tier `'gpu-cuda'` → "GPU · CUDA"); add `formatRtf(rtf)` → `"N× realtime"`. No new SCSS (reuse `model-card__lang-tag`); new i18n keys use English fallbacks (no locale-file edits).
- **Loading indicator = the Start-button connecting text** (MainPanel:~3315), not a new component — the load happens during `client.connect()` while `isInitializing` is true.
- **Folded-in items-1-3 final-review minors:** (a) coerce the device-control displayed value `'cuda'→'auto'` when no GPU tier is available; (b) reset `FakeWS.lastInit` in `NativeAsrClient.test.ts` `beforeEach`.
- **Out of scope:** llama.cpp/MLX; a full RTL component-test harness (the device-control GPU-gating is covered by the `gpuTierAvailable` unit test + `npm run build`); localizing the new strings (English fallbacks ship now).
- **Commit messages:** Conventional Commits. No hand-written trailers.

---

## File Structure

**Modify:**
- `src/lib/local-inference/native/NativeAsrClient.ts` — `init` returns `{loadTimeMs, backend?, device?, computeType?, rtf?}`.
- `src/lib/local-inference/native/NativeAsrClient.test.ts` — assert the returned fields; reset `FakeWS.lastInit` in `beforeEach`.
- `src/stores/nativeModelStore.ts` — `asrLoading`/`asrResolved` state + setters + selectors.
- `src/stores/nativeModelStore.test.ts` — the new slice.
- `src/services/clients/LocalNativeClient.ts` — flip the loading flag + store the resolved plan around `asr.init`.
- `src/services/clients/LocalNativeClient.test.ts` (create if absent) — connect updates the store.
- `src/lib/local-inference/native/nativeCatalog.ts` — `formatRtf` helper.
- `src/lib/local-inference/native/nativeCatalog.test.ts` — `formatRtf` test.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` — perf badge on the active card; the orphaned-`cuda` device-control coercion.
- `src/components/MainPanel/MainPanel.tsx` — "Loading model…" connecting text.

---

## Task 1: NativeAsrClient.init returns the resolved plan

**Files:**
- Modify: `src/lib/local-inference/native/NativeAsrClient.ts`
- Test: `src/lib/local-inference/native/NativeAsrClient.test.ts`

**Interfaces:**
- Produces: `NativeAsrClient.init(...)` now resolves to `{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number }` (read from the `ready` message, whose extended fields landed in the Phase-1 follow-on `ReadyMsg`).

- [ ] **Step 1: Write the failing test** (in `NativeAsrClient.test.ts`)

First, in the test's `FakeWS`, make the `asr_init` handler echo device/rtf on the `ready`, and reset `lastInit` in `beforeEach` (the folded minor). Ensure the `asr_init` branch emits e.g.:
`this.emit({ type: 'ready', id: msg.id, loadTimeMs: 5, device: msg.device, rtf: 0.5 });`
and add `beforeEach(() => { FakeWS.lastInit = undefined; })` (merge into the existing `beforeEach` if present).

Then the test:

```typescript
  it('returns the resolved device + rtf from ready', async () => {
    const c = new NativeAsrClient();
    const r = await c.init('en', 'granite-speech-4.1-2b', 24000, undefined, 'cuda');
    expect(r.loadTimeMs).toBe(5);
    expect(r.device).toBe('cuda');
    expect(r.rtf).toBe(0.5);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: FAIL — `r.device` / `r.rtf` are `undefined` (init only returns `loadTimeMs`).

- [ ] **Step 3: Return the fields** (`NativeAsrClient.ts`)

Change `init`'s return to read the extended `ready` fields:

```typescript
  async init(
    language = '', modelId?: string, sampleRate = 24000,
    vad?: { threshold?: number; minSilence?: number; minSpeech?: number },
    device?: string,
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number }> {
    await this.connect();
    this.onStatus?.('[native-asr] init…');
    const msg = await this.send({
      type: 'asr_init', language, model: modelId, sampleRate, device,
      vadThreshold: vad?.threshold, vadMinSilenceDuration: vad?.minSilence, vadMinSpeechDuration: vad?.minSpeech,
    });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: PASS (the new test + the Task-3-from-the-prior-increment `device` test still pass; `lastInit` reset is harmless).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/NativeAsrClient.ts src/lib/local-inference/native/NativeAsrClient.test.ts
git commit -m "feat(native): NativeAsrClient.init returns resolved device + rtf from ready"
```

---

## Task 2: nativeModelStore session channel (asrLoading + asrResolved)

**Files:**
- Modify: `src/stores/nativeModelStore.ts`
- Test: `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Produces: store state `asrLoading: boolean` (default `false`) and `asrResolved: { model: string; device: string; rtf?: number } | null` (default `null`); setters `setAsrLoading(v: boolean)` and `setAsrResolved(r: { model: string; device: string; rtf?: number } | null)`; selectors `useNativeAsrLoading()` and `useNativeAsrResolved()`.

- [ ] **Step 1: Write the failing test** (append to `nativeModelStore.test.ts`)

```typescript
describe('nativeModelStore asr session channel', () => {
  it('tracks asrLoading and the resolved plan', () => {
    const s = useNativeModelStore.getState();
    s.setAsrLoading(true);
    expect(useNativeModelStore.getState().asrLoading).toBe(true);
    s.setAsrResolved({ model: 'granite-speech-4.1-2b', device: 'cuda', rtf: 0.015 });
    s.setAsrLoading(false);
    const st = useNativeModelStore.getState();
    expect(st.asrLoading).toBe(false);
    expect(st.asrResolved).toEqual({ model: 'granite-speech-4.1-2b', device: 'cuda', rtf: 0.015 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — `setAsrLoading is not a function`.

- [ ] **Step 3: Add the slice** (`nativeModelStore.ts`)

In the `NativeModelStore` interface add:

```typescript
  /** True while a native ASR session is loading its model (init→ready). */
  asrLoading: boolean;
  /** The resolved ASR plan from the last session `ready` (device + measured rtf). */
  asrResolved: { model: string; device: string; rtf?: number } | null;
  setAsrLoading: (v: boolean) => void;
  setAsrResolved: (r: { model: string; device: string; rtf?: number } | null) => void;
```

In the `create(...)` initial state add `asrLoading: false,` and `asrResolved: null,`; and the actions:

```typescript
  setAsrLoading: (v) => set({ asrLoading: v }),
  setAsrResolved: (r) => set({ asrResolved: r }),
```

Add the selectors at the bottom (next to the other `useNative*` exports):

```typescript
export const useNativeAsrLoading = () => useNativeModelStore((s) => s.asrLoading);
export const useNativeAsrResolved = () => useNativeModelStore((s) => s.asrResolved);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): nativeModelStore asrLoading + asrResolved session channel"
```

---

## Task 3: LocalNativeClient flips the flag + stores the resolved plan

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts`
- Test: `src/services/clients/LocalNativeClient.test.ts` (create if absent)

**Interfaces:**
- Consumes: `useNativeModelStore` (Task 2), `NativeAsrClient.init`'s extended return (Task 1).
- Produces: `LocalNativeClient.connect` sets `asrLoading=true` before `asr.init`, sets `asrResolved={model, device, rtf}` from the init result, and `asrLoading=false` after (in a `finally`).

- [ ] **Step 1: Write the failing test** (in `LocalNativeClient.test.ts`)

A test that injects a fake `asr` whose `init` returns a resolved plan and asserts the store is updated. Use the `LocalNativeClient` `deps` constructor (`{ asr, translate, tts }`). Minimal fakes + a minimal local_native `SessionConfig`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalNativeClient } from './LocalNativeClient';
import { useNativeModelStore } from '../../stores/nativeModelStore';

const fakeAsr = () => ({
  onResult: null as any, onError: null as any,
  init: async () => ({ loadTimeMs: 5, device: 'cuda', rtf: 0.02 }),
  feedAudio() {}, flush: async () => {}, dispose() {},
});
const fakeTr = () => ({ onError: null as any, init: async () => {}, translate: async () => ({ translatedText: 'x', inferenceTimeMs: 1 }), dispose() {} });
const fakeTts = () => ({ init: async () => {}, generate: async () => ({ samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 1 }), dispose() {} });

const cfg: any = {
  provider: 'local_native', model: 'native-asr-translate', instructions: '',
  sourceLanguage: 'en', targetLanguage: 'ja', asrModelId: 'granite-speech-4.1-2b',
  asrDevice: 'cuda', textOnly: true,
};

beforeEach(() => { useNativeModelStore.setState({ asrLoading: false, asrResolved: null }); });

describe('LocalNativeClient session channel', () => {
  it('stores the resolved plan and clears loading after connect', async () => {
    const c = new LocalNativeClient({ asr: fakeAsr(), translate: fakeTr(), tts: fakeTts() });
    c.setEventHandlers({});
    await c.connect(cfg);
    const st = useNativeModelStore.getState();
    expect(st.asrLoading).toBe(false);
    expect(st.asrResolved).toEqual({ model: 'granite-speech-4.1-2b', device: 'cuda', rtf: 0.02 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: FAIL — `asrResolved` stays `null` (connect doesn't touch the store yet).

- [ ] **Step 3: Wire the store** (`LocalNativeClient.ts`)

Add the import at the top: `import { useNativeModelStore } from '../../stores/nativeModelStore';`. Replace the `await this.asr.init(...)` block in `connect()` with:

```typescript
    const store = useNativeModelStore.getState();
    store.setAsrLoading(true);
    try {
      const res = await this.asr.init(config.sourceLanguage, config.asrModelId, 24000, {
        threshold: config.vadThreshold,
        minSilence: config.vadMinSilenceDuration,
        minSpeech: config.vadMinSpeechDuration,
      }, config.asrDevice);
      store.setAsrResolved({ model: config.asrModelId, device: res.device ?? 'cpu', rtf: res.rtf });
    } finally {
      store.setAsrLoading(false);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
git commit -m "feat(native): LocalNativeClient sets asrLoading + asrResolved around model load"
```

---

## Task 4: Perf badge on the active ASR card + device-control coercion

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add `formatRtf`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`

**Interfaces:**
- Consumes: `useNativeAsrResolved` (Task 2), `tierLabel` (follow-on), `gpuTierAvailable` (prior increment).
- Produces: `formatRtf(rtf: number): string` → `"N× realtime"` (N = `Math.round(1/rtf)`). The active ASR card shows a perf badge `⚡ <device label> · <formatRtf>` when `asrResolved.model === spec.selectId`. The device `<select>` displayed value coerces `'cuda'→'auto'` when `!gpuTierAvailable`.

- [ ] **Step 1: Write the failing test** (append to `nativeCatalog.test.ts`)

```typescript
  it('formatRtf renders a realtime multiple', () => {
    expect(formatRtf(0.5)).toBe('2× realtime');
    expect(formatRtf(0.015)).toBe('67× realtime');
    expect(formatRtf(1)).toBe('1× realtime');
  });
```

(Add `formatRtf` to the import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `formatRtf is not exported`.

- [ ] **Step 3: Implement `formatRtf`** (`nativeCatalog.ts`)

```typescript
/** Human label for a measured RTF (process-time / audio-seconds): how many times
 *  faster than real-time. rtf 0.015 → "67× realtime". */
export function formatRtf(rtf: number): string {
  return `${Math.round(1 / rtf)}× realtime`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the perf badge + the device-control coercion** (`NativeModelManagementSection.tsx`)

(a) Add `formatRtf` to the `nativeCatalog` import and `useNativeAsrResolved` to the store imports.

(b) In `NativeModelCard`, read the resolved plan and render the perf badge in the `model-card__meta` block when this card is the resolved model:

```typescript
  const resolved = useNativeAsrResolved();
```

and in the meta JSX (after the tier badge):

```tsx
              {resolved && resolved.model === spec.selectId && (
                <span className="model-card__lang-tag">
                  <Zap size={10} />{tierLabel(resolved.device === 'cpu' ? 'cpu' : `gpu-${resolved.device}`).label}
                  {resolved.rtf !== undefined ? ` · ${formatRtf(resolved.rtf)}` : ''}
                </span>
              )}
```

(c) Coerce the device-control displayed value (the folded minor) — change the `<select>`'s `value`:

```tsx
            value={settings.asrDevice === 'cuda' && !gpuTierAvailable(catalog) ? 'auto' : settings.asrDevice}
```

- [ ] **Step 6: Verify the helper test + the build**

Run: `npx vitest run src/lib/local-inference/native/ src/stores/nativeModelStore.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "feat(native): perf badge (device + rtf) on the active ASR card; device-control cuda coercion"
```

---

## Task 5: "Loading model…" connecting text

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

**Interfaces:**
- Consumes: `useNativeAsrLoading` (Task 2).
- Produces: while `nativeAsrLoading` is true, the Start-button connecting text reads "Loading model…" instead of "Connecting…".

- [ ] **Step 1: Read the connecting-text region**

Read `MainPanel.tsx` around line 3309–3316 — the `isInitializing ?` branch renders a `<Loader>` + a `<span className="btn-text">` whose text is `initProgress ? '...' : t('simplePanel.connecting', 'Connecting...')`.

- [ ] **Step 2: Add the store hook**

Near the other store hooks at the top of the `MainPanel` component (e.g. by the `useIsReconnecting()` call), add:

```typescript
  const nativeAsrLoading = useNativeAsrLoading();
```

and add `useNativeAsrLoading` to the `nativeModelStore` import (or add the import if MainPanel doesn't already import from that store).

- [ ] **Step 3: Show the loading text**

Change the connecting-text ternary (line ~3313–3315) to prefer the loading message:

```tsx
                      {initProgress
                        ? t('simplePanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                        : nativeAsrLoading
                          ? t('simplePanel.loadingModel', 'Loading model…')
                          : t('simplePanel.connecting', 'Connecting...')}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds. (`useNativeAsrLoading` resolves; the JSX compiles.)

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS (no store regression).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(native): show 'Loading model…' while the native ASR model loads"
```

---

## Self-Review

**Spec coverage:**
- Capture device+rtf from `ready` → Task 1.
- Store channel (asrLoading + asrResolved) → Task 2.
- Wire it from `LocalNativeClient.connect` → Task 3.
- Perf badge on the active model (§7 item 4) → Task 4.
- "Loading model…" state during connect → Task 5.
- Folded items-1-3 minors: `FakeWS.lastInit` reset → Task 1; orphaned-`cuda` device-control coercion → Task 4.
- **Deferred (noted):** an RTL component test for the device-control GPU-option gating (covered by the `gpuTierAvailable` unit test + build); localizing the new strings (English fallbacks ship now). llama.cpp/MLX remain separate increments.

**Placeholder scan:** none — every step has complete code + exact commands. The Task-3 `LocalNativeClient.test.ts` fakes are concrete; the Task-5 MainPanel change targets a specific known line.

**Type consistency:** `asrResolved: { model, device, rtf? }` is the same shape in `nativeModelStore` (Task 2), the `setAsrResolved` call in `LocalNativeClient` (Task 3), and the `useNativeAsrResolved` read in the perf badge (Task 4). `NativeAsrClient.init`'s return `{loadTimeMs, device?, rtf?, ...}` (Task 1) is consumed by `LocalNativeClient` as `res.device`/`res.rtf` (Task 3). `formatRtf(rtf)` (Task 4) and `tierLabel(...)` (follow-on) are the only badge helpers. `useNativeAsrLoading`/`useNativeAsrResolved` selectors (Task 2) are consumed in Tasks 4–5.

## Notes / decisions

- **Device→tier mapping for the badge:** `resolved.device === 'cpu' ? 'cpu' : 'gpu-' + device` reuses `tierLabel` so the badge reads "GPU · CUDA" without a new helper. Works for `cuda`/`metal`/`vulkan`/`dml`.
- **Loading indicator on the Start button** (not a new component): the load blocks `client.connect()` while `isInitializing` is true, so the button's connecting text is exactly where the user is looking after pressing Start.
- **`asrResolved` persists after the session** (it's last-known) — the badge keeps showing the last resolved device/rtf, which is the useful "this is how it ran" signal on the settings card. Cleared only when a new session resolves.
