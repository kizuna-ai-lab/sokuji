# Supertonic-2 TTS Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supertonic-2 as a local TTS engine via the existing sherpa-onnx WASM pipeline.

**Architecture:** Extends the existing TTS worker with a new `supertonic` engine type and unifies all engines on the `generateWithConfig` API. No new files — only edits to existing worker, engine, manifest, types, settings, UI, and i18n.

**Tech Stack:** sherpa-onnx WASM (v1.12.31), TypeScript, React, Zustand, i18next

**Spec:** `docs/superpowers/specs/2026-03-23-supertonic2-integration-design.md`

---

### Task 1: Worker — Add Supertonic engine config and unify generate API

**Files:**
- Modify: `public/workers/tts.worker.js`

This is the core change. Adds the Supertonic config builder, spreads `emptySupertonic()` into all existing builders, and replaces `tts.generate()` with `tts.generateWithConfig()` for all engines.

- [ ] **Step 1: Add `emptySupertonic()` function after `emptyKitten()` (line 93)**

```javascript
/** Empty Supertonic config section. */
function emptySupertonic() {
  return {
    offlineTtsSupertonicModelConfig: {
      durationPredictor: '', textEncoder: '', vectorEstimator: '',
      vocoder: '', ttsJson: '', unicodeIndexer: '', voiceStyle: '',
    },
  };
}
```

- [ ] **Step 2: Add `buildSupertonicConfig()` after `buildVitsConfig()` (after line 230)**

```javascript
// ─── Supertonic ────────────────────────────────────────────────────────
// Uses offlineTtsSupertonicModelConfig with 4 ONNX models + config files.
function buildSupertonicConfig(ttsConfig) {
  return baseConfig({
    ...emptyVits(),
    ...emptyMatcha(),
    ...emptyKokoro(),
    ...emptyKitten(),
    offlineTtsSupertonicModelConfig: {
      durationPredictor: (ttsConfig && ttsConfig.durationPredictor) || './duration_predictor.int8.onnx',
      textEncoder: (ttsConfig && ttsConfig.textEncoder) || './text_encoder.int8.onnx',
      vectorEstimator: (ttsConfig && ttsConfig.vectorEstimator) || './vector_estimator.int8.onnx',
      vocoder: (ttsConfig && ttsConfig.vocoder) || './vocoder.int8.onnx',
      ttsJson: (ttsConfig && ttsConfig.ttsJson) || './tts.json',
      unicodeIndexer: (ttsConfig && ttsConfig.unicodeIndexer) || './unicode_indexer.bin',
      voiceStyle: (ttsConfig && ttsConfig.voiceStyle) || './voice.bin',
    },
  });
}
```

- [ ] **Step 3: Add `case 'supertonic'` to engine router switch (in `buildEngineConfig`, around line 253)**

```javascript
    case 'supertonic':
      return buildSupertonicConfig(ttsConfig);
```

- [ ] **Step 4: Add `...emptySupertonic()` to all 7 existing engine builders**

Each builder that currently ends with `...emptyKitten()` needs `...emptySupertonic()` added after it. This affects:
- `buildPiperConfig` (line ~110)
- `buildCoquiConfig` (line ~130)
- `buildMimic3Config` (line ~149)
- `buildMmsConfig` (line ~168)
- `buildMatchaConfig` (line ~188)
- `buildKokoroConfig` (line ~207)
- `buildVitsConfig` (line ~228)

Pattern — change each from:
```javascript
    ...emptyKitten(),
  });
```
to:
```javascript
    ...emptyKitten(),
    ...emptySupertonic(),
  });
```

For `buildMatchaConfig`, `buildKokoroConfig`, and `buildVitsConfig` which pass trailing args (`ruleFsts`, `ruleFars`) to `baseConfig()`, add `...emptySupertonic()` before the closing `}` of the first argument (the model config object), not after `})`.

- [ ] **Step 5: Replace `handleGenerate` to use `generateWithConfig` for all engines**

