# Native ASR Renderer Follow-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LOCAL_NATIVE renderer consume the sidecar's Phase-0 `hardware_info` / `models_catalog` handlers — adding the protocol types, the client methods, a per-ASR-card hardware **tier badge** fed by the sidecar, and reconciling the renderer↔sidecar catalog drift the final review flagged.

**Architecture:** The Phase-0 sidecar already serves `hardware_info` and `models_catalog` and reports the resolved plan on `ready`. This follow-on adds the TS wire types, two `NativeModelClient` methods (mirroring `status()`/`sizes()`), a `catalog` slice + `refreshCatalog()` on `nativeModelStore`, and renders the tier (e.g. "CPU") on each ASR card in `NativeModelManagementSection`. Selection logic stays on `nativeCatalog.ts` (full migration to the sidecar feed is a later increment); this only adds the feed, the badge, and catalog reconciliation.

**Tech Stack:** TypeScript, React, Zustand, vitest 4 (the project's correctness gate — **not** tsc, which has ~113 pre-existing errors). Renderer files under `src/`; the sidecar is Python under `sidecar/`.

## Global Constraints

- **Correctness gate is vitest**, run one-shot with `npx vitest run <file>`. Do NOT gate on `tsc` (known-dirty). Integration/wiring of the React component is verified with `npm run build` (vite/esbuild).
- **Sidecar tests** run with `.venv/bin/python -m pytest <paths> -q` from `sidecar/`.
- **Tier badge text is technical (CPU / GPU·CUDA) — render it as a plain string, NOT a new i18n key.** Adding translatable keys means updating 35+ locale files; these acronyms are universal. (The existing `model-card__lang-tag` class is reused for the chip — no new SCSS.)
- **Source of truth is the sidecar `catalog.py`.** After reconciliation both catalogs must agree: `sense-voice` + `whisper-base` recommended; `whisper-large-v3`/`whisper-small`/`whisper-tiny` available, not recommended.
- **No selection-logic migration.** `nativeCatalog.ts` keeps driving card selection/auto-select. This plan only adds the feed + badge + reconciliation.
- **Commit messages:** Conventional Commits. No hand-written trailers (the harness adds them).
- **Model ids match across catalogs:** ASR ids are `sense-voice`, `whisper-{large-v3,base,small,tiny}` — identical strings on both sides, so `models_catalog[id]` keys line up with each ASR card's `downloadId`.

---

## File Structure

**Modify (renderer):**
- `src/lib/local-inference/native/nativeProtocol.ts` — add `NativeTier`, `NativeModelInfo`, `HardwareInfoResultMsg`, `ModelsCatalogResultMsg`; extend `ReadyMsg` with the resolved-plan fields; add the two messages to `ServerMsg`.
- `src/lib/local-inference/native/NativeModelClient.ts` — add `hardwareInfo()` and `modelsCatalog(models?)`.
- `src/lib/local-inference/native/NativeModelClient.test.ts` — FakeWS handlers + two tests.
- `src/stores/nativeModelStore.ts` — `catalog` state, `refreshCatalog()`, `useNativeCatalog` selector.
- `src/stores/nativeModelStore.test.ts` — `refreshCatalog` integration test (FakeWS).
- `src/lib/local-inference/native/nativeCatalog.ts` — add the `whisper-large-v3` ASR row (non-recommended) + a `tierLabel()` display helper.
- `src/lib/local-inference/native/nativeCatalog.test.ts` — cover the new row + `tierLabel`.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` — call `refreshCatalog` in the refresh effect; render the tier badge on each card.

**Modify (sidecar — catalog reconciliation):**
- `sidecar/sokuji_sidecar/catalog.py` — flip `recommended`: `whisper-large-v3` → `False`, `whisper-base` → `True`.
- `sidecar/tests/test_accel.py` — update the `models_catalog` assertion to match (recommended now on `whisper-base`).

---

## Task 1: Protocol types + NativeModelClient methods

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts`
- Modify: `src/lib/local-inference/native/NativeModelClient.ts`
- Test: `src/lib/local-inference/native/NativeModelClient.test.ts`

**Interfaces:**
- Produces: `NativeTier { tier: string; backend: string; available: boolean }`; `NativeModelInfo { id: string; name: string; languages: string[]; recommended: boolean; tiers: NativeTier[] }`; `HardwareInfoResultMsg`; `ModelsCatalogResultMsg`; `ReadyMsg` gains optional `backend?/device?/computeType?/rtf?/fallbackReason?`. `NativeModelClient.hardwareInfo(): Promise<HardwareInfoResultMsg>` and `.modelsCatalog(models?: string[]): Promise<NativeModelInfo[]>`.

- [ ] **Step 1: Write the failing test** (append to `NativeModelClient.test.ts`)

First extend the `FakeWS.send` switch (inside the existing class) to answer the two new message types — add these two `if` blocks alongside the existing ones:

```typescript
    if (msg.type === 'hardware_info') queueMicrotask(() =>
      this.emit({ type: 'hardware_info_result', id: msg.id, os: 'Linux', arch: 'x86_64',
        cpuCores: 8, gpus: [], backendsInstalled: ['ctranslate2', 'sherpa'], accelAvailable: false }));
    if (msg.type === 'models_catalog') queueMicrotask(() =>
      this.emit({ type: 'models_catalog_result', id: msg.id, models: [
        { id: 'sense-voice', name: 'SenseVoice', languages: ['zh', 'en', 'ja', 'ko', 'yue'],
          recommended: true, tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] },
      ] }));
```

Then add the tests inside the `describe('NativeModelClient', …)` block:

```typescript
  it('queries hardware info', async () => {
    const c = new NativeModelClient();
    const hw = await c.hardwareInfo();
    expect(hw.backendsInstalled).toEqual(['ctranslate2', 'sherpa']);
    expect(hw.accelAvailable).toBe(false);
  });

  it('queries the models catalog', async () => {
    const c = new NativeModelClient();
    const models = await c.modelsCatalog(['sense-voice']);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'sense-voice', recommended: true });
    expect(models[0].tiers[0]).toMatchObject({ tier: 'cpu', available: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: FAIL — `c.hardwareInfo is not a function` / `c.modelsCatalog is not a function`.

- [ ] **Step 3: Write the protocol types** (`nativeProtocol.ts`)

Add these interfaces and extend `ReadyMsg` + `ServerMsg`:

```typescript
export interface NativeTier { tier: string; backend: string; available: boolean; }
export interface NativeModelInfo {
  id: string; name: string; languages: string[]; recommended: boolean; tiers: NativeTier[];
}
export interface HardwareInfoResultMsg {
  type: 'hardware_info_result'; id: number;
  os: string; arch: string; cpuCores: number;
  gpus: { vendor: string; name: string; vramMb: number }[];
  backendsInstalled: string[]; accelAvailable: boolean;
}
export interface ModelsCatalogResultMsg {
  type: 'models_catalog_result'; id: number; models: NativeModelInfo[];
}
```

Change the existing `ReadyMsg` line to add the optional resolved-plan fields:

```typescript
export interface ReadyMsg {
  type: 'ready'; id: number; sampleRate: number; loadTimeMs: number;
  backend?: string; device?: string; computeType?: string; rtf?: number; fallbackReason?: string;
}
```

Add the two new messages to the `ServerMsg` union (append `| HardwareInfoResultMsg | ModelsCatalogResultMsg`).

- [ ] **Step 4: Write the client methods** (`NativeModelClient.ts`)

Add the import of the new types at the top (extend the existing `import type { … } from './nativeProtocol'` line to include `HardwareInfoResultMsg, NativeModelInfo`), then add these two methods to the `NativeModelClient` class (next to `sizes()`):

```typescript
  /** Query the sidecar for detected hardware (CPU/GPU/NPU + installed backends). */
  async hardwareInfo(): Promise<HardwareInfoResultMsg> {
    await this.connect();
    const msg = await this.send({ type: 'hardware_info' });
    return msg as HardwareInfoResultMsg;
  }

  /** Query the per-machine model catalog (languages, recommended, tier availability). */
  async modelsCatalog(models?: string[]): Promise<NativeModelInfo[]> {
    await this.connect();
    const msg = await this.send(models ? { type: 'models_catalog', models } : { type: 'models_catalog' });
    return (msg as Extract<ServerMsg, { type: 'models_catalog_result' }>).models;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: PASS (5 tests: 3 existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeModelClient.ts src/lib/local-inference/native/NativeModelClient.test.ts
git commit -m "feat(native): hardware_info + models_catalog protocol types and client methods"
```

---

## Task 2: nativeModelStore catalog slice

**Files:**
- Modify: `src/stores/nativeModelStore.ts`
- Test: `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Consumes: `NativeModelInfo` (Task 1), `client.modelsCatalog()` (Task 1).
- Produces: store state `catalog: Record<string, NativeModelInfo>`; action `refreshCatalog(models?: string[]): Promise<void>`; selector `useNativeCatalog(): Record<string, NativeModelInfo>`.

- [ ] **Step 1: Write the failing test** (append to `nativeModelStore.test.ts`)

This is an integration test that drives the real singleton client through a fake WebSocket (mirrors `NativeModelClient.test.ts`). Add at the top of the file:

```typescript
import { vi, beforeEach } from 'vitest';

class FakeWS {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { setTimeout(() => this.onopen?.(), 0); }
  private emit(o: any) { this.onmessage?.({ data: JSON.stringify(o) }); }
  send(d: any) {
    const msg = JSON.parse(d);
    if (msg.type === 'models_catalog') queueMicrotask(() =>
      this.emit({ type: 'models_catalog_result', id: msg.id, models: [
        { id: 'sense-voice', name: 'SenseVoice', languages: ['zh'], recommended: true,
          tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] },
      ] }));
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
  useNativeModelStore.setState({ catalog: {} });
});
```

Then the test:

```typescript
describe('nativeModelStore.refreshCatalog', () => {
  it('populates catalog from the sidecar models_catalog feed', async () => {
    await useNativeModelStore.getState().refreshCatalog(['sense-voice']);
    const cat = useNativeModelStore.getState().catalog;
    expect(cat['sense-voice']).toMatchObject({ recommended: true });
    expect(cat['sense-voice'].tiers[0]).toMatchObject({ tier: 'cpu', available: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — `refreshCatalog is not a function` (and `catalog` undefined).

- [ ] **Step 3: Write the store slice** (`nativeModelStore.ts`)

Add `NativeModelInfo` to the protocol import; add `catalog` to the interface + initial state; add the action and selector.

In the import line, extend to: `import type { NativeModelState, NativeModelInfo } from '../lib/local-inference/native/nativeProtocol';`

In the `NativeModelStore` interface, add:

```typescript
  /** Per-machine model catalog from the sidecar (languages, recommended, tier availability). */
  catalog: Record<string, NativeModelInfo>;
  /** Query the sidecar for the per-machine model catalog (best-effort). */
  refreshCatalog: (models?: string[]) => Promise<void>;
```

In the `create(...)` initial state, add `catalog: {},` (next to `sizes: {}`).

Add the action (next to `refreshSizes`):

```typescript
  refreshCatalog: async (models) => {
    try {
      const list = await client.modelsCatalog(models);
      set((s) => ({ catalog: { ...s.catalog, ...Object.fromEntries(list.map((m) => [m.id, m])) } }));
    } catch {
      // best-effort — tier badges are cosmetic; sidecar may be down
    }
  },
```

Add the selector at the bottom (next to the other `useNativeModel*` exports):

```typescript
export const useNativeCatalog = () => useNativeModelStore((s) => s.catalog);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS (existing tests + the new `refreshCatalog` test).

- [ ] **Step 5: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): nativeModelStore catalog slice + refreshCatalog"
```

---

## Task 3: Reconcile the renderer↔sidecar catalog drift

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add the `whisper-large-v3` row, non-recommended)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`
- Modify: `sidecar/sokuji_sidecar/catalog.py` (flip `recommended`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: `NATIVE_ASR` gains a `whisper-large-v3` entry (`languages: ['multi']`, `recommended: false`, `sortOrder: 4`). The sidecar `catalog.py` recommends `whisper-base` instead of `whisper-large-v3`. After this task both catalogs recommend exactly `sense-voice` + `whisper-base`.

- [ ] **Step 1: Write the failing renderer test** (append a case to `nativeCatalog.test.ts`)

Add to the `'exposes ASR + translation options'` test (or as a new `it`):

```typescript
  it('includes whisper-large-v3 as an available, non-recommended ASR option', () => {
    const lv3 = NATIVE_ASR.find((m) => m.id === 'whisper-large-v3');
    expect(lv3).toBeTruthy();
    expect(lv3!.languages).toEqual(['multi']);
    expect(lv3!.recommended).toBeFalsy();
    // whisper-base stays the recommended multilingual fallback (CPU-real-time)
    expect(NATIVE_ASR.find((m) => m.id === 'whisper-base')!.recommended).toBe(true);
    // a non-sense-voice language still leads with whisper-base, not large-v3
    expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `whisper-large-v3` not found in `NATIVE_ASR`.

- [ ] **Step 3: Add the renderer row** (`nativeCatalog.ts`)

In `NATIVE_ASR`, add the large-v3 entry (after `whisper-tiny`):

```typescript
  { id: 'whisper-large-v3', label: 'Whisper large-v3', languages: ['multi'], sortOrder: 4 },
```

(No `recommended` flag → it lands in the "Others" group; existing auto-select behavior is unchanged because `whisper-base` remains the recommended leader.)

- [ ] **Step 4: Run renderer test to verify it passes, plus the full native suite for regressions**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS — the new case passes and every existing assertion (e.g. `compatibleNativeAsr('de')[0].id === 'whisper-base'`) still holds.

- [ ] **Step 5: Flip the sidecar recommended flags** (`sidecar/sokuji_sidecar/catalog.py`)

Change the two whisper rows so `recommended` matches the renderer (CPU-appropriate default):
- `whisper-large-v3`: remove `recommended=True` (it becomes the default `recommended=False`).
- `whisper-base`: add `recommended=True`.

The rows become:

```python
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0),), sort_order=1),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "base", 1.0),),
             recommended=True, sort_order=2),
