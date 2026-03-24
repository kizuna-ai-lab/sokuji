# Piper-Plus TTS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add piper-plus as a local multilingual TTS engine with OpenJTalk WASM for accurate Japanese phonemization, running entirely in the browser via ONNX Runtime Web.

**Architecture:** Reuse the existing `TtsEngine` class (Approach C — worker-only abstraction). A new classic worker (`piper-plus-tts.worker.js`) implements the same message protocol as the sherpa-onnx worker but with a completely different runtime: OpenJTalk + eSpeak-ng phonemizers → ONNX Runtime Web inference. The `TtsEngine.init()` method branches on `engine === 'piper-plus'` to select the correct worker and skip sherpa-onnx-specific Emscripten metadata loading.

**Tech Stack:** ONNX Runtime Web (WASM backend, already installed), OpenJTalk WASM (Emscripten), eSpeak-ng WASM, piper-plus VITS model

**Spec:** [`docs/superpowers/specs/2026-03-23-piper-plus-integration-design.md`](../specs/2026-03-23-piper-plus-integration-design.md)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `public/workers/piper-plus-tts.worker.js` | Classic worker: OpenJTalk + eSpeak-ng phonemization → ONNX Runtime Web inference |
| `public/wasm/piper-plus/openjtalk.js` | OpenJTalk Emscripten glue (pre-built, from piper-plus `dist/`) |
| `public/wasm/piper-plus/openjtalk.wasm` | OpenJTalk WASM binary (pre-built) |
| `public/wasm/piper-plus/espeakng.worker.js` | eSpeak-ng Emscripten glue (pre-built, loaded inline via `importScripts`) |
| `public/wasm/piper-plus/espeakng.worker.data` | eSpeak-ng data bundle (pre-built) |
| `public/wasm/piper-plus/japanese_phoneme_extract.js` | OpenJTalk label → phoneme extraction, N-phoneme rules, PUA mapping |
| `public/wasm/piper-plus/simple_unified_api.js` | Language-routed phonemizer: ja→OpenJTalk, en→eSpeak, others→char fallback |
| `public/wasm/piper-plus/espeak_phoneme_extractor.js` | eSpeak-ng wrapper + dictionary fallback for English |
| `public/wasm/ort/ort.wasm.min.js` | ORT UMD build for classic worker `importScripts()` (copied by script) |

### Modified Files
| File | Change |
|------|--------|
| `public/workers/tts.worker.js` | **Rename** → `sherpa-onnx-tts.worker.js` |
| `public/workers/asr.worker.js` | **Rename** → `sherpa-onnx-asr.worker.js` |
| `public/workers/streaming-asr.worker.js` | **Rename** → `sherpa-onnx-streaming-asr.worker.js` |
| `scripts/copy-ort-wasm.sh` | Add `ort.wasm.min.js` to FILES array |
| `src/lib/local-inference/types.ts` | Add `lang?: string` to `TtsGenerateMessage` |
| `src/lib/local-inference/engine/TtsEngine.ts` | Branch init/worker by engine type, add `lang` param to `generate()` |
| `src/lib/local-inference/engine/AsrEngine.ts` | Update worker path to renamed file |
| `src/lib/local-inference/engine/StreamingAsrEngine.ts` | Update worker path to renamed file |
| `src/lib/local-inference/modelManifest.ts` | Add `'piper-plus'` engine type, `languageIdMap` to config, manifest entry |
| `src/services/clients/LocalInferenceClient.ts` | Pass `targetLanguage` as `lang` to `ttsEngine.generate()` |

---

## Task 1: Rename sherpa-onnx workers and update references

Rename the existing classic workers to clearer names before adding the new piper-plus worker. This is a pure rename with reference updates — no logic changes.

**Files:**
- Rename: `public/workers/tts.worker.js` → `public/workers/sherpa-onnx-tts.worker.js`
- Rename: `public/workers/asr.worker.js` → `public/workers/sherpa-onnx-asr.worker.js`
- Rename: `public/workers/streaming-asr.worker.js` → `public/workers/sherpa-onnx-streaming-asr.worker.js`
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:83`
- Modify: `src/lib/local-inference/engine/StreamingAsrEngine.ts:93`

Note: `TtsEngine.ts` worker path is NOT updated here — it will be replaced entirely in Task 5 with branched logic. Only ASR engine references need updating now.

- [ ] **Step 1: Rename the three worker files**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
git mv public/workers/tts.worker.js public/workers/sherpa-onnx-tts.worker.js
git mv public/workers/asr.worker.js public/workers/sherpa-onnx-asr.worker.js
git mv public/workers/streaming-asr.worker.js public/workers/sherpa-onnx-streaming-asr.worker.js
```

- [ ] **Step 2: Update AsrEngine.ts worker path**

