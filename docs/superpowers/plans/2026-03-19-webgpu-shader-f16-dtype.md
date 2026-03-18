# WebGPU shader-f16 dtype Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect WebGPU shader-f16 support and select optimal model dtype variants (q4f16/fp16) for 30-50% faster inference on capable devices.

**Architecture:** Extend the model manifest with a `variants` map per model entry, each variant declaring its dtype, file list, and required GPU features. At download time, the system picks the best variant the device supports. Workers receive the variant's dtype—no worker code changes needed.

**Tech Stack:** TypeScript, Zustand, IndexedDB (idb), WebGPU API, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-webgpu-shader-f16-dtype-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/webgpu.ts` | WebGPU capability detection (available + features) |
| `src/lib/local-inference/modelManifest.ts` | `ModelVariant` type, `variants` on all entries, `selectVariant()`, `getBaselineVariant()`, updated helpers |
| `src/lib/local-inference/modelStorage.ts` | `ModelMetadata.variant` field |
| `src/lib/local-inference/ModelManager.ts` | Variant-aware download, `isModelReady()`, `getModelBlobUrls()`, new `getModelVariantInfo()` |
| `src/stores/modelStore.ts` | `deviceFeatures` state, `useDeviceFeatures()` selector, updated `initialize()` |
| `src/lib/local-inference/engine/AsrEngine.ts` | Use `getModelVariantInfo()` for dtype |
| `src/lib/local-inference/engine/TranslationEngine.ts` | Same as AsrEngine |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Upgrade/incompatibility hints, variant-aware file sizes |

---

### Task 1: WebGPU Capability Detection

**Files:**
- Modify: `src/utils/webgpu.ts` (full rewrite, 17 lines)
- Test: `src/utils/webgpu.test.ts` (create)

- [ ] **Step 1: Write tests for WebGPU capability detection**

Create `src/utils/webgpu.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must reset module between tests to clear cached result
async function loadModule() {
  vi.resetModules();
  return import('./webgpu');
}

describe('checkWebGPU', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {});
  });

  it('returns available=false when navigator.gpu is undefined', async () => {
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: false, features: [] });
  });

  it('returns available=false when requestAdapter returns null', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(null) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: false, features: [] });
  });

  it('returns available=true with empty features when no shader-f16', async () => {
    const mockAdapter = { features: new Set() };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: [] });
  });

  it('returns shader-f16 in features when adapter supports it', async () => {
    const mockAdapter = { features: new Set(['shader-f16']) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU } = await loadModule();
    const result = await checkWebGPU();
    expect(result).toEqual({ available: true, features: ['shader-f16'] });
  });

  it('caches the result on subsequent calls', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({ features: new Set() });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { checkWebGPU } = await loadModule();
    await checkWebGPU();
    await checkWebGPU();
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});

describe('getDeviceFeatures', () => {
  it('returns empty array before checkWebGPU is called', async () => {
    const { getDeviceFeatures } = await loadModule();
    expect(getDeviceFeatures()).toEqual([]);
  });

  it('returns features after checkWebGPU is called', async () => {
    const mockAdapter = { features: new Set(['shader-f16']) };
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(mockAdapter) } });
    const { checkWebGPU, getDeviceFeatures } = await loadModule();
    await checkWebGPU();
    expect(getDeviceFeatures()).toEqual(['shader-f16']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/feat-webgpu-dtype && npx vitest run src/utils/webgpu.test.ts`
Expected: FAIL — `checkWebGPU` returns boolean, not object

- [ ] **Step 3: Implement WebGPU capability detection**

Rewrite `src/utils/webgpu.ts`:

```typescript
export interface WebGPUCapabilities {
  available: boolean;
  features: string[];
}

let cached: WebGPUCapabilities | null = null;

export async function checkWebGPU(): Promise<WebGPUCapabilities> {
  if (cached) return cached;
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      cached = { available: false, features: [] };
      return cached;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      cached = { available: false, features: [] };
      return cached;
    }
    const features: string[] = [];
    if (adapter.features.has('shader-f16')) features.push('shader-f16');
    cached = { available: true, features };
  } catch {
    cached = { available: false, features: [] };
  }
  return cached;
}

