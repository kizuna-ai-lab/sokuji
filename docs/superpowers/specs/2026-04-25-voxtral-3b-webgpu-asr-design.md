# Voxtral Mini 3B 2507 WebGPU ASR Integration

**Date:** 2026-04-25
**Issue:** [#169](https://github.com/kizuna-ai-lab/sokuji/issues/169)
**Status:** Design approved
**Scope:** Add Voxtral Mini 3B (2507) as a new batch/offline WebGPU ASR engine with explicit language-hint support, alongside the existing Voxtral Mini 4B Realtime.

## Summary

Integrate `onnx-community/Voxtral-Mini-3B-2507-ONNX` as a `type: 'asr'` (batch/offline) model that flows through `AsrEngine` — **not** `StreamingAsrEngine` as the original issue's Task #3 suggested. The 3B model is decoded on complete VAD-gated utterances, which matches the existing Whisper-WebGPU and Cohere-Transcribe pattern. Its distinguishing feature over the 4B Realtime model is a language hint injected into the chat template (`lang:XX [TRANSCRIBE]`), which meaningfully improves accuracy because Sokuji always knows the source language.

## Motivation

- The 4B Realtime model (`voxtral-mini-4b-webgpu`) relies entirely on automatic language detection; there is no way to pass a language hint.
- The 3B (2507) model accepts `lang:XX [TRANSCRIBE]` via the processor's chat template, improving transcription accuracy when the source language is known.
- Smaller footprint (3B vs 4B) → faster load, lower VRAM.
- Supports 8 languages: `en, es, fr, pt, hi, de, nl, it`.

## Correction of Issue #169 Task List

The issue's Task 3 says "Register new `asrEngine` type and wire up in `StreamingAsrEngine` / engine factory." This is incorrect for this model.

- The 3B model is **batch/offline**, decoded only on full VAD utterances (same pattern as Whisper WebGPU and Cohere Transcribe).
- Routing in `LocalInferenceClient.ts` already dispatches on `ModelManifestEntry.type`: `type: 'asr'` → `AsrEngine`, `type: 'asr-stream'` → `StreamingAsrEngine`. No factory change is needed.
- Therefore the new worker is wired into `AsrEngine` (adding one `case` in its worker-spawn switch), not `StreamingAsrEngine`.

## Model Details

| Spec | Value |
|------|-------|
| HF Model | `onnx-community/Voxtral-Mini-3B-2507-ONNX` |
| Architecture | Whisper encoder + Mistral LM (offline/batch) |
| transformers.js API | `VoxtralForConditionalGeneration` + `VoxtralProcessor` |
| Languages (8) | en, es, fr, pt, hi, de, nl, it |
| Language hint | `lang:XX [TRANSCRIBE]` in chat template |
| Input | 16 kHz mono Float32 audio (one VAD utterance at a time) |
| Caching | IndexedDB blob URL bridge via `createBlobUrlCache` (same as 4B) |
| Package requirement | `@huggingface/transformers` ≥ 3.7.0 (project is on 4.2.0 ✓) |

### Quantization Variants

| Variant | Audio encoder | Embed tokens | Decoder merged | Requirement |
|---------|---------------|--------------|----------------|-------------|
| q4f16 | q4f16 | q4f16 | q4f16 | `shader-f16` GPU feature |
| q4 | q4 | q4 | q4 | Universal fallback |

Exact per-file byte sizes are read from `https://huggingface.co/api/models/onnx-community/Voxtral-Mini-3B-2507-ONNX` at implementation time and populated into the manifest `variants[*].files[*].sizeBytes`. Both variants are shipped so q4 can serve as a fallback on GPUs without `shader-f16` (mirrors the existing 4B and Cohere entries).

## Architecture

### Data Flow

```
Mic (24 kHz Int16)
    ↓
LocalInferenceClient.appendInputAudio()
    ↓  (type: 'asr' → AsrEngine branch)
AsrEngine.feedAudio(samples, 24000)
    ↓  postMessage({ type: 'audio', samples, sampleRate })
voxtral-3b-webgpu.worker.ts
    ├── Resample 24 kHz → 16 kHz Float32
    ├── Silero VAD v5 (@ricky0123/vad-web, same as Voxtral 4B / Cohere / Whisper)
    │     ├── SpeechStart → postMessage({ type: 'speech_start' })
    │     ├── SpeechEnd   → runVoxtral3B(segment)
    │     └── VADMisfire  → discard
    └── runVoxtral3B(audio)
          ├── Build chat-template text with lang hint
          ├── processor(text, audio) → model inputs
          ├── model.generate({ ...inputs, max_new_tokens: 500, streamer })
          ├── TextStreamer callback → postMessage({ type: 'partial', text })
          └── Final decode → postMessage({ type: 'result', text, durationMs, recognitionTimeMs })
    ↓
AsrEngine callbacks (onResult, onPartialResult, onSpeechStart)
    ↓
LocalInferenceClient → translation → TTS
```

### Key Design Decisions

1. **`type: 'asr'` (offline) — routed through `AsrEngine`**, correcting Task #3 of the issue. The 3B model is not streaming; it decodes complete VAD utterances.
2. **New dedicated worker** (`voxtral-3b-webgpu.worker.ts`) rather than extending the existing Voxtral 4B or Cohere workers.
   - Different model class (`VoxtralForConditionalGeneration` vs `VoxtralRealtimeForConditionalGeneration` in 4B).
   - Different API (`VoxtralProcessor.apply_chat_template` vs the `pipeline('automatic-speech-recognition')` used by Cohere).
   - Mixing either would couple unrelated inference shapes.
3. **IndexedDB blob URL cache bridge** (`createBlobUrlCache` + `env.customCache`) — same pattern used by 4B and Cohere. No direct HF fetches at runtime.
4. **Language hint via chat template** — `currentLanguage` received in the init message is normalized to ISO 639-1 (strip region, e.g. `en-US` → `en`) and injected as `lang:XX [TRANSCRIBE]`. If the normalized code is not among the 8 supported languages, the worker omits the `lang:XX` prefix and falls back to bare `[TRANSCRIBE]` (auto-detect), logging a warning via a `status` message.
5. **`TextStreamer` for partial results** — mirrors the Cohere pattern so the existing `onPartialResult` UX works without changes.
6. **Recommended, sort order after 4B** — `recommended: true`, `sortOrder: 3` (4B is 2). Users get both options; 4B remains the first-listed recommendation.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts` | **Create** | Module worker: processor + model load, VAD, chat-template prompt, batch generate with TextStreamer partials |
| `src/lib/local-inference/engine/AsrEngine.ts` | Modify | Add `case 'voxtral-3b-webgpu':` in the worker-spawn switch (mirrors the existing `'cohere-transcribe-webgpu'` case) |
| `src/lib/local-inference/modelManifest.ts` | Modify | Add `'voxtral-3b'` to `AsrEngineType`; add `'voxtral-3b-webgpu'` to the `asrWorkerType` union; push the new manifest entry |
| `src/lib/local-inference/types.ts` | Modify | Add `Voxtral3BAsrInitMessage` type (shape documented below) |
| `LocalInferenceClient.ts` | **No change** | Already dispatches to `AsrEngine` for `type: 'asr'` |
| Model Management UI (`ModelManagementSection.tsx`, `ProviderSpecificSettings.tsx`) | **No change** | Manifest entries are auto-discovered via `getManifestByType('asr')` |

## Worker Design: `voxtral-3b-webgpu.worker.ts`

### Init Message

```typescript
interface Voxtral3BAsrInitMessage {
  type: 'init';
  fileUrls: Record<string, string>;           // HF-relative filename → IndexedDB blob URL
  hfModelId: string;                          // 'onnx-community/Voxtral-Mini-3B-2507-ONNX'
  language?: string;                          // e.g. 'en', 'en-US', 'fr' — normalized in worker
  dtype: string | Record<string, string>;     // selected variant dtype from manifest
  vadModelUrl: string;                        // Silero v5 ONNX URL
  ortWasmBaseUrl?: string;                    // ONNX Runtime WASM base path
}
```

### Worker State Machine

```
UNINITIALIZED
    ↓  init message
LOADING (VAD + processor + model)
    ↓
IDLE → post({ type: 'ready', loadTimeMs })
    ↓  audio messages → VAD
SPEECH_ACTIVE
    ↓  VAD SpeechEnd
DECODING (model.generate with TextStreamer)
    ↓  final decode complete
IDLE
```

### Inference Flow (core of the worker)

```typescript
async function runVoxtral3B(audio: Float32Array): Promise<void> {
  if (!model || !processor) return;

  const durationMs = Math.round((audio.length / 16000) * 1000);
  const startTime = performance.now();

  // 1. Build chat-template text with optional language hint
  const langCode = normalizeToIso639_1(currentLanguage);   // 'en-US' → 'en'
  const hintedText = SUPPORTED_LANGS.includes(langCode)
    ? `lang:${langCode} [TRANSCRIBE]`
    : '[TRANSCRIBE]';                                       // fallback to auto-detect

  const conversation = [
    {
      role: 'user',
      content: [
        { type: 'audio' },
        { type: 'text', text: hintedText },
      ],
    },
  ];
  const text = processor.apply_chat_template(conversation, { tokenize: false });

  // 2. Run processor → model inputs
  const inputs = await processor(text, audio);

  // 3. Stream tokens for partials; keep final tokens for canonical decode
  let accumulated = '';
  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token: string) => {
      accumulated += token;
      post({ type: 'partial', text: accumulated });
    },
  });

  try {
    const outputs = await model.generate({ ...inputs, max_new_tokens: 500, streamer });
    // Slice away the prompt tokens; batch_decode the generated tail for the canonical final text.
    const promptLen = inputs.input_ids.dims.at(-1)!;
    const generated = outputs.slice(null, [promptLen, null]);
    const finalTexts = processor.batch_decode(generated, { skip_special_tokens: true });
    const finalText = (finalTexts?.[0] ?? accumulated).trim();

    if (finalText) {
      post({
        type: 'result',
        text: finalText,
        durationMs,
        recognitionTimeMs: Math.round(performance.now() - startTime),
      });
    }
  } catch (err: any) {
    post({ type: 'error', error: `Voxtral 3B inference failed: ${err?.message || err}` });
  }
}
```

### Model Loading

```typescript
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = createBlobUrlCache(msg.fileUrls);   // IndexedDB blob bridge