In `src/lib/local-inference/engine/AsrEngine.ts`, line 83, change:
```typescript
// Before
this.worker = new Worker('./workers/asr.worker.js');
// After
this.worker = new Worker('./workers/sherpa-onnx-asr.worker.js');
```

- [ ] **Step 3: Update StreamingAsrEngine.ts worker path**

In `src/lib/local-inference/engine/StreamingAsrEngine.ts`, line 93, change:
```typescript
// Before
const workerUrl = './workers/streaming-asr.worker.js';
// After
const workerUrl = './workers/sherpa-onnx-streaming-asr.worker.js';
```

- [ ] **Step 4: Verify the app still builds and existing TTS works**

```bash
npm run build
```

Expected: Build succeeds with no errors. The worker URLs are string literals resolved at runtime, so TypeScript won't catch path mismatches — a build test confirms no import breakage.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename sherpa-onnx workers with explicit prefix

Rename tts.worker.js → sherpa-onnx-tts.worker.js,
asr.worker.js → sherpa-onnx-asr.worker.js,
streaming-asr.worker.js → sherpa-onnx-streaming-asr.worker.js
for clarity before adding the new piper-plus worker."
```

---

## Task 2: Add `lang` parameter plumbing (TTS pipeline)

Wire `targetLanguage` through the TTS pipeline so the piper-plus worker can route to the correct phonemizer. This was originally in the Supertonic-2 spec (now shelved). The existing sherpa-onnx worker ignores `lang` — it's a no-op addition for backwards compatibility.

**Files:**
- Modify: `src/lib/local-inference/types.ts:164-172`
- Modify: `src/lib/local-inference/engine/TtsEngine.ts:175,202`
- Modify: `src/services/clients/LocalInferenceClient.ts:449-453`

- [ ] **Step 1: Add `lang` to `TtsGenerateMessage` type**

In `src/lib/local-inference/types.ts`, add `lang` field to `TtsGenerateMessage` (after line 171):

```typescript
export interface TtsGenerateMessage {
  type: 'generate';
  /** Text to synthesize */
  text: string;
  /** Speaker ID (0 to numSpeakers-1) */
  sid: number;
  /** Speech rate multiplier (default 1.0) */
  speed: number;
  /** Language code for multilingual models (e.g. 'ja', 'en') */
  lang?: string;
}
```

- [ ] **Step 2: Add `lang` parameter to `TtsEngine.generate()`**

In `src/lib/local-inference/engine/TtsEngine.ts`, update the `generate` method signature (line 175) and the `postMessage` call (line 202):

```typescript
// Signature — add lang parameter after speed
async generate(text: string, sid = 0, speed = 1.0, lang?: string): Promise<TtsResult> {
```

```typescript
// postMessage — add lang to the message
this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed, lang });
```

- [ ] **Step 3: Pass `targetLanguage` from `LocalInferenceClient`**

In `src/services/clients/LocalInferenceClient.ts`, at the `ttsEngine.generate()` call (around line 449), add the fourth argument:

```typescript
const ttsResult = await this.ttsEngine.generate(
  sentences[i],
  this.config.ttsSpeakerId,
  this.config.ttsSpeed,
  this.config.targetLanguage,
);
```

- [ ] **Step 4: Verify build succeeds**

```bash
npm run build
```

Expected: Build succeeds. Existing TTS still works because the sherpa-onnx worker ignores the extra `lang` field in the message.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/engine/TtsEngine.ts src/services/clients/LocalInferenceClient.ts
git commit -m "feat(tts): add lang parameter to TTS generate pipeline

Wire targetLanguage through TtsGenerateMessage → TtsEngine.generate() →
LocalInferenceClient. Existing sherpa-onnx worker ignores the field.
Needed for piper-plus multilingual phonemizer routing."
```

---

## Task 3: Add ORT UMD build to copy script

Add `ort.wasm.min.js` (the UMD build of onnxruntime-web, ~50KB) to the copy script so it's available for classic workers via `importScripts()`. The existing `.mjs` files are ES modules and cannot be loaded this way.

**Files:**
- Modify: `scripts/copy-ort-wasm.sh:16-23`

- [ ] **Step 1: Add `ort.wasm.min.js` to the FILES array**

In `scripts/copy-ort-wasm.sh`, add one line to the FILES array (after line 22):

```bash
FILES=(
  "ort-wasm-simd-threaded.asyncify.mjs"
  "ort-wasm-simd-threaded.asyncify.wasm"
  "ort-wasm-simd-threaded.mjs"
  "ort-wasm-simd-threaded.wasm"
  "ort-wasm-simd-threaded.jsep.mjs"
  "ort-wasm-simd-threaded.jsep.wasm"
  "ort.wasm.min.js"
)
```

- [ ] **Step 2: Update the comment at top of FILES array**

Add a comment explaining the UMD file:

