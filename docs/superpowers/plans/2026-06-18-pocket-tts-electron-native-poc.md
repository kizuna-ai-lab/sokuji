# Pocket TTS — Electron Native (onnxruntime-node) PoC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove our `pocketInferenceCore` runs native-fast and correct on `onnxruntime-node`, both standalone (node bench) and inside Electron (utilityProcess + IPC driven from the dev playground behind a WASM-vs-native A/B toggle).

**Architecture:** Make the inference core runtime-neutral by injecting the ONNX `Tensor` constructor (the core's only runtime value dependency). The renderer Web worker injects `onnxruntime-web`'s `Tensor`; a Node bench script and an Electron `utilityProcess` inject `onnxruntime-node`'s `Tensor`. The renderer reaches the Node-context inference over `window.electron.invoke` → `ipcMain.handle` → utilityProcess.

**Tech Stack:** TypeScript, onnxruntime-web (renderer, existing) + onnxruntime-node (native, new), Electron 40 `utilityProcess`, Vite + vite-plugin-electron, Vitest, tsx.

## Global Constraints

- **Scope:** PoC, dev-gated, **dev-mode only** (`npm run electron:dev`). No production packaging, no `LocalInferenceClient` wiring, no clone UX, no GPU EPs, no streaming. (spec §Scope)
- **Branch:** `feat/pocket-tts-electron-native-poc` (already checked out; the spec commit is its HEAD).
- **The existing WASM Pocket path and the web build/tests must stay green** — native is purely additive behind a toggle. (spec §Success criteria 3)
- **English-only model** (`pocket-tts`, `languages:['en']`); reference content is perf-irrelevant.
- **Model files (dev):** read from disk at `public/wasm/pocket-tts-en/` (gitignored; downloaded by `scripts/download-pocket-tts-en.sh`). Files: `mimi_encoder_int8.onnx`, `text_conditioner_int8.onnx`, `flow_lm_main_int8.onnx`, `flow_lm_flow_int8.onnx`, `mimi_decoder_int8.onnx`, `tokenizer.model`, `bundle.json`, `bos_before_voice.npy`.
- **Commit messages:** English; conventional-commit prefix; end with the repo's `Co-Authored-By` trailer.
- **No push / no PR** without explicit per-action user consent.

---

### Task 1: Make `pocketInferenceCore` runtime-neutral via Tensor injection

The core (`pocketInferenceCore.ts`) currently imports `Tensor` (a runtime value) from the onnxruntime-web barrel. Its only runtime use of `Tensor` is `makeTensor` (`new Tensor(...)`); everywhere else `Tensor`/`InferenceSession` are types. Switch the import to type-only and inject the `Tensor` constructor, so the same core runs on web or node. Update the existing WASM worker to inject the web `Tensor`. The web path must remain byte-for-byte behaviorally identical.

**Files:**
- Modify: `src/lib/local-inference/pocket/pocketInferenceCore.ts:1` (import) and `:68-75` (`makeTensor`)
- Modify: `src/lib/local-inference/workers/pocket-tts.worker.ts:23-26` (import) and `:78-93` (`handleInit`)
- Test: `src/lib/local-inference/pocket/pocketInferenceCore.di.test.ts` (new)

**Interfaces:**
- Produces: `export type PocketTensorCtor = new (type: 'float32'|'int64'|'bool', data: Float32Array|BigInt64Array|Uint8Array, dims: number[]) => Tensor;` and `export function setPocketTensor(ctor: PocketTensorCtor): void` from `pocketInferenceCore.ts`. Existing exports (`encodeReference`, `buildVoiceConditionedState`, `generate`, `resampleTo24k`, `parseNpyFloat32`, `PocketSessions`, `PocketMetadata`) keep their current signatures.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing DI test**

Create `src/lib/local-inference/pocket/pocketInferenceCore.di.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

class FakeTensor {
  constructor(public type: string, public data: unknown, public dims: number[]) {}
}

describe('pocketInferenceCore DI seam', () => {
  it('resampleTo24k: identity at 24kHz, length-scales otherwise', async () => {
    const { resampleTo24k } = await import('./pocketInferenceCore');
    const a = new Float32Array([0, 1, 0, -1]);
    expect(resampleTo24k(a, 24000)).toBe(a);
    expect(resampleTo24k(a, 12000).length).toBe(8);
  });

  it('parseNpyFloat32 reads a v1.0 little-endian float32 npy', async () => {
    const { parseNpyFloat32 } = await import('./pocketInferenceCore');
    const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (2,), }";
    const buf = new ArrayBuffer(10 + header.length + 8);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    u8.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59], 0); // \x93NUMPY
    dv.setUint8(6, 1); dv.setUint8(7, 0);
    dv.setUint16(8, header.length, true);
    for (let i = 0; i < header.length; i++) u8[10 + i] = header.charCodeAt(i);
    new Float32Array(buf, 10 + header.length, 2).set([1.5, -2.25]);
    expect(Array.from(parseNpyFloat32(buf))).toEqual([1.5, -2.25]);
  });

  it('throws a clear error if Tensor is not injected', async () => {
    vi.resetModules();
    const core = await import('./pocketInferenceCore');
    const meta = {
      flow_lm_state_manifest: [{ input_name: 's_in', output_name: 's_out', dtype: 'float32', shape: [1, 2], fill: 'zeros' }],
      mimi_state_manifest: [], latent_dim: 32,
    } as never;
    const fakeSession = { outputNames: ['o'], run: async () => ({}) };
    const sessions = { flowLmMain: fakeSession } as never;
    const voiceEmb = new FakeTensor('float32', new Float32Array(32), [1, 1, 32]) as never;
    await expect(core.buildVoiceConditionedState(sessions, meta, voiceEmb, null))
      .rejects.toThrow(/Tensor not injected/);
  });

  it('uses the injected Tensor ctor and threads manifest state', async () => {
    vi.resetModules();
    const core = await import('./pocketInferenceCore');
    core.setPocketTensor(FakeTensor as never);
    const meta = {
      flow_lm_state_manifest: [{ input_name: 's_in', output_name: 's_out', dtype: 'float32', shape: [1, 2], fill: 'zeros' }],
      mimi_state_manifest: [], latent_dim: 32,
    } as never;
    const sOut = new FakeTensor('float32', new Float32Array([9, 9]), [1, 2]);
    const flowLmMain = { outputNames: ['s_out'], run: async () => ({ s_out: sOut }) };
    const sessions = { flowLmMain } as never;
    const voiceEmb = new FakeTensor('float32', new Float32Array(32), [1, 1, 32]) as never;
    const state = await core.buildVoiceConditionedState(sessions, meta, voiceEmb, null);
    expect(state['s_in']).toBe(sOut);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/local-inference/pocket/pocketInferenceCore.di.test.ts`
Expected: FAIL — `setPocketTensor` is not exported (the "throws if not injected" and "uses injected" cases error on missing export / wrong behavior).

- [ ] **Step 3: Refactor the core import + makeTensor + add the setter**

In `src/lib/local-inference/pocket/pocketInferenceCore.ts`, replace line 1:

```ts
import { InferenceSession, Tensor } from '../workers/_shared/onnxruntime-all';
```

with:

```ts
// Runtime-neutral: TYPES only (erased at build, no runtime pulled in). The Tensor
// *constructor* is injected via setPocketTensor() so this core runs on onnxruntime-web
// (renderer worker) OR onnxruntime-node (Electron utilityProcess / node bench). Both
// re-export onnxruntime-common's Tensor, so either constructor fits PocketTensorCtor.
import type { InferenceSession, Tensor } from 'onnxruntime-web';
```

Then replace the `makeTensor` block (`:68-75`):

```ts
type OrtTensor = Tensor;
type TensorMap = Record<string, OrtTensor>;

const makeTensor = (
  dtype: 'float32' | 'int64' | 'bool',
  data: Float32Array | BigInt64Array | Uint8Array,
  dims: number[],
): OrtTensor => new Tensor(dtype, data as never, dims);
```

with:

```ts
type OrtTensor = Tensor;
type TensorMap = Record<string, OrtTensor>;

/** The ONNX `Tensor` constructor, injected per-runtime via setPocketTensor(). */
export type PocketTensorCtor = new (
  type: 'float32' | 'int64' | 'bool',
  data: Float32Array | BigInt64Array | Uint8Array,
  dims: number[],
) => OrtTensor;

let injectedTensor: PocketTensorCtor | null = null;

/**
 * Inject the ONNX `Tensor` constructor before any encode/generate call:
 *   renderer worker → setPocketTensor(Tensor)  // onnxruntime-web
 *   node host       → setPocketTensor(Tensor)  // onnxruntime-node
 */
export function setPocketTensor(ctor: PocketTensorCtor): void {
  injectedTensor = ctor;
}

const makeTensor = (
  dtype: 'float32' | 'int64' | 'bool',
  data: Float32Array | BigInt64Array | Uint8Array,
  dims: number[],
): OrtTensor => {
  if (!injectedTensor) {
    throw new Error('pocketInferenceCore: Tensor not injected — call setPocketTensor() first');
  }
  return new injectedTensor(dtype, data, dims);
};
```

(No other lines change — `Tensor`/`InferenceSession`/`InferenceSession.OnnxValueMapType` remain valid as type-only references.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/local-inference/pocket/pocketInferenceCore.di.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Inject the web Tensor in the WASM worker**

In `src/lib/local-inference/workers/pocket-tts.worker.ts`, replace the core import (`:23-26`):

```ts
import {
  encodeReference, resampleTo24k, buildVoiceConditionedState, generate, parseNpyFloat32,
  type PocketSessions, type PocketMetadata,
} from '../pocket/pocketInferenceCore';
```

with:

```ts
import {
  encodeReference, resampleTo24k, buildVoiceConditionedState, generate, parseNpyFloat32,
  setPocketTensor, type PocketSessions, type PocketMetadata, type PocketTensorCtor,
} from '../pocket/pocketInferenceCore';
```

Then, in `handleInit`, immediately after `ortEnv.wasm.simd = true;` (`:83`), add:

```ts
  setPocketTensor(Tensor as unknown as PocketTensorCtor); // inject onnxruntime-web Tensor into the core
```

(`Tensor` is already imported at `:12` from the barrel.)

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run src/lib/local-inference/pocket`
Expected: PASS (existing pocket tests + the new DI test).

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/pocket/pocketInferenceCore.ts \
        src/lib/local-inference/pocket/pocketInferenceCore.di.test.ts \
        src/lib/local-inference/workers/pocket-tts.worker.ts
git commit -m "refactor(pocket-tts): inject Tensor into inference core for runtime portability

Switch pocketInferenceCore to a type-only onnxruntime-web import and inject the
Tensor constructor via setPocketTensor(), so the same core runs on onnxruntime-web
(renderer worker) or onnxruntime-node (native). The WASM worker now injects the web
Tensor; behavior is unchanged. Adds a DI unit test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Node benchmark — prove the core runs native-fast on onnxruntime-node

Un-stub `onnxruntime-node`, then run our core against it in plain Node and measure RTF. This is the highest-signal, lowest-cost milestone: it proves our TS core (not just sherpa's C++) is native-fast and correct, with no Electron involved.

**Files:**
- Modify: `package.json:137-141` (overrides) and `:94-132` (dependencies)
- Create: `scripts/bench-pocket-native.ts`

**Interfaces:**
- Consumes: `setPocketTensor`, `encodeReference`, `buildVoiceConditionedState`, `generate`, `resampleTo24k`, `parseNpyFloat32`, `PocketSessions`, `PocketMetadata`, `PocketTensorCtor` from Task 1; `POCKET_MODEL_STEMS`, `POCKET_SAMPLE_RATE`, `POCKET_METADATA_FILE`, `POCKET_TOKENIZER_FILE`, `POCKET_BOS_FILE`, `PocketSessionId` from `pocketBundle`; `PocketTokenizer` from `pocketTokenizer`.
- Produces: nothing consumed by later tasks (standalone script).

- [ ] **Step 1: Un-stub onnxruntime-node and install it**

In `package.json`, delete the override line (`:140`):

```json
    "onnxruntime-node": "npm:empty-npm-package@1.0.0"
```

(Keep `"form-data"` and `"axios"` overrides; remove the trailing comma issue — after removal the `overrides` block is `{ "form-data": "^4.0.4", "axios": "^1.9.0" }`.)

Determine the resolved onnxruntime-web version so the native binding matches its ONNX opset:

Run: `npm ls onnxruntime-web`
Expected: prints a version, e.g. `onnxruntime-web@1.20.1`.

Install onnxruntime-node pinned to that exact version (substitute the printed version; if `npm ls` shows none, use `1.20.1`):

Run: `npm install --save-exact onnxruntime-node@<printed-version>`
Expected: installs `onnxruntime-node` into `dependencies`; `postinstall` (`electron-rebuild`) runs. If `electron-rebuild` errors on onnxruntime-node, it does not block this task (the bench runs in plain Node, not Electron) — note it for Task 3.

- [ ] **Step 2: Verify onnxruntime-node loads in plain Node**

Run: `node -e "const ort=require('onnxruntime-node'); console.log('ort-node', ort.Tensor ? 'ok' : 'missing')"`
Expected: `ort-node ok`.

- [ ] **Step 3: Write the benchmark script**

Create `scripts/bench-pocket-native.ts`:

```ts
/**
 * Native Pocket TTS benchmark — runs our pocketInferenceCore on onnxruntime-node
 * (native CPU) and reports realtime factor (RTF). Proves the TS core is native-fast,
 * isolating the WASM tax measured in the browser (~0.6x). Run: npx tsx scripts/bench-pocket-native.ts
 */
import { InferenceSession, Tensor } from 'onnxruntime-node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  setPocketTensor, encodeReference, resampleTo24k, buildVoiceConditionedState, generate,
  parseNpyFloat32, type PocketSessions, type PocketMetadata, type PocketTensorCtor,
} from '../src/lib/local-inference/pocket/pocketInferenceCore';
import { PocketTokenizer } from '../src/lib/local-inference/pocket/pocketTokenizer';
import {
  POCKET_MODEL_STEMS, POCKET_SAMPLE_RATE, POCKET_METADATA_FILE,
  POCKET_TOKENIZER_FILE, POCKET_BOS_FILE, type PocketSessionId,
} from '../src/lib/local-inference/pocket/pocketBundle';

const MODEL_DIR = path.join(process.cwd(), 'public', 'wasm', 'pocket-tts-en');
const REF = path.join(process.cwd(), 'benchmark', 'test-speech-silence-speech.wav');
const TEXT = 'All processing is done locally on your device (CPU) within your browser '
  + 'with a single thread. No server is involved, ensuring privacy and security. '
  + 'You can disconnect from the Internet once this page is loaded.';

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

/** Minimal 16-bit PCM WAV reader → mono Float32 + sampleRate. */
function readWavMono(p: string): { samples: Float32Array; sampleRate: number } {
  const b = fs.readFileSync(p);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const numChannels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  const bps = dv.getUint16(34, true);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') {
      const start = off + 8;
      const n = Math.floor(size / (bps / 8) / numChannels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let c = 0; c < numChannels; c++) acc += dv.getInt16(start + (i * numChannels + c) * 2, true) / 32768;
        out[i] = acc / numChannels;
      }
      return { samples: out, sampleRate };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${p}`);
}

/** Float32 → 16-bit mono WAV file. */
function writeWav(p: string, samples: Float32Array, sampleRate: number): void {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, off); off += 2;
  }
  fs.writeFileSync(p, buf);
}

async function loadSessions(threads: number): Promise<PocketSessions> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: threads, logSeverityLevel: 3,
  };
  const created: Partial<PocketSessions> = {};
  for (const id of Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[]) {
    created[id] = await InferenceSession.create(path.join(MODEL_DIR, POCKET_MODEL_STEMS[id]), opts) as never;
  }
  return created as unknown as PocketSessions;
}

async function main() {
  setPocketTensor(Tensor as unknown as PocketTensorCtor);

  const meta = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, POCKET_METADATA_FILE), 'utf8')) as PocketMetadata;
  const bos = meta.insert_bos_before_voice
    ? parseNpyFloat32(toAB(fs.readFileSync(path.join(MODEL_DIR, POCKET_BOS_FILE))))
    : null;
  const tokenizer = new PocketTokenizer();
  await tokenizer.load(toAB(fs.readFileSync(path.join(MODEL_DIR, POCKET_TOKENIZER_FILE))));
  const ref = readWavMono(REF);
  const ref24 = resampleTo24k(ref.samples, ref.sampleRate);
  console.log(`reference: ${(ref.samples.length / ref.sampleRate).toFixed(2)}s @ ${ref.sampleRate}Hz`);

  console.log('\n# native onnxruntime-node Pocket TTS (provider=cpu, int8)');
  console.log(`${'threads'.padStart(7)} ${'cache'.padStart(5)} ${'audioS'.padStart(7)} ${'genMs'.padStart(7)} ${'RTF'.padStart(6)}`);

  for (const threads of [1, 4, 8]) {
    const sessions = await loadSessions(threads);
    const voiceEmb = await encodeReference(sessions, ref24);
    const flowState = await buildVoiceConditionedState(sessions, meta, voiceEmb, bos);
    const ids = tokenizer.encodeIds(TEXT);
    const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
    const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds as unknown as never });
    const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]];

    let best: { audioSec: number; genMs: number } | null = null;
    for (let rep = 0; rep < 3; rep++) {
      const t0 = performance.now();
      const samples = await generate(
        sessions, meta, textEmbeddings as never, { ...flowState },
        { lsdSteps: 1, maxFrames: 500, speed: 1.0 },
      );
      const genMs = performance.now() - t0;
      const audioSec = samples.length / POCKET_SAMPLE_RATE;
      if (!best || genMs < best.genMs) best = { audioSec, genMs };
      if (threads === 8 && rep === 0) writeWav(path.join(process.cwd(), 'out_native.wav'), samples, POCKET_SAMPLE_RATE);
    }
    const rtf = best!.audioSec / (best!.genMs / 1000);
    const cache = 'hit'; // voice embedding reused across reps on the same sessions
    console.log(`${String(threads).padStart(7)} ${cache.padStart(5)} ${best!.audioSec.toFixed(2).padStart(7)} ${Math.round(best!.genMs).toString().padStart(7)} ${rtf.toFixed(2).padStart(6)}`);
  }
  console.log('\nWASM baseline (same engine, browser): ~0.65x. wrote out_native.wav');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the benchmark**

Run: `npx tsx scripts/bench-pocket-native.ts`
Expected: an RTF table where the best RTF is **≥ ~1×** (on a modern desktop CPU expect ~2–4×), and `out_native.wav` is written. If `npx tsx` reports `onnxruntime-web` was loaded, the type-only import regressed — re-check Task 1 Step 3.

- [ ] **Step 5: Listen-check the output**

Play `out_native.wav` (e.g. `ffplay out_native.wav` or any player). Expected: intelligible English speech in the reference voice (cloned). This confirms correctness, not just speed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/bench-pocket-native.ts
git commit -m "feat(pocket-tts): native onnxruntime-node benchmark for the inference core

Un-stub onnxruntime-node and add a node bench that runs pocketInferenceCore natively
(CPU, int8), reporting RTF and dumping out_native.wav. Proves the TS core is native-fast
(>=1x realtime) vs the browser WASM ceiling (~0.65x).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(`out_native.wav` is a build artifact — do not commit it. Add it to `.gitignore` in this step if it is not already ignored: append `out_native.wav`.)

---

### Task 3: Electron utilityProcess + IPC + playground native toggle (end-to-end)

Run the core in an Electron `utilityProcess` (Node context, native onnxruntime-node, non-blocking), expose it over IPC, and drive it from the dev playground via a "Native (Electron)" toggle. Verified end-to-end in `electron:dev`.

**Files:**
- Create: `electron/pocket-native-process.ts` (utilityProcess entry)
- Create: `src/lib/local-inference/pocketNativeClient.ts` (renderer IPC client)
- Modify: `vite.config.ts:121-131` (electron entries) and `:142` (external)
- Modify: `electron/main.js:1` (require), `:76` (insert IPC block), `:291-298` (dev load), `:408-412` (cleanup)
- Modify: `electron/preload.js:103-145` (invoke whitelist)
- Modify: `src/components/dev/PocketPlayground.tsx` (native toggle + backend selection)

**Interfaces:**
- Consumes: Task 1 core exports; Task 2's installed `onnxruntime-node`; existing `TtsResult` (`{samples:Float32Array, sampleRate:number, generationTimeMs:number}`) from `engine/TtsEngine`.
- IPC contract:
  - `pocket-native:init` → request `{}` → reply `{loadTimeMs:number, sampleRate:number, numSpeakers:number}`
  - `pocket-native:generate` → request `{text:string, referenceAudio?:Float32Array, referenceSampleRate?:number, useCachedVoice?:boolean, speed?:number}` → reply `{samples:Float32Array, sampleRate:number, generationTimeMs:number}`
- Produces: `export class PocketNativeClient` with `onStatus`, `onError`, `init(): Promise<{backend:string; sampleRate:number; loadTimeMs:number}>`, `generateWithReference(text, referenceAudio: Float32Array|null, referenceSampleRate, speed?): Promise<TtsResult>` — mirrors the `TtsEngine` slice the playground uses.

- [ ] **Step 1: Write the utilityProcess entry**

Create `electron/pocket-native-process.ts`:

```ts
/**
 * Pocket TTS native runtime — Electron utilityProcess (Node context).
 * Runs pocketInferenceCore on onnxruntime-node (native CPU), driven by main.js over
 * parentPort. Dev PoC: model files read from disk (modelDir passed in the init message).
 */
import { InferenceSession, Tensor } from 'onnxruntime-node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  setPocketTensor, encodeReference, resampleTo24k, buildVoiceConditionedState, generate,
  parseNpyFloat32, type PocketSessions, type PocketMetadata, type PocketTensorCtor,
} from '../src/lib/local-inference/pocket/pocketInferenceCore';
import { PocketTokenizer } from '../src/lib/local-inference/pocket/pocketTokenizer';
import {
  POCKET_MODEL_STEMS, POCKET_SAMPLE_RATE, POCKET_METADATA_FILE,
  POCKET_TOKENIZER_FILE, POCKET_BOS_FILE, type PocketSessionId,
} from '../src/lib/local-inference/pocket/pocketBundle';
import type { StateMap } from '../src/lib/local-inference/pocket/pocketState';