```

- [ ] **Step 6: Update the sidecar models_catalog test** (`sidecar/tests/test_accel.py`)

The `test_models_catalog_handler_cpu_machine` test asserts `by_id["whisper-large-v3"]["recommended"] is True`. Change it to reflect the flip:

```python
    assert by_id["whisper-large-v3"]["recommended"] is False
    assert by_id["whisper-base"]["recommended"] is True
```

- [ ] **Step 7: Run the sidecar tests**

Run (from `sidecar/`): `.venv/bin/python -m pytest tests/test_accel.py tests/test_catalog.py -q`
Expected: PASS — the updated assertion holds; catalog invariants (every model has a CPU floor, etc.) unaffected.

- [ ] **Step 8: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_accel.py
git commit -m "fix(native): reconcile renderer/sidecar ASR catalogs (whisper-large-v3 available, base recommended)"
```

---

## Task 4: Tier badge on the ASR cards

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add `tierLabel`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`

**Interfaces:**
- Consumes: `useNativeCatalog` (Task 2), `NativeModelInfo`/`NativeTier` (Task 1).
- Produces: `tierLabel(tier: string): { label: string; accel: boolean }` (pure display helper). The ASR cards render the active tier as a chip; the section effect calls `refreshCatalog()`.

- [ ] **Step 1: Write the failing test for `tierLabel`** (append to `nativeCatalog.test.ts`)

```typescript
  it('maps hardware tiers to display labels', () => {
    expect(tierLabel('cpu')).toEqual({ label: 'CPU', accel: false });
    expect(tierLabel('gpu-cuda')).toEqual({ label: 'GPU · CUDA', accel: true });
    expect(tierLabel('gpu-metal')).toEqual({ label: 'GPU · Metal', accel: true });
    expect(tierLabel('gpu-dml')).toEqual({ label: 'GPU · DirectML', accel: true });
    // unknown tier → echo the raw string, not accelerated
    expect(tierLabel('mystery')).toEqual({ label: 'mystery', accel: false });
  });