processor = await VoxtralProcessor.from_pretrained(msg.hfModelId);
model = await VoxtralForConditionalGeneration.from_pretrained(msg.hfModelId, {
  dtype: msg.dtype,
  device: 'webgpu',
  progress_callback: (info) => post({ type: 'status', message: formatProgress(info) }),
});
```

VAD init (Silero v5 via ONNX Runtime + `@ricky0123/vad-web` FrameProcessor) is copied from the existing Voxtral 4B / Cohere workers — no behavioral differences.

### Language Normalization

```typescript
const SUPPORTED_LANGS = new Set(['en', 'es', 'fr', 'pt', 'hi', 'de', 'nl', 'it']);

function normalizeToIso639_1(lang: string | undefined): string {
  if (!lang) return '';
  return lang.trim().toLowerCase().split(/[-_]/)[0];       // 'en-US' → 'en'
}
```

A `lang` value outside the supported set (e.g. the user picked `ja`) is defensive-only — the manifest's `languages` field should already hide the model from selection for unsupported sources. If it slips through, we fall back to bare `[TRANSCRIBE]` rather than failing.

### Output Messages

Standard `AsrWorkerOutMessage` shapes reused unchanged from Cohere/Whisper:

- `{ type: 'ready', loadTimeMs }`
- `{ type: 'status', message }`
- `{ type: 'speech_start' }`
- `{ type: 'partial', text }` — accumulated text during the current utterance's decode
- `{ type: 'result', text, durationMs, recognitionTimeMs }` — finalized utterance
- `{ type: 'error', error }`
- `{ type: 'disposed' }`

### Message Protocol

- Inbound: `init`, `audio` (Int16Array @ 24 kHz), `flush`, `dispose`
- Outbound: as above

`flush` (push-to-talk end) forces the VAD to emit a SpeechEnd with whatever is buffered, same as existing workers.

## Model Manifest Entry

```typescript
{
  id: 'voxtral-mini-3b-webgpu',
  type: 'asr',
  name: 'Voxtral Mini 3B 2507 (WebGPU)',
  languages: ['en', 'es', 'fr', 'pt', 'hi', 'de', 'nl', 'it'],
  multilingual: true,
  hfModelId: 'onnx-community/Voxtral-Mini-3B-2507-ONNX',
  requiredDevice: 'webgpu',
  asrEngine: 'voxtral-3b',
  asrWorkerType: 'voxtral-3b-webgpu',
  variants: {
    'q4f16': {
      dtype: {
        audio_encoder: 'q4f16',
        embed_tokens: 'q4f16',
        decoder_model_merged: 'q4f16',
      },
      files: [
        // { filename, sizeBytes } for config.json, generation_config.json,
        // preprocessor_config.json, processor_config.json, tokenizer.json,
        // tokenizer_config.json, tekken.json, special_tokens_map.json,
        // onnx/audio_encoder_q4f16.onnx, onnx/embed_tokens_q4f16.onnx,
        // onnx/decoder_model_merged_q4f16.onnx (+ _data files if present)
      ],
      requiredFeatures: ['shader-f16'],
    },
    'q4': {
      dtype: {
        audio_encoder: 'q4',
        embed_tokens: 'q4',
        decoder_model_merged: 'q4',
      },
      files: [
        // Same layout as q4f16 with `_q4.onnx` suffixes.
      ],
    },
  },
  recommended: true,
  sortOrder: 3,
}
```

### Type Union Additions

- `AsrEngineType`: add `'voxtral-3b'`
- `asrWorkerType` union on `ModelManifestEntry`: add `'voxtral-3b-webgpu'`

(The existing `StreamAsrEngineType` is **not** touched; this model is offline.)

## Engine Integration: `AsrEngine.ts`

Add one case to the worker-spawn switch, mirroring `cohere-transcribe-webgpu`:

```typescript
case 'voxtral-3b-webgpu':
  this.worker = new Worker(
    new URL('../workers/voxtral-3b-webgpu.worker.ts', import.meta.url),
    { type: 'module' },
  );
  break;
