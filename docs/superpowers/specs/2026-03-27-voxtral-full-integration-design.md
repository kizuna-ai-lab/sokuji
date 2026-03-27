# Voxtral Mini 4B Realtime Full Integration Design

**Date:** 2026-03-27
**Issue:** [#125](https://github.com/kizuna-ai-lab/sokuji/issues/125)
**Scope:** Production integration of Voxtral Mini 4B as a streaming ASR engine in LocalInference

## Summary

Integrate Voxtral Mini 4B Realtime as a new `StreamingAsrEngine` worker type (`voxtral-webgpu`). The model runs entirely inside a dedicated module Web Worker with WebGPU inference, uses hybrid endpoint detection (VAD + punctuation), and emits partial/final results through the existing streaming ASR callback interface. A single multilingual manifest entry covers all 13 supported languages.

## Model Details

| Spec | Value |
|------|-------|
| Model | `onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX` |
| Quantization | q4f16 (with shader-f16) or q4 (fallback) |
| Download size | ~2GB (q4f16) / ~2.9GB (q4) |
| Input | 16kHz mono Float32 audio |
| Languages | 13: ar, de, en, es, fr, hi, it, nl, pt, zh, ja, ko, ru |
| Architecture | Causal audio encoder + sliding window attention |
| Caching | HuggingFace Hub via browser Cache API (transformers.js managed) |

## Architecture

### Data Flow

```
Mic (24kHz Int16)
    ↓
LocalInferenceClient.appendInputAudio()
    ↓
StreamingAsrEngine.feedAudio(samples, 24000)
    ↓  postMessage({ type: 'audio', samples, sampleRate })
voxtral-webgpu.worker.ts
    ├── Resample 24kHz→16kHz
    ├── VAD (@ricky0123/vad-web)
    │     ├── speech start → postMessage({ type: 'speech_start' })
    │     └── speech end   → stop generator → postMessage({ type: 'result', text, ... })
    ├── Audio buffer (accumulating Float32Array @ 16kHz)
    └── Voxtral inference loop (during speech)
          ├── VoxtralRealtimeProcessor → mel spectrogram chunks
          ├── model.generate({ input_features: asyncGenerator, streamer })
          └── BaseStreamer subclass
                ├── decode tokens → postMessage({ type: 'partial', text })
                └── if punctuationEndpoint: detect sentence-end punctuation
                      → postMessage({ type: 'result', text, ... })
                      → reset text buffer, continue generating
    ↓
StreamingAsrEngine callbacks
    ├── onPartialResult → LocalInferenceClient.handlePartialAsrResult()
    ├── onResult → LocalInferenceClient.handleAsrResult() → translation → TTS
    └── onSpeechStart → LocalInferenceClient (event emission)
```

### Key Design Decisions

1. **StreamingAsrEngine** (not AsrEngine) — emits `onPartialResult` for real-time transcription UX, fits the existing streaming pattern in LocalInferenceClient
2. **Full model in worker** — WebGPU is available in dedicated workers since Chrome 113; keeps UI thread responsive during ~4B parameter inference
3. **HF Hub direct** — `from_pretrained(hfModelId)` with browser Cache API, consistent with Whisper WebGPU pattern; no IndexedDB blob URL management
4. **Single multilingual entry** — one manifest entry, `multilingual: true`, 13 languages
5. **Hybrid endpoint detection** — VAD for speech boundaries + punctuation-based sentence splitting for lower translation latency; punctuation splitting is toggleable via `punctuationEndpoint` setting
6. **shader-f16 detection** — auto-select q4f16 or q4 variant based on GPU capabilities

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/local-inference/workers/voxtral-webgpu.worker.ts` | Create | Module worker: Voxtral model loading, VAD, streaming inference, hybrid endpoint detection |
| `src/lib/local-inference/engine/StreamingAsrEngine.ts` | Modify | Add `voxtral-webgpu` worker routing, update header comments |
| `src/lib/local-inference/engine/AsrEngine.ts` | Modify | Update header comments to reflect multi-worker-type support |
| `src/lib/local-inference/modelManifest.ts` | Modify | Add Voxtral manifest entry, extend type unions |
| `src/lib/local-inference/types.ts` | Modify | Add `VoxtralAsrInitMessage`, extend `StreamAsrEngineType` |
| `src/stores/settingsStore.ts` | Modify | Add `punctuationEndpoint` to `LocalInferenceSettings` |
| `src/services/interfaces/IClient.ts` | Modify | Add `punctuationEndpoint` to `LocalInferenceSessionConfig` |
| `src/App.tsx` | Modify | Remove prototype Ctrl+Shift+V shortcut |
| `src/lib/local-inference/VoxtralAsrProto.tsx` | Delete | Prototype replaced by production integration |

## Worker Design: `voxtral-webgpu.worker.ts`

### Init Message

```typescript
interface VoxtralAsrInitMessage {
  type: 'init';
  hfModelId: string;             // 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'
  language?: string;             // source language hint (optional, for future use)
  dtype: string | Record<string, string>;  // 'q4f16' or 'q4', or per-component mapping
  punctuationEndpoint: boolean;  // enable punctuation-based sentence splitting
  vadModelUrl: string;           // URL for Silero VAD ONNX model
}
```

### Worker State Machine

```
UNINITIALIZED
    ↓  init message
LOADING (download model + VAD)
    ↓  models ready
IDLE → emit { type: 'ready', loadTimeMs }
    ↓  audio messages arrive, VAD detects speech
ACTIVE (generate loop running)
    ├── partial results emitted via BaseStreamer
    ├── punctuation endpoints finalize mid-speech results
    └── VAD speech-end stops generator, finalizes remaining text
    ↓
IDLE (ready for next speech segment)
```

### Three Parallel Concerns

**1. Audio intake**
- Receives `{ type: 'audio', samples: Int16Array, sampleRate: number }` messages
- Resamples from 24kHz to 16kHz (linear interpolation)
- Feeds resampled audio to both VAD and the accumulating Float32Array buffer

**2. VAD (Voice Activity Detection)**
- Uses `@ricky0123/vad-web` with Silero VAD model (same as Whisper WebGPU worker)
- Speech start: emit `{ type: 'speech_start' }`, begin Voxtral generate loop
- Speech end: set stop flag on async generator, emit final `result` with remaining text

**3. Voxtral inference loop**
- Runs `model.generate()` with async `inputFeaturesGenerator` (same pattern as prototype)
- `BaseStreamer` subclass decodes tokens incrementally:
  - Sends `{ type: 'partial', text }` as text accumulates
  - Handles partial multi-byte characters (hold back U+FFFD, wait for more tokens)
  - If `punctuationEndpoint` enabled: checks for sentence-ending punctuation (`. 。 ! ? ！ ？`)
    - On match: emit `{ type: 'result', text, durationMs, recognitionTimeMs }` with finalized sentence
    - Reset text accumulator, continue generating for next sentence
- When generator stops (VAD speech end or flush): emit final `result` with remaining text

### Output Messages

The worker emits standard `StreamingAsrWorkerOutMessage` types:
- `{ type: 'ready', loadTimeMs }` — model + VAD loaded
- `{ type: 'status', message }` — loading progress, diagnostic info
- `{ type: 'speech_start' }` — VAD detected speech onset
- `{ type: 'partial', text }` — interim transcription (full accumulated text for current segment)
- `{ type: 'result', text, durationMs, recognitionTimeMs }` — finalized result (sentence or speech end)
- `{ type: 'error', error }` — error message
- `{ type: 'disposed' }` — cleanup complete

### Resampling

The worker receives audio at 24kHz (from LocalInferenceClient) but Voxtral expects 16kHz. Linear interpolation resampling:

```typescript
function resample24kTo16k(input: Int16Array): Float32Array {
  const ratio = 24000 / 16000;  // 1.5
  const outputLen = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLen);
  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    const s0 = input[idx] / 32768;
    const s1 = idx + 1 < input.length ? input[idx + 1] / 32768 : s0;
    output[i] = s0 + frac * (s1 - s0);
  }
  return output;
}
```

## StreamingAsrEngine Changes

### Worker Type Routing

Add `voxtral-webgpu` case to `StreamingAsrEngine.init()`:

```typescript
const workerType = model.asrWorkerType || 'sherpa-onnx';

