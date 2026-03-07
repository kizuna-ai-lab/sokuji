# sherpa-onnx WASM Integration Guide

This document describes how sherpa-onnx ASR and TTS models are integrated into Sokuji's local inference pipeline, and how to add new models.

## Architecture Overview

The local inference system uses a **two-tier architecture**:

1. **Bundled WASM runtime** (shared) — JavaScript glue code and compiled `.wasm` binaries ship with the app at build time. These are identical across all models of the same type (ASR, streaming ASR, or TTS).

2. **Downloaded model `.data` files** (per-model) — Each model's weights and assets are packed into a single Emscripten `.data` file. Users download these on demand; they are cached in IndexedDB for persistence.

### Why Classic Web Workers?

sherpa-onnx compiles to WebAssembly via Emscripten, which generates glue code that uses `importScripts()`. This requires **classic Web Workers** (not ES modules). The ASR, streaming ASR, and TTS workers are plain `.js` files in `public/workers/`.

Exception: Whisper WebGPU ASR uses a separate ES module worker (`src/lib/local-inference/workers/whisper-webgpu.worker.ts`) since it uses HuggingFace Transformers.js rather than sherpa-onnx.

### Data Flow

```
User clicks "Download" in UI
  → ModelManager fetches .data + package-metadata.json from CDN
  → Blobs stored in IndexedDB (persistent)

User starts session
  → Engine reads blobs from IndexedDB → creates blob URLs
  → Worker receives blob URLs + metadata
  → Module.locateFile maps: .data → blob URL, .wasm → bundled path
  → Emscripten loads runtime → onRuntimeInitialized
  → Worker creates VAD/Recognizer (ASR) or OfflineTts (TTS)
  → Posts { type: 'ready' } back to main thread
  → Blob URLs revoked (worker has its own copies)
```

## Key Files Reference

| Component | Path |
|---|---|
| **Workers** | |
| ASR Worker (sherpa-onnx) | `public/workers/asr.worker.js` |
| Streaming ASR Worker | `public/workers/streaming-asr.worker.js` |
| TTS Worker (sherpa-onnx) | `public/workers/tts.worker.js` |
| Whisper WebGPU Worker | `src/lib/local-inference/workers/whisper-webgpu.worker.ts` |
| **Engines (main thread wrappers)** | |
| ASR Engine | `src/lib/local-inference/engine/AsrEngine.ts` |
| Streaming ASR Engine | `src/lib/local-inference/engine/StreamingAsrEngine.ts` |
| TTS Engine | `src/lib/local-inference/engine/TtsEngine.ts` |
| Translation Engine | `src/lib/local-inference/engine/TranslationEngine.ts` |
| **Model management** | |
| Model Manifest | `src/lib/local-inference/modelManifest.ts` |
| Model Storage (IndexedDB) | `src/lib/local-inference/modelStorage.ts` |
| Model Manager (downloads) | `src/lib/local-inference/ModelManager.ts` |
| Model Store (Zustand UI state) | `src/stores/modelStore.ts` |
| Shared Types | `src/lib/local-inference/types.ts` |
| **UI** | |
| Model Management Section | `src/components/Settings/sections/ModelManagementSection.tsx` |
| **Build/pack tooling** | |
| ASR Pack Script | `model-packs/asr/pack.py` |
| TTS Pack Script | `model-packs/tts/pack.py` |
| ASR Metadata Extractor | `scripts/extract-asr-metadata.py` |
| TTS Metadata Extractor | `scripts/extract-tts-metadata.py` |
| **Bundled runtimes** | |
| Offline ASR runtime | `public/wasm/sherpa-onnx-asr/` |
| Streaming ASR runtime | `public/wasm/sherpa-onnx-asr-stream/` |
| TTS runtime | `public/wasm/sherpa-onnx-tts/` |

## Model Packing Pipeline

Raw sherpa-onnx models (from GitHub releases) must be packed into Emscripten `.data` files before they can be used in the browser.

### Step 1: Pack models

