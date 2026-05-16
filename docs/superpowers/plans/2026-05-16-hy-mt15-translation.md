# HY-MT1.5-1.8B WebGPU Translation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Tencent HY-MT1.5-1.8B as a new WebGPU-backed multilingual local translation option in Sokuji, promoting it to the default-recommended local translation model.

**Architecture:** Manifest-driven integration. A new `'hy-mt'` `translationWorkerType` routes to a fresh worker (`hy-mt-translation.worker.ts`) that wraps `@huggingface/transformers` `pipeline('text-generation', ...)`. The ONNX weights are pulled directly from `onnx-community/HY-MT1.5-1.8B-ONNX` via existing `ModelManager` + IndexedDB plumbing — no changes to download/storage/UI layers.

**Tech Stack:**
- `@huggingface/transformers` 4.2.0 (already installed; ships the `hunyuan_v1_dense` model class)
- WebGPU via the same blob-URL cache pattern used by `qwen-translation.worker.ts` and `translategemma-translation.worker.ts`
- Vitest + jsdom for unit-testing manifest data shape

**Spec reference:** `docs/superpowers/specs/2026-05-16-hy-mt15-translation-design.md`

---

## File Structure

**Created (1 source + 1 test):**
- `src/lib/local-inference/workers/hy-mt-translation.worker.ts` — ~140-line worker, slim variant of `qwen-translation.worker.ts` (user-only prompt, no system message, no `<think>` stripping, no shared prompt machinery).
- `src/lib/local-inference/modelManifest.hyMt.test.ts` — Unit tests asserting the new manifest entry shape, the sortOrder migration, and `pickBestModel` preference. Follows the colocation convention of `prompts.test.ts`.

**Modified (2 files):**
- `src/lib/local-inference/modelManifest.ts`
  - Extend `translationWorkerType` union with `'hy-mt'` (line ~116)
  - Add `hyMt15_1_8bTranslationFiles()` + `hyMt15_1_8bTranslationFilesQ4f16()` helpers (placed next to existing `qwen3*TranslationFiles()` helpers near line ~370)
  - Insert new manifest entry for `hy-mt15-1.8b-translation` (immediately before the `translategemma-4b-translation` entry, ~line 2939)
  - Bump `translategemma-4b-translation.sortOrder` 1 → 2
  - Bump `qwen3-0.6b-translation.sortOrder` 2 → 3
- `src/lib/local-inference/engine/TranslationEngine.ts`
  - Add `case 'hy-mt'` to the `switch (workerType)` block (between the `'translategemma'` case and `default`, ~line 124)

**Not touched** (intentional — see spec Non-Goals): `ModelManager.ts`, `modelStorage.ts`, `modelStore.ts`, `prompts.ts`, `prompts.test.ts`, `ModelManagementSection.tsx`, `settingsStore.ts`, `types.ts`, i18n locales.

---

## Task 1: Add manifest entry, file-list builders, and sortOrder migration (TDD)

**Files:**
- Create: `src/lib/local-inference/modelManifest.hyMt.test.ts`
- Modify: `src/lib/local-inference/modelManifest.ts` (one type union, two helper functions, one new entry, two sortOrder bumps)

### Task 1.1 Write the failing tests

- [ ] **Step 1: Write the manifest unit test**