Replace the entire `handleGenerate` function (lines ~362-392) with:

```javascript
function handleGenerate(msg) {
  if (!isReady || !tts) {
    postMessage({ type: 'error', error: 'TTS not initialized' });
    return;
  }

  var startTime = performance.now();

  try {
    var audio = tts.generateWithConfig(msg.text, {
      sid: msg.sid || 0,
      speed: msg.speed || 1.0,
      numSteps: msg.numSteps || 0,
      extra: msg.lang ? { lang: msg.lang } : {},
    });

    var generationTimeMs = Math.round(performance.now() - startTime);

    // Transfer the samples buffer for zero-copy performance
    postMessage(
      {
        type: 'result',
        samples: audio.samples,
        sampleRate: audio.sampleRate,
        generationTimeMs: generationTimeMs,
      },
      [audio.samples.buffer]
    );
  } catch (e) {
    postMessage({ type: 'error', error: 'Generation failed: ' + (e.message || e) });
  }
}
```

- [ ] **Step 6: Update the worker header comment (lines 14-19)**

Update the protocol comment to include `numSteps?` and `lang?` in the generate message:
```
 *     { type: 'generate', text: string, sid: number, speed: number,
 *       numSteps?: number, lang?: string }
```

- [ ] **Step 7: Verify existing TTS still works**

Run: `npm run dev` and test with an existing TTS model (e.g. Piper EN) to confirm the `generateWithConfig` migration doesn't break anything.

- [ ] **Step 8: Commit**

```bash
git add public/workers/tts.worker.js
git commit -m "feat(tts): add supertonic engine config and unify on generateWithConfig"
```

---

### Task 2: Type definitions — Extend worker message types

**Files:**
- Modify: `src/lib/local-inference/types.ts:156-178`

- [ ] **Step 1: Fix `TtsInitMessage` to match actual worker protocol (lines 156-162)**

Replace:
```typescript
export interface TtsInitMessage {
  type: 'init';
  /** Model .onnx filename (without path prefix), e.g. 'en_US-libritts_r-medium.onnx' */
  modelFile: string;
  /** Map of filename → blob URL for loading model files from IndexedDB */
  fileUrls: Record<string, string>;
}
```

With:
```typescript
export interface TtsInitMessage {
  type: 'init';
  /** Model .onnx filename (without path prefix), e.g. 'en_US-libritts_r-medium.onnx' */
  modelFile: string;
  /** TTS engine type — determines which config builder the worker uses */
  engine: string;
  /** Engine-specific config overrides (model paths, vocoder, lexicon, etc.) */
  ttsConfig: Record<string, unknown>;
  /** Map of filename → blob URL for loading model files from IndexedDB */
  fileUrls: Record<string, string>;
  /** Base URL for bundled TTS runtime (JS/WASM shared across all models) */
  runtimeBaseUrl: string;
  /** Emscripten loadPackage metadata (file offsets/sizes from package-metadata.json) */
  dataPackageMetadata: Record<string, unknown>;
}
```

- [ ] **Step 2: Add `numSteps?` and `lang?` to `TtsGenerateMessage` (lines 164-172)**

Replace:
```typescript
export interface TtsGenerateMessage {
  type: 'generate';
  /** Text to synthesize */
  text: string;
  /** Speaker ID (0 to numSpeakers-1) */
  sid: number;
  /** Speech rate multiplier (default 1.0) */
  speed: number;
}
```

With:
```typescript
export interface TtsGenerateMessage {
  type: 'generate';
  /** Text to synthesize */
  text: string;
  /** Speaker ID (0 to numSpeakers-1) */
  sid: number;
  /** Speech rate multiplier (default 1.0) */
  speed: number;
  /** Inference steps for diffusion models (Supertonic: 2=fast, 5=quality). Ignored by non-diffusion engines. */
  numSteps?: number;
  /** Language tag for multilingual TTS (e.g. 'en', 'ko'). Passed as extra.lang to sherpa-onnx. */
  lang?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/types.ts
git commit -m "fix(types): align TtsInitMessage with actual protocol, add numSteps/lang to generate"
```