switch (workerType) {
  case 'voxtral-webgpu':
    this.worker = new Worker(
      new URL('../workers/voxtral-webgpu.worker.ts', import.meta.url),
      { type: 'module' },
    );
    break;
  default: // sherpa-onnx streaming
    this.worker = new Worker('./workers/sherpa-onnx-streaming-asr.worker.js');
    break;
}
```

### Init Message Construction

For `voxtral-webgpu`, construct `VoxtralAsrInitMessage` instead of the sherpa-onnx init message:

```typescript
if (workerType === 'voxtral-webgpu') {
  const { deviceFeatures } = useModelStore.getState();
  const hasF16 = deviceFeatures?.includes('shader-f16') ?? false;
  const dtype = hasF16 ? model.variants['q4f16']?.dtype : model.variants['q4']?.dtype;

  this.worker.postMessage({
    type: 'init',
    hfModelId: model.hfModelId,
    language,
    dtype: dtype || 'q4',
    punctuationEndpoint: options?.punctuationEndpoint ?? true,
    vadModelUrl: '/vad/silero_vad_v5.onnx',
  });
}
```

### Extended Init Signature

`StreamingAsrEngine.init()` gains an optional `options` parameter:

```typescript
async init(
  modelId: string,
  options?: {
    language?: string;
    punctuationEndpoint?: boolean;
  }
): Promise<{ loadTimeMs: number }>
```

### Updated Header Comments

Both `AsrEngine.ts` and `StreamingAsrEngine.ts` file headers updated to reflect that they support multiple worker types (sherpa-onnx classic workers, WebGPU module workers).

## Model Manifest Entry

```typescript
{
  id: 'voxtral-mini-4b-webgpu',
  type: 'asr-stream',
  name: 'Voxtral Mini 4B Realtime (WebGPU)',
  languages: ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'nl', 'pt', 'zh', 'ja', 'ko', 'ru'],
  multilingual: true,
  hfModelId: 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
  requiredDevice: 'webgpu',
  asrEngine: 'voxtral',
  asrWorkerType: 'voxtral-webgpu',
  variants: {
    'q4f16': {
      dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
      files: [],
      requiredFeatures: ['shader-f16'],
    },
    'q4': {
      dtype: { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' },
      files: [],
    },
  },
}
```

Type system additions:
- `StreamAsrEngineType`: add `'voxtral'`
- `AsrWorkerType` (or equivalent): add `'voxtral-webgpu'`

## Settings & Config

### LocalInferenceSettings

Add to `settingsStore.ts`:

```typescript
export interface LocalInferenceSettings {
  // ... existing fields ...
  punctuationEndpoint: boolean;  // default: true
}