Create `src/lib/local-inference/modelManifest.hyMt.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import {
  getManifestEntry,
  pickBestModel,
  type ModelManifestEntry,
} from './modelManifest';

describe('HY-MT1.5-1.8B manifest entry', () => {
  const entry = getManifestEntry('hy-mt15-1.8b-translation');

  it('exists in the manifest', () => {
    expect(entry).toBeDefined();
  });

  it('is a multilingual WebGPU translation model with hfModelId pointing at onnx-community', () => {
    expect(entry?.type).toBe('translation');
    expect(entry?.multilingual).toBe(true);
    expect(entry?.requiredDevice).toBe('webgpu');
    expect(entry?.hfModelId).toBe('onnx-community/HY-MT1.5-1.8B-ONNX');
    expect(entry?.translationWorkerType).toBe('hy-mt');
  });

  it('declares all 36 languages from the ONNX repo README', () => {
    const expected = [
      'zh', 'en', 'fr', 'pt', 'es', 'ja', 'tr', 'ru', 'ar', 'ko',
      'th', 'it', 'de', 'vi', 'ms', 'id', 'tl', 'hi', 'pl', 'cs',
      'nl', 'km', 'my', 'fa', 'gu', 'ur', 'te', 'mr', 'he', 'bn',
      'ta', 'uk', 'bo', 'kk', 'mn', 'ug',
    ];
    expect(entry?.languages).toEqual(expected);
    expect(entry?.languages.length).toBe(36);
  });

  it('exposes q4 and q4f16 variants with correct file lists', () => {
    const q4 = entry?.variants['q4'];
    const q4f16 = entry?.variants['q4f16'];
    expect(q4?.dtype).toBe('q4');
    expect(q4f16?.dtype).toBe('q4f16');
    expect(q4f16?.requiredFeatures).toEqual(['shader-f16']);

    // 5 shared metadata files + 2 onnx files per variant
    expect(q4?.files.length).toBe(7);
    expect(q4f16?.files.length).toBe(7);

    const q4Names = q4?.files.map(f => f.filename) ?? [];
    expect(q4Names).toContain('onnx/model_q4.onnx');
    expect(q4Names).toContain('onnx/model_q4.onnx_data');
    expect(q4Names).toContain('tokenizer.json');
    expect(q4Names).toContain('chat_template.jinja');

    const q4f16Names = q4f16?.files.map(f => f.filename) ?? [];
    expect(q4f16Names).toContain('onnx/model_q4f16.onnx');
    expect(q4f16Names).toContain('onnx/model_q4f16.onnx_data');
  });

  it('is marked recommended with sortOrder 1 (highest local-translation priority)', () => {
    expect(entry?.recommended).toBe(true);
    expect(entry?.sortOrder).toBe(1);
  });
});

describe('Translation model sortOrder migration', () => {
  it('demotes translategemma-4b to sortOrder 2', () => {
    const tg = getManifestEntry('translategemma-4b-translation');
    expect(tg?.sortOrder).toBe(2);
    expect(tg?.recommended).toBe(true);
  });

  it('demotes qwen3-0.6b to sortOrder 3', () => {
    const q = getManifestEntry('qwen3-0.6b-translation');
    expect(q?.sortOrder).toBe(3);
    expect(q?.recommended).toBe(true);
  });
});

describe('pickBestModel preference', () => {
  it('selects HY-MT1.5 over TranslateGemma and Qwen3 when all are recommended', () => {
    const hy = getManifestEntry('hy-mt15-1.8b-translation') as ModelManifestEntry;
    const tg = getManifestEntry('translategemma-4b-translation') as ModelManifestEntry;
    const q  = getManifestEntry('qwen3-0.6b-translation') as ModelManifestEntry;
    expect(pickBestModel([tg, q, hy])?.id).toBe('hy-mt15-1.8b-translation');
    expect(pickBestModel([hy, tg])?.id).toBe('hy-mt15-1.8b-translation');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/lib/local-inference/modelManifest.hyMt.test.ts`
Expected: all 7 tests FAIL — entry is undefined, sortOrder mismatches.

### Task 1.2 Extend the `translationWorkerType` union

- [ ] **Step 3: Add `'hy-mt'` to the union**

Edit `src/lib/local-inference/modelManifest.ts`, find this line (around line 116):

```ts
  translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma' | 'bing';
```

Replace with:

```ts
  translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma' | 'bing' | 'hy-mt';
```

### Task 1.3 Add the two file-list helper functions

- [ ] **Step 4: Add file-list builders after the qwen helpers**

Edit `src/lib/local-inference/modelManifest.ts`. Find the existing function `qwen35_2bTranslationFilesQ4f16()` (around line 367). Immediately after its closing brace, insert:

