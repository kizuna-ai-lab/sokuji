# Smart Turn in the Front End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Local Inference's Auto turns, a vad-web ASR model can end a segment as soon as Smart Turn v3.2 says a short pause is the end of a finished sentence, instead of always waiting for the 1.4 s silence rule.

**Architecture:**
- One Smart Turn worker for the whole app (`turn-webgpu.worker.ts` on WebGPU, `turn-wasm.worker.ts` otherwise), owned by `TurnRuntime` on the main thread. It loads the fp32 model from IndexedDB on the first connection and answers one prediction at a time.
- Each vad-web ASR worker gets a `MessagePort` to it in its init message. Inside the worker, `_shared/turn-gate.ts` watches the FrameProcessor loop. After `checkAfter` of silence, once the segment holds the FrameProcessor's minimum speech, it posts the segment's last ≤ 8 s. A "finished" answer ends the segment through `frameProcessor.endSegment`, the same fire-and-forget path as the max-speech cap. Any other answer, or none, leaves the segment to the 1.4 s rule.
- The setting is `vadEndOfTurn: 'normal' | 'smart'` plus two sliders. The model downloads the first time the user picks Smart, and the setting flips to `'smart'` only once the model is on disk.

**Tech Stack:** TypeScript, onnxruntime-web (`_shared/onnxruntime-webgpu` and `_shared/onnxruntime-all`), @ricky0123/vad-web FrameProcessor, React, Zustand, Vitest + jsdom, i18next catalogs (`src/locales/*/translation.json`, 30 locales). Python with `transformers` generates the fixtures (`/home/jiangzhuo/Desktop/kizunaai/vad-diar-bench/.venv`).

**Spec:** `docs/superpowers/specs/2026-10-07-smart-turn-frontend-design.md` (decisions D1–D4 final).

**Working copy:** a branch from `main` at `b4391e6f` or later (for example `feat/smart-turn-frontend` in a worktree under `.claude/worktrees/`). Run every command from the worktree root. The spec and this plan go in the branch's first commit, `docs: Smart Turn front-end spec and plan`, if they are not on it yet.

## Global Constraints

- **Model:** `pipecat-ai/smart-turn-v3`, revision `f766f81d3cfdf7737ac64aad813d91bbfd56bf93`, file `smart-turn-v3.2-gpu.onnx`, 32,411,198 bytes (sha256 `ab8dc64b88713f90…`), manifest id `smart-turn-v3.2`, `ModelType` `'turn'`. fp32 on every device. Never use the int8 `smart-turn-v3.2-cpu.onnx`.
- **I/O:** input `input_features` float32 `[1, 80, 800]`. Output `logits` `[1, 1]` is already a sigmoid probability.
- **Features:** take the last 128,000 samples of 16 kHz audio and zero-pad at the front to 128,000. Normalise the padded window to zero mean and unit variance (eps `1e-7`). Then apply `logMel(w, filters)` from `_shared/log-mel.ts` with Whisper's 80-mel Slaney filterbank (`n_fft` 400 → 201 bins, 0–8000 Hz), computed in code. Result: `[80][800]`.
- **Backends:** WebGPU (`onnxruntime-web/webgpu`, adapter bound with `bindCheckedWebGpuAdapter`) when available. Otherwise, and after any WebGPU load failure or worker crash, use WASM (`onnxruntime-web`). WASM threads are `crossOriginIsolated ? Math.min(4, hardwareConcurrency) : 1` (`numThreadsFor()`). There is no memory gate: Smart Turn is available on every device.
- **Settings:** `vadEndOfTurn` `'normal' | 'smart'` (default `'normal'`). `smartTurnCheckAfter` 0.10–0.50 s, step 0.05, default 0.30. `smartTurnThreshold` 0.30–0.90, step 0.05, default 0.50. The fallback is the existing `vadMinSilenceDuration`, labelled **Max Wait** in Smart.
- **Clamp:** `checkAfter = min(smartTurnCheckAfter, vadMinSilenceDuration − 0.05)`. Smart is dropped when that leaves under 0.05 s.
- **Amendment F12 (2026-10-07):** the clamp margin is 0.2 s, not 0.05 s — effective Turn Check After = min(smartTurnCheckAfter, Max Wait − 0.2), Smart dropped under 0.10 s. Where a task below says 0.05, the code and spec use 0.2.
- **Gate:** trigger frames `ceil(checkAfter / 0.032)`, counted over consecutive frames below the negative threshold while the FrameProcessor is speaking. One request per silence run, and none until the segment holds at least `minSpeechFrames` speech frames (frames ≥ the positive threshold since segment start; the FrameProcessor's own misfire floor, `floor(minSpeechMs / 32)`), so Smart only ends a segment the FrameProcessor would keep. End only when `probability > threshold`, the id is the latest request, and no speech frame arrived since. The window is the segment's audio so far, pre-speech pad included, at most 8 s. Thresholds, pad and minimum are read from the worker's own FrameProcessor instance. An answer takes effect at the next VAD frame.
- **Turn mode:** Smart applies only when `context.turns === 'auto'`. No port, or the model not on disk, means the run is Normal.
- **Scope:** worker types `whisper-webgpu`, `granite-speech-webgpu`, `qwen3-asr-webgpu`, `cohere-transcribe-webgpu`, `voxtral-3b-webgpu`. Not `native-vad`, not the streaming `voxtral-webgpu`, not sherpa-onnx.
- **Workers:** decodes stay fire-and-forget (`void schedule(...)`, never `await`). The turn worker serialises predictions on one promise chain, because ORT sessions are not re-entrant. Workers never call `console.*`.
- **Channel:** the main thread creates one `MessageChannel` per ASR worker. `port1` goes to the ASR worker in its init message (transfer list). `port2` goes to the turn worker once the model has loaded.
- **Diagnostics:** `reportWarning` from `src/lib/diagnostics/report.ts`, main thread only, never `console.error`/`console.warn` (`consoleLedger.consistency.test.ts` counts them).
- **Strings:** every new UI string goes into all 30 catalogs with a real translation. Reuse `settings.normal` and `common.retry`. Fallback strings in code equal the en catalog word for word.
- **Code style:** English only. Write a comment only for a constraint the code cannot say, one line where possible. No rationale paragraphs in tests. TDD: write the failing test, run it, then implement.
- **Commits:** conventional commits. Every message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
  ```
- **Pushing:** do not push or open a PR. jiangzhuo decides that, and names the target (`kizuna-ai-lab/sokuji`) when he does.
- **TypeScript baseline:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` printed **95** at `b4391e6f`. Re-measure once before Task 1. A task is clean when it adds no error in the files it touched.

## Review Focus

1. **Both legs on single-thread WASM** (packaged Electron and the extension are not `crossOriginIsolated`, so one call takes ≈ 177 ms): the two legs' requests queue in one worker. Each answer must go back to the leg that asked. An answer that lands after speech resumed, or after the 1.4 s rule already fired, must never end a segment. Covered in Task 4 ("answers each leg on its own port", "runs one prediction at a time") and Task 6 (stale, late and post-reset answers).
2. **Smart stored but the model gone** (Storage page Clear all, or evicted IndexedDB): the section shows Normal, the summary reads Normal, the session runs Normal, and no error appears. Covered in Task 10 ("runs Normal when the runtime has no port"), Task 11 (Clear all re-checks the model) and Task 13 ("a stored Smart whose model is gone reads as Normal").
3. **Max Wait at or below Turn Check After** (for example Max Wait 0.30, Check After 0.50): the session and the slider both use Max Wait − 0.2, so 0.10. At Max Wait 0.25 Smart is dropped and the value reads "—". Covered in Task 1, Task 9 and Task 12.
4. **The turn worker dies mid-session** (GPU device lost, OOM): the gate gets no answers, so the run continues on the 1.4 s rule. One warning is reported, and the next connection loads on WASM. Covered in Task 5.
5. **Push-to-talk or push-to-translate with Smart stored:** the speaker leg gets no port and the held key ends the turn. The participant leg, always Auto, still gets Smart. Covered in Task 10.

---

### Task 1: The `'turn'` manifest entry and Smart Turn's pure rules

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts:17` (ModelType) and the end of `MODEL_MANIFEST` (after the `punct-multi-sat` entry, ~line 3389)
- Create: `src/lib/local-inference/modelManifest.turn.test.ts`
- Create: `src/lib/turn/smartTurn.ts`
- Create: `src/lib/turn/smartTurn.test.ts`
- Modify: `src/components/Settings/engine/StoragePage.tsx:163-169` and `:321-325`
- Modify: `src/components/Settings/engine/StoragePage.test.tsx` (after the punctuation row test, ~line 167)

**Interfaces:**
- Produces:
  - `ModelType` gains `'turn'`; manifest entry id `'smart-turn-v3.2'`
  - `src/lib/turn/smartTurn.ts`:
    - `const SMART_TURN_MODEL_ID = 'smart-turn-v3.2'`
    - `type VadEndOfTurn = 'normal' | 'smart'`
    - `const SMART_TURN_WORKER_TYPES: readonly ['whisper-webgpu', 'granite-speech-webgpu', 'qwen3-asr-webgpu', 'cohere-transcribe-webgpu', 'voxtral-3b-webgpu']`
    - `const SMART_TURN_CHECK_AFTER_RANGE = { min: 0.1, max: 0.5, step: 0.05 }`
    - `const SMART_TURN_THRESHOLD_RANGE = { min: 0.3, max: 0.9, step: 0.05 }`
    - `function supportsSmartTurn(entry: { asrWorkerType?: string } | undefined): boolean`
    - `function effectiveCheckAfter(checkAfter: number, maxWait: number): number | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/local-inference/modelManifest.turn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getManifestByType, getManifestEntry, getModelDownloadUrl, getModelSizeMb } from './modelManifest';
import { SMART_TURN_MODEL_ID } from '../turn/smartTurn';

describe('the Smart Turn manifest entry', () => {
  it('is the only turn model', () => {
    expect(getManifestByType('turn').map((m) => m.id)).toEqual([SMART_TURN_MODEL_ID]);
  });

  it('is the upstream fp32 file at a pinned commit', () => {
    const entry = getManifestEntry(SMART_TURN_MODEL_ID)!;
    expect(entry).toMatchObject({
      type: 'turn',
      hfModelId: 'pipecat-ai/smart-turn-v3',
      hfRevision: 'f766f81d3cfdf7737ac64aad813d91bbfd56bf93',
    });
    expect(entry.cdnPath).toBeUndefined();
    expect(entry.requiredDevice).toBeUndefined();
    expect(entry.variants).toEqual({
      default: { dtype: 'default', files: [{ filename: 'smart-turn-v3.2-gpu.onnx', sizeBytes: 32_411_198 }] },
    });
  });

  it('downloads from the pinned revision', () => {
    expect(getModelDownloadUrl(getManifestEntry(SMART_TURN_MODEL_ID)!, 'smart-turn-v3.2-gpu.onnx')).toBe(
      'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-gpu.onnx',
    );
  });

  it('is 31 MB', () => {
    expect(getModelSizeMb(getManifestEntry(SMART_TURN_MODEL_ID)!)).toBe(31);
  });

  it('stays out of every resolver pool', () => {
    const entry = getManifestEntry(SMART_TURN_MODEL_ID)!;
    expect(entry.asrEngine).toBeUndefined();
    expect(entry.engine).toBeUndefined();
    expect(entry.translationWorkerType).toBeUndefined();
  });
});
```

`src/lib/turn/smartTurn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SMART_TURN_WORKER_TYPES, effectiveCheckAfter, supportsSmartTurn } from './smartTurn';

describe('supportsSmartTurn', () => {
  it.each(SMART_TURN_WORKER_TYPES)('runs the gate in %s', (asrWorkerType) => {
    expect(supportsSmartTurn({ asrWorkerType })).toBe(true);
  });

  it.each(['sherpa-onnx', 'voxtral-webgpu', undefined])('leaves %s alone', (asrWorkerType) => {
    expect(supportsSmartTurn({ asrWorkerType })).toBe(false);
  });

  it('leaves a missing entry alone', () => {
    expect(supportsSmartTurn(undefined)).toBe(false);
  });
});