setPocketTensor(Tensor as unknown as PocketTensorCtor);

const parentPort = (process as unknown as {
  parentPort: { on(ev: 'message', cb: (e: { data: any }) => void): void; postMessage(msg: any): void };
}).parentPort;

let sessions: PocketSessions | null = null;
let meta: PocketMetadata | null = null;
let tokenizer: PocketTokenizer | null = null;
let cachedFlowState: StateMap | null = null;
let bos: Float32Array | null = null;

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

async function loadSessions(modelDir: string): Promise<PocketSessions> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3,
  };
  const created: Partial<PocketSessions> = {};
  for (const id of Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[]) {
    created[id] = await InferenceSession.create(path.join(modelDir, POCKET_MODEL_STEMS[id]), opts) as never;
  }
  return created as unknown as PocketSessions;
}

async function handleInit(modelDir: string) {
  const start = Date.now();
  sessions = await loadSessions(modelDir);
  meta = JSON.parse(fs.readFileSync(path.join(modelDir, POCKET_METADATA_FILE), 'utf8')) as PocketMetadata;
  bos = meta.insert_bos_before_voice
    ? parseNpyFloat32(toAB(fs.readFileSync(path.join(modelDir, POCKET_BOS_FILE))))
    : null;
  tokenizer = new PocketTokenizer();
  await tokenizer.load(toAB(fs.readFileSync(path.join(modelDir, POCKET_TOKENIZER_FILE))));
  return { loadTimeMs: Date.now() - start, sampleRate: POCKET_SAMPLE_RATE, numSpeakers: 1 };
}