```ts
function hyMt15_1_8bTranslationFiles(): ModelFileEntry[] {
  return [
    { filename: 'chat_template.jinja',        sizeBytes: 654 },
    { filename: 'config.json',                sizeBytes: 1_640 },
    { filename: 'generation_config.json',     sizeBytes: 255 },
    { filename: 'tokenizer.json',             sizeBytes: 8_672_000 },
    { filename: 'tokenizer_config.json',      sizeBytes: 1_170 },
    { filename: 'onnx/model_q4.onnx',         sizeBytes: 448_829 },
    { filename: 'onnx/model_q4.onnx_data',    sizeBytes: 1_405_788_224 },
  ];
}

function hyMt15_1_8bTranslationFilesQ4f16(): ModelFileEntry[] {
  return [
    { filename: 'chat_template.jinja',        sizeBytes: 654 },
    { filename: 'config.json',                sizeBytes: 1_640 },
    { filename: 'generation_config.json',     sizeBytes: 255 },
    { filename: 'tokenizer.json',             sizeBytes: 8_672_000 },
    { filename: 'tokenizer_config.json',      sizeBytes: 1_170 },
    { filename: 'onnx/model_q4f16.onnx',      sizeBytes: 434_623 },
    { filename: 'onnx/model_q4f16.onnx_data', sizeBytes: 1_226_479_424 },
  ];
}
```

### Task 1.4 Insert the new manifest entry

- [ ] **Step 5: Add the entry above translategemma**

Edit `src/lib/local-inference/modelManifest.ts`. Find this block (around line 2939):

```ts
  // ── TranslateGemma ───────────────────────────────────────────────────
  // Google's purpose-built translation model. Uses structured content format
  // with source/target language codes (not system prompts).
  // Placed after Qwen entries so Qwen retains getTranslationModel() auto-selection priority.
  {
    id: 'translategemma-4b-translation',
```

Replace the comment block + entry start with:

```ts
  // ── Hunyuan MT 1.5 ───────────────────────────────────────────────────
  // Tencent's translation-specialized LLM (WMT25 championship lineage).
  // Single model covers 36 languages including low-resource targets (km, my, bo, mn, ug, kk).
  // Direct from onnx-community; pipeline('text-generation', ...) auto-routes via the
  // 'hunyuan_v1_dense' entry in @huggingface/transformers' MODEL_FOR_CAUSAL_LM_MAPPING_NAMES.
  {
    id: 'hy-mt15-1.8b-translation',
    type: 'translation',
    name: 'Hunyuan MT 1.5 1.8B (36 languages, WebGPU)',
    languages: [
      'zh', 'en', 'fr', 'pt', 'es', 'ja', 'tr', 'ru', 'ar', 'ko',
      'th', 'it', 'de', 'vi', 'ms', 'id', 'tl', 'hi', 'pl', 'cs',
      'nl', 'km', 'my', 'fa', 'gu', 'ur', 'te', 'mr', 'he', 'bn',
      'ta', 'uk', 'bo', 'kk', 'mn', 'ug',
    ],
    multilingual: true,
    requiredDevice: 'webgpu',
    hfModelId: 'onnx-community/HY-MT1.5-1.8B-ONNX',
    variants: {
      'q4':    { dtype: 'q4',    files: hyMt15_1_8bTranslationFiles() },
      'q4f16': { dtype: 'q4f16', files: hyMt15_1_8bTranslationFilesQ4f16(),
                 requiredFeatures: ['shader-f16'] },
    },
    translationWorkerType: 'hy-mt',
    recommended: true,
    sortOrder: 1,
  },

  // ── TranslateGemma ───────────────────────────────────────────────────
  // Google's purpose-built translation model. Uses structured content format
  // with source/target language codes (not system prompts).
  // Now sortOrder=2 (below HY-MT1.5 which beats it on size and low-resource coverage).
  {
    id: 'translategemma-4b-translation',
```

### Task 1.5 Bump sortOrders of existing entries

- [ ] **Step 6: Demote `translategemma-4b-translation` sortOrder 1 → 2**

In `src/lib/local-inference/modelManifest.ts` find the `translategemma-4b-translation` entry (now at ~line 2986 after the insertion). Locate its `sortOrder: 1` line near the end of the object literal:

```ts
    recommended: true,
    sortOrder: 1,
  },
```

Replace with:

```ts
    recommended: true,
    sortOrder: 2,
  },
```

- [ ] **Step 7: Demote `qwen3-0.6b-translation` sortOrder 2 → 3**

