# HY-MT1.5-1.8B WebGPU Translation Engine Integration

**Issue**: kizuna-ai-lab/sokuji#233
**Date**: 2026-05-16
**Status**: Design

## Summary

Add Tencent **HY-MT1.5-1.8B** (Hunyuan Machine Translation 1.5) as a new local
translation option in Sokuji's WebGPU pipeline, sourced from
`onnx-community/HY-MT1.5-1.8B-ONNX`. The model is a translation-specialized LLM
(WMT25 championship lineage) covering 36 languages from a single checkpoint,
including low-resource targets relevant to Sokuji's audience (Khmer, Burmese,
Tibetan, Mongolian, Uyghur, Kazakh, Cantonese-adjacent).

After this change HY-MT1.5 becomes the **default-recommended multilingual local
translation model**, ahead of TranslateGemma-4B (which it beats on both size
and language coverage for our use case).

## Goals

- Integrate HY-MT1.5-1.8B as a peer of the existing Qwen / TranslateGemma local
  translation models with zero changes to the shared `ModelManager`, `modelStore`,
  or UI layers.
- Ship two variants — `q4` (~1.34 GB) and `q4f16` (~1.17 GB, gated by
  `shader-f16` feature) — matching the Qwen3 / Qwen3.5 precedent.
- Use `pipeline('text-generation', ...)` to match the official `onnx-community`
  model card example and stay consistent with the `qwen-translation` /
  `translategemma-translation` workers.
- Promote HY-MT1.5 to `sortOrder: 1, recommended: true` so it is auto-selected
  over TranslateGemma for new users (migrate TranslateGemma to `sortOrder: 2`
  and Qwen3 0.6B to `sortOrder: 3`).

## Non-Goals

- **Phase-1 proto page**: skipped. We have three precedent LLM-translation
  workers (`qwen`, `qwen35`, `translategemma`) and a matching `model card`
  example. Going straight to a manifest-driven integration is cheaper than
  building and then discarding a dev-only proto UI.
- **HY-MT1.5-7B**: ~5 GB+ ONNX q4 footprint exceeds typical browser IndexedDB
  quotas; revisit if/when usage warrants.
- **1.25-bit STQ1_0 variant**: no ONNX export exists today (see issue #233
  comment, 2026-05-14 update). Track upstream; not in scope here.
