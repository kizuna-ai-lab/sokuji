# TranslateGemma 4B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TranslateGemma 4B as a WebGPU translation engine alongside existing Qwen and Opus-MT models.

**Architecture:** New dedicated worker (`translategemma-translation.worker.ts`) using `pipeline("text-generation")` with TranslateGemma's structured message format, a manifest entry with q4/q4f16 variants and 51 languages, and one switch case in `TranslationEngine`. No changes to stores, UI, or client orchestration.

**Tech Stack:** TypeScript, @huggingface/transformers, WebGPU, Web Workers (ES module)

**Spec:** `docs/superpowers/specs/2026-03-20-translategemma-4b-design.md`

---

### Task 1: Verify exact file sizes from HuggingFace

**Files:**
- Reference: `src/lib/local-inference/modelManifest.ts` (existing file list functions for pattern)

The spec notes file sizes are approximate. We need exact values for correct download progress tracking.

- [ ] **Step 1: Query HF API for q4 variant file sizes**

Run:
```bash
for f in config.json generation_config.json tokenizer.json tokenizer_config.json onnx/model_q4.onnx onnx/model_q4.onnx_data onnx/model_q4.onnx_data_1; do
  size=$(curl -sI "https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/resolve/main/$f" | grep -i content-length | tail -1 | awk '{print $2}' | tr -d '\r')
  echo "$f: $size"
done
```

- [ ] **Step 2: Query HF API for q4f16 variant file sizes**

Run:
```bash
for f in onnx/model_q4f16.onnx onnx/model_q4f16.onnx_data onnx/model_q4f16.onnx_data_1; do
  size=$(curl -sI "https://huggingface.co/onnx-community/translategemma-text-4b-it-ONNX/resolve/main/$f" | grep -i content-length | tail -1 | awk '{print $2}' | tr -d '\r')
  echo "$f: $size"
done
```

- [ ] **Step 3: Record exact sizes**

Note down all exact byte counts. These will be used in Task 3 when writing the manifest entry.

---

### Task 2: Create the TranslateGemma translation worker

**Files:**
- Create: `src/lib/local-inference/workers/translategemma-translation.worker.ts`
- Reference: `src/lib/local-inference/workers/qwen-translation.worker.ts` (template to follow)

- [ ] **Step 1: Create worker file**

Create `src/lib/local-inference/workers/translategemma-translation.worker.ts` following the established pattern from `qwen-translation.worker.ts`. Key differences from Qwen:
- No `LANG_NAMES` map or system prompt construction — TranslateGemma uses structured content
- No `<think>` block stripping — TranslateGemma doesn't use extended thinking
- No `do_sample`/`temperature`/`tokenizer_encode_kwargs` — only `max_new_tokens: 1024`
- Message format uses `{ type: "text", source_lang_code, target_lang_code, text }` content objects

```typescript
/**
 * TranslateGemma Translation Worker — TranslateGemma 4B via WebGPU
 *
 * Production worker for multilingual translation using Google's purpose-built
 * translation model. Model files are pre-downloaded into IndexedDB and served
 * via blob URL cache (same pattern as the Qwen translation worker).
 *
 * TranslateGemma uses a structured content format with source/target language
 * codes rather than system prompts. The chat template internally constructs
 * the translation prompt.
 */

import { pipeline, env } from '@huggingface/transformers';

// Disable WASM proxy (we're already in a worker).
// wasmPaths is set in the init handler from the main thread's resolved URL.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// ─── Message types ─────────────────────────────────────────────────────────

interface InitMessage {
  type: 'init';
  hfModelId: string;
  fileUrls: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  dtype?: string;
  ortWasmBaseUrl?: string;
}

interface TranslateMessage {
  type: 'translate';
  id: string;
  text: string;
  sourceLang: string;
  targetLang: string;
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let generator: any = null;

// ─── Blob URL cache (same pattern as qwen-translation.worker.ts) ──────────

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
    async put(_request: string | Request, _response: Response): Promise<void> {},
  };
}

// ─── Init handler ──────────────────────────────────────────────────────────

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // Set ORT WASM paths from main thread's resolved URL
    if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    // WebGPU check
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. TranslateGemma requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. TranslateGemma requires WebGPU.' });
      return;
    }

    // Configure Transformers.js to use blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId, device: 'webgpu' });

    generator = await (pipeline as any)('text-generation', msg.hfModelId, {
      dtype: msg.dtype || 'q4',
      device: 'webgpu',
    });

    const elapsed = Math.round(performance.now() - startTime);
    self.postMessage({ type: 'ready', modelId: msg.hfModelId, loadTimeMs: elapsed, device: 'webgpu' });
  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
}

// ─── Translate handler ─────────────────────────────────────────────────────

async function handleTranslate(msg: TranslateMessage) {
  if (!generator) {
    self.postMessage({ type: 'error', id: msg.id, error: 'TranslateGemma model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    // TranslateGemma uses structured content with language codes
    // (not system prompts like Qwen). The chat template internally
    // constructs: "You are a professional X to Y translator..."
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        source_lang_code: msg.sourceLang,
        target_lang_code: msg.targetLang,
        text: msg.text,
      }],
    }];

    const output = await generator(messages, {
      max_new_tokens: 1024,  // TODO: tune for real-time translation latency
    });

    const elapsed = Math.round(performance.now() - startTime);

    // Extract generated text from chat output
    let translatedText = '';
    if (Array.isArray(output) && output.length > 0) {
      const result = output[0] as any;
      if (result.generated_text) {
        if (Array.isArray(result.generated_text)) {
          const lastMsg = result.generated_text[result.generated_text.length - 1];
          translatedText = lastMsg?.content || '';
        } else {
          translatedText = result.generated_text;
        }
      }
    }

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs: elapsed,
    });
  } catch (error: any) {
    self.postMessage({ type: 'error', id: msg.id, error: error.message || String(error) });
  }
}

// ─── Dispose handler ───────────────────────────────────────────────────────

async function handleDispose() {
  if (generator) {
    await generator?.dispose?.();
    generator = null;
  }
  self.postMessage({ type: 'disposed' });
}

// ─── Message router ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;
    case 'translate':
      await handleTranslate(msg);
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit src/lib/local-inference/workers/translategemma-translation.worker.ts`