```

Init message construction mirrors the existing Voxtral 4B / Cohere init builder: pick the variant based on GPU capability (`shader-f16` → q4f16, else q4), resolve IndexedDB blob URLs from the ModelManager, and forward `language` from `AsrEngine.init(modelId, vadConfig, language, taskConfig)`.

`taskConfig.task === 'translate'` (AST mode) is **ignored** for v1. If a caller passes it, we emit a one-time `status` warning and proceed with `[TRANSCRIBE]`. A future extension can add `[TRANSLATE]` chat-template support.

## Session Source-Language Flow

No new wiring is needed — the existing flow already carries the language end-to-end:

```
settingsStore.sourceLanguage
  → LocalInferenceSessionConfig.sourceLanguage
  → LocalInferenceClient.init()
  → AsrEngine.init(modelId, vadConfig, language, taskConfig)
  → worker postMessage({ type: 'init', language, ... })
  → worker normalizes → injected into chat template per utterance
```

When the user changes `sourceLanguage` mid-idle, the existing re-init logic in `LocalInferenceClient` tears down and re-initializes the ASR engine, which reconstructs the worker with the new `language`. No code change for this path.

## Edge Cases

1. **Unsupported source language slips through.** The manifest's `languages` array already filters the 3B model out of UI selection when source ∉ 8 supported langs. Defensive-only: worker omits `lang:XX` and falls back to auto-detect.
2. **Language region suffix.** Normalized to 2-letter ISO (`en-US` → `en`, `zh_Hans` → `zh`).
3. **`shader-f16` unsupported.** Existing `selectVariant()` picks q4 automatically. Both variants are required in the manifest.
4. **WebGPU unavailable.** `requiredDevice: 'webgpu'` hides the model on unsupported browsers (existing mechanism).
5. **Long utterances.** Capped by existing VAD max-speech-duration (same as other WebGPU batch workers). Beyond that the VAD force-emits SpeechEnd and decoding proceeds on the capped segment.
6. **Flush (push-to-talk).** `flush` inbound message forces VAD to finalize; identical to existing workers.
7. **Translate task (`taskConfig.task === 'translate'`).** Out of scope for v1; worker emits a `status` warning and transcribes anyway.
8. **Concurrent utterances.** Decoding is serialized: a new SpeechEnd awaits any in-flight generate via a `currentDecodePromise` guard (mirrors Cohere worker at lines 183–232).

## What's NOT Changing

- `LocalInferenceClient` — already dispatches to `AsrEngine` for `type: 'asr'`.
- `IClient` interface — no structural changes.
- `ModelManager`, `modelStore`, IndexedDB download flow — already handle `hfModelId` entries.
- `ModelManagementSection.tsx`, `ProviderSpecificSettings.tsx` — manifest-driven, picks up new entries automatically.
- Translation and TTS pipeline — receives `onResult` callbacks unchanged.
- Voxtral 4B Realtime (`voxtral-webgpu`) — completely untouched.

## Success Criteria

- [ ] Voxtral 3B model appears in ASR selector on WebGPU-capable browsers when source language ∈ {en, es, fr, pt, hi, de, nl, it}.
- [ ] Both q4f16 and q4 variants are downloadable with byte-size progress indication.
- [ ] q4f16 is auto-selected on GPUs with `shader-f16`; q4 fallback on GPUs without it.
- [ ] Real-time partial transcription appears during speech (via `TextStreamer`).
- [ ] Language hint `lang:XX [TRANSCRIBE]` is injected into the chat template and visible in worker-side status logs.
- [ ] Transcription quality in a non-English supported language (DE or FR) is visibly better than running 4B Realtime on the same audio — confirms the hint is taking effect.
- [ ] Switching source language between sessions re-initializes the worker cleanly.
- [ ] 4B Realtime remains functional and still listed first in the selector (`sortOrder: 2` < `3`).
- [ ] Clean disconnect releases WebGPU resources and terminates the worker.

## References

- [Issue #169](https://github.com/kizuna-ai-lab/sokuji/issues/169)
- [onnx-community/Voxtral-Mini-3B-2507-ONNX](https://huggingface.co/onnx-community/Voxtral-Mini-3B-2507-ONNX)
- [Voxtral HF Transformers docs](https://huggingface.co/docs/transformers/model_doc/voxtral)
- [Voxtral WebGPU Demo Space](https://huggingface.co/spaces/webml-community/Voxtral-WebGPU)
- Prior specs:
  - [2026-03-27 Voxtral full integration (4B Realtime)](2026-03-27-voxtral-full-integration-design.md)
  - [2026-03-28 Cohere Transcribe integration](2026-03-28-cohere-transcribe-integration-design.md) — closest batch/WebGPU reference