```bash
# Needed WASM variants:
#   asyncify  — default (non-Safari browsers)
#   plain     — Safari fallback (no asyncify support)
#   jsep      — WebGPU/WebNN backend (used by Whisper-WebGPU, Qwen workers)
# UMD entry point:
#   ort.wasm.min.js — for classic workers using importScripts() (piper-plus-tts)
```

- [ ] **Step 3: Verify the UMD file exists in node_modules, then run copy script**

```bash
# Verify the file ships with our installed version
node -e "require('fs').accessSync('node_modules/onnxruntime-web/dist/ort.wasm.min.js'); console.log('OK')"
# Copy all ORT files
bash scripts/copy-ort-wasm.sh
# Verify the copy
ls -la public/wasm/ort/ort.wasm.min.js
```

Expected: `OK` from the node check, then file exists at ~50KB after copy. If the node check fails, the installed `onnxruntime-web` version may not include this file — check the version and update if needed.

- [ ] **Step 4: Commit**

```bash
git add scripts/copy-ort-wasm.sh public/wasm/ort/ort.wasm.min.js
git commit -m "build: add ORT UMD build to copy-ort-wasm.sh for classic workers

ort.wasm.min.js (~50KB) is the UMD entry point needed by classic
workers that use importScripts(). The existing .mjs files are ES
modules used by translation/Whisper workers."
```

---

## Task 4: Add piper-plus engine type and manifest entry

Register the new engine type and model in the manifest so it appears in the model management UI and can be downloaded.

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts`

- [ ] **Step 1: Add `'piper-plus'` to `TtsEngineType`**

In `src/lib/local-inference/modelManifest.ts`, line 27, update the type union:

```typescript
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits' | 'supertonic' | 'piper-plus';
```

Note: `'supertonic'` is added here per spec even though Supertonic-2 is shelved — this keeps the type union ready for when it's unblocked.

- [ ] **Step 2: Add `languageIdMap` to `TtsModelConfig`**

In `src/lib/local-inference/modelManifest.ts`, add to the `TtsModelConfig` interface (after `ruleFars`):

```typescript
export interface TtsModelConfig {
  acousticModel?: string;
  vocoder?: string;
  lexicon?: string;
  dataDir?: string;
  dictDir?: string;
  ruleFsts?: string;
  ruleFars?: string;
  /** Language-to-phonemizer routing map for piper-plus multilingual models */
  languageIdMap?: Record<string, number>;
}
```

- [ ] **Step 3: Add the piper-plus manifest entry**

Add the entry to the TTS models array in `modelManifest.ts`. Place it near the existing piper entries. The file list includes model, OpenJTalk dictionary, voice file, and eSpeak-ng data — all downloaded as a single package to IndexedDB.

```typescript
{
  id: 'piper-plus-css10-ja-6lang',
  type: 'tts',
  name: 'Piper-Plus CSS10 JA (6 languages)',
  languages: ['ja', 'en', 'zh', 'es', 'fr', 'pt'],
  multilingual: true,
  hfModelId: 'ayousanz/piper-plus-css10-ja-6lang',
  engine: 'piper-plus',
  numSpeakers: 1,
  ttsConfig: {
    languageIdMap: { ja: 0, en: 1, zh: 2, es: 3, fr: 4, pt: 5 },
  },
  variants: {
    fp16: {
      files: [
        { filename: 'model.onnx', sizeBytes: 39_000_000 },
        { filename: 'model.onnx.json', sizeBytes: 9_000 },
        { filename: 'dict/sys.dic', sizeBytes: 103_000_000 },
        { filename: 'dict/matrix.bin', sizeBytes: 3_800_000 },
        { filename: 'dict/char.bin', sizeBytes: 262_000 },
        { filename: 'dict/left-id.def', sizeBytes: 78_000 },
        { filename: 'dict/right-id.def', sizeBytes: 78_000 },
        { filename: 'dict/rewrite.def', sizeBytes: 7_000 },
        { filename: 'dict/unk.dic', sizeBytes: 6_000 },
        { filename: 'dict/pos-id.def', sizeBytes: 2_000 },
        { filename: 'voice/mei_normal.htsvoice', sizeBytes: 863_000 },
        { filename: 'espeak/espeakng.worker.data', sizeBytes: 2_100_000 },
      ],
      totalSizeBytes: 149_000_000,
    },
  },
},
```

Note: File sizes are approximate. Verify exact sizes when preparing the HuggingFace dataset. `sys.dic` may be ~12MB instead of ~103MB — check the piper-plus `assets/dict/` directory.

- [ ] **Step 4: Verify build succeeds**

```bash
npm run build
```

Expected: Build succeeds. The new model entry appears in `getManifestByType('tts')`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(manifest): add piper-plus TTS engine type and CSS10-JA model entry

Adds 'piper-plus' to TtsEngineType, languageIdMap to TtsModelConfig,
and manifest entry for piper-plus-css10-ja-6lang (6 languages, 1 speaker).
Model + OpenJTalk dict + eSpeak data downloaded as single package."
```

---

