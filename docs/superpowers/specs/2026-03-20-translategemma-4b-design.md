# TranslateGemma 4B WebGPU Translation Engine

**Issue:** [#123](https://github.com/kizuna-ai-lab/sokuji/issues/123)
**Date:** 2026-03-20
**Status:** Design approved

## Summary

Add TranslateGemma 4B as a local translation engine via WebGPU, coexisting alongside Qwen and Opus-MT models. TranslateGemma is Google's purpose-built translation model supporting 51 languages with any-to-any bidirectional translation — a significant upgrade over pair-specific Opus-MT and general-purpose Qwen models.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ONNX model | `onnx-community/translategemma-text-4b-it-ONNX` | Used by official WebGPU demo, 1,665 downloads/month vs 14 for alternative |
| Variants | q4 (~3.1GB) + q4f16 (~2.8GB, shader-f16) | Consistent with Qwen 3.5 variant strategy |
| Download UX | No special warning | Existing progress indicator sufficient |
| Coexistence | Alongside Qwen + Opus-MT | User selects preferred model in settings |
| Worker architecture | New dedicated worker (`translategemma`) | Different message format (structured content vs plain text system prompt) |
| Language codes | Bare ISO 639-1 (e.g., `ja`, `en`, `zh`) | Chat template dictionary confirms support for bare codes |
| ASR artifact handling | None — trust model | No custom prompt possible; TranslateGemma uses fixed chat template |
| `max_new_tokens` | 1024 | Matches demo; add comment for future tuning |

## Model Specifications

- **Source:** `onnx-community/translategemma-text-4b-it-ONNX`
- **Architecture:** Gemma 3 decoder-only, fine-tuned for translation
- **Parameters:** 4B
- **Context:** 2K tokens
- **Loading:** `pipeline("text-generation", modelId, { device: "webgpu", dtype })` via Transformers.js
- **Demo reference:** [webml-community/TranslateGemma-WebGPU](https://huggingface.co/spaces/webml-community/TranslateGemma-WebGPU)

### Variants

| Variant | dtype | Size | Requirement |
|---------|-------|------|-------------|
| q4 | `"q4"` | ~3.1GB (3 files) | WebGPU |
| q4f16 | `"q4f16"` | ~2.8GB (3 files) | WebGPU + shader-f16 |

### Supported Languages (51)

```
ar, bg, bn, ca, cs, da, de, el, en, es, et, fa, fi, fr, gu,
he, hi, hr, hu, id, is, it, ja, kn, ko, lt, lv, ml, mr, nl,
no, pa, pl, pt, ro, ru, sk, sl, sr, sv, sw, ta, te, th, tl,
tr, uk, ur, vi, zh, zu
```

Note: `fil` (Filipino) in the demo maps to `tl` (Tagalog) in our app — both exist in the chat template dictionary. `zh_CN` is commented out in the demo; we use bare `zh` which is supported.

## Translation Message Format

TranslateGemma uses a structured content format (not plain text system prompts):

```typescript
const messages = [{
  role: "user",
  content: [{
    type: "text",
    source_lang_code: "ja",      // bare ISO 639-1
    target_lang_code: "en",
    text: "こんにちは",
  }],
}];

const output = await generator(messages, {
  max_new_tokens: 1024,  // TODO: tune for real-time translation latency
});

const lastMsg = output[0].generated_text[output[0].generated_text.length - 1];
const translatedText = lastMsg?.content || '';
```

The chat template internally expands this into: "You are a professional Japanese (ja) to English (en) translator. Produce only the English translation..."

## Architecture

### Approach

Minimal integration following existing patterns — add a new worker type, manifest entry, and one switch case in TranslationEngine. No changes to stores, UI, or client orchestration.

### Files Changed

| File | Change | Description |
|------|--------|-------------|
| `src/lib/local-inference/workers/translategemma-translation.worker.ts` | **New** | ES module worker: blob URL cache + `pipeline("text-generation")` + structured message format |
| `src/lib/local-inference/modelManifest.ts` | **Modify** | Add `'translategemma'` to `translationWorkerType` union, add file list functions + manifest entry |
| `src/lib/local-inference/engine/TranslationEngine.ts` | **Modify** | Add `case 'translategemma'` in worker creation switch |

### Files NOT Changed

- `modelStore.ts` — `isProviderReady` works automatically via manifest query
- `settingsStore.ts` — validation logic unchanged
- `ModelManagementSection.tsx` — UI reads from manifest, auto-displays new model
- `LocalInferenceClient.ts` — passes modelId to TranslationEngine transparently

### Worker Implementation

`src/lib/local-inference/workers/translategemma-translation.worker.ts` (ES module):

Follow the established pattern from `qwen-translation.worker.ts` with these key elements:

```typescript
import { pipeline, env } from '@huggingface/transformers';

let generator: any = null;

// Disable WASM proxy (must be at module level, before any pipeline call)
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// Blob URL cache — use established /resolve/main/ marker pattern (same as qwen workers)
function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;
      const url = typeof request === 'string' ? request : request.url;
      const resolveMainMarker = '/resolve/main/';
      const idx = url.indexOf(resolveMainMarker);
      if (idx === -1) return undefined;
      const filename = url.slice(idx + resolveMainMarker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;
      return fetch(blobUrl);
    },
    async put(_request: string | Request, _response: Response): Promise<void> {
      // No-op: files are pre-downloaded to IndexedDB
    },
  };
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      // Check WebGPU availability
      const gpu = (self as any).navigator?.gpu;
      if (!gpu) {
        self.postMessage({ type: 'error', error: 'WebGPU is not available in this browser' });
        return;
      }

      const startTime = performance.now();

      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      env.useCustomCache = true;
      env.customCache = createBlobUrlCache(msg.fileUrls);

      // Apply ORT WASM paths if provided
      if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }

      generator = await pipeline("text-generation", msg.hfModelId, {
        device: "webgpu",
        dtype: msg.dtype,
        progress_callback: (progress: any) => {
          self.postMessage({ type: 'progress', ...progress });
        },
      });

      const loadTimeMs = performance.now() - startTime;
      self.postMessage({ type: 'ready', loadTimeMs, device: 'webgpu' });
    } catch (err: any) {
      self.postMessage({ type: 'error', error: err.message || String(err) });
    }
  }

  if (msg.type === 'translate') {
    try {
      const startTime = performance.now();

      const messages = [{
        role: "user",
        content: [{
          type: "text",
          source_lang_code: msg.sourceLang,
          target_lang_code: msg.targetLang,
          text: msg.text,
        }],
      }];

      const output = await generator(messages, {
        max_new_tokens: 1024,  // TODO: tune for real-time translation latency
      });

      const lastMsg = output[0].generated_text[output[0].generated_text.length - 1];
      const translatedText = lastMsg?.content || '';
      const inferenceTimeMs = performance.now() - startTime;

      self.postMessage({
        type: 'result',
        id: msg.id,
        sourceText: msg.text,
        translatedText,
        inferenceTimeMs,
      });
    } catch (err: any) {
      self.postMessage({ type: 'error', id: msg.id, error: err.message || String(err) });
    }
  }

  if (msg.type === 'dispose') {
    try {
      await generator?.dispose?.();
      generator = null;
    } catch { /* ignore cleanup errors */ }
  }
};
```

### TranslationEngine Change

```typescript
// src/lib/local-inference/engine/TranslationEngine.ts
// In worker creation switch:

case 'translategemma':
  worker = new Worker(
    new URL('../workers/translategemma-translation.worker.ts', import.meta.url),
    { type: 'module' }
  );
  break;
```

### Model Manifest Entry

```typescript
// src/lib/local-inference/modelManifest.ts

// 1. Update translationWorkerType union type:
//    translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma';

/** TranslateGemma 4B q4 files (~3.1GB total) */
function translateGemmaQ4Files(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 2_210 },
    { filename: 'generation_config.json', sizeBytes: 155 },
    { filename: 'tokenizer.json', sizeBytes: 20_300_000 },
    { filename: 'tokenizer_config.json', sizeBytes: 20_800 },
    { filename: 'onnx/model_q4.onnx', sizeBytes: 457_000 },
    { filename: 'onnx/model_q4.onnx_data', sizeBytes: 2_100_000_000 },
    { filename: 'onnx/model_q4.onnx_data_1', sizeBytes: 994_000_000 },
  ];
}

/** TranslateGemma 4B q4f16 files (~2.8GB total) */
function translateGemmaQ4f16Files(): ModelFileEntry[] {
  return [
    { filename: 'config.json', sizeBytes: 2_210 },
    { filename: 'generation_config.json', sizeBytes: 155 },
    { filename: 'tokenizer.json', sizeBytes: 20_300_000 },
    { filename: 'tokenizer_config.json', sizeBytes: 20_800 },
    { filename: 'onnx/model_q4f16.onnx', sizeBytes: 614_000 },
    { filename: 'onnx/model_q4f16.onnx_data', sizeBytes: 2_090_000_000 },
    { filename: 'onnx/model_q4f16.onnx_data_1', sizeBytes: 624_000_000 },
  ];
}

// Place AFTER existing Qwen entries in the multilingual section.
// getTranslationModel() returns first multilingual match, so Qwen
// models retain auto-selection priority for existing users.
{
  id: 'translategemma-4b-translation',
  type: 'translation',
  name: 'TranslateGemma 4B (51 languages, WebGPU)',
  languages: [
    'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es',
    'et', 'fa', 'fi', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id',
    'is', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'nl',
    'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv',
    'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh', 'zu',
  ],
  multilingual: true,
  requiredDevice: 'webgpu',
  hfModelId: 'onnx-community/translategemma-text-4b-it-ONNX',
  translationWorkerType: 'translategemma',
  variants: {
    'q4': { dtype: 'q4', files: translateGemmaQ4Files() },
    'q4f16': {
      dtype: 'q4f16',
      files: translateGemmaQ4f16Files(),
      requiredFeatures: ['shader-f16'],
    },
  },
}
```

Note: File sizes are approximate from HuggingFace listing. Implementation step must verify exact sizes via HF API (`huggingface-hub` or API call) before final commit.

## Implementation Notes

- The `createBlobUrlCache` function uses the established `/resolve/main/` marker pattern from existing Qwen workers — intercepts Transformers.js fetch calls and redirects to IndexedDB blob URLs. Includes no-op `put()` method required by Transformers.js cache interface.
- Worker message protocol (`init`, `translate`, `result`, `error`, `dispose`) is identical to existing workers — no new message types needed.
- Worker includes WebGPU availability check, try-catch error handling, WASM proxy disable, ORT WASM path config, and dispose handler — all matching the established worker pattern.
- `getTranslationModel()` auto-selection logic is not modified. TranslateGemma entry placed after Qwen entries in manifest so Qwen retains auto-selection priority. Users select their preferred model explicitly in settings.
- No `chat_template.jinja` file needs to be included in downloads — Transformers.js reads the template from `tokenizer_config.json`.
- Manifest type union `translationWorkerType` must be extended to include `'translategemma'`.

## Out of Scope

- **Intelligent language routing** — auto-selecting optimal model per language pair (future feature)
- **ASR text preprocessing** — cleaning fillers/stuttering before translation
- **Streaming translation output** — generating tokens incrementally
- **Image translation** — TranslateGemma supports OCR translation but not needed for speech translation
- **`zh_CN` support** — commented out in official demo, needs investigation