describe('effectiveCheckAfter', () => {
  it('keeps a value well under Max Wait', () => {
    expect(effectiveCheckAfter(0.3, 1.4)).toBe(0.3);
  });

  it('holds it 0.05 s under Max Wait', () => {
    expect(effectiveCheckAfter(0.5, 0.3)).toBe(0.25);
  });

  it('goes down to 0.05 s', () => {
    expect(effectiveCheckAfter(0.3, 0.1)).toBe(0.05);
  });

  it('gives up when Max Wait leaves no room', () => {
    expect(effectiveCheckAfter(0.3, 0.05)).toBeNull();
  });
});
```

Add to `src/components/Settings/engine/StoragePage.test.tsx`, directly after the test `'does not list punctuation models among the downloaded rows'`:

```tsx
  it('does not list the Smart Turn model among the downloaded rows', () => {
    const turnId = getManifestByType('turn')[0].id;
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded', [turnId]: 'downloaded' }, webgpuAvailable: true,
    });
    render(<StoragePage provider="wasm" {...WASM} />);
    expect(screen.getByTestId(`storage-row-${asrId()}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`storage-row-${turnId}`)).toBeNull();
  });

  it('offers neither punctuation nor Smart Turn models for import', () => {
    expect(getManifestByType('turn')).toHaveLength(1);
    render(<StoragePage provider="wasm" {...WASM} />);
    fireEvent.click(screen.getByRole('button', { name: /Import/ }));
    const offered = [...(screen.getByRole('combobox') as HTMLSelectElement).options].map((o) => o.value);
    for (const m of [...getManifestByType('punctuation'), ...getManifestByType('turn')]) {
      expect(offered).not.toContain(m.id);
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/local-inference/modelManifest.turn.test.ts src/lib/turn/smartTurn.test.ts src/components/Settings/engine/StoragePage.test.tsx`
Expected: FAIL. `./smartTurn` cannot be resolved, and both new Storage page tests fail on `getManifestByType('turn')` being empty.

- [ ] **Step 3: Implement**

In `src/lib/local-inference/modelManifest.ts`, line 17:

```ts
export type ModelType = 'asr' | 'asr-stream' | 'tts' | 'translation' | 'punctuation' | 'turn';
```

At the end of `MODEL_MANIFEST`, replace

```ts
          { filename: 'tokenizer.json', sizeBytes: 9_096_718 },
        ],
      },
    },
  },
];
```

with

```ts
          { filename: 'tokenizer.json', sizeBytes: 9_096_718 },
        ],
      },
    },
  },

  // ─── Turn detection (Smart Turn) ───────────────────────────────────────
  // Not an engine: downloaded from Local Inference's VAD settings and loaded by TurnRuntime.
  {
    id: 'smart-turn-v3.2',
    type: 'turn',
    name: 'Smart Turn v3.2',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'pipecat-ai/smart-turn-v3',
    hfRevision: 'f766f81d3cfdf7737ac64aad813d91bbfd56bf93',
    variants: {
      default: {
        dtype: 'default',
        files: [{ filename: 'smart-turn-v3.2-gpu.onnx', sizeBytes: 32_411_198 }],
      },
    },
  },
];
```

Create `src/lib/turn/smartTurn.ts`:

```ts
import type { ModelManifestEntry } from '../local-inference/modelManifest';

export const SMART_TURN_MODEL_ID = 'smart-turn-v3.2';

export type VadEndOfTurn = 'normal' | 'smart';

/** The vad-web workers that wire the gate (workers/turnGate.consistency.test.ts). */
export const SMART_TURN_WORKER_TYPES = [
  'whisper-webgpu',
  'granite-speech-webgpu',
  'qwen3-asr-webgpu',
  'cohere-transcribe-webgpu',
  'voxtral-3b-webgpu',
] as const satisfies readonly NonNullable<ModelManifestEntry['asrWorkerType']>[];

export const SMART_TURN_CHECK_AFTER_RANGE = { min: 0.1, max: 0.5, step: 0.05 } as const;
export const SMART_TURN_THRESHOLD_RANGE = { min: 0.3, max: 0.9, step: 0.05 } as const;

export function supportsSmartTurn(entry: { asrWorkerType?: string } | undefined): boolean {
  return (SMART_TURN_WORKER_TYPES as readonly string[]).includes(entry?.asrWorkerType ?? '');
}

/** At most 0.05 s under Max Wait; null when that leaves under 0.05 s and Max Wait would always win. */
export function effectiveCheckAfter(checkAfter: number, maxWait: number): number | null {
  const cap = Math.round((maxWait - 0.05) * 100) / 100;
  return cap < 0.05 ? null : Math.min(checkAfter, cap);
}
```

In `src/components/Settings/engine/StoragePage.tsx`, replace

```tsx
    // Punctuation models are managed from the Sentence segmentation section,
    // never here — modelStore's initialize() scans the whole manifest
    // (punctuation entries included), so without this filter a downloaded
    // pack shows up as nameless engine rows a user could delete behind the
    // feature's back.
    .filter(([id]) => !(isWasm && getManifestEntry(id)?.type === 'punctuation'))
```

with

```tsx
    // Punctuation and Smart Turn models are managed from their own settings,
    // never here — modelStore's initialize() scans the whole manifest, so
    // without this filter a downloaded one shows up as a nameless engine row a
    // user could delete behind the feature's back.
    .filter(([id]) => {
      const type = getManifestEntry(id)?.type;
      return !(isWasm && (type === 'punctuation' || type === 'turn'));
    })
```

and replace

```tsx
              {/* Punctuation models are managed from the Sentence segmentation
                  section and downloaded on demand, so they are not importable
                  here. Without this the picker would offer them as if they
                  were engines. */}
              {MODEL_MANIFEST.filter((m) => !m.isCloudModel && m.type !== 'punctuation').map((m) => (
```

with

```tsx
              {/* Punctuation and Smart Turn models are downloaded on demand by
                  their own settings, so they are not importable here. */}
              {MODEL_MANIFEST.filter((m) => !m.isCloudModel && m.type !== 'punctuation' && m.type !== 'turn').map((m) => (
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/modelManifest.turn.test.ts src/lib/turn/smartTurn.test.ts src/components/Settings/engine/StoragePage.test.tsx src/lib/local-inference/modelManifest.punctuation.test.ts src/lib/local-inference/modelName.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "smartTurn|modelManifest|StoragePage"`
Expected: no output.

```bash
git add src/lib/local-inference/modelManifest.ts src/lib/local-inference/modelManifest.turn.test.ts src/lib/turn/smartTurn.ts src/lib/turn/smartTurn.test.ts src/components/Settings/engine/StoragePage.tsx src/components/Settings/engine/StoragePage.test.tsx
git commit -F - <<'EOF'
feat(local-inference): add the Smart Turn model to the manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 2: Whisper's 80-mel filterbank, computed in code

**Files:**
- Create: `benchmark/smart-turn/make_mel_filters_fixture.py`
- Create: `src/lib/local-inference/workers/_shared/mel-filters.fixture.json` (generated)
- Create: `src/lib/local-inference/workers/_shared/mel-filters.ts`
- Create: `src/lib/local-inference/workers/_shared/mel-filters.test.ts`

**Interfaces:**
- Consumes: `MelFilterbank` from `_shared/log-mel.ts` (`{ n_mels: number; n_freqs: number; data: number[][] }`)
- Produces: `slaneyMelFilterbank(spec: { nMels: number; nFft: number; sampleRate: number; fMin: number; fMax: number }): MelFilterbank`

- [ ] **Step 1: Generate the reference fixture**

Create `benchmark/smart-turn/make_mel_filters_fixture.py`:

```python
"""Writes WhisperFeatureExtractor(feature_size=80).mel_filters, as [mel, bin, value] for every nonzero entry."""
import json
import sys

import numpy as np
from transformers import WhisperFeatureExtractor

filters = np.asarray(WhisperFeatureExtractor(feature_size=80).mel_filters).T  # (80, 201)
json.dump({
    "_generator": "benchmark/smart-turn/make_mel_filters_fixture.py",
    "n_mels": int(filters.shape[0]),
    "n_freqs": int(filters.shape[1]),
    "nonzero": [[int(m), int(k), float(filters[m, k])] for m, k in zip(*np.nonzero(filters))],
}, open(sys.argv[1], "w"))
```

Run:

```bash
/home/jiangzhuo/Desktop/kizunaai/vad-diar-bench/.venv/bin/python -I benchmark/smart-turn/make_mel_filters_fixture.py src/lib/local-inference/workers/_shared/mel-filters.fixture.json
node -e "const f=require('./src/lib/local-inference/workers/_shared/mel-filters.fixture.json');console.log(f.n_mels,f.n_freqs,f.nonzero.length)"
```

Expected: the second command prints `80 201 391`. The PyTorch-not-found notice from transformers is harmless.

- [ ] **Step 2: Write the failing test**

`src/lib/local-inference/workers/_shared/mel-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fixture from './mel-filters.fixture.json';
import { slaneyMelFilterbank } from './mel-filters';

const filters = slaneyMelFilterbank({ nMels: 80, nFft: 400, sampleRate: 16000, fMin: 0, fMax: 8000 });

describe('slaneyMelFilterbank', () => {
  it('has the shape log-mel.ts reads', () => {
    expect(filters.n_mels).toBe(80);
    expect(filters.n_freqs).toBe(201);
    expect(filters.data).toHaveLength(80);
    for (const row of filters.data) expect(row).toHaveLength(201);
  });

  it("equals WhisperFeatureExtractor's own filters", () => {
    expect(fixture.nonzero.length).toBeGreaterThan(300);
    const expected = Array.from({ length: 80 }, () => new Array<number>(201).fill(0));
    for (const [m, k, v] of fixture.nonzero as [number, number, number][]) expected[m][k] = v;
    let worst = 0;
    for (let m = 0; m < 80; m++) {
      for (let k = 0; k < 201; k++) worst = Math.max(worst, Math.abs(filters.data[m][k] - expected[m][k]));
    }
    expect(worst).toBeLessThan(1e-12);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/local-inference/workers/_shared/mel-filters.test.ts`
Expected: FAIL, `Failed to resolve import "./mel-filters"`.

- [ ] **Step 4: Implement**

`src/lib/local-inference/workers/_shared/mel-filters.ts`:

```ts
import type { MelFilterbank } from './log-mel';

export interface MelFilterbankSpec {
  nMels: number;
  nFft: number;
  sampleRate: number;
  fMin: number;
  fMax: number;
}

const hzToMel = (hz: number) => (hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) * (27 / Math.log(6.4)));
const melToHz = (mel: number) => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15)));

/** Slaney mel scale with Slaney area normalisation, as transformers' mel_filter_bank builds Whisper's. */
export function slaneyMelFilterbank({ nMels, nFft, sampleRate, fMin, fMax }: MelFilterbankSpec): MelFilterbank {
  const nFreqs = Math.floor(nFft / 2) + 1;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const edges: number[] = [];
  for (let i = 0; i < nMels + 2; i++) edges.push(melToHz(melMin + ((melMax - melMin) * i) / (nMels + 1)));
  const data: number[][] = [];
  for (let m = 0; m < nMels; m++) {
    const lo = edges[m];
    const centre = edges[m + 1];
    const hi = edges[m + 2];
    const norm = 2 / (hi - lo);
    const row = new Array<number>(nFreqs);
    for (let k = 0; k < nFreqs; k++) {
      const hz = ((sampleRate / 2) * k) / (nFreqs - 1);
      row[k] = Math.max(0, Math.min((hz - lo) / (centre - lo), (hi - hz) / (hi - centre))) * norm;
    }
    data.push(row);
  }
  return { n_mels: nMels, n_freqs: nFreqs, data };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/lib/local-inference/workers/_shared/mel-filters.test.ts`
Expected: PASS. The maximum difference measured while planning was 2e-16.

- [ ] **Step 6: Commit**

```bash
git add benchmark/smart-turn/make_mel_filters_fixture.py src/lib/local-inference/workers/_shared/mel-filters.ts src/lib/local-inference/workers/_shared/mel-filters.test.ts src/lib/local-inference/workers/_shared/mel-filters.fixture.json
git commit -F - <<'EOF'
feat(local-inference): compute the Whisper mel filterbank in code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 3: Smart Turn's features (`featurize`) and the shared protocol

**Files:**
- Create: `src/lib/local-inference/workers/_shared/turn-protocol.ts`
- Create: `benchmark/smart-turn/make_turn_features_fixture.py`
- Create: `src/lib/local-inference/workers/_shared/turn-core.fixture.json` (generated)
- Create: `src/lib/local-inference/workers/_shared/turn-core.ts`
- Create: `src/lib/local-inference/workers/_shared/turn-core.test.ts`

**Interfaces:**
- Consumes: `slaneyMelFilterbank` (Task 2), `logMel` (`_shared/log-mel.ts`)
- Produces:
  - `turn-protocol.ts`: `TURN_SAMPLE_RATE = 16000`, `TURN_WINDOW_SAMPLES = 128000`, `SMART_TURN_FILE = 'smart-turn-v3.2-gpu.onnx'`, `TurnInitMessage`, `TurnConnectMessage`, `TurnDisconnectMessage`, `TurnDisposeMessage`, `TurnWorkerInbound`, `TurnWorkerOutbound`, `TurnPredictRequest`, `TurnPredictAnswer`
  - `turn-core.ts`: `featurize(window: Float32Array): Float32Array` (length 64,000, laid out `[80][800]`)

- [ ] **Step 1: Write the protocol module**

`src/lib/local-inference/workers/_shared/turn-protocol.ts` (types and constants only, no behaviour to test):

```ts
/** Messages between TurnRuntime, the Smart Turn worker and the VAD workers' gates. */

export const TURN_SAMPLE_RATE = 16000;
/** Smart Turn reads a fixed 8 s window. */
export const TURN_WINDOW_SAMPLES = 8 * TURN_SAMPLE_RATE;
export const SMART_TURN_FILE = 'smart-turn-v3.2-gpu.onnx';

export interface TurnInitMessage {
  type: 'init';
  /** filename -> blob URL, from ModelManager.getModelBlobUrls(). */
  fileUrls: Record<string, string>;
  ortWasmBaseUrl: string;
  numThreads: number;
}

export interface TurnConnectMessage { type: 'connect'; id: number; port: MessagePort }
export interface TurnDisconnectMessage { type: 'disconnect'; id: number }
export interface TurnDisposeMessage { type: 'dispose' }

export type TurnWorkerInbound = TurnInitMessage | TurnConnectMessage | TurnDisconnectMessage | TurnDisposeMessage;

export type TurnWorkerOutbound =
  | { type: 'ready'; loadTimeMs: number; device: 'webgpu' | 'wasm' }
  | { type: 'error'; error: string }
  | { type: 'disposed' };

/** VAD worker -> turn worker, on a connected port. */
export interface TurnPredictRequest { type: 'predict'; id: number; window: Float32Array }

/** Turn worker -> VAD worker. */
export type TurnPredictAnswer = { id: number; probability: number } | { id: number; error: string };
```

- [ ] **Step 2: Generate the parity fixture**

Create `benchmark/smart-turn/make_turn_features_fixture.py`:

```python
"""Writes sampled WhisperFeatureExtractor features for three synthetic clips, built as Smart Turn's inference.py builds them."""
import json
import sys

import numpy as np
from transformers import WhisperFeatureExtractor

SR = 16000
N = 8 * SR
MELS = [0, 7, 23, 40, 61, 79]
FRAMES = [0, 300, 599, 600, 650, 720, 799]


def synth(n):
    t = np.arange(n, dtype=np.float64) / SR
    env = 0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t)
    voiced = 0.4 * np.sin(2 * np.pi * (180 * t + 20 * t * t)) * env
    burst = np.where(np.mod(t, 1.0) < 0.5, 0.2, 0.04)
    return (voiced + burst * np.sin(2 * np.pi * 1250 * t + 0.3) + 0.05 * np.sin(2 * np.pi * 3100 * t)).astype(np.float32)


def last_8s(audio):
    return audio[-N:] if len(audio) >= N else np.pad(audio, (N - len(audio), 0))


extractor = WhisperFeatureExtractor(chunk_length=8)
windows = []
for seconds in (2, 8, 12):
    features = extractor(last_8s(synth(seconds * SR)), sampling_rate=SR, return_tensors="np", padding="max_length",
                         max_length=N, truncation=True, do_normalize=True).input_features[0]
    windows.append({"seconds": seconds, "points": [[m, t, round(float(features[m, t]), 6)] for m in MELS for t in FRAMES]})

json.dump({"_generator": "benchmark/smart-turn/make_turn_features_fixture.py", "windows": windows}, open(sys.argv[1], "w"))
```

Run:

```bash
/home/jiangzhuo/Desktop/kizunaai/vad-diar-bench/.venv/bin/python -I benchmark/smart-turn/make_turn_features_fixture.py src/lib/local-inference/workers/_shared/turn-core.fixture.json
node -e "const f=require('./src/lib/local-inference/workers/_shared/turn-core.fixture.json');console.log(f.windows.map(w=>[w.seconds,w.points.length]))"
```

Expected: `[ [ 2, 42 ], [ 8, 42 ], [ 12, 42 ] ]`.

- [ ] **Step 3: Write the failing test**

`src/lib/local-inference/workers/_shared/turn-core.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fixture from './turn-core.fixture.json';
import { featurize } from './turn-core';
import { TURN_SAMPLE_RATE } from './turn-protocol';

/** The same clip benchmark/smart-turn/make_turn_features_fixture.py builds. */
function synth(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / TURN_SAMPLE_RATE;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t);
    const voiced = 0.4 * Math.sin(2 * Math.PI * (180 * t + 20 * t * t)) * env;
    const burst = t % 1 < 0.5 ? 0.2 : 0.04;
    out[i] = voiced + burst * Math.sin(2 * Math.PI * 1250 * t + 0.3) + 0.05 * Math.sin(2 * Math.PI * 3100 * t);
  }
  return out;
}

describe('featurize', () => {
  it.each(fixture.windows)('matches WhisperFeatureExtractor on a $seconds s clip within 1e-4', ({ seconds, points }) => {
    const features = featurize(synth(seconds * TURN_SAMPLE_RATE));
    expect(features).toHaveLength(80 * 800);
    for (const [m, t, v] of points as [number, number, number][]) {
      expect(Math.abs(features[m * 800 + t] - v)).toBeLessThan(1e-4);
    }
  });

  it('reads only the last 8 s', () => {
    const clip = synth(12 * TURN_SAMPLE_RATE);
    expect(featurize(clip)).toEqual(featurize(clip.slice(4 * TURN_SAMPLE_RATE)));
  });

  it('leaves its input as it was', () => {
    const clip = synth(2 * TURN_SAMPLE_RATE);
    const copy = clip.slice();
    featurize(clip);
    expect(clip).toEqual(copy);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/lib/local-inference/workers/_shared/turn-core.test.ts`
Expected: FAIL, `Failed to resolve import "./turn-core"`.

- [ ] **Step 5: Implement `featurize`**

`src/lib/local-inference/workers/_shared/turn-core.ts`:

```ts
/**
 * The half of the Smart Turn worker that does not know which onnxruntime-web
 * bundle it runs in (turn-webgpu.worker.ts, turn-wasm.worker.ts).
 */
import { logMel, type MelFilterbank } from './log-mel';
import { slaneyMelFilterbank } from './mel-filters';
import { TURN_SAMPLE_RATE, TURN_WINDOW_SAMPLES } from './turn-protocol';

const MEL_BINS = 80;
const NORMALIZE_EPS = 1e-7;

let filters: MelFilterbank | null = null;

/** WhisperFeatureExtractor(chunk_length=8) with do_normalize over the last 8 s, zero-padded at the front: [80][800]. */
export function featurize(window: Float32Array): Float32Array {
  const w = new Float32Array(TURN_WINDOW_SAMPLES);
  const tail = window.length > TURN_WINDOW_SAMPLES ? window.subarray(window.length - TURN_WINDOW_SAMPLES) : window;
  w.set(tail, TURN_WINDOW_SAMPLES - tail.length);
  let mean = 0;
  for (let i = 0; i < w.length; i++) mean += w[i];
  mean /= w.length;
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - mean;
    variance += d * d;
  }
  const scale = 1 / Math.sqrt(variance / w.length + NORMALIZE_EPS);
  for (let i = 0; i < w.length; i++) w[i] = (w[i] - mean) * scale;
  if (!filters) {
    filters = slaneyMelFilterbank({ nMels: MEL_BINS, nFft: 400, sampleRate: TURN_SAMPLE_RATE, fMin: 0, fMax: 8000 });
  }
  return logMel(w, filters).data;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run src/lib/local-inference/workers/_shared/turn-core.test.ts`
Expected: PASS. The largest point difference measured on these clips while planning was 1.7e-5.

- [ ] **Step 7: Commit**

```bash
git add benchmark/smart-turn/make_turn_features_fixture.py src/lib/local-inference/workers/_shared/turn-protocol.ts src/lib/local-inference/workers/_shared/turn-core.ts src/lib/local-inference/workers/_shared/turn-core.test.ts src/lib/local-inference/workers/_shared/turn-core.fixture.json
git commit -F - <<'EOF'
feat(local-inference): Smart Turn features in the front end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 4: The Smart Turn worker (core protocol and both entries)

**Files:**
- Modify: `src/lib/local-inference/workers/_shared/turn-core.ts` (full content below)
- Create: `src/lib/local-inference/workers/_shared/turn-core.protocol.test.ts`
- Create: `src/lib/local-inference/workers/turn-webgpu.worker.ts`
- Create: `src/lib/local-inference/workers/turn-wasm.worker.ts`

**Interfaces:**
- Consumes: `featurize` (Task 3), everything in `turn-protocol.ts` (Task 3), `acquireWebGpuAdapter` / `bindCheckedWebGpuAdapter` (`workers/shaderF16Gate.ts`)
- Produces:
  - `interface TurnCoreDeps { InferenceSession: any; Tensor: any; env: any; device: 'webgpu' | 'wasm'; prepare(): Promise<void> }`
  - `interface TurnWorkerScope { onmessage: ((event: MessageEvent<TurnWorkerInbound>) => void) | null; postMessage(message: TurnWorkerOutbound): void }`
  - `installTurnWorker(deps: TurnCoreDeps, scope?: TurnWorkerScope): void`
  - Worker protocol: `init` → `ready { loadTimeMs, device }` or `error { error }`. On a port it was given with `connect { id, port }`, `predict { id, window }` → `{ id, probability }` or `{ id, error }`. `disconnect { id }` closes that port. `dispose` → `disposed`.

- [ ] **Step 1: Write the failing test**

`src/lib/local-inference/workers/_shared/turn-core.protocol.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTurnWorker, type TurnCoreDeps, type TurnWorkerScope } from './turn-core';
import { SMART_TURN_FILE, type TurnPredictAnswer, type TurnWorkerOutbound } from './turn-protocol';

class FakeTensor {
  constructor(public type: string, public data: Float32Array, public dims: number[]) {}
}

function harness(over: Partial<TurnCoreDeps> = {}) {
  const run = vi.fn(async (_feeds: Record<string, FakeTensor>) => ({ logits: { data: Float32Array.of(0.8) } }));
  const release = vi.fn(async () => {});
  const create = vi.fn(async (_bytes: Uint8Array, _options: unknown) => ({ run, release }));
  const env = { wasm: {} as Record<string, unknown> };
  const posted: TurnWorkerOutbound[] = [];
  const scope: TurnWorkerScope = { onmessage: null, postMessage: (m) => { posted.push(m); } };
  installTurnWorker(
    { InferenceSession: { create }, Tensor: FakeTensor, env, device: 'wasm', prepare: async () => {}, ...over },
    scope,
  );
  const send = (data: unknown) => scope.onmessage!({ data } as MessageEvent);
  return { run, release, create, env, posted, send };
}

const INIT = { type: 'init', fileUrls: { [SMART_TURN_FILE]: 'blob:model' }, ortWasmBaseUrl: 'http://x/wasm/ort/', numThreads: 1 };
/** Each prediction runs the real 8 s feature extraction. */
const SLOW = { timeout: 5000 };

const channels: MessageChannel[] = [];

function connect(h: ReturnType<typeof harness>, id: number) {
  const channel = new MessageChannel();
  channels.push(channel);
  const answers: TurnPredictAnswer[] = [];
  channel.port1.onmessage = (e: MessageEvent<TurnPredictAnswer>) => { answers.push(e.data); };
  h.send({ type: 'connect', id, port: channel.port2 });
  const predict = (requestId: number) => channel.port1.postMessage({
    type: 'predict', id: requestId, window: Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 7)),
  });
  return { answers, predict };
}

async function loaded(h: ReturnType<typeof harness>) {
  h.send(INIT);
  await vi.waitFor(() => expect(h.posted).toContainEqual(expect.objectContaining({ type: 'ready' })));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const c of channels.splice(0)) { c.port1.close(); c.port2.close(); }
});

