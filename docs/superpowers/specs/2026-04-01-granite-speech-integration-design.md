# Granite Speech WebGPU Integration Design

**Issue**: [#120](https://github.com/kizuna-ai-lab/sokuji/issues/120)
**Date**: 2026-04-01
**Approach**: Minimal integration — register as ASR model with conditional AST (speech translation) capability

## Overview

Integrate IBM Granite Speech (`onnx-community/granite-4.0-1b-speech-ONNX`) as a WebGPU-based ASR engine via Transformers.js v4. The model supports both ASR (transcription) and AST (speech translation) via prompt switching. When the user selects Granite for both ASR and translation, a single model instance handles both tasks — the translation engine is skipped entirely.

## Model Details

- **Model**: `onnx-community/granite-4.0-1b-speech-ONNX`
- **Architecture**: Speech encoder (16 Conformer blocks) + projector + granite-4.0-1b LLM
- **Class**: `GraniteSpeechForConditionalGeneration` (Transformers.js v4)
- **ASR languages**: en, fr, de, es, pt, ja
- **AST translate targets**: en, fr, de, es, pt, ja, it, zh
- **Variants**:
  - `q4` (~1.8 GB) — baseline, no special GPU features required
  - `q4f16` (~1.5 GB) — requires `shader-f16` GPU feature
- **Input**: Float32 audio @ 16kHz
- **Prompts**:
  - ASR: `<|audio|>Transcribe the speech to text`
  - AST: `<|audio|>Translate the speech to {language}`

## Architecture Decisions

### Granite is an ASR model with conditional translation availability

- Registered as `type: 'asr'` in the model manifest — no new ModelType.
- When selected as ASR, it appears as an option in the translation model picker (via the new `astLanguages` field on the manifest entry).
- It cannot be used as a standalone translation model without first being the active ASR model.
- When selected for both ASR and translation: one model loads, AST prompt produces translated text directly from audio. The translation engine is not initialized.
- When selected for ASR only (different translation model): model transcribes, separate translation engine handles translation.

### AST mode skips source transcript

When Granite handles both ASR and translation, the model runs a single AST inference pass per speech segment. The output is translated text only — no intermediate source transcript is shown. This avoids double inference cost.

## Section 1: Model Manifest & Storage

New manifest entry in `modelManifest.ts`:

```typescript
{
  id: 'granite-speech',
  type: 'asr',
  name: 'Granite Speech (WebGPU)',
  languages: ['en', 'fr', 'de', 'es', 'pt', 'ja'],
  multilingual: true,
  hfModelId: 'onnx-community/granite-4.0-1b-speech-ONNX',
  asrEngine: 'granite-speech',
  asrWorkerType: 'granite-speech-webgpu',
  requiredDevice: 'webgpu',
  recommended: true,
  astLanguages: {
    transcribe: ['en', 'fr', 'de', 'es', 'pt', 'ja'],
    translate: ['en', 'fr', 'de', 'es', 'pt', 'ja', 'it', 'zh'],
  },
  variants: {
    q4: {
      dtype: { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' },
      files: [/* config.json, processor files, 3 ONNX model+data pairs (~1.8GB) */],
      requiredFeatures: [],
    },
    q4f16: {
      dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
      files: [/* same structure (~1.5GB) */],
      requiredFeatures: ['shader-f16'],
    },
  },
}
```

The `astLanguages` field is new — used only by UI filtering logic, not by engines.

No new `ModelType` value. No changes to `modelStorage.ts` or `ModelManager.ts` — existing download/blob URL/IndexedDB patterns work as-is.

## Section 2: Worker

New file: `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts`

### Init message type

```typescript
// In types.ts
interface GraniteSpeechInitMessage {
  type: 'init';
  fileUrls: Record<string, string>;
  hfModelId: string;
  dtype: Record<string, string>;  // {audio_encoder, embed_tokens, decoder_model_merged}
  language?: string;
  task: 'transcribe' | 'translate';
  targetLanguage?: string;  // only when task === 'translate'
  ortWasmBaseUrl?: string;
  vadModelUrl?: string;
}
```

### Output messages

Same as Whisper WebGPU — no new message types:
- `{type: 'ready', loadTimeMs}`
- `{type: 'status', message}`
- `{type: 'speech_start'}`
- `{type: 'result', text, startSample, durationMs, recognitionTimeMs}`
- `{type: 'error', error}`
- `{type: 'disposed'}`

### Internal flow

```
Audio frames (Int16@24kHz from engine)
  |
Resample to Float32@16kHz
  |
Silero VAD v5 (frame processor with speech start/end)
  |
On SpeechEnd -> run inference on accumulated segment
  |
Build prompt:
  transcribe: "<|audio|>Transcribe the speech to text"
  translate:  "<|audio|>Translate the speech to {targetLanguage}"
  |
processor.tokenizer.apply_chat_template(messages, {add_generation_prompt: true, tokenize: false})
processor(text, audioSegment, {sampling_rate: 16000})
  |
model.generate({...inputs, max_new_tokens: 256, streamer})
  |
postMessage({type: 'result', text, ...timing})
```

### Model loading

```typescript
import {
  AutoProcessor,
  GraniteSpeechForConditionalGeneration,
  TextStreamer,
} from '@huggingface/transformers';

env.customCache = createBlobUrlCache(fileUrls);  // existing pattern
const processor = await AutoProcessor.from_pretrained(hfModelId);
const model = await GraniteSpeechForConditionalGeneration.from_pretrained(hfModelId, {
  dtype, device: 'webgpu',
});
```

WebGPU warmup: run a tiny dummy inference after load to front-load shader compilation, then post `ready`.

## Section 3: Engine Routing & Client Orchestration

### AsrEngine changes

Add `granite-speech-webgpu` to worker selection switch in `AsrEngine.ts`:

```typescript
case 'granite-speech-webgpu':
  new Worker('../workers/granite-speech-webgpu.worker.ts', { type: 'module' });
```

Extend `init()` signature with optional task config:

```typescript
async init(
  modelId: string,
  vadConfig?: VadConfig,
  language?: string,
  taskConfig?: { task: 'transcribe' | 'translate'; targetLanguage?: string }
): Promise<{ loadTimeMs: number }>
```

Default is `{ task: 'transcribe' }`. Extra fields are passed through to the worker init message. Non-Granite workers ignore them.

### LocalInferenceClient.connect() — AST detection

```typescript
const asrModel = getManifestEntry(config.asrModelId);
const isGraniteAst = asrModel?.asrEngine === 'granite-speech'
  && config.translationModelId === config.asrModelId;

if (isGraniteAst) {
  // AST mode: ASR engine produces translated text, skip translation engine
  await this.asrEngine.init(config.asrModelId, vadConfig, config.sourceLanguage, {
    task: 'translate',
    targetLanguage: config.targetLanguage,
  });
  // this.translationEngine stays null
} else {
  // Normal path
  await this.asrEngine.init(config.asrModelId, vadConfig, config.sourceLanguage);
  this.translationEngine = new TranslationEngine();
  await this.translationEngine.init(...);
}
```

### Pipeline job — null translation engine handling

In `processPipelineJob()`:

```typescript
const translatedText = this.translationEngine
  ? (await this.translationEngine.translate(job.text)).translatedText
  : job.text;  // Granite AST already produced translated text
```

One conditional, no new code paths for TTS or conversation items.

## Section 4: UI — Conditional Translation Model

### ModelManagementSection — inject Granite into translation list

```typescript
const translationModels = useMemo(() => {
  const all = getManifestByType('translation');

  const asrEntry = asrModel ? getManifestEntry(asrModel) : null;
  if (asrEntry?.astLanguages) {
    all.push({
      ...asrEntry,
      type: 'translation' as ModelType,
      multilingual: true,
      languages: asrEntry.astLanguages.translate,
    });
  }

  return sortTranslationModels(all);
}, [asrModel]);
```

### Compatibility filtering

Existing `isTranslationModelCompatible()` handles multilingual models already — checks both `sourceLang` and `targetLang` in `languages`. Granite naturally shows/hides based on language pair.

### Auto-deselection

When user switches away from Granite ASR, the existing auto-select `useEffect` detects the translation model ID is no longer valid and auto-corrects.

### isProviderReady — AST short-circuit

```typescript
// In modelStore.isProviderReady()
if (selectedTranslationModel && selectedTranslationModel === selectedAsrModel) {
  const asrEntry = getManifestEntry(selectedAsrModel);
  if (!asrEntry?.astLanguages?.translate.includes(targetLang)) return false;
  // ASR readiness already validated above — skip further translation checks
} else {
  // existing translation validation
}
```

## Section 5: Error Handling & Edge Cases

1. **WebGPU unavailable**: Existing `requiredDevice: 'webgpu'` filtering moves Granite to incompatible list. No new code.

2. **Language pair outside AST support**: Auto-select `useEffect` detects incompatibility and switches translation model. Granite stays as ASR.

3. **AST is opt-in**: When `translationModel` is `''` (auto), auto-selection picks from standard translation models, not Granite. User must explicitly select Granite in the translation picker.

4. **Download interruption**: Existing IndexedDB resume support handles the ~1.5GB download.

5. **Shader compilation latency**: Worker does WebGPU warmup (dummy inference) after load, before posting `ready`.

6. **Worker disposal**: Standard pattern — nullify model/processor refs, post `disposed`.

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts` | New WebGPU worker |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/local-inference/modelManifest.ts` | Add Granite manifest entry + `astLanguages` field to types |
| `src/lib/local-inference/types.ts` | Add `GraniteSpeechInitMessage` type |
| `src/lib/local-inference/engine/AsrEngine.ts` | Add worker routing + extend init() with taskConfig |
| `src/services/clients/LocalInferenceClient.ts` | AST detection in connect(), null translationEngine handling in pipeline |
| `src/components/Settings/sections/ModelManagementSection.tsx` | Inject AST model into translation picker |
| `src/stores/modelStore.ts` | AST short-circuit in isProviderReady() |