export function getDeviceFeatures(): string[] {
  return cached?.features ?? [];
}

/** @deprecated Use checkWebGPU().available instead */
export function isWebGPUAvailable(): boolean {
  return cached?.available ?? false;
}
```

Note: Keep `isWebGPUAvailable()` as deprecated to avoid breaking callers outside the scope of this feature (e.g., workers that import it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/webgpu.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/webgpu.ts src/utils/webgpu.test.ts
git commit -m "feat(webgpu): detect shader-f16 capability with WebGPUCapabilities type"
```

---

### Task 2: ModelVariant Type & Manifest Helpers

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` (lines 43-95 interface, lines 290-314 whisperFiles, lines 2516-2519 getModelSizeMb)

- [ ] **Step 1: Add `ModelVariant` type and update `ModelManifestEntry`**

After the `ModelFileEntry` interface (line 15), add:

```typescript
export interface ModelVariant {
  dtype: string | Record<string, string>;
  files: ModelFileEntry[];
  requiredFeatures?: string[];
}
```

In `ModelManifestEntry` (lines 43-95):
- Add `variants?: Record<string, ModelVariant>;` (optional for now — made required in Task 4 after ModelManager is updated)
- Keep `files?` and `dtype?` temporarily to avoid breaking ModelManager before Task 4

- [ ] **Step 2: Add `selectVariant()`, `getBaselineVariant()`, update `getModelSizeMb()`**

Add after the `ModelVariant` type:

```typescript
/**
 * Select the best variant for the current device.
 * Prefers variants with more requiredFeatures (more optimized).
 */
export function selectVariant(
  entry: ModelManifestEntry,
  deviceFeatures: string[],
): string {
  const compatible = Object.entries(entry.variants).filter(([_, v]) =>
    !v.requiredFeatures || v.requiredFeatures.every(f => deviceFeatures.includes(f))
  );
  if (compatible.length === 0) {
    throw new Error(`No compatible variant for model ${entry.id} on this device`);
  }
  compatible.sort((a, b) =>
    (b[1].requiredFeatures?.length ?? 0) - (a[1].requiredFeatures?.length ?? 0)
  );
  return compatible[0][0];
}

/**
 * Get the baseline (universal fallback) variant key.
 * Used when metadata.variant is undefined (legacy downloads).
 */