---

### Task 3: Model manifest — Add supertonic engine type and model entry

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts:27` (TtsEngineType)
- Modify: `src/lib/local-inference/modelManifest.ts:86-94` (ModelManifestEntry)
- Modify: `src/lib/local-inference/modelManifest.ts` (model entries section, after existing TTS entries)

- [ ] **Step 1: Add `'supertonic'` to TtsEngineType (line 27)**

Change:
```typescript
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits';
```
To:
```typescript
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits' | 'supertonic';
```

- [ ] **Step 2: Add `supportsNumSteps` to ModelManifestEntry (after line 94, after `numSpeakers`)**

```typescript
  /** Whether the model supports configurable inference steps (e.g. diffusion-based TTS) */
  supportsNumSteps?: boolean;
```

- [ ] **Step 3: Add supertonic-int8 model entry**

Find the TTS model entries section (after the last existing TTS entry, search for the last `engine: 'kokoro'` or similar). Add:

```typescript
  // ── Supertonic 2 ──────────────────────────────────────────────────────
  {
    id: 'supertonic-int8',
    type: 'tts',
    name: 'Supertonic 2 (EN/KO/ES/PT/FR)',
    languages: ['en', 'ko', 'es', 'pt', 'fr'],
    multilingual: true,
    cdnPath: 'wasm-supertonic-int8',
    variants: { default: { dtype: 'default', files: ttsFiles(DATA_SIZE, METADATA_SIZE) } },
    engine: 'supertonic',
    numSpeakers: N,
    supportsNumSteps: true,
  },
```

> **Note:** `DATA_SIZE`, `METADATA_SIZE`, and `N` (numSpeakers) are TBD — fill in after running `python3 model-packs/tts/pack.py supertonic-int8` and checking the output. Use placeholder values initially (e.g. `80_000_000` for data, `1000` for metadata, `1` for numSpeakers) and update after Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(manifest): add supertonic engine type and model entry"
```

---

### Task 4: TtsEngine — Extend generate() signature

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts:175-203`

- [ ] **Step 1: Update `generate()` method signature and postMessage (lines 175-203)**

Change the method signature from:
```typescript
  async generate(text: string, sid = 0, speed = 1.0): Promise<TtsResult> {
```
To:
```typescript
  async generate(text: string, sid = 0, speed = 1.0, numSteps?: number, lang?: string): Promise<TtsResult> {
```

And update the postMessage call (line 202) from:
```typescript
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed });
```
To:
```typescript
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed, numSteps, lang });
```

- [ ] **Step 2: Update JSDoc for generate() (lines 167-173)**

Update the doc comment to include the new parameters:
```typescript
  /**
   * Generate speech audio from text.
   * Returns a Promise with the synthesized audio.
   *
   * @param text - Text to synthesize
   * @param sid - Speaker ID (0 to numSpeakers-1, default 0)
   * @param speed - Speech rate multiplier (default 1.0)
   * @param numSteps - Inference steps for diffusion models (e.g. Supertonic: 2=fast, 5=quality)
   * @param lang - Language tag for multilingual TTS (e.g. 'en', 'ko')
   */
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts
git commit -m "feat(tts-engine): extend generate() with numSteps and lang params"
```

---

### Task 5: Session config + Settings store — Add ttsNumSteps

**Files:**
- Modify: `src/services/interfaces/IClient.ts:118-131`
- Modify: `src/stores/settingsStore.ts:111-123` (interface)
- Modify: `src/stores/settingsStore.ts:265-268` (defaults)
- Modify: `src/stores/settingsStore.ts:464-478` (buildSessionConfig)

- [ ] **Step 1: Add `ttsNumSteps` to `LocalInferenceSessionConfig` (in IClient.ts, after line 126)**

After `ttsSpeed: number;`, add:
```typescript
  ttsNumSteps?: number;