Find the `qwen3-0.6b-translation` entry (line ~2855 — unchanged by previous edits). Locate:

```ts
    translationWorkerType: 'qwen',
    recommended: true,
    sortOrder: 2,
  },
```

Replace with:

```ts
    translationWorkerType: 'qwen',
    recommended: true,
    sortOrder: 3,
  },
```

### Task 1.6 Verify tests pass and commit

- [ ] **Step 8: Run the manifest tests to confirm they pass**

Run: `npx vitest run src/lib/local-inference/modelManifest.hyMt.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 9: Run the full vitest suite to confirm no regressions**

Run: `npx vitest run`
Expected: all tests PASS. Existing tests (modelStore, prompts, etc.) must remain green.

- [ ] **Step 10: Typecheck the whole project**

Run: `npx tsc -p tsconfig.json`
Expected: no output (typecheck clean).

- [ ] **Step 11: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts src/lib/local-inference/modelManifest.hyMt.test.ts
git commit -m "$(cat <<'EOF'
feat(manifest): register HY-MT1.5-1.8B as default local translation model

Adds onnx-community/HY-MT1.5-1.8B-ONNX manifest entry with q4 and q4f16
variants, plus a new 'hy-mt' translationWorkerType. Promotes HY-MT to
sortOrder=1 (default-recommended), demoting TranslateGemma to sortOrder=2
and Qwen3-0.6B to sortOrder=3 based on smaller footprint (~1.34GB q4) and
broader low-resource language coverage.

Refs #233

EOF
)"
```

---

## Task 2: Create the HY-MT translation worker

**Files:**
- Create: `src/lib/local-inference/workers/hy-mt-translation.worker.ts`

The worker has no automated test in the existing infrastructure (no precedent — neither qwen, qwen35, nor translategemma workers have unit tests; they require WebGPU and a real model load). Verification is via typecheck + manual smoke test in Task 4. This matches the precedent set by the existing translation workers.

### Task 2.1 Author the worker file

- [ ] **Step 1: Create the worker file**

Create `src/lib/local-inference/workers/hy-mt-translation.worker.ts` with this exact content:

```ts
/**
 * HY-MT1.5-1.8B Translation Worker — Tencent Hunyuan MT 1.5 via WebGPU.
 *
 * Production worker for multilingual translation using a translation-specialized
 * decoder-only LLM (hunyuan_v1_dense architecture). Model files are pre-downloaded
 * into IndexedDB and served via a blob URL cache (same pattern as the qwen and
 * translategemma translation workers).
 *
 * Prompt format follows the onnx-community model card exactly: user-only message,
 * no system prompt, greedy decoding. The shared prompts.ts machinery is intentionally
 * bypassed because HY-MT is purpose-built for translation and does not need the
 * filler/native-name reinforcement designed for general-purpose LLMs.
 */

import { pipeline, env } from '@huggingface/transformers';

// Disable WASM proxy (we're already in a worker).
// wasmPaths is set in the init handler from the main thread's resolved URL.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// ─── BCP-47 → English language names for the prompt template ────────────────
// Mirrors manifest.languages one-for-one (36 entries).

const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese',    en: 'English',    fr: 'French',     pt: 'Portuguese',
  es: 'Spanish',    ja: 'Japanese',   tr: 'Turkish',    ru: 'Russian',
  ar: 'Arabic',     ko: 'Korean',     th: 'Thai',       it: 'Italian',
  de: 'German',     vi: 'Vietnamese', ms: 'Malay',      id: 'Indonesian',
  tl: 'Filipino',   hi: 'Hindi',      pl: 'Polish',     cs: 'Czech',
  nl: 'Dutch',      km: 'Khmer',      my: 'Burmese',    fa: 'Persian',
  gu: 'Gujarati',   ur: 'Urdu',       te: 'Telugu',     mr: 'Marathi',
  he: 'Hebrew',     bn: 'Bengali',    ta: 'Tamil',      uk: 'Ukrainian',
  bo: 'Tibetan',    kk: 'Kazakh',     mn: 'Mongolian',  ug: 'Uyghur',
};

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
  systemPrompt: string;    // Ignored — HY-MT uses model-card user-only template.
  wrapTranscript: boolean; // Ignored — model card sends raw segment, no <transcript> tags.
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let generator: any = null;

// ─── Blob URL cache (same pattern as qwen-translation.worker.ts) ───────────

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

    if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. HY-MT translation requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. HY-MT translation requires WebGPU.' });
      return;
    }

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
    self.postMessage({ type: 'error', id: msg.id, error: 'HY-MT model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    const targetName = LANG_NAMES[msg.targetLang] ?? msg.targetLang;
    const userPrompt =
      `Translate the following segment into ${targetName}, without additional explanation.\n\n${msg.text}`;

    const result = await generator(
      [{ role: 'user', content: userPrompt }],
      { max_new_tokens: 512, do_sample: false },
    );

    let translatedText = '';
    if (Array.isArray(result) && result.length > 0) {
      const output = result[0] as any;
      if (output?.generated_text) {
        if (Array.isArray(output.generated_text)) {
          const lastMsg = output.generated_text[output.generated_text.length - 1];
          translatedText = lastMsg?.content || '';
        } else {
          translatedText = output.generated_text;
        }
      }
    }
    translatedText = translatedText.trim();

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs: Math.round(performance.now() - startTime),
      systemPrompt: userPrompt,
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

### Task 2.2 Verify typecheck

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/hy-mt-translation.worker.ts
git commit -m "$(cat <<'EOF'
feat(local-inference): add HY-MT1.5 translation worker

Mirrors qwen-translation.worker.ts but uses the onnx-community model-card
prompt verbatim: user-only message, greedy decoding, 512 max_new_tokens,
and a worker-local 36-language code→English-name table. systemPrompt /
wrapTranscript fields from the engine contract are accepted but ignored.

Refs #233

EOF
)"
```

