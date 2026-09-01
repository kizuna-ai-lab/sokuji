# Qwen3-ASR-0.6B WebGPU worker in LOCAL_INFERENCE (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Qwen3-ASR-0.6B as a selectable WebGPU ASR model in the `LOCAL_INFERENCE` provider (Electron renderer and extension), using the layout-v2 artifacts from PR 1.

**Architecture:** A new module worker `qwen3-asr-webgpu.worker.ts` reuses the Granite worker's VAD/message scaffold but drives onnxruntime-web sessions directly (no transformers.js model class exists): host-built prefill embeddings from an int8 table, GPU-resident KV cache, greedy decode, prefix forcing from the selected source language. Pure logic (prompt ids, audio-token count, log-mel, BPE decode) lives in `_shared/` modules with unit tests. The manifest row declares `q4` and `q4f16` variants; the existing `selectVariant`/`requiredFeatures` machinery picks by `shader-f16`.

**Tech Stack:** TypeScript, Vite module workers, onnxruntime-web 1.26.0-dev (`./_shared/onnxruntime-all`), `@ricky0123/vad-web` FrameProcessor + Silero v5 (as in the Granite worker), vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-09-02-qwen3-asr-webgpu-spike.md` (Productization plan steps 2–4) and PR 1's `prompt_config.json` contract (`docs/superpowers/plans/2026-09-02-qwen3-asr-onnx-layout-v2.md`, Task 6).

## Global Constraints

- No `console.error` / `console.warn` in new `src/lib` files (the console ledger test would need a row); report through `post({ type: 'status' | 'error' })`.
- `harness-consolidation.test.ts` rules for ASR workers: assign `ortEnv.wasm.wasmPaths` **before** `await initVad(`, define `handleFlush()` and route `'flush'` to it.
- The worker must not import `@huggingface/transformers` (keeps it out of the shared transformers chunk and out of `TRANSFORMERS_WORKERS`).
- Manifest byte sizes must equal the Hub's `files_metadata` sizes (`benchmark/qwen3-asr-webgpu/results/v2-hub-files.json`).
- `requiredDevice: 'webgpu'`; `q4f16` variant `requiredFeatures: ['shader-f16']`; `q4` variant `requiredFeatures: []`.
- English-only comments, Conventional Commits, TDD (test first). Branch: `feat/qwen3-asr-webgpu-worker` off `main` after PR 1 merges (or off PR 1's branch if it has not).
- Never push to `main`; opening the PR needs jiangzhuo's explicit OK.

---

### Task 1: Prompt and token helpers (`_shared/qwen3-asr-prompt.ts`)

**Files:**
- Create: `src/lib/local-inference/workers/_shared/qwen3-asr-prompt.ts`
- Test: `src/lib/local-inference/workers/_shared/qwen3-asr-prompt.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Qwen3AsrPromptConfig {
    layout_version: number;
    prompt: { prefix_ids: number[]; suffix_ids: number[]; audio_pad_id: number; asr_text_id: number; eos_ids: number[]; max_new_tokens: number };
    language_prefix_ids: Record<string, number[]>;
    audio_tokens: { conv_window: number; tokens_per_window: number };
    embedding: { file: string; dtype: 'int8' | 'float16' | 'float32'; shape: [number, number]; scales_file?: string };
    decoder: { num_layers: number; num_key_value_heads: number; head_dim: number; hidden_size: number; vocab_size: number };
    variants: Record<string, { encoder: string; decoder_init: string; decoder_step: string; weights: string; required_features: string[] }>;
  }
  export function audioTokenCount(melFrames: number, cfg: Qwen3AsrPromptConfig['audio_tokens']): number;
  export function buildPromptIds(nAudio: number, cfg: Qwen3AsrPromptConfig, forceLang?: string): { ids: number[]; audioStart: number; forced: boolean };
  export function splitGenerated(ids: number[], cfg: Qwen3AsrPromptConfig): { prefixIds: number[]; textIds: number[]; detectedPrefix: boolean };
  export function normalizeLangForPrefix(lang: string | undefined, cfg: Qwen3AsrPromptConfig): string | undefined; // 'ja-JP' -> 'ja', 'cantonese' -> 'yue', unknown/auto -> undefined
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { audioTokenCount, buildPromptIds, normalizeLangForPrefix, splitGenerated, type Qwen3AsrPromptConfig } from './qwen3-asr-prompt';

const cfg: Qwen3AsrPromptConfig = {
  layout_version: 2,
  prompt: { prefix_ids: [151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669], suffix_ids: [151670, 151645, 198, 151644, 77091, 198], audio_pad_id: 151676, asr_text_id: 151704, eos_ids: [151643, 151645], max_new_tokens: 256 },
  language_prefix_ids: { ja: [11528, 10769, 151704], zh: [11528, 8453, 151704] },
  audio_tokens: { conv_window: 100, tokens_per_window: 13 },
  embedding: { file: 'embed_tokens.int8.bin', dtype: 'int8', shape: [151936, 1024], scales_file: 'embed_scales.f32.bin' },
  decoder: { num_layers: 28, num_key_value_heads: 8, head_dim: 128, hidden_size: 1024, vocab_size: 151936 },
  variants: {},
};

describe('audioTokenCount', () => {
  it('matches the pipeline formula: conv thrice on the remainder plus 13 per 100 frames', () => {
    expect(audioTokenCount(1100, cfg.audio_tokens)).toBe(143); // jfk.wav: 11 windows
    expect(audioTokenCount(1, cfg.audio_tokens)).toBe(1);
    expect(audioTokenCount(100, cfg.audio_tokens)).toBe(13);
    expect(audioTokenCount(150, cfg.audio_tokens)).toBe(13 + 7); // conv(50)=25, conv(25)=13, conv(13)=7
  });
});

describe('buildPromptIds', () => {
  it('lays out prefix, N audio pads, suffix and reports where the pads start', () => {
    const { ids, audioStart, forced } = buildPromptIds(3, cfg);
    expect(ids).toEqual([...cfg.prompt.prefix_ids, 151676, 151676, 151676, ...cfg.prompt.suffix_ids]);
    expect(audioStart).toBe(9);
    expect(forced).toBe(false);
  });
  it('appends the language prefix when forcing a known language', () => {
    const { ids, forced } = buildPromptIds(1, cfg, 'ja');
    expect(ids.slice(-3)).toEqual([11528, 10769, 151704]);
    expect(forced).toBe(true);
  });
  it('does not force an unknown language', () => {
    expect(buildPromptIds(1, cfg, 'xx').forced).toBe(false);
  });
});

describe('splitGenerated', () => {
  it('cuts at <asr_text> and drops eos', () => {
    expect(splitGenerated([11528, 10769, 151704, 5, 6, 151645], cfg)).toEqual({ prefixIds: [11528, 10769], textIds: [5, 6], detectedPrefix: true });
  });
  it('treats everything as text when the model skipped the prefix (forced or collapsed)', () => {
    expect(splitGenerated([5, 6, 151643], cfg)).toEqual({ prefixIds: [], textIds: [5, 6], detectedPrefix: false });
  });
});

describe('normalizeLangForPrefix', () => {
  it('maps app language codes onto the prefix table', () => {
    expect(normalizeLangForPrefix('ja', cfg)).toBe('ja');
    expect(normalizeLangForPrefix('ja-JP', cfg)).toBe('ja');
    expect(normalizeLangForPrefix('zh-CN', cfg)).toBe('zh');
    expect(normalizeLangForPrefix('auto', cfg)).toBeUndefined();
    expect(normalizeLangForPrefix(undefined, cfg)).toBeUndefined();
    expect(normalizeLangForPrefix('cantonese', { ...cfg, language_prefix_ids: { yue: [1] } })).toBe('yue');
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/lib/local-inference/workers/_shared/qwen3-asr-prompt.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** Prompt construction and output splitting for Qwen3-ASR (layout v2, see prompt_config.json). */
export interface Qwen3AsrPromptConfig { /* as in Interfaces */ }

const convOut = (t: number) => Math.floor((t + 1) / 2);

export function audioTokenCount(melFrames: number, a: Qwen3AsrPromptConfig['audio_tokens']): number {
  const leave = melFrames % a.conv_window;
  const t = convOut(convOut(convOut(leave)));
  return t + Math.floor(melFrames / a.conv_window) * a.tokens_per_window;
}

export function buildPromptIds(nAudio: number, cfg: Qwen3AsrPromptConfig, forceLang?: string) {
  const p = cfg.prompt;
  const ids = [...p.prefix_ids];
  const audioStart = ids.length;
  for (let i = 0; i < nAudio; i++) ids.push(p.audio_pad_id);
  ids.push(...p.suffix_ids);
  const forcedIds = forceLang ? cfg.language_prefix_ids[forceLang] : undefined;
  if (forcedIds) ids.push(...forcedIds);
  return { ids, audioStart, forced: Boolean(forcedIds) };
}

export function splitGenerated(ids: number[], cfg: Qwen3AsrPromptConfig) {
  const eos = new Set(cfg.prompt.eos_ids);
  const body = ids.filter((id) => !eos.has(id));
  const cut = body.indexOf(cfg.prompt.asr_text_id);
  if (cut < 0) return { prefixIds: [], textIds: body, detectedPrefix: false };
  return { prefixIds: body.slice(0, cut), textIds: body.slice(cut + 1), detectedPrefix: true };
}

const ALIASES: Record<string, string> = { cantonese: 'yue', tl: 'fil', jap: 'ja' };

export function normalizeLangForPrefix(lang: string | undefined, cfg: Qwen3AsrPromptConfig): string | undefined {
  if (!lang || lang === 'auto') return undefined;
  const lower = lang.toLowerCase();
  const primary = (ALIASES[lower] ?? lower).split(/[-_]/)[0];
  return primary in cfg.language_prefix_ids ? primary : undefined;
}
```

- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/local-inference/workers/_shared/qwen3-asr-prompt.ts src/lib/local-inference/workers/_shared/qwen3-asr-prompt.test.ts && git commit -m "feat(local-inference): Qwen3-ASR prompt helpers (audio token count, prefix forcing, output split)"`

---

### Task 2: Log-mel front end (`_shared/log-mel.ts`)

**Files:**
- Create: `src/lib/local-inference/workers/_shared/log-mel.ts` (port of `benchmark/qwen3-asr-webgpu/www/mel.js`, filterbank passed in)
- Create: `src/lib/local-inference/workers/_shared/log-mel.fixture.json` (generated once: 4000-sample chirp at 16 kHz + 24 expected `(mel, frame, value)` triples from the Python `log_mel_spectrogram`, plus the 128×201 filterbank is NOT embedded — the test uses a 4-filter toy bank for shape/normalization and the fixture for numerics with the real bank loaded from `public/`? No: keep the test self-contained — the fixture includes the 24 reference values computed **with the toy 4-filter bank**, generated by a tiny Python snippet in the fixture's `_generator` field)
- Test: `src/lib/local-inference/workers/_shared/log-mel.test.ts`

**Interfaces:**
- Produces: `export function logMel(audio: Float32Array, filters: { n_mels: number; n_freqs: number; data: number[][] }): { data: Float32Array; nMels: number; T: number }` — data laid out `[nMels][T]`, identical semantics to `mel.js`.

- [ ] **Step 1: Generate the fixture** with the spike venv (run once, commit the JSON):

```python
import json, numpy as np, torch
sr, n = 16000, 4000
t = np.arange(n) / sr; audio = (0.5 * np.sin(2 * np.pi * (200 + 1500 * t) * t)).astype(np.float32)
fb = np.zeros((4, 201), dtype=np.float32); fb[0, 1:5] = 0.25; fb[1, 5:20] = 1 / 15; fb[2, 20:60] = 1 / 40; fb[3, 60:201] = 1 / 141
x = torch.from_numpy(audio); st = torch.stft(x, 400, 160, window=torch.hann_window(400), return_complex=True); p = st.abs() ** 2
m = torch.from_numpy(fb) @ p; l = torch.clamp(m, min=1e-10).log10(); l = torch.maximum(l, l.max() - 8); l = (l + 4) / 4; l = l[:, :-1]
pts = [(mi, ti, float(l[mi, ti])) for mi in range(4) for ti in (0, 1, 7, 12, 24, 25)]
json.dump({"audio": audio.tolist(), "filters": {"n_mels": 4, "n_freqs": 201, "data": fb.tolist()}, "T": int(l.shape[1]), "points": pts}, open("log-mel.fixture.json", "w"))
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import fixture from './log-mel.fixture.json';
import { logMel } from './log-mel';

describe('logMel', () => {
  const out = logMel(Float32Array.from(fixture.audio as number[]), fixture.filters as { n_mels: number; n_freqs: number; data: number[][] });
  it('produces floor(len/hop) frames (last STFT frame dropped)', () => {
    expect(out.T).toBe(fixture.T);
    expect(out.T).toBe(Math.floor(4000 / 160));
  });
  it('matches torch.stft + log10 + dynamic-range clamp + (x+4)/4 within 1e-4', () => {
    for (const [m, t, v] of fixture.points as [number, number, number][]) {
      expect(out.data[m * out.T + t]).toBeCloseTo(v, 4);
    }
  });
});
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Port `mel.js`** to TypeScript unchanged in logic (DFT tables cached at module scope; reflect padding; periodic Hann). **Step 5: Run** → PASS. **Step 6: Commit** — `git commit -m "feat(local-inference): Whisper-style log-mel front end for raw-ORT ASR workers"`

---

### Task 3: BPE decoder (`_shared/bpe-decoder.ts`)

**Files:**
- Create: `src/lib/local-inference/workers/_shared/bpe-decoder.ts` (port of `www/tokenizer.js`; takes a parsed `tokenizer.json` object)
- Test: `src/lib/local-inference/workers/_shared/bpe-decoder.test.ts`

**Interfaces:**
- Produces: `export function createBpeDecoder(tokenizerJson: { model: { vocab: Record<string, number> }; added_tokens?: { id: number; content: string }[] }): { decode(ids: number[], opts?: { skipSpecial?: boolean }): string }`

- [ ] **Step 1: Write the failing test** with a hand-made vocab (byte-level strings built with the GPT-2 byte→unicode map: `'Ġ'` = space, `'ä¸ĸ'` = the three UTF-8 bytes of 世):

```ts
import { describe, expect, it } from 'vitest';
import { createBpeDecoder } from './bpe-decoder';

const tok = { model: { vocab: { 'Hello': 0, 'Ġworld': 1, 'ä¸ĸ': 2, 'çķĮ': 3, 'ä¸': 4, 'ĸ': 5 } }, added_tokens: [{ id: 9, content: '<|im_end|>' }] };

describe('createBpeDecoder', () => {
  const d = createBpeDecoder(tok);
  it('decodes ASCII with the Ġ space marker', () => { expect(d.decode([0, 1])).toBe('Hello world'); });
  it('reassembles multi-byte UTF-8 across tokens', () => { expect(d.decode([2, 3])).toBe('世界'); expect(d.decode([4, 5, 3])).toBe('世界'); });
  it('skips special tokens by default and can keep them', () => {
    expect(d.decode([0, 9])).toBe('Hello');
    expect(d.decode([0, 9], { skipSpecial: false })).toBe('Hello<|im_end|>');
  });
  it('flushes bytes around an unknown id instead of throwing', () => { expect(d.decode([2, 12345, 3])).toContain('<unk:12345>'); });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Port `tokenizer.js`** (the `bytesToUnicode` table, id→token array, byte accumulation with `TextDecoder`). **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "feat(local-inference): byte-level BPE decoder for tokenizer.json vocabularies"`

---

### Task 4: The worker

**Files:**
- Create: `src/lib/local-inference/workers/qwen3-asr-webgpu.worker.ts`
- Modify: `src/lib/local-inference/types.ts` — add `export type Qwen3AsrInitMessage = WhisperAsrInitMessage;` next to `WhisperAsrInitMessage` (same fields: `fileUrls`, `hfModelId`, `language`, `vadConfig`, `dtype`, `ortWasmBaseUrl`, `vadModelUrl`) and extend the `asrWorkerType` union in `modelManifest.ts`'s `ModelManifestEntry` with `'qwen3-asr-webgpu'`
- Modify: `src/lib/local-inference/workers/_shared/harness-consolidation.test.ts:42-48` — add `'qwen3-asr-webgpu.worker.ts'` to `ASR_WORKERS`
- Test: the harness test (structural) + `src/lib/local-inference/workers/qwen3-asr-decode.test.ts` for the pure decode-loop driver below

**Interfaces:**
- Consumes: `logMel`, `createBpeDecoder`, `buildPromptIds`, `audioTokenCount`, `splitGenerated`, `normalizeLangForPrefix`; `InferenceSession`, `Tensor`, `env as ortEnv` from `./_shared/onnxruntime-all`; `FrameProcessor`, `Message` from `@ricky0123/vad-web`; `resolveVadThresholds`.
- Produces: `AsrWorkerOutMessage`s exactly like the Granite worker (`ready`, `status`, `speech_start`, `result {text, startSample, durationMs, recognitionTimeMs}`, `error`, `disposed`).

Structure (copy from `granite-speech-webgpu.worker.ts`, keeping `initVad`, `vadInfer`, `vadResetStates`, `resampleInt16ToFloat32_16k`, `feedAudio`, `handleFlush`, `handleDispose`, the router; replacing `runGraniteInference` and `handleInit`):

- [ ] **Step 1: Write `qwen3-asr-decode.ts` (pure driver) and its test first.** Put the ORT-facing loop behind a tiny interface so it can be tested with fake sessions:

```ts
// src/lib/local-inference/workers/_shared/qwen3-asr-decode.ts
export interface RunnableSession { run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number>; dims: readonly number[]; type: string; dispose?(): void }>>; inputTypes: Record<string, string>; }
export interface DecodeDeps {
  init: RunnableSession; step: RunnableSession;
  makeTensor(type: string, data: Float32Array | Uint16Array | BigInt64Array, dims: number[]): unknown;
  toF16(x: Float32Array): Uint16Array; toF32(x: ArrayLike<number>, type: string): Float32Array;
  embedRow(id: number): Float32Array;
}
export async function greedyDecode(deps: DecodeDeps, promptEmbeds: Float32Array, promptLen: number, hidden: number, eos: Set<number>, maxTokens: number): Promise<number[]> {
  const embType = deps.init.inputTypes.input_embeds ?? 'float32';
  const feed = (x: Float32Array, dims: number[]) => deps.makeTensor(embType, embType === 'float16' ? deps.toF16(x) : x, dims);
  const pos = (from: number, n: number) => deps.makeTensor('int64', BigInt64Array.from({ length: n }, (_, i) => BigInt(from + i)), [1, n]);
  let out = await deps.init.run({ input_embeds: feed(promptEmbeds, [1, promptLen, hidden]), position_ids: pos(0, promptLen) });
  const argmax = (t: { data: ArrayLike<number>; type: string }) => { const a = deps.toF32(t.data, t.type); let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };
  let next = argmax(out.logits); const gen = [next]; let p = promptLen; let pk = out.present_keys, pv = out.present_values;
  while (!eos.has(next) && gen.length < maxTokens) {
    const o = await deps.step.run({ input_embeds: feed(deps.embedRow(next), [1, 1, hidden]), position_ids: pos(p, 1), past_keys: pk, past_values: pv });
    pk.dispose?.(); pv.dispose?.(); pk = o.present_keys; pv = o.present_values;
    next = argmax(o.logits); gen.push(next); p++;
  }
  pk.dispose?.(); pv.dispose?.();
  return gen;
}
```

Test (`qwen3-asr-decode.test.ts`): fake `init` returns logits with argmax 7, fake `step` returns argmax 8 then `eos`; assert `gen` = `[7, 8, eos]`, `dispose` called on every superseded KV pair, position ids `[[promptLen]]`, `[[promptLen+1]]`, and that `float16` input type routes through `toF16`.

- [ ] **Step 2: Run** → FAIL; implement; → PASS; commit `feat(local-inference): Qwen3-ASR greedy decode driver over ORT sessions`.

- [ ] **Step 3: Write the worker** — `handleInit(msg: Qwen3AsrInitMessage)`:

```ts
ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;                      // BEFORE initVad (harness rule)
if (!(await hasWebGPU())) { post({ type: 'error', error: 'WebGPU is not available. Qwen3-ASR requires WebGPU.' }); return; }
post({ type: 'status', message: 'Loading VAD model...' }); await initVad(msg.vadConfig, msg.vadModelUrl);
const text = async (name: string) => (await fetch(msg.fileUrls[name])).text();
const bytes = async (name: string) => new Uint8Array(await (await fetch(msg.fileUrls[name])).arrayBuffer());
cfg = JSON.parse(await text('prompt_config.json')) as Qwen3AsrPromptConfig;
const variantKey = typeof msg.dtype === 'string' && msg.dtype in cfg.variants ? msg.dtype : 'q4';
const v = cfg.variants[variantKey];
filters = JSON.parse(await text('mel_filters.json'));
decoder = createBpeDecoder(JSON.parse(await text('tokenizer.json')));
// embedding table
embI8 = new Int8Array((await bytes(cfg.embedding.file)).buffer); embScales = new Float32Array((await bytes(cfg.embedding.scales_file!)).buffer);
post({ type: 'status', message: 'Loading Qwen3-ASR model (WebGPU)...' });
const weights = await bytes(v.weights);
const so = (extra: object) => ({ executionProviders: ['webgpu'], graphOptimizationLevel: 'all', externalData: [{ path: v.weights, data: weights }], ...extra });
encSession = await InferenceSession.create(await bytes(v.encoder), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
initSession = await InferenceSession.create(await bytes(v.decoder_init), so({ preferredOutputLocation: { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } }));
stepSession = await InferenceSession.create(await bytes(v.decoder_step), so({ preferredOutputLocation: { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } }));
forceLang = normalizeLangForPrefix(msg.language, cfg);
post({ type: 'status', message: 'Warming up WebGPU shaders...' }); await transcribe(new Float32Array(16000), 0, /*warmup*/ true);
post({ type: 'ready', loadTimeMs: Math.round(performance.now() - t0) });
```

`transcribe(audio, startSample, warmup)`: `logMel` → encoder run (`mel` tensor typed from `encSession.inputMetadata`) → `audioTokenCount` must equal `audio_features.dims[1]` (else `post error` and return) → `buildPromptIds(nAudio, cfg, forceLang)` → build `promptEmbeds` (rows from the int8 table × scale, audio features spliced at `audioStart`) → `greedyDecode(deps, …)` → `splitGenerated` → `decoder.decode(textIds).trim()` → `post({ type: 'result', text, startSample, durationMs: audio.length / 16, recognitionTimeMs })` unless warmup or empty. `input_embeds`' dtype comes from `initSession.inputMetadata`; `Float16Array` is used when present, else the manual converter from `www/main.js`.

`handleDispose`: release the three sessions (`await s.release()`), null the tables, then the Granite tail (`post({ type: 'disposed' })`).

- [ ] **Step 4: Run the harness test** — `npx vitest run src/lib/local-inference/workers/_shared/harness-consolidation.test.ts` → PASS (wasmPaths before initVad, flush routed). Run `npx tsc --noEmit -p tsconfig.json` → no new errors (the repo baseline is not zero; compare counts before/after).

- [ ] **Step 5: Commit** — `git commit -m "feat(local-inference): Qwen3-ASR WebGPU worker (raw onnxruntime-web, prefix forcing, GPU-resident KV cache)"`

---

### Task 5: Manifest row and its test

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` — add the row after the Granite Speech 4.1 2B entry; extend the `asrWorkerType` union (if not done in Task 4) and `AsrEngineType` with `'qwen3-asr'`
- Test: `src/lib/local-inference/modelManifest.qwen3Asr.test.ts`

**Interfaces:**
- Consumes: exact byte sizes from `benchmark/qwen3-asr-webgpu/results/v2-hub-files.json` (PR 1 Task 9).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { getManifestEntry, isVariantEligible, selectVariant } from './modelManifest';

describe('Qwen3-ASR-0.6B (WebGPU) manifest entry', () => {
  const entry = getManifestEntry('qwen3-asr-0.6b-webgpu')!;
  it('is a WebGPU-only ASR model on the qwen3 worker', () => {
    expect(entry.type).toBe('asr');
    expect(entry.requiredDevice).toBe('webgpu');
    expect(entry.asrWorkerType).toBe('qwen3-asr-webgpu');
    expect(entry.hfModelId).toBe('jiangzhuo9357/Qwen3-ASR-0.6B-ONNX');
  });
  it('lists the 16 languages the model card names, with yue not zh-HK', () => {
    expect(entry.languages).toEqual(['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id']);
  });
  it('picks q4f16 with shader-f16 and q4 without', () => {
    expect(selectVariant(entry, ['shader-f16'])).toBe('q4f16');
    expect(selectVariant(entry, [])).toBe('q4');
    expect(isVariantEligible(entry, 'q4f16', [])).toBe(false);
  });
  it('shares the tokenizer/config/embedding files between variants and differs only in encoder + decoders', () => {
    const names = (k: string) => entry.variants[k].files.map(f => f.filename).sort();
    const shared = ['added_tokens.json', 'config.json', 'embed_scales.f32.bin', 'embed_tokens.int8.bin', 'mel_filters.json', 'prompt_config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.json'];
    expect(names('q4')).toEqual([...shared, 'decoder_init.int4.onnx', 'decoder_step.int4.onnx', 'decoder_weights.int4.data', 'encoder.onnx'].sort());
    expect(names('q4f16')).toEqual([...shared, 'decoder_init.q4f16.onnx', 'decoder_step.q4f16.onnx', 'decoder_weights.q4f16.data', 'encoder.fp16.onnx'].sort());
  });
  it('dtype is the variant key the worker resolves in prompt_config.json', () => {
    expect(entry.variants.q4.dtype).toBe('q4');
    expect(entry.variants.q4f16.dtype).toBe('q4f16');
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Add the row** (sizes copied from `v2-hub-files.json`; `name: 'Qwen3-ASR 0.6B (WebGPU)'`, `shortName: 'Qwen3-ASR 0.6B'`, `sortOrder` between Granite 2B and Voxtral, `recommended: false` until the fleet validation in Task 7 says otherwise, `asrEngine: 'qwen3-asr'`). **Step 4: Run** → PASS, and run the whole manifest test group `npx vitest run src/lib/local-inference/modelManifest*.test.ts src/lib/local-inference/selection` → PASS. **Step 5: Commit** — `git commit -m "feat(local-inference): Qwen3-ASR 0.6B manifest row with q4 / q4f16 variants"`

---

### Task 6: Engine wiring

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:118-143` (add the `case 'qwen3-asr-webgpu'` worker construction) and `:187` (add `|| workerType === 'qwen3-asr-webgpu'` to the whisper-shaped init branch)
- Test: `src/lib/local-inference/engine/AsrEngine.qwen3.test.ts` — mock `Worker` and `ModelManager` the way the existing `AsrEngine` tests do (look for `vi.mock('../ModelManager')` in `src/lib/local-inference/engine/*.test.ts`; follow the nearest sibling) and assert that loading the `qwen3-asr-0.6b-webgpu` model constructs the qwen3 worker URL and posts an init message carrying `dtype: 'q4f16'` when the stored variant is `q4f16`

- [ ] **Step 1: Write the failing test**, **Step 2: Run** → FAIL, **Step 3: Wire** (two edits), **Step 4: Run** → PASS; `npx vitest run src/lib/local-inference` → green except pre-existing sandbox failures (memory: 6 known load failures). **Step 5: Commit** — `git commit -m "feat(local-inference): route qwen3-asr-webgpu through AsrEngine"`

---

### Task 7: Fleet validation and the recommended flag

**Files:**
- Create: `docs/superpowers/notes/2026-09-0x-qwen3-asr-webgpu-fleet-validation.md`

- [ ] **Step 1: Build and run the app on the Windows 4070 and the Mac M4** (`npm run electron:dev` is Vite + Electron; on the fleet boxes use a packaged build from CI or `npm run build` + `npm run package`), pick `Local inference` → ASR `Qwen3-ASR 0.6B (WebGPU)`, download, confirm the variant chosen (`q4f16` on both), speak the 13 clips through a loopback device or play them into the mic, record transcripts and the per-utterance latency shown in LogsPanel.
- [ ] **Step 2: On the GB10** (no `shader-f16`) confirm the `q4` variant is selected and runs.
- [ ] **Step 3: Force the fallback on a f16 machine** — `localStorage.setItem('debug:webgpu-features', '')`, reload, confirm `q4` downloads and runs; `localStorage.removeItem('debug:webgpu-features')` afterwards.
- [ ] **Step 4: Memory** — 50 utterances in a row, Task Manager / Activity Monitor GPU memory flat within ±100 MB.
- [ ] **Step 5: Decide `recommended`** for ja/zh (compare against the current recommended rows on the same clips) and flip it in the manifest row if it wins; commit `docs + manifest`.

---

### Task 8: Push and PR request

- [ ] **Step 1:** `git push origin feat/qwen3-asr-webgpu-worker`
- [ ] **Step 2:** Ask jiangzhuo for the OK to open PR 2 on `kizuna-ai-lab/sokuji` (`feat/qwen3-asr-webgpu-worker` → `main`, title `feat(local-inference): Qwen3-ASR 0.6B as a WebGPU ASR model`). Do not open it before the OK. Mention in the PR body that it closes #465 and #148.