```

Add `tierLabel` to the import line at the top of `nativeCatalog.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `tierLabel is not exported`.

- [ ] **Step 3: Implement `tierLabel`** (`nativeCatalog.ts`)

Add (near the other exported helpers):

```typescript
/** Display label for a hardware tier string from the sidecar models_catalog. */
export function tierLabel(tier: string): { label: string; accel: boolean } {
  switch (tier) {
    case 'cpu': return { label: 'CPU', accel: false };
    case 'gpu-cuda': return { label: 'GPU · CUDA', accel: true };
    case 'gpu-metal': return { label: 'GPU · Metal', accel: true };
    case 'gpu-vulkan': return { label: 'GPU · Vulkan', accel: true };
    case 'gpu-dml': return { label: 'GPU · DirectML', accel: true };
    default: return { label: tier, accel: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the badge into the card + the refresh effect** (`NativeModelManagementSection.tsx`)

(a) Extend the imports: add `tierLabel` to the `nativeCatalog` import, and `useNativeCatalog` to the `nativeModelStore` import.

(b) In the `NativeModelCard` component, after the existing store-hook lines, look up the tier:

```typescript
  const catalog = useNativeCatalog();
  const info = noDownload ? undefined : catalog[spec.downloadId as string];
  const activeTier = info?.tiers.find((x) => x.available) ?? info?.tiers[0];