## Task 5: Refactor TtsEngine to support piper-plus worker selection

Branch `TtsEngine.init()` to handle piper-plus models differently from sherpa-onnx models: skip Emscripten metadata loading, select the correct worker, and send piper-plus-specific init message.

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`

- [ ] **Step 1: Add a constant for the piper-plus runtime path**

In `src/lib/local-inference/modelManifest.ts`, add after `TTS_BUNDLED_RUNTIME_PATH`:

```typescript
export const PIPER_PLUS_BUNDLED_RUNTIME_PATH = './wasm/piper-plus';
export const ORT_BUNDLED_PATH = './wasm/ort';
```

- [ ] **Step 2: Import the new constants in TtsEngine.ts**

Update the import in `src/lib/local-inference/engine/TtsEngine.ts`:

```typescript
import {
  getManifestEntry,
  getManifestByType,
  TTS_BUNDLED_RUNTIME_PATH,
  PIPER_PLUS_BUNDLED_RUNTIME_PATH,
  ORT_BUNDLED_PATH,
  type ModelManifestEntry,
} from '../modelManifest';
```

- [ ] **Step 3: Refactor `init()` to branch by engine type**

This is a 3-part edit to `TtsEngine.ts`. The `onmessage`/`onerror` handlers (lines 92–151) are **NOT changed** — only the code before and after them.

**Part A** — Replace lines 72–87 (the `package-metadata.json` read and `dataFileUrls` construction) with:

```typescript
    const isPiperPlus = model.engine === 'piper-plus';

    // Sherpa-onnx path: read Emscripten loadPackage metadata
    let dataPackageMetadata: Record<string, unknown> | null = null;
    let dataFileUrls: Record<string, string> = fileUrls;
    if (!isPiperPlus) {
      const metadataBlobUrl = fileUrls['package-metadata.json'];
      if (!metadataBlobUrl) {
        throw new Error(`Missing package-metadata.json for TTS model "${modelId}"`);
      }
      const metadataResponse = await fetch(metadataBlobUrl);
      dataPackageMetadata = await metadataResponse.json();
      // Strip metadata from file URLs sent to worker
      dataFileUrls = {};
      for (const [name, url] of Object.entries(fileUrls)) {
        if (name !== 'package-metadata.json') {
          dataFileUrls[name] = url;
        }
      }
    }
```

**Part B** — Replace lines 88–90 (the `return new Promise` opener and worker creation) with:

```typescript
    return new Promise((resolve, reject) => {
      // Select worker based on engine type
      const workerUrl = isPiperPlus
        ? './workers/piper-plus-tts.worker.js'
        : './workers/sherpa-onnx-tts.worker.js';
      this.worker = new Worker(workerUrl);
```

**Part C** — Replace lines 153–163 (the `worker.postMessage` call through closing `});`) with:

```typescript
      // Send engine-specific init message
      if (isPiperPlus) {
        this.worker.postMessage({
          type: 'init',
          fileUrls,
          runtimeBaseUrl: new URL(PIPER_PLUS_BUNDLED_RUNTIME_PATH, window.location.href).href,
          ortBaseUrl: new URL(ORT_BUNDLED_PATH, window.location.href).href,
          engine: 'piper-plus',
          ttsConfig: model.ttsConfig || {},
        });
      } else {
        this.worker.postMessage({
          type: 'init',
          modelFile: model.modelFile || '',
          engine: model.engine || '',
          ttsConfig: model.ttsConfig || {},
          runtimeBaseUrl: new URL(TTS_BUNDLED_RUNTIME_PATH, window.location.href).href,
          dataPackageMetadata,
          fileUrls: dataFileUrls,
        });
      }
    });
```

Also update the file header comment (line 5):
```typescript
// Before
 * Uses a classic Web Worker (public/workers/tts.worker.js)
// After
 * Selects either sherpa-onnx or piper-plus Web Worker based on engine type.
```

- [ ] **Step 4: Verify build succeeds and existing TTS still works**

```bash
npm run build
```

Expected: Build succeeds. Existing sherpa-onnx TTS models still work because the else-branch is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts src/lib/local-inference/modelManifest.ts
git commit -m "feat(tts): branch TtsEngine.init() for piper-plus worker selection

Skip Emscripten metadata loading for piper-plus engine type, select
piper-plus-tts.worker.js, and send piper-plus-specific init message
with ortBaseUrl and runtimeBaseUrl for OpenJTalk WASM."
```

---

## Task 6: Bundle piper-plus WASM static assets

Copy pre-built WASM files and phonemization JS modules from the piper-plus repo into `public/wasm/piper-plus/`. These are static assets loaded by the worker via `importScripts()`.

