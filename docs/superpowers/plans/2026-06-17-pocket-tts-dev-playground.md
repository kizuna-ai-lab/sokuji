# Pocket TTS Dev-Playground PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dev-only, standalone in-browser playground that runs Kyutai Pocket TTS (zero-shot voice cloning) via a new `onnxruntime-web` worker, with a record/upload reference-audio UI and playback — decoupled from the live translation pipeline.

**Architecture:** Mirror sokuji's existing Supertonic TTS path: a Vite-bundled ES-module worker (`pocket-tts.worker.ts`) on `onnxruntime-web` with WebGPU→WASM auto-fallback, holding 5 ONNX sessions (Mimi encoder, text conditioner, flow LM main, flow LM flow, Mimi decoder). The autoregressive decode core is adapted from the known-working `KevinAHM/pocket-tts-web` Space worker. A new `TtsEngine` `isPocket` branch routes to it. A separate dev Vite entry (`pocket-playground-entry.tsx`, like `subtitle-overlay-entry.tsx`) hosts the UI.

**Tech Stack:** TypeScript, React, `onnxruntime-web` (WebGPU/WASM EP), Web Audio API (`decodeAudioData`, MediaRecorder), Vitest + jsdom, Vite (separate entry), SentencePiece (vendored JS).

---

## Deviations from the spec (discovered during planning — confirm at handoff)

The spec (`docs/superpowers/specs/2026-06-17-pocket-tts-dev-playground-design.md`) assumed the model comes from `KevinAHM/pocket-tts-onnx` via `hfModelId` + `ModelManager`, and `numSteps: 5`. Planning against the real source revealed:

1. **Model source:** `KevinAHM/pocket-tts-onnx` is ~12 GB (all languages, full precision). The browser-ready **int8 English bundle** lives in the **`KevinAHM/pocket-tts-web` Space**. For a PoC we pull that bundle with a download script into `public/wasm/pocket-tts-en/` (gitignored) and load it directly from the dev server — **no `ModelManager`/IndexedDB for the PoC**. Production hosting (mirror into our own HF dataset + `ModelManager`) stays deferred, as the spec already noted.
2. **Flow steps:** the working ONNX port uses `LSD_STEPS = 1` (consistency sampling), not sherpa's 5. We follow the port's value and expose it as a configurable `ttsConfig.lsdSteps` (default `1`).

These narrow the spec's component #4 (manifest/ModelManager) for the PoC. A minimal manifest entry is still added so `TtsEngine` routes by `engine: 'pocket'`.

---

## File Structure

**Create:**
- `scripts/download-pocket-tts-en.sh` — fetches the English int8 bundle from the Space into `public/wasm/pocket-tts-en/`.
- `src/lib/local-inference/pocket/pocketBundle.ts` — bundle constants: model stems, frame config, public base path.
- `src/lib/local-inference/pocket/sentencepiece.js` — vendored SentencePiece JS (from the Space), loaded by the worker.
- `src/lib/local-inference/pocket/pocketTokenizer.ts` — thin typed wrapper over the vendored SentencePiece, `encodeIds(text): bigint[]`.
- `src/lib/local-inference/pocket/pocketState.ts` — pure KV-cache/state-manifest threading helpers.
- `src/lib/local-inference/pocket/pocketState.test.ts` — unit tests for the state helpers.
- `src/lib/local-inference/pocket/pocketTokenizer.test.ts` — determinism test for the tokenizer wrapper.
- `src/lib/local-inference/pocket/pocketInferenceCore.ts` — session map, `encodeReference`, `generate` AR loop (adapted from the Space worker).
- `src/lib/local-inference/workers/pocket-tts.worker.ts` — ES-module worker: init + WebGPU/WASM fallback + message handling.
- `src/lib/local-inference/engine/TtsEngine.pocket.test.ts` — `isPocket` branch + `generateWithReference` tests (mocked worker).
- `src/pocket-playground-entry.tsx` — React entry for the dev playground.
- `src/components/dev/PocketPlayground.tsx` — the playground component (text, record/upload, generate, playback, download).
- `src/components/dev/PocketPlayground.scss` — styles.
- `pocket-playground.html` — Vite dev entry HTML.

**Modify:**
- `.gitignore` — ignore `public/wasm/pocket-tts-en/`.
- `src/lib/local-inference/types.ts` — add Pocket worker message types.
- `src/lib/local-inference/modelManifest.ts` — add `'pocket'` to `TtsEngineType`, add the `pocket-tts` entry, extend `TtsModelConfig` with `lsdSteps`/`maxFrames`.
- `src/lib/local-inference/engine/TtsEngine.ts` — add `isPocket` branch + `generateWithReference`.
- `vite.config.ts` — register the `pocket-playground.html` entry (dev only).

---

## Task 1: Bundle download script + gitignore

**Files:**
- Create: `scripts/download-pocket-tts-en.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Add gitignore entry**

Append to `.gitignore`:

```gitignore
# Pocket TTS dev-playground model bundle (downloaded via scripts/download-pocket-tts-en.sh)
public/wasm/pocket-tts-en/
```

- [ ] **Step 2: Write the download script**

The Space stores the browser bundle under a per-language path. The script first lists the repo tree to confirm the exact English bundle path, then downloads each file. Create `scripts/download-pocket-tts-en.sh`:

```bash
#!/usr/bin/env bash
# Downloads the English Pocket TTS int8 bundle from the KevinAHM/pocket-tts-web
# Space into public/wasm/pocket-tts-en/ for the dev playground PoC.
# These files are NOT committed (see .gitignore).
set -euo pipefail

SPACE="https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main"
OUT="public/wasm/pocket-tts-en"
mkdir -p "$OUT"

# Confirm exact bundle layout before downloading:
#   open https://huggingface.co/spaces/KevinAHM/pocket-tts-web/tree/main
# and set BUNDLE to the English bundle directory (e.g. "en" or "bundles/en").
BUNDLE="${1:-en}"

# Files the worker loads (5 int8 onnx + tokenizer + per-bundle metadata + preset voices).
FILES=(
  "flow_lm_main_int8.onnx"
  "flow_lm_flow_int8.onnx"
  "mimi_encoder_int8.onnx"
  "mimi_decoder_int8.onnx"
  "text_conditioner_int8.onnx"
  "tokenizer.model"
  "metadata.json"
  "voices.bin"
)

for f in "${FILES[@]}"; do
  echo "Downloading $BUNDLE/$f ..."
  curl -fL "$SPACE/$BUNDLE/$f" -o "$OUT/$f"