export function getBaselineVariant(entry: ModelManifestEntry): string {
  const baseline = Object.entries(entry.variants).find(
    ([_, v]) => !v.requiredFeatures || v.requiredFeatures.length === 0
  );
  if (!baseline) return Object.keys(entry.variants)[0];
  return baseline[0];
}
```

Update `getModelSizeMb()` (line 2516-2519):

```typescript
export function getModelSizeMb(entry: ModelManifestEntry, deviceFeatures: string[] = []): number {
  const variantKey = selectVariant(entry, deviceFeatures);
  const files = entry.variants[variantKey].files;
  return Math.round(files.reduce((sum, f) => sum + f.sizeBytes, 0) / 1_048_576);
}
```

- [ ] **Step 3: Update `whisperFiles()` to support `decoderQuant` parameter**

Modify `whisperFiles()` (lines 290-314). Add `decoderQuant` parameter:

```typescript
function whisperFiles(
  config: number, genConfig: number, preprocessor: number,
  tokenizer: number, tokenizerConfig: number,
  encoder: number, decoder: number,
  extra?: { normalizer?: number; addedTokens?: number; specialTokensMap?: number;
            vocab?: number; merges?: number },
  encoderQuant?: string,
  decoderQuant?: string,  // NEW: '_q4', '_fp16', '_q4f16'. Default: '_q4'
): ModelFileEntry[] {
  const files: ModelFileEntry[] = [
    { filename: 'config.json', sizeBytes: config },
    { filename: 'generation_config.json', sizeBytes: genConfig },
    { filename: 'preprocessor_config.json', sizeBytes: preprocessor },
    { filename: 'tokenizer.json', sizeBytes: tokenizer },
    { filename: 'tokenizer_config.json', sizeBytes: tokenizerConfig },
    { filename: `onnx/encoder_model${encoderQuant ?? ''}.onnx`, sizeBytes: encoder },
    { filename: `onnx/decoder_model_merged${decoderQuant ?? '_q4'}.onnx`, sizeBytes: decoder },
  ];
  // ... rest unchanged (extra files)
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Should compile — `variants` is optional and `files`/`dtype` are still present on the type.

- [ ] **Step 5: Commit type changes**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(models): add ModelVariant type, selectVariant, getBaselineVariant helpers"
```

---

### Task 3: Migrate All Model Entries to Variants

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` (model entries)

This is a large but mechanical migration. Every model entry's `files` and `dtype` move into `variants`.

- [ ] **Step 1: Migrate sherpa-onnx ASR entries (single-variant, no dtype)**

For each sherpa-onnx ASR model (lines ~323-640), change from:

```typescript
{ id: 'sensevoice-int8', type: 'asr', files: asrFiles(...), ... }
```

To:

```typescript
{ id: 'sensevoice-int8', type: 'asr', variants: { default: { dtype: 'int8', files: asrFiles(...) } }, ... }
```

Use `'default'` as variant key for models with no WebGPU dtype concept.

- [ ] **Step 2: Migrate Whisper WebGPU ASR entries (dual-variant)**

For each of the 6 Whisper WebGPU models, add both `q4`/`fp32` and `fp16`/`q4f16` variants.

**File sizes for fp16/q4f16 variants must be looked up from HuggingFace Hub.** Use this command to check:

```bash
curl -s "https://huggingface.co/api/models/onnx-community/whisper-tiny.en/tree/main/onnx" | python3 -c "import sys,json; [print(f'{e[\"path\"]:60s} {e[\"size\"]:>12,}') for e in json.load(sys.stdin)]"
```

Example migration for `whisper-tiny-en-webgpu` (lines 644-661):

```typescript
{
  id: 'whisper-tiny-en-webgpu',
  type: 'asr',
  name: 'Whisper Tiny English (WebGPU)',
  languages: ['en'],
  hfModelId: 'onnx-community/whisper-tiny.en',
  requiredDevice: 'webgpu',
  asrEngine: 'whisper',
  asrWorkerType: 'whisper-webgpu',
  variants: {
    'q4': {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      files: whisperFiles(2_197, 1_646, 339, 2_405_679, 282_662,
        32_904_992, 86_712_166,
        { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_173,
          vocab: 999_186, merges: 456_318 }),
    },
    'fp16': {
      dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
      files: whisperFiles(2_197, 1_646, 339, 2_405_679, 282_662,
        /* encoder_model_fp16.onnx size */ LOOKUP_FROM_HF,
        /* decoder_model_merged_fp16.onnx size */ LOOKUP_FROM_HF,
        { normalizer: 52_666, addedTokens: 34_604, specialTokensMap: 2_173,
          vocab: 999_186, merges: 456_318 },
        '_fp16', '_fp16'),
      requiredFeatures: ['shader-f16'],
    },
  },
},
```

For **whisper-medium** and **whisper-large-v3-turbo**, use `q4f16` instead of `fp16` for decoder:

```typescript
variants: {
  'q4': {
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    files: whisperFiles(..., '_q4'),
  },
  'q4f16': {
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' },
    files: whisperFiles(..., '_fp16', '_q4f16'),
    requiredFeatures: ['shader-f16'],
  },
},
```

- [ ] **Step 3: Migrate Opus-MT translation entries (single-variant)**

For each Opus-MT model (lines ~2280-2340), change from:

```typescript
{ id: 'opus-mt-ja-en', files: opusMtFiles(...), ... }
```

To:

```typescript
{ id: 'opus-mt-ja-en', variants: { 'q8': { dtype: 'q8', files: opusMtFiles(...) } }, ... }
```

- [ ] **Step 4: Create q4f16 file list helpers for Qwen models**

Add new file list functions. File sizes must be looked up from HF Hub:

```bash
curl -s "https://huggingface.co/api/models/onnx-community/Qwen3-0.6B-ONNX/tree/main/onnx" | python3 -c "import sys,json; [print(f'{e[\"path\"]:60s} {e[\"size\"]:>12,}') for e in json.load(sys.stdin)]"
```

For `qwenTranslationFiles()` → add `qwenTranslationFilesQ4f16()`:

```typescript
function qwenTranslationFilesQ4f16(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 678 },
    { filename: 'generation_config.json', sizeBytes: 242 },
    { filename: 'tokenizer.json', sizeBytes: 7_031_673 },
    { filename: 'tokenizer_config.json', sizeBytes: 7_306 },
    { filename: 'onnx/model_q4f16.onnx', sizeBytes: LOOKUP_FROM_HF },
  ];
}
```

Same pattern for `qwen3TranslationFilesQ4f16()`, `qwen35_08bTranslationFilesQ4f16()`, `qwen35_2bTranslationFilesQ4f16()`.

For Qwen3.5 multi-component models, all `_q4` suffixes become `_q4f16`:

```typescript
function qwen35_08bTranslationFilesQ4f16(): ModelFileEntry[] {
  return [
    // config/tokenizer files unchanged
    { filename: 'onnx/embed_tokens_q4f16.onnx', sizeBytes: LOOKUP_FROM_HF },
    { filename: 'onnx/embed_tokens_q4f16.onnx_data', sizeBytes: LOOKUP_FROM_HF },
    { filename: 'onnx/vision_encoder_q4f16.onnx', sizeBytes: LOOKUP_FROM_HF },
    { filename: 'onnx/vision_encoder_q4f16.onnx_data', sizeBytes: LOOKUP_FROM_HF },
    { filename: 'onnx/decoder_model_merged_q4f16.onnx', sizeBytes: LOOKUP_FROM_HF },
    { filename: 'onnx/decoder_model_merged_q4f16.onnx_data', sizeBytes: LOOKUP_FROM_HF },
  ];
}
```

- [ ] **Step 5: Migrate Qwen WebGPU translation entries (dual-variant)**

Example for `qwen3-0.6b-webgpu`:

```typescript
{
  id: 'qwen3-0.6b-webgpu',
  // ... other fields unchanged
  variants: {
    'q4': {
      dtype: 'q4',
      files: qwen3TranslationFiles(),
    },
    'q4f16': {
      dtype: 'q4f16',
      files: qwen3TranslationFilesQ4f16(),
      requiredFeatures: ['shader-f16'],
    },
  },
},
```

For Qwen3.5 models with Record dtype:

```typescript
{
  id: 'qwen3.5-0.8b-webgpu',
  variants: {
    'q4': {
      dtype: { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' },
      files: qwen35_08bTranslationFiles(),
    },
    'q4f16': {
      dtype: { embed_tokens: 'q4f16', vision_encoder: 'q4f16', decoder_model_merged: 'q4f16' },
      files: qwen35_08bTranslationFilesQ4f16(),
      requiredFeatures: ['shader-f16'],
    },
  },
},
```

- [ ] **Step 6: Migrate TTS entries (single-variant)**

TTS models (sherpa-onnx based) use `variants: { default: { dtype: 'default', files: [...] } }`.

- [ ] **Step 7: Migrate streaming ASR entries (single-variant)**

Same pattern as sherpa-onnx ASR.

- [ ] **Step 8: Update all callers of `getModelSizeMb()`**

Search for `getModelSizeMb(` — update callers to pass `deviceFeatures` as second argument. Main caller is `ModelManagementSection.tsx` line 111.

- [ ] **Step 9: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit manifest migration**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(models): migrate all model entries to variants structure"
```

---

### Task 4: ModelMetadata & ModelManager Variant Support

**Files:**
- Modify: `src/lib/local-inference/modelStorage.ts` (line 14-20, ModelMetadata)
- Modify: `src/lib/local-inference/ModelManager.ts` (downloadModel, isModelReady, getModelBlobUrls, new getModelVariantInfo)

- [ ] **Step 0: Finalize `ModelManifestEntry` type — remove `files?` and `dtype?`, make `variants` required**

Now that ModelManager is about to be updated, remove the deprecated fields:

In `src/lib/local-inference/modelManifest.ts`, `ModelManifestEntry` interface:
- Remove `files?: ModelFileEntry[];`
- Remove `dtype?: string | Record<string, string>;`
- Change `variants?: Record<string, ModelVariant>` to `variants: Record<string, ModelVariant>` (required)

- [ ] **Step 1: Add `variant` field to `ModelMetadata`**

In `src/lib/local-inference/modelStorage.ts`, line 14-20:

```typescript
export interface ModelMetadata {
  modelId: string;
  status: ModelStatus;
  downloadedAt: number | null;
  totalSizeBytes: number;
  version: string;
  variant?: string;  // Optional for backward compat with existing IndexedDB records
}
```

- [ ] **Step 2: Update `ModelManager.downloadModel()`**

In `src/lib/local-inference/ModelManager.ts`, modify `downloadModel()` (lines 46-181):

At top of method (after getting entry, ~line 51), add variant selection:

```typescript
const entry = getManifestEntry(modelId);
if (!entry) throw new Error(`Unknown model: ${modelId}`);

// Select optimal variant for this device
const { getDeviceFeatures } = await import('../../utils/webgpu');
const variantKey = selectVariant(entry, getDeviceFeatures());
const variant = entry.variants[variantKey];
if (!variant.files.length) {
  throw new Error(`Model ${modelId} variant ${variantKey} has no files`);
}
```

Replace all `entry.files` with `variant.files`:
- Line 54: Guard check → `if (!variant.files.length || (!entry.cdnPath && !entry.hfModelId))`
- Line 63: `const totalBytes = variant.files.reduce((s, f) => s + f.sizeBytes, 0);`
- Line 76: `for (const file of variant.files) {`

When creating/updating metadata, include variant:

```typescript
await storage.setMetadata(modelId, {
  ...existingMetadata,
  variant: variantKey,  // NEW
});
```

Import `selectVariant` from `modelManifest.ts`.

- [ ] **Step 3: Update `isModelReady()`**

Replace the current implementation (~line 232-235) with:

```typescript
async isModelReady(modelId: string): Promise<boolean> {
  const entry = getManifestEntry(modelId);
  if (!entry) return false;
  const metadata = await storage.getMetadata(modelId);
  if (!metadata || metadata.status !== 'downloaded') return false;

  const variantKey = metadata.variant ?? getBaselineVariant(entry);
  const variant = entry.variants[variantKey];
  if (!variant) return false;

  // Incompatibility check
  const deviceFeatures = getDeviceFeatures();
  if (variant.requiredFeatures?.some(f => !deviceFeatures.includes(f))) return false;

  return storage.hasAllFiles(modelId, variant.files.map(f => f.filename));
}
```

Import `getBaselineVariant`, `getDeviceFeatures`.

- [ ] **Step 4: Update `getModelBlobUrls()`**

Replace current implementation (~lines 203-220):

```typescript
async getModelBlobUrls(modelId: string): Promise<Record<string, string>> {
  const entry = getManifestEntry(modelId);
  if (!entry) return {};
  const metadata = await storage.getMetadata(modelId);
  const variantKey = metadata?.variant ?? getBaselineVariant(entry);
  const variant = entry.variants[variantKey];
  if (!variant) return {};

  const urls: Record<string, string> = {};
  for (const file of variant.files) {
    const blob = await storage.getFile(modelId, file.filename);
    if (!blob) continue;
    const typed = blob.type ? blob : new Blob([blob], { type: getMimeType(file.filename) });
    urls[file.filename] = URL.createObjectURL(typed);
  }
  return urls;
}
```

- [ ] **Step 5: Add `getModelVariantInfo()` method**

Add new method to `ModelManager`:

```typescript
async getModelVariantInfo(modelId: string): Promise<{
  variantKey: string;
  dtype: string | Record<string, string>;
  files: ModelFileEntry[];
}> {
  const entry = getManifestEntry(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);
  const metadata = await storage.getMetadata(modelId);
  const variantKey = metadata?.variant ?? getBaselineVariant(entry);
  const variant = entry.variants[variantKey];
  if (!variant) throw new Error(`Unknown variant "${variantKey}" for model ${modelId}`);
  return { variantKey, dtype: variant.dtype, files: variant.files };
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors may remain in engine files (still using `entry.dtype`)

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/modelStorage.ts src/lib/local-inference/ModelManager.ts
git commit -m "feat(models): variant-aware ModelManager download, isModelReady, getModelBlobUrls"
```

---

### Task 5: modelStore `deviceFeatures` Integration

**Files:**
- Modify: `src/stores/modelStore.ts` (lines 31-66 interface, lines 102-113 initialize, lines 250-257 selectors)

- [ ] **Step 1: Add `deviceFeatures` to state interface and initial state**

In `ModelStoreState` interface (~line 31), add:

```typescript
deviceFeatures: string[];
```

In initial state (inside `create()`), add:

```typescript
deviceFeatures: [],
```

- [ ] **Step 2: Update `initialize()` to unpack `WebGPUCapabilities`**

Replace the current `checkWebGPU()` usage (~lines 102-113):

```typescript
const [usedBytes, capabilities] = await Promise.all([
  modelStorage.estimateStorageUsedBytes(),
  checkWebGPU(),
]);
set({
  modelStatuses: statuses,
  storageUsedMb: Math.round(usedBytes / (1024 * 1024)),
  initialized: true,
  webgpuAvailable: capabilities.available,
  deviceFeatures: capabilities.features,
});
```

Update the import of `checkWebGPU` — it now returns `WebGPUCapabilities`, not `boolean`.

- [ ] **Step 3: Add `useDeviceFeatures` selector**

After existing selectors (~line 257), add:

```typescript
export const useDeviceFeatures = () => useModelStore(s => s.deviceFeatures);
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts
git commit -m "feat(models): add deviceFeatures state and selector to modelStore"
```

---

### Task 6: Engine Layer — Use `getModelVariantInfo()` for dtype

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts` (line 144)
- Modify: `src/lib/local-inference/engine/TranslationEngine.ts` (line 155)

- [ ] **Step 1: Update AsrEngine.init()**

In `AsrEngine.ts`, before the worker `postMessage` call (~line 137-147), replace `model.dtype` with variant dtype:

```typescript
// Before postMessage, get variant info
const { dtype } = await manager.getModelVariantInfo(modelId);

this.worker.postMessage({
  type: 'init',
  fileUrls,
  hfModelId: model.hfModelId,
  language,
  vadConfig,
  dtype,  // was: model.dtype
  ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
  vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
});
```

- [ ] **Step 2: Update TranslationEngine.init()**

In `TranslationEngine.ts`, same pattern (~line 150-155). Note: the local variable in scope is `entry` (not `modelId`), so use `entry.id`:

```typescript
const { dtype } = await manager.getModelVariantInfo(entry.id);

this.worker.postMessage({
  type: 'init',
  hfModelId,
  fileUrls,
  sourceLang,
  targetLang,
  dtype,  // was: entry.dtype
  ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
});
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/AsrEngine.ts src/lib/local-inference/engine/TranslationEngine.ts
git commit -m "feat(engines): use getModelVariantInfo() for variant-aware dtype passing"
```

---

### Task 7: UI — Upgrade Hints and Variant-Aware Display

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx`

- [ ] **Step 1: Import new hooks and helpers**

Add imports:

```typescript
import { useDeviceFeatures } from '../../../stores/modelStore';
import { selectVariant, getBaselineVariant } from '../../../lib/local-inference/modelManifest';
```

In the component body:

```typescript
const deviceFeatures = useDeviceFeatures();
```

- [ ] **Step 2: Update `getModelSizeMb()` calls and thread `deviceFeatures` prop**

`getModelSizeMb(entry)` is called inside the `ModelCard` sub-component, which doesn't have `deviceFeatures`. Thread it:
- Add `deviceFeatures: string[]` to `ModelCard` props
- Pass `deviceFeatures={deviceFeatures}` from the parent `ModelManagementSection`
- Inside `ModelCard`, replace `getModelSizeMb(entry)` with `getModelSizeMb(entry, deviceFeatures)`

- [ ] **Step 3: Add variant status logic to ModelCard rendering**

Where model cards are built (in the map/render logic), add variant comparison:

```typescript
// Determine variant status for this model
const modelMetadata = /* from modelStore or props */;
const optimalVariant = selectVariant(entry, deviceFeatures);
const currentVariant = modelMetadata?.variant ?? getBaselineVariant(entry);
const isDownloaded = modelStatuses[entry.id] === 'downloaded';

let variantHint: string | undefined;
let variantIncompatible = false;

if (isDownloaded && currentVariant !== optimalVariant) {
  const currentVariantDef = entry.variants[currentVariant];
  if (currentVariantDef?.requiredFeatures?.some(f => !deviceFeatures.includes(f))) {
    // Incompatible: downloaded f16 variant on non-f16 device
    variantHint = t('modelManagement.incompatibleVariant',
      'This model format is incompatible with your device. Please delete and re-download.');
    variantIncompatible = true;
  } else {
    // Suboptimal: could use a better variant
    variantHint = t('modelManagement.upgradeVariant',
      'Your device supports a faster model format. Delete and re-download for better performance.');
  }
}
```

Pass `variantHint` to the existing `compatibilityHint` prop and `variantIncompatible` to control whether download button is disabled.

- [ ] **Step 4: Access model metadata for variant field**

The component needs access to `metadata.variant`. This requires either:
- a) Exposing a `getModelMetadata(modelId)` async function from modelStore, or
- b) Loading variant info into modelStore state during `initialize()`

Recommended approach (b): In `modelStore.initialize()`, also load variant keys into a `modelVariants: Record<string, string>` state field, so the UI can synchronously check `modelVariants[entry.id]`.

Add to `ModelStoreState`:
```typescript
modelVariants: Record<string, string>;  // modelId → downloaded variant key
```

Populate during `initialize()`:
```typescript
const variants: Record<string, string> = {};
for (const [modelId, metadata] of Object.entries(allMetadata)) {
  if (metadata.variant) variants[modelId] = metadata.variant;
}
set({ modelVariants: variants });
```

Add selector:
```typescript
export const useModelVariants = () => useModelStore(s => s.modelVariants);
```

Update after download/delete to keep in sync. In `modelStore.ts`:
- In `downloadModel()` success path: add `set(s => ({ modelVariants: { ...s.modelVariants, [modelId]: variantKey } }))` — get `variantKey` from the `ModelManager.getModelVariantInfo()` call or pass it from the download result.
- In `deleteModel()` success path: add `set(s => { const v = { ...s.modelVariants }; delete v[modelId]; return { modelVariants: v }; })`

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Manual test**

Run: `npm run dev`
- Open app in browser, navigate to model management section
- Verify models display correctly with file sizes
- If on a device with shader-f16: verify optimal variant is shown
- If q4 models were previously downloaded: verify upgrade hint appears

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx src/stores/modelStore.ts
git commit -m "feat(ui): show variant upgrade hints and incompatibility warnings"
```

---

### Task 8: Final Verification & Cleanup

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: All tests pass (3 pre-existing failures in settingsStore are unrelated)

- [ ] **Step 3: Run the app and test the full flow**

Run: `npm run dev`

Test matrix:
1. **Fresh state (no downloaded models)**: Click download on a WebGPU model → should download the optimal variant for the device
2. **Device without shader-f16**: All WebGPU models should use q4 variant
3. **Device with shader-f16**: All WebGPU models should use q4f16/fp16 variant
4. **Non-WebGPU models**: Opus-MT and sherpa-onnx should work unchanged
5. **Model management UI**: File sizes show correctly, no broken hints

- [ ] **Step 4: Search for any remaining `entry.files` or `entry.dtype` references**

Run: `grep -rn 'entry\.files\|entry\.dtype\|model\.dtype' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.'`
Expected: No direct references outside of test files. Worker files using `msg.dtype` are fine.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore: final cleanup for WebGPU dtype variant feature"
```

---

## Task Dependency Graph

```
Task 1 (webgpu.ts) ─────┐
                         ├─→ Task 5 (modelStore) ─→ Task 7 (UI)
Task 2 (types/helpers) ──┤
                         ├─→ Task 4 (ModelManager) ─→ Task 6 (engines)
Task 3 (manifest data) ──┘
                                                     ↓
                                              Task 8 (verification)
```

Tasks 1, 2, 3 can be done in parallel. Task 4 depends on 2+3 (it finalizes the type by removing `files`/`dtype` from `ModelManifestEntry`). Task 5 depends on 1+2. Task 6 depends on 4. Task 7 depends on 5+4. Task 8 is final.