This may show errors related to the `env` types from `@huggingface/transformers` — those are expected and match behavior of existing workers (they use `as any` casts). Verify no other errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/translategemma-translation.worker.ts
git commit -m "feat: add TranslateGemma translation worker

WebGPU worker for TranslateGemma 4B using structured content format
with source/target language codes. Follows established qwen worker
pattern: blob URL cache, WebGPU check, error handling, dispose."
```

---

### Task 3: Add model manifest entry

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts:100` (type union)
- Modify: `src/lib/local-inference/modelManifest.ts:2566` (after last Qwen entry)

- [ ] **Step 1: Update `translationWorkerType` union**

At line 100 of `src/lib/local-inference/modelManifest.ts`, change:

```typescript
// Before:
translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35';

// After:
translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma';
```

- [ ] **Step 2: Add file list functions**

Add these functions near the other translation file list functions (after line 365, after the `qwen35_2bTranslationFilesQ4f16` function). Replace the `sizeBytes` values with exact values from Task 1:

```typescript
/** TranslateGemma 4B q4 files (~3.1GB total).
 *  Source: onnx-community/translategemma-text-4b-it-ONNX */
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

/** TranslateGemma 4B q4f16 files (~2.8GB total).
 *  Source: onnx-community/translategemma-text-4b-it-ONNX */
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
```

- [ ] **Step 3: Add manifest entry**

Insert after the `qwen3.5-2b-translation` entry (after line 2566), before the commented-out language family models section:

```typescript
  // ── TranslateGemma ───────────────────────────────────────────────────
  // Google's purpose-built translation model. Uses structured content format
  // with source/target language codes (not system prompts).
  // Placed after Qwen entries so Qwen retains getTranslationModel() auto-selection priority.
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
  },
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No new errors from the manifest changes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat: add TranslateGemma 4B to model manifest

Register TranslateGemma 4B with q4 and q4f16 variants, 51 supported
languages, and 'translategemma' worker type. Placed after Qwen entries
to preserve auto-selection priority for existing users."
```

---

### Task 4: Add TranslationEngine worker dispatch

**Files:**
- Modify: `src/lib/local-inference/engine/TranslationEngine.ts:80-99` (worker switch)

- [ ] **Step 1: Add translategemma case**

In `src/lib/local-inference/engine/TranslationEngine.ts`, add a new case in the worker creation switch (between the `'qwen'` case ending at line 92 and the `default` case at line 93):

```typescript
      case 'translategemma':
        this.worker = new Worker(
          new URL('../workers/translategemma-translation.worker.ts', import.meta.url),
          { type: 'module' }
        );
        break;
```

The full switch should read:
```typescript
      switch (workerType) {
        case 'qwen35':
          this.worker = new Worker(
            new URL('../workers/qwen35-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        case 'qwen':
          this.worker = new Worker(
            new URL('../workers/qwen-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        case 'translategemma':
          this.worker = new Worker(
            new URL('../workers/translategemma-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        default: // opus-mt
          this.worker = new Worker(
            new URL('../workers/translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
      }
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/engine/TranslationEngine.ts
git commit -m "feat: add TranslateGemma worker dispatch in TranslationEngine

Add 'translategemma' case to worker creation switch, routing to the
new translategemma-translation.worker.ts."
```

---

### Task 5: Build verification and smoke test

**Files:**
- Reference: `package.json` (build scripts)

- [ ] **Step 1: Run full TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No new errors introduced by our changes.

- [ ] **Step 2: Run Vite dev build**

Run: `npm run build`
Expected: Build succeeds. The new worker should be bundled as a separate chunk (ES module worker).

- [ ] **Step 3: Run existing tests**

Run: `npm run test`
Expected: All existing tests pass — our changes are additive and should not break anything.

- [ ] **Step 4: Verify worker is bundled**

Run: `ls -la build/assets/ | grep -i translategemma` or check build output for the worker chunk.
Expected: A worker chunk file exists for the TranslateGemma worker.

- [ ] **Step 5: Commit (if any fixes needed)**

If any build/test issues were found and fixed:
```bash
git add -A
git commit -m "fix: resolve build issues for TranslateGemma integration"
```

---

### Task 6: Final commit and summary

- [ ] **Step 1: Review all changes**

Run: `git log --oneline HEAD ^main`

Verify all commits are present:
1. TranslateGemma translation worker
2. Model manifest entry
3. TranslationEngine worker dispatch
4. Any build fixes

- [ ] **Step 2: Verify clean working tree**

Run: `git status`
Expected: Clean working tree, no uncommitted changes.
