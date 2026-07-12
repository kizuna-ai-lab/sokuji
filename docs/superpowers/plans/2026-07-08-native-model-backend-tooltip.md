# Native model tier-badge backend/device tooltip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering a native model card's tier badge shows an info tooltip listing the inference framework, device, acceleration API, and (when loaded) precision/speed/memory/fallback, plus model size and repo.

**Architecture:** Pure formatting helpers in `nativeCatalog.ts` build an ordered list of `{key, value, warn?}` rows from the catalog `NativeModelInfo` (idle) and the store's per-stage resolved plan (active). `NativeModelManagementSection` renders those rows inside the existing `Tooltip` wrapping the existing tier badge. Runtime `backend`/`computeType` are already sent by the sidecar `ready` message and returned by the `Native*Client.init` methods; the only plumbing is to stop dropping them in `LocalNativeClient`/the store. No sidecar, protocol, or MainPanel changes.

**Tech Stack:** React + TypeScript (strict), Zustand store, i18next (`t(key, defaultEnglish)`), vitest + @testing-library/react.

## Global Constraints

- English only in code/comments. Follow existing patterns: i18n via `t('models.<key>', 'English default')`; the `Tooltip` component (`content` accepts `ReactNode`, props `position`/`icon`/`trigger`); the existing formatters `formatMemMb(mb)`, `formatRtf(rtf)`, `formatTps(tps)`.
- Frontend only re-labels/formats data that already comes from the sidecar (`models_catalog_result` + per-stage `ready`). No new sidecar messages, no protocol changes, no changes to MainPanel/ConnectionStatus.
- Framework taxonomy is engine/library level, 7 labels: `transcribe.cpp`, `CTranslate2`, `llama.cpp`, `ONNXRuntime`, `sherpa-onnx`, `Supertonic`, `MLX`.
- Tests run with `npx vitest run <file>`. TypeScript strict mode.

## File Structure

- `src/lib/local-inference/native/nativeCatalog.ts` — add `frameworkLabel`, `accelApiLabel`, `buildBackendTooltipRows` (pure, unit-tested). It already exports `tierLabel`, `resolvedTierState`, `formatMemMb`, `formatRtf`, `formatTps`.
- `src/lib/local-inference/native/nativeCatalog.test.ts` — add tests for the new helpers (create file if absent).
- `src/stores/nativeModelStore.ts` — widen the three `*Resolved` shapes + setters with `backend?`/`computeType?`.
- `src/services/clients/LocalNativeClient.ts` — pass `backend`/`computeType` into the three `store.set*Resolved(...)` calls (the `Native*Client.init` results already carry them).
- `src/components/Settings/sections/NativeModelManagementSection.tsx` — widen local `CardResolved`; build rows; wrap the tier badge in `Tooltip`.
- `src/components/Settings/sections/TierIcon.tsx` — drop the native `title` (keep `aria-label`) so there is one tooltip on the badge.
- `src/locales/{en,zh_CN,zh_TW}/translation.json` — add the eight `models.hw*` label keys.

---