**Files:**
- Create: `public/wasm/piper-plus/openjtalk.js` (from piper-plus `dist/`)
- Create: `public/wasm/piper-plus/openjtalk.wasm` (from piper-plus `dist/`)
- Create: `public/wasm/piper-plus/espeakng.worker.js` (from piper-plus `dist/espeak-ng/`)
- Create: `public/wasm/piper-plus/espeakng.worker.data` (from piper-plus `dist/espeak-ng/`)
- Create: `public/wasm/piper-plus/japanese_phoneme_extract.js` (ported from piper-plus `src/`)
- Create: `public/wasm/piper-plus/simple_unified_api.js` (ported from piper-plus `src/`)
- Create: `public/wasm/piper-plus/espeak_phoneme_extractor.js` (ported from piper-plus `src/`)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p public/wasm/piper-plus
```

- [ ] **Step 2: Download pre-built WASM files from piper-plus repo**

Download `openjtalk.js`, `openjtalk.wasm`, and eSpeak-ng files from the piper-plus `dev` branch `dist/` directory. The exact download URLs are:
- `https://github.com/ayutaz/piper-plus/raw/dev/src/wasm/openjtalk-web/dist/openjtalk.js`
- `https://github.com/ayutaz/piper-plus/raw/dev/src/wasm/openjtalk-web/dist/openjtalk.wasm`
- `https://github.com/ayutaz/piper-plus/raw/dev/src/wasm/openjtalk-web/dist/espeak-ng/espeakng.worker.js`
- `https://github.com/ayutaz/piper-plus/raw/dev/src/wasm/openjtalk-web/dist/espeak-ng/espeakng.worker.data`

```bash
cd public/wasm/piper-plus
# Download each file — verify URLs are accessible first
```

- [ ] **Step 3: Port phonemization JS modules**

Port the following files from piper-plus `src/wasm/openjtalk-web/src/` into `public/wasm/piper-plus/`. These must be adapted to work with `importScripts()` in a classic worker context (no ES module imports, expose functions as globals or on `self`):

- `japanese_phoneme_extract.js` — Functions: `extractPhonemesFromLabels()`, `applyNPhonemeRules()`, `mapToPUA()`
- `simple_unified_api.js` — Class: `SimpleUnifiedPhonemizer` with `textToPhonemes(text, lang)` routing
- `espeak_phoneme_extractor.js` — Class: `ESpeakPhonemeExtractor` with dictionary-based fallback

Key adaptation: The eSpeak-ng wrapper must NOT spawn a nested sub-worker (Chrome extension sandbox prohibits this). Patch it to load eSpeak-ng inline via `importScripts()` instead.

- [ ] **Step 4: Verify all files are present**

```bash
ls -la public/wasm/piper-plus/
```

Expected: 7 files — `openjtalk.js`, `openjtalk.wasm`, `espeakng.worker.js`, `espeakng.worker.data`, `japanese_phoneme_extract.js`, `simple_unified_api.js`, `espeak_phoneme_extractor.js`.

- [ ] **Step 5: Commit**

```bash
git add public/wasm/piper-plus/
git commit -m "feat(piper-plus): bundle OpenJTalk + eSpeak-ng WASM and phonemizer JS

Pre-built WASM from piper-plus dist/ (dev branch).
Phonemization JS modules ported for classic worker importScripts().
eSpeak-ng patched to load inline (no nested sub-worker)."
```

---

## Task 7: Create the piper-plus TTS worker

The core of the integration: a classic JS worker implementing the same message protocol as the sherpa-onnx TTS worker (`init`/`generate`/`dispose` → `ready`/`result`/`status`/`error`), but using OpenJTalk + eSpeak-ng phonemization → ONNX Runtime Web inference.

**Files:**
- Create: `public/workers/piper-plus-tts.worker.js`

- [ ] **Step 1: Create the worker file with message handler skeleton**

Create `public/workers/piper-plus-tts.worker.js`:

```javascript
/**
 * Piper-Plus TTS Worker — VITS synthesis via ONNX Runtime Web
 * with OpenJTalk (Japanese) + eSpeak-ng (English) phonemization.
 *
 * Classic Web Worker (not ES module) — uses importScripts() for
 * OpenJTalk Emscripten glue and ONNX Runtime Web UMD build.
 *
 * Protocol (same as sherpa-onnx-tts.worker.js):
 *   Main → Worker:
 *     { type: 'init', fileUrls, runtimeBaseUrl, ortBaseUrl, engine, ttsConfig }
 *     { type: 'generate', text, sid, speed, lang }
 *     { type: 'dispose' }
 *
 *   Worker → Main:
 *     { type: 'ready', loadTimeMs, numSpeakers, sampleRate }
 *     { type: 'status', message }
 *     { type: 'result', samples: Float32Array, sampleRate, generationTimeMs }
 *     { type: 'error', error }
 *     { type: 'disposed' }
 */

'use strict';

var onnxSession = null;
var phonemeIdMap = null;
var prosodyIdMap = null;
var languageIdMap = null;
var sampleRate = 22050;
var isReady = false;

self.onmessage = function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;
    case 'generate':
      handleGenerate(msg);
      break;
    case 'dispose':
      handleDispose();
      break;
    default:
      postMessage({ type: 'error', error: 'Unknown message type: ' + msg.type });
  }
};
```