done

echo "Done. Bundle in $OUT/"
ls -la "$OUT"
```

> Note: the exact `BUNDLE` path and `metadata.json` filename are confirmed by opening the Space tree (`https://huggingface.co/spaces/KevinAHM/pocket-tts-web/tree/main`) and reading `onnx-streaming.js` for `bundlePath(language, file)` and `bundleMetadata` keys. Adjust `BUNDLE`/filenames if they differ; the script is the single place that encodes them.

- [ ] **Step 3: Make executable and run**

Run:

```bash
chmod +x scripts/download-pocket-tts-en.sh
./scripts/download-pocket-tts-en.sh
```

Expected: `public/wasm/pocket-tts-en/` contains the 5 `*_int8.onnx`, `tokenizer.model`, `metadata.json`, `voices.bin`. If a 404 occurs, fix `BUNDLE`/filenames per the Space tree and re-run.

- [ ] **Step 4: Commit**

```bash
git add scripts/download-pocket-tts-en.sh .gitignore
git commit -m "feat(pocket-tts): add English bundle download script for dev playground"
```

---

## Task 2: Bundle constants module

**Files:**
- Create: `src/lib/local-inference/pocket/pocketBundle.ts`

- [ ] **Step 1: Write the constants module**

Create `src/lib/local-inference/pocket/pocketBundle.ts`:

```typescript
/**
 * Pocket TTS bundle constants for the dev playground PoC.
 *
 * The English int8 bundle is downloaded into public/wasm/pocket-tts-en/ by
 * scripts/download-pocket-tts-en.sh and served by the dev server at /wasm/pocket-tts-en/.
 * Tensor/frame values mirror the working KevinAHM/pocket-tts-web ONNX port.
 */

/** Public path (served by the dev server) where the bundle lives. */
export const POCKET_BUNDLE_BASE = '/wasm/pocket-tts-en';

/** ONNX session id → filename within the bundle. */
export const POCKET_MODEL_STEMS = {
  mimiEncoder: 'mimi_encoder_int8.onnx',
  textConditioner: 'text_conditioner_int8.onnx',
  flowLmMain: 'flow_lm_main_int8.onnx',
  flowLmFlow: 'flow_lm_flow_int8.onnx',
  mimiDecoder: 'mimi_decoder_int8.onnx',
} as const;

export type PocketSessionId = keyof typeof POCKET_MODEL_STEMS;

export const POCKET_TOKENIZER_FILE = 'tokenizer.model';
export const POCKET_METADATA_FILE = 'metadata.json';
export const POCKET_VOICES_FILE = 'voices.bin';

/** Audio/frame configuration (from the ONNX port). */
export const POCKET_SAMPLE_RATE = 24000;
export const POCKET_SAMPLES_PER_FRAME = 1920; // 80 ms @ 24 kHz
export const POCKET_LATENT_DIM = 32;

/** Generation defaults (configurable via ttsConfig). */
export const POCKET_DEFAULT_LSD_STEPS = 1; // consistency sampling; NOT sherpa's 5
export const POCKET_DEFAULT_MAX_FRAMES = 500;
export const POCKET_EOS_LOGIT_THRESHOLD = -4.0;
export const POCKET_DECODER_CHUNK_FRAMES = 12;

/** Build the full /wasm path for a bundle file. */
export function pocketBundleUrl(file: string): string {
  return `${POCKET_BUNDLE_BASE}/${file}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/local-inference/pocket/pocketBundle.ts
git commit -m "feat(pocket-tts): add bundle constants module"
```

---

## Task 3: Vendor SentencePiece + typed tokenizer wrapper (TDD)

**Files:**
- Create: `src/lib/local-inference/pocket/sentencepiece.js`
- Create: `src/lib/local-inference/pocket/pocketTokenizer.ts`
- Test: `src/lib/local-inference/pocket/pocketTokenizer.test.ts`

- [ ] **Step 1: Vendor the SentencePiece JS**

Download the SentencePiece module the Space uses into the repo:

```bash
curl -fL "https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main/sentencepiece.js" \
  -o src/lib/local-inference/pocket/sentencepiece.js
```

It exposes `class SentencePieceProcessor` with `async loadFromB64StringModel(b64)` and `encodeIds(text): number[]` (confirmed in the Space worker). Keep it as a `.js` so Vite bundles it into the worker.

- [ ] **Step 2: Write the failing test**

Create `src/lib/local-inference/pocket/pocketTokenizer.test.ts`. The wrapper converts a `tokenizer.model` ArrayBuffer + text into `bigint[]`. We mock the vendored SP module so the test is deterministic and runs in jsdom:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock the vendored SentencePiece with a deterministic fake.
vi.mock('./sentencepiece.js', () => {
  class SentencePieceProcessor {
    loaded = false;
    async loadFromB64StringModel(_b64: string) { this.loaded = true; }
    encodeIds(text: string): number[] {
      // Deterministic stand-in: one id per char code, offset by 3.
      return Array.from(text).map((c) => c.charCodeAt(0) + 3);
    }
  }
  return { SentencePieceProcessor };
});

import { PocketTokenizer } from './pocketTokenizer';

describe('PocketTokenizer', () => {
  it('loads a model buffer and encodes text to bigint ids', async () => {
    const tok = new PocketTokenizer();
    await tok.load(new Uint8Array([1, 2, 3]).buffer);
    const ids = tok.encodeIds('AB');
    expect(ids).toEqual([68n, 69n]); // 'A'=65+3, 'B'=66+3
    expect(ids.every((x) => typeof x === 'bigint')).toBe(true);
  });

  it('throws if used before load', () => {
    const tok = new PocketTokenizer();
    expect(() => tok.encodeIds('x')).toThrow(/not loaded/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/lib/local-inference/pocket/pocketTokenizer.test.ts`
Expected: FAIL — `PocketTokenizer` not found.

- [ ] **Step 4: Implement the wrapper**

Create `src/lib/local-inference/pocket/pocketTokenizer.ts`:

```typescript
// @ts-expect-error — vendored JS module without types
import { SentencePieceProcessor } from './sentencepiece.js';

/** Base64-encode an ArrayBuffer without blowing the call stack on large inputs. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Typed wrapper over the vendored SentencePiece processor.
 * Loads a `tokenizer.model` buffer and encodes text to int64-ready bigint ids.
 */
export class PocketTokenizer {
  private sp: { loadFromB64StringModel(b64: string): Promise<void>; encodeIds(t: string): number[] } | null = null;

  async load(modelBuffer: ArrayBuffer): Promise<void> {
    const sp = new SentencePieceProcessor();
    await sp.loadFromB64StringModel(toBase64(modelBuffer));
    this.sp = sp;
  }

  encodeIds(text: string): bigint[] {
    if (!this.sp) throw new Error('PocketTokenizer not loaded');
    return this.sp.encodeIds(text).map((t) => BigInt(t));
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/lib/local-inference/pocket/pocketTokenizer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/pocket/sentencepiece.js src/lib/local-inference/pocket/pocketTokenizer.ts src/lib/local-inference/pocket/pocketTokenizer.test.ts
git commit -m "feat(pocket-tts): vendor SentencePiece + typed tokenizer wrapper"
```

---

## Task 4: State-manifest threading helper (TDD)

The flow LM and Mimi decoder are stateful; their ONNX graphs expose KV-cache/streaming state as explicit inputs/outputs. The bundle `metadata.json` declares a manifest mapping each **output** state name to the **input** name it feeds on the next step. This pure helper applies that mapping; isolating it makes the AR loop testable.

**Files:**
- Create: `src/lib/local-inference/pocket/pocketState.ts`
- Test: `src/lib/local-inference/pocket/pocketState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/pocket/pocketState.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { initState, applyStateUpdates, type StateManifestEntry } from './pocketState';

const manifest: StateManifestEntry[] = [
  { inputName: 'cache_in', outputName: 'cache_out', dims: [1, 2], dtype: 'float32' },
];

describe('pocketState', () => {
  it('initializes zero tensors for each state input', () => {
    const state = initState(manifest, makeTensor);
    expect(Object.keys(state)).toEqual(['cache_in']);
    expect(state.cache_in.data).toEqual(new Float32Array([0, 0]));
  });

  it('threads each output back to its paired next-step input', () => {
    const state = initState(manifest, makeTensor);
    const runOutputs = { cache_out: makeTensor('float32', new Float32Array([5, 6]), [1, 2]) };
    const next = applyStateUpdates(state, manifest, runOutputs);
    expect(next.cache_in.data).toEqual(new Float32Array([5, 6]));
  });
});

// Minimal tensor factory matching the ORT Tensor shape used by the helper.
function makeTensor(dtype: string, data: Float32Array, dims: number[]) {
  return { type: dtype, data, dims };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/local-inference/pocket/pocketState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/local-inference/pocket/pocketState.ts`:

```typescript
/**
 * Stateful-ONNX KV-cache / streaming-state threading.
 *
 * The bundle metadata declares, per stateful session, a list of
 * (inputName, outputName, dims, dtype). After each .run(), the output tensor
 * named `outputName` becomes the next step's input named `inputName`.
 *
 * Generic over the tensor type so it is unit-testable without onnxruntime-web.
 */

export interface StateManifestEntry {
  inputName: string;
  outputName: string;
  dims: number[];
  dtype: 'float32' | 'int64';
}

export interface TensorLike {
  type: string;
  data: Float32Array | BigInt64Array;
  dims: number[];
}

export type TensorFactory = (
  dtype: string,
  data: Float32Array | BigInt64Array,
  dims: number[],
) => TensorLike;

export type StateMap = Record<string, TensorLike>;

function zeros(entry: StateManifestEntry): Float32Array | BigInt64Array {
  const len = entry.dims.reduce((a, b) => a * b, 1);
  return entry.dtype === 'int64' ? new BigInt64Array(len) : new Float32Array(len);
}

/** Build initial zero-filled state keyed by each entry's inputName. */
export function initState(manifest: StateManifestEntry[], makeTensor: TensorFactory): StateMap {
  const state: StateMap = {};
  for (const e of manifest) {
    state[e.inputName] = makeTensor(e.dtype, zeros(e), e.dims);
  }
  return state;
}

/** Return a new StateMap with each output threaded into its paired next input. */
export function applyStateUpdates(
  prev: StateMap,
  manifest: StateManifestEntry[],
  runOutputs: Record<string, TensorLike>,
): StateMap {
  const next: StateMap = { ...prev };
  for (const e of manifest) {
    const out = runOutputs[e.outputName];
    if (out) next[e.inputName] = out;
  }
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/local-inference/pocket/pocketState.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/pocket/pocketState.ts src/lib/local-inference/pocket/pocketState.test.ts
git commit -m "feat(pocket-tts): add pure state-manifest threading helper + tests"
```

---

## Task 5: Worker message types

**Files:**
- Modify: `src/lib/local-inference/types.ts`

- [ ] **Step 1: Add the Pocket message types**

In `src/lib/local-inference/types.ts`, after the Supertonic section (around the `SupertonicTtsWorkerInMessage` union), add:

```typescript
// ─── Pocket TTS worker — separate init/generate shape ────────────────────────
// Pocket clones from a raw reference waveform (no transcript). Init loads the
// 5 ONNX sessions + tokenizer from /wasm/pocket-tts-en/ blob URLs; generate
// carries either fresh reference samples (to (re)compute the voice embedding)
// or `useCachedVoice` to reuse the last one.

export interface PocketTtsConfig {
  /** Flow/consistency refinement steps (default 1 — the ONNX port's value). */
  lsdSteps?: number;
  /** Hard cap on generated frames (default 500). */
  maxFrames?: number;
}

export interface PocketTtsInitMessage {
  type: 'init';
  /** filename → blob URL for the 5 onnx + tokenizer.model + metadata.json + voices.bin. */
  fileUrls: Record<string, string>;
  /** Absolute URL to /wasm/ort/ — used as ort.env.wasm.wasmPaths. */
  ortWasmBaseUrl: string;
  ttsConfig: PocketTtsConfig;
}

export interface PocketTtsGenerateMessage {
  type: 'generate';
  text: string;
  speed: number;
  /** Mono reference samples (any rate); worker resamples to 24 kHz then encodes. */
  referenceAudio?: Float32Array;
  referenceSampleRate?: number;
  /** Reuse the previously-encoded voice embedding (referenceAudio omitted). */
  useCachedVoice?: boolean;
}

export type PocketTtsWorkerInMessage =
  | PocketTtsInitMessage
  | PocketTtsGenerateMessage
  | TtsDisposeMessage;
```