```bash
# Pack all ASR models
python3 model-packs/asr/pack.py all

# Pack a single ASR model
python3 model-packs/asr/pack.py sensevoice-nano-int8

# Pack all TTS models (all variants)
python3 model-packs/tts/pack.py all

# Pack a single TTS model, int8 only
python3 model-packs/tts/pack.py piper-en-libritts_r-medium:int8
```

The pack scripts:
1. Download the model tarball from sherpa-onnx GitHub releases
2. Extract model files (weights, tokens, config)
3. Pack files into a single `.data` file using Emscripten's file_packager format
4. Patch the Emscripten glue JS to use injectable metadata (replacing hardcoded `loadPackage({...})`)
5. Copy shared WASM runtime files from a reference directory

Output per model: `wasm-{model}/` directory containing `.data`, `.js` (glue), `.wasm`, and API JS files.

### Step 2: Extract metadata

```bash
# Extract package-metadata.json for all packed ASR models
python3 scripts/extract-asr-metadata.py

# Extract for all packed TTS models
python3 scripts/extract-tts-metadata.py
```

The metadata extractor parses the `loadPackage({...})` call from the glue JS and saves it as `package-metadata.json`. This JSON describes the virtual filesystem layout (filenames, byte offsets, sizes) so the runtime can unpack the `.data` file.

### Step 3: Upload to HuggingFace

Only the `.data` and `package-metadata.json` files are uploaded per model. The JS/WASM runtime is shared and bundled with the app.

## Model Hosting

### Self-hosted HuggingFace Datasets

sherpa-onnx ASR and TTS models are hosted in project-owned HF dataset repos:

| Type | HF Dataset | Default Base URL |
|---|---|---|
| ASR | `jiangzhuo9357/sherpa-onnx-asr-models` | `https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-asr-models/resolve/main` |
| TTS | `jiangzhuo9357/sherpa-onnx-tts-models` | `https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-tts-models/resolve/main` |

URL pattern: `{BASE}/{cdnPath}/{filename}`

Example: `https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-asr-models/resolve/main/wasm-sensevoice-int8/sherpa-onnx-wasm-main-vad-asr.data`

### Third-party HuggingFace Hub

Whisper WebGPU, Opus-MT translation, and Qwen translation models are hosted in public HF model repos by other organizations.

URL pattern: `https://huggingface.co/{hfModelId}/resolve/main/{filename}`

### Environment Variable Overrides

| Env Var | Purpose | Default |
|---|---|---|
| `VITE_ASR_CDN_BASE` | Self-hosted ASR model base URL | HF dataset URL above |
| `VITE_TTS_CDN_BASE` | Self-hosted TTS model base URL | HF dataset URL above |
| `VITE_HF_HUB_BASE` | Third-party HF Hub base URL | `https://huggingface.co` |

## Model Manifest

`modelManifest.ts` is the **single source of truth** for all local inference models. It contains 177 entries across 4 model types.

### Model Counts

| Type | Count | Hosting |
|---|---|---|
| Offline ASR (sherpa-onnx) | 22 | Self-hosted HF dataset |
| Streaming ASR (sherpa-onnx) | 10 | Self-hosted HF dataset |
| Whisper WebGPU ASR | 6 | Third-party HF Hub |
| TTS (sherpa-onnx) | 136 | Self-hosted HF dataset |
| Translation (Opus-MT/Qwen) | ~78 | Third-party HF Hub |

### Manifest Entry Structure

```typescript
interface ModelManifestEntry {
  // Identity
  id: string;            // e.g. 'sensevoice-int8'
  type: ModelType;       // 'asr' | 'asr-stream' | 'tts' | 'translation'
  name: string;          // Human-readable name
  languages: string[];   // ISO 639-1 codes
  multilingual?: boolean;

  // Download — exactly one of these must be set:
  cdnPath?: string;      // Self-hosted: path segment in HF dataset
  hfModelId?: string;    // Third-party: HF Hub model ID
  files?: ModelFileEntry[];  // Files to download with sizes

  // Hardware
  requiredDevice?: 'webgpu';
  dtype?: string | Record<string, string>;

  // ASR-specific
  asrEngine?: AsrEngineType | StreamAsrEngineType;
  asrWorkerType?: 'sherpa-onnx' | 'whisper-webgpu';

  // TTS-specific
  modelFile?: string;    // .onnx filename
  engine?: TtsEngineType;
  ttsConfig?: TtsModelConfig;
  numSpeakers?: number;

  // Translation-specific
  sourceLang?: string;
  targetLang?: string;
  translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35';
}
```