- [ ] **Step 2: Implement `handleInit`**

Add the init handler. This loads ORT, OpenJTalk WASM, eSpeak-ng, dictionary files, and creates the ONNX session:

```javascript
async function handleInit(msg) {
  var startTime = performance.now();
  var fileUrls = msg.fileUrls;
  var runtimeBaseUrl = msg.runtimeBaseUrl;
  var ortBaseUrl = msg.ortBaseUrl;
  var ttsConfig = msg.ttsConfig || {};

  try {
    // 1. Load ONNX Runtime Web (UMD build for classic worker)
    postMessage({ type: 'status', message: 'Loading ONNX Runtime...' });
    importScripts(ortBaseUrl + '/ort.wasm.min.js');
    ort.env.wasm.wasmPaths = ortBaseUrl + '/';
    ort.env.wasm.numThreads = 1;

    // 2. Load OpenJTalk WASM
    postMessage({ type: 'status', message: 'Loading OpenJTalk...' });
    importScripts(runtimeBaseUrl + '/openjtalk.js');

    // 3. Load phonemization JS modules
    importScripts(runtimeBaseUrl + '/japanese_phoneme_extract.js');
    importScripts(runtimeBaseUrl + '/simple_unified_api.js');
    importScripts(runtimeBaseUrl + '/espeak_phoneme_extractor.js');

    // 4. Write OpenJTalk dict files to Emscripten virtual filesystem
    postMessage({ type: 'status', message: 'Loading dictionary...' });
    var dictFiles = [
      'dict/sys.dic', 'dict/matrix.bin', 'dict/char.bin',
      'dict/left-id.def', 'dict/right-id.def', 'dict/rewrite.def',
      'dict/unk.dic', 'dict/pos-id.def'
    ];
    // Create /dict directory in virtual filesystem
    if (!Module.FS.analyzePath('/dict').exists) {
      Module.FS.mkdir('/dict');
    }
    for (var i = 0; i < dictFiles.length; i++) {
      var filename = dictFiles[i];
      var blobUrl = fileUrls[filename];
      if (!blobUrl) {
        throw new Error('Missing dictionary file: ' + filename);
      }
      var response = await fetch(blobUrl);
      var data = new Uint8Array(await response.arrayBuffer());
      var fsPath = '/' + filename;
      Module.FS.writeFile(fsPath, data);
    }

    // 5. Write voice file
    var voiceBlobUrl = fileUrls['voice/mei_normal.htsvoice'];
    if (!voiceBlobUrl) {
      throw new Error('Missing voice file: voice/mei_normal.htsvoice');
    }
    if (!Module.FS.analyzePath('/voice').exists) {
      Module.FS.mkdir('/voice');
    }
    var voiceData = new Uint8Array(await (await fetch(voiceBlobUrl)).arrayBuffer());
    Module.FS.writeFile('/voice/mei_normal.htsvoice', voiceData);

    // 6. Initialize OpenJTalk
    postMessage({ type: 'status', message: 'Initializing OpenJTalk...' });
    var initResult = Module._openjtalk_initialize(
      Module.allocateUTF8('/dict'),
      Module.allocateUTF8('/voice/mei_normal.htsvoice')
    );
    if (initResult !== 0) {
      throw new Error('OpenJTalk initialization failed (code: ' + initResult + ')');
    }

    // 7. Load eSpeak-ng data for English phonemization
    postMessage({ type: 'status', message: 'Loading eSpeak-ng...' });
    var espeakDataUrl = fileUrls['espeak/espeakng.worker.data'];
    if (espeakDataUrl) {
      // Load eSpeak-ng inline (not as nested worker)
      importScripts(runtimeBaseUrl + '/espeakng.worker.js');
      // Initialize with data from blob URL
      var espeakData = await (await fetch(espeakDataUrl)).arrayBuffer();
      // eSpeak initialization is engine-specific — adapt as needed
    }

    // 8. Parse model config for phoneme_id_map
    postMessage({ type: 'status', message: 'Loading model config...' });
    var configUrl = fileUrls['model.onnx.json'];
    if (!configUrl) {
      throw new Error('Missing model config: model.onnx.json');
    }
    var configData = await (await fetch(configUrl)).json();
    phonemeIdMap = configData.phoneme_id_map || {};
    prosodyIdMap = configData.prosody_id_map || null;
    sampleRate = (configData.audio && configData.audio.sample_rate) || 22050;
    languageIdMap = ttsConfig.languageIdMap || null;

    // 9. Create ONNX inference session
    postMessage({ type: 'status', message: 'Creating ONNX session...' });
    var modelUrl = fileUrls['model.onnx'];
    if (!modelUrl) {
      throw new Error('Missing model file: model.onnx');
    }
    var modelBuffer = await (await fetch(modelUrl)).arrayBuffer();
    onnxSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'extended',
      enableMemPattern: true,
    });

    // 10. Ready
    isReady = true;
    var elapsed = Math.round(performance.now() - startTime);
    postMessage({
      type: 'ready',
      loadTimeMs: elapsed,
      numSpeakers: 1,
      sampleRate: sampleRate,
    });
  } catch (e) {
    postMessage({ type: 'error', error: 'Piper-Plus init failed: ' + (e.message || e) });
  }
}
```

