# Supertonic-2 TTS Integration via sherpa-onnx

**Date:** 2026-03-23
**Issue:** [#122](https://github.com/kizuna-ai-lab/sokuji/issues/122)
**Status:** Design approved

## Summary

Add [Supertone Supertonic-2](https://huggingface.co/Supertone/supertonic-2) as a local TTS engine via the existing sherpa-onnx WASM pipeline. Supertonic-2 is a 66M-parameter, fast TTS model supporting English, Korean, Spanish, Portuguese, and French.

### Why sherpa-onnx (not Transformers.js)

- sherpa-onnx [added Supertonic-2 support](https://github.com/k2-fsa/sherpa-onnx/pull/3094) in v1.12.29
- The bundled WASM runtime (v1.12.31) already includes `offlineTtsSupertonicModelConfig` and `generateWithConfig` API
- Reuses the entire existing pipeline: pack.py → `.data` packaging → IndexedDB download → TtsEngine → tts.worker.js
- No new worker, no new engine class, no new dependencies

### Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration path | sherpa-onnx WASM | Reuse existing pipeline, no new dependencies |
| Generate API | Unify all engines on `generateWithConfig` | Superset of `generate`, backward compatible |
| `lang` parameter | Per-generate call (from `targetLanguage`) | Stateless worker, flexible |
| `numSteps` parameter | Per-generate call (from settings) | User-controllable quality/speed tradeoff |
| Speaker selection | Reuse existing `numSpeakers` + `ttsSpeakerId` | Already supported in UI |
| UI control visibility | Model attribute `supportsNumSteps` | Data-driven, not engine-name-driven |

## Model specs

| Spec | Value |
|------|-------|
| Model | `sherpa-onnx-supertonic-tts-int8-2026-03-06` |
| Source | [sherpa-onnx tts-models release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models) |
| Size | ~80 MB (int8 quantized) |
| Languages | en, ko, es, pt, fr |
| Sample rate | TBD — confirm after packing (44,100 Hz per issue #122, 24 kHz per Supertone docs; resample logic uses dynamic `ttsResult.sampleRate`) |
| Architecture | 4 ONNX components + config + voice embeddings |

### Model files (packed into single `.data`)

| File | Purpose |
|------|---------|
| `duration_predictor.int8.onnx` | Predicts phoneme timing |
| `text_encoder.int8.onnx` | Generates text embeddings |
| `vector_estimator.int8.onnx` | Diffusion-based denoising |
| `vocoder.int8.onnx` | Latent → audio waveform |
| `tts.json` | Model config |
| `unicode_indexer.bin` | Character-to-vocabulary mapping |
| `voice.bin` | Voice style embeddings (multi-speaker) |

## Architecture

### Data flow (no changes to existing pipeline structure)

```
pack.py downloads tarball → packs 7 files into .data → patches glue JS
  → upload .data + package-metadata.json to HF dataset CDN

User downloads model via UI
  → ModelManager fetches .data + metadata → IndexedDB

Session starts
  → TtsEngine.init(modelId) → blob URLs from IndexedDB → Worker
  → Worker: buildSupertonicConfig() → createOfflineTts(Module, config)
  → Worker posts { type: 'ready', numSpeakers, sampleRate }

Translation completes
  → LocalInferenceClient calls ttsEngine.generate(text, sid, speed, numSteps, lang)
  → Worker: tts.generateWithConfig(text, { sid, speed, numSteps, extra: { lang } })
  → Returns Float32Array @ 44.1kHz → resample to 24kHz → Int16 → audio playback
```

### sherpa-onnx WASM API

The existing bundled runtime (v1.12.31) provides two generate methods:

- `tts.generate({text, sid, speed})` — legacy, used by all current engines
- `tts.generateWithConfig(text, {sid, speed, numSteps, extra})` — superset, supports Supertonic params

**Design: unify all engines on `generateWithConfig`.** For non-Supertonic engines, `numSteps` and `extra` are ignored. This eliminates engine-specific branching in the worker.

### Supertonic config structure

```javascript
// sherpa-onnx offlineTtsSupertonicModelConfig fields:
{
  durationPredictor: './duration_predictor.int8.onnx',
  textEncoder: './text_encoder.int8.onnx',
  vectorEstimator: './vector_estimator.int8.onnx',
  vocoder: './vocoder.int8.onnx',
  ttsJson: './tts.json',
  unicodeIndexer: './unicode_indexer.bin',
  voiceStyle: './voice.bin',
}
```

## Changes by file

### Model packaging

**`model-packs/tts/pack.py`** — Add model entry:
```python
"supertonic-int8": {
    "url": BASE_URL + "sherpa-onnx-supertonic-tts-int8-2026-03-06.tar.bz2",
    "tarball": "sherpa-onnx-supertonic-tts-int8-2026-03-06.tar.bz2",
    "dir_hint": "supertonic",
},
```

Packaging workflow:
```bash
python3 model-packs/tts/pack.py supertonic-int8
python3 scripts/extract-tts-metadata.py model-packs/tts/wasm-supertonic-int8
# Upload .data + package-metadata.json to jiangzhuo9357/sherpa-onnx-tts-models
```

### Worker layer

**`public/workers/tts.worker.js`**

1. Add `emptySupertonic()`:
   ```javascript
   function emptySupertonic() {
     return {
       offlineTtsSupertonicModelConfig: {
         durationPredictor: '', textEncoder: '', vectorEstimator: '',
         vocoder: '', ttsJson: '', unicodeIndexer: '', voiceStyle: '',
       },
     };
   }
   ```
2. Add `buildSupertonicConfig(ttsConfig)` — fills in int8 model file paths
3. Add `case 'supertonic'` to engine router switch
4. Add `...emptySupertonic()` to all 7 existing engine builders (piper, coqui, mimic3, mms, matcha, kokoro, vits)
5. Change `handleGenerate` to use `generateWithConfig` for all engines:

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
    postMessage(
      { type: 'result', samples: audio.samples, sampleRate: audio.sampleRate, generationTimeMs: generationTimeMs },
      [audio.samples.buffer]
    );
  } catch (e) {
    postMessage({ type: 'error', error: 'Generation failed: ' + (e.message || e) });
  }
}
```

### Type definitions

**`src/lib/local-inference/types.ts`**

```typescript
// Fix TtsInitMessage to match actual worker protocol (currently stale)
export interface TtsInitMessage {
  type: 'init';
  modelFile: string;
  engine: string;
  ttsConfig: Record<string, unknown>;
  fileUrls: Record<string, string>;
  runtimeBaseUrl: string;
  dataPackageMetadata: Record<string, unknown>;
}

// TtsGenerateMessage — add optional fields
export interface TtsGenerateMessage {
  type: 'generate';
  text: string;
  sid: number;
  speed: number;
  numSteps?: number;   // NEW: inference steps (Supertonic: 2=fast, 5=quality)
  lang?: string;       // NEW: language tag (Supertonic: 'en', 'ko', etc.)
}
```

### Model manifest

**`src/lib/local-inference/modelManifest.ts`**

```typescript
// Extend TtsEngineType
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits' | 'supertonic';

// Add supportsNumSteps to ModelManifestEntry
supportsNumSteps?: boolean;

// New model entry
{
  id: 'supertonic-int8',
  type: 'tts',
  name: 'Supertonic 2 (EN/KO/ES/PT/FR)',
  languages: ['en', 'ko', 'es', 'pt', 'fr'],
  multilingual: true,
  cdnPath: 'wasm-supertonic-int8',
  variants: { default: { dtype: 'default', files: ttsFiles(DATA_SIZE, METADATA_SIZE) } },
  engine: 'supertonic',
  numSpeakers: N,           // TBD: confirm after packing
  supportsNumSteps: true,
},
```

### Engine layer

**`src/lib/local-inference/engine/TtsEngine.ts`**

Extend `generate()` signature (backward compatible):

```typescript
async generate(
  text: string,
  sid = 0,
  speed = 1.0,
  numSteps?: number,
  lang?: string,
): Promise<TtsResult> {
  // ...existing sanitization...
  return new Promise((resolve, reject) => {
    this.pendingGenerate = { resolve, reject };
    this.worker!.postMessage({
      type: 'generate',
      text: sanitizedText,
      sid,
      speed,
      numSteps,
      lang,
    });
  });
}
```

`init()` — no changes.

### Session config

**`src/services/interfaces/IClient.ts`**

```typescript
export interface LocalInferenceSessionConfig extends BaseSessionConfig {
  // ...existing fields...
  ttsNumSteps?: number;   // NEW: Supertonic inference steps
}
```

### Client integration

**`src/services/clients/LocalInferenceClient.ts`**

```typescript
// generate call — pass numSteps and targetLanguage
const ttsResult = await this.ttsEngine.generate(
  sentences[i],
  this.config.ttsSpeakerId,
  this.config.ttsSpeed,
  this.config.ttsNumSteps,      // NEW
  this.config.targetLanguage,   // NEW: used as lang for Supertonic
);
```

### Settings store

**`src/stores/settingsStore.ts`**

```typescript
// Add to LocalInferenceSettings interface
ttsNumSteps: number;

// Default value
ttsNumSteps: 2,

// In buildSessionConfig
ttsNumSteps: settings.ttsNumSteps,
```

### UI

**`src/components/Settings/sections/ProviderSpecificSettings.tsx`**

Add numSteps slider, conditionally shown via model attribute:

```tsx
{ttsEntry?.supportsNumSteps && (
  <div className="setting-item">
    <div className="setting-label">
      <span>{t('settings.ttsNumSteps', 'Inference Steps')}</span>
      <span className="setting-value">{localInferenceSettings.ttsNumSteps}</span>
    </div>
    <input
      type="range"
      min={1} max={10} step={1}
      value={localInferenceSettings.ttsNumSteps}
      onChange={(e) => updateLocalInferenceSettings({ ttsNumSteps: parseInt(e.target.value) })}
      className="slider"
      disabled={isSessionActive}
    />
  </div>
)}
```

### i18n

**`src/locales/*/translation.json` (35+ files)** — Add `ttsNumSteps` translation key.

### Documentation

**`docs/SHERPA_ONNX_INTEGRATION.md`**

- Update TTS Engine Types table: add `supertonic` row
- Update appendix: mark sherpa-onnx as now supporting Supertonic (v1.12.29+)
- Add Supertonic to the model count table

## Files changed (summary)

| File | Change |
|------|--------|
| `model-packs/tts/pack.py` | Add supertonic-int8 model entry |
| `public/workers/tts.worker.js` | Add supertonic config builder; unify on generateWithConfig |
| `src/lib/local-inference/types.ts` | Add `numSteps?`, `lang?` to TtsGenerateMessage |
| `src/lib/local-inference/modelManifest.ts` | Add `'supertonic'` engine type, `supportsNumSteps` field, model entry |
| `src/lib/local-inference/engine/TtsEngine.ts` | Extend generate() with numSteps, lang params |
| `src/services/interfaces/IClient.ts` | Add `ttsNumSteps?` to session config |
| `src/services/clients/LocalInferenceClient.ts` | Pass numSteps and targetLanguage to generate |
| `src/stores/settingsStore.ts` | Add `ttsNumSteps` setting (default 2) |
| `src/components/Settings/sections/ProviderSpecificSettings.tsx` | Conditional numSteps slider |
| `src/locales/*/translation.json` (35+) | Add `ttsNumSteps` key |
| `docs/SHERPA_ONNX_INTEGRATION.md` | Update engine types table and appendix |

No new files created (except the model `.data` pack artifacts which are uploaded to HF, not committed).

## Implementation notes

- **Worker header comment**: Update the protocol comment block at the top of `tts.worker.js` to reflect `numSteps?` and `lang?` in the generate message.
- **`lang` format**: sherpa-onnx expects ISO 639-1 codes (`'en'`, `'ko'`, etc.) in `extra.lang`. The `targetLanguage` in settingsStore uses the same format. No normalization needed.
- **`numSpeakers` and `sampleRate`**: Confirm after packing by running the model and checking the `ready` message. Update manifest entry before shipping.
- **`docs/SHERPA_ONNX_INTEGRATION.md` appendix**: The existing appendix (lines 541-616) states sherpa-onnx does NOT support Supertonic — this is stale. Update to reflect v1.12.29+ support and remove the "Alternative approach" section recommending a dedicated worker.

## Testing plan

- [ ] Pack supertonic-int8 model via pack.py, verify .data + metadata output
- [ ] Download model via UI, verify IndexedDB storage
- [ ] Worker initializes without errors, `ready` message returns correct numSpeakers/sampleRate
- [ ] Generate speech in English, verify audio playback at correct pitch (44.1kHz → 24kHz resample)
- [ ] Test all 5 languages: en, ko, es, pt, fr
- [ ] Test numSteps slider: 2 (fast) vs 5 (quality) produces audible difference
- [ ] Test speaker selection across available speakers
- [ ] Verify existing TTS engines (Piper, Matcha, Kokoro) still work after generateWithConfig migration
- [ ] Verify numSteps slider only appears for Supertonic model
- [ ] Cancel/resume download works
- [ ] Delete model frees storage