### ASR Engine Types (14)

| Engine Type | Config Builder | Model Files |
|---|---|---|
| `sensevoice` | `buildSenseVoiceConfig` | `sense-voice.onnx` |
| `whisper` | `buildWhisperConfig` | `whisper-encoder.onnx`, `whisper-decoder.onnx` |
| `transducer` | `buildTransducerConfig` | `transducer-{encoder,decoder,joiner}.onnx` |
| `nemo-transducer` | `buildNemoTransducerConfig` | `nemo-transducer-{encoder,decoder,joiner}.onnx` |
| `paraformer` | `buildParaformerConfig` | `paraformer.onnx` |
| `telespeech` | `buildTelespeechConfig` | `telespeech.onnx` |
| `moonshine` | `buildMoonshineConfig` | `moonshine-{preprocessor,encoder,uncachedDecoder,cachedDecoder}.onnx` |
| `moonshine-v2` | `buildMoonshineV2Config` | `moonshine-encoder.ort`, `moonshine-merged-decoder.ort` |
| `dolphin` | `buildDolphinConfig` | `dolphin.onnx` |
| `zipformer-ctc` | `buildZipformerCtcConfig` | `zipformer-ctc.onnx` |
| `nemo-ctc` | `buildNemoCtcConfig` | `nemo-ctc.onnx` |
| `canary` | `buildCanaryConfig` | `canary-encoder.onnx`, `canary-decoder.onnx` |
| `wenet-ctc` | `buildWenetCtcConfig` | `wenet-ctc.onnx` |
| `omnilingual` | `buildOmnilingualConfig` | `omnilingual.onnx` |

Streaming ASR engine types: `stream-transducer`, `stream-nemo-ctc`

### TTS Engine Types (7)

| Engine Type | Config Builder | Description |
|---|---|---|
| `piper` | `buildPiperConfig` | VITS with custom .onnx filename, espeak-ng phonemizer |
| `coqui` | `buildCoquiConfig` | VITS, always `model.onnx`, grapheme or espeak-ng |
| `mimic3` | `buildMimic3Config` | VITS with unique .onnx filenames, espeak-ng |
| `mms` | `buildMmsConfig` | VITS, always `model.onnx`, grapheme-based (no espeak) |
| `matcha` | `buildMatchaConfig` | Matcha config with separate acoustic model + vocoder |
| `kokoro` | `buildKokoroConfig` | Kokoro config with `voices.bin` + optional lexicons |
| `vits` | `buildVitsConfig` | Advanced VITS with lexicon, dictDir, ruleFsts/ruleFars |

### File List Helpers

The manifest uses helper functions to generate per-model file lists:

| Helper | Downloads | Used By |
|---|---|---|
| `asrFiles(dataSize, metaSize)` | `.data` + `package-metadata.json` | Offline ASR |
| `streamAsrFiles(dataSize, metaSize)` | `.data` + `package-metadata.json` | Streaming ASR |
| `ttsFiles(dataSize, metaSize)` | `.data` + `package-metadata.json` | TTS |
| `translationFiles(...)` | config + tokenizer + encoder/decoder ONNX | Opus-MT |
| `whisperFiles(...)` | config + preprocessor + tokenizer + encoder/decoder | Whisper WebGPU |
| `qwenTranslationFiles()` | config + tokenizer + single model ONNX | Qwen |

## Worker Architecture

### ASR Worker (`asr.worker.js`)

**Init flow:**
1. Receives `{ type: 'init', fileUrls, asrEngine, vadConfig, runtimeBaseUrl, dataPackageMetadata }`
2. Configures `Module` object: `_dataPackageMetadata`, `locateFile`, `onRuntimeInitialized`
3. `importScripts` loads 3 files from bundled runtime:
   - `sherpa-onnx-wasm-main-vad-asr.js` (Emscripten glue)
   - `sherpa-onnx-vad.js` (VAD API: `CircularBuffer`, `Vad`, `createVad`)
   - `sherpa-onnx-asr.js` (ASR API: `OfflineRecognizer`, `OfflineStream`)