describe('the Smart Turn worker', () => {
  it('loads the model from its blob URL on its device and says ready', async () => {
    const h = harness();
    await loaded(h);
    expect(h.posted).toEqual([{ type: 'ready', loadTimeMs: expect.any(Number), device: 'wasm' }]);
    expect(fetch).toHaveBeenCalledWith('blob:model');
    expect(h.create).toHaveBeenCalledWith(expect.any(Uint8Array), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    expect(h.env.wasm).toEqual({ wasmPaths: 'http://x/wasm/ort/', numThreads: 1 });
  });

  it('reports a missing model file as a load error', async () => {
    const h = harness();
    h.send({ ...INIT, fileUrls: {} });
    await vi.waitFor(() => expect(h.posted).toEqual([{ type: 'error', error: expect.stringContaining(SMART_TURN_FILE) }]));
    expect(h.create).not.toHaveBeenCalled();
  });

  it('reports an entry that cannot run as a load error', async () => {
    const h = harness({ prepare: async () => { throw new Error('no WebGPU adapter'); } });
    h.send(INIT);
    await vi.waitFor(() => expect(h.posted).toEqual([{ type: 'error', error: 'no WebGPU adapter' }]));
  });

  it("answers a prediction with the model's probability, from [1, 80, 800] features", async () => {
    const h = harness();
    await loaded(h);
    const a = connect(h, 1);
    a.predict(7);
    await vi.waitFor(() => expect(a.answers).toHaveLength(1), SLOW);
    expect(a.answers[0]).toEqual({ id: 7, probability: expect.closeTo(0.8, 5) });
    const input = h.run.mock.calls[0][0].input_features;
    expect(input.dims).toEqual([1, 80, 800]);
    expect(input.data).toHaveLength(64_000);
  });

  it('answers each leg on its own port', async () => {
    const h = harness();
    await loaded(h);
    const a = connect(h, 1);
    const b = connect(h, 2);
    a.predict(1);
    b.predict(1);
    await vi.waitFor(() => expect([a.answers.length, b.answers.length]).toEqual([1, 1]), SLOW);
    expect(a.answers[0].id).toBe(1);
    expect(b.answers[0].id).toBe(1);
  });

  it('runs one prediction at a time', async () => {
    const h = harness();
    await loaded(h);
    let finish!: () => void;
    h.run.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ logits: { data: Float32Array.of(0.9) } });
    }));
    const a = connect(h, 1);
    a.predict(1);
    a.predict(2);
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1), SLOW);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.run).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(a.answers.map((x) => x.id)).toEqual([1, 2]), SLOW);
  });

  it('answers a failed run with its error', async () => {
    const h = harness();
    await loaded(h);
    h.run.mockRejectedValueOnce(new Error('bad input'));
    const a = connect(h, 1);
    a.predict(3);
    await vi.waitFor(() => expect(a.answers).toEqual([{ id: 3, error: 'bad input' }]), SLOW);
  });

  it('stops answering a port once it is disconnected', async () => {
    const h = harness();
    await loaded(h);
    const a = connect(h, 4);
    h.send({ type: 'disconnect', id: 4 });
    a.predict(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(a.answers).toEqual([]);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('releases the session on dispose', async () => {
    const h = harness();
    await loaded(h);
    h.send({ type: 'dispose' });
    await vi.waitFor(() => expect(h.posted).toContainEqual({ type: 'disposed' }));
    expect(h.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/local-inference/workers/_shared/turn-core.protocol.test.ts`
Expected: FAIL, `installTurnWorker` is not exported.

- [ ] **Step 3: Implement the core**

Replace the whole of `src/lib/local-inference/workers/_shared/turn-core.ts` with:

```ts
/**
 * The half of the Smart Turn worker that does not know which onnxruntime-web
 * bundle it runs in (turn-webgpu.worker.ts, turn-wasm.worker.ts).
 */
import { logMel, type MelFilterbank } from './log-mel';
import { slaneyMelFilterbank } from './mel-filters';
import {
  SMART_TURN_FILE,
  TURN_SAMPLE_RATE,
  TURN_WINDOW_SAMPLES,
  type TurnInitMessage,
  type TurnPredictAnswer,
  type TurnPredictRequest,
  type TurnWorkerInbound,
  type TurnWorkerOutbound,
} from './turn-protocol';

const MEL_BINS = 80;
const FEATURE_FRAMES = 800;
const NORMALIZE_EPS = 1e-7;

let filters: MelFilterbank | null = null;

/** WhisperFeatureExtractor(chunk_length=8) with do_normalize over the last 8 s, zero-padded at the front: [80][800]. */
export function featurize(window: Float32Array): Float32Array {
  const w = new Float32Array(TURN_WINDOW_SAMPLES);
  const tail = window.length > TURN_WINDOW_SAMPLES ? window.subarray(window.length - TURN_WINDOW_SAMPLES) : window;
  w.set(tail, TURN_WINDOW_SAMPLES - tail.length);
  let mean = 0;
  for (let i = 0; i < w.length; i++) mean += w[i];
  mean /= w.length;
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - mean;
    variance += d * d;
  }
  const scale = 1 / Math.sqrt(variance / w.length + NORMALIZE_EPS);
  for (let i = 0; i < w.length; i++) w[i] = (w[i] - mean) * scale;
  if (!filters) {
    filters = slaneyMelFilterbank({ nMels: MEL_BINS, nFft: 400, sampleRate: TURN_SAMPLE_RATE, fMin: 0, fMax: 8000 });
  }
  return logMel(w, filters).data;
}

export interface TurnCoreDeps {
  /** Either bundle's InferenceSession, whichever entry imported this core. */
  InferenceSession: any;
  Tensor: any;
  env: any;
  device: 'webgpu' | 'wasm';
  /** Runs before the session is created; throws when this entry cannot run here. */
  prepare(): Promise<void>;
}

export interface TurnWorkerScope {
  onmessage: ((event: MessageEvent<TurnWorkerInbound>) => void) | null;
  postMessage(message: TurnWorkerOutbound): void;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function installTurnWorker(deps: TurnCoreDeps, scope: TurnWorkerScope = self as unknown as TurnWorkerScope): void {
  let session: any = null;
  const ports = new Map<number, MessagePort>();
  // ORT sessions are not re-entrant: every load and prediction waits its turn.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => { chain = chain.then(task); };

  async function init(msg: TurnInitMessage): Promise<void> {
    const started = performance.now();
    try {
      if (deps.env?.wasm) {
        deps.env.wasm.wasmPaths = msg.ortWasmBaseUrl;
        deps.env.wasm.numThreads = msg.numThreads;
      }
      await deps.prepare();
      const url = msg.fileUrls[SMART_TURN_FILE];
      if (!url) throw new Error(`Smart Turn: ${SMART_TURN_FILE} is missing`);
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      session = await deps.InferenceSession.create(bytes, {
        executionProviders: [deps.device],
        graphOptimizationLevel: 'all',
      });
      scope.postMessage({ type: 'ready', loadTimeMs: Math.round(performance.now() - started), device: deps.device });
    } catch (err) {
      scope.postMessage({ type: 'error', error: messageOf(err) });
    }
  }

  async function predict(port: MessagePort, msg: TurnPredictRequest): Promise<void> {
    let answer: TurnPredictAnswer;
    try {
      if (!session) throw new Error('Smart Turn is not loaded');
      const input = new deps.Tensor('float32', featurize(msg.window), [1, MEL_BINS, FEATURE_FRAMES]);
      const out = await session.run({ input_features: input });
      answer = { id: msg.id, probability: Number(out.logits.data[0]) };
    } catch (err) {
      answer = { id: msg.id, error: messageOf(err) };
    }
    port.postMessage(answer);
  }

  scope.onmessage = (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        enqueue(() => init(msg));
        break;
      case 'connect': {
        const { id, port } = msg;
        ports.set(id, port);
        port.onmessage = (e: MessageEvent<TurnPredictRequest>) => enqueue(() => predict(port, e.data));
        break;
      }
      case 'disconnect':
        ports.get(msg.id)?.close();
        ports.delete(msg.id);
        break;
      case 'dispose':
        enqueue(async () => {
          for (const port of ports.values()) port.close();
          ports.clear();
          await session?.release?.();
          session = null;
          scope.postMessage({ type: 'disposed' });
        });
        break;
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/workers/_shared/turn-core.protocol.test.ts src/lib/local-inference/workers/_shared/turn-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the two worker entries**

`src/lib/local-inference/workers/turn-webgpu.worker.ts`:

```ts
/** Smart Turn worker, WebGPU entry: the only onnxruntime-web bundle whose sessions really run on the GPU. */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-webgpu';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';
import { installTurnWorker } from './_shared/turn-core';

installTurnWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  device: 'webgpu',
  async prepare() {
    if (!(await acquireWebGpuAdapter(ortEnv))) throw new Error('Smart Turn: no WebGPU adapter in this worker');
    await bindCheckedWebGpuAdapter(ortEnv, 'fp32', 'Smart Turn');
  },
});
```

`src/lib/local-inference/workers/turn-wasm.worker.ts`:

```ts
/** Smart Turn worker, CPU entry: the no-GPU path and the fallback after a GPU failure. */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { installTurnWorker } from './_shared/turn-core';

installTurnWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  device: 'wasm',
  async prepare() {},
});
```

- [ ] **Step 6: Run the worker consistency gates**

Run: `npx vitest run src/lib/local-inference/workers/shaderF16Gate.consistency.test.ts src/lib/local-inference/workers/sileroInput.consistency.test.ts`
Expected: PASS. `turn-webgpu.worker.ts` binds `ortEnv` from `_shared/onnxruntime-webgpu`, imports the gate and never calls `requestAdapter`. That is everything the gate test requires of a worker that calls `bindCheckedWebGpuAdapter(`.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "turn-core|turn-protocol|turn-webgpu|turn-wasm"`
Expected: no output.

```bash
git add src/lib/local-inference/workers/_shared/turn-core.ts src/lib/local-inference/workers/_shared/turn-core.protocol.test.ts src/lib/local-inference/workers/turn-webgpu.worker.ts src/lib/local-inference/workers/turn-wasm.worker.ts
git commit -F - <<'EOF'
feat(local-inference): Smart Turn worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 5: `TurnRuntime` with the WebGPU → WASM fallback

**Files:**
- Modify: `src/lib/segmentation/PunctuationRuntime.ts:124` (export `numThreadsFor`)
- Create: `src/lib/turn/createTurnWorker.ts`
- Create: `src/lib/turn/TurnRuntime.ts`
- Create: `src/lib/turn/TurnRuntime.test.ts`

**Interfaces:**
- Consumes: `SMART_TURN_MODEL_ID` (Task 1), `TurnInitMessage` / `TurnConnectMessage` / `TurnDisconnectMessage` (Task 3), the worker protocol (Task 4), `WorkerSession` (`src/lib/local-inference/engine/WorkerSession.ts`), `numThreadsFor` (`src/lib/segmentation/PunctuationRuntime.ts`), `checkWebGPU` (`src/utils/webgpu.ts`), `reportWarning` / `describeCause` (`src/lib/diagnostics/report.ts`)
- Produces:
  - `interface TurnConnection { port: MessagePort; release(): void }`
  - `class TurnRuntime { connect(): Promise<TurnConnection | null> }`
  - `const turnRuntime: TurnRuntime` (the app-wide one)
  - `createTurnWorker(backend: 'webgpu' | 'wasm'): Worker`

- [ ] **Step 1: Write the failing test**

`src/lib/turn/TurnRuntime.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { TurnRuntime } from './TurnRuntime';
import { MockWorker } from '../local-inference/engine/testing/mockWorker';
import { ModelManager } from '../local-inference/ModelManager';
import { checkWebGPU } from '../../utils/webgpu';
import { createTurnWorker } from './createTurnWorker';
import { reportWarning } from '../diagnostics/report';

vi.mock('./createTurnWorker', () => ({ createTurnWorker: vi.fn() }));
vi.mock('../../utils/webgpu', () => ({ checkWebGPU: vi.fn() }));
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportWarning: vi.fn(),
}));

const FILES = { 'smart-turn-v3.2-gpu.onnx': 'blob:smart-turn' };
const ports: MessagePort[] = [];

const sent = (worker: MockWorker) => worker.postMessage.mock.calls as Array<[any, Transferable[]?]>;

async function nthWorker(n: number): Promise<MockWorker> {
  await vi.waitFor(() => expect(MockWorker.instances.length).toBeGreaterThanOrEqual(n));
  const worker = MockWorker.instances[n - 1];
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  return worker;
}

/** The connect messages a worker was sent; their ports are closed after the test. */
function connects(worker: MockWorker) {
  const found = sent(worker).filter(([m]) => m.type === 'connect');
  for (const [m] of found) if (!ports.includes(m.port)) ports.push(m.port);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  MockWorker.reset();
  (createTurnWorker as unknown as Mock).mockImplementation((backend: string) => new MockWorker(backend) as unknown as Worker);
  (checkWebGPU as unknown as Mock).mockResolvedValue({ available: true });
  vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
  vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue(FILES);
  vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('debug:device-memory');
  for (const port of ports.splice(0)) port.close();
});

async function connected(runtime: TurnRuntime) {
  const connection = await runtime.connect();
  expect(connection).not.toBeNull();
  ports.push(connection!.port);
  return connection!;
}

describe('TurnRuntime', () => {
  it('loads on WebGPU and hands the turn worker the other end of the port once the model is ready', async () => {
    const runtime = new TurnRuntime();
    const connection = await connected(runtime);
    const worker = await nthWorker(1);
    expect(createTurnWorker).toHaveBeenCalledWith('webgpu');
    expect(sent(worker)[0][0]).toEqual({
      type: 'init', fileUrls: FILES, ortWasmBaseUrl: expect.stringMatching(/\/wasm\/ort\/$/), numThreads: 1,
    });
    expect(connects(worker)).toEqual([]);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(1));
    const [message, transfer] = connects(worker)[0];
    expect(message).toMatchObject({ type: 'connect', id: expect.any(Number) });
    expect(transfer).toEqual([message.port]);
    expect(message.port).not.toBe(connection.port);
  });

  it('falls back to WASM when the WebGPU load fails, without a warning', async () => {
    const runtime = new TurnRuntime();
    await connected(runtime);
    (await nthWorker(1)).emit({ type: 'error', error: 'no adapter' });
    const cpu = await nthWorker(2);
    expect(createTurnWorker).toHaveBeenLastCalledWith('wasm');
    cpu.emit({ type: 'ready', loadTimeMs: 40, device: 'wasm' });
    await vi.waitFor(() => expect(connects(cpu)).toHaveLength(1));
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it('starts on WASM when there is no WebGPU', async () => {
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: false });
    await connected(new TurnRuntime());
    await nthWorker(1);
    expect(createTurnWorker).toHaveBeenCalledWith('wasm');
  });

  it('reports a load that fails on WASM too, and the port goes unanswered', async () => {
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: false });
    await connected(new TurnRuntime());
    const worker = await nthWorker(1);
    worker.emit({ type: 'error', error: 'out of memory' });
    await vi.waitFor(() => expect(reportWarning).toHaveBeenCalledWith(
      'SmartTurn',
      'Smart Turn could not load; turns end on silence: out of memory',
      expect.objectContaining({ dedupeKey: 'smart-turn:load' }),
    ));
    expect(connects(worker)).toEqual([]);
    expect(MockWorker.instances).toHaveLength(1);
  });

  it('connects nothing without the model on disk', async () => {
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(false);
    expect(await new TurnRuntime().connect()).toBeNull();
    expect(createTurnWorker).not.toHaveBeenCalled();
  });

  it('connects on a device that reports little memory', async () => {
    localStorage.setItem('debug:device-memory', '2');
    await connected(new TurnRuntime());
    await nthWorker(1);
  });

  it('serves two connections from one worker', async () => {
    const runtime = new TurnRuntime();
    await connected(runtime);
    await connected(runtime);
    const worker = await nthWorker(1);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(2));
    expect(MockWorker.instances).toHaveLength(1);
    expect(sent(worker).filter(([m]) => m.type === 'init')).toHaveLength(1);
    const ids = connects(worker).map(([m]) => m.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('disconnects a released connection and disposes the worker with the last one', async () => {
    const runtime = new TurnRuntime();
    const a = await connected(runtime);
    const b = await connected(runtime);
    const worker = await nthWorker(1);
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(worker)).toHaveLength(2));
    const firstId = connects(worker)[0][0].id;
    a.release();
    expect(sent(worker).map(([m]) => m)).toContainEqual({ type: 'disconnect', id: firstId });
    expect(worker.terminate).not.toHaveBeenCalled();
    b.release();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('never hands the worker a connection released while the model loads', async () => {
    const runtime = new TurnRuntime();
    const connection = await connected(runtime);
    const worker = await nthWorker(1);
    connection.release();
    worker.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalled());
    expect(connects(worker)).toEqual([]);
  });

  it('reports a worker that dies after loading, and loads the next connection on WASM', async () => {
    const runtime = new TurnRuntime();
    await connected(runtime);
    const gpu = await nthWorker(1);
    gpu.emit({ type: 'ready', loadTimeMs: 5, device: 'webgpu' });
    await vi.waitFor(() => expect(connects(gpu)).toHaveLength(1));
    gpu.emitError('device lost');
    expect(reportWarning).toHaveBeenCalledWith(
      'SmartTurn',
      'Smart Turn stopped; turns end on silence: device lost',
      expect.objectContaining({ dedupeKey: 'smart-turn:crash' }),
    );
    expect(gpu.terminate).toHaveBeenCalled();
    await connected(runtime);
    await nthWorker(2);
    expect(createTurnWorker).toHaveBeenLastCalledWith('wasm');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/turn/TurnRuntime.test.ts`
Expected: FAIL, `Failed to resolve import "./TurnRuntime"`.

- [ ] **Step 3: Implement**

In `src/lib/segmentation/PunctuationRuntime.ts`, change `function numThreadsFor(): number {` to `export function numThreadsFor(): number {`.

`src/lib/turn/createTurnWorker.ts`:

```ts
/** Isolated factory so TurnRuntime can be unit-tested with the worker stubbed. */
export function createTurnWorker(backend: 'webgpu' | 'wasm'): Worker {
  return backend === 'webgpu'
    ? new Worker(new URL('../local-inference/workers/turn-webgpu.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('../local-inference/workers/turn-wasm.worker.ts', import.meta.url), { type: 'module' });
}
```

`src/lib/turn/TurnRuntime.ts`:

```ts
import { WorkerSession } from '../local-inference/engine/WorkerSession';
import { ModelManager } from '../local-inference/ModelManager';
import type {
  TurnConnectMessage,
  TurnDisconnectMessage,
  TurnInitMessage,
} from '../local-inference/workers/_shared/turn-protocol';
import { numThreadsFor } from '../segmentation/PunctuationRuntime';
import { describeCause, reportWarning } from '../diagnostics/report';
import { checkWebGPU } from '../../utils/webgpu';
import { createTurnWorker } from './createTurnWorker';
import { SMART_TURN_MODEL_ID } from './smartTurn';

/** One VAD worker's line to the Smart Turn worker. */
export interface TurnConnection {
  /** Goes to the VAD worker in its init message, transferred. */
  port: MessagePort;
  release(): void;
}

type Backend = 'webgpu' | 'wasm';

/**
 * The one Smart Turn worker every leg shares: loaded on the first connection,
 * on WebGPU when there is an adapter and on WASM otherwise or after a WebGPU
 * failure, and disposed with the last connection.
 */
export class TurnRuntime {
  private session: WorkerSession | null = null;
  private loading: Promise<WorkerSession | null> | null = null;
  private webgpuFailed = false;
  private nextId = 0;
  private readonly live = new Set<number>();

  /** Null without the model on disk: the run is then Normal. */
  async connect(): Promise<TurnConnection | null> {
    let onDisk = false;
    try {
      onDisk = await ModelManager.getInstance().isModelReady(SMART_TURN_MODEL_ID);
    } catch {
      onDisk = false;
    }
    if (!onDisk) return null;
    const id = ++this.nextId;
    const channel = new MessageChannel();
    this.live.add(id);
    void this.load().then((session) => {
      if (session && this.live.has(id)) {
        const message: TurnConnectMessage = { type: 'connect', id, port: channel.port2 };
        session.post(message, [channel.port2]);
      } else {
        channel.port2.close();
      }
    });
    return { port: channel.port1, release: () => this.release(id) };
  }

  private release(id: number): void {
    if (!this.live.delete(id) || !this.session) return;
    const message: TurnDisconnectMessage = { type: 'disconnect', id };
    this.session.post(message);
    if (this.live.size === 0) {
      this.session.dispose();
      this.session = null;
    }
  }

  private load(): Promise<WorkerSession | null> {
    if (this.session) return Promise.resolve(this.session);
    if (!this.loading) {
      this.loading = this.open().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  private async open(): Promise<WorkerSession | null> {
    const backend: Backend = !this.webgpuFailed && (await checkWebGPU()).available ? 'webgpu' : 'wasm';
    let session: WorkerSession;
    try {
      session = await this.start(backend);
    } catch (err) {
      if (backend === 'webgpu') {
        this.webgpuFailed = true;
        return this.open();
      }
      reportWarning('SmartTurn', `Smart Turn could not load; turns end on silence: ${describeCause(err)}`, {
        cause: err,
        dedupeKey: 'smart-turn:load',
      });
      return null;
    }
    if (this.live.size === 0) {
      session.dispose();
      return null;
    }
    this.session = session;
    return session;
  }

  private async start(backend: Backend): Promise<WorkerSession> {
    const manager = ModelManager.getInstance();
    const fileUrls = await manager.getModelBlobUrls(SMART_TURN_MODEL_ID);
    const session: WorkerSession = new WorkerSession({
      makeWorker: () => createTurnWorker(backend),
      onMessage: () => {},
      revokeBlobs: () => manager.revokeBlobUrls(fileUrls),
      onFatalError: (message) => this.crashed(session, backend, message),
    });
    const init: TurnInitMessage = {
      type: 'init',
      fileUrls,
      ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
      numThreads: numThreadsFor(),
    };
    await session.start(init);
    return session;
  }

  /** A loaded worker died: its ports went with it, so this run stays Normal; the next connection reloads. */
  private crashed(session: WorkerSession, backend: Backend, message: string): void {
    if (this.session !== session) return;
    this.session = null;
    session.dispose();
    if (backend === 'webgpu') this.webgpuFailed = true;
    reportWarning('SmartTurn', `Smart Turn stopped; turns end on silence: ${message}`, { dedupeKey: 'smart-turn:crash' });
  }
}

export const turnRuntime = new TurnRuntime();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/turn/TurnRuntime.test.ts src/lib/segmentation/PunctuationRuntime.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/lib/turn|PunctuationRuntime"`
Expected: no output.

```bash
git add src/lib/segmentation/PunctuationRuntime.ts src/lib/turn/createTurnWorker.ts src/lib/turn/TurnRuntime.ts src/lib/turn/TurnRuntime.test.ts
git commit -F - <<'EOF'
feat(local-inference): Smart Turn runtime with WASM fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 6: The turn gate (`_shared/turn-gate.ts`)

**Files:**
- Modify: `src/lib/local-inference/types.ts:16-29` (`VadWebConfig.smartTurn`)
- Create: `src/lib/local-inference/workers/_shared/turn-gate.ts`
- Create: `src/lib/local-inference/workers/_shared/turn-gate.test.ts`

**Interfaces:**
- Consumes: `TURN_WINDOW_SAMPLES`, `TurnPredictRequest`, `TurnPredictAnswer` (Task 3); `VAD_FRAME_SAMPLES`, `VAD_SAMPLE_RATE` (`_shared/max-speech-frames.ts`); the public fields of vad-web's `FrameProcessor` (`preSpeechPadFrames`, `minSpeechFrames`, `options.positiveSpeechThreshold`, `options.negativeSpeechThreshold`)
- Produces:
  - `VadWebConfig.smartTurn?: { checkAfter: number; threshold: number }`
  - `interface TurnGateOptions { triggerFrames: number; threshold: number; positiveThreshold: number; negativeThreshold: number; preSpeechPadFrames: number; minSpeechFrames: number }`
  - `interface FrameProcessorParams { preSpeechPadFrames: number; minSpeechFrames: number; options: { positiveSpeechThreshold: number; negativeSpeechThreshold: number } }`. vad-web's `FrameProcessor` satisfies it.
  - `interface TurnRequest { id: number; window: Float32Array }`
  - `class TurnGate { push(frame, probability, speaking): TurnRequest | null; shouldEnd(id, probability): boolean; reset(): void }`
  - `class TurnLink { constructor(port: MessagePort, gate: TurnGate); afterFrame(frame: Float32Array, probability: number, speaking: boolean): boolean; reset(): void; close(): void }`
  - `openTurnLink(port: MessagePort | undefined, vadConfig: VadWebConfig | undefined, processor: FrameProcessorParams | null): TurnLink | null`

- [ ] **Step 1: Write the failing test**

`src/lib/local-inference/workers/_shared/turn-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FrameProcessor, type FrameProcessorOptions } from '@ricky0123/vad-web/dist/frame-processor';
import { TurnGate, TurnLink, openTurnLink, type TurnGateOptions, type TurnRequest } from './turn-gate';
import type { TurnPredictRequest } from './turn-protocol';

const FRAME = 512;
const SPEECH = 0.9;
const GRAY = 0.4;
const SILENCE = 0.1;

const gateWith = (over: Partial<TurnGateOptions> = {}) => new TurnGate({
  triggerFrames: 3,
  threshold: 0.5,
  positiveThreshold: 0.5,
  negativeThreshold: 0.35,
  preSpeechPadFrames: 2,
  minSpeechFrames: 1,
  ...over,
});

/** Feeds frames numbered from 0, each filled with its own number, so a window shows where it starts. */
function feeder(gate: TurnGate) {
  let n = 0;
  const feed = (count: number, probability: number, speaking: boolean): TurnRequest[] => {
    const requests: TurnRequest[] = [];
    for (let i = 0; i < count; i++) {
      const request = gate.push(new Float32Array(FRAME).fill(n++), probability, speaking);
      if (request) requests.push(request);
    }
    return requests;
  };
  return {
    idle: (count = 1) => feed(count, SILENCE, false),
    speech: (count = 1) => feed(count, SPEECH, true),
    gray: (count = 1) => feed(count, GRAY, true),
    silence: (count = 1) => feed(count, SILENCE, true),
  };
}

describe('TurnGate — when it asks', () => {
  it('asks at the trigger frame of silence after speech, once per run', () => {
    const f = feeder(gateWith());
    f.idle(2);
    f.speech(4);
    expect(f.silence(2)).toEqual([]);
    expect(f.silence(1)).toHaveLength(1);
    expect(f.silence(20)).toEqual([]);
  });

  it('never asks while the processor is not speaking', () => {
    expect(feeder(gateWith()).idle(50)).toEqual([]);
  });

  it('restarts the run on a frame between the thresholds', () => {
    const f = feeder(gateWith());
    f.speech();
    f.silence(2);
    f.gray();
    expect(f.silence(2)).toEqual([]);
    expect(f.silence(1)).toHaveLength(1);
  });

  it('asks again after speech returns, with a newer id', () => {
    const f = feeder(gateWith());
    f.speech();
    const [first] = f.silence(3);
    f.speech();
    const [second] = f.silence(3);
    expect(second.id).toBeGreaterThan(first.id);
  });
});

describe('TurnGate — the minimum speech', () => {
  it('asks nothing until the segment holds the minimum speech', () => {
    const f = feeder(gateWith({ minSpeechFrames: 5 }));
    f.speech(4);
    expect(f.silence(10)).toEqual([]);
  });

  it('asks once the speech reaches it', () => {
    const f = feeder(gateWith({ minSpeechFrames: 5 }));
    f.speech(5);
    expect(f.silence(3)).toHaveLength(1);
  });

  it('counts speech across the pauses of one segment', () => {
    const f = feeder(gateWith({ minSpeechFrames: 5 }));
    f.speech(3);
    expect(f.silence(3)).toEqual([]);
    f.speech(2);
    expect(f.silence(3)).toHaveLength(1);
  });

  it('starts the count over with each segment', () => {
    const gate = gateWith({ minSpeechFrames: 5 });
    const f = feeder(gate);
    f.speech(4);
    f.idle();
    f.speech(2);
    expect(f.silence(3)).toEqual([]);
    gate.reset();
    f.speech(2);
    expect(f.silence(3)).toEqual([]);
  });
});

describe('TurnGate — which answer ends the segment', () => {
  function asked() {
    const gate = gateWith();
    const f = feeder(gate);
    f.speech();
    const [request] = f.silence(3);
    return { gate, f, request };
  }

  it('the latest request, above the threshold', () => {
    const { gate, request } = asked();
    expect(gate.shouldEnd(request.id, 0.5)).toBe(false);
    expect(gate.shouldEnd(request.id, 0.51)).toBe(true);
  });

  it('not a stale one', () => {
    const { gate, f, request } = asked();
    f.speech();
    const [latest] = f.silence(3);
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
    expect(gate.shouldEnd(latest.id, 0.9)).toBe(true);
  });

  it('not once speech came back', () => {
    const { gate, f, request } = asked();
    f.speech();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
  });

  it('still after a frame between the thresholds', () => {
    const { gate, f, request } = asked();
    f.gray();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(true);
  });

  it('not after the processor ended the segment', () => {
    const { gate, f, request } = asked();
    f.idle();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
  });

  it('not after the worker ended it', () => {
    const { gate, request } = asked();
    gate.reset();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
  });
});

describe('TurnGate — the window', () => {
  it('starts at speech start minus the pre-speech pad', () => {
    const f = feeder(gateWith());
    f.idle(3);
    f.speech(2);
    const [request] = f.silence(3);
    expect(request.window).toHaveLength((2 + 2 + 3) * FRAME);
    expect(request.window[0]).toBe(1);
    expect(request.window[request.window.length - 1]).toBe(7);
  });

  it('takes only the pad there is', () => {
    const f = feeder(gateWith());
    f.idle(1);
    f.speech(1);
    const [request] = f.silence(3);
    expect(request.window).toHaveLength(5 * FRAME);
    expect(request.window[0]).toBe(0);
  });

  it('has no pad right after the processor ended a segment', () => {
    const f = feeder(gateWith());
    f.speech(1);
    f.idle(1);
    f.speech(1);
    const [request] = f.silence(3);
    expect(request.window[0]).toBe(2);
    expect(request.window).toHaveLength(4 * FRAME);
  });

  it('has no pad right after the worker ended one', () => {
    const gate = gateWith();
    const f = feeder(gate);
    f.speech(1);
    f.silence(1);
    gate.reset();
    f.speech(1);
    const [request] = f.silence(3);
    expect(request.window[0]).toBe(2);
  });

  it('keeps the last 8 s of a longer segment', () => {
    const f = feeder(gateWith());
    f.speech(300);
    const [request] = f.silence(3);
    expect(request.window).toHaveLength(128_000);
    expect(request.window[0]).toBe(53);
    expect(request.window[request.window.length - 1]).toBe(302);
  });
});

class FakePort {
  sent: Array<{ message: TurnPredictRequest; transfer: Transferable[] }> = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  postMessage(message: TurnPredictRequest, transfer: Transferable[]) { this.sent.push({ message, transfer }); }
  close() { this.closed = true; }
  answer(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

const frame = () => new Float32Array(FRAME);

describe('TurnLink', () => {
  function asking() {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith());
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SILENCE, true);
    return { port, link, request: port.sent[0].message };
  }

  it('posts the request with its window transferred', () => {
    const { port, request } = asking();
    expect(port.sent).toHaveLength(1);
    expect(request.type).toBe('predict');
    expect(port.sent[0].transfer).toEqual([request.window.buffer]);
  });

  it('ends the segment on the frame after a yes, once', () => {
    const { port, link, request } = asking();
    port.answer({ id: request.id, probability: 0.9 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(true);
    port.answer({ id: request.id, probability: 0.9 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(false);
  });

  it('changes nothing on a no or a failed prediction', () => {
    const { port, link, request } = asking();
    port.answer({ id: request.id, probability: 0.2 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(false);
    port.answer({ id: request.id, error: 'bad input' });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(false);
  });

  it('drops an answer that arrived before the worker ended the segment itself', () => {
    const { port, link, request } = asking();
    port.answer({ id: request.id, probability: 0.9 });
    link.reset();
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(false);
  });

  it('asks nothing after speech under the minimum, so a "complete" answer cannot end it', () => {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith({ minSpeechFrames: 5 }));
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 10; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(0);
    port.answer({ id: 1, probability: 0.99 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(false);
  });

  it('asks once the speech reached the minimum, and a "complete" answer ends it', () => {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith({ minSpeechFrames: 5 }));
    for (let i = 0; i < 5; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
    port.answer({ id: port.sent[0].message.id, probability: 0.99 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(true);
  });

  it('stops listening and closes the port', () => {
    const { port, link } = asking();
    link.close();
    expect(port.closed).toBe(true);
    expect(port.onmessage).toBeNull();
  });
});

describe('openTurnLink', () => {
  const smart = { checkAfter: 0.3, threshold: 0.5 };
  const processor = (over: Partial<FrameProcessorOptions> = {}) => new FrameProcessor(
    async () => ({ isSpeech: 0, notSpeech: 1 }),
    () => {},
    {
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 1400,
      minSpeechMs: 32,
      preSpeechPadMs: 800,
      submitUserSpeechOnPause: false,
      ...over,
    },
    32,
  );
  const open = (port: FakePort, checkAfter: number, over: Partial<FrameProcessorOptions> = {}) =>
    openTurnLink(port as unknown as MessagePort, { smartTurn: { checkAfter, threshold: 0.5 } }, processor(over))!;

  it('needs a port, Smart Turn in the VAD config, and the processor', () => {
    expect(openTurnLink(undefined, { smartTurn: smart }, processor())).toBeNull();
    expect(openTurnLink(new FakePort() as unknown as MessagePort, { threshold: 0.3 }, processor())).toBeNull();
    expect(openTurnLink(new FakePort() as unknown as MessagePort, { smartTurn: smart }, null)).toBeNull();
  });

  it('asks after ceil(checkAfter / 32 ms) frames of silence', () => {
    const port = new FakePort();
    const link = open(port, 0.3);
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 9; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(0);
    link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
  });

  it("takes the silence threshold from the processor", () => {
    const port = new FakePort();
    const link = open(port, 0.1, { negativeSpeechThreshold: 0.2 });
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), 0.25, true);
    expect(port.sent).toHaveLength(0);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
  });

  it('pads the window as the processor does', () => {
    const port = new FakePort();
    const link = open(port, 0.1, { preSpeechPadMs: 64 });
    for (let i = 0; i < 5; i++) link.afterFrame(frame(), SILENCE, false);
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent[0].message.window).toHaveLength((2 + 1 + 4) * FRAME);
  });

  it("waits for the processor's minimum speech", () => {
    const port = new FakePort();
    const link = open(port, 0.1, { minSpeechMs: 160 });
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(0);
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/local-inference/workers/_shared/turn-gate.test.ts`
Expected: FAIL, `Failed to resolve import "./turn-gate"`.

- [ ] **Step 3: Implement**

In `src/lib/local-inference/types.ts`, inside `VadWebConfig`, after `maxSpeechDuration?: number;`:

```ts
  /** Smart Turn: after `checkAfter` s of silence, end the segment when the turn model says above `threshold`. Needs a turn port. */
  smartTurn?: { checkAfter: number; threshold: number };
```

`src/lib/local-inference/workers/_shared/turn-gate.ts`:

```ts
/**
 * Smart Turn's gate inside a VAD worker: after a short silence it asks the
 * turn worker whether the speaker has finished, and on a yes the worker ends
 * the segment early. Anything else leaves it to the FrameProcessor's own
 * redemption.
 */
import type { VadWebConfig } from '../../types';
import { VAD_FRAME_SAMPLES, VAD_SAMPLE_RATE } from './max-speech-frames';
import { TURN_WINDOW_SAMPLES, type TurnPredictAnswer, type TurnPredictRequest } from './turn-protocol';

const FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

export interface TurnGateOptions {
  /** Consecutive frames under the negative threshold before it asks. */
  triggerFrames: number;
  /** A probability above this ends the segment. */
  threshold: number;
  positiveThreshold: number;
  negativeThreshold: number;
  /** The FrameProcessor's own pre-speech pad, in frames. */
  preSpeechPadFrames: number;
  /** The FrameProcessor's misfire floor: with fewer speech frames it would drop the segment. */
  minSpeechFrames: number;
}

/** The FrameProcessor fields the gate copies; each worker passes its own instance. */
export interface FrameProcessorParams {
  preSpeechPadFrames: number;
  minSpeechFrames: number;
  options: { positiveSpeechThreshold: number; negativeSpeechThreshold: number };
}

export interface TurnRequest {
  id: number;
  window: Float32Array;
}

export class TurnGate {
  private readonly audio = new Float32Array(TURN_WINDOW_SAMPLES);
  private samplesFed = 0;
  private speaking = false;
  /** Frames the FrameProcessor holds as pre-speech pad while it is not speaking. */
  private padFrames = 0;
  private segmentStart = 0;
  /** Frames at or above the positive threshold since the segment started, as the processor counts them. */
  private speechFrames = 0;
  private silentRun = 0;
  private lastId = 0;
  private openId: number | null = null;

  constructor(private readonly opts: TurnGateOptions) {}

  /** One frame, after FrameProcessor.process() returned; `speaking` is the processor's state after it. */
  push(frame: Float32Array, probability: number, speaking: boolean): TurnRequest | null {
    const frameStart = this.samplesFed;
    this.write(frame);
    if (!speaking) {
      this.padFrames = this.speaking ? 0 : Math.min(this.padFrames + 1, this.opts.preSpeechPadFrames);
      this.speaking = false;
      this.silentRun = 0;
      this.openId = null;
      return null;
    }
    if (!this.speaking) {
      this.speaking = true;
      this.segmentStart = frameStart - this.padFrames * frame.length;
      this.speechFrames = 0;
      this.silentRun = 0;
    }
    if (probability >= this.opts.positiveThreshold) {
      this.speechFrames++;
      this.silentRun = 0;
      this.openId = null;
      return null;
    }
    if (probability >= this.opts.negativeThreshold) {
      this.silentRun = 0;
      return null;
    }
    if (++this.silentRun !== this.opts.triggerFrames || this.speechFrames < this.opts.minSpeechFrames) return null;
    this.openId = ++this.lastId;
    return { id: this.openId, window: this.window() };
  }

  shouldEnd(id: number, probability: number): boolean {
    return this.speaking && id === this.openId && probability > this.opts.threshold;
  }

  /** The worker ended the segment with endSegment(): the FrameProcessor holds nothing now. */
  reset(): void {
    this.speaking = false;
    this.padFrames = 0;
    this.speechFrames = 0;
    this.silentRun = 0;
    this.openId = null;
  }

  private write(frame: Float32Array): void {
    for (let i = 0; i < frame.length; i++) this.audio[(this.samplesFed + i) % TURN_WINDOW_SAMPLES] = frame[i];
    this.samplesFed += frame.length;
  }

  private window(): Float32Array {
    const length = Math.min(this.samplesFed - this.segmentStart, TURN_WINDOW_SAMPLES);
    const out = new Float32Array(length);
    const from = this.samplesFed - length;
    for (let i = 0; i < length; i++) out[i] = this.audio[(from + i) % TURN_WINDOW_SAMPLES];
    return out;
  }
}

/** The gate and its port to the turn worker; an answer is applied at the frame after it arrives. */
export class TurnLink {
  private answer: { id: number; probability: number } | null = null;

  constructor(private readonly port: MessagePort, private readonly gate: TurnGate) {
    port.onmessage = (event: MessageEvent<TurnPredictAnswer>) => {
      const data = event.data;
      if ('probability' in data) this.answer = { id: data.id, probability: data.probability };
    };
  }

  /** True: end the segment now, fire-and-forget, as the max-speech cap does. */
  afterFrame(frame: Float32Array, probability: number, speaking: boolean): boolean {
    const request = this.gate.push(frame, probability, speaking);
    if (request) {
      const message: TurnPredictRequest = { type: 'predict', id: request.id, window: request.window };
      this.port.postMessage(message, [request.window.buffer]);
    }
    const answer = this.answer;
    this.answer = null;
    if (!answer || !this.gate.shouldEnd(answer.id, answer.probability)) return false;
    this.gate.reset();
    return true;
  }

  /** The worker ended the segment itself (the cap, a flush). */
  reset(): void {
    this.answer = null;
    this.gate.reset();
  }

  close(): void {
    this.port.onmessage = null;
    this.port.close();
  }
}

export function openTurnLink(
  port: MessagePort | undefined,
  vadConfig: VadWebConfig | undefined,
  processor: FrameProcessorParams | null,
): TurnLink | null {
  const smart = vadConfig?.smartTurn;
  if (!port || !smart || !processor) return null;
  return new TurnLink(port, new TurnGate({
    triggerFrames: Math.ceil(Math.round(smart.checkAfter * 1000) / FRAME_MS),
    threshold: smart.threshold,
    positiveThreshold: processor.options.positiveSpeechThreshold,
    negativeThreshold: processor.options.negativeSpeechThreshold,
    preSpeechPadFrames: processor.preSpeechPadFrames,
    minSpeechFrames: processor.minSpeechFrames,
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/workers/_shared/turn-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "turn-gate|local-inference/types"`
Expected: no output.

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/workers/_shared/turn-gate.ts src/lib/local-inference/workers/_shared/turn-gate.test.ts
git commit -F - <<'EOF'
feat(local-inference): Smart Turn gate for the VAD workers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 7: Wire the gate into the five vad-web workers

**Files:**
- Create: `src/lib/local-inference/workers/turnGate.consistency.test.ts`
- Modify: `src/lib/local-inference/workers/_shared/harness-consolidation.test.ts:134-138` (one more path)
- Modify: `src/lib/local-inference/types.ts` (`turnPort` on four init messages)
- Modify: `src/lib/local-inference/workers/whisper-webgpu.worker.ts`
- Modify: `src/lib/local-inference/workers/granite-speech-webgpu.worker.ts`
- Modify: `src/lib/local-inference/workers/qwen3-asr-webgpu.worker.ts`
- Modify: `src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts`
- Modify: `src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts`

**Interfaces:**
- Consumes: `openTurnLink(port, vadConfig, processor)`, `TurnLink` (Task 6); `SMART_TURN_WORKER_TYPES` (Task 1)
- Produces: `turnPort?: MessagePort` on `WhisperAsrInitMessage` (and so `Qwen3AsrInitMessage`), `CohereTranscribeAsrInitMessage`, `Voxtral3BAsrInitMessage` and `GraniteSpeechInitMessage`. Each of the five workers opens the link from `msg.turnPort`, `msg.vadConfig` and the `frameProcessor` its `initVad` just built, so the gate takes its thresholds, pre-speech pad and `minSpeechFrames` from the worker's own init values.

- [ ] **Step 1: Write the failing consistency tests**

`src/lib/local-inference/workers/turnGate.consistency.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SMART_TURN_WORKER_TYPES } from '../../turn/smartTurn';

/** Every vad-web worker in Smart Turn's scope wires the gate; the two outside it say why. */

const WORKERS_DIR = __dirname;

const EXEMPT: Record<string, string> = {
  'native-vad.worker.ts': "Local Native's VAD, which follows that provider onto the new contract (#578)",
  'voxtral-webgpu.worker.ts': 'it streams, and already ends a segment on sentence punctuation',
};

const vadWorkers = readdirSync(WORKERS_DIR)
  .filter((name) => name.endsWith('.worker.ts'))
  .map((name) => ({ name, source: readFileSync(join(WORKERS_DIR, name), 'utf8') }))
  .filter(({ source }) => source.includes('new FrameProcessor('));

function between(source: string, from: string, to: string): string {
  const a = source.indexOf(from);
  expect(a, `anchor ${JSON.stringify(from)}`).toBeGreaterThanOrEqual(0);
  const b = source.indexOf(to, a + from.length);
  expect(b, `anchor ${JSON.stringify(to)}`).toBeGreaterThanOrEqual(0);
  return source.slice(a, b);
}

describe('Smart Turn gate wiring', () => {
  it('finds the vad-web workers', () => {
    expect(vadWorkers.map((w) => w.name).sort()).toEqual(
      [...SMART_TURN_WORKER_TYPES.map((type) => `${type}.worker.ts`), ...Object.keys(EXEMPT)].sort(),
    );
  });

  for (const { name, source } of vadWorkers) {
    if (name in EXEMPT) {
      it(`${name} stays out: ${EXEMPT[name]}`, () => {
        expect(source).not.toMatch(/_shared\/turn-gate/);
      });
      continue;
    }

    describe(name, () => {
      it('opens the link from its init message', () => {
        expect(source).toMatch(/from '\.\/_shared\/turn-gate'/);
        expect(source).toMatch(/turnLink = openTurnLink\(msg\.turnPort, msg\.vadConfig, frameProcessor\);/);
      });

      it("feeds the gate every frame's speech probability", () => {
        expect(source).toMatch(/case Message\.FrameProcessed:\s*speechProbability = ev\.probs\.isSpeech;/);
        expect(source).toMatch(/turnLink\?\.afterFrame\(frame, speechProbability, frameProcessor\.speaking\)/);
      });

      it('resets the gate where the worker ends a segment itself', () => {
        expect(between(source, 'speechFramesSinceStart >= maxSpeechFrames', 'speechFramesSinceStart = 0;')).toMatch(/turnLink\?\.reset\(\)/);
        expect(between(source, 'async function handleFlush', 'async function handleDispose')).toMatch(/turnLink\?\.reset\(\)/);
      });

      it('closes the link on dispose', () => {
        expect(source.slice(source.indexOf('async function handleDispose'))).toMatch(/turnLink\?\.close\(\)/);
      });
    });
  }
});
```

In `src/lib/local-inference/workers/_shared/harness-consolidation.test.ts`, replace

```ts
    const paths: Array<[string, string]> = [
      ['SpeechEnd', sliceBetween(src, name, 'case Message.SpeechEnd:', 'case Message.VADMisfire:')],
      ['max-speech cap', sliceBetween(src, name, 'speechFramesSinceStart >= maxSpeechFrames', 'speechFramesSinceStart = 0;')],
      ['flush', sliceBetween(src, name, 'async function handleFlush', 'async function handleDispose')],
    ];
```

with

```ts
    const paths: Array<[string, string]> = [
      ['SpeechEnd', sliceBetween(src, name, 'case Message.SpeechEnd:', 'case Message.VADMisfire:')],
      ['max-speech cap', sliceBetween(src, name, 'speechFramesSinceStart >= maxSpeechFrames', 'speechFramesSinceStart = 0;')],
      ['flush', sliceBetween(src, name, 'async function handleFlush', 'async function handleDispose')],
      ['Smart Turn', sliceBetween(src, name, 'turnLink?.afterFrame(', '// Max speech duration cap')],
    ];
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/local-inference/workers/turnGate.consistency.test.ts src/lib/local-inference/workers/_shared/harness-consolidation.test.ts`
Expected: FAIL. Each of the five workers fails "opens the link", "feeds the gate", "resets the gate" and "closes the link", and the #470 test fails on the missing `turnLink?.afterFrame(` anchor.

- [ ] **Step 3: Add `turnPort` to the init messages**

In `src/lib/local-inference/types.ts`, add this field to `WhisperAsrInitMessage` (after `vadModelUrl?: string;`), `CohereTranscribeAsrInitMessage` (after `ortWasmBaseUrl?: string;`), `Voxtral3BAsrInitMessage` (after `ortWasmBaseUrl?: string;`) and `GraniteSpeechInitMessage` (after `vadModelUrl?: string;`):

```ts
  /** Smart Turn's port (transferred); with `vadConfig.smartTurn` it turns the gate on. */
  turnPort?: MessagePort;
```

- [ ] **Step 4: Make the edits every worker shares**

Apply these four edits to each of `whisper-webgpu.worker.ts`, `granite-speech-webgpu.worker.ts`, `qwen3-asr-webgpu.worker.ts`, `cohere-transcribe-webgpu.worker.ts` and `voxtral-3b-webgpu.worker.ts`. Each quoted anchor occurs exactly once in each file (checked while planning).

**State.** Replace `let frameProcessor: FrameProcessor | null = null;` with

```ts
let frameProcessor: FrameProcessor | null = null;
let turnLink: TurnLink | null = null;
```

**Probability per frame.** Replace

```ts
      for (const ev of events) {
        switch (ev.msg) {
```

with

```ts
      let speechProbability = 0;
      for (const ev of events) {
        switch (ev.msg) {
          case Message.FrameProcessed:
            speechProbability = ev.probs.isSpeech;
            break;

```

**Cap path.** Replace

```ts
          speechFramesSinceStart = 0;
        }
      } else {
```

with

```ts
          turnLink?.reset();
          speechFramesSinceStart = 0;
        }
      } else {
```

**Dispose.** In `handleDispose`, replace `  frameProcessor = null;` with

```ts
  frameProcessor = null;
  turnLink?.close();
  turnLink = null;
```

- [ ] **Step 5: Make each worker's own edits**

Each worker gets the import, the turn path, the flush reset and the init line. They differ by the file's decode call and its surrounding text. The turn path goes immediately before the line `      // Max speech duration cap…` inside `feedAudio`. That line has six leading spaces; whisper also has an unindented comment starting the same way near the top of the file, which is not the anchor.

**`whisper-webgpu.worker.ts`**

After `import {SileroInput, SILERO_INPUT_SAMPLES} from './_shared/silero-input';` add:

```ts
import {openTurnLink, type TurnLink} from './_shared/turn-gate';
```

Insert before `      // Max speech duration cap (not built into FrameProcessor)`:

```ts
      if (turnLink?.afterFrame(frame, speechProbability, frameProcessor.speaking)) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) void scheduleWhisper(ev.audio, speechStartSample);
        }
      }

```

In `handleFlush`, replace

```ts
        void scheduleWhisper(ev.audio, speechStartSample);
      }
    }
    speechFramesSinceStart = 0;
  }
```

with

```ts
        void scheduleWhisper(ev.audio, speechStartSample);
      }
    }
    turnLink?.reset();
    speechFramesSinceStart = 0;
  }
```

In `handleInit`, replace `    await initVad(msg.vadConfig, msg.vadModelUrl);` with

```ts
    await initVad(msg.vadConfig, msg.vadModelUrl);
    turnLink = openTurnLink(msg.turnPort, msg.vadConfig, frameProcessor);
```

**`granite-speech-webgpu.worker.ts`**

After `import { SileroInput, SILERO_INPUT_SAMPLES } from './_shared/silero-input';` add:

```ts
import { openTurnLink, type TurnLink } from './_shared/turn-gate';
```

Insert before `      // Max speech duration cap`:

```ts
      if (turnLink?.afterFrame(frame, speechProbability, frameProcessor.speaking)) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) void scheduleGraniteInference(ev.audio, speechStartSample);
        }
      }

```

In `handleFlush`, replace

```ts
        void scheduleGraniteInference(ev.audio, speechStartSample);
      }
    }
  }
  // Drain the chain
```

with

```ts
        void scheduleGraniteInference(ev.audio, speechStartSample);
      }
    }
    turnLink?.reset();
  }
  // Drain the chain
```

In `handleInit`, replace

```ts
      msg.task === 'translate' ? GRANITE_TRANSLATE_MAX_SPEECH_SECONDS : GRANITE_MAX_SPEECH_SECONDS,
    );
```

with

```ts
      msg.task === 'translate' ? GRANITE_TRANSLATE_MAX_SPEECH_SECONDS : GRANITE_MAX_SPEECH_SECONDS,
    );
    turnLink = openTurnLink(msg.turnPort, msg.vadConfig, frameProcessor);
```

**`qwen3-asr-webgpu.worker.ts`**

After `import { SileroInput, SILERO_INPUT_SAMPLES } from './_shared/silero-input';` add:

```ts
import { openTurnLink, type TurnLink } from './_shared/turn-gate';
```

Insert before `      // Max speech duration cap`:

```ts
      if (turnLink?.afterFrame(frame, speechProbability, frameProcessor.speaking)) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) void transcribe(ev.audio, speechStartSample);
        }
      }

```

In `handleFlush`, replace

```ts
        void transcribe(ev.audio, speechStartSample);
      }
    }
  }
  if (currentDecodePromise) {
```

with

```ts
        void transcribe(ev.audio, speechStartSample);
      }
    }
    turnLink?.reset();
  }
  if (currentDecodePromise) {
```

In `handleInit`, replace `    await initVad(msg.vadConfig, msg.vadModelUrl, msg.language);` with

```ts
    await initVad(msg.vadConfig, msg.vadModelUrl, msg.language);
    turnLink = openTurnLink(msg.turnPort, msg.vadConfig, frameProcessor);
```

**`cohere-transcribe-webgpu.worker.ts`**

After `import { SileroInput, SILERO_INPUT_SAMPLES } from './_shared/silero-input';` add:

```ts
import { openTurnLink, type TurnLink } from './_shared/turn-gate';
```

Insert before `      // Max speech duration cap`:

```ts
      if (turnLink?.afterFrame(frame, speechProbability, frameProcessor.speaking)) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) void scheduleTranscription(ev.audio);
        }
      }

```

In `handleFlush`, replace

```ts
        void scheduleTranscription(ev.audio);
      }
    }
  }
  // Drain the chain
```

with

```ts
        void scheduleTranscription(ev.audio);
      }
    }
    turnLink?.reset();
  }
  // Drain the chain
```

In `handleInit`, replace `    await initVad(msg.vadConfig, msg.vadModelUrl);` with

```ts
    await initVad(msg.vadConfig, msg.vadModelUrl);
    turnLink = openTurnLink(msg.turnPort, msg.vadConfig, frameProcessor);
```

**`voxtral-3b-webgpu.worker.ts`**

After `import { SileroInput, SILERO_INPUT_SAMPLES } from './_shared/silero-input';` add:

```ts
import { openTurnLink, type TurnLink } from './_shared/turn-gate';
```

Insert before `      // Max speech duration cap — force-finalize if speech runs too long`:

```ts
      if (turnLink?.afterFrame(frame, speechProbability, frameProcessor.speaking)) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) void runVoxtral3B(ev.audio);
        }
      }

```

In `handleFlush`, replace

```ts
        void runVoxtral3B(ev.audio);
      }
    }
  }
  // Wait for any in-flight decode to complete
  if (currentDecodePromise) {
```

with

```ts
        void runVoxtral3B(ev.audio);
      }
    }
    turnLink?.reset();
  }
  // Wait for any in-flight decode to complete
  if (currentDecodePromise) {
```

`handleDispose` has a near-identical block, but its comment reads `// Wait for any in-flight decode to complete before disposing`, so the anchor above matches only the one in `handleFlush`.

In `handleInit`, replace `    await initVad(msg.vadConfig, msg.vadModelUrl);` with

```ts
    await initVad(msg.vadConfig, msg.vadModelUrl);
    turnLink = openTurnLink(msg.turnPort, msg.vadConfig, frameProcessor);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/workers/`
Expected: PASS. That includes `turnGate.consistency`, the #470 decode-handoff test with its new Smart Turn path, `sileroInput.consistency` and `shaderF16Gate.consistency`.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "whisper-webgpu|granite-speech|qwen3-asr-webgpu|cohere-transcribe|voxtral-3b|local-inference/types"`
Expected: no output.

```bash
git add src/lib/local-inference/types.ts src/lib/local-inference/workers/turnGate.consistency.test.ts src/lib/local-inference/workers/_shared/harness-consolidation.test.ts src/lib/local-inference/workers/whisper-webgpu.worker.ts src/lib/local-inference/workers/granite-speech-webgpu.worker.ts src/lib/local-inference/workers/qwen3-asr-webgpu.worker.ts src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts src/lib/local-inference/workers/voxtral-3b-webgpu.worker.ts
git commit -F - <<'EOF'
feat(local-inference): wire the Smart Turn gate into the vad-web workers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 8: `AsrEngine` hands the port over, transferred

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts:52-59` (signature) and `:202-236` (the two vad-web `session.start` calls)
- Create: `src/lib/local-inference/engine/AsrEngine.turn.test.ts`

**Interfaces:**
- Consumes: `turnPort` on the init messages (Task 7)
- Produces: `AsrEngine.init(modelId, vadConfig?, language?, taskConfig?, turnPort?: MessagePort)`. A given port rides in the init message with `[turnPort]` as the transfer list.

- [ ] **Step 1: Write the failing test**

`src/lib/local-inference/engine/AsrEngine.turn.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngine } from './AsrEngine';
import { MockWorker, installMockWorker } from './testing/mockWorker';
import { ModelManager } from '../ModelManager';

describe('AsrEngine — the Smart Turn port', () => {
  let restore: () => void;
  let channel: MessageChannel;

  beforeEach(() => {
    restore = installMockWorker();
    channel = new MessageChannel();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ variantKey: 'q4f16', dtype: 'q4f16', files: [] });
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({});
    vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
    channel.port1.close();
    channel.port2.close();
  });

  async function initMessage(engine: AsrEngine, modelId: string, turnPort?: MessagePort) {
    engine.init(modelId, { minSilenceDuration: 1.4 }, 'ja', undefined, turnPort).catch(() => {});
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker = MockWorker.last();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    return worker.postMessage.mock.calls[0] as [Record<string, unknown>, Transferable[]?];
  }

  it.each(['qwen3-asr-0.6b-webgpu', 'granite-speech'])('%s gets the port in its init message, transferred', async (modelId) => {
    const engine = new AsrEngine();
    const [message, transfer] = await initMessage(engine, modelId, channel.port1);
    expect(message.turnPort).toBe(channel.port1);
    expect(transfer).toEqual([channel.port1]);
    engine.dispose();
  });

  it('transfers nothing without a port', async () => {
    const engine = new AsrEngine();
    const call = await initMessage(engine, 'qwen3-asr-0.6b-webgpu');
    expect(call[0].turnPort).toBeUndefined();
    expect(call).toHaveLength(1);
    engine.dispose();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/local-inference/engine/AsrEngine.turn.test.ts`
Expected: FAIL. `message.turnPort` is undefined and nothing is transferred.

- [ ] **Step 3: Implement**

In `src/lib/local-inference/engine/AsrEngine.ts`, replace

```ts
   * @param modelId - Model identifier (e.g. 'sensevoice-int8', 'moonshine-tiny-en-quant')
   * @returns Promise that resolves with load time when ready
   */
  async init(modelId: string, vadConfig?: VadWebConfig, language?: string, taskConfig?: { task: 'transcribe' | 'translate'; targetLanguage?: string }): Promise<{ loadTimeMs: number }> {
```

with

```ts
   * @param modelId - Model identifier (e.g. 'sensevoice-int8', 'moonshine-tiny-en-quant')
   * @param turnPort - Smart Turn's port for a vad-web worker, transferred with its init message
   * @returns Promise that resolves with load time when ready
   */
  async init(modelId: string, vadConfig?: VadWebConfig, language?: string, taskConfig?: { task: 'transcribe' | 'translate'; targetLanguage?: string }, turnPort?: MessagePort): Promise<{ loadTimeMs: number }> {
```

Then, with replace-all (the text occurs twice: in the Whisper/Cohere/Voxtral 3B/Qwen3 branch and in the Granite branch), replace

```ts
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
      });
```

with

```ts
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        turnPort,
      }, turnPort ? [turnPort] : undefined);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/engine/`
Expected: PASS. That includes the existing `AsrEngine.test.ts` and `AsrEngine.qwen3.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/AsrEngine.ts src/lib/local-inference/engine/AsrEngine.turn.test.ts
git commit -F - <<'EOF'
feat(local-inference): hand the Smart Turn port to the ASR worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 9: Settings and config

**Files:**
- Modify: `src/providers/localInference/settings.ts:15-50`
- Modify: `src/providers/localInference/settings.test.ts`
- Modify: `src/providers/localInference/config.ts:17-19` (the `vad` type) and `:84-91` (the `vad` build)
- Modify: `src/providers/localInference/config.test.ts:42` (mock type) and add a `describe` inside `describe('buildLocalInference')`

**Interfaces:**
- Consumes: `VadEndOfTurn`, `supportsSmartTurn`, `effectiveCheckAfter` (Task 1)
- Produces:
  - `LocalInferenceSettings.vadEndOfTurn: VadEndOfTurn` (default `'normal'`), `smartTurnCheckAfter: number` (0.3), `smartTurnThreshold: number` (0.5)
  - `LocalInferenceConfig['vad'].smartTurn?: { checkAfter: number; threshold: number }`, present only under Smart, for an ASR in scope, after the clamp

- [ ] **Step 1: Write the failing tests**

In `src/providers/localInference/settings.test.ts`, inside `describe('LOCAL_INFERENCE_DEFAULTS', …)`:

```ts
  it('starts on Normal, with Smart Turn checking after 0.30 s at 0.50', () => {
    expect(LOCAL_INFERENCE_DEFAULTS.vadEndOfTurn).toBe('normal');
    expect(LOCAL_INFERENCE_DEFAULTS.smartTurnCheckAfter).toBe(0.3);
    expect(LOCAL_INFERENCE_DEFAULTS.smartTurnThreshold).toBe(0.5);
  });
```

In `src/providers/localInference/config.test.ts`, widen the manifest stub's type (line 42):

```ts
let mockManifest: Record<string, { type?: string; asrEngine?: string; astLanguages?: unknown; asrWorkerType?: string }> = {};
```

and add, inside `describe('buildLocalInference', …)`:

```ts
  describe('Smart Turn', () => {
    beforeEach(() => {
      mockManifest = { a: { type: 'asr', asrWorkerType: 'whisper-webgpu' } };
      resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    });

    const build = (over: Partial<LocalInferenceSettings>) =>
      buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(over), shared()) as LocalInferenceConfig;

    it('carries Smart Turn into vad.smartTurn', () => {
      expect(build({ vadEndOfTurn: 'smart' }).vad.smartTurn).toEqual({ checkAfter: 0.3, threshold: 0.5 });
    });

    it('leaves it out under Normal', () => {
      expect(build({}).vad).not.toHaveProperty('smartTurn');
    });

    it.each(['sherpa-onnx', 'voxtral-webgpu', undefined])('leaves it out for an ASR whose worker is %s', (asrWorkerType) => {
      mockManifest = { a: { type: 'asr', asrWorkerType } };
      expect(build({ vadEndOfTurn: 'smart' }).vad).not.toHaveProperty('smartTurn');
    });

    it('holds Turn Check After 0.05 s under Max Wait', () => {
      expect(build({ vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.3, smartTurnCheckAfter: 0.5 }).vad.smartTurn)
        .toEqual({ checkAfter: 0.25, threshold: 0.5 });
    });

    it('drops Smart when Max Wait leaves no room for it', () => {
      expect(build({ vadEndOfTurn: 'smart', vadMinSilenceDuration: 0.05 }).vad).not.toHaveProperty('smartTurn');
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/localInference/settings.test.ts src/providers/localInference/config.test.ts`
Expected: FAIL. The defaults are undefined and `vad.smartTurn` is missing.

- [ ] **Step 3: Implement**

`src/providers/localInference/settings.ts`: add `import type { VadEndOfTurn } from '../../lib/turn/smartTurn';` to the imports. Add to `LocalInferenceSettings`, after `vadPreSpeechPadDuration: number;`:

```ts
  /** 'smart': Smart Turn may end a segment after a short pause; vad-web workers in its scope, Auto turns only. */
  vadEndOfTurn: VadEndOfTurn;
  smartTurnCheckAfter: number;
  smartTurnThreshold: number;
```

and to `LOCAL_INFERENCE_DEFAULTS`, after `vadPreSpeechPadDuration: 0.8,`:

```ts
  vadEndOfTurn: 'normal',
  smartTurnCheckAfter: 0.3,
  smartTurnThreshold: 0.5,
```

`src/providers/localInference/config.ts`: add `import { effectiveCheckAfter, supportsSmartTurn } from '../../lib/turn/smartTurn';`. Change the `vad` line of `LocalInferenceConfig` to

```ts
  vad: { threshold: number; negativeThreshold?: number; minSilenceDuration: number; minSpeechDuration: number; maxSpeechDuration: number; preSpeechPadDuration: number; smartTurn?: { checkAfter: number; threshold: number } };
```

and directly after `if (s.vadNegativeThreshold) vad.negativeThreshold = s.vadNegativeThreshold;` add

```ts
  if (s.vadEndOfTurn === 'smart' && supportsSmartTurn(asrEntry)) {
    const checkAfter = effectiveCheckAfter(s.smartTurnCheckAfter, s.vadMinSilenceDuration);
    if (checkAfter !== null) vad.smartTurn = { checkAfter, threshold: s.smartTurnThreshold };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/localInference/ src/providers/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "providers/localInference"`
Expected: no output.

```bash
git add src/providers/localInference/settings.ts src/providers/localInference/settings.test.ts src/providers/localInference/config.ts src/providers/localInference/config.test.ts
git commit -F - <<'EOF'
feat(local-inference): Smart Turn settings and config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 10: The adapter connects Smart Turn under Auto turns

**Files:**
- Modify: `src/providers/localInference/engines.ts`
- Modify: `src/providers/localInference/engines.test.ts`
- Modify: `src/providers/localInference/fakeEngines.ts`
- Modify: `src/providers/localInference/adapter.ts` (imports; the `tts` field, line 110; the constructor, line 147; the ASR `inits.push`, lines 175-186; `disposeEngines`, lines 362-366)
- Modify: `src/providers/localInference/adapter.test.ts` (new `describe` after `'the LocalInference adapter — loading'`)

**Interfaces:**
- Consumes: `TurnConnection`, `turnRuntime` (Task 5); `AsrEngine.init(..., turnPort)` (Task 8); `config.vad.smartTurn` (Task 9)
- Produces:
  - `AsrInit.turnPort?: MessagePort`
  - `LocalEngines.turn?: () => Promise<TurnConnection | null>`, which `defaultEngines` sets to `turnRuntime.connect()`
  - `FakeTurn` with `connects`, `releases`, `available` and `port`; `createFakeEngines()` returns it as `turn`
  - the frame `local.turn` with payload `{ smart: boolean }`, sent once per start that asks for Smart

- [ ] **Step 1: Write the failing tests**

In `src/providers/localInference/engines.test.ts`, inside `describe('defaultEngines over the real engine classes', …)`:

```ts
  it('ASR: a Smart Turn port reaches the vad-web worker in its init message, transferred', async () => {
    const asr = defaultEngines.asr({ modelId: 'granite-speech', streaming: false });
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('granite-speech', { vadConfig: vad, language: 'ja', turnPort: port1 }));
    const call = worker.postMessage.mock.calls.find((c) => (c[0] as { type?: string }).type === 'init')!;
    expect((call[0] as { turnPort?: MessagePort }).turnPort).toBe(port1);
    expect(call[1]).toEqual([port1]);
    port1.close();
    port2.close();
  });
```

In `src/providers/localInference/adapter.test.ts`, add after the `'the LocalInference adapter — loading'` describe:

```ts
describe('the LocalInference adapter — Smart Turn', () => {
  const smart = () => makeConfig({ vad: { ...makeConfig().vad, smartTurn: { checkAfter: 0.3, threshold: 0.5 } } });
  const turnFrames = (log: ConformanceLog) => ofKind(log, 'frame').filter((f) => f.type === 'local.turn').map((f) => f.payload);

  it('hands the ASR a Smart Turn port under Auto turns', async () => {
    const t = await open(smart());
    expect(t.turn.connects).toBe(1);
    expect(t.asr.inits[0].options.turnPort).toBe(t.turn.port);
    expect(turnFrames(t.log)).toEqual([{ smart: true }]);
    expectConformant(t.log, t.context);
  });

  it('connects nothing under manual turns: the held key ends the turn', async () => {
    const t = await open(smart(), { ...auto, turns: 'manual' });
    expect(t.turn.connects).toBe(0);
    expect(t.asr.inits[0].options.turnPort).toBeUndefined();
    expect(turnFrames(t.log)).toEqual([]);
  });

  it('connects nothing when Smart Turn is off', async () => {
    const t = await open();
    expect(t.turn.connects).toBe(0);
    expect(turnFrames(t.log)).toEqual([]);
  });

  it('runs Normal when the runtime has no port for it', async () => {
    const fakes = createFakeEngines();
    fakes.turn.available = false;
    const recorder = recordConformance();
    const starting = createLocalInferenceAdapter(fakes.engines).start(
      { context: auto, config: smart(), credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal },
      recorder.events,
    );
    fakes.asr.ready();
    fakes.translation.ready();
    await starting;
    expect(fakes.asr.inits[0].options.turnPort).toBeUndefined();
    expect(turnFrames(recorder.log)).toEqual([{ smart: false }]);
  });

  it('releases the connection when the session stops', async () => {
    const t = await open(smart());
    await t.session.stop();
    expect(t.turn.releases).toBe(1);
  });

  it('releases it when the start fails', async () => {
    const t = begin(smart());
    t.asr.failInit('boom');
    await t.starting.catch(() => {});
    expect(t.turn.releases).toBe(1);
  });

  it('releases a connection that arrives after the start was cancelled', async () => {
    const controller = new AbortController();
    const t = begin(smart(), auto, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(t.starting).rejects.toThrow('cancelled');
    await settle();
    expect(t.turn.connects).toBe(1);
    expect(t.turn.releases).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/localInference/engines.test.ts src/providers/localInference/adapter.test.ts`
Expected: FAIL. `t.turn` is undefined, and the engine passes no port to `AsrEngine.init`.

- [ ] **Step 3: Implement**

**`src/providers/localInference/engines.ts`**

Add to the imports:

```ts
import { turnRuntime, type TurnConnection } from '../../lib/turn/TurnRuntime';
```

In `AsrInit`, replace its last member and closing brace

```ts
  punctuationEndpoint?: boolean;
}
```

with

```ts
  punctuationEndpoint?: boolean;
  /** Smart Turn's port: the vad-web worker asks it whether a pause ends the turn. */
  turnPort?: MessagePort;
}
```

In `LocalEngines`, replace

```ts
  tts(): TtsLike;
}
```

with

```ts
  tts(): TtsLike;
  /** A connection to the Smart Turn worker; null when it cannot run. */
  turn?: () => Promise<TurnConnection | null>;
}
```

In `asrOver`, replace

```ts
    async init(modelId, { vadConfig, language, translateTo, punctuationEndpoint }) {
      if (engine instanceof StreamingAsrEngine) {
        await engine.init(modelId, { language, vadConfig, punctuationEndpoint: punctuationEndpoint ?? true });
      } else {
        await engine.init(modelId, vadConfig, language, translateTo ? { task: 'translate', targetLanguage: translateTo } : undefined);
      }
    },
```

with

```ts
    async init(modelId, { vadConfig, language, translateTo, punctuationEndpoint, turnPort }) {
      if (engine instanceof StreamingAsrEngine) {
        await engine.init(modelId, { language, vadConfig, punctuationEndpoint: punctuationEndpoint ?? true });
      } else {
        await engine.init(modelId, vadConfig, language, translateTo ? { task: 'translate', targetLanguage: translateTo } : undefined, turnPort);
      }
    },
```

In `defaultEngines`, replace `  tts: () => new TtsEngine(),` with

```ts
  tts: () => new TtsEngine(),
  turn: () => turnRuntime.connect(),
```

**`src/providers/localInference/fakeEngines.ts`**

Add to the imports:

```ts
import type { TurnConnection } from '../../lib/turn/TurnRuntime';
```

Add directly above the doc comment of `createFakeEngines`:

```ts
/** Smart Turn's runtime as the adapter sees it: a connection per ASR load, null when it cannot run. */
export class FakeTurn {
  connects = 0;
  releases = 0;
  available = true;
  readonly port = {} as MessagePort;

  connect(): Promise<TurnConnection | null> {
    this.connects++;
    if (!this.available) return Promise.resolve(null);
    return Promise.resolve({ port: this.port, release: () => { this.releases++; } });
  }
}

```

Replace `createFakeEngines` (keep its doc comment) with

```ts
export function createFakeEngines() {
  const asr = new FakeAsr();
  const translation = new FakeTranslation();
  const tts = new FakeTts();
  const turn = new FakeTurn();
  const created: Array<'asr' | 'translation' | 'tts'> = [];
  const engines: LocalEngines = {
    asr: (config) => { created.push('asr'); asr.config = config; return asr; },
    translation: () => { created.push('translation'); return translation; },
    tts: () => { created.push('tts'); return tts; },
    turn: () => turn.connect(),
  };
  return { engines, asr, translation, tts, turn, created };
}
```

**`src/providers/localInference/adapter.ts`**

Replace the engines import with

```ts
import { defaultEngines, type AsrInit, type AsrLike, type LocalEngines, type TranslationLike, type TtsLike, type TtsReady } from './engines';
```

and add

```ts
import type { TurnConnection } from '../../lib/turn/TurnRuntime';
```

In `LocalSession`, replace `  private tts: TtsLike | null;` with

```ts
  private tts: TtsLike | null;
  private readonly connectTurn: LocalEngines['turn'];
  private turn: TurnConnection | null = null;
```

In the constructor, replace `    this.asr = engines.asr(this.config.asr);` with

```ts
    this.asr = engines.asr(this.config.asr);
    this.connectTurn = engines.turn;
```

In `open()`, replace the ASR entry's `load`

```ts
      load: () => this.asr.init(config.asr.modelId, {
        vadConfig: config.vad,
        language: source,
        translateTo: config.translation.kind === 'ast' ? target : undefined,
        // Exactly one layer may cut (ruling 10): the worker's own sentence endpoint stays on unless the stream shape seals.
        punctuationEndpoint: this.cut === null,
      }),
```

with

```ts
      load: () => {
        const options: AsrInit = {
          vadConfig: config.vad,
          language: source,
          translateTo: config.translation.kind === 'ast' ? target : undefined,
          // Exactly one layer may cut (ruling 10): the worker's own sentence endpoint stays on unless the stream shape seals.
          punctuationEndpoint: this.cut === null,
        };
        // Under manual turns the held key ends the turn.
        if (!config.vad.smartTurn || request.context.turns !== 'auto' || !this.connectTurn) {
          return this.asr.init(config.asr.modelId, options);
        }
        return this.openTurn(this.connectTurn).then((turnPort) =>
          this.asr.init(config.asr.modelId, turnPort ? { ...options, turnPort } : options));
      },
```

Replace

```ts
  private disposeEngines(): void {
    this.asr.dispose();
    this.translation?.dispose();
    this.tts?.dispose();
  }
```

with

```ts
  private disposeEngines(): void {
    this.asr.dispose();
    this.translation?.dispose();
    this.tts?.dispose();
    this.turn?.release();
    this.turn = null;
  }

  /** A Smart Turn port for the ASR, or none: the run is then Normal. */
  private async openTurn(connect: () => Promise<TurnConnection | null>): Promise<MessagePort | undefined> {
    const turn = await connect().catch(() => null);
    if (this.ended) {
      turn?.release();
      return undefined;
    }
    this.turn = turn;
    this.frame('out', 'local.turn', { smart: turn !== null });
    return turn?.port;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/localInference/ src/providers/sessionSide.consistency.test.ts`
Expected: PASS. The existing `'inits ASR with its VAD config …'` test still passes: Smart is off in `makeConfig()`, so the options object is unchanged.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "providers/localInference"`
Expected: no output.

```bash
git add src/providers/localInference/engines.ts src/providers/localInference/engines.test.ts src/providers/localInference/fakeEngines.ts src/providers/localInference/adapter.ts src/providers/localInference/adapter.test.ts
git commit -F - <<'EOF'
feat(local-inference): connect Smart Turn under Auto turns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 11: The model's download state (`smartTurnStore`)

**Files:**
- Create: `src/stores/smartTurnStore.ts`
- Create: `src/stores/smartTurnStore.test.ts`
- Modify: `src/components/Settings/engine/StoragePage.tsx` (import; `doClearAll`, ~line 199-206)
- Modify: `src/components/Settings/engine/StoragePage.test.tsx` (after `'re-checks the segmentation pack after Clear all'`)

**Interfaces:**
- Consumes: `SMART_TURN_MODEL_ID` (Task 1), `ModelManager.isModelReady` / `downloadModel`
- Produces:
  - `type SmartTurnPhase = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error'`
  - `const SMART_TURN_TOTAL_BYTES: number` (32,411,198)
  - `useSmartTurnStore` with state `{ phase, downloadedBytes, error }` and actions `refresh(): Promise<void>` and `download(): Promise<void>`. `download()` never rejects; it ends in `'ready'` or `'error'`.
  - `useSmartTurnPhase(): SmartTurnPhase`

- [ ] **Step 1: Write the failing tests**

`src/stores/smartTurnStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

vi.mock('../lib/diagnostics/report', async () => {
  const actual = await vi.importActual<typeof import('../lib/diagnostics/report')>('../lib/diagnostics/report');
  return { ...actual, reportWarning: (...args: unknown[]) => mockReportWarning(...args) };
});

const mockReportWarning = vi.fn();

const { ModelManager } = await import('../lib/local-inference/ModelManager');
const { useSmartTurnStore, SMART_TURN_TOTAL_BYTES } = await import('./smartTurnStore');

let isModelReady: ReturnType<typeof vi.fn>;
let downloadModel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  isModelReady = vi.fn().mockResolvedValue(false);
  downloadModel = vi.fn().mockResolvedValue('default');
  (ModelManager.getInstance as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isModelReady, downloadModel });
  useSmartTurnStore.setState({ phase: 'unknown', downloadedBytes: 0, error: null });
});

describe('smartTurnStore', () => {
  it('sizes the model from the manifest', () => {
    expect(SMART_TURN_TOTAL_BYTES).toBe(32_411_198);
  });

  it('refresh: ready when the model is on disk', async () => {
    isModelReady.mockResolvedValue(true);
    await useSmartTurnStore.getState().refresh();
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'ready', downloadedBytes: SMART_TURN_TOTAL_BYTES });
  });

  it('refresh: missing when it is not, or when the disk cannot be read', async () => {
    await useSmartTurnStore.getState().refresh();
    expect(useSmartTurnStore.getState().phase).toBe('missing');
    isModelReady.mockRejectedValue(new Error('no IndexedDB'));
    await useSmartTurnStore.getState().refresh();
    expect(useSmartTurnStore.getState().phase).toBe('missing');
  });

  it('refresh leaves a running download alone', async () => {
    useSmartTurnStore.setState({ phase: 'downloading' });
    await useSmartTurnStore.getState().refresh();
    expect(isModelReady).not.toHaveBeenCalled();
    expect(useSmartTurnStore.getState().phase).toBe('downloading');
  });

  it('download: a model already on disk is ready without a fetch', async () => {
    isModelReady.mockResolvedValue(true);
    await useSmartTurnStore.getState().download();
    expect(downloadModel).not.toHaveBeenCalled();
    expect(useSmartTurnStore.getState().phase).toBe('ready');
  });

  it('download: fetches with progress and ends ready', async () => {
    const seen: number[] = [];
    downloadModel.mockImplementation(async (_id: string, onProgress?: (p: { downloadedBytes: number }) => void) => {
      onProgress?.({ downloadedBytes: 1000 });
      seen.push(useSmartTurnStore.getState().downloadedBytes);
      return 'default';
    });
    await useSmartTurnStore.getState().download();
    expect(downloadModel).toHaveBeenCalledWith('smart-turn-v3.2', expect.any(Function));
    expect(seen).toEqual([1000]);
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'ready', downloadedBytes: SMART_TURN_TOTAL_BYTES, error: null });
  });

  it('download: a failure ends in error with its message, reported once', async () => {
    downloadModel.mockRejectedValue(new Error('offline'));
    await useSmartTurnStore.getState().download();
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'error', error: 'offline' });
    expect(mockReportWarning).toHaveBeenCalledTimes(1);
    expect(mockReportWarning).toHaveBeenCalledWith(
      'SmartTurn',
      'Smart Turn model download failed: offline',
      expect.objectContaining({ dedupeKey: 'smart-turn:download' }),
    );
  });

  it('download: a second call while one runs does nothing', async () => {
    let finish!: () => void;
    downloadModel.mockImplementation(() => new Promise<string>((resolve) => { finish = () => resolve('default'); }));
    const first = useSmartTurnStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalledTimes(1));
    await useSmartTurnStore.getState().download();
    expect(downloadModel).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(useSmartTurnStore.getState().phase).toBe('ready');
  });

  it('a refresh that read the disk before a download started does not overwrite it', async () => {
    let answerRefresh!: (ready: boolean) => void;
    isModelReady
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { answerRefresh = resolve; }))
      .mockResolvedValue(false);
    downloadModel.mockImplementation(() => new Promise(() => {}));
    const refreshing = useSmartTurnStore.getState().refresh();
    void useSmartTurnStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalled());
    answerRefresh(false);
    await refreshing;
    expect(useSmartTurnStore.getState().phase).toBe('downloading');
  });
});
```

In `src/components/Settings/engine/StoragePage.test.tsx`, after `'re-checks the segmentation pack after Clear all'`:

```tsx
  it('re-checks the Smart Turn model after Clear all', async () => {
    const { useSmartTurnStore } = await import('../../../stores/smartTurnStore');
    const { useSegmentationStore } = await import('../../../stores/segmentationStore');
    const originalTurnRefresh = useSmartTurnStore.getState().refresh;
    const originalPackRefresh = useSegmentationStore.getState().refresh;
    const originalDeleteAllModels = useModelStore.getState().deleteAllModels;
    const refresh = vi.fn().mockResolvedValue(undefined);
    useSmartTurnStore.setState({ refresh });
    useSegmentationStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
    useModelStore.setState({
      modelStatuses: { [asrId()]: 'downloaded' }, webgpuAvailable: true, deleteAllModels: vi.fn().mockResolvedValue(undefined),
    });
    try {
      render(<StoragePage provider="wasm" {...WASM} />);
      fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    } finally {
      useSmartTurnStore.setState({ refresh: originalTurnRefresh });
      useSegmentationStore.setState({ refresh: originalPackRefresh });
      useModelStore.setState({ deleteAllModels: originalDeleteAllModels });
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/stores/smartTurnStore.test.ts src/components/Settings/engine/StoragePage.test.tsx`
Expected: FAIL. `./smartTurnStore` does not exist.

- [ ] **Step 3: Implement**

`src/stores/smartTurnStore.ts`:

```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { getManifestEntry } from '../lib/local-inference/modelManifest';
import { ModelManager } from '../lib/local-inference/ModelManager';
import { SMART_TURN_MODEL_ID } from '../lib/turn/smartTurn';
import { describeCause, reportWarning } from '../lib/diagnostics/report';

/** The Smart Turn model's one download: its phase, its bytes so far, why it stopped. */

export type SmartTurnPhase = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';

export const SMART_TURN_TOTAL_BYTES = (() => {
  const entry = getManifestEntry(SMART_TURN_MODEL_ID);
  if (!entry) throw new Error(`Smart Turn model missing from the manifest: ${SMART_TURN_MODEL_ID}`);
  return entry.variants.default.files.reduce((sum, f) => sum + f.sizeBytes, 0);
})();

/** Bumped by every download and every refresh past its early return: the later one wins. */
let generation = 0;

interface SmartTurnStore {
  phase: SmartTurnPhase;
  downloadedBytes: number;
  error: string | null;
  /** Ask the disk. Never interrupts a download. */
  refresh(): Promise<void>;
  /** Fetch the model unless it is on disk. Never rejects: ends 'ready' or 'error'. */
  download(): Promise<void>;
}

async function onDisk(): Promise<boolean> {
  try {
    return await ModelManager.getInstance().isModelReady(SMART_TURN_MODEL_ID);
  } catch {
    return false;
  }
}

export const useSmartTurnStore = create<SmartTurnStore>()(
  subscribeWithSelector((set, get) => ({
    phase: 'unknown',
    downloadedBytes: 0,
    error: null,

    refresh: async () => {
      if (get().phase === 'downloading') return;
      const gen = ++generation;
      const ready = await onDisk();
      if (gen !== generation || get().phase === 'downloading') return;
      set({ phase: ready ? 'ready' : 'missing', downloadedBytes: ready ? SMART_TURN_TOTAL_BYTES : 0, error: null });
    },

    download: async () => {
      if (get().phase === 'downloading') return;
      const gen = ++generation;
      set({ phase: 'downloading', downloadedBytes: 0, error: null });
      try {
        if (!(await onDisk())) {
          await ModelManager.getInstance().downloadModel(SMART_TURN_MODEL_ID, (p) => {
            if (gen === generation) set({ downloadedBytes: p.downloadedBytes });
          });
        }
        if (gen !== generation) return;
        set({ phase: 'ready', downloadedBytes: SMART_TURN_TOTAL_BYTES, error: null });
      } catch (err) {
        if (gen !== generation) return;
        const message = describeCause(err);
        set({ phase: 'error', error: message });
        reportWarning('SmartTurn', `Smart Turn model download failed: ${message}`, {
          cause: err,
          dedupeKey: 'smart-turn:download',
        });
      }
    },
  })),
);

export const useSmartTurnPhase = (): SmartTurnPhase => useSmartTurnStore((state) => state.phase);
```

In `src/components/Settings/engine/StoragePage.tsx`, add `import { useSmartTurnStore } from '../../../stores/smartTurnStore';` next to the `useSegmentationStore` import. Replace

```tsx
      await useModelStore.getState().deleteAllModels();
      // The clear wipes the whole IndexedDB, punctuation models included —
      // the segmentation pack's own store must be told, or the Sentence
      // segmentation section keeps claiming the models are ready.
      await useSegmentationStore.getState().refresh();
```

with

```tsx
      await useModelStore.getState().deleteAllModels();
      // The clear wipes the whole IndexedDB, punctuation and Smart Turn models
      // included — their own stores must be told, or their settings keep
      // claiming the models are ready.
      await useSegmentationStore.getState().refresh();
      await useSmartTurnStore.getState().refresh();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores/smartTurnStore.test.ts src/components/Settings/engine/StoragePage.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "smartTurnStore|StoragePage"`
Expected: no output.

```bash
git add src/stores/smartTurnStore.ts src/stores/smartTurnStore.test.ts src/components/Settings/engine/StoragePage.tsx src/components/Settings/engine/StoragePage.test.tsx
git commit -F - <<'EOF'
feat(settings): Smart Turn model download state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 12: Normal / Smart controls in `LocalSettingsControls`

**Files:**
- Modify: `src/components/Settings/sections/LocalSettingsControls.tsx` (imports; `VadValues`; `VadControl`; new `EndOfTurnControl`)
- Create: `src/components/Settings/sections/LocalSettingsControls.scss`
- Modify: `src/components/Settings/sections/LocalSettingsControls.vad.test.tsx`
- Create: `src/components/Settings/sections/LocalSettingsControls.endOfTurn.test.tsx`

**Interfaces:**
- Consumes: `SMART_TURN_CHECK_AFTER_RANGE`, `SMART_TURN_THRESHOLD_RANGE`, `effectiveCheckAfter`, `VadEndOfTurn` (Task 1); `formatBytes` (`src/lib/local-inference/formatBytes.ts`)
- Produces:
  - `VadValues.smartTurnCheckAfter?: number`, `VadValues.smartTurnThreshold?: number`. With both present, VadControl shows the two Smart sliders above Speech Threshold and labels Min Silence Duration **Max Wait**.
  - `VadControl` prop `endOfTurn?: React.ReactNode`, rendered under the heading, above every slider
  - `EndOfTurnControl` with props `{ value: VadEndOfTurn; onChange(next: VadEndOfTurn): void; disabled: boolean; download?: { done: number; total: number }; error?: string | null; onRetry?(): void }`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Settings/sections/LocalSettingsControls.vad.test.tsx`:

```tsx
describe('VadControl Smart Turn sliders', () => {
  const SMART = { ...BASE, smartTurnCheckAfter: 0.3, smartTurnThreshold: 0.5 };
  const sliderFor = (label: string) => screen.getByText(label).closest('.setting-item')!.querySelector('input[type="range"]') as HTMLInputElement;

  it('are hidden, and Min Silence keeps its name, when the provider passes no Smart Turn values', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} />);
    expect(screen.queryByText('Turn Check After')).toBeNull();
    expect(screen.queryByText('Turn Threshold')).toBeNull();
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();
  });

  it('show both sliders above Speech Threshold and call Min Silence "Max Wait"', () => {
    render(<VadControl values={SMART} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('0.30s')).toBeTruthy();
    expect(screen.getByText('0.50')).toBeTruthy();
    expect(screen.getByText('Max Wait')).toBeTruthy();
    expect(screen.queryByText('Min Silence Duration')).toBeNull();
    const order = screen.getByText('Turn Check After').compareDocumentPosition(screen.getByText('Speech Threshold'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('run 0.10–0.50 s and 0.30–0.90', () => {
    render(<VadControl values={SMART} onChange={() => {}} disabled={false} />);
    expect([sliderFor('Turn Check After').min, sliderFor('Turn Check After').max]).toEqual(['0.1', '0.5']);
    expect([sliderFor('Turn Threshold').min, sliderFor('Turn Threshold').max]).toEqual(['0.3', '0.9']);
  });

  it('hold Turn Check After 0.05 s under Max Wait, showing what the session will use', () => {
    render(<VadControl values={{ ...SMART, vadMinSilenceDuration: 0.3, smartTurnCheckAfter: 0.5 }} onChange={() => {}} disabled={false} />);
    expect(sliderFor('Turn Check After').max).toBe('0.25');
    expect(screen.getByText('0.25s')).toBeTruthy();
  });

  it('show a dash when Max Wait leaves no room for Smart Turn', () => {
    render(<VadControl values={{ ...SMART, vadMinSilenceDuration: 0.05 }} onChange={() => {}} disabled={false} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('report their changes', () => {
    const onChange = vi.fn();
    render(<VadControl values={SMART} onChange={onChange} disabled={false} />);
    fireEvent.change(sliderFor('Turn Check After'), { target: { value: '0.2' } });
    fireEvent.change(sliderFor('Turn Threshold'), { target: { value: '0.7' } });
    expect(onChange).toHaveBeenCalledWith({ smartTurnCheckAfter: 0.2 });
    expect(onChange).toHaveBeenCalledWith({ smartTurnThreshold: 0.7 });
  });

  it('render the end-of-turn choice under the heading, above every slider', () => {
    render(<VadControl values={BASE} onChange={() => {}} disabled={false} endOfTurn={<div data-testid="end-of-turn" />} />);
    const order = screen.getByTestId('end-of-turn').compareDocumentPosition(screen.getByText('Speech Threshold'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

`src/components/Settings/sections/LocalSettingsControls.endOfTurn.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EndOfTurnControl } from './LocalSettingsControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, unknown>) =>
      (fb ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => String(opts?.[n] ?? '')),
  }),
}));

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('EndOfTurnControl', () => {
  it('shows Normal and Smart, the value active', () => {
    render(<EndOfTurnControl value="smart" onChange={() => {}} disabled={false} />);
    expect(button('Smart').className).toContain('active');
    expect(button('Normal').className).not.toContain('active');
  });

  it('reports a choice', () => {
    const onChange = vi.fn();
    render(<EndOfTurnControl value="normal" onChange={onChange} disabled={false} />);
    fireEvent.click(button('Smart'));
    expect(onChange).toHaveBeenCalledWith('smart');
  });

  it("shows the download's progress and holds both buttons meanwhile", () => {
    const { container } = render(
      <EndOfTurnControl value="normal" onChange={() => {}} disabled={false} download={{ done: 16_205_599, total: 32_411_198 }} />,
    );
    expect(screen.getByText('Downloading the Smart Turn model: 15.5 MB of 30.9 MB')).toBeTruthy();
    expect((container.querySelector('.end-of-turn__progress-fill') as HTMLElement).style.width).toBe('50%');
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
  });

  it('shows a failed download with a retry', () => {
    const onRetry = vi.fn();
    render(<EndOfTurnControl value="normal" onChange={() => {}} disabled={false} error="offline" onRetry={onRetry} />);
    expect(screen.getByText('Smart Turn model download failed: offline')).toBeTruthy();
    fireEvent.click(button('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('disables everything while a session runs', () => {
    render(<EndOfTurnControl value="normal" onChange={() => {}} disabled error="offline" onRetry={() => {}} />);
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
    expect(button('Retry')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/Settings/sections/LocalSettingsControls.vad.test.tsx src/components/Settings/sections/LocalSettingsControls.endOfTurn.test.tsx`
Expected: FAIL. `EndOfTurnControl` is not exported and there are no Smart sliders.

- [ ] **Step 3: Implement**

`src/components/Settings/sections/LocalSettingsControls.scss`:

```scss
@use '../shared/variables' as vars;

// Smart Turn's download line under Normal / Smart: the same bar and caption as
// Sentence segmentation's (SentenceSegmentationSection.scss).
.end-of-turn__status {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.end-of-turn__status--line {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: vars.$space-2;
}

.end-of-turn__progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.end-of-turn__progress-fill {
  height: 100%;
  background: vars.$color-primary;
  border-radius: 2px;
  transition: width vars.$transition-normal;
}

.end-of-turn__text {
  font-size: vars.$font-caption;
  color: vars.$text-muted;
}

.end-of-turn__error {
  font-size: vars.$font-caption;
  color: vars.$color-error;
  word-break: break-word;
}

.end-of-turn__retry {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: vars.$font-caption;
  border: 1px solid vars.$border-default;
  border-radius: vars.$radius-sm;
  background: vars.$bg-control;
  color: vars.$text-secondary;
  cursor: pointer;
  transition: background vars.$transition-fast, color vars.$transition-fast;

  &:hover:not(:disabled) {
    background: vars.$bg-hover;
    color: vars.$text-primary;
  }

  &:disabled {
    opacity: vars.$disabled-opacity;
    cursor: not-allowed;
  }
}
```

In `src/components/Settings/sections/LocalSettingsControls.tsx`:

1. Imports. Replace `import { ChevronDown, ChevronRight, CircleHelp } from 'lucide-react';` with

```tsx
import { ChevronDown, ChevronRight, CircleHelp, RotateCw } from 'lucide-react';
```

and add after `import Tooltip from '../../Tooltip/Tooltip';`:

```tsx
import { formatBytes } from '../../../lib/local-inference/formatBytes';
import {
  SMART_TURN_CHECK_AFTER_RANGE,
  SMART_TURN_THRESHOLD_RANGE,
  effectiveCheckAfter,
  type VadEndOfTurn,
} from '../../../lib/turn/smartTurn';
import './LocalSettingsControls.scss';
```

2. Directly before the line `// ─── VAD sliders ───…`, add:

```tsx
// ─── End of turn (LocalInference's Normal / Smart) ──────────────────────────

/** The option buttons are RealtimeTurnDetection.tsx's Normal / Semantic, copied. */
export const EndOfTurnControl: React.FC<{
  value: VadEndOfTurn;
  onChange: (next: VadEndOfTurn) => void;
  disabled: boolean;
  /** While the Smart Turn model downloads. */
  download?: { done: number; total: number };
  /** Why the last download failed. */
  error?: string | null;
  onRetry?: () => void;
}> = ({ value, onChange, disabled, download, error, onRetry }) => {
  const { t } = useTranslation();
  const options: Array<[VadEndOfTurn, string]> = [
    ['normal', t('settings.normal', 'Normal')],
    ['smart', t('settings.smartTurn', 'Smart')],
  ];
  return (
    <>
      <div className="setting-item">
        <div className="turn-detection-options">
          {options.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`option-button ${value === mode ? 'active' : ''}`}
              onClick={() => onChange(mode)}
              disabled={disabled || download !== undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {download && (
        <div className="setting-item end-of-turn__status">
          <div className="end-of-turn__progress-bar">
            <div className="end-of-turn__progress-fill" style={{ width: `${(download.done / download.total) * 100}%` }} />
          </div>
          <span className="end-of-turn__text">
            {t('settings.smartTurnDownloading', 'Downloading the Smart Turn model: {{done}} of {{total}}', {
              done: formatBytes(download.done),
              total: formatBytes(download.total),
            })}
          </span>
        </div>
      )}
      {error && (
        <div className="setting-item end-of-turn__status end-of-turn__status--line">
          <span className="end-of-turn__error">
            {t('settings.smartTurnDownloadFailed', 'Smart Turn model download failed: {{error}}', { error })}
          </span>
          <button type="button" className="end-of-turn__retry" onClick={onRetry} disabled={disabled}>
            <RotateCw size={12} />
            <span>{t('common.retry', 'Retry')}</span>
          </button>
        </div>
      )}
    </>
  );
};

```

3. In `VadValues`, after `vadPreSpeechPadDuration?: number;`:

```tsx
  /** Smart Turn only — omit both and their sliders are hidden and Min Silence keeps its name. */
  smartTurnCheckAfter?: number;
  smartTurnThreshold?: number;
```

4. Replace

```tsx
export const VadControl: React.FC<{
  values: VadValues;
  onChange: (patch: Partial<VadValues>) => void;
  disabled: boolean;
}> = ({ values, onChange, disabled }) => {
  const { t } = useTranslation();
  return (
```

with

```tsx
export const VadControl: React.FC<{
  values: VadValues;
  onChange: (patch: Partial<VadValues>) => void;
  disabled: boolean;
  /** Rendered under the heading, above every slider. */
  endOfTurn?: React.ReactNode;
}> = ({ values, onChange, disabled, endOfTurn }) => {
  const { t } = useTranslation();
  const smart = values.smartTurnCheckAfter !== undefined && values.smartTurnThreshold !== undefined
    ? { checkAfter: values.smartTurnCheckAfter, threshold: values.smartTurnThreshold }
    : null;
  const checkAfterMax = Math.max(
    SMART_TURN_CHECK_AFTER_RANGE.min,
    effectiveCheckAfter(SMART_TURN_CHECK_AFTER_RANGE.max, values.vadMinSilenceDuration) ?? 0,
  );
  const checkAfterUsed = smart ? effectiveCheckAfter(smart.checkAfter, values.vadMinSilenceDuration) : null;
  return (
```

5. In VadControl, replace

```tsx
      </h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadThreshold', 'Speech Threshold')}
```

with

```tsx
      </h2>
      {endOfTurn}
      {smart && (
        <>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.smartTurnCheckAfter', 'Turn Check After')}
                <Tooltip content={t('settings.smartTurnCheckAfterTooltip', 'How long a pause lasts before Smart Turn checks whether you have finished speaking. If you have, the segment ends at once instead of waiting for Max Wait.')} position="top">{inlineHelpIcon}</Tooltip>
              </span>
              <span className="setting-value">{checkAfterUsed === null ? '—' : `${checkAfterUsed.toFixed(2)}s`}</span>
            </div>
            <input
              type="range" min={SMART_TURN_CHECK_AFTER_RANGE.min} max={checkAfterMax} step={SMART_TURN_CHECK_AFTER_RANGE.step}
              value={Math.min(smart.checkAfter, checkAfterMax)}
              onChange={(e) => onChange({ smartTurnCheckAfter: parseFloat(e.target.value) })}
              className="slider" disabled={disabled}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.smartTurnThreshold', 'Turn Threshold')}
                <Tooltip content={t('settings.smartTurnThresholdTooltip', 'How sure Smart Turn must be that you have finished before it ends the segment. Lower values end more segments early, but also cut more pauses in the middle of a sentence.')} position="top">{inlineHelpIcon}</Tooltip>
              </span>
              <span className="setting-value">{smart.threshold.toFixed(2)}</span>
            </div>
            <input
              type="range" min={SMART_TURN_THRESHOLD_RANGE.min} max={SMART_TURN_THRESHOLD_RANGE.max} step={SMART_TURN_THRESHOLD_RANGE.step}
              value={smart.threshold}
              onChange={(e) => onChange({ smartTurnThreshold: parseFloat(e.target.value) })}
              className="slider" disabled={disabled}
            />
          </div>
        </>
      )}
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadThreshold', 'Speech Threshold')}
```

6. Replace

```tsx
            {t('settings.vadMinSilenceDuration', 'Min Silence Duration')}
            <Tooltip content={t('settings.vadMinSilenceDurationTooltip', 'Minimum silence duration to split speech segments. Shorter values split sentences faster, longer values wait for more natural pauses.')} position="top">{inlineHelpIcon}</Tooltip>
```

with

```tsx
            {smart ? t('settings.smartTurnMaxWait', 'Max Wait') : t('settings.vadMinSilenceDuration', 'Min Silence Duration')}
            <Tooltip
              content={smart
                ? t('settings.smartTurnMaxWaitTooltip', 'The longest silence before a segment ends when Smart Turn has not ended it first.')
                : t('settings.vadMinSilenceDurationTooltip', 'Minimum silence duration to split speech segments. Shorter values split sentences faster, longer values wait for more natural pauses.')}
              position="top"
            >
              {inlineHelpIcon}
            </Tooltip>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/`
Expected: PASS. That includes the existing VadControl tests and the Local Native callers.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "LocalSettingsControls"`
Expected: no output.

```bash
git add src/components/Settings/sections/LocalSettingsControls.tsx src/components/Settings/sections/LocalSettingsControls.scss src/components/Settings/sections/LocalSettingsControls.vad.test.tsx src/components/Settings/sections/LocalSettingsControls.endOfTurn.test.tsx
git commit -F - <<'EOF'
feat(settings): Normal / Smart controls in VAD settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 13: Choosing Smart Turn in Local Inference's VAD settings

**Files:**
- Modify: `src/providers/localInference/LocalInferenceTurnDetection.tsx` (full content below)
- Modify: `src/providers/localInference/LocalInferenceTurnDetection.test.tsx`

**Interfaces:**
- Consumes: `supportsSmartTurn`, `VadEndOfTurn` (Task 1); `useSmartTurnStore`, `useSmartTurnPhase`, `SMART_TURN_TOTAL_BYTES` (Task 11); `VadControl`, `EndOfTurnControl` (Task 12); settings fields (Task 9)
- Produces: the UI rules:
  - The choice is offered when the speaker direction's ASR is in scope, on every device.
  - The section shows Smart only when the setting is `'smart'` and the model's phase is `'ready'` or still `'unknown'`.
  - Choosing Smart runs `download()`, and the setting is written `'smart'` only once the phase is `'ready'`.
  - The Smart summary reads `VAD Settings · Smart · Max Wait 1.40s`.

- [ ] **Step 1: Write the failing tests**

In `src/providers/localInference/LocalInferenceTurnDetection.test.tsx`:

1. Replace the `react-i18next` mock with an interpolating one:

```tsx
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, unknown>) =>
      (fb ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => String(opts?.[n] ?? '')),
  }),
}));
```

2. Add, after the `modelManifest` mock:

```tsx
let mockPhase = 'ready';
let mockBytes = 0;
let mockError: string | null = null;
const mockRefresh = vi.fn();
const mockDownload = vi.fn();
vi.mock('../../stores/smartTurnStore', () => {
  const state = () => ({ phase: mockPhase, downloadedBytes: mockBytes, error: mockError, refresh: mockRefresh, download: mockDownload });
  return {
    useSmartTurnStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
    useSmartTurnPhase: () => mockPhase,
    SMART_TURN_TOTAL_BYTES: 32_411_198,
  };
});
```

3. Extend the existing `beforeEach`:

```tsx
  mockPhase = 'ready';
  mockBytes = 0;
  mockError = null;
  mockRefresh.mockReset();
  mockDownload.mockReset().mockImplementation(async () => { mockPhase = 'ready'; });
```

4. Add inside `describe('LocalInferenceTurnDetectionSummary', …)`:

```tsx
  it('in Smart reads VAD Settings · Smart · Max Wait', () => {
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart' }} update={() => {}} pair={pair} />,
    );
    expect(container.textContent).toBe('VAD Settings · Smart · Max Wait 1.40s');
  });

  it('summarizes a stored Smart whose model is gone as Normal', () => {
    mockPhase = 'missing';
    const { container } = render(
      <LocalInferenceTurnDetectionSummary settings={{ ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart' }} update={() => {}} pair={pair} />,
    );
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 1.40s');
  });
```

5. Add a new describe at the end of the file:

```tsx
describe('LocalInferenceTurnDetectionControls — Smart Turn', () => {
  const smart = { ...LOCAL_INFERENCE_DEFAULTS, vadEndOfTurn: 'smart' as const };
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('offers Normal and Smart for an ASR in its scope, Normal active by default', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(button('Normal').className).toContain('active');
    expect(button('Smart').className).not.toContain('active');
    expect(screen.queryByText('Turn Check After')).toBeNull();
  });

  it.each([
    [{ type: 'asr', asrWorkerType: 'sherpa-onnx' }],
    [{ type: 'asr-stream', asrWorkerType: 'voxtral-webgpu' }],
  ])('offers neither for %o', (entry) => {
    mockAsrEntry = entry;
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.queryByRole('button', { name: 'Smart' })).toBeNull();
  });

  it('offers both on a device that reports little memory', () => {
    localStorage.setItem('debug:device-memory', '2');
    try {
      render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
      expect(button('Smart')).toBeTruthy();
    } finally {
      localStorage.removeItem('debug:device-memory');
    }
  });

  it('downloads first and switches to Smart only once the model is ready', async () => {
    mockPhase = 'missing';
    let finish!: () => void;
    mockDownload.mockImplementation(() => new Promise<void>((resolve) => { finish = () => { mockPhase = 'ready'; resolve(); }; }));
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    fireEvent.click(button('Smart'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ vadEndOfTurn: 'smart' }));
  });

  it('stays on Normal when the download fails', async () => {
    mockPhase = 'missing';
    mockDownload.mockImplementation(async () => { mockPhase = 'error'; mockError = 'offline'; });
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={update} pair={pair} />);
    fireEvent.click(button('Smart'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it("shows the download's progress", () => {
    mockPhase = 'downloading';
    mockBytes = 16_205_599;
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Downloading the Smart Turn model: 15.5 MB of 30.9 MB')).toBeTruthy();
    expect(button('Smart')).toBeDisabled();
  });

  it('shows a failed download with a retry that downloads again', () => {
    mockPhase = 'error';
    mockError = 'offline';
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(screen.getByText('Smart Turn model download failed: offline')).toBeTruthy();
    fireEvent.click(button('Retry'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('in Smart shows the two sliders and Max Wait, and their changes go through update', () => {
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={smart} update={update} pair={pair} />);
    expect(button('Smart').className).toContain('active');
    expect(screen.getByText('Max Wait')).toBeTruthy();
    expect(screen.queryByText('Min Silence Duration')).toBeNull();
    fireEvent.change(sliderFor('Turn Threshold'), { target: { value: '0.7' } });
    expect(update).toHaveBeenCalledWith({ smartTurnThreshold: 0.7 });
  });

  it('writes Normal when Normal is chosen from Smart', () => {
    const update = vi.fn();
    render(<LocalInferenceTurnDetectionControls settings={smart} update={update} pair={pair} />);
    fireEvent.click(button('Normal'));
    expect(update).toHaveBeenCalledWith({ vadEndOfTurn: 'normal' });
  });

  it('reads a stored Smart whose model is gone as Normal', () => {
    mockPhase = 'missing';
    render(<LocalInferenceTurnDetectionControls settings={smart} update={() => {}} pair={pair} />);
    expect(button('Normal').className).toContain('active');
    expect(screen.queryByText('Turn Check After')).toBeNull();
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();
  });

  it('asks the disk while the phase is unknown', () => {
    mockPhase = 'unknown';
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} pair={pair} />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('holds both buttons while a session runs', () => {
    render(<LocalInferenceTurnDetectionControls settings={LOCAL_INFERENCE_DEFAULTS} update={() => {}} disabled pair={pair} />);
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/localInference/LocalInferenceTurnDetection.test.tsx`
Expected: FAIL. There is no Normal / Smart choice, and the Smart summary is missing.

- [ ] **Step 3: Implement**

Replace the whole of `src/providers/localInference/LocalInferenceTurnDetection.tsx` with:

```tsx
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { useModelStore, useModelStatuses } from '../../stores/modelStore';
import { SMART_TURN_TOTAL_BYTES, useSmartTurnPhase, useSmartTurnStore } from '../../stores/smartTurnStore';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { supportsSmartTurn, type VadEndOfTurn } from '../../lib/turn/smartTurn';
import { EndOfTurnControl, VadControl } from '../../components/Settings/sections/LocalSettingsControls';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { LanguagePair, SettingsProps } from '../../lib/provider/types';
import type { LocalInferenceSettings as S } from './settings';

// Matches `LocalSettingsControls.tsx`'s own inline help icon — the same
// tooltip trigger VadControl's heading carries, repeated on the Speech
// section's row by `LocalInferenceTurnDetectionHelp` below.
const helpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

/**
 * Which VAD knobs the speaker direction's resolved ASR takes — the one rule
 * both halves of LocalInference's `TurnDetection` follow (today's, from
 * `ProviderSpecificSettings.tsx`). `showVad` is false only for a streaming
 * ASR that reports no worker type: endpoint detection replaces VAD there.
 * `vadIsWebWorker` adds the three vad-web knobs; the sherpa-onnx engine has
 * its own hysteresis and cuts at a fixed length. `smart` is what a session
 * will run: a stored Smart whose model is not on disk reads as Normal.
 */
function useVadKnobs(settings: S, pair: LanguagePair | undefined) {
  // `localInferenceLanguages.initial()` gives the same fallback; the Speech
  // section always supplies `pair` in the app, so this only matters standalone.
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';
  // Forces a recompute when a model finishes downloading elsewhere (as
  // `LocalInferenceSettingsView` does for its prompt rule).
  const modelStatuses = useModelStatuses();
  const asrModelId = useMemo(
    () => useModelStore.getState().resolve(source, target, settings.selections).asr?.modelId,
    [source, target, settings.selections, modelStatuses],
  );
  const entry = getManifestEntry(asrModelId ?? '');
  const phase = useSmartTurnPhase();
  const smartTurnOffered = supportsSmartTurn(entry);
  useEffect(() => {
    if (smartTurnOffered && phase === 'unknown') void useSmartTurnStore.getState().refresh();
  }, [smartTurnOffered, phase]);
  return {
    showVad: !(entry?.type === 'asr-stream' && !entry?.asrWorkerType),
    vadIsWebWorker: !!entry?.asrWorkerType && entry.asrWorkerType !== 'sherpa-onnx',
    smartTurnOffered,
    smart: smartTurnOffered && settings.vadEndOfTurn === 'smart' && (phase === 'ready' || phase === 'unknown'),
  };
}

/**
 * One line: `VadControl`'s own heading and min-silence label, with the value
 * formatted the way `VadControl` shows it. Text only:
 * `LocalInferenceTurnDetectionHelp` carries the heading's tooltip, so the
 * Speech section can place it as a sibling of its link button instead of
 * nesting it inside — a click on the trigger must not also navigate.
 */
export function LocalInferenceTurnDetectionSummary({ settings, pair }: SettingsProps<S>) {
  const { t } = useTranslation();
  const { showVad, smart } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  const heading = t('settings.vadSettings', 'VAD Settings');
  const seconds = `${settings.vadMinSilenceDuration.toFixed(2)}s`;
  if (smart) return <>{`${heading} · ${t('settings.smartTurn', 'Smart')} · ${t('settings.smartTurnMaxWait', 'Max Wait')} ${seconds}`}</>;
  return <>{`${heading} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${seconds}`}</>;
}

/**
 * `VadControl`'s heading tooltip, for the Speech section's row — same
 * content, same `Tooltip`. Follows `Summary`'s own nothing-to-tune rule so
 * the row never shows a help icon over an empty summary.
 */
export function LocalInferenceTurnDetectionHelp({ settings, pair }: SettingsProps<S>) {
  const { t } = useTranslation();
  const { showVad } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  return (
    <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">
      {helpIcon}
    </Tooltip>
  );
}

/**
 * The VAD knobs, heading included: the Provider tab draws them as their own
 * block, where the Speech section's summary links. Normal / Smart sits on top
 * for an ASR that runs Smart Turn's gate.
 */
export function LocalInferenceTurnDetectionControls({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const { showVad, vadIsWebWorker, smartTurnOffered, smart } = useVadKnobs(settings, pair);
  const phase = useSmartTurnPhase();
  const downloadedBytes = useSmartTurnStore((s) => s.downloadedBytes);
  const error = useSmartTurnStore((s) => s.error);
  if (!showVad) return null;

  // The setting turns Smart only once the model is on disk.
  const enableSmart = async () => {
    await useSmartTurnStore.getState().download();
    if (useSmartTurnStore.getState().phase === 'ready') update({ vadEndOfTurn: 'smart' });
  };
  const choose = (next: VadEndOfTurn) => {
    if (next === 'smart') {
      if (!smart) void enableSmart();
    } else if (settings.vadEndOfTurn !== 'normal') {
      update({ vadEndOfTurn: 'normal' });
    }
  };

  return (
    <VadControl
      values={{
        vadThreshold: settings.vadThreshold,
        vadMinSilenceDuration: settings.vadMinSilenceDuration,
        vadMinSpeechDuration: settings.vadMinSpeechDuration,
        // vad-web workers only — the sherpa-onnx engine has its own
        // hysteresis and cuts at a fixed length.
        ...(vadIsWebWorker
          ? {
              vadMaxSpeechDuration: settings.vadMaxSpeechDuration,
              vadNegativeThreshold: settings.vadNegativeThreshold,
              vadPreSpeechPadDuration: settings.vadPreSpeechPadDuration,
            }
          : {}),
        ...(smart
          ? { smartTurnCheckAfter: settings.smartTurnCheckAfter, smartTurnThreshold: settings.smartTurnThreshold }
          : {}),
      }}
      onChange={(patch) => update(patch)}
      disabled={disabled}
      endOfTurn={smartTurnOffered ? (
        <EndOfTurnControl
          value={smart ? 'smart' : 'normal'}
          onChange={choose}
          disabled={disabled}
          download={phase === 'downloading' ? { done: downloadedBytes, total: SMART_TURN_TOTAL_BYTES } : undefined}
          error={phase === 'error' ? error : null}
          onRetry={() => { void enableSmart(); }}
        />
      ) : undefined}
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/localInference/ src/components/Settings/`
Expected: PASS. The existing `'disables every slider'` test still counts 6 sliders, because the defaults are Normal.

- [ ] **Step 5: Look at it**

Run `npm run dev`, open the app's Settings in Advanced mode, choose Local Inference with Whisper (WebGPU) for ja → en, and open the Provider tab's VAD Settings block. Check that Normal / Smart sit directly under the "VAD Settings" heading and look like OpenAI Realtime's Normal / Semantic. Choose Smart: the progress line appears, and the two sliders and "Max Wait" appear when it finishes. If the dev server runs from a worktree, restart it before looking: it serves stale transforms otherwise.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "LocalInferenceTurnDetection"`
Expected: no output.

```bash
git add src/providers/localInference/LocalInferenceTurnDetection.tsx src/providers/localInference/LocalInferenceTurnDetection.test.tsx
git commit -F - <<'EOF'
feat(local-inference): choose Smart Turn in VAD settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 14: Strings in all 30 catalogs

**Files:**
- Modify: `src/locales/*/translation.json` (all 30: ar bn de en es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW)

**Interfaces:**
- Consumes: the keys and en fallbacks used in Tasks 12–13
- Produces: `settings.smartTurn`, `settings.smartTurnCheckAfter`, `settings.smartTurnCheckAfterTooltip`, `settings.smartTurnThreshold`, `settings.smartTurnThresholdTooltip`, `settings.smartTurnMaxWait`, `settings.smartTurnMaxWaitTooltip`, `settings.smartTurnDownloading`, `settings.smartTurnDownloadFailed` in every catalog, directly after `settings.vadPreSpeechPadDurationTooltip`. `settings.normal` and `common.retry` are reused as they are.

- [ ] **Step 1: Check the gate is green before the edit**

Run: `npx vitest run src/locales/locales.consistency.test.ts`
Expected: PASS. The locale test cannot see a key missing from every catalog, so the new keys are added in one pass below and checked against en afterwards.

- [ ] **Step 2: Write and run the insertion script (outside the repo, not committed)**

Create `/tmp/smart-turn-strings.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';

const T = {
  en: ["Smart", "Turn Check After", "How long a pause lasts before Smart Turn checks whether you have finished speaking. If you have, the segment ends at once instead of waiting for Max Wait.", "Turn Threshold", "How sure Smart Turn must be that you have finished before it ends the segment. Lower values end more segments early, but also cut more pauses in the middle of a sentence.", "Max Wait", "The longest silence before a segment ends when Smart Turn has not ended it first.", "Downloading the Smart Turn model: {{done}} of {{total}}", "Smart Turn model download failed: {{error}}"],
  ar: ["ذكي", "التحقق بعد", "مدة التوقف قبل أن يتحقق Smart Turn مما إذا كنت قد أنهيت كلامك. إذا كنت قد أنهيته، ينتهي المقطع فورًا بدلًا من انتظار أقصى انتظار.", "عتبة انتهاء الدور", "مدى تأكد Smart Turn من أنك أنهيت كلامك قبل أن ينهي المقطع. القيم الأقل تنهي مقاطع أكثر مبكرًا، لكنها تقطع أيضًا عند توقفات أكثر في منتصف الجملة.", "أقصى انتظار", "أطول صمت قبل أن ينتهي المقطع عندما لا ينهيه Smart Turn أولًا.", "جارٍ تنزيل نموذج Smart Turn: {{done}} من {{total}}", "فشل تنزيل نموذج Smart Turn: {{error}}"],
  bn: ["স্মার্ট", "যাচাইয়ের আগে বিরতি", "আপনি কথা শেষ করেছেন কি না Smart Turn যাচাই করার আগে বিরতি কতক্ষণ হবে। শেষ করে থাকলে, সর্বোচ্চ অপেক্ষার জন্য না থেমে অংশটি তখনই শেষ হয়।", "পালা শেষের থ্রেশহোল্ড", "অংশ শেষ করার আগে আপনি কথা শেষ করেছেন বলে Smart Turn-কে কতটা নিশ্চিত হতে হবে। কম মানে আরও বেশি অংশ আগে শেষ হয়, তবে বাক্যের মাঝের বিরতিতেও বেশি কাটা পড়ে।", "সর্বোচ্চ অপেক্ষা", "Smart Turn আগে শেষ না করলে, অংশ শেষ হওয়ার আগে দীর্ঘতম নীরবতা।", "Smart Turn মডেল ডাউনলোড হচ্ছে: {{total}}-এর মধ্যে {{done}}", "Smart Turn মডেল ডাউনলোড ব্যর্থ: {{error}}"],
  de: ["Smart", "Prüfung nach", "Wie lange eine Pause dauert, bevor Smart Turn prüft, ob Sie fertig gesprochen haben. Wenn ja, endet das Segment sofort, statt die max. Wartezeit abzuwarten.", "Sprecherwechsel-Schwelle", "Wie sicher Smart Turn sein muss, dass Sie fertig sind, bevor es das Segment beendet. Niedrigere Werte beenden mehr Segmente früher, schneiden aber auch öfter an Pausen mitten im Satz.", "Max. Wartezeit", "Die längste Stille, bevor ein Segment endet, wenn Smart Turn es nicht vorher beendet hat.", "Smart-Turn-Modell wird heruntergeladen: {{done}} von {{total}}", "Download des Smart-Turn-Modells fehlgeschlagen: {{error}}"],
  es: ["Inteligente", "Comprobar tras", "Cuánto dura una pausa antes de que Smart Turn compruebe si has terminado de hablar. Si es así, el segmento termina enseguida en lugar de esperar a la espera máxima.", "Umbral de turno", "Qué tan seguro debe estar Smart Turn de que has terminado antes de cerrar el segmento. Los valores más bajos cierran antes más segmentos, pero también cortan más pausas a mitad de frase.", "Espera máxima", "El silencio más largo antes de que termine un segmento cuando Smart Turn no lo ha cerrado antes.", "Descargando el modelo Smart Turn: {{done}} de {{total}}", "Error al descargar el modelo Smart Turn: {{error}}"],
  fa: ["هوشمند", "بررسی پس از", "مدت مکثی که باید بگذرد تا Smart Turn بررسی کند آیا صحبتتان تمام شده است. اگر تمام شده باشد، بخش بی‌درنگ پایان می‌یابد و منتظر حداکثر انتظار نمی‌ماند.", "آستانه پایان نوبت", "Smart Turn پیش از پایان دادن به بخش باید چقدر مطمئن باشد که صحبتتان تمام شده است. مقادیر کمتر بخش‌های بیشتری را زودتر پایان می‌دهند، اما در مکث‌های میانه جمله هم بیشتر برش می‌زنند.", "حداکثر انتظار", "طولانی‌ترین سکوت پیش از پایان یک بخش، وقتی Smart Turn زودتر آن را پایان نداده است.", "در حال دانلود مدل Smart Turn: {{done}} از {{total}}", "دانلود مدل Smart Turn ناموفق بود: {{error}}"],
  fi: ["Älykäs", "Tarkistusviive", "Kuinka pitkä tauon on oltava, ennen kuin Smart Turn tarkistaa, oletko lopettanut puhumisen. Jos olet, segmentti päättyy heti eikä odota enimmäisodotusta.", "Vuoron päättymisen kynnys", "Kuinka varma Smart Turnin on oltava siitä, että olet lopettanut, ennen kuin se päättää segmentin. Pienemmät arvot päättävät useampia segmenttejä aiemmin, mutta katkaisevat myös useammin lauseen keskellä olevista tauoista.", "Enimmäisodotus", "Pisin hiljaisuus ennen segmentin päättymistä, kun Smart Turn ei ole päättänyt sitä aiemmin.", "Ladataan Smart Turn -mallia: {{done}} / {{total}}", "Smart Turn -mallin lataus epäonnistui: {{error}}"],
  fil: ["Matalino", "Suriin Pagkatapos", "Gaano katagal ang isang paghinto bago suriin ng Smart Turn kung tapos ka nang magsalita. Kung tapos na, agad na magtatapos ang segment sa halip na hintayin ang Pinakamahabang Paghihintay.", "Prag ng Pagtatapos ng Turno", "Gaano dapat katiyak ang Smart Turn na tapos ka na bago nito tapusin ang segment. Ang mas mababang value ay nagtatapos ng mas maraming segment nang maaga, pero mas madalas ding pumuputol sa mga paghinto sa gitna ng pangungusap.", "Pinakamahabang Paghihintay", "Ang pinakamahabang katahimikan bago magtapos ang isang segment kapag hindi ito tinapos muna ng Smart Turn.", "Dina-download ang Smart Turn model: {{done}} sa {{total}}", "Nabigo ang pag-download ng Smart Turn model: {{error}}"],
  fr: ["Intelligent", "Vérifier après", "Durée d'une pause avant que Smart Turn vérifie si vous avez fini de parler. Si c'est le cas, le segment se termine aussitôt au lieu d'attendre l'attente max.", "Seuil de fin de tour", "À quel point Smart Turn doit être sûr que vous avez fini avant de terminer le segment. Des valeurs plus basses terminent plus de segments en avance, mais coupent aussi davantage de pauses en milieu de phrase.", "Attente max.", "Le silence le plus long avant la fin d'un segment lorsque Smart Turn ne l'a pas terminé avant.", "Téléchargement du modèle Smart Turn : {{done}} sur {{total}}", "Échec du téléchargement du modèle Smart Turn : {{error}}"],
  he: ["חכם", "בדיקה אחרי", "כמה זמן נמשכת הפסקה לפני ש-Smart Turn בודק אם סיימת לדבר. אם סיימת, המקטע מסתיים מיד במקום לחכות להמתנה המרבית.", "סף סיום תור", "עד כמה Smart Turn צריך להיות בטוח שסיימת לפני שהוא מסיים את המקטע. ערכים נמוכים יותר מסיימים יותר מקטעים מוקדם, אבל גם חותכים יותר הפסקות באמצע משפט.", "המתנה מרבית", "השקט הארוך ביותר לפני שמקטע מסתיים כאשר Smart Turn לא סיים אותו קודם.", "מוריד את מודל Smart Turn: {{done}} מתוך {{total}}", "הורדת מודל Smart Turn נכשלה: {{error}}"],
  hi: ["स्मार्ट", "जाँच से पहले विराम", "Smart Turn यह जाँचे कि आपने बोलना समाप्त किया है या नहीं, उससे पहले विराम कितना लंबा हो। अगर आपने समाप्त कर लिया है, तो खंड अधिकतम प्रतीक्षा का इंतज़ार किए बिना तुरंत समाप्त हो जाता है।", "टर्न समाप्ति थ्रेशोल्ड", "खंड समाप्त करने से पहले Smart Turn को कितना निश्चित होना चाहिए कि आपने बोलना समाप्त कर लिया है। कम मान अधिक खंडों को जल्दी समाप्त करते हैं, लेकिन वाक्य के बीच के विरामों पर भी अधिक बार काटते हैं।", "अधिकतम प्रतीक्षा", "जब Smart Turn ने खंड को पहले समाप्त नहीं किया हो, तब खंड समाप्त होने से पहले सबसे लंबा मौन।", "Smart Turn मॉडल डाउनलोड हो रहा है: {{total}} में से {{done}}", "Smart Turn मॉडल डाउनलोड विफल: {{error}}"],
  id: ["Pintar", "Periksa Setelah", "Berapa lama jeda berlangsung sebelum Smart Turn memeriksa apakah Anda sudah selesai berbicara. Jika sudah, segmen langsung berakhir tanpa menunggu Tunggu Maksimum.", "Ambang Akhir Giliran", "Seberapa yakin Smart Turn harus bahwa Anda sudah selesai sebelum mengakhiri segmen. Nilai yang lebih rendah mengakhiri lebih banyak segmen lebih awal, tetapi juga lebih sering memotong jeda di tengah kalimat.", "Tunggu Maksimum", "Keheningan terpanjang sebelum segmen berakhir jika Smart Turn belum mengakhirinya lebih dulu.", "Mengunduh model Smart Turn: {{done}} dari {{total}}", "Pengunduhan model Smart Turn gagal: {{error}}"],
  it: ["Intelligente", "Verifica dopo", "Quanto dura una pausa prima che Smart Turn verifichi se hai finito di parlare. Se hai finito, il segmento termina subito invece di attendere l'attesa massima.", "Soglia di fine turno", "Quanto Smart Turn deve essere sicuro che tu abbia finito prima di chiudere il segmento. Valori più bassi chiudono prima più segmenti, ma tagliano anche più pause a metà frase.", "Attesa massima", "Il silenzio più lungo prima che un segmento termini quando Smart Turn non lo ha chiuso prima.", "Download del modello Smart Turn: {{done}} su {{total}}", "Download del modello Smart Turn non riuscito: {{error}}"],
  ja: ["スマート", "判定開始までの無音", "Smart Turn が話し終えたかどうかを確認するまでの無音の長さ。話し終えていれば、最大待機時間を待たずにすぐ区切ります。", "話し終わりのしきい値", "区切る前に、Smart Turn が話し終えたとどれだけ確信している必要があるか。低くすると早めに区切れる文が増えますが、文の途中の間で区切ることも増えます。", "最大待機時間", "Smart Turn が先に区切らなかったときに、区切るまで待つ最長の無音時間。", "Smart Turn モデルをダウンロード中 {{done}} / {{total}}", "Smart Turn モデルのダウンロードに失敗しました: {{error}}"],
  ko: ["스마트", "판단 전 대기", "Smart Turn이 말을 마쳤는지 확인하기까지의 멈춤 길이입니다. 말을 마쳤다면 최대 대기 시간을 기다리지 않고 바로 구간을 끝냅니다.", "턴 종료 임계값", "구간을 끝내기 전에 Smart Turn이 말을 마쳤다고 얼마나 확신해야 하는지 정합니다. 낮을수록 더 많은 구간이 일찍 끝나지만, 문장 중간의 멈춤에서 끊기는 경우도 늘어납니다.", "최대 대기 시간", "Smart Turn이 먼저 구간을 끝내지 않았을 때 구간이 끝나기까지 기다리는 가장 긴 무음 시간입니다.", "Smart Turn 모델 다운로드 중 {{done}} / {{total}}", "Smart Turn 모델 다운로드 실패: {{error}}"],
  ms: ["Pintar", "Semak Selepas", "Berapa lama jeda berlangsung sebelum Smart Turn menyemak sama ada anda sudah selesai bercakap. Jika sudah, segmen tamat serta-merta tanpa menunggu Tunggu Maksimum.", "Ambang Tamat Giliran", "Sejauh mana Smart Turn mesti yakin bahawa anda sudah selesai sebelum menamatkan segmen. Nilai lebih rendah menamatkan lebih banyak segmen lebih awal, tetapi juga lebih kerap memotong jeda di tengah ayat.", "Tunggu Maksimum", "Senyap paling lama sebelum segmen tamat apabila Smart Turn belum menamatkannya terlebih dahulu.", "Memuat turun model Smart Turn: {{done}} daripada {{total}}", "Muat turun model Smart Turn gagal: {{error}}"],
  nl: ["Slim", "Controleren na", "Hoe lang een pauze duurt voordat Smart Turn controleert of je klaar bent met praten. Zo ja, dan eindigt het segment meteen in plaats van de max. wachttijd af te wachten.", "Beurtdrempel", "Hoe zeker Smart Turn moet zijn dat je klaar bent voordat het het segment beëindigt. Lagere waarden beëindigen meer segmenten eerder, maar knippen ook vaker bij pauzes midden in een zin.", "Max. wachttijd", "De langste stilte voordat een segment eindigt als Smart Turn het niet eerder heeft beëindigd.", "Smart Turn-model downloaden: {{done}} van {{total}}", "Downloaden van het Smart Turn-model mislukt: {{error}}"],
  pl: ["Inteligentny", "Sprawdź po", "Jak długo trwa pauza, zanim Smart Turn sprawdzi, czy skończyłeś mówić. Jeśli tak, segment kończy się od razu, bez czekania na maks. oczekiwanie.", "Próg końca wypowiedzi", "Jak pewny musi być Smart Turn, że skończyłeś, zanim zakończy segment. Niższe wartości kończą wcześniej więcej segmentów, ale też częściej przerywają pauzy w środku zdania.", "Maks. oczekiwanie", "Najdłuższa cisza przed zakończeniem segmentu, gdy Smart Turn nie zakończył go wcześniej.", "Pobieranie modelu Smart Turn: {{done}} z {{total}}", "Pobieranie modelu Smart Turn nie powiodło się: {{error}}"],
  pt_BR: ["Inteligente", "Verificar após", "Quanto tempo dura uma pausa antes de o Smart Turn verificar se você terminou de falar. Se terminou, o segmento acaba na hora, sem esperar a espera máxima.", "Limiar de fim de turno", "O quanto o Smart Turn precisa ter certeza de que você terminou antes de encerrar o segmento. Valores menores encerram mais segmentos antes, mas também cortam mais pausas no meio da frase.", "Espera máxima", "O maior silêncio antes de um segmento terminar quando o Smart Turn não o encerrou antes.", "Baixando o modelo Smart Turn: {{done}} de {{total}}", "Falha no download do modelo Smart Turn: {{error}}"],
  pt_PT: ["Inteligente", "Verificar após", "Quanto tempo dura uma pausa antes de o Smart Turn verificar se terminou de falar. Se tiver terminado, o segmento acaba de imediato, sem esperar pela espera máxima.", "Limiar de fim de vez", "O quão certo o Smart Turn tem de estar de que terminou antes de encerrar o segmento. Valores mais baixos encerram mais segmentos mais cedo, mas também cortam mais pausas a meio da frase.", "Espera máxima", "O silêncio mais longo antes de um segmento terminar quando o Smart Turn não o encerrou antes.", "A transferir o modelo Smart Turn: {{done}} de {{total}}", "Falha na transferência do modelo Smart Turn: {{error}}"],
  ru: ["Умный", "Проверка через", "Сколько длится пауза, прежде чем Smart Turn проверит, закончили ли вы говорить. Если да, сегмент завершается сразу, не дожидаясь макс. ожидания.", "Порог конца реплики", "Насколько Smart Turn должен быть уверен, что вы закончили, прежде чем завершить сегмент. При меньших значениях больше сегментов завершается раньше, но и чаще режется пауза посреди фразы.", "Макс. ожидание", "Самая длинная тишина перед завершением сегмента, если Smart Turn не завершил его раньше.", "Скачивание модели Smart Turn: {{done}} из {{total}}", "Не удалось скачать модель Smart Turn: {{error}}"],
  sv: ["Smart", "Kontrollera efter", "Hur lång en paus är innan Smart Turn kontrollerar om du har pratat klart. Om du har det avslutas segmentet direkt i stället för att vänta på max. väntetid.", "Tröskel för turslut", "Hur säker Smart Turn måste vara på att du är klar innan segmentet avslutas. Lägre värden avslutar fler segment tidigare men klipper också oftare vid pauser mitt i en mening.", "Max. väntetid", "Den längsta tystnaden innan ett segment avslutas när Smart Turn inte har avslutat det tidigare.", "Laddar ner Smart Turn-modellen: {{done}} av {{total}}", "Nedladdningen av Smart Turn-modellen misslyckades: {{error}}"],
  ta: ["ஸ்மார்ட்", "சரிபார்க்கும் முன் இடைவெளி", "நீங்கள் பேசி முடித்தீர்களா என்று Smart Turn சரிபார்க்கும் முன் இடைநிறுத்தம் எவ்வளவு நேரம் நீடிக்கும். முடித்திருந்தால், அதிகபட்ச காத்திருப்பு வரை காத்திருக்காமல் பகுதி உடனே முடியும்.", "முறை முடிவு வரம்பு", "பகுதியை முடிப்பதற்கு முன் நீங்கள் பேசி முடித்தீர்கள் என்று Smart Turn எவ்வளவு உறுதியாக இருக்க வேண்டும். குறைந்த மதிப்புகள் அதிக பகுதிகளை முன்னதாக முடிக்கும், ஆனால் வாக்கியத்தின் நடுவில் உள்ள இடைநிறுத்தங்களிலும் அடிக்கடி வெட்டும்.", "அதிகபட்ச காத்திருப்பு", "Smart Turn முன்னதாக முடிக்காதபோது, பகுதி முடிவதற்கு முன் உள்ள மிக நீண்ட அமைதி.", "Smart Turn மாதிரி பதிவிறக்கப்படுகிறது: {{total}} இல் {{done}}", "Smart Turn மாதிரி பதிவிறக்கம் தோல்வியடைந்தது: {{error}}"],
  te: ["స్మార్ట్", "తనిఖీకి ముందు విరామం", "మీరు మాట్లాడటం ముగించారో లేదో Smart Turn తనిఖీ చేసే ముందు విరామం ఎంతసేపు ఉంటుంది. ముగించి ఉంటే, గరిష్ఠ నిరీక్షణ వరకు ఆగకుండా విభాగం వెంటనే ముగుస్తుంది.", "టర్న్ ముగింపు థ్రెషోల్డ్", "విభాగాన్ని ముగించే ముందు మీరు మాట్లాడటం ముగించారని Smart Turn ఎంత ఖచ్చితంగా ఉండాలి. తక్కువ విలువలు ఎక్కువ విభాగాలను ముందుగా ముగిస్తాయి, కానీ వాక్యం మధ్యలోని విరామాల వద్ద కూడా ఎక్కువగా కత్తిరిస్తాయి.", "గరిష్ఠ నిరీక్షణ", "Smart Turn ముందుగా ముగించనప్పుడు, విభాగం ముగియడానికి ముందు ఉండే అతి పొడవైన నిశ్శబ్దం.", "Smart Turn మోడల్ డౌన్‌లోడ్ అవుతోంది: {{total}}లో {{done}}", "Smart Turn మోడల్ డౌన్‌లోడ్ విఫలమైంది: {{error}}"],
  th: ["อัจฉริยะ", "ตรวจหลังหยุด", "ระยะเวลาที่หยุดพูดก่อนที่ Smart Turn จะตรวจว่าคุณพูดจบแล้วหรือยัง หากพูดจบแล้ว ช่วงเสียงจะจบทันทีโดยไม่ต้องรอถึงเวลารอสูงสุด", "เกณฑ์จบการพูด", "Smart Turn ต้องมั่นใจแค่ไหนว่าคุณพูดจบแล้วก่อนจะจบช่วงเสียง ค่าที่ต่ำลงจะจบช่วงเสียงก่อนได้มากขึ้น แต่ก็ตัดตรงช่วงหยุดกลางประโยคบ่อยขึ้นด้วย", "เวลารอสูงสุด", "ช่วงเงียบที่ยาวที่สุดก่อนช่วงเสียงจะจบ เมื่อ Smart Turn ไม่ได้จบช่วงเสียงก่อน", "กำลังดาวน์โหลดโมเดล Smart Turn {{done}} จาก {{total}}", "ดาวน์โหลดโมเดล Smart Turn ไม่สำเร็จ: {{error}}"],
  tr: ["Akıllı", "Kontrol Gecikmesi", "Smart Turn'ün konuşmanızı bitirip bitirmediğini kontrol etmesinden önce bir duraklamanın ne kadar sürdüğü. Bitirdiyseniz segment, Maks. Bekleme'yi beklemeden hemen sona erer.", "Sıra Sonu Eşiği", "Smart Turn'ün segmenti bitirmeden önce konuşmanızı bitirdiğinizden ne kadar emin olması gerektiği. Düşük değerler daha fazla segmenti erken bitirir, ancak cümle ortasındaki duraklamalarda da daha sık keser.", "Maks. Bekleme", "Smart Turn segmenti daha önce bitirmediğinde, segment bitmeden önceki en uzun sessizlik.", "Smart Turn modeli indiriliyor: {{done}} / {{total}}", "Smart Turn modeli indirilemedi: {{error}}"],
  uk: ["Розумний", "Перевірка через", "Скільки триває пауза, перш ніж Smart Turn перевірить, чи ви закінчили говорити. Якщо так, сегмент завершується одразу, не чекаючи макс. очікування.", "Поріг кінця репліки", "Наскільки Smart Turn має бути впевнений, що ви закінчили, перш ніж завершити сегмент. Нижчі значення завершують більше сегментів раніше, але й частіше обривають паузу посеред речення.", "Макс. очікування", "Найдовша тиша перед завершенням сегмента, якщо Smart Turn не завершив його раніше.", "Завантаження моделі Smart Turn: {{done}} з {{total}}", "Не вдалося завантажити модель Smart Turn: {{error}}"],
  vi: ["Thông minh", "Kiểm tra sau", "Khoảng ngừng kéo dài bao lâu trước khi Smart Turn kiểm tra xem bạn đã nói xong chưa. Nếu đã xong, đoạn kết thúc ngay thay vì chờ đến Chờ tối đa.", "Ngưỡng kết thúc lượt", "Smart Turn phải chắc chắn đến mức nào rằng bạn đã nói xong trước khi kết thúc đoạn. Giá trị thấp hơn kết thúc sớm nhiều đoạn hơn, nhưng cũng cắt nhiều hơn ở các khoảng ngừng giữa câu.", "Chờ tối đa", "Khoảng im lặng dài nhất trước khi một đoạn kết thúc khi Smart Turn chưa kết thúc nó trước.", "Đang tải xuống mô hình Smart Turn: {{done}} trên {{total}}", "Tải xuống mô hình Smart Turn thất bại: {{error}}"],
  zh_CN: ["智能", "判断前等待", "停顿持续多久后，Smart Turn 开始判断你是否已说完。若已说完，片段会立即结束，不必等到最长等待。", "轮次结束阈值", "Smart Turn 需要多确定你已说完才会结束片段。数值越低，提前结束的片段越多，但在句中停顿处切断的情况也越多。", "最长等待", "Smart Turn 未提前结束片段时，片段结束前允许的最长静音。", "正在下载 Smart Turn 模型 {{done}} / {{total}}", "Smart Turn 模型下载失败：{{error}}"],
  zh_TW: ["智慧", "判斷前等待", "停頓持續多久後，Smart Turn 開始判斷你是否已說完。若已說完，片段會立即結束，不必等到最長等待。", "輪次結束閾值", "Smart Turn 需要多確定你已說完才會結束片段。數值越低，提前結束的片段越多，但在句中停頓處切斷的情況也越多。", "最長等待", "Smart Turn 未提前結束片段時，片段結束前允許的最長靜音。", "正在下載 Smart Turn 模型 {{done}} / {{total}}", "Smart Turn 模型下載失敗：{{error}}"],
};

const KEYS = ['smartTurn', 'smartTurnCheckAfter', 'smartTurnCheckAfterTooltip', 'smartTurnThreshold', 'smartTurnThresholdTooltip', 'smartTurnMaxWait', 'smartTurnMaxWaitTooltip', 'smartTurnDownloading', 'smartTurnDownloadFailed'];

if (Object.keys(T).length !== 30) throw new Error(`expected 30 locales, got ${Object.keys(T).length}`);
for (const [lang, values] of Object.entries(T)) {
  if (values.length !== KEYS.length) throw new Error(`${lang}: ${values.length} strings`);
  const path = `src/locales/${lang}/translation.json`;
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  const settings = {};
  for (const [key, value] of Object.entries(catalog.settings)) {
    if (KEYS.includes(key)) continue;
    settings[key] = value;
    if (key === 'vadPreSpeechPadDurationTooltip') KEYS.forEach((k, i) => { settings[k] = values[i]; });
  }
  if (!('smartTurn' in settings)) throw new Error(`${lang}: anchor vadPreSpeechPadDurationTooltip not found`);
  catalog.settings = settings;
  writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
}
console.log('ok');
```

Run: `node /tmp/smart-turn-strings.mjs`
Expected: `ok`. Every catalog round-trips through `JSON.stringify(…, null, 2) + '\n'` unchanged apart from the new keys (checked while planning), so `git diff --stat src/locales` shows exactly 9 added lines per file.

- [ ] **Step 3: Check that en matches the code's fallbacks, and the gates**

Run: `npx vitest run src/locales/ src/components/Settings/sections/LocalSettingsControls.endOfTurn.test.tsx src/providers/localInference/LocalInferenceTurnDetection.test.tsx`
Expected: PASS. Then `git diff src/locales/en/translation.json` shows the nine en strings. Compare each with its fallback in `LocalSettingsControls.tsx` and `LocalInferenceTurnDetection.tsx`; they must be identical. No test can check this.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -F - <<'EOF'
feat(i18n): Smart Turn strings in all 30 catalogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Equ2S4yPqzv2WXq9iv5awc
EOF
```

---

### Task 15: Whole-branch verification and the manual test checklist

**Files:** none changed. This task has no commit.

- [ ] **Step 1: Full suite and typecheck**

Run: `npx vitest run`
Expected: every file passes.

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: the baseline measured before Task 1 (95 at `b4391e6f`), no more.

- [ ] **Step 2: Builds**

Run: `npm run build && npm run extension:build`
Expected: both succeed. `build/assets/` contains a `turn-webgpu.worker-*.js` and a `turn-wasm.worker-*.js` chunk.

- [ ] **Step 3: Manual checks (hand to jiangzhuo with the results so far)**

Electron (`npm run electron:dev`) on a WebGPU machine (GB10 via Vulkan, or the Mac mini M4), Local Inference ja → en, ASR Whisper (WebGPU), diagnostic logs on (Help):

1. VAD Settings (Advanced → Provider tab) shows `[ Normal ] [ Smart ]` for Whisper, Granite, Qwen3-ASR, Cohere and Voxtral 3B. It does not show them for SenseVoice (sherpa-onnx) or Voxtral Mini 4B (streaming).
2. First Smart: an inline progress line reads "Downloading the Smart Turn model: … of 30.9 MB" and both buttons are held. When it finishes, Smart is active, Turn Check After reads 0.30s, Turn Threshold reads 0.50, Min Silence reads **Max Wait**, and the Speech section's summary reads `VAD Settings · Smart · Max Wait 1.40s`. The Storage page does not list the model.
3. Start an Auto session. The Logs panel shows `local.turn {"smart":true}`. A finished Japanese sentence followed by silence shows its text noticeably sooner than under Normal (≈ 0.4 s against ≈ 1.5 s).
4. A mid-sentence "えーと…" pause of about 0.5 s is usually not cut. It is sometimes cut: that is D1's known cost and not a defect.
5. Both legs (participant audio on) with Smart: both transcribe, and the participant leg also logs `local.turn {"smart":true}`.
6. Push-to-Talk: no `local.turn` frame on the speaker leg, and releasing the key ends the turn as before.
7. WASM: start Chrome with `--disable-gpu` (in DevTools, `await navigator.gpu?.requestAdapter()` returns `null`). Whisper runs on WASM and Smart Turn loads `turn-wasm.worker` (DevTools → Sources → threads). Sentence ends still come sooner, but later than on WebGPU (≈ 177 ms per call on one thread).
8. Offline reuse: restart with the network off and start a session with Smart. No download is attempted and `local.turn {"smart":true}` is logged.
9. Failure: with the network off and the model deleted (Storage → Clear all), choose Smart. The line "Smart Turn model download failed: …" appears with Retry and Normal stays active. Retry after reconnecting works.
10. After Clear all, VAD Settings shows Normal active, and a session logs `local.turn {"smart":false}`.
11. A short "はい", a pause of about 0.5 s, then more speech within Max Wait: it stays one segment, as under Normal (Smart never asks before Min Speech Duration of speech).
12. Max Wait 0.30: the Turn Check After slider tops out at 0.25 and shows 0.25s.
13. Extension (`npm run extension:build`, load `extension/dist` unpacked in the side panel): repeat 1–3 and 7.