```

- [ ] **Step 2: Add `ttsNumSteps` to `LocalInferenceSettings` interface (in settingsStore.ts, after line 116)**

After `ttsSpeed: number;`, add:
```typescript
  ttsNumSteps: number;
```

- [ ] **Step 3: Add default value (in settingsStore.ts, after line 268)**

After `ttsSpeed: 1.0,`, add:
```typescript
  ttsNumSteps: 2,
```

- [ ] **Step 4: Pass through in `createLocalInferenceSessionConfig` (in settingsStore.ts, after line 474)**

After `ttsSpeed: settings.ttsSpeed,`, add:
```typescript
    ttsNumSteps: settings.ttsNumSteps,
```

- [ ] **Step 5: Commit**

```bash
git add src/services/interfaces/IClient.ts src/stores/settingsStore.ts
git commit -m "feat(settings): add ttsNumSteps setting for diffusion TTS models"
```

---

### Task 6: LocalInferenceClient — Pass new params to generate

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts:449-453`

- [ ] **Step 1: Update the generate() call (lines 449-453)**

Change:
```typescript
            const ttsResult = await this.ttsEngine.generate(
              sentences[i],
              this.config.ttsSpeakerId,
              this.config.ttsSpeed,
            );
```
To:
```typescript
            const ttsResult = await this.ttsEngine.generate(
              sentences[i],
              this.config.ttsSpeakerId,
              this.config.ttsSpeed,
              this.config.ttsNumSteps,
              this.config.targetLanguage,
            );
```

- [ ] **Step 2: Commit**

```bash
git add src/services/clients/LocalInferenceClient.ts
git commit -m "feat(local-inference): pass numSteps and lang to TTS generate"
```

---

### Task 7: UI — Add numSteps slider

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1195-1216`

- [ ] **Step 1: Add numSteps slider inside the existing IIFE (after line 1216, before `</div>`)**

The existing code at line 1195-1216 uses an IIFE that already fetches `ttsEntry`. Add the numSteps slider right after the speaker ID block, inside the same `<div className="settings-section">`. Replace the IIFE block (lines 1195-1216) with an expanded version that also handles numSteps:

```tsx
          {(() => {
            const ttsEntry = getManifestEntry(localInferenceSettings.ttsModel);
            const numSpeakers = ttsEntry?.numSpeakers ?? 1;
            return (
              <>
                {numSpeakers > 1 && (
                  <div className="setting-item">
                    <div className="setting-label">
                      <span>{t('settings.ttsSpeakerId', 'Speaker ID')}</span>
                      <span className="setting-value">{localInferenceSettings.ttsSpeakerId}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={numSpeakers - 1}
                      step="1"
                      value={Math.min(localInferenceSettings.ttsSpeakerId, numSpeakers - 1)}
                      onChange={(e) => updateLocalInferenceSettings({ ttsSpeakerId: parseInt(e.target.value) })}
                      className="slider"
                      disabled={isSessionActive}
                    />
                  </div>
                )}
                {ttsEntry?.supportsNumSteps && (
                  <div className="setting-item">
                    <div className="setting-label">
                      <span>{t('settings.ttsNumSteps', 'Inference Steps')}</span>
                      <span className="setting-value">{localInferenceSettings.ttsNumSteps}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={localInferenceSettings.ttsNumSteps}
                      onChange={(e) => updateLocalInferenceSettings({ ttsNumSteps: parseInt(e.target.value) })}
                      className="slider"
                      disabled={isSessionActive}
                    />
                  </div>
                )}
              </>
            );
          })()}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "feat(ui): add inference steps slider for diffusion TTS models"
```

---

### Task 8: i18n — Add ttsNumSteps translations

**Files:**
- Modify: `src/locales/*/translation.json` (30 locale directories)

- [ ] **Step 1: Add `ttsNumSteps` key to all locale files**

In each `src/locales/*/translation.json`, find the `"ttsSpeed"` key inside the `"settings"` object and add `"ttsNumSteps"` after it.

English (`src/locales/en/translation.json`):
```json
    "ttsNumSteps": "Inference Steps",