4. On `onRuntimeInitialized`: creates VAD (Silero model), CircularBuffer (30s), OfflineRecognizer
5. Posts `{ type: 'ready', loadTimeMs }`

**Audio processing flow:**
```
Int16Array @ 24kHz input
  → downsampleInt16ToFloat32 → Float32 @ 16kHz
  → CircularBuffer.push()
  → Feed 512-sample windows to VAD (vad.acceptWaveform)
  → When VAD detects speech segment (vad.front()):
    → recognizer.createStream()
    → stream.acceptWaveform(16000, speechSamples)
    → recognizer.decode(stream)
    → recognizer.getResult(stream)
    → Post { type: 'result', text, startSample, durationMs, recognitionTimeMs }
    → stream.free(), vad.pop()
```

**Message protocol:**

| Direction | Message | Fields |
|---|---|---|
| Main → Worker | `init` | `fileUrls`, `asrEngine`, `vadConfig?`, `runtimeBaseUrl`, `dataPackageMetadata` |
| Main → Worker | `audio` | `samples: Int16Array`, `sampleRate: number` |
| Main → Worker | `dispose` | — |
| Worker → Main | `ready` | `loadTimeMs` |
| Worker → Main | `status` | `message` |
| Worker → Main | `result` | `text`, `startSample`, `durationMs`, `recognitionTimeMs` |
| Worker → Main | `error` | `error` |
| Worker → Main | `disposed` | — |

### TTS Worker (`tts.worker.js`)

**Init flow:**
1. Receives `{ type: 'init', fileUrls, modelFile, engine, ttsConfig, runtimeBaseUrl, dataPackageMetadata }`
2. Configures `Module` object similarly to ASR
3. `importScripts` loads 2 files from bundled runtime:
   - `sherpa-onnx-wasm-main-tts.js` (Emscripten glue)
   - `sherpa-onnx-tts.js` (TTS API: `OfflineTts`, `createOfflineTts`)
4. On `onRuntimeInitialized`: builds engine-specific config via `buildEngineConfig(engine, modelFile, ttsConfig)`, creates TTS instance
5. Posts `{ type: 'ready', loadTimeMs, numSpeakers, sampleRate }`

**Generation flow:**
```
{ type: 'generate', text, sid, speed }
  → tts.generate({ text, sid, speed })
  → Returns { samples: Float32Array, sampleRate }
  → Post { type: 'result', samples, sampleRate, generationTimeMs }
  (samples buffer transferred via postMessage for zero-copy)
```

**TTS config structure:** Each engine type requires specific sherpa-onnx config sections. The worker always provides all config sections (filling unused ones with empty defaults):

```javascript
{
  offlineTtsModelConfig: {
    offlineTtsVitsModelConfig: { ... },     // piper, coqui, mimic3, mms, vits
    offlineTtsMatchaModelConfig: { ... },   // matcha
    offlineTtsKokoroModelConfig: { ... },   // kokoro
    offlineTtsKittenModelConfig: { ... },   // (reserved, currently empty)
    numThreads: 1, debug: 1, provider: 'cpu',
  },
  ruleFsts: '', ruleFars: '',
  maxNumSentences: 1,
}
```

## Engine Wrapper Pattern

`AsrEngine.ts` and `TtsEngine.ts` provide Promise-based main thread wrappers around the workers.

### Common Pattern

