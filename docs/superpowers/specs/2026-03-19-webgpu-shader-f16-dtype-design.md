# WebGPU shader-f16 Auto-Detection and Optimal dtype Selection

**Issue**: #121
**Date**: 2026-03-19
**Branch**: `feat/webgpu-shader-f16-dtype-selection`

## Problem

All WebGPU models currently use `q4` dtype universally. On devices supporting `shader-f16`, using `q4f16`/`fp16` provides ~30-50% faster inference. We should detect device capabilities and automatically select the optimal dtype variant.

## Design

### 1. Type System & Manifest Structure

#### New Type

```typescript
interface ModelVariant {
  dtype: string | Record<string, string>;
  files: ModelFileEntry[];
  requiredFeatures?: string[];  // e.g. ['shader-f16']
}
```

#### ModelManifestEntry Changes

Remove top-level `dtype` and `files`. Replace with `variants`:

```typescript
interface ModelManifestEntry {
  // REMOVED: dtype, files
  variants: Record<string, ModelVariant>;  // key = dtype identifier
  // all other fields unchanged
}
```

All models use `variants`, even single-variant models (e.g. Opus-MT: `{ q8: { dtype: 'q8', files: [...] } }`).

#### Example: Whisper (small models, no q4f16 available)

```typescript
{
  id: 'whisper-tiny-en-webgpu',
  hfModelId: 'onnx-community/whisper-tiny.en',
  variants: {
    'q4': {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      files: whisperFiles(...),
    },
    'fp16': {
      dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
      files: whisperFiles(...),
      requiredFeatures: ['shader-f16'],
    },
  },
}
```

#### Example: Whisper (large models, q4f16 available)

```typescript
{
  id: 'whisper-large-v3-turbo-webgpu',
  hfModelId: 'onnx-community/whisper-large-v3-turbo',
  variants: {
    'q4': {
      dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
      files: whisperFiles(..., '_q4'),
    },
    'q4f16': {
      dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' },
      files: whisperFiles(..., '_fp16'),
      requiredFeatures: ['shader-f16'],
    },
  },
}
```

#### Example: Qwen (single-file model)

```typescript
{
  id: 'qwen3-translation',
  variants: {
    'q4': {
      dtype: 'q4',
      files: [{ filename: 'onnx/model_q4.onnx', sizeBytes: ... }],
    },
    'q4f16': {
      dtype: 'q4f16',
      files: [{ filename: 'onnx/model_q4f16.onnx', sizeBytes: ... }],
      requiredFeatures: ['shader-f16'],
    },
  },
}
```

#### Example: Opus-MT (single variant, WASM)

```typescript
{
  id: 'opus-mt-en-ja',
  variants: {
    'q8': {
      dtype: 'q8',
      files: [...],
    },
  },
}
```

#### Variant Selection Logic

```typescript
function selectVariant(
  entry: ModelManifestEntry,
  deviceFeatures: string[],
): string {
  // 1. Find all variants whose requiredFeatures are satisfied by deviceFeatures
  // 2. Prefer variants WITH requiredFeatures (more optimized)
  // 3. Fall back to variant without requiredFeatures (baseline)
  const compatible = Object.entries(entry.variants).filter(([_, v]) =>
    !v.requiredFeatures || v.requiredFeatures.every(f => deviceFeatures.includes(f))
  );
  // Prefer the one with most requiredFeatures (most optimized)
  compatible.sort((a, b) =>
    (b[1].requiredFeatures?.length ?? 0) - (a[1].requiredFeatures?.length ?? 0)
  );
  return compatible[0][0];
}
```

### 2. WebGPU Capability Detection

#### Expand `src/utils/webgpu.ts`

```typescript
interface WebGPUCapabilities {
  available: boolean;
  features: string[];  // e.g. ['shader-f16']
}

let cached: WebGPUCapabilities | null = null;

export async function checkWebGPU(): Promise<WebGPUCapabilities> {
  if (cached) return cached;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
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
```

#### modelStore Changes

```typescript
// Replace:
webgpuAvailable: boolean;

// With:
webgpuAvailable: boolean;
deviceFeatures: string[];
```

Populated once during `initialize()` from `checkWebGPU()`.

### 3. ModelManager Download & Storage

#### Download Flow

`downloadModel()` signature unchanged. Internal changes:

1. Call `selectVariant(entry, deviceFeatures)` to determine variant
2. Download files from selected variant's `files` list
3. Store variant key in metadata

#### ModelMetadata Extension

```typescript
interface ModelMetadata {
  modelId: string;
  status: ModelStatus;
  downloadedAt: number | null;
  totalSizeBytes: number;
  version: string;
  variant: string;  // NEW: which variant was downloaded (e.g. 'q4', 'q4f16')
}
```

Written at download time. Migration: existing downloads without `variant` field default to the first variant without `requiredFeatures`.

#### Deletion

Full delete (files + metadata), same as current behavior. Re-download creates fresh metadata with current optimal variant.

#### Incompatibility Detection

`isModelReady(modelId)` extended: checks that the downloaded variant's `requiredFeatures` are satisfied by current device. If not (e.g. fp16 variant on non-f16 device), returns false.

#### getModelBlobUrls()

Reads `variant` from metadata, uses corresponding variant's `files` list to generate blob URLs.

### 4. Worker Loading & Engine Layer

#### Engine Changes (AsrEngine / TranslationEngine)

```typescript
const metadata = await storage.getMetadata(modelId);
const variantKey = metadata.variant;
const variant = entry.variants[variantKey];

this.worker.postMessage({
  type: 'init',
  fileUrls,               // generated from variant.files
  dtype: variant.dtype,   // from variant, not top-level entry
  ...
});
```

#### Worker Side

No changes needed. Workers already receive `dtype` and pass it to `pipeline()` / `from_pretrained()`.

### 5. UI Layer

#### ModelManagementSection

One entry per model (unchanged). File size displayed from optimal variant for current device.

**States:**

| State | UI |
|-------|-----|
| Not downloaded | Download button. Auto-selects optimal variant. |
| Downloaded, optimal variant | "Downloaded" status, no extra hints. |
| Downloaded, non-optimal variant | Hint: "Your device supports a faster model format. Delete and re-download for 30-50% faster inference." + delete button. |
| Downloaded, incompatible variant | Error: "This model format is incompatible with your device. Please delete and re-download." Download button disabled, only delete shown. |

**Optimal check:**

```typescript
const optimalVariant = selectVariant(entry, deviceFeatures);
const currentVariant = metadata.variant;
const needsUpgrade = currentVariant !== optimalVariant;
```

Uses existing ModelCard `compatibilityHint` and `isCompatible` fields.

### dtype Strategy Per Model

| Model | q4 variant | shader-f16 variant |
|-------|-----------|-------------------|
| whisper-tiny/base/small (.en) | encoder: fp32, decoder: q4 | encoder: fp16, decoder: fp16 |
| whisper-medium/large-v3-turbo | encoder: q4, decoder: q4 | encoder: fp16, decoder: q4f16 |
| Qwen 0.6B (single file) | q4 | q4f16 |
| Qwen3.5 0.8B/2B (multi-component) | all q4 | all q4f16 |
| Opus-MT | q8 (WASM, no variant) | — |
| sherpa-onnx ASR | single variant (WASM) | — |

### Cross-Device Incompatibility

- Detected at startup via `isModelReady()` check
- User downloaded q4f16 on f16 device → uses app on non-f16 device → model blocked, prompted to delete and re-download
- No silent degradation, no auto-deletion

### Files Changed

| File | Change |
|------|--------|
| `src/lib/local-inference/modelManifest.ts` | `ModelManifestEntry` type, all model entries migrated to `variants`, `selectVariant()` function |
| `src/lib/local-inference/modelStorage.ts` | `ModelMetadata.variant` field |
| `src/lib/local-inference/ModelManager.ts` | `downloadModel()` variant selection, `getModelBlobUrls()` variant-aware, `isModelReady()` incompatibility check |
| `src/stores/modelStore.ts` | `deviceFeatures: string[]` state, pass to `selectVariant()` |
| `src/utils/webgpu.ts` | `WebGPUCapabilities` interface, `checkWebGPU()` returns features, `getDeviceFeatures()` |
| `src/lib/local-inference/engine/AsrEngine.ts` | Read variant from metadata, pass variant's dtype to worker |
| `src/lib/local-inference/engine/TranslationEngine.ts` | Same as AsrEngine |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Upgrade hint, incompatibility error, file size from optimal variant |