async function handleGenerate(msg: any) {
  if (!sessions || !meta || !tokenizer) throw new Error('Pocket native engine not initialized');
  const start = Date.now();
  if (msg.referenceAudio && !msg.useCachedVoice) {
    const ref24 = resampleTo24k(msg.referenceAudio as Float32Array, msg.referenceSampleRate ?? POCKET_SAMPLE_RATE);
    const voiceEmb = await encodeReference(sessions, ref24);
    cachedFlowState = await buildVoiceConditionedState(sessions, meta, voiceEmb, bos);
  }
  if (!cachedFlowState) throw new Error('No reference voice set');
  const ids = tokenizer.encodeIds(msg.text);
  const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
  const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds as unknown as never });
  const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]];
  const samples = await generate(
    sessions, meta, textEmbeddings as never, { ...cachedFlowState },
    { lsdSteps: 1, maxFrames: 500, speed: msg.speed ?? 1.0, log: (m) => console.log(m) },
  );
  return { samples, sampleRate: POCKET_SAMPLE_RATE, generationTimeMs: Date.now() - start };
}

parentPort.on('message', async (e) => {
  const msg = e.data;
  try {
    let result;
    if (msg.type === 'init') result = await handleInit(msg.modelDir);
    else if (msg.type === 'generate') result = await handleGenerate(msg);
    else throw new Error(`unknown message type: ${msg.type}`);
    parentPort.postMessage({ id: msg.id, result });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
```

- [ ] **Step 2: Register the entry and externalize onnxruntime-node in Vite**

In `vite.config.ts`, add the entry to the electron `main.entry` map (after `'update-manager': 'electron/update-manager.js'` at `:130`):

```ts
            'update-manager': 'electron/update-manager.js',
            'pocket-native-process': 'electron/pocket-native-process.ts'
```

And add `onnxruntime-node` to the `external` array (`:142`):

```ts
                external: ['electron', 'electron-squirrel-startup', 'electron-conf', 'electron-audio-loopback', 'electron-updater', 'onnxruntime-node'],
```

- [ ] **Step 3: Build the electron bundle to verify the entry compiles**

Run: `npx tsc --noEmit`
Expected: no errors (the new `.ts` files typecheck; onnxruntime-node types resolve).

Run: `SOKUJI_NO_ELECTRON= npx vite build --mode development 2>&1 | tail -20`
Expected: build succeeds and `dist-electron/pocket-native-process.js` exists (check with `ls dist-electron/pocket-native-process.js`). The `require("onnxruntime-node")` is left external (not bundled).

- [ ] **Step 4: Wire main.js — require, IPC block, cleanup, dev load**

(a) In `electron/main.js:1`, add `utilityProcess` to the destructure:

```js
const { app, BrowserWindow, ipcMain, Menu, dialog, shell, session, systemPreferences, desktopCapturer, utilityProcess } = require('electron');
```

(b) Immediately after `let mainWindow;` (`:76`), insert the IPC block:

```js
// ---- Pocket TTS native (onnxruntime-node) PoC: utilityProcess + IPC (dev only) ----
let pocketProc = null;
let pocketReqId = 0;
const pocketPending = new Map();

function ensurePocketProc() {
  if (pocketProc) return pocketProc;
  const proc = utilityProcess.fork(path.join(__dirname, 'pocket-native-process.js'), [], { stdio: 'pipe' });
  proc.on('message', (msg) => {
    const p = pocketPending.get(msg.id);
    if (!p) return;
    pocketPending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
  });
  proc.on('exit', (code) => {
    for (const p of pocketPending.values()) p.reject(new Error(`pocket-native process exited (code ${code})`));
    pocketPending.clear();
    pocketProc = null;
  });
  proc.stdout?.on('data', (d) => console.log('[pocket-native]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d) => console.error('[pocket-native]', d.toString().trimEnd()));
  pocketProc = proc;
  return proc;
}

function pocketRequest(payload) {
  const proc = ensurePocketProc();
  const id = ++pocketReqId;
  return new Promise((resolve, reject) => {
    pocketPending.set(id, { resolve, reject });
    proc.postMessage({ id, ...payload });
  });
}

ipcMain.handle('pocket-native:init', async () => {
  const modelDir = path.join(process.cwd(), 'public', 'wasm', 'pocket-tts-en');
  return pocketRequest({ type: 'init', modelDir });
});
ipcMain.handle('pocket-native:generate', async (event, data) => pocketRequest({ type: 'generate', ...data }));
```

(c) In `cleanupAndExit` (`:408-412`), add the kill before the final log:

```js
const cleanupAndExit = () => {
  console.log('[Sokuji] [Main] Cleaning up virtual audio devices before exit...');
  removeVirtualAudioDevices();
  if (pocketProc) { try { pocketProc.kill(); } catch (e) { /* ignore */ } pocketProc = null; }
  console.log('[Sokuji] [Main] Virtual audio devices cleaned up successfully');
};
```

(d) In the dev-load branch (`:291-293`), swap to optionally load the playground:

```js
  if (isDev) {
    const devUrl = process.env.SOKUJI_POCKET_PLAYGROUND === '1'
      ? 'http://localhost:5173/pocket-playground.html'
      : 'http://localhost:5173';
    console.log(`[Sokuji] [Main] Loading from ${devUrl} at ${loadStartTime}`);
    mainWindow.loadURL(devUrl);
  } else {
```

- [ ] **Step 5: Whitelist the IPC channels in preload**

In `electron/preload.js`, inside the `invoke` `validChannels` array, add the two channels (e.g. after `'get-app-version',` at `:133`):

```js
        'get-app-version',
        // Pocket TTS native PoC (dev)
        'pocket-native:init',
        'pocket-native:generate',
```

- [ ] **Step 6: Write the renderer IPC client**

Create `src/lib/local-inference/pocketNativeClient.ts`:

```ts
/**
 * Renderer-side client for the Electron-native Pocket runtime (utilityProcess).
 * Mirrors the slice of TtsEngine the dev playground uses, but generation runs natively
 * on onnxruntime-node in the main/utility process over window.electron.invoke.
 */
import type { TtsResult } from './engine/TtsEngine';

type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

interface ElectronInvoke {
  invoke(channel: string, data?: unknown): Promise<any>;
}
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class PocketNativeClient {
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;
  private _sampleRate = 24000;

  async init(): Promise<{ backend: string; sampleRate: number; loadTimeMs: number }> {
    this.onStatus?.('[pocket-native] loading model in utilityProcess…');
    const r = await electron().invoke('pocket-native:init', {});
    this._sampleRate = r.sampleRate;
    this.onStatus?.(`[pocket-native] ready (loadMs=${r.loadTimeMs})`);
    return { backend: 'cpu-native', sampleRate: r.sampleRate, loadTimeMs: r.loadTimeMs };
  }

  async generateWithReference(
    text: string, referenceAudio: Float32Array | null, referenceSampleRate: number, speed = 1.0,
  ): Promise<TtsResult> {
    const payload = referenceAudio
      ? { text, referenceAudio, referenceSampleRate, speed }
      : { text, useCachedVoice: true, speed };
    const r = await electron().invoke('pocket-native:generate', payload);
    return { samples: r.samples as Float32Array, sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }
}
```

- [ ] **Step 7: Add the native toggle to the playground**

In `src/components/dev/PocketPlayground.tsx`:

(a) Add imports near the top (after `:2`):

```tsx
import { PocketNativeClient } from '../../lib/local-inference/pocketNativeClient';
import { isElectron } from '../../utils/environment';
```

(b) Change the engine ref type (`:22`) and add a toggle state (after `:23`):

```tsx
  const engineRef = useRef<TtsEngine | PocketNativeClient | null>(null);
  const refDirty = useRef(true);
  const [useNative, setUseNative] = useState(false);
```

(c) Replace the body of `load` (`:40-51`) so it constructs the chosen backend:

```tsx
  const load = useCallback(async () => {
    setStatus('loading'); setStatusMsg('Loading model…'); addLog('--- load ---');
    const native = useNative && isElectron();
    const engine = native ? new PocketNativeClient() : new TtsEngine();
    engine.onStatus = (m: string) => { setStatusMsg(m); addLog(m); };
    engine.onError = (e: string) => { setStatus('error'); setStatusMsg(e); addLog('ERROR ' + e); };
    engineRef.current = engine;
    try {
      const info = native
        ? await (engine as PocketNativeClient).init()
        : await (engine as TtsEngine).init('pocket-tts');
      setBackend(info.backend ?? 'wasm'); setStatus('ready'); setStatusMsg('Ready');
      addLog(`ready: backend=${info.backend} sampleRate=${info.sampleRate} loadMs=${info.loadTimeMs}`);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setStatus('error'); setStatusMsg(m); addLog('LOAD ERROR ' + m); }
  }, [addLog, useNative]);
```

(d) Render the toggle when in Electron, above the Load button (replace `:103`):

```tsx
      {status === 'idle' && (
        <>
          {isElectron() && (
            <label className="native-toggle">
              <input type="checkbox" checked={useNative} onChange={(e) => setUseNative(e.target.checked)} />
              Native (Electron / onnxruntime-node)
            </label>
          )}
          <button onClick={load}>Load model (~int8 bundle)</button>
        </>
      )}
```

(`generate` is unchanged — `engineRef.current.generateWithReference(...)` has the same signature on both backends. Cast at the call site if tsc complains: `(engineRef.current as PocketNativeClient | TtsEngine).generateWithReference(...)`.)

- [ ] **Step 8: Typecheck and run the web suite (web path unaffected)**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: full suite green (the existing ~1100+ tests + the Task 1 DI test).

- [ ] **Step 9: End-to-end verification in Electron (the acceptance gate)**

Run: `SOKUJI_POCKET_PLAYGROUND=1 npm run electron:dev`
Then in the Electron window:
1. Check **"Native (Electron / onnxruntime-node)"**, click **Load model** → status shows `backend=cpu-native`, log shows the utilityProcess loaded (watch the terminal for `[pocket-native]` lines).
2. Upload or record a reference voice, click **Generate**.
3. Expected: cloned audio plays, the timing line shows **RTF ≥ ~1×** (expect well above 1× on a desktop CPU), the log shows `gen done`, and **the window stays responsive during generation** (utilityProcess is not the main process).
4. A/B: uncheck the toggle, reload the page, Load again → `backend=wasm`, Generate → same audio, ~0.6× RTF. Confirms both paths coexist.

If onnxruntime-node fails to load in the utilityProcess with a `NODE_MODULE_VERSION` / ABI mismatch, rebuild for Electron's ABI: `npx @electron/rebuild -f -w onnxruntime-node`, then re-run. (Known native-module risk; see spec §Error handling.)

- [ ] **Step 10: Commit**

```bash
git add electron/pocket-native-process.ts electron/main.js electron/preload.js \
        vite.config.ts src/lib/local-inference/pocketNativeClient.ts \
        src/components/dev/PocketPlayground.tsx
git commit -m "feat(pocket-tts): Electron-native Pocket via onnxruntime-node utilityProcess

Run pocketInferenceCore natively in an Electron utilityProcess (non-blocking),
exposed over IPC (pocket-native:init/generate) and driven from the dev playground
behind a WASM-vs-native toggle. SOKUJI_POCKET_PLAYGROUND=1 opens the playground in
the Electron window. Dev-only; packaging deferred.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- DI portability seam → Task 1. ✓
- Milestone 1 (node bench, RTF + wav) → Task 2. ✓
- Milestone 2 (utilityProcess + IPC + preload + renderer client + playground toggle + dev mount) → Task 3. ✓
- Config (un-stub override, add dep, vite external + entry) → Task 2 Step 1, Task 3 Step 2. ✓
- Error handling (utilityProcess load/generate errors surfaced, WASM path unaffected) → Task 3 Steps 1/6 (try/catch → reject → playground log) + Step 9 ABI note. ✓
- Testing (bench RTF + listen, E2E toggle, tsc + vitest green, DI unit test) → Task 1 Steps 4/6, Task 2 Steps 4/5, Task 3 Steps 8/9. ✓
- Success criteria 1/2/3 → Task 2 (criterion 1), Task 3 Step 9 (criterion 2), Task 1 Step 6 + Task 3 Step 8 (criterion 3). ✓

**Out-of-scope items** (packaging, real-pipeline wiring, clone UX, GPU, non-English, streaming) are absent from the tasks. ✓

**Type consistency:** `PocketTensorCtor` / `setPocketTensor` defined in Task 1 and consumed verbatim in Tasks 2–3. The IPC contract (`pocket-native:init`/`:generate` shapes) is identical across `pocket-native-process.ts`, `main.js`, and `pocketNativeClient.ts`. `TtsResult` `{samples, sampleRate, generationTimeMs}` is reused, not redefined. `generateWithReference(text, referenceAudio: Float32Array|null, referenceSampleRate, speed?)` matches the existing `TtsEngine` signature so the playground call site is backend-agnostic. ✓

**Known risk (flagged, not a blocker):** onnxruntime-node ABI in Electron's utilityProcess — mitigation in Task 3 Step 9. The node bench (Task 2) runs in plain Node and is unaffected.