```typescript
class Engine {
  private worker: Worker | null;
  private isReady = false;
  private currentModel: ModelManifestEntry | null;

  async init(modelId: string): Promise<{ loadTimeMs: number }> {
    // 1. Look up manifest entry
    const model = getManifestEntry(modelId);

    // 2. Check if model is downloaded
    const manager = ModelManager.getInstance();
    if (!await manager.isModelReady(modelId)) throw Error;

    // 3. Get blob URLs from IndexedDB
    const fileUrls = await manager.getModelBlobUrls(modelId);

    // 4. Fetch package-metadata.json from blob URL
    const metadata = await fetch(fileUrls['package-metadata.json']).then(r => r.json());

    // 5. Create worker, send init message
    this.worker = new Worker('/workers/xxx.worker.js');
    this.worker.postMessage({ type: 'init', fileUrls, ..., dataPackageMetadata: metadata });

    // 6. Wait for 'ready' message, then revoke blob URLs
    return new Promise((resolve) => {
      this.worker.onmessage = (msg) => {
        if (msg.data.type === 'ready') {
          manager.revokeBlobUrls(fileUrls);  // Free memory
          resolve({ loadTimeMs: msg.data.loadTimeMs });
        }
      };
    });
  }

  dispose() {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
  }
}
```

### Blob URL Lifecycle

1. **Created** from IndexedDB blobs via `URL.createObjectURL()` in `ModelManager.getModelBlobUrls()`
2. **Sent** to worker via `postMessage` (worker uses them in `Module.locateFile`)
3. **Revoked** on main thread after worker posts `ready` (worker has already loaded the data)

## Runtime Download Flow

`ModelManager.downloadModel()` orchestrates the download:

1. Look up manifest entry for file list and CDN URLs
2. Set metadata status to `downloading` in IndexedDB
3. For each file:
   - **Resume support**: Skip files already stored (`storage.hasFile()`)
   - Stream-fetch from CDN with `AbortController` for cancellation
   - **Validation before storage:**
     - HTML check (first byte `<` = likely 404 page)
     - Size check (>20% deviation from expected = error)
     - WASM magic number check for `.wasm` files
     - JSON parse check for `.json` files
   - Store validated blob in IndexedDB
4. Set metadata status to `downloaded`
5. On error: set status to `error`, leave partial files for resume on retry
6. On cancel: leave partial files, throw `AbortError`

### Storage

IndexedDB database `sokuji-models` (version 1) with two object stores:
- `files`: key = `{modelId}/{filename}` → `Blob`
- `metadata`: key = `modelId` → `{ status, downloadedAt, totalSizeBytes, version }`

### UI State

`modelStore.ts` (Zustand) provides reactive state:
- `modelStatuses`: status of each model (`not_downloaded` | `downloading` | `downloaded` | `error`)
- `downloads`: active download progress (bytes, percent, current file)
- `storageUsedMb`: total IndexedDB storage estimate
- `isProviderReady(srcLang, tgtLang)`: checks if ASR + translation + TTS models are available for a language pair

## Step-by-Step: Adding a New Model

### Adding a model with an existing engine type

This is the common case (e.g., adding a new Piper TTS voice or a new SenseVoice variant).

1. **Pack the model** using the appropriate pack script:
   ```bash
   # Add the model to the MODELS dict in pack.py first, then:
   python3 model-packs/tts/pack.py my-new-model
   ```

2. **Extract metadata:**
   ```bash
   python3 scripts/extract-tts-metadata.py model-packs/tts/wasm-my-new-model
   ```

3. **Upload to HuggingFace:**
   Upload the `.data` and `package-metadata.json` from the `wasm-my-new-model/` directory to the appropriate HF dataset repo.

4. **Add manifest entry** in `modelManifest.ts`:
   ```typescript
   {
     id: 'my-new-model',
     type: 'tts',
     name: 'My New Model (English)',
     languages: ['en'],
     cdnPath: 'wasm-my-new-model',
     files: ttsFiles(DATA_SIZE, METADATA_SIZE),  // exact byte sizes
     modelFile: 'en_US-my_model-medium.onnx',
     engine: 'piper',  // existing engine type
   },
   ```

5. **Test:** Download the model via the UI, run TTS generation, verify audio output.

### Adding a model with a new engine type

This requires adding a config builder in the worker.

1. **Add the engine type** to `modelManifest.ts`:
   ```typescript
   // In TtsEngineType:
   export type TtsEngineType = 'piper' | 'coqui' | ... | 'my-new-engine';

   // Or in AsrEngineType:
   export type AsrEngineType = ... | 'my-new-engine';
   ```

