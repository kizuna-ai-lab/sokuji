# Piper-Plus TTS Integration Design

**Date**: 2026-03-23
**Issue**: [#135](https://github.com/kizuna-ai-lab/sokuji/issues/135)
**Status**: Draft

## Summary

Add [piper-plus](https://github.com/ayutaz/piper-plus) as a local TTS engine with Japanese phoneme processing via OpenJTalk WASM. Piper-plus is a VITS-based multilingual TTS system (ja/en/zh/es/fr/pt) that runs entirely in the browser via ONNX Runtime Web. Its key differentiator is integrated OpenJTalk for accurate Japanese kanji reading, pitch accent, and prosody.

## Model Specs

| Spec | Value |
|------|-------|
| Model | `ayousanz/piper-plus-css10-ja-6lang` |
| Architecture | VITS (same family as existing Piper in sherpa-onnx) |
| Languages | ja, en, zh, es, fr, pt (6 languages) |
| Speakers | 1 (single speaker, CSS10 Japanese) |
| ONNX size | ~39MB (FP16) |
| Sample rate | 22050 Hz |
| License | MIT |

## Prerequisites

Supertonic-2 ([spec](./2026-03-23-supertonic2-integration-design.md)) is shelved. Piper-plus will be implemented first and must include the `lang` parameter plumbing that Supertonic-2 originally introduced:

1. **`TtsEngine.generate()`** — add `lang?: string` parameter, forward to worker as `msg.lang`
2. **`src/lib/local-inference/types.ts`** — add `lang?: string` to `TtsGenerateMessage`
3. **`src/services/clients/LocalInferenceClient.ts`** — pass `this.config.targetLanguage` as `lang` to `ttsEngine.generate()`

Note: Supertonic-2's `numSteps` and `generateWithConfig` migration are NOT needed for piper-plus and should remain in the Supertonic spec's scope.

## Integration Approach: Approach C — Worker-Only Abstraction

Reuse the existing `TtsEngine` class with its message protocol (`init`/`generate`/`dispose` → `ready`/`result`/`status`/`error`). Create a separate classic worker (`piper-plus-tts.worker.js`) that implements the same protocol with a completely different runtime (OpenJTalk + eSpeak-ng + ONNX Runtime Web instead of sherpa-onnx Emscripten).

### Why Not sherpa-onnx

Piper-plus requires OpenJTalk preprocessing for Japanese phonemization. sherpa-onnx's VITS pipeline uses eSpeak-ng only, which cannot handle Japanese kanji readings or pitch accent. The phonemization pipeline (OpenJTalk labels → phoneme extraction → PUA mapping → phoneme IDs) is implemented in JavaScript and must run before ONNX inference.

## Architecture

### Phonemization Pipeline (per language)

```
Japanese:  text → OpenJTalk WASM → HTS labels → extractPhonemesFromLabels()
           → applyNPhonemeRules() → mapToPUA() → phoneme_id_map → int64[]
           (+ optional prosody_features from A1/A2/A3 accent values)

English:   text → eSpeak-ng WASM → IPA phonemes → phoneme_id_map → int64[]

zh/es/fr/pt: text → character-level mapping → phoneme_id_map → int64[]
```

### ONNX Inference

| Tensor | dtype | Shape | Description |
|--------|-------|-------|-------------|
| `input` | int64 (BigInt64Array) | `[1, seq_len]` | Phoneme ID sequence |
| `input_lengths` | int64 (BigInt64Array) | `[1]` | Sequence length |
| `scales` | float32 | `[3]` | `[noise_scale=0.667, length_scale, noise_w=0.8]` |
| `prosody_features` | int64 (BigInt64Array) | `[1, seq_len, 3]` | Optional: A1/A2/A3 accent (Japanese only, when model has `prosody_id_map`) |

Output: `output` tensor → Float32Array audio samples at model's sample rate (22050 Hz).

### Speed Control

The existing `ttsSpeed` setting maps to `length_scale` (inverse relationship: higher speed → lower length_scale). `noise_scale` and `noise_w` are fixed at defaults (0.667, 0.8). No additional UI controls.

### Language Selection

Language is passed via the `targetLanguage` parameter (from Supertonic-2, see Prerequisites). Two maps are involved:

1. **`ttsConfig.languageIdMap`** (from manifest) — routes to the correct phonemizer: `ja` → OpenJTalk, `en` → eSpeak-ng, others → character-level fallback
2. **`phoneme_id_map`** (from `model.onnx.json`, loaded at runtime) — converts phoneme strings to integer IDs for the ONNX `input` tensor

These are distinct maps. `languageIdMap` is for phonemizer routing only; `phoneme_id_map` is for tensor construction.

## File Changes

### New Files

#### `public/workers/piper-plus-tts.worker.js`

Classic JS worker (not ES module — needs `importScripts()` for OpenJTalk Emscripten glue).

**Init flow**:
1. `importScripts()` loads ONNX Runtime Web UMD build from `ortBaseUrl + '/ort.wasm.min.js'` (~50KB), then configure `ort.env.wasm.wasmPaths = ortBaseUrl + '/'` to resolve the existing `.wasm` files in `public/wasm/ort/`
2. `importScripts()` loads `openjtalk.js` from `runtimeBaseUrl` (e.g., `./wasm/piper-plus/openjtalk.js`)
3. Load OpenJTalk dict files (9 files) + voice file from blob URLs → Emscripten virtual filesystem
4. Call `_openjtalk_initialize(dictDir, voicePath)` — returns 0 on success
5. Initialize eSpeak-ng (for English phonemization) — loaded inline via `importScripts()`, NOT as a nested sub-worker (Chrome extension sandbox prohibits nested workers)
6. Parse `model.onnx.json` from blob URL for `phoneme_id_map` and `prosody_id_map`
7. Create ONNX session: `ort.InferenceSession.create(modelBlobUrl, { executionProviders: ['wasm'] })`
8. Post `{ type: 'ready', loadTimeMs, numSpeakers: 1, sampleRate }`

**Generate flow**:
1. Detect/use language → route to correct phonemizer
2. Convert phonemes to IDs via `phoneme_id_map`
3. Build ONNX input tensors (including optional `prosody_features` for Japanese)
4. Run inference → extract Float32Array from `output` tensor
5. Post `{ type: 'result', samples, sampleRate, generationTimeMs }` with transferable buffer

**Phonemization JS modules** — ported from piper-plus `src/` into the worker or loaded via `importScripts()`:
- `japanese_phoneme_extract.js` — OpenJTalk label parsing, N-phoneme rules, PUA mapping
- `simple_unified_api.js` — language routing, phoneme ID construction
- `espeak_phoneme_extractor.js` — eSpeak-ng wrapper + dictionary fallback

#### `public/wasm/piper-plus/`

Bundled static assets (pre-built, committed to repo):
- `openjtalk.js` + `openjtalk.wasm` (~577KB) — OpenJTalk Emscripten build
- `espeakng.worker.js` + `espeakng.worker.data` (~2.8MB) — eSpeak-ng for English
- Phonemization JS modules from above

### Modified Files

#### `public/workers/tts.worker.js` → `public/workers/sherpa-onnx-tts.worker.js`

Rename only. No content changes.

#### `public/workers/asr.worker.js` → `public/workers/sherpa-onnx-asr.worker.js`

Rename only. No content changes.

#### `public/workers/streaming-asr.worker.js` → `public/workers/sherpa-onnx-streaming-asr.worker.js`

Rename only. No content changes.

#### `scripts/copy-ort-wasm.sh`

Add `ort.wasm.min.js` to the `FILES` array. This is the UMD build of `onnxruntime-web` (~50KB) needed by classic workers that use `importScripts()`. The existing `.mjs` files are ES modules and cannot be loaded via `importScripts()`.

```bash
FILES=(
  # ... existing .mjs and .wasm entries ...
  "ort.wasm.min.js"   # NEW: UMD build for classic workers (piper-plus-tts)
)
```

After updating, run `npm run postinstall` or `bash scripts/copy-ort-wasm.sh` to copy the new file.

No new npm dependency needed — `onnxruntime-web` is already installed as a dependency of `@huggingface/transformers`.

#### `src/lib/local-inference/engine/TtsEngine.ts`

**`init()` refactoring** — the current code unconditionally reads `package-metadata.json` and throws if missing (lines 72–78). This must be guarded:

```typescript
const isPiperPlus = model.engine === 'piper-plus';

// Sherpa-onnx path: read Emscripten metadata
let dataPackageMetadata = null;
let dataFileUrls = fileUrls;
if (!isPiperPlus) {
  const metadataBlobUrl = fileUrls['package-metadata.json'];
  if (!metadataBlobUrl) {
    throw new Error(`Missing package-metadata.json for TTS model "${modelId}"`);
  }
  const metadataResponse = await fetch(metadataBlobUrl);
  dataPackageMetadata = await metadataResponse.json();
  // Strip metadata from file URLs sent to worker
  dataFileUrls = Object.fromEntries(
    Object.entries(fileUrls).filter(([name]) => name !== 'package-metadata.json')
  );
}

// Worker selection
const workerUrl = isPiperPlus
  ? './workers/piper-plus-tts.worker.js'
  : './workers/sherpa-onnx-tts.worker.js';
this.worker = new Worker(workerUrl);
```

**Init message branching**:
- `piper-plus`: Send `{ type: 'init', fileUrls, runtimeBaseUrl: './wasm/piper-plus', ortBaseUrl: './wasm/ort', engine: 'piper-plus', ttsConfig }`. No `dataPackageMetadata`, no `modelFile`.
- All other engines: Existing sherpa-onnx path unchanged (sends `dataPackageMetadata`, `modelFile`, `runtimeBaseUrl` for sherpa-onnx).

**`generate()`**: No changes — `speed` is passed through as-is; the piper-plus worker maps it to `length_scale`.

**`dispose()`**: No changes.

#### `src/lib/local-inference/engine/AsrEngine.ts`

Update worker path:
```typescript
// Before
this.worker = new Worker('./workers/asr.worker.js');
// After
this.worker = new Worker('./workers/sherpa-onnx-asr.worker.js');
```

#### `src/lib/local-inference/engine/StreamingAsrEngine.ts`

Update worker path:
```typescript
// Before
'./workers/streaming-asr.worker.js'
// After
'./workers/sherpa-onnx-streaming-asr.worker.js'
```

#### `src/lib/local-inference/modelManifest.ts`

**Type update**:
```typescript
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits' | 'supertonic' | 'piper-plus';
```

**TtsModelConfig extension**:
```typescript
export interface TtsModelConfig {
  // ... existing fields ...
  languageIdMap?: Record<string, number>;  // e.g. { ja: 0, en: 1, zh: 2, es: 3, fr: 4, pt: 5 }
}
```

**New manifest entry**:
```typescript
{
  id: 'piper-plus-css10-ja-6lang',
  type: 'tts',
  name: 'Piper-Plus CSS10 JA (6 languages)',
  languages: ['ja', 'en', 'zh', 'es', 'fr', 'pt'],
  multilingual: true,
  hfModelId: 'ayousanz/piper-plus-css10-ja-6lang',  // or rehosted dataset
  engine: 'piper-plus',
  numSpeakers: 1,
  ttsConfig: {
    languageIdMap: { ja: 0, en: 1, zh: 2, es: 3, fr: 4, pt: 5 },
  },
  variants: {
    fp16: {
      files: [
        // Model files
        { filename: 'model.onnx', sizeBytes: 39_000_000 },
        { filename: 'model.onnx.json', sizeBytes: 9_000 },
        // OpenJTalk dictionary (9 files)
        { filename: 'dict/sys.dic', sizeBytes: 103_000_000 },
        { filename: 'dict/matrix.bin', sizeBytes: 3_800_000 },
        { filename: 'dict/char.bin', sizeBytes: 262_000 },
        { filename: 'dict/left-id.def', sizeBytes: 78_000 },
        { filename: 'dict/right-id.def', sizeBytes: 78_000 },
        { filename: 'dict/rewrite.def', sizeBytes: 7_000 },
        { filename: 'dict/unk.dic', sizeBytes: 6_000 },
        { filename: 'dict/pos-id.def', sizeBytes: 2_000 },
        // OpenJTalk voice
        { filename: 'voice/mei_normal.htsvoice', sizeBytes: 863_000 },
        // eSpeak-ng data
        { filename: 'espeak/espeakng.worker.data', sizeBytes: 2_100_000 },
      ],
      totalSizeBytes: 149_000_000,
    },
  },
}
```

Note: File sizes are approximate. Exact sizes to be determined when preparing the HuggingFace hosting. In particular, `sys.dic` at ~103MB should be verified — standard OpenJTalk distributions have `sys.dic` at ~9-12MB; the piper-plus version may be larger due to extended vocabulary or may be smaller than estimated.

#### `src/lib/local-inference/types.ts`

Add `lang?: string` to `TtsGenerateMessage` (originally from Supertonic-2 spec):
```typescript
export interface TtsGenerateMessage {
  type: 'generate';
  text: string;
  sid: number;
  speed: number;
  lang?: string;  // NEW: language code for multilingual models
}
```

#### `src/services/clients/LocalInferenceClient.ts`

Pass `targetLanguage` through to `ttsEngine.generate()`:
```typescript
const ttsResult = await this.ttsEngine.generate(
  sentences[i],
  this.config.ttsSpeakerId,
  this.config.ttsSpeed,
  this.config.targetLanguage,  // NEW: for piper-plus language routing
);
```

### Unchanged Files

- **`src/stores/modelStore.ts`** — `isProviderReady()` and `autoSelectModels()` work with existing language matching logic.
- **`src/stores/settingsStore.ts`** — No new settings needed. Existing `ttsSpeed` maps to `length_scale`.
- **UI components** — Model appears automatically in `ModelManagementSection.tsx`. No new controls needed (`numSpeakers: 1`, no `supportsNumSteps`).
- **i18n files** — No new translation keys required.

## HuggingFace Hosting

Model + dictionary + eSpeak data need to be hosted in a HuggingFace dataset repo. Options:
1. Rehost to `jiangzhuo9357/piper-plus-tts-models` dataset (consistent with existing ASR/TTS model hosting)
2. Use `ayousanz/piper-plus-css10-ja-6lang` directly via `hfModelId` (if file structure is compatible)

Directory structure in the dataset:
```
piper-plus-css10-ja-6lang/
  model.onnx
  model.onnx.json
  dict/
    sys.dic
    matrix.bin
    char.bin
    left-id.def
    right-id.def
    rewrite.def
    unk.dic
    pos-id.def
  voice/
    mei_normal.htsvoice
  espeak/
    espeakng.worker.data
```

## Build Integration

### ONNX Runtime Web

Already installed as a dependency of `@huggingface/transformers`. The existing `scripts/copy-ort-wasm.sh` (runs on postinstall) copies WASM runtime files to `public/wasm/ort/`. Only change: add `ort.wasm.min.js` (UMD build, ~50KB) to the copy list for classic worker `importScripts()` compatibility. The existing `.mjs` glue files are ES modules used by translation/Whisper workers; the `.wasm` files are shared by both.

### Piper-Plus Phonemizer WASM

Pre-built files from the piper-plus repo committed to `public/wasm/piper-plus/`. These are static and only change when piper-plus releases a new build.

**Build provenance**: Pre-built WASM files are sourced from the piper-plus `dist/` directory on the `dev` branch. If rebuilding from source is needed: requires Node.js 18+, Emscripten 3.1.47, CMake 3.10+, Python 3.8+. Build commands are in `src/wasm/openjtalk-web/build/`.

## Resource Cleanup

The piper-plus worker's `handleDispose()` must:
1. Call `_openjtalk_clear()` to free OpenJTalk native memory (MeCab, NJD, JPCommon, HTS_Engine)
2. Dispose the ONNX session via `onnxSession.release()`
3. Clear any eSpeak-ng state

Without this, model switching will leak WASM heap memory.

## Limitations

1. **Chinese/Latin phonemization is character-level fallback** — Not real phonemization. Quality for zh/es/fr/pt will be lower than Japanese/English. Users should be aware Japanese is the primary strength.
2. **Single speaker only** — The CSS10-JA model has one voice. Future multi-speaker models could be added as separate manifest entries.
3. **Dictionary size** — The OpenJTalk `sys.dic` dominates the download. Exact size to be verified (may be ~12MB or ~103MB depending on the piper-plus build).
4. **No streaming synthesis** — Piper-plus generates complete audio per sentence, no chunked output. This matches the existing TTS pipeline behavior.
5. **eSpeak-ng English support is experimental** — The piper-plus eSpeak-ng integration includes a hardcoded dictionary fallback (`ESpeakPhonemeExtractor`) for cases where direct phoneme extraction is unavailable.
6. **eSpeak-ng nested worker constraint** — The standard eSpeak-ng WASM loads as a sub-worker (`espeakng.worker.js`). Chrome extension sandbox prohibits nested workers. The eSpeak-ng code must be loaded inline via `importScripts()` in our worker, which may require patching the eSpeak-ng wrapper to not spawn a sub-worker.

## Testing Plan

1. Japanese text input: kanji, hiragana, katakana, mixed scripts
2. English text input via eSpeak-ng path
3. Other languages (zh, es, fr, pt) via character-level fallback
4. Speed control across range (0.5x to 2.0x)
5. Model download, caching, and re-initialization from IndexedDB
6. Worker lifecycle: init → generate multiple → dispose → re-init
7. Error handling: missing dict files, ONNX session failure, invalid text
8. Memory: verify blob URLs revoked after worker load
9. Cross-browser: Chrome, Edge (extension environments)
10. Compare Japanese quality with existing Kokoro TTS