Note: The exact eSpeak-ng initialization will depend on how the WASM loads inline. This may need adaptation during implementation — the `espeakng.worker.js` file typically expects to run as its own worker. See spec Limitation #6.

- [ ] **Step 3: Implement `handleGenerate`**

Add the generate handler. Routes to the correct phonemizer based on language, converts phonemes to IDs, runs ONNX inference:

```javascript
async function handleGenerate(msg) {
  if (!isReady || !onnxSession) {
    postMessage({ type: 'error', error: 'Piper-Plus TTS not initialized' });
    return;
  }

  var startTime = performance.now();

  try {
    var text = msg.text;
    var speed = msg.speed || 1.0;
    var lang = msg.lang || 'ja';

    // 1. Phonemize text based on language
    // SimpleUnifiedPhonemizer is loaded via importScripts in init
    var phonemizer = new SimpleUnifiedPhonemizer(phonemeIdMap, {});
    var phonemeResult = await phonemizer.textToPhonemes(text, lang);

    // 2. Convert phonemes to IDs
    var phonemeIds = phonemeResult.ids;
    if (!phonemeIds || phonemeIds.length === 0) {
      postMessage({
        type: 'result',
        samples: new Float32Array(0),
        sampleRate: sampleRate,
        generationTimeMs: 0,
      });
      return;
    }

    // 3. Build ONNX input tensors
    var inputTensor = new ort.Tensor(
      'int64',
      new BigInt64Array(phonemeIds.map(function(id) { return BigInt(id); })),
      [1, phonemeIds.length]
    );
    var lengthsTensor = new ort.Tensor(
      'int64',
      new BigInt64Array([BigInt(phonemeIds.length)]),
      [1]
    );
    var lengthScale = 1.0 / speed;
    var scalesTensor = new ort.Tensor(
      'float32',
      new Float32Array([0.667, lengthScale, 0.8]),
      [3]
    );

    var feeds = {
      'input': inputTensor,
      'input_lengths': lengthsTensor,
      'scales': scalesTensor,
    };

    // 4. Add optional prosody features for Japanese
    if (prosodyIdMap && lang === 'ja' && phonemeResult.prosody) {
      var prosodyData = new BigInt64Array(phonemeIds.length * 3);
      for (var i = 0; i < phonemeIds.length; i++) {
        var p = phonemeResult.prosody[i] || [0, 0, 0];
        prosodyData[i * 3] = BigInt(p[0]);
        prosodyData[i * 3 + 1] = BigInt(p[1]);
        prosodyData[i * 3 + 2] = BigInt(p[2]);
      }
      feeds['prosody_features'] = new ort.Tensor('int64', prosodyData, [1, phonemeIds.length, 3]);
    }

    // 5. Run inference
    var results = await onnxSession.run(feeds);
    var audioTensor = results['output'] || results[Object.keys(results)[0]];
    var samples = new Float32Array(audioTensor.data);

    var generationTimeMs = Math.round(performance.now() - startTime);

    // 6. Send result with transferable buffer
    postMessage(
      {
        type: 'result',
        samples: samples,
        sampleRate: sampleRate,
        generationTimeMs: generationTimeMs,
      },
      [samples.buffer]
    );
  } catch (e) {
    postMessage({ type: 'error', error: 'Generation failed: ' + (e.message || e) });
  }
}
```

- [ ] **Step 4: Implement `handleDispose`**

Add resource cleanup:

```javascript
function handleDispose() {
  try {
    // Free OpenJTalk native memory
    if (typeof Module !== 'undefined' && Module._openjtalk_clear) {
      Module._openjtalk_clear();
    }

    // Release ONNX session
    if (onnxSession) {
      onnxSession.release();
      onnxSession = null;
    }

    phonemeIdMap = null;
    prosodyIdMap = null;
    languageIdMap = null;
    isReady = false;

    postMessage({ type: 'disposed' });
  } catch (e) {
    postMessage({ type: 'error', error: 'Dispose failed: ' + (e.message || e) });
  }
}
```

- [ ] **Step 5: Verify the worker file is syntactically valid**

```bash
node -c public/workers/piper-plus-tts.worker.js
```

Expected: No syntax errors.

- [ ] **Step 6: Verify app builds**

```bash
npm run build
```

Expected: Build succeeds (worker is loaded at runtime, not bundled by Vite).