---

## Task 3: Wire the worker into TranslationEngine

**Files:**
- Modify: `src/lib/local-inference/engine/TranslationEngine.ts:119-124` (insert new `case` before `default`)

### Task 3.1 Add the routing branch

- [ ] **Step 1: Add the `case 'hy-mt'` block**

Edit `src/lib/local-inference/engine/TranslationEngine.ts`. Find this block (around lines 119-126):

```ts
        case 'translategemma':
          this.worker = new Worker(
            new URL('../workers/translategemma-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        default: // opus-mt
```

Insert a new case between the `'translategemma'` case and `default`:

```ts
        case 'translategemma':
          this.worker = new Worker(
            new URL('../workers/translategemma-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        case 'hy-mt':
          this.worker = new Worker(
            new URL('../workers/hy-mt-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        default: // opus-mt
```

### Task 3.2 Verify and commit

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json`
Expected: no output (clean). The `'hy-mt'` literal must be assignable to the union extended in Task 1.

- [ ] **Step 3: Run the full vitest suite**

Run: `npx vitest run`
Expected: all tests PASS (manifest tests from Task 1 + everything else).

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/engine/TranslationEngine.ts
git commit -m "$(cat <<'EOF'
feat(translation-engine): route 'hy-mt' workerType to hy-mt-translation.worker

Adds the switch case that instantiates hy-mt-translation.worker.ts when the
selected translation model declares translationWorkerType: 'hy-mt'. Engine
↔ worker message contract (init / translate / dispose, with ready / result /
error / disposed responses) is unchanged.

Refs #233

EOF
)"
```

---

## Task 4: Manual validation pass

No automated test exists for end-to-end translation (requires WebGPU + ~1.3 GB model download). The Validation section of the design spec lists seven manual checks; this task walks them in order. Use a Chrome-family browser on a machine with WebGPU enabled.

### Task 4.1 Build verification

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: Vite build completes without errors. The new worker file is bundled (look for `hy-mt-translation` in the chunk list).

### Task 4.2 Run the app and download the model

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: Vite dev server starts; the app is reachable at `http://localhost:5173`.

- [ ] **Step 3: Verify WebGPU**

Open the app, then open DevTools → Console and run:

```js
navigator.gpu && (await navigator.gpu.requestAdapter())
```

Expected: returns a `GPUAdapter` object. If `null`, abort — manual validation requires WebGPU. Note the result in the PR description.

- [ ] **Step 4: Download HY-MT1.5 q4**

