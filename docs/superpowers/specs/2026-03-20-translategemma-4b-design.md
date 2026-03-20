# TranslateGemma 4B WebGPU Translation Engine

**Issue:** [#123](https://github.com/kizuna-ai-lab/sokuji/issues/123)
**Date:** 2026-03-20
**Status:** Design approved

## Summary

Add TranslateGemma 4B as a local translation engine via WebGPU, coexisting alongside Qwen and Opus-MT models. TranslateGemma is Google's purpose-built translation model supporting 55 languages with any-to-any bidirectional translation — a significant upgrade over pair-specific Opus-MT and general-purpose Qwen models.

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

### Supported Languages (55)

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

const translatedText = output[0].generated_text.pop().content;
```

The chat template internally expands this into: "You are a professional Japanese (ja) to English (en) translator. Produce only the English translation..."

## Architecture

### Approach

Minimal integration following existing patterns — add a new worker type, manifest entry, and one switch case in TranslationEngine. No changes to stores, UI, or client orchestration.

### Files Changed

| File | Change | Description |
|------|--------|-------------|
| `src/lib/local-inference/workers/translategemma-translation.worker.ts` | **New** | ES module worker: blob URL cache + `pipeline("text-generation")` + structured message format |
| `src/lib/local-inference/modelManifest.ts` | **Modify** | Add file list functions + manifest entry with 55 languages |
| `src/lib/local-inference/engine/TranslationEngine.ts` | **Modify** | Add `case 'translategemma'` in worker creation switch |

### Files NOT Changed

- `modelStore.ts` — `isProviderReady` works automatically via manifest query
- `settingsStore.ts` — validation logic unchanged
- `ModelManagementSection.tsx` — UI reads from manifest, auto-displays new model
- `LocalInferenceClient.ts` — passes modelId to TranslationEngine transparently

### Worker Implementation

`src/lib/local-inference/workers/translategemma-translation.worker.ts` (ES module):

```typescript
import { pipeline, env } from '@huggingface/transformers';

let generator: any = null;

// Blob URL cache — same pattern as Qwen workers
function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string): Promise<Response | undefined> {
      // Extract filename from HF Hub URL, look up in fileUrls map
      const url = new URL(request);
      const pathParts = url.pathname.split('/');
      // Try progressively longer suffixes: "model_q4.onnx", "onnx/model_q4.onnx"
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const candidate = pathParts.slice(i).join('/');
        if (fileUrls[candidate]) {
          return fetch(fileUrls[candidate]);
        }
      }
      return undefined;
    }
  };
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    const startTime = performance.now();

    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    generator = await pipeline("text-generation", msg.hfModelId, {
      device: "webgpu",
      dtype: msg.dtype,
      progress_callback: (progress: any) => {
        self.postMessage({ type: 'progress', ...progress });
      },
    });

    const loadTimeMs = performance.now() - startTime;
    self.postMessage({ type: 'ready', loadTimeMs, device: 'webgpu' });
  }

  if (msg.type === 'translate') {
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

    const translatedText = output[0].generated_text.pop().content;
    const inferenceTimeMs = performance.now() - startTime;

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs,
    });
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

// Manifest entry
{
  id: 'translategemma-4b-translation',
  type: 'translation',
  name: 'TranslateGemma 4B (55 languages, WebGPU)',
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

Note: File sizes are approximate from HuggingFace listing. Replace with exact values during implementation (via HF API or after download).

## Implementation Notes

- The `createBlobUrlCache` function follows the exact same pattern as existing Qwen workers — intercepts Transformers.js fetch calls and redirects to IndexedDB blob URLs.
- Worker message protocol (`init`, `translate`, `result`) is identical to existing workers — no new message types needed.
- `getTranslationModel()` auto-selection logic is not modified. When multiple multilingual models are downloaded, it returns the first match in manifest order. Users select their preferred model explicitly in settings.
- No `chat_template.jinja` file needs to be included in downloads — Transformers.js reads the template from `tokenizer_config.json`.

## Out of Scope

- **Intelligent language routing** — auto-selecting optimal model per language pair (future feature)
- **ASR text preprocessing** — cleaning fillers/stuttering before translation
- **Streaming translation output** — generating tokens incrementally
- **Image translation** — TranslateGemma supports OCR translation but not needed for speech translation
- **`zh_CN` support** — commented out in official demo, needs investigation