- [ ] **Step 7: Commit**

```bash
git add public/workers/piper-plus-tts.worker.js
git commit -m "feat(piper-plus): create TTS worker with OpenJTalk + ONNX Runtime pipeline

Classic worker implementing the same protocol as sherpa-onnx-tts.worker.js.
Init: loads ORT UMD, OpenJTalk WASM, dict files, eSpeak-ng, ONNX model.
Generate: phonemize by language → build tensors → run inference → return audio.
Dispose: frees OpenJTalk memory and ONNX session."
```

---

## Task 8: Prepare HuggingFace model hosting

Upload model + dictionary + eSpeak data to a HuggingFace dataset so the model can be downloaded via the manifest's `hfModelId` URL pattern.

**Files:**
- External: HuggingFace dataset repo

- [ ] **Step 1: Verify file sizes from piper-plus source**

Download and measure the actual file sizes from the piper-plus repo to update the manifest entry if needed. Especially verify `sys.dic` — it may be ~12MB (standard OpenJTalk) rather than ~103MB.

```bash
# Check sizes from piper-plus assets
# If sys.dic is much smaller, update the manifest sizeBytes and totalSizeBytes
```

- [ ] **Step 2: Organize files in the expected directory structure**

```
piper-plus-css10-ja-6lang/
  model.onnx
  model.onnx.json
  dict/sys.dic
  dict/matrix.bin
  dict/char.bin
  dict/left-id.def
  dict/right-id.def
  dict/rewrite.def
  dict/unk.dic
  dict/pos-id.def
  voice/mei_normal.htsvoice
  espeak/espeakng.worker.data
```

- [ ] **Step 3: Upload to HuggingFace**

Use `huggingface_hub` Python API to upload to a dataset repo (avoid cloning large LFS repos). Either:
- Rehost to `jiangzhuo9357/piper-plus-tts-models` dataset, OR
- Verify that `ayousanz/piper-plus-css10-ja-6lang` has this exact directory structure and use it directly

- [ ] **Step 4: Verify download URLs work**

Test that the manifest's `getModelDownloadUrl()` produces working URLs:

```bash
# Example for hfModelId approach:
curl -I "https://huggingface.co/ayousanz/piper-plus-css10-ja-6lang/resolve/main/model.onnx"
curl -I "https://huggingface.co/ayousanz/piper-plus-css10-ja-6lang/resolve/main/dict/sys.dic"
```

Expected: HTTP 200 or 302 redirect for each file.

- [ ] **Step 5: Update manifest entry if file sizes changed**

If actual sizes differ from estimates, update `modelManifest.ts` accordingly.

- [ ] **Step 6: Commit any manifest size corrections**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "fix(manifest): update piper-plus file sizes to match actual HF dataset"
```

---

## Task 9: End-to-end integration test

Test the full pipeline: download model → init engine → generate Japanese speech → verify audio output.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the app and select LOCAL_INFERENCE provider**

Navigate to `http://localhost:5173`. Go to Settings → Provider → Local Inference.

- [ ] **Step 3: Download the piper-plus model**

In Model Management, find "Piper-Plus CSS10 JA (6 languages)" and click Download. Verify:
- Download progress shows correctly
- All files (model, dict, voice, espeak data) download to IndexedDB
- Model status changes to "Downloaded"

- [ ] **Step 4: Test with the TTS proto**

Use Ctrl+Shift+S to open the TTS proto UI. Select the piper-plus model and test:
- Japanese text: `こんにちは世界` (mixed kanji + hiragana)
- Japanese text: `東京タワーは高いです` (kanji + katakana + hiragana)
- English text: `Hello world`
- Speed: 0.5x, 1.0x, 2.0x

Verify: Audio plays, pronunciation is correct, speed control works.

- [ ] **Step 5: Test in full translation pipeline**

Set source language to English, target language to Japanese. Start a session and speak English. Verify:
- ASR → Translation → TTS pipeline completes
- Japanese TTS output uses piper-plus when selected
- Audio plays through ModernAudioPlayer

- [ ] **Step 6: Test model switching**

Switch from piper-plus to another TTS model (e.g., kokoro) and back. Verify:
- No errors on switch
- Memory cleanup works (no console errors about leaked resources)
- Each model produces correct audio

- [ ] **Step 7: Test in Chrome extension context**

Load the extension build and verify:
- Worker loads successfully (no CSP errors)
- `importScripts()` for all WASM files works
- No nested worker errors from eSpeak-ng

---

## Task 10: Update spec status and cleanup

- [ ] **Step 1: Update spec status from Draft to Implemented**

In `docs/superpowers/specs/2026-03-23-piper-plus-integration-design.md`, change:
```
**Status**: Draft
```
to:
```
**Status**: Implemented
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-03-23-piper-plus-integration-design.md
git commit -m "docs: mark Piper-Plus spec as implemented"
```