```

(c) In the card's `model-card__meta` block, render the badge right after the `model-card__languages` div (reuses the `model-card__lang-tag` chip — accel tiers get the `Zap` icon, already imported):

```tsx
              {activeTier && (() => {
                const tl = tierLabel(activeTier.tier);
                return (
                  <span className="model-card__lang-tag">
                    {tl.accel && <Zap size={10} />}{tl.label}
                  </span>
                );
              })()}
```

(d) In the section's refresh `useEffect` (the one keyed on `refreshKey`), also fetch the catalog. Add `const refreshCatalog = useNativeModelStore((s) => s.refreshCatalog);` with the other store hooks, and call it in that effect:

```typescript
  useEffect(() => {
    refresh(allDownloadIds);
    refreshSizes(allDownloadIds);
    refreshCatalog();   // per-machine tier availability for the ASR badges
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshKey]);
```

- [ ] **Step 6: Verify the build (integration gate) + the native test suite**

Run: `npx vitest run src/lib/local-inference/native/ src/stores/nativeModelStore.test.ts`
Expected: PASS (all native unit tests green).

Run: `npm run build`
Expected: build succeeds (vite/esbuild resolves the new imports + JSX; this is the wiring gate since tsc is known-dirty).

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "feat(native): per-ASR-card hardware tier badge from the sidecar models_catalog"
```