2. **Add a config builder** in the appropriate worker (`asr.worker.js` or `tts.worker.js`):
   ```javascript
   // For TTS:
   function buildMyNewEngineConfig(modelFile, ttsConfig) {
     return baseConfig({
       offlineTtsVitsModelConfig: { /* ... */ },
       ...emptyMatcha(),
       ...emptyKokoro(),
       ...emptyKitten(),
     });
   }

   // Add to the engine router switch:
   case 'my-new-engine':
     return buildMyNewEngineConfig(modelFile, ttsConfig);
   ```

   ```javascript
   // For ASR:
   function buildMyNewEngineConfig() {
     return {
       myNewEngine: { model: './my-model.onnx' },
     };
   }

   // Add to buildAsrConfig switch:
   case 'my-new-engine': engineConfig = buildMyNewEngineConfig(); break;
   ```

3. **Add an empty config function** if sherpa-onnx requires a new config section (TTS only):
   ```javascript
   function emptyMyNewEngine() {
     return {
       offlineTtsMyNewEngineModelConfig: {
         model: '', /* other required fields */
       },
     };
   }
   // Add ...emptyMyNewEngine() to ALL existing engine builders
   ```

4. **Pack, extract metadata, upload, and add manifest entries** (same as existing engine steps above).

5. **Add TtsModelConfig fields** if the engine has non-standard configuration:
   ```typescript
   export interface TtsModelConfig {
     // ... existing fields ...
     myField?: string;  // my-new-engine: custom field
   }
   ```

### Testing Checklist

- [ ] Model downloads successfully (check IndexedDB storage)
- [ ] Worker initializes without errors (check console for `ready` message)
- [ ] ASR: Feed audio, verify transcription results
- [ ] TTS: Generate speech, verify audio playback
- [ ] Cancel/resume download works
- [ ] Delete model frees storage
- [ ] `isProviderReady` correctly reflects model availability
- [ ] Model appears correctly in ModelManagementSection UI

## Bundled Runtime Files

The WASM runtime is shared across all models of the same type. These files are checked into the repo and served as static assets:

### Offline ASR (`public/wasm/sherpa-onnx-asr/`)
- `sherpa-onnx-wasm-main-vad-asr.js` — Emscripten glue (patched: metadata injection)
- `sherpa-onnx-wasm-main-vad-asr.wasm` — Compiled WASM binary
- `sherpa-onnx-vad.js` — VAD API (`CircularBuffer`, `Vad`, `createVad`)
- `sherpa-onnx-asr.js` — ASR API (`OfflineRecognizer`, `OfflineStream`)

### Streaming ASR (`public/wasm/sherpa-onnx-asr-stream/`)
- `sherpa-onnx-wasm-main-asr.js` — Emscripten glue (no VAD)
- `sherpa-onnx-wasm-main-asr.wasm` — Compiled WASM binary
- `sherpa-onnx-asr.js` — ASR API (`OnlineRecognizer`)

### TTS (`public/wasm/sherpa-onnx-tts/`)
- `sherpa-onnx-wasm-main-tts.js` — Emscripten glue
- `sherpa-onnx-wasm-main-tts.wasm` — Compiled WASM binary
- `sherpa-onnx-tts.js` — TTS API (`OfflineTts`, `createOfflineTts`)

### Glue JS Patching

The Emscripten glue JS files are patched during packing to support injectable metadata. The original code has a hardcoded `loadPackage({files: [...], remote_package_size: N})` call. The patched version reads from `Module._dataPackageMetadata` instead, allowing the same glue JS to work with any model's `.data` file.

---

## Appendix: Supertonic TTS Research

> **Status: Not yet integrated.** This section documents research for future integration of the Supertonic TTS engine into Sokuji's local inference pipeline.

### What is Supertonic?