```

For all other locales, use the English fallback string `"Inference Steps"` — i18next will fall back to English if a translation is missing, but having the key present prevents console warnings.

Translations for major languages:
- `ja`: `"推論ステップ数"`
- `zh_CN`: `"推理步数"`
- `zh_TW`: `"推理步數"`
- `ko`: `"추론 단계"`
- `es`: `"Pasos de inferencia"`
- `fr`: `"Étapes d'inférence"`
- `de`: `"Inferenzschritte"`
- `pt_BR`: `"Passos de inferência"`
- `ar`: `"خطوات الاستدلال"`
- `ru`: `"Шаги вывода"`
- All others: `"Inference Steps"`

- [ ] **Step 2: Commit**

```bash
git add src/locales/
git commit -m "feat(i18n): add ttsNumSteps translations for all locales"
```

---

### Task 9: Model packing — Pack Supertonic model and update manifest sizes

**Files:**
- Modify: `model-packs/tts/pack.py` (add model entry)
- Modify: `src/lib/local-inference/modelManifest.ts` (update DATA_SIZE, METADATA_SIZE, numSpeakers)

This task requires Python 3 and ~80 MB download.

- [ ] **Step 1: Add supertonic-int8 to `MODELS` dict in pack.py (after line ~151, after pocket-int8)**

```python
    "supertonic-int8": {
        "url": BASE_URL + "sherpa-onnx-supertonic-tts-int8-2026-03-06.tar.bz2",
        "tarball": "sherpa-onnx-supertonic-tts-int8-2026-03-06.tar.bz2",
        "dir_hint": "supertonic",
    },
```

- [ ] **Step 2: Run the pack script**

```bash
cd model-packs/tts
python3 pack.py supertonic-int8
```

Expected: Creates `model-packs/tts/wasm-supertonic-int8/` with:
- `sherpa-onnx-wasm-main-tts.data` (~80 MB)
- `sherpa-onnx-wasm-main-tts.js` (patched glue)
- `sherpa-onnx-wasm-main-tts.wasm` (shared binary)
- `sherpa-onnx-tts.js` (shared API)

- [ ] **Step 3: Extract metadata**

```bash
cd ../..
python3 scripts/extract-tts-metadata.py model-packs/tts/wasm-supertonic-int8
```

Expected: Creates `model-packs/tts/wasm-supertonic-int8/package-metadata.json`

- [ ] **Step 4: Record file sizes from pack output**

Note the `.data` file size and `package-metadata.json` size from the script output or:
```bash
ls -la model-packs/tts/wasm-supertonic-int8/sherpa-onnx-wasm-main-tts.data
ls -la model-packs/tts/wasm-supertonic-int8/package-metadata.json
```

- [ ] **Step 5: Test locally to get numSpeakers and sampleRate**

Copy the packed model to `public/wasm/wasm-supertonic-int8/`, run `npm run dev`, download the model via UI, and check the console for the `ready` message which reports `numSpeakers` and `sampleRate`.

Alternatively, use the existing download script approach to serve locally.

- [ ] **Step 6: Update manifest entry with actual values**

In `src/lib/local-inference/modelManifest.ts`, replace placeholder values in the supertonic-int8 entry:
- `DATA_SIZE` → actual `.data` file size in bytes
- `METADATA_SIZE` → actual `package-metadata.json` size in bytes
- `N` (numSpeakers) → actual value from `ready` message

- [ ] **Step 7: Commit**

```bash
git add model-packs/tts/pack.py src/lib/local-inference/modelManifest.ts
git commit -m "feat(model): add supertonic-int8 to pack script and update manifest sizes"
```

---

### Task 10: Documentation — Update integration guide

**Files:**
- Modify: `docs/SHERPA_ONNX_INTEGRATION.md`

- [ ] **Step 1: Add `supertonic` to TTS Engine Types table (after line 224)**

Add a new row:
```markdown
| `supertonic` | `buildSupertonicConfig` | 4 ONNX models (duration_predictor, text_encoder, vector_estimator, vocoder) + tts.json + unicode_indexer.bin + voice.bin |
```

- [ ] **Step 2: Update model count table (line 153)**

Update TTS count from `136` to `137`.

- [ ] **Step 3: Update the appendix (lines 541-616)**

Replace the "Status: Not yet integrated" note and the outdated "sherpa-onnx does not have Supertonic support" section. Update to:

```markdown
## Appendix: Supertonic TTS