In the app: open Simple Settings → Provider: Local Inference → Model Management. Find "Hunyuan MT 1.5 1.8B (36 languages, WebGPU)" — it should appear at the top of the translation models list (above TranslateGemma).

Click Download. Watch the progress bar. Expected: ~1.34 GB total download writes to IndexedDB; on completion the model shows "Downloaded" / Ready state.

- [ ] **Step 5: Verify persistence**

Reload the page (Cmd/Ctrl+R). Re-open Model Management.
Expected: HY-MT1.5 still shows "Downloaded" — no re-download.

### Task 4.3 Auto-selection check

- [ ] **Step 6: Confirm HY-MT is auto-selected**

With HY-MT downloaded and a downloaded ASR model present (e.g. Whisper or SenseVoice), close Settings, set source/target languages to `ja → en`. Open Settings again — the Translation provider field should display HY-MT1.5 (not TranslateGemma).
Expected: HY-MT is the auto-selected translation model.

### Task 4.4 Translation smoke test

- [ ] **Step 7: High-resource pairs**

Start a translation session. For each of these source/target pairs, run 3 sample utterances (via microphone or a wav/text test fixture):

| Pair | Sample (source) |
|---|---|
| zh → en | 你好，今天天气很好。 |
| ja → en | こんにちは、調子はどう？ |
| en → fr | The conference starts at nine. |
| ko → en | 안녕하세요, 만나서 반갑습니다. |

Expected: output is in the correct target language, no echoed prompt text, no `<think>...</think>` tags, no obvious model-card-style explanations bleed into the output.

- [ ] **Step 8: Low-resource pairs**

Run 1-2 samples each:

| Pair | Sample (source) |
|---|---|
| km → en | សួស្តីលោកអ្នក។ |
| my → en | မင်္ဂလာပါ။ |
| bo → zh | བཀྲ་ཤིས་བདེ་ལེགས། |
| mn → en | Сайн байна уу? |

Expected: output is in the correct target language. Quality is acceptable for smoke-test purposes (no garbled output, no script confusion).

### Task 4.5 Latency baseline

- [ ] **Step 9: Record inferenceTimeMs**

In the LogsPanel (or DevTools console with verbose store logs), capture `inferenceTimeMs` for the `ja → en` sample "こんにちは、調子はどう？" on a freshly initialized HY-MT session. Note the value in the PR description.

- [ ] **Step 10: q4f16 garbage-token regression check**

On a Windows machine with a `shader-f16`-capable GPU (RTX 30/40-series, recent Intel Arc, recent AMD): re-download as q4f16 if `ModelManager` exposed it. Run 10 segments across CJK + Romance pairs (mix from steps 7-8).
Expected: no `<unused…>`, no `▁▁▁`, no repeated tokens, no truncation. If any artifact reproduces, document it in the PR and proceed to Task 4.7 (fallback).

### Task 4.6 Provider switching

- [ ] **Step 11: Switch translation models without reload**

In Settings, change Translation model: HY-MT1.5 → Qwen3-0.6B → HY-MT1.5. Watch DevTools → Memory (or GPU memory if exposed) at each switch.
Expected: each switch completes within ~10s; GPU memory returns near baseline after each dispose (allow some noise).

### Task 4.7 Conditional fallback if q4f16 is broken

- [ ] **Step 12 (conditional — only if Step 10 reproduced bad output)**

If q4f16 generates garbage tokens on Windows in Step 10, disable the variant. Edit `src/lib/local-inference/modelManifest.ts`, find the HY-MT entry's `variants` block:

```ts
    variants: {
      'q4':    { dtype: 'q4',    files: hyMt15_1_8bTranslationFiles() },
      'q4f16': { dtype: 'q4f16', files: hyMt15_1_8bTranslationFilesQ4f16(),
                 requiredFeatures: ['shader-f16'] },
    },
```

Replace with:

```ts
    variants: {
      'q4':    { dtype: 'q4',    files: hyMt15_1_8bTranslationFiles() },
      // NOTE: q4f16 disabled — produces garbage tokens on Windows WebGPU even
      // when GPU reports shader-f16 support. Same class of issue as Whisper
      // and TranslateGemma q4f16. See <PR link> for repro details.
      // 'q4f16': { dtype: 'q4f16', files: hyMt15_1_8bTranslationFilesQ4f16(),
      //            requiredFeatures: ['shader-f16'] },
    },
```