The worker replies with the existing `TtsWorkerOutMessage` union (`ready` with `backend`, `status`, `result`, `error`, `disposed`) — no changes needed there.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (types are referenced by later tasks; unused-for-now is fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/types.ts
git commit -m "feat(pocket-tts): add Pocket worker message types"
```

---

## Task 6: Manifest entry + engine type (TDD)

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts`
- Test: `src/lib/local-inference/modelManifest.pocket.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/modelManifest.pocket.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getManifestEntry, getManifestByType } from './modelManifest';

describe('pocket-tts manifest entry', () => {
  it('is registered as a tts/pocket model', () => {
    const entry = getManifestEntry('pocket-tts');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('tts');
    expect(entry!.engine).toBe('pocket');
  });

  it('appears in the tts model list', () => {
    const ids = getManifestByType('tts').map((m) => m.id);
    expect(ids).toContain('pocket-tts');
  });

  it('defaults lsdSteps to 1', () => {
    const entry = getManifestEntry('pocket-tts');
    expect(entry!.ttsConfig?.lsdSteps).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/local-inference/modelManifest.pocket.test.ts`
Expected: FAIL — entry undefined / `engine` not `'pocket'`.

- [ ] **Step 3: Add the engine type and config fields**

In `src/lib/local-inference/modelManifest.ts`, extend `TtsEngineType` (line ~27) to include `'pocket'`:

```typescript
export type TtsEngineType = 'piper' | 'coqui' | 'mimic3' | 'mms' | 'matcha' | 'kokoro' | 'vits' | 'supertonic' | 'piper-plus' | 'edge-tts' | 'pocket';
```

In the `TtsModelConfig` interface, add (after the Supertonic fields):

```typescript
  /** Pocket: flow/consistency refinement steps (default 1). */
  lsdSteps?: number;
  /** Pocket: hard cap on generated frames (default 500). */
  maxFrames?: number;
```

- [ ] **Step 4: Add the manifest entry**

In the TTS section of the manifest array (next to the Supertonic entry), add:

```typescript
  // ── Pocket TTS (dev playground PoC) ───────────────────────────────────
  // Zero-shot voice cloning. PoC loads the int8 bundle from public/wasm/
  // pocket-tts-en/ (see scripts/download-pocket-tts-en.sh), NOT ModelManager.
  // The variant file list is informational for the PoC.
  {
    id: 'pocket-tts',
    type: 'tts',
    engine: 'pocket',
    name: 'Pocket TTS (dev)',
    languages: ['en'],
    numSpeakers: 1,
    ttsConfig: { lsdSteps: 1, maxFrames: 500 },
    variants: {
      default: {
        dtype: 'int8',
        files: [
          { filename: 'flow_lm_main_int8.onnx', sizeBytes: 0 },
          { filename: 'flow_lm_flow_int8.onnx', sizeBytes: 0 },
          { filename: 'mimi_encoder_int8.onnx', sizeBytes: 0 },
          { filename: 'mimi_decoder_int8.onnx', sizeBytes: 0 },
          { filename: 'text_conditioner_int8.onnx', sizeBytes: 0 },
          { filename: 'tokenizer.model', sizeBytes: 0 },
          { filename: 'metadata.json', sizeBytes: 0 },
          { filename: 'voices.bin', sizeBytes: 0 },
        ],
      },
    },
  },
```

> `sizeBytes: 0` is acceptable for the PoC because the files are loaded from `public/` by a download script, not validated/downloaded by `ModelManager`. Production hosting will fill real sizes.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/lib/local-inference/modelManifest.pocket.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts src/lib/local-inference/modelManifest.pocket.test.ts
git commit -m "feat(pocket-tts): register pocket engine type + manifest entry"
```

---

## Task 7: Inference core — session loading, reference encoding, AR generate

This is the ported model math. It is exercised end-to-end only in a real browser with WebGPU/WASM + the bundle (covered by the manual checklist in Task 11); the pure helpers it depends on (Tasks 3–4) are already unit-tested. Reference the working source for the exact loop while adapting to sokuji's `InferenceSession`/`Tensor` and the captured `metadata.json` schema.

**Files:**
- Create: `src/lib/local-inference/pocket/pocketInferenceCore.ts`

- [ ] **Step 1: Read the reference implementation**

Open the working worker and the bundle metadata you downloaded:
- `https://huggingface.co/spaces/KevinAHM/pocket-tts-web/raw/main/inference-worker.js`
- `public/wasm/pocket-tts-en/metadata.json`

Note the exact tensor contracts (already verified):

| Session | Inputs | Outputs |
|---|---|---|
| `mimiEncoder` | `audio` f32 `[1,1,N]` | `outputNames[0]` → `[1,T,32]` |
| `textConditioner` | `token_ids` int64 `[1,L]` | `outputNames[0]` → `[1,L,1024]` |
| `flowLmMain` (prefill) | `sequence` f32 `[1,0,32]`, `text_embeddings` f32 `[1,L,1024]`, `...flowLmState` | `conditioning`, `eos_logit`, state outputs |
| `flowLmMain` (AR step) | `sequence` f32 `[1,1,32]`, `text_embeddings` f32 `[1,0,1024]`, `...flowLmState` | `conditioning`, `eos_logit`, state outputs |
| `flowLmFlow` | `c`=conditioning, `s` f32 `[1,1]`, `t` f32 `[1,1]`, `x` f32 `[1,32]` | `flow_dir` `[32]` |
| `mimiDecoder` | `latent` f32 `[1,B,32]`, `...mimiState` | `outputNames[0]` → PCM `Float32Array` |

Frame config (from `pocketBundle.ts`): sr 24000, 1920 samples/frame, latent 32, EOS when `eos_logit > -4.0`, LSD steps default 1 (`dt = 1/lsdSteps`), decoder batch 12 frames, `MAX_FRAMES` 500.

- [ ] **Step 2: Implement the core**

Create `src/lib/local-inference/pocket/pocketInferenceCore.ts`. Adapt the source's `encodeVoiceAudio`, `buildVoiceConditionedState`, `stateFromVoiceRecord`, the AR loop, and the decoder batching — replacing `ort.Tensor`/`ort.InferenceSession` with sokuji's imports and reading the state manifest from `metadata.json` via `pocketState.ts`. Skeleton with the real contract:

```typescript
import { InferenceSession, Tensor } from '../workers/_shared/onnxruntime-all';
import {
  POCKET_SAMPLE_RATE, POCKET_LATENT_DIM, POCKET_EOS_LOGIT_THRESHOLD,
  POCKET_DECODER_CHUNK_FRAMES, POCKET_DEFAULT_MAX_FRAMES, POCKET_DEFAULT_LSD_STEPS,
} from './pocketBundle';
import {
  initState, applyStateUpdates, type StateManifestEntry, type StateMap,
} from './pocketState';

export interface PocketSessions {
  mimiEncoder: InferenceSession;
  textConditioner: InferenceSession;
  flowLmMain: InferenceSession;
  flowLmFlow: InferenceSession;
  mimiDecoder: InferenceSession;
}

/** Parsed from metadata.json: per-session state manifests. */
export interface PocketMetadata {
  flowLmState: StateManifestEntry[];
  mimiState: StateManifestEntry[];
}

const makeTensor = (dtype: string, data: Float32Array | BigInt64Array, dims: number[]) =>
  new Tensor(dtype as 'float32' | 'int64', data as never, dims);

/** Linear resample mono Float32 to 24 kHz. */
export function resampleTo24k(samples: Float32Array, srcRate: number): Float32Array {
  if (srcRate === POCKET_SAMPLE_RATE) return samples;
  const ratio = POCKET_SAMPLE_RATE / srcRate;
  const out = new Float32Array(Math.round(samples.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Reference samples (already 24 kHz mono) → voice embedding tensor [1,T,32]. */
export async function encodeReference(
  sessions: PocketSessions, samples24k: Float32Array,
): Promise<Tensor> {
  const audio = makeTensor('float32', samples24k, [1, 1, samples24k.length]) as Tensor;
  const out = await sessions.mimiEncoder.run({ audio });
  return out[sessions.mimiEncoder.outputNames[0]] as Tensor;
}

/**
 * Prefill flowLmMain with the voice embedding + (optionally) text embeddings to
 * initialize the flow state. Adapt from the source's buildVoiceConditionedState.
 * Returns the initialized flowLmState.
 */
export async function buildVoiceConditionedState(
  sessions: PocketSessions, meta: PocketMetadata, voiceEmb: Tensor,
): Promise<StateMap> {
  // 1) init zeroed state from manifest
  // 2) run flowLmMain with sequence [1,0,32] + the voice/text conditioning per the
  //    source, threading state via applyStateUpdates(state, meta.flowLmState, out)
  // See inference-worker.js buildVoiceConditionedState for the exact inputs.
  return initState(meta.flowLmState, makeTensor);
}

export interface PocketGenOptions {
  lsdSteps?: number;
  maxFrames?: number;
  speed?: number;
}

/**
 * Autoregressive generate. Adapt verbatim from inference-worker.js:
 *  - tokenize text → text_conditioner → text_embeddings [1,L,1024]
 *  - prefill flowLmMain; then loop up to maxFrames:
 *      flowLmMain.run({ sequence:[1,1,32], text_embeddings:[1,0,1024], ...flowLmState })
 *      eos_logit > -4.0 → mark eosStep; stop after framesAfterEos
 *      LSD refine: for lsd in 0..lsdSteps: flowLmFlow.run({c,s,t,x}) → x += flow_dir*dt
 *      thread flowLmState via applyStateUpdates
 *      buffer latent; when >= 12 frames (or final) → mimiDecoder.run({latent:[1,B,32], ...mimiState})
 *  - concatenate decoder PCM chunks → Float32Array @ 24 kHz
 */
export async function generate(
  sessions: PocketSessions,
  meta: PocketMetadata,
  textEmbeddings: Tensor,
  flowLmState: StateMap,
  opts: PocketGenOptions,
): Promise<Float32Array> {
  const lsdSteps = opts.lsdSteps ?? POCKET_DEFAULT_LSD_STEPS;
  const maxFrames = opts.maxFrames ?? POCKET_DEFAULT_MAX_FRAMES;
  void POCKET_LATENT_DIM; void POCKET_EOS_LOGIT_THRESHOLD; void POCKET_DECODER_CHUNK_FRAMES;
  void lsdSteps; void maxFrames; void applyStateUpdates; void textEmbeddings; void flowLmState;
  throw new Error('pocketInferenceCore.generate: port the AR loop from inference-worker.js');
}
```

> The `throw` is a deliberate scaffold marker for the one block that must be hand-ported from the verified source; replace it with the adapted loop. Everything around it (sessions, resample, encodeReference, state threading) is concrete. The manual checklist (Task 11) is what validates this block, since real inference can't run in jsdom.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `void` statements keep unused symbols from erroring while the loop is ported).

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/pocket/pocketInferenceCore.ts
git commit -m "feat(pocket-tts): inference core scaffold (sessions, resample, encodeReference, state)"
```

---

## Task 8: The worker — init, WebGPU/WASM fallback, message handling

**Files:**
- Create: `src/lib/local-inference/workers/pocket-tts.worker.ts`

- [ ] **Step 1: Implement the worker**

Mirror `supertonic-tts.worker.ts`'s init/fallback/post structure. Create `src/lib/local-inference/workers/pocket-tts.worker.ts`:

```typescript
/**
 * Pocket TTS worker — Vite-bundled ES module on onnxruntime-web.
 * Loads 5 ONNX sessions + SentencePiece tokenizer + state metadata, encodes a
 * reference voice to an embedding, and runs the autoregressive generate loop.
 * WebGPU with automatic WASM fallback (mirrors supertonic-tts.worker.ts).
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import type {
  PocketTtsInitMessage, PocketTtsGenerateMessage, PocketTtsWorkerInMessage,
  TtsWorkerOutMessage,
} from '../types';
import { POCKET_MODEL_STEMS, POCKET_SAMPLE_RATE, type PocketSessionId } from '../pocket/pocketBundle';
import { PocketTokenizer } from '../pocket/pocketTokenizer';
import {
  encodeReference, resampleTo24k, buildVoiceConditionedState, generate,
  type PocketSessions, type PocketMetadata,
} from '../pocket/pocketInferenceCore';
import type { StateMap } from '../pocket/pocketState';

let sessions: PocketSessions | null = null;
let meta: PocketMetadata | null = null;
let tokenizer: PocketTokenizer | null = null;
let cachedFlowState: StateMap | null = null;
let lsdSteps = 1;
let maxFrames = 500;
let backend: 'webgpu' | 'wasm' = 'wasm';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
function post(msg: TtsWorkerOutMessage, transfer?: Transferable[]) {
  if (transfer?.length) workerScope.postMessage(msg, transfer);
  else workerScope.postMessage(msg);
}

workerScope.onmessage = async (e: MessageEvent<PocketTtsWorkerInMessage>) => {
  try {
    if (e.data.type === 'init') await handleInit(e.data);
    else if (e.data.type === 'generate') await handleGenerate(e.data);
    else if (e.data.type === 'dispose') { sessions = null; tokenizer = null; cachedFlowState = null; post({ type: 'disposed' }); }
  } catch (err) {
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.arrayBuffer();
}

async function loadSessions(
  fileUrls: Record<string, string>, ep: 'webgpu' | 'wasm',
): Promise<PocketSessions> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3,
  };
  const ids = Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[];
  const created: Partial<PocketSessions> = {};
  for (const id of ids) {
    const file = POCKET_MODEL_STEMS[id];
    const url = fileUrls[file];
    if (!url) throw new Error(`Missing bundle file: ${file}`);
    created[id] = await InferenceSession.create(await fetchBuf(url), opts);
    post({ type: 'status', message: `Loaded ${file} (${ep})` });
  }
  return created as PocketSessions;
}

async function handleInit(msg: PocketTtsInitMessage) {
  const start = performance.now();
  ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
  ortEnv.wasm.numThreads = 1;
  lsdSteps = msg.ttsConfig.lsdSteps ?? 1;
  maxFrames = msg.ttsConfig.maxFrames ?? 500;

  const hasWebGPU = typeof (workerScope.navigator as { gpu?: unknown }).gpu !== 'undefined';
  backend = hasWebGPU ? 'webgpu' : 'wasm';
  post({ type: 'status', message: `Initializing Pocket TTS (backend: ${backend})` });

  try {
    sessions = await loadSessions(msg.fileUrls, backend);
  } catch (err) {
    if (backend === 'webgpu') {
      post({ type: 'status', message: `WebGPU init failed (${err instanceof Error ? err.message : err}); falling back to WASM` });
      sessions = null; backend = 'wasm';
      sessions = await loadSessions(msg.fileUrls, 'wasm');
    } else throw err;
  }

  meta = JSON.parse(new TextDecoder().decode(await fetchBuf(msg.fileUrls['metadata.json']))) as PocketMetadata;
  tokenizer = new PocketTokenizer();
  await tokenizer.load(await fetchBuf(msg.fileUrls['tokenizer.model']));

  post({
    type: 'ready', loadTimeMs: Math.round(performance.now() - start),
    numSpeakers: 1, sampleRate: POCKET_SAMPLE_RATE, backend,
  });
}

async function handleGenerate(msg: PocketTtsGenerateMessage) {
  if (!sessions || !meta || !tokenizer) throw new Error('Pocket engine not initialized');
  const start = performance.now();

  // (Re)build the voice-conditioned flow state from a new reference, or reuse cache.
  if (msg.referenceAudio && !msg.useCachedVoice) {
    const samples24k = resampleTo24k(msg.referenceAudio, msg.referenceSampleRate ?? POCKET_SAMPLE_RATE);
    const voiceEmb = await encodeReference(sessions, samples24k);
    cachedFlowState = await buildVoiceConditionedState(sessions, meta, voiceEmb);
  }
  if (!cachedFlowState) throw new Error('No reference voice set');

  // Tokenize → text_conditioner → text_embeddings, then generate.
  const ids = tokenizer.encodeIds(msg.text);
  const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
  const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds });
  const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]] as Tensor;

  const samples = await generate(
    sessions, meta, textEmbeddings, { ...cachedFlowState },
    { lsdSteps, maxFrames, speed: msg.speed },
  );

  post(
    { type: 'result', samples, sampleRate: POCKET_SAMPLE_RATE, generationTimeMs: Math.round(performance.now() - start) },
    [samples.buffer],
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/pocket-tts.worker.ts
git commit -m "feat(pocket-tts): add worker with WebGPU/WASM fallback + message handling"
```

---

## Task 9: TtsEngine isPocket branch + generateWithReference (TDD)

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`
- Test: `src/lib/local-inference/engine/TtsEngine.pocket.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Mirror `TtsEngine.supertonic.test.ts` (mock the worker). Create `src/lib/local-inference/engine/TtsEngine.pocket.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the most recent mock worker so the test can drive its onmessage.
let lastWorker: MockWorker;
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  constructor() { lastWorker = this; }
  postMessage(msg: unknown) {
    this.posted.push(msg);
    if ((msg as { type: string }).type === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', loadTimeMs: 1, numSpeakers: 1, sampleRate: 24000, backend: 'wasm' } } as MessageEvent));
    }
  }
  terminate() {}
}
vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);

import { TtsEngine } from './TtsEngine';

describe('TtsEngine — pocket', () => {
  beforeEach(() => { lastWorker = undefined as unknown as MockWorker; });

  it('inits the pocket model and posts a pocket init message', async () => {
    const engine = new TtsEngine();
    const info = await engine.init('pocket-tts');
    expect(info.sampleRate).toBe(24000);
    const init = lastWorker.posted[0] as { type: string; ttsConfig: { lsdSteps: number } };
    expect(init.type).toBe('init');
    expect(init.ttsConfig.lsdSteps).toBe(1);
  });

  it('generateWithReference posts reference audio and resolves with the result', async () => {
    const engine = new TtsEngine();
    await engine.init('pocket-tts');
    const ref = new Float32Array([0.1, 0.2, 0.3]);
    const p = engine.generateWithReference('hello', ref, 24000, 1.0);
    const gen = lastWorker.posted[1] as { type: string; referenceAudio: Float32Array };
    expect(gen.type).toBe('generate');
    expect(gen.referenceAudio).toEqual(ref);
    // Drive the worker result.
    const out = new Float32Array([0.5, 0.6]);
    lastWorker.onmessage?.({ data: { type: 'result', samples: out, sampleRate: 24000, generationTimeMs: 5 } } as MessageEvent);
    await expect(p).resolves.toMatchObject({ sampleRate: 24000, generationTimeMs: 5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/local-inference/engine/TtsEngine.pocket.test.ts`
Expected: FAIL — `pocket-tts` not handled / `generateWithReference` undefined.

- [ ] **Step 3: Add the isPocket branch**

In `src/lib/local-inference/engine/TtsEngine.ts`:

a) Near the other engine flags in `init` (after `const isSupertonic = ...`):

```typescript
    const isPocket = model.engine === 'pocket';
```

b) Skip the `ModelManager` download path for pocket (it loads from `public/`). In the `if (!isEdgeTts)` block, guard so pocket builds its own `fileUrls`:

```typescript
    if (!isEdgeTts && !isPocket) {
      // ... existing ModelManager / metadata logic unchanged ...
    }

    if (isPocket) {
      const { POCKET_MODEL_STEMS, POCKET_TOKENIZER_FILE, POCKET_METADATA_FILE, POCKET_VOICES_FILE, pocketBundleUrl } =
        await import('../pocket/pocketBundle');
      for (const file of Object.values(POCKET_MODEL_STEMS)) fileUrls[file] = pocketBundleUrl(file);
      fileUrls[POCKET_TOKENIZER_FILE] = pocketBundleUrl(POCKET_TOKENIZER_FILE);
      fileUrls[POCKET_METADATA_FILE] = pocketBundleUrl(POCKET_METADATA_FILE);
      fileUrls[POCKET_VOICES_FILE] = pocketBundleUrl(POCKET_VOICES_FILE);
      dataFileUrls = fileUrls;
    }
```

c) In the worker-selection block, add pocket (Vite module worker, like supertonic):

```typescript
      if (isSupertonic) {
        this.worker = new Worker(new URL('../workers/supertonic-tts.worker.ts', import.meta.url), { type: 'module' });
      } else if (isPocket) {
        this.worker = new Worker(new URL('../workers/pocket-tts.worker.ts', import.meta.url), { type: 'module' });
      } else {
        // ... existing public/ worker selection unchanged ...
      }
```

d) In the init-message dispatch (after the `isSupertonic` branch), add:

```typescript
      } else if (isPocket) {
        this.worker.postMessage({
          type: 'init',
          fileUrls: dataFileUrls,
          ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
          ttsConfig: { lsdSteps: model.ttsConfig?.lsdSteps ?? 1, maxFrames: model.ttsConfig?.maxFrames ?? 500 },
        });
```

e) Add the public method (after `generate`):

```typescript
  /**
   * Generate cloned speech from a reference waveform (Pocket only).
   * Pass `referenceAudio` to (re)compute the voice embedding, or omit it with
   * useCachedVoice=true to reuse the previously-encoded voice.
   */
  async generateWithReference(
    text: string, referenceAudio: Float32Array | null, referenceSampleRate: number, speed = 1.0,
  ): Promise<TtsResult> {
    if (!this.worker || !this.isReady) throw new Error('TTS engine not initialized');
    if (this.pendingGenerate) throw new Error('A generation request is already in progress');
    const sanitized = TtsEngine.stripEmoji(text);
    if (!sanitized) return { samples: new Float32Array(0), sampleRate: this._sampleRate, generationTimeMs: 0 };
    return new Promise((resolve, reject) => {
      this.pendingGenerate = { resolve, reject };
      const msg: Record<string, unknown> = { type: 'generate', text: sanitized, speed };
      if (referenceAudio) { msg.referenceAudio = referenceAudio; msg.referenceSampleRate = referenceSampleRate; }
      else { msg.useCachedVoice = true; }
      this.worker!.postMessage(msg, referenceAudio ? [referenceAudio.buffer] : []);
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/local-inference/engine/TtsEngine.pocket.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full engine test suite to check for regressions**

Run: `npm run test -- src/lib/local-inference/engine/`
Expected: PASS (existing supertonic/other tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts src/lib/local-inference/engine/TtsEngine.pocket.test.ts
git commit -m "feat(pocket-tts): TtsEngine isPocket branch + generateWithReference"
```

---

## Task 10: Dev playground UI + Vite entry

**Files:**
- Create: `pocket-playground.html`
- Create: `src/pocket-playground-entry.tsx`
- Create: `src/components/dev/PocketPlayground.tsx`
- Create: `src/components/dev/PocketPlayground.scss`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add the Vite entry HTML**

Create `pocket-playground.html` at the repo root (mirrors how `index.html` / the subtitle overlay entry are set up):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pocket TTS — Dev Playground</title>
  </head>
  <body>
    <div id="pocket-root"></div>
    <script type="module" src="/src/pocket-playground-entry.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Register the entry in vite.config.ts (dev only)**

In `vite.config.ts`, add `pocket-playground.html` to `build.rollupOptions.input` only in development so it never ships in production builds:

```typescript
// inside defineConfig(({ mode }) => ({ ... }))
build: {
  rollupOptions: {
    input: mode === 'development'
      ? { main: 'index.html', pocketPlayground: 'pocket-playground.html' }
      : { main: 'index.html' },
  },
},
```

> If `vite.config.ts` doesn't already use the `({ mode }) => ({...})` functional form, convert it (Vite supports it). Keep all existing config keys.

- [ ] **Step 3: Write the entry**

Create `src/pocket-playground-entry.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PocketPlayground } from './components/dev/PocketPlayground';

const el = document.getElementById('pocket-root');
if (el) createRoot(el).render(<React.StrictMode><PocketPlayground /></React.StrictMode>);
```

- [ ] **Step 4: Write the playground component**

Create `src/components/dev/PocketPlayground.tsx`:

```tsx
import React, { useCallback, useRef, useState } from 'react';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import './PocketPlayground.scss';

type Status = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

/** Decode any audio file → mono Float32 + its sample rate. */
async function decodeToMono(file: File): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.numberOfChannels;
    if (ch === 1) return { samples: new Float32Array(audio.getChannelData(0)), sampleRate: audio.sampleRate };
    const out = new Float32Array(audio.length);
    for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ch; }
    return { samples: out, sampleRate: audio.sampleRate };
  } finally { await ctx.close(); }
}

export const PocketPlayground: React.FC = () => {
  const engineRef = useRef<TtsEngine | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [backend, setBackend] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState('');
  const [text, setText] = useState('Hello — this is a zero-shot cloned voice running fully in the browser.');
  const [ref, setRef] = useState<{ samples: Float32Array; sampleRate: number } | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [timing, setTiming] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading'); setStatusMsg('Loading model…');
    const engine = new TtsEngine();
    engine.onStatus = (m) => setStatusMsg(m);
    engine.onError = (e) => { setStatus('error'); setStatusMsg(e); };
    engineRef.current = engine;
    try {
      const info = await engine.init('pocket-tts');
      setBackend(info.backend ?? 'wasm'); setStatus('ready'); setStatusMsg('Ready');
    } catch (e) { setStatus('error'); setStatusMsg(e instanceof Error ? e.message : String(e)); }
  }, []);

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setRef(await decodeToMono(file)); setStatusMsg(`Reference: ${file.name}`);
  }, []);

  const toggleRecord = useCallback(async () => {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      setRef(await decodeToMono(new File([blob], 'recording.webm')));
      setStatusMsg('Reference: recording captured');
    };
    recorderRef.current = rec; rec.start(); setRecording(true);
  }, [recording]);

  const generate = useCallback(async () => {
    const engine = engineRef.current; if (!engine || !ref) return;
    setStatus('generating'); setStatusMsg('Generating…');
    try {
      const start = performance.now();
      // Send the reference (copy: postMessage transfers the buffer).
      const result = await engine.generateWithReference(text, new Float32Array(ref.samples), ref.sampleRate, speed);
      const wall = Math.round(performance.now() - start);
      const audioSecs = result.samples.length / result.sampleRate;
      setTiming(`${wall} ms · ${(audioSecs / (wall / 1000)).toFixed(2)}× realtime`);
      setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(toWav(result.samples, result.sampleRate)); });
      setStatus('ready'); setStatusMsg('Done');
    } catch (e) { setStatus('error'); setStatusMsg(e instanceof Error ? e.message : String(e)); }
  }, [text, ref, speed]);

  return (
    <div className="pocket-playground">
      <h1>Pocket TTS — Dev Playground</h1>
      <div className="status">{status === 'ready' || status === 'generating' ? `backend: ${backend} · ` : ''}{statusMsg}</div>
      {status === 'idle' && <button onClick={load}>Load model (~int8 bundle)</button>}
      {status !== 'idle' && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          <div className="ref-row">
            <label className="upload">Upload .wav<input type="file" accept="audio/*" hidden onChange={onUpload} /></label>
            <button onClick={toggleRecord}>{recording ? '■ Stop' : '● Record'}</button>
            <span>{ref ? `ref: ${(ref.samples.length / ref.sampleRate).toFixed(1)}s @ ${ref.sampleRate}Hz` : 'no reference yet'}</span>
          </div>
          <div className="gen-row">
            <label>Speed {speed.toFixed(1)}×<input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(+e.target.value)} /></label>
            <button disabled={!ref || status === 'generating'} onClick={generate}>▶ Generate</button>
          </div>
          {audioUrl && (
            <div className="out-row">
              <audio src={audioUrl} controls autoPlay />
              <a href={audioUrl} download="pocket-tts.wav">⬇ download</a>
              <span>{timing}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** Float32 PCM → 16-bit mono WAV Blob. */
function toWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let off = 44; for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([buffer], { type: 'audio/wav' });
}
```

- [ ] **Step 5: Add minimal styles**

Create `src/components/dev/PocketPlayground.scss`:

```scss
.pocket-playground {
  max-width: 640px; margin: 40px auto; padding: 24px; font-family: system-ui, sans-serif;
  color: #ddd; background: #1e1e1e; border-radius: 12px;
  h1 { font-size: 18px; }
  .status { color: #8b949e; font-size: 12px; margin-bottom: 12px; }
  textarea { width: 100%; background: #2a2a2a; color: #ddd; border: 1px solid #3a3a3a; border-radius: 6px; padding: 10px; }
  .ref-row, .gen-row, .out-row { display: flex; gap: 12px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  button, .upload { background: #10a37f; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .upload input { display: none; }
  a { color: #10a37f; }
}
```

- [ ] **Step 6: Verify it builds and serves**

Run: `npm run dev`
Then open `http://localhost:5173/pocket-playground.html`.
Expected: the playground renders with a "Load model" button; no console errors on load. (Full generation is exercised in Task 11.)

- [ ] **Step 7: Commit**

```bash
git add pocket-playground.html src/pocket-playground-entry.tsx src/components/dev/PocketPlayground.tsx src/components/dev/PocketPlayground.scss vite.config.ts
git commit -m "feat(pocket-tts): dev playground UI + Vite entry"
```

---

## Task 11: Finish the AR loop + manual end-to-end verification

The only remaining code is the hand-ported generate loop (the scaffold `throw` in Task 7). Everything else is committed and unit-tested. This task closes the loop and validates the full chain in a real browser.

**Files:**
- Modify: `src/lib/local-inference/pocket/pocketInferenceCore.ts`

- [ ] **Step 1: Port the AR loop**

Replace the `throw` in `generate()` (and complete `buildVoiceConditionedState`) by adapting the verified logic from `inference-worker.js` (`buildVoiceConditionedState`, the `for (step < MAX_FRAMES)` loop, the LSD refinement, and decoder batching), using:
- the tensor contracts in the Task 7 table,
- `applyStateUpdates(state, meta.flowLmState, runOutputs)` to thread flow state,
- a separate `mimiState` threaded with `meta.mimiState` for the decoder,
- EOS: stop after `eos_logit > -4.0` plus the source's `framesAfterEos`,
- `dt = 1 / lsdSteps`,
- concatenate decoder PCM chunks into one `Float32Array`.

- [ ] **Step 2: Typecheck + full unit suite**

Run: `npx tsc --noEmit && npm run test`
Expected: no type errors; all unit tests pass (the new ones from Tasks 3, 4, 6, 9 plus the existing suite).

- [ ] **Step 3: Manual end-to-end checklist (real browser)**

Ensure the bundle is present (`./scripts/download-pocket-tts-en.sh`), run `npm run dev`, open `http://localhost:5173/pocket-playground.html`, and verify:

- [ ] Model loads; status shows `backend: webgpu` (or `wasm` on unsupported devices).
- [ ] **Upload** a `.wav` → Generate → cloned speech plays and roughly matches the reference timbre.
- [ ] **Record** 5–10 s via mic → Generate → cloned speech plays.
- [ ] Changing **Speed** changes output duration/pace.
- [ ] Timing line shows a sane realtime factor; **Download** produces a playable WAV.
- [ ] Force WASM (a browser without WebGPU, or temporarily disable it) → still works via fallback; note the relative speed (validates the spec's INT8-on-WebGPU caveat).
- [ ] No uncaught console errors across the flow.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/pocket/pocketInferenceCore.ts
git commit -m "feat(pocket-tts): complete autoregressive generate loop + manual e2e verified"
```

---

## Done criteria

- `pocket-playground.html` (dev only) loads the int8 bundle, clones a voice from a recorded or uploaded reference, synthesizes typed text, and plays/downloads the result.
- WebGPU is used when available with automatic WASM fallback; backend is shown in the UI.
- The live translation pipeline (`LocalInferenceClient`, `generate`/`generateStream`) is untouched.
- Unit tests cover the tokenizer wrapper, state-threading helper, manifest entry, and the `TtsEngine` pocket branch; the browser-only inference path is covered by the manual checklist.