### Task 1: Pure tooltip-content helpers in `nativeCatalog.ts`

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts`
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces: `frameworkLabel(backendId: string): string`; `accelApiLabel(tier: string): string | null`; `type BackendTooltipRow = { key: string; value: string; warn?: boolean }`; `buildBackendTooltipRows(input: { tier: string; backendId?: string; resolved?: { computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null; sizeMb?: number | null; repo?: string }): BackendTooltipRow[]`.
- Consumes: existing `formatMemMb`, `formatRtf`, `formatTps` from the same file.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/local-inference/native/nativeCatalog.test.ts` (create the file with the import header if it does not exist):

```ts
import { describe, it, expect } from 'vitest';
import { frameworkLabel, accelApiLabel, buildBackendTooltipRows } from './nativeCatalog';

describe('frameworkLabel', () => {
  it('maps every known backend id to its engine label', () => {
    const cases: Record<string, string> = {
      transcribe_cpp: 'transcribe.cpp',
      transcribe_cpp_stream: 'transcribe.cpp',
      ct2_opus_translate: 'CTranslate2',
      llamacpp_qwen: 'llama.cpp',
      llamacpp_hunyuan: 'llama.cpp',
      llamacpp_gemma: 'llama.cpp',
      moss_onnx: 'ONNXRuntime',
      qwen3tts_onnx: 'ONNXRuntime',
      sherpa_tts: 'sherpa-onnx',
      supertonic: 'Supertonic',
      mlx_audio_tts: 'MLX',
    };
    for (const [id, label] of Object.entries(cases)) expect(frameworkLabel(id)).toBe(label);
  });
  it('derives future ids by prefix, else echoes the raw id', () => {
    expect(frameworkLabel('llamacpp_newmodel')).toBe('llama.cpp');
    expect(frameworkLabel('foo_onnx')).toBe('ONNXRuntime');
    expect(frameworkLabel('transcribe_cpp_x')).toBe('transcribe.cpp');
    expect(frameworkLabel('brand_new_backend')).toBe('brand_new_backend');
  });
});

describe('accelApiLabel', () => {
  it('names the GPU API and returns null for cpu/unknown', () => {
    expect(accelApiLabel('gpu-cuda')).toBe('CUDA');
    expect(accelApiLabel('gpu-metal')).toBe('Metal');
    expect(accelApiLabel('gpu-vulkan')).toBe('Vulkan');
    expect(accelApiLabel('gpu-dml')).toBe('DirectML');
    expect(accelApiLabel('cpu')).toBeNull();
    expect(accelApiLabel('weird')).toBeNull();
  });
});

describe('buildBackendTooltipRows', () => {
  it('idle GPU tier: framework/device/api/size/repo, no runtime rows', () => {
    const rows = buildBackendTooltipRows({
      tier: 'gpu-vulkan', backendId: 'llamacpp_gemma', resolved: null, sizeMb: 1843, repo: 'org/model',
    });
    expect(rows.map((r) => r.key)).toEqual(['framework', 'device', 'api', 'size', 'repo']);
    expect(rows[0]).toEqual({ key: 'framework', value: 'llama.cpp' });
    expect(rows[1]).toEqual({ key: 'device', value: 'GPU' });
    expect(rows[2]).toEqual({ key: 'api', value: 'Vulkan' });
    expect(rows.find((r) => r.key === 'size')?.value).toBe('1.8 GB');
  });
  it('idle CPU tier: no api row, still has framework/device/size', () => {
    const rows = buildBackendTooltipRows({ tier: 'cpu', backendId: 'ct2_opus_translate', resolved: null, sizeMb: 300 });
    expect(rows.map((r) => r.key)).toEqual(['framework', 'device', 'size']);
    expect(rows[1]).toEqual({ key: 'device', value: 'CPU' });
    expect(rows[0].value).toBe('CTranslate2');
  });
  it('active tier adds precision/speed/memory from the resolved plan', () => {
    const rows = buildBackendTooltipRows({
      tier: 'gpu-cuda', backendId: 'moss_onnx',
      resolved: { computeType: 'int8', rtf: 0.02, memoryBytes: 3_400_000_000 },
      sizeMb: 100, repo: 'org/tts',
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.precision).toBe('INT8');
    expect(byKey.speed).toBe('50× realtime');
    expect(byKey.memory).toBe('3.2 GB');
  });
  it('translate speed uses tok/s; empty tps omits the speed row', () => {
    const withTps = buildBackendTooltipRows({ tier: 'cpu', backendId: 'ct2_opus_translate', resolved: { tokensPerSec: 131 } });
    expect(withTps.find((r) => r.key === 'speed')?.value).toBe('131 tok/s');
    const zeroTps = buildBackendTooltipRows({ tier: 'cpu', backendId: 'ct2_opus_translate', resolved: { tokensPerSec: 0 } });
    expect(zeroTps.find((r) => r.key === 'speed')).toBeUndefined();
  });
  it('fallbackReason becomes a trailing warn row', () => {
    const rows = buildBackendTooltipRows({ tier: 'cpu', backendId: 'llamacpp_gemma', resolved: { fallbackReason: 'Low VRAM → CPU' } });
    const last = rows[rows.length - 1];
    expect(last).toEqual({ key: 'fallback', value: 'Low VRAM → CPU', warn: true });
  });
  it('omits the framework row when no backend id is known', () => {
    const rows = buildBackendTooltipRows({ tier: 'cpu', resolved: null, sizeMb: 10 });
    expect(rows.find((r) => r.key === 'framework')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `frameworkLabel`/`accelApiLabel`/`buildBackendTooltipRows` are not exported.

- [ ] **Step 3: Implement the helpers**

Add to `src/lib/local-inference/native/nativeCatalog.ts` (near `tierLabel`, after the `formatMemMb`/`formatRtf`/`formatTps` definitions so it can call them):

```ts
/** One row of the model-card backend/device tooltip. `key` selects the localized
 *  label in the component; `warn` marks the degraded/fallback row. */
export type BackendTooltipRow = { key: string; value: string; warn?: boolean };

const FRAMEWORK_LABELS: Record<string, string> = {
  transcribe_cpp: 'transcribe.cpp',
  transcribe_cpp_stream: 'transcribe.cpp',
  ct2_opus_translate: 'CTranslate2',
  llamacpp_qwen: 'llama.cpp',
  llamacpp_hunyuan: 'llama.cpp',
  llamacpp_gemma: 'llama.cpp',
  moss_onnx: 'ONNXRuntime',
  qwen3tts_onnx: 'ONNXRuntime',
  sherpa_tts: 'sherpa-onnx',
  supertonic: 'Supertonic',
  mlx_audio_tts: 'MLX',
};

/** Engine/library label for a sidecar backend id. Falls back by prefix so a new
 *  llamacpp_*/*_onnx/transcribe_cpp* id still resolves, else echoes the raw id. */
export function frameworkLabel(backendId: string): string {
  if (FRAMEWORK_LABELS[backendId]) return FRAMEWORK_LABELS[backendId];
  if (backendId.startsWith('llamacpp_')) return 'llama.cpp';
  if (backendId.startsWith('transcribe_cpp')) return 'transcribe.cpp';
  if (backendId.endsWith('_onnx')) return 'ONNXRuntime';
  return backendId;
}

/** Hardware acceleration API for a GPU tier; null for cpu/unknown (no API row). */
export function accelApiLabel(tier: string): string | null {
  switch (tier) {
    case 'gpu-cuda': return 'CUDA';
    case 'gpu-metal': return 'Metal';
    case 'gpu-vulkan': return 'Vulkan';
    case 'gpu-dml': return 'DirectML';
    default: return null;
  }
}

/** Ordered rows for the tier-badge tooltip. `resolved` present = model loaded
 *  (adds precision/speed/memory/fallback); null/undefined = idle catalog view. */
export function buildBackendTooltipRows(input: {
  tier: string;
  backendId?: string;
  resolved?: { computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null;
  sizeMb?: number | null;
  repo?: string;
}): BackendTooltipRow[] {
  const { tier, backendId, resolved, sizeMb, repo } = input;
  const rows: BackendTooltipRow[] = [];
  if (backendId) rows.push({ key: 'framework', value: frameworkLabel(backendId) });
  rows.push({ key: 'device', value: tier === 'cpu' ? 'CPU' : 'GPU' });
  const api = accelApiLabel(tier);
  if (api) rows.push({ key: 'api', value: api });
  if (resolved?.computeType) rows.push({ key: 'precision', value: resolved.computeType.toUpperCase() });
  if (resolved) {
    if (resolved.rtf !== undefined) rows.push({ key: 'speed', value: formatRtf(resolved.rtf) });
    else if (resolved.tokensPerSec !== undefined) {
      const tps = formatTps(resolved.tokensPerSec);
      if (tps) rows.push({ key: 'speed', value: tps });
    }
  }
  if (resolved?.memoryBytes) rows.push({ key: 'memory', value: formatMemMb(Math.round(resolved.memoryBytes / 1_048_576)) });
  if (sizeMb != null) rows.push({ key: 'size', value: formatMemMb(sizeMb) });
  if (repo) rows.push({ key: 'repo', value: repo });
  if (resolved?.fallbackReason) rows.push({ key: 'fallback', value: resolved.fallbackReason, warn: true });
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): backend/device tooltip row helpers"
```

---

### Task 2: Keep `backend`/`computeType` on the resolved plan

**Files:**
- Modify: `src/stores/nativeModelStore.ts` (three `*Resolved` shapes + setter signatures)
- Modify: `src/services/clients/LocalNativeClient.ts` (three `set*Resolved` calls)
- Test: `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Produces: `asrResolved`/`translationResolved`/`ttsResolved` now optionally carry `backend?: string; computeType?: string`. The `Native*Client.init` results already return `backend`/`computeType` (no change there).

- [ ] **Step 1: Write the failing test**

Add to `src/stores/nativeModelStore.test.ts`:

```ts
it('resolved plans retain backend and computeType', () => {
  const s = useNativeModelStore.getState();
  s.setAsrResolved({ model: 'a', device: 'cuda', backend: 'moss_onnx', computeType: 'int8', rtf: 0.02 });
  expect(useNativeModelStore.getState().asrResolved).toMatchObject({ backend: 'moss_onnx', computeType: 'int8' });
  s.setTranslationResolved({ model: 't', device: 'cpu', backend: 'ct2_opus_translate', computeType: 'int8', tokensPerSec: 120 });
  expect(useNativeModelStore.getState().translationResolved).toMatchObject({ backend: 'ct2_opus_translate', computeType: 'int8' });
  s.setTtsResolved({ model: 'v', device: 'metal', backend: 'mlx_audio_tts', computeType: 'fp32' });
  expect(useNativeModelStore.getState().ttsResolved).toMatchObject({ backend: 'mlx_audio_tts', computeType: 'fp32' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — TypeScript rejects `backend`/`computeType` on the resolved shapes (excess property), or the fields are dropped.

- [ ] **Step 3: Widen the store shapes**

In `src/stores/nativeModelStore.ts`, add `backend?: string; computeType?: string;` to each of the three resolved fields AND their setter parameter types. The three state fields (currently around lines 70/72/76) and the three setter signatures (currently around lines 78/79/81) become:

```ts
  asrResolved: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  translationResolved: { model: string; device: string; backend?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null;
  ttsResolved: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  setAsrResolved: (r: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTranslationResolved: (r: { model: string; device: string; backend?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTtsResolved: (r: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
```

The setter bodies (`set({ asrResolved: r })` etc.) are unchanged — they already store the whole object.

- [ ] **Step 4: Pass the fields through in LocalNativeClient**

In `src/services/clients/LocalNativeClient.ts`, add `backend`/`computeType` to the three `store.set*Resolved({...})` calls (the `tr`/`res`/`r` results already contain them):

```ts
      store.setTranslationResolved({ model: config.translationModelId ?? '', device: tr.device ?? 'cpu', backend: tr.backend, computeType: tr.computeType, tokensPerSec: tr.tokensPerSec, memoryBytes: tr.memoryBytes, fallbackReason: tr.fallbackReason });
```
```ts
        store.setAsrResolved({ model: config.asrModelId, device: res.device ?? 'cpu', backend: res.backend, computeType: res.computeType, rtf: res.rtf, memoryBytes: res.memoryBytes, fallbackReason: res.fallbackReason });
```
```ts
        store.setTtsResolved({ model: config.ttsModelId!, device: r.device ?? 'cpu', backend: r.backend, computeType: r.computeType, rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS. Also run `npx vitest run src/services/clients/LocalNativeClient.test.ts` if it exists (should still pass).

- [ ] **Step 6: Commit**

```bash
git add src/stores/nativeModelStore.ts src/services/clients/LocalNativeClient.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): retain resolved backend + computeType through the store"
```

---

### Task 3: Render the tooltip on the tier badge + i18n + single tooltip

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`
- Modify: `src/components/Settings/sections/TierIcon.tsx` (+ `TierIcon.test.tsx` if it asserts `title`)
- Modify: `src/locales/en/translation.json`, `src/locales/zh_CN/translation.json`, `src/locales/zh_TW/translation.json`
- Test: `src/components/Settings/sections/NativeModelManagementSection.test.tsx`

**Interfaces:**
- Consumes: `frameworkLabel`, `buildBackendTooltipRows`, `BackendTooltipRow` from Task 1; the widened resolved shape from Task 2; the existing `Tooltip` component (already imported at the top of the section).

- [ ] **Step 1: Add the i18n label keys**

In each of `src/locales/en/translation.json`, `src/locales/zh_CN/translation.json`, `src/locales/zh_TW/translation.json`, add these sibling keys inside the existing top-level `models` object (keep the JSON valid — add a comma after the previous last key):

en:
```json
"hwFramework": "Engine",
"hwDevice": "Device",
"hwApi": "Acceleration",
"hwPrecision": "Precision",
"hwSpeed": "Speed",
"hwMemory": "Memory",
"hwSize": "Size",
"hwRepo": "Repo"
```
zh_CN:
```json
"hwFramework": "推理引擎",
"hwDevice": "设备",
"hwApi": "加速 API",
"hwPrecision": "精度",
"hwSpeed": "速度",
"hwMemory": "内存",
"hwSize": "模型大小",
"hwRepo": "仓库"
```
zh_TW:
```json
"hwFramework": "推理引擎",
"hwDevice": "裝置",
"hwApi": "加速 API",
"hwPrecision": "精度",
"hwSpeed": "速度",
"hwMemory": "記憶體",
"hwSize": "模型大小",
"hwRepo": "倉庫"
```

- [ ] **Step 2: Remove TierIcon's native title**

In `src/components/Settings/sections/TierIcon.tsx`, drop `title={label}` from the wrapper span (keep `aria-label` for a11y):

```tsx
    <span role="img" aria-label={label} data-tier={tier} className="tier-icon">
```

Check `src/components/Settings/sections/TierIcon.test.tsx`: if any assertion reads the `title` attribute, change it to assert `aria-label` (same value). Run `npx vitest run src/components/Settings/sections/TierIcon.test.tsx` — expect PASS.

- [ ] **Step 3: Write the failing section test**

Add to `src/components/Settings/sections/NativeModelManagementSection.test.tsx` (follow the file's existing render/query idiom and imports). The test renders one card idle and one active and asserts the framework label text appears in the tooltip content. If the existing suite renders whole `NativeModelManagementSection`, mirror its setup; otherwise render the exported card. Assert on the tooltip content the component renders:

```tsx
it('tier badge tooltip lists the inference engine and device', async () => {
  // Mirror the existing section test's store mock so an ASR card renders with a
  // catalog entry whose available tier backend is a known engine id, then assert
  // the tooltip content shows the mapped framework label.
  renderSectionWithNativeCatalog({
    asrCatalog: { id: 'sense', name: 'SenseVoice', tiers: [{ tier: 'gpu-vulkan', backend: 'llamacpp_gemma', available: true }], repo: 'org/sense', sizeBytes: 1_900_000_000, kind: 'asr' },
  });
  expect(await screen.findByText('llama.cpp')).toBeInTheDocument();
  expect(screen.getByText('Vulkan')).toBeInTheDocument();
});
```

> Note for the implementer: the exact helper (`renderSectionWithNativeCatalog`) and mock shape must match this test file's existing conventions — reuse whatever setup the current tests use to inject `useNativeCatalog`/store state. If the `Tooltip` renders its content only on hover in jsdom, either (a) query after a `userEvent.hover` on the badge, or (b) if that proves flaky, assert instead that the badge is wrapped by a tooltip trigger and rely on Task 1's row tests for content coverage. Pick the approach that the existing Tooltip tests in this repo use.

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: FAIL — no `llama.cpp`/`Vulkan` in the document yet.

- [ ] **Step 4: Wire the tooltip into the badge**

In `src/components/Settings/sections/NativeModelManagementSection.tsx`:

(a) Add imports (extend the existing import from `nativeCatalog` and confirm `Tooltip` is imported — it is, at the top):
```ts
import { /* …existing… */ frameworkLabel, buildBackendTooltipRows } from '../../../lib/local-inference/native/nativeCatalog';
```
(Adjust the relative path to match the existing `nativeCatalog` import in this file.)

(b) Widen the local `CardResolved` type to include the new fields:
```ts
type CardResolved = { model: string; device: string; backend?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string };
```

(c) Add a label map near the top of the card component (module scope):
```ts
// [i18n key, English fallback] per tooltip row key.
const TT_LABEL: Record<string, [string, string]> = {
  framework: ['models.hwFramework', 'Engine'],
  device: ['models.hwDevice', 'Device'],
  api: ['models.hwApi', 'Acceleration'],
  precision: ['models.hwPrecision', 'Precision'],
  speed: ['models.hwSpeed', 'Speed'],
  memory: ['models.hwMemory', 'Memory'],
  size: ['models.hwSize', 'Size'],
  repo: ['models.hwRepo', 'Repo'],
};
```

(d) Inside the tier-badge IIFE (currently returning `<><span className={cls}>…</span>{degraded && …}</>`), after `cls` is computed, build the rows and wrap the badge span in `Tooltip`. Replace the returned `<span className={cls}>…</span>` (the first span only; leave the degraded warn span as-is) with:

```tsx
                const backendId = (showResolved && resolved?.backend) ? resolved.backend : activeTier?.backend;
                const ttRows = buildBackendTooltipRows({
                  tier,
                  backendId,
                  resolved: showResolved ? resolved : null,
                  sizeMb,
                  repo: chosenVariant?.repo ?? info?.repo,
                });
                return (
                  <>
                    <Tooltip
                      position="top"
                      icon="none"
                      content={
                        <div style={{ display: 'grid', gap: 2, textAlign: 'left', fontSize: 12, lineHeight: 1.35 }}>
                          {ttRows.map((r) => r.key === 'fallback' ? (
                            <div key={r.key} style={{ color: '#e74c3c' }}>⚠ {r.value}</div>
                          ) : (
                            <div key={r.key}>
                              <span style={{ opacity: 0.6 }}>{t(TT_LABEL[r.key][0], TT_LABEL[r.key][1])}</span>{`: ${r.value}`}
                            </div>
                          ))}
                        </div>
                      }
                    >
                      <span className={cls}>
                        <TierIcon tier={tier} size={10} />{tl.label}{metric}
                      </span>
                    </Tooltip>
                    {view?.degraded && (
                      <span className="model-card__lang-tag model-card__lang-tag--warn"
                            title={resolved!.fallbackReason}>
                        ⚠ Low VRAM → CPU
                      </span>
                    )}
                  </>
                );
```

`t`, `activeTier`, `info`, `sizeMb`, `chosenVariant`, `resolved`, `showResolved`, `view`, `tier`, `tl`, `metric`, `cls` are all already in scope at this point in the component.

- [ ] **Step 5: Run the section + full front-end suites**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.
Then run the touched suites together to confirm no regression:
Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts src/stores/nativeModelStore.test.ts src/components/Settings/sections/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/TierIcon.tsx src/components/Settings/sections/TierIcon.test.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx src/locales/en/translation.json src/locales/zh_CN/translation.json src/locales/zh_TW/translation.json
git commit -m "feat(native): tier-badge tooltip with inference framework + device details"
```

---

## Self-Review

- **Spec coverage:** Framework label (7-engine taxonomy) ✓ Task 1; device/API ✓ Task 1; runtime precision/speed/memory/fallback ✓ Task 1 (data) + Task 2 (plumbing); model size + repo ✓ Task 1; tier-badge placement + single tooltip ✓ Task 3; i18n en/zh_CN/zh_TW ✓ Task 3; no sidecar/protocol/MainPanel changes ✓ (none touched). Framework-varies-by-tier is handled because the row builder takes the displayed `tier` + its `backendId`.
- **Placeholders:** none — every step has concrete code or an exact command. The one soft spot (the section test's render helper) is explicitly delegated to the file's existing conventions with two concrete fallbacks, because the test-harness shape must match what's already there.
- **Type consistency:** `BackendTooltipRow`, `frameworkLabel`, `accelApiLabel`, `buildBackendTooltipRows` signatures match between Task 1 (definition) and Task 3 (use). The resolved shape widening in Task 2 (`backend?`/`computeType?`) matches `CardResolved` in Task 3 and the `resolved` argument shape `buildBackendTooltipRows` expects.