Then also update the unit test in `modelManifest.hyMt.test.ts`:

```ts
  it('exposes q4 and q4f16 variants with correct file lists', () => {
```

to:

```ts
  it('exposes q4 variant with correct file list (q4f16 disabled pending upstream fix)', () => {
```

And remove the q4f16 assertions in that test body. Then:

Run: `npx vitest run src/lib/local-inference/modelManifest.hyMt.test.ts`
Expected: PASS.

Commit:

```bash
git add src/lib/local-inference/modelManifest.ts src/lib/local-inference/modelManifest.hyMt.test.ts
git commit -m "$(cat <<'EOF'
fix(manifest): disable HY-MT1.5 q4f16 variant due to garbage tokens on WebGPU

Mirrors the prior TranslateGemma/Whisper q4f16 guard. q4 path remains the
sole runtime variant. Tests updated to reflect the single-variant manifest.

Refs #233

EOF
)"
```

### Task 4.8 Document results in the PR body

- [ ] **Step 13: Fill in the PR body checklist**

When opening the PR, the description should include a filled-in copy of the spec's Validation section: a checkbox per step (1-7) with a one-line result. Example:

```markdown
## Validation results

- [x] Cold install download: q4 (~1.34 GB) downloaded in <60s on cable, persists across reload.
- [x] Auto-selection: HY-MT1.5 selected over TranslateGemma on fresh state.
- [x] Translation smoke test (high-resource): zh→en, ja→en, en→fr, ko→en all clean.
- [x] Translation smoke test (low-resource): km→en, my→en, bo→zh, mn→en acceptable.
- [x] Latency (ja→en, ~30 chars, q4): 980 ms first call, 420 ms warm.
- [x] q4f16 regression: tested on RTX 4060 / Windows — clean. (or: [ ] disabled — see PR commit `<sha>`.)
- [x] Provider switching: HY-MT ↔ Qwen3 ↔ HY-MT, GPU memory recovers within ~150 MB.
```

---

## Final task: open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Open PR via gh**

```bash
gh pr create --title "feat: add HY-MT1.5-1.8B WebGPU translation engine (#233)" --body "$(cat <<'EOF'
## Summary
- Integrates Tencent **HY-MT1.5-1.8B** (translation-specialized hunyuan_v1_dense LLM) via `onnx-community/HY-MT1.5-1.8B-ONNX` and `@huggingface/transformers` `pipeline('text-generation', ...)`.
- New `translationWorkerType: 'hy-mt'` routes to a slim worker (`hy-mt-translation.worker.ts`) that uses the model card's user-only prompt template verbatim.
- Promotes HY-MT to default-recommended local translation model: `sortOrder: 1, recommended: true`. Demotes TranslateGemma to `sortOrder: 2`, Qwen3-0.6B to `sortOrder: 3`.

## Design / Plan
- Spec: `docs/superpowers/specs/2026-05-16-hy-mt15-translation-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-hy-mt15-translation.md`

## Validation results
<paste the filled-in checklist from Task 4.8 here>

Closes #233
EOF
)"
```

Expected: PR URL printed.

---

## Risks and rollback

If post-merge issues surface in the field:

- **transformers.js hunyuan_v1_dense regression**: pin or bump `@huggingface/transformers` in `package.json`; if irrecoverable, revert this branch and reopen #233.
- **Quota / OOM reports**: no rollback needed — users can pick a smaller model (Qwen3-0.6B at sortOrder 3 still recommended); add a tooltip warning in a follow-up.
- **Quality regression on a specific pair**: users can manually switch to TranslateGemma (`sortOrder: 2`); investigate and either tune the prompt template or downgrade HY-MT's `recommended` flag in a follow-up.

Revert procedure: `git revert <commit-range>` on the four feature commits (manifest, worker, engine, optional q4f16 disable). No data migration needed — downloaded HY-MT files in users' IndexedDB simply become unreferenced and are reclaimed on the next model-manager prune.