---

## Self-Review

**Spec coverage** (renderer follow-on scope, from the Phase-0 plan's Follow-on note + spec §5/§7):
- Protocol types (`hardware_info_result`, `models_catalog_result`, extended `ready`) → Task 1.
- `NativeModelClient.hardwareInfo()/modelsCatalog()` → Task 1.
- "CPU" tier badge on ASR cards fed by `models_catalog` → Tasks 2 + 4.
- Catalog drift reconciliation → Task 3.
- **Deferred (noted):** the perf/RTF badge on the active model (spec §7 item 4) needs `ready.rtf`, which only arrives with Phase-1's benchmark — the `ReadyMsg` *type* gains the fields now, but no UI consumes `device`/`rtf` yet. The device-override control (spec §7 item 3) is Phase 1. Full migration of selection to the sidecar feed is a later increment.

**Placeholder scan:** none — every step has complete code and exact commands.

**Type consistency:** `NativeModelInfo`/`NativeTier` defined in Task 1, consumed by name in Tasks 2 (`catalog: Record<string, NativeModelInfo>`) and 4 (`info?.tiers`). `refreshCatalog`/`useNativeCatalog` defined in Task 2, consumed in Task 4. `tierLabel` defined in Task 4 step 3, tested in step 1 and used in step 5. The reconciliation (Task 3) keeps `compatibleNativeAsr('de')[0] === 'whisper-base'`, so no existing `nativeCatalog.test.ts` assertion breaks.

## Notes / decisions

- **Reconciliation direction (decision):** toward the renderer's CPU-appropriate curation (`whisper-base` recommended, `whisper-large-v3` available-not-recommended), not toward the sidecar's premature `large-v3`-recommended. Rationale: Phase 0 is CPU-only and large-v3 is not real-time on CPU; recommending it would auto-select a ~3GB slow model for any non-SenseVoice language. Hardware-aware `recommended` (recommend large models only when a GPU is present) is a Phase-1 concern — the sidecar will compute `recommended` per machine then.
- **Tier badge styling:** reuses `model-card__lang-tag` (no new SCSS, no new i18n key). A distinct `--tier` style can be added in Phase 1 when GPU tiers actually appear.