const defaultLocalInferenceSettings: LocalInferenceSettings = {
  // ... existing defaults ...
  punctuationEndpoint: true,
};
```

### LocalInferenceSessionConfig

Add to `IClient.ts`:

```typescript
export interface LocalInferenceSessionConfig extends BaseSessionConfig {
  // ... existing fields ...
  punctuationEndpoint?: boolean;
}
```

### Config Flow

```
settingsStore.punctuationEndpoint
    → createLocalInferenceSessionConfig()
    → LocalInferenceSessionConfig.punctuationEndpoint
    → LocalInferenceClient.connect()
    → StreamingAsrEngine.init(modelId, { punctuationEndpoint })
    → worker postMessage({ type: 'init', punctuationEndpoint })
```

## Punctuation Endpoint Detection

Sentence-ending characters that trigger finalization when `punctuationEndpoint` is enabled:

```typescript
const SENTENCE_END_PATTERN = /[.。!?！？]\s*$/;
```

When matched in the accumulated text:
1. Emit `{ type: 'result', text: accumulatedText }` with the finalized sentence
2. Reset text accumulator and `printLen` for the next sentence
3. Continue the generate loop (don't stop — more speech may follow)

This runs inside the `BaseStreamer.put()` method after token decode.

## Cleanup: Prototype Removal

- Delete `src/lib/local-inference/VoxtralAsrProto.tsx`
- Remove `Ctrl+Shift+V` keyboard shortcut and lazy import from `src/App.tsx`
- Restore `App.tsx` to its pre-prototype state (just router, no useState/useEffect)

## What's NOT Changing

- **LocalInferenceClient** — already handles `asr-stream` type via StreamingAsrEngine; no changes to ASR result handling or translation/TTS pipeline
- **IClient interface** — no structural changes
- **modelStore** — `requiredDevice: 'webgpu'` gating already works; variant selection with `requiredFeatures` already works
- **ModelManagementSection UI** — already shows/filters by device capability and downloads HF Hub models
- **Translation/TTS pipeline** — receives results from ASR callbacks unchanged

## Success Criteria

- [ ] Voxtral model appears in ASR model selector when WebGPU is available
- [ ] Model downloads via HF Hub with progress indication in Model Management UI
- [ ] Model is hidden when WebGPU is not available
- [ ] q4f16 selected when shader-f16 available, q4 otherwise
- [ ] Real-time partial transcription displayed during speech
- [ ] Punctuation-based sentence splitting triggers translation without waiting for silence
- [ ] VAD speech-end finalizes remaining text and triggers translation
- [ ] `punctuationEndpoint: false` disables punctuation splitting (VAD-only endpoint)
- [ ] Clean stop/disconnect releases WebGPU resources and terminates worker
- [ ] All 13 supported languages produce transcription results
- [ ] Prototype files removed, App.tsx restored

## References

- [HF WebGPU demo](https://huggingface.co/spaces/mistralai/Voxtral-Realtime-WebGPU) — streaming generate pattern reference
- [ONNX model](https://huggingface.co/onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX) — q4 and q4f16 variants
- [Prototype branch](../../) — `feat/voxtral-asr-prototype` branch validates core feasibility
- [Issue #121](https://github.com/kizuna-ai-lab/sokuji/issues/121) — shader-f16 dtype optimization