[Supertonic](https://github.com/supertone-inc/supertonic) is a lightning-fast, on-device TTS system by Supertone Inc. with only **66M parameters**, offering quality comparable to Kokoro TTS but with a significantly smaller footprint. It runs via ONNX Runtime and supports browser deployment with WebGPU/WASM.

### sherpa-onnx Support Status

As of March 2026, sherpa-onnx does **not** have Supertonic support. A [GitHub discussion (#2833)](https://github.com/k2-fsa/sherpa-onnx/discussions/2833) requesting support remains unanswered. This means Supertonic cannot be integrated via the existing sherpa-onnx worker pattern.

**Alternative approach:** Supertonic has its own [web implementation](https://github.com/supertone-inc/supertonic/tree/main/web) using `onnxruntime-web` directly (WebGPU with WASM fallback). Integration would require a **dedicated worker** (similar to the Whisper WebGPU worker pattern) rather than going through sherpa-onnx.

### Model Architecture

Supertonic uses a 4-component ONNX pipeline:

| Component | File | Size | Purpose |
|---|---|---|---|
| Duration Predictor | `duration_predictor.onnx` | 1.52 MB | Predicts phoneme timing from text + `style_dp` vector |
| Text Encoder | `text_encoder.onnx` | 27.4 MB | Generates contextualized text embeddings + `style_ttl` vector |
| Vector Estimator | `vector_estimator.onnx` | 132 MB | Iterative diffusion-based denoising of latent representations |
| Vocoder | `vocoder.onnx` | 101 MB | Converts clean latent vectors to audio waveforms |

Additional files:
- `tts.json` (8.7 kB) — Config: sample rate 24kHz, chunk size, latent dimensions
- `unicode_indexer.json` (262 kB) — Character-to-vocabulary mapping (NFKD normalized)
- `voice_styles/{M1-M5,F1-F5}.json` (~420 kB each) — 10 preset voices, each containing `style_ttl` and `style_dp` vectors

**Total model size:** ~263 MB (from [Supertone/supertonic-2](https://huggingface.co/Supertone/supertonic-2))

### Inference Pipeline

```
Text Input
  -> Unicode Processing (NFKD normalization, unicode_indexer.json)
  -> Duration Predictor (text + style_dp -> timing)
  -> Text Encoder (text + style_ttl -> embeddings)
  -> Vector Estimator (iterative denoising, 2-10 steps configurable)
  -> Vocoder (latent -> 24kHz 16-bit PCM audio)
```

Voice styles are split into two components:
- `style_ttl`: Controls acoustic characteristics (pitch, timbre)
- `style_dp`: Controls temporal characteristics (rhythm, speed)

### Supported Languages

English, Korean, Spanish, Portuguese, French (all sharing the same model).

### Integration Plan (if proceeding)

Since sherpa-onnx doesn't support Supertonic, integration would follow the **Whisper WebGPU pattern**:

1. **New worker type**: Create `src/lib/local-inference/workers/supertonic.worker.ts` (ES module worker using `onnxruntime-web`)
2. **New engine type**: Add `'supertonic'` to `TtsEngineType` or create a separate type
3. **Worker type field**: Use `ttsWorkerType: 'supertonic'` in manifest (similar to `asrWorkerType: 'whisper-webgpu'`)
4. **Model hosting**: Host ONNX files on HF Hub (4 ONNX + 2 JSON + voice styles)
5. **Manifest entries**: One entry per voice or one entry with multi-speaker support
6. **TtsEngine changes**: Add worker selection logic based on `ttsWorkerType`

Key differences from sherpa-onnx TTS:
- Uses `onnxruntime-web` directly instead of Emscripten-compiled sherpa-onnx
- No `.data` file packing — individual ONNX files loaded separately
- WebGPU preferred (with WASM fallback) instead of CPU-only WASM
- Multi-step diffusion inference (configurable quality/speed tradeoff)
- Voice styles are JSON files rather than embedded speaker IDs

### References

- [Supertonic GitHub](https://github.com/supertone-inc/supertonic)
- [Supertonic-2 HuggingFace Model](https://huggingface.co/Supertone/supertonic-2)
- [sherpa-onnx Discussion #2833](https://github.com/k2-fsa/sherpa-onnx/discussions/2833)
- [DeepWiki Architecture Analysis](https://deepwiki.com/supertone-inc/supertonic)