- **Self-hosted CDN mirroring** (jiangzhuo9357/* HF dataset): not needed since
  we load directly from `onnx-community/HY-MT1.5-1.8B-ONNX`. This avoids
  engaging the Tencent Hunyuan Community License redistribution question.
- **Streaming translation output**: current `TranslationEngine` ↔ worker
  protocol is single-shot `result`. Adding `translation_chunk` events is a
  separate scope.
- **CJK filler / native-name prompting** (the `prompts.ts` machinery used by
  Qwen workers): HY-MT is translation-specialized; over-prompting is a quality
  risk, not a benefit.

## Background

### Model

- Base: `tencent/HY-MT1.5-1.8B`, architecture `hunyuan_v1_dense`
- ONNX repo: [`onnx-community/HY-MT1.5-1.8B-ONNX`](https://huggingface.co/onnx-community/HY-MT1.5-1.8B-ONNX)
- 36 supported languages (per ONNX repo README): zh, en, fr, pt, es, ja, tr,
  ru, ar, ko, th, it, de, vi, ms, id, tl, hi, pl, cs, nl, km, my, fa, gu, ur,
  te, mr, he, bn, ta, uk, bo, kk, mn, ug
- ONNX file footprint (from
  `https://huggingface.co/api/models/onnx-community/HY-MT1.5-1.8B-ONNX/tree/main/onnx`):

  | Variant | `model_*.onnx` | `model_*.onnx_data` | Total weights |
  |---|---:|---:|---:|
  | fp32 | 0.3 MB | 4 shards, ~6.79 GB | ~6.79 GB *(skipped)* |
  | fp16 | 0.3 MB | 2 shards, ~3.40 GB | ~3.40 GB *(skipped)* |
  | **q4** | 0.4 MB | 1.34 GB | **~1.34 GB** |
  | **q4f16** | 0.4 MB | 1.17 GB | **~1.17 GB** (needs `shader-f16`) |

  Shared overhead per variant: `chat_template.jinja` (654 B), `config.json`
  (1.64 KB), `generation_config.json` (255 B), `tokenizer.json` (8.67 MB),
  `tokenizer_config.json` (1.17 KB) — ~8.68 MB total.

### Chat template

The repo ships `chat_template.jinja` with Hunyuan-specific special tokens
(`<｜hy_begin▁of▁sentence｜>`, `<｜hy_User｜>`, `<｜hy_Assistant｜>`).
`pipeline('text-generation', ...)` applies the template automatically via the
tokenizer; the worker does not hand-roll prompt formatting.

### Official inference example (from model card)

```js
import { pipeline } from "@huggingface/transformers";
const generator = await pipeline("text-generation",
  "onnx-community/HY-MT1.5-1.8B-ONNX",
  { dtype: "q4", device: "webgpu" });

const messages = [{
  role: "user",
  content: `Translate the following segment into ${targetLang}, without additional explanation.\n\n${text}`,
}];
const output = await generator(messages, { max_new_tokens: 512, do_sample: false });
```

User role only — no system message. This is the contract we replicate.

### transformers.js support

Verified at `node_modules/@huggingface/transformers@4.2.0`:

- `src/models/hunyuan_v1_dense/modeling_hunyuan_v1_dense.js` exports
  `HunYuanDenseV1ForCausalLM`.
- `src/models/registry.js:328` registers
  `['hunyuan_v1_dense', 'HunYuanDenseV1ForCausalLM']` in
  `MODEL_FOR_CAUSAL_LM_MAPPING_NAMES`, so `AutoModelForCausalLM` /
  `pipeline('text-generation', ...)` auto-routes by `config.json.model_type`.

The worker therefore does not need to import any model class directly.

## Architecture

### Data flow

Identical to the Qwen3-0.6B / TranslateGemma path:

```text
ModelManagementSection.tsx ─ user clicks Download ─▶
  modelStore.downloadModel('hy-mt15-1.8b-translation')
    ─▶ ModelManager.downloadModel
        ─▶ for each file in selected variant:
             fetch  https://huggingface.co/onnx-community/HY-MT1.5-1.8B-ONNX/resolve/main/<file>
             write  IndexedDB(sokuji-models / files)

At translate time:
  TranslationEngine.init(modelId='hy-mt15-1.8b-translation')
    ─▶ load files from IndexedDB → blob URL map
    ─▶ switch(translationWorkerType) case 'hy-mt':
         new Worker(hy-mt-translation.worker.ts, { type: 'module' })
    ─▶ postMessage({ type: 'init', hfModelId, fileUrls, dtype, ... })

In the worker:
  env.useCustomCache = true; env.customCache = blobUrlCache(fileUrls)
  generator = await pipeline('text-generation', hfModelId,
                             { dtype, device: 'webgpu' })
  postMessage({ type: 'ready', loadTimeMs, device: 'webgpu' })

  on 'translate' message:
    messages = [{ role:'user', content: `Translate the following segment into ${targetName}, without additional explanation.\n\n${text}` }]
    result = await generator(messages, { max_new_tokens: 512, do_sample: false })
    translated = result[0].generated_text.at(-1).content.trim()
    postMessage({ type: 'result', id, sourceText, translatedText, inferenceTimeMs, systemPrompt })
```

### File-by-file change surface

| File | Change |
|---|---|
| `src/lib/local-inference/workers/hy-mt-translation.worker.ts` | **NEW** (~140 lines) |
| `src/lib/local-inference/modelManifest.ts` | Add manifest entry + two file-list builders; demote translategemma/qwen3 sortOrder; extend `translationWorkerType` union |
| `src/lib/local-inference/engine/TranslationEngine.ts` | Add `case 'hy-mt'` worker construction branch |

Explicit no-op layers:

- `src/lib/local-inference/ModelManager.ts` — `hfModelId` download path is
  already generic.
- `src/lib/local-inference/modelStorage.ts` — schema unchanged.
- `src/lib/local-inference/types.ts` — existing `init` / `translate` /
  `dispose` message shapes cover HY-MT.
- `src/stores/modelStore.ts` — `isProviderReady`, `pickBestModel`,
  `getTranslationModel` already read from the manifest.
- `src/components/.../ModelManagementSection.tsx` — renders directly from the
  manifest; new entry appears automatically.
- `src/lib/local-inference/prompts.ts` and `prompts.test.ts` — HY-MT keeps its
  prompt inside the worker; no shared changes.
- `src/stores/settingsStore.ts` — translation provider selection unchanged.

## Detailed Design

### Manifest entry (`modelManifest.ts`)

Add two file-list builders alongside the existing per-model helpers:

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

Extend the union type:

```ts
translationWorkerType?: 'opus-mt' | 'qwen' | 'qwen35' | 'translategemma' | 'bing' | 'hy-mt';
```

Add the entry (placed before the existing `translategemma-4b-translation`
block so source-order matches sortOrder intent):

```ts
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
```

### sortOrder migration

| Model id | Current `sortOrder` | New `sortOrder` |
|---|---:|---:|
| `hy-mt15-1.8b-translation` *(new)* | — | **1** |
| `translategemma-4b-translation` | 1 | **2** |
| `qwen3-0.6b-translation` | 2 | **3** |
| `bing-translator` | 2 | 2 *(online tier; unaffected by local sort)* |
| Other Qwen3.5 / Opus-MT entries | unchanged | unchanged |

Auto-selection (`modelStore.getTranslationModel`) prefers
`recommended === true` then ascending `sortOrder`, so on a freshly installed
client with no prior choice HY-MT1.5 is picked first when the user has
downloaded it.

### Worker (`hy-mt-translation.worker.ts`)

Template-of-record is `qwen-translation.worker.ts` (slim, single-shot,
pipeline-based). Diff is essentially:

1. Drop `buildDefaultLocalPrompt` import — no shared prompt machinery.
2. Drop the `/no_think` / Qwen3-specific branch.
3. Drop `wrapTranscript` handling — model card does not use `<transcript>`
   tags; the user message is the raw segment.
4. Replace the system+user message pair with a single user message using the
   model-card template.
5. Bump `max_new_tokens` from 256 → 512 to match the model-card example
   (translation segments in real-time subtitling rarely exceed this, but the
   official example uses 512).
6. Drop the `<think>...</think>` stripping post-process.
7. Inline a `LANG_NAMES` table covering all 36 supported codes.

Sketch:

```ts
import { pipeline, env } from '@huggingface/transformers';

if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese', en: 'English', fr: 'French', pt: 'Portuguese', es: 'Spanish',
  ja: 'Japanese', tr: 'Turkish', ru: 'Russian', ar: 'Arabic', ko: 'Korean',
  th: 'Thai', it: 'Italian', de: 'German', vi: 'Vietnamese', ms: 'Malay',
  id: 'Indonesian', tl: 'Filipino', hi: 'Hindi', pl: 'Polish', cs: 'Czech',
  nl: 'Dutch', km: 'Khmer', my: 'Burmese', fa: 'Persian', gu: 'Gujarati',
  ur: 'Urdu', te: 'Telugu', mr: 'Marathi', he: 'Hebrew', bn: 'Bengali',
  ta: 'Tamil', uk: 'Ukrainian', bo: 'Tibetan', kk: 'Kazakh', mn: 'Mongolian',
  ug: 'Uyghur',
};

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
  systemPrompt: string;   // ignored — HY-MT uses user-only template
  wrapTranscript: boolean;// ignored — model card uses raw segment
}
interface DisposeMessage { type: 'dispose' }
type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let generator: any = null;

function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(req: string | Request | undefined): Promise<Response | undefined> {
      if (!req) return undefined;
      const url = typeof req === 'string' ? req : req.url;
      const marker = '/resolve/main/';
      const idx = url.indexOf(marker);
      if (idx === -1) return undefined;
      const blobUrl = fileUrls[url.slice(idx + marker.length)];
      return blobUrl ? fetch(blobUrl) : undefined;
    },
    async put() {},
  };
}

async function handleInit(msg: InitMessage) {
  try {
    const t0 = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. HY-MT translation requires WebGPU.' });
      return;
    }
    if (!(await gpu.requestAdapter())) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. HY-MT translation requires WebGPU.' });
      return;
    }

    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    generator = await (pipeline as any)('text-generation', msg.hfModelId, {
      dtype: msg.dtype || 'q4',
      device: 'webgpu',
    });

    self.postMessage({
      type: 'ready',
      modelId: msg.hfModelId,
      loadTimeMs: Math.round(performance.now() - t0),
      device: 'webgpu',
    });
  } catch (e: any) {
    self.postMessage({ type: 'error', error: e.message || String(e) });
  }
}

async function handleTranslate(msg: TranslateMessage) {
  if (!generator) {
    self.postMessage({ type: 'error', id: msg.id, error: 'HY-MT model not loaded' });
    return;
  }
  try {
    const t0 = performance.now();
    const targetName = LANG_NAMES[msg.targetLang] ?? msg.targetLang;
    const userPrompt =
      `Translate the following segment into ${targetName}, without additional explanation.\n\n${msg.text}`;

    const result = await generator(
      [{ role: 'user', content: userPrompt }],
      { max_new_tokens: 512, do_sample: false },
    );

    let translated = '';
    if (Array.isArray(result) && result[0]?.generated_text) {
      const gen = (result[0] as any).generated_text;
      translated = Array.isArray(gen) ? (gen.at(-1)?.content ?? '') : String(gen);
    }
    translated = translated.trim();

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText: translated,
      inferenceTimeMs: Math.round(performance.now() - t0),
      systemPrompt: userPrompt,
    });
  } catch (e: any) {
    self.postMessage({ type: 'error', id: msg.id, error: e.message || String(e) });
  }
}

async function handleDispose() {
  if (generator) {
    await generator?.dispose?.();
    generator = null;
  }
  self.postMessage({ type: 'disposed' });
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  switch (e.data.type) {
    case 'init':      await handleInit(e.data); break;
    case 'translate': await handleTranslate(e.data); break;
    case 'dispose':   await handleDispose(); break;
  }
};
```

### TranslationEngine routing (`TranslationEngine.ts`)

Add one case to the `switch (workerType)` block (after the existing
`translategemma` branch, ~line 119):

```ts
case 'hy-mt':
  this.worker = new Worker(
    new URL('../workers/hy-mt-translation.worker.ts', import.meta.url),
    { type: 'module' },
  );
  break;
```

No change to `init` / `translate` / `dispose` message payloads — the engine
sends `systemPrompt` and `wrapTranscript` as it does for TranslateGemma, and
the HY-MT worker simply ignores them.

### Language map

The worker's internal `LANG_NAMES` table is the authoritative
`BCP-47 → English` mapping for HY-MT's prompt template. It mirrors
`manifest.languages` one-for-one. We deliberately do not extend the shared
`LANG_NAMES` / `NATIVE_NAMES` / `LANG_FILLERS` tables in `prompts.ts`, since
HY-MT does not consume `buildDefaultLocalPrompt`.

If a future Sokuji feature (UI language picker, log labels) needs English
names for the low-resource codes (`km`, `my`, `bo`, `kk`, `mn`, `ug`), that
extension should live in its own dedicated table — not piggyback on a worker
file.

### Error handling

| Failure | Detected at | Surface |
|---|---|---|
| WebGPU unavailable | worker init | `error` message; engine rejects `init` Promise |
| No GPU adapter | worker init | same as above |
| Model files missing in IndexedDB | engine `init` (pre-worker) | `ModelManager` throws; surfaces in store as `error` status |
| `shader-f16` missing on q4f16 device | `ModelManager` variant selection | variant filtered before download; user picks q4 instead |
| OOM / pipeline init failure | worker init `try/catch` | `error` message |
| Generate-time exception | worker translate `try/catch` | `error` message with request `id`; engine rejects translate Promise |
| Worker crash | engine `worker.onerror` | engine onError callback; existing pattern |

KV-cache dtype is declared by the ONNX repo's `config.json`:

```json
"transformers.js_config": {
  "kv_cache_dtype": { "q4f16": "float16", "fp16": "float16" }
}
```

`@huggingface/transformers` ≥4.x reads this automatically; no worker-side
override required.

## Implementation Plan (preview)

This section is intentionally a sketch; the formal implementation plan lives
in a follow-up writing-plans document.

1. Add manifest builders + entry + sortOrder migration in `modelManifest.ts`.
2. Add `'hy-mt'` to the `translationWorkerType` union.
3. Create `hy-mt-translation.worker.ts` from `qwen-translation.worker.ts`,
   apply the seven diffs listed above.
4. Add `case 'hy-mt'` branch in `TranslationEngine.ts`.
5. Manual validation pass (see "Validation").

## Validation

These checks gate the PR:

1. **Cold install download**: in Chrome (WebGPU), Settings → Model Management →
   Download `Hunyuan MT 1.5 1.8B`. Confirm q4 (~1.34 GB) writes to IndexedDB
   and survives page reload (no re-download).
2. **Auto-selection**: after fresh install with HY-MT downloaded and Whisper
   ASR downloaded, the Translation provider auto-picks HY-MT (above
   TranslateGemma in sortOrder).
3. **Translation smoke test** — submit 3-5 segments per pair:
   - High-resource: `zh↔en`, `ja↔en`, `en↔fr`, `ko↔en`
   - Low-resource: `km→en`, `my→en`, `bo→zh`, `mn→en`
   - For each pair: output is in the expected target language, no echoed
     prompt, no `<think>` tags, no obvious explanation bleed.
4. **Latency baseline**: log `inferenceTimeMs` for a 50-character `ja→en`
   segment on q4 and q4f16 (where supported). Note in PR description; no
   hard threshold but should be within ~2× of `qwen3-0.6b-translation`.
5. **q4f16 garbage-token regression** (`shader-f16` capable Windows device):
   run ≥10 segments across CJK + Romance pairs; confirm no `<unused…>`,
   `▁▁▁`, or other tokenization-failure artifacts. If reproduced, disable the
   `q4f16` variant in the manifest with a NOTE comment mirroring the existing
   TranslateGemma guard.
6. **Provider switching**: switch translation provider HY-MT ↔ Qwen3 ↔ HY-MT
   in the UI without page reload. GPU memory in DevTools → Memory tab returns
   to baseline after dispose (delta within noise).
7. **Sort-order regression**: verify TranslateGemma and Qwen3-0.6B still
   appear in the list with their new sortOrder (2, 3) and downloads still
   function.

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `hunyuan_v1_dense` codepath in `@huggingface/transformers@4.2.0` has a bug we surface (registered class but no unit-test coverage visible upstream) | Low–Medium | Validate in step 3 of Validation. If broken, bump to next transformers.js patch in `package.json`; if still broken, write a focused upstream repro and fall back to deferring this issue |
| `q4f16` reproduces the TranslateGemma Windows garbage-token bug | Medium | Step 5 of Validation gates the variant; remove from manifest with NOTE if it triggers |
| 1.34 GB exceeds user's IndexedDB quota | Low–Medium | `ModelManager` already surfaces quota errors via `modelStore`; user can clear cache or pick a smaller model. Document on the Model Management UI tooltip if needed |
| HF Hub CDN cold pull is slow on first install | Inevitable | Standard; mirror to our HF dataset only if user feedback demands it |
| Translation quality lags TranslateGemma on a specific pair | Low (purpose-built model, WMT25 lineage) | Users can still pick TranslateGemma manually (it stays at `sortOrder: 2`) |

## Open Questions

None blocking. Deferred to validation:

- Empirical q4 vs q4f16 quality and latency comparison.
- Whether to add a one-line user-visible blurb under the model name in
  `ModelManagementSection` explaining "translation-specialized; recommended
  for multilingual real-time subtitles".

## References

- Issue: kizuna-ai-lab/sokuji#233
- Base model card: <https://huggingface.co/tencent/HY-MT1.5-1.8B>
- ONNX repo: <https://huggingface.co/onnx-community/HY-MT1.5-1.8B-ONNX>
- ONNX tree API:
  `https://huggingface.co/api/models/onnx-community/HY-MT1.5-1.8B-ONNX/tree/main/onnx`
- transformers.js source (installed): `node_modules/@huggingface/transformers/src/models/hunyuan_v1_dense/`
- transformers.js registry: `node_modules/@huggingface/transformers/src/models/registry.js:328`
- Existing precedents in this repo:
  - `src/lib/local-inference/workers/qwen-translation.worker.ts`
  - `src/lib/local-inference/workers/translategemma-translation.worker.ts`
  - `docs/superpowers/specs/2026-03-20-translategemma-4b-design.md`