> **Status: Integrated via sherpa-onnx.** sherpa-onnx added Supertonic-2 support in [v1.12.29](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.29) (PR [#3094](https://github.com/k2-fsa/sherpa-onnx/pull/3094)). The bundled WASM runtime (v1.12.31) includes `offlineTtsSupertonicModelConfig` and `generateWithConfig` API.
>
> Model entry: `supertonic-int8` — Supertonic 2, int8 quantized (~80 MB), supporting English, Korean, Spanish, Portuguese, and French.
```

Remove the "Alternative approach" subsection that recommended a dedicated worker via `onnxruntime-web`.

- [ ] **Step 4: Commit**

```bash
git add docs/SHERPA_ONNX_INTEGRATION.md
git commit -m "docs: update integration guide for supertonic TTS support"
```

---

### Task 11: Upload model to HuggingFace CDN

**Files:** None (external operation)

This task uploads the packed model files to the HuggingFace dataset for CDN serving.

- [ ] **Step 1: Upload .data and package-metadata.json**

Upload to `jiangzhuo9357/sherpa-onnx-tts-models` dataset:
```
wasm-supertonic-int8/sherpa-onnx-wasm-main-tts.data
wasm-supertonic-int8/package-metadata.json
```

Use the `huggingface_hub` Python API (avoid cloning — LFS repo is large):
```python
from huggingface_hub import HfApi
api = HfApi()
api.upload_file(
    path_or_fileobj="model-packs/tts/wasm-supertonic-int8/sherpa-onnx-wasm-main-tts.data",
    path_in_repo="wasm-supertonic-int8/sherpa-onnx-wasm-main-tts.data",
    repo_id="jiangzhuo9357/sherpa-onnx-tts-models",
    repo_type="dataset",
)
api.upload_file(
    path_or_fileobj="model-packs/tts/wasm-supertonic-int8/package-metadata.json",
    path_in_repo="wasm-supertonic-int8/package-metadata.json",
    repo_id="jiangzhuo9357/sherpa-onnx-tts-models",
    repo_type="dataset",
)
```

- [ ] **Step 2: Verify CDN URL is accessible**

```bash
curl -I "https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-tts-models/resolve/main/wasm-supertonic-int8/package-metadata.json"
```

Expected: HTTP 200 with correct content type.

---

### Task 12: End-to-end verification

- [ ] **Step 1: Test Supertonic model download via UI**

Run `npm run dev`, go to Settings → Model Management, find Supertonic 2, click download. Verify progress bar and completion.

- [ ] **Step 2: Test TTS generation in English**

Start a session with Supertonic selected as TTS model, target language = English. Speak into mic, verify translated text is spoken aloud.

- [ ] **Step 3: Test numSteps slider**

Change inference steps from 2 to 5. Verify audible quality difference (5 should sound smoother).

- [ ] **Step 4: Test speaker selection**

If numSpeakers > 1, change speaker ID via slider. Verify voice changes.

- [ ] **Step 5: Test other languages**

Test with target languages: ko, es, pt, fr. Verify correct pronunciation.

- [ ] **Step 6: Regression test existing TTS engines**

Switch to Piper EN, Matcha EN, or Kokoro. Verify they still work correctly after the `generateWithConfig` migration.

- [ ] **Step 7: Test numSteps slider visibility**

Verify the inference steps slider only appears when Supertonic is selected, not for Piper/Matcha/Kokoro.
