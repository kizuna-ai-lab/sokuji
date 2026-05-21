# Supertonic 3 Local TTS Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supertonic 3 (Supertone Inc.) as a new local-inference TTS engine in Sokuji, covering 31 languages from a single ~383 MiB ONNX bundle. Ship in two PRs: PR-1 adds the engine with 10 preset voices, PR-2 adds an IndexedDB-backed library for user-imported `voice_style.json` files.

**Architecture:** ESM module Web Worker dynamically imports `onnxruntime-web` 1.23 (WebGPU with automatic WASM fallback). The worker runs a 4-stage diffusion pipeline (text_encoder → duration_predictor → vector_estimator ×16 steps → vocoder) and reports a named voice list back to the main thread, extending the existing `TtsReadyMessage` protocol. Imported voices live in a new `voice_styles` IndexedDB object store and merge with manifest presets at engine init; deltas trigger a worker dispose+reinit (acceptable because imports are rare).

**Tech Stack:** TypeScript, Vite, Vitest + `fake-indexeddb`, `onnxruntime-web@1.23` (existing dep), Zustand (existing stores), `idb` (existing IndexedDB helper).

**Reference spec:** [`docs/superpowers/specs/2026-05-21-supertonic-3-integration-design.md`](../specs/2026-05-21-supertonic-3-integration-design.md).

**Precondition (block PR-1 merge until satisfied):** OpenRAIL-M legal sign-off documented in the PR description. Do not merge implementation PRs until legal review is on file.

**File sizes** (already verified against HuggingFace `Supertone/supertonic-3` model tree on 2026-05-21):

| File | Bytes |
|---|---:|
| `onnx/duration_predictor.onnx` | 3,700,147 |
| `onnx/text_encoder.onnx` | 36,416,150 |
| `onnx/vector_estimator.onnx` | 256,534,781 |
| `onnx/vocoder.onnx` | 101,424,195 |
| `onnx/tts.json` | 8,253 |
| `onnx/unicode_indexer.json` | 277,676 |
| `voice_styles/F1.json` | 292,046 |
| `voice_styles/F2.json` | 292,423 |
| `voice_styles/F3.json` | 290,794 |
| `voice_styles/F4.json` | 291,808 |
| `voice_styles/F5.json` | 291,479 |
| `voice_styles/M1.json` | 291,748 |
| `voice_styles/M2.json` | 292,055 |
| `voice_styles/M3.json` | 290,198 |
| `voice_styles/M4.json` | 291,522 |
| `voice_styles/M5.json` | 291,469 |
| **Total** | **401,276,744** (~383 MiB) |

---

## Phase 1 PR — Preset voices

PR scope: ship Supertonic 3 with the 10 official preset voices selectable from the standard speaker dropdown. No `VoiceLibrarySection`, no `voiceStorage`. The engine reports a `voices` array via `TtsReadyMessage` that the UI uses for named voice display.

PR title (target): `feat(tts): add Supertonic 3 local TTS engine with 10 preset voices`

### Task 1: Bundle ORT WebGPU ESM build

**Files:**
- Modify: `scripts/copy-ort-wasm.sh`

The ESM WebGPU entry point of `onnxruntime-web` is not currently copied into `public/wasm/ort/` — only the UMD `ort.wasm.min.js` and internal JSEP runtime files are. Add it.

- [ ] **Step 1: Verify the file exists in node_modules**

Run: `ls -lh node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs`
Expected: file exists, ~500 KB. If missing, run `npm install` first.

- [ ] **Step 2: Add `"ort.webgpu.min.mjs"` to the FILES array**

Edit `scripts/copy-ort-wasm.sh`, locate the `FILES=( ... )` block, append the new entry. The diff should look like:

```bash
FILES=(
  "ort-wasm-simd-threaded.asyncify.mjs"
  "ort-wasm-simd-threaded.asyncify.wasm"
  "ort-wasm-simd-threaded.mjs"
  "ort-wasm-simd-threaded.wasm"
  "ort-wasm-simd-threaded.jsep.mjs"
  "ort-wasm-simd-threaded.jsep.wasm"
  "ort.wasm.min.js"
  "ort.webgpu.min.mjs"
)
```

Also update the comment block above so future readers know what each entry is for:

```bash
# Needed WASM variants:
#   asyncify  — default (non-Safari browsers)
#   plain     — Safari fallback (no asyncify support)
#   jsep      — WebGPU/WebNN backend (used by Whisper-WebGPU, Qwen, Supertonic workers)
# JS entry points:
#   ort.wasm.min.js     — UMD, for classic workers using importScripts() (piper-plus)
#   ort.webgpu.min.mjs  — ESM with WebGPU EP (used by Supertonic ESM module worker)
```

- [ ] **Step 3: Run the script and verify the file lands**

Run: `bash scripts/copy-ort-wasm.sh && ls -lh public/wasm/ort/ort.webgpu.min.mjs`
Expected: copy message printed, the file exists at the destination.

- [ ] **Step 4: Commit**

```bash
git add scripts/copy-ort-wasm.sh public/wasm/ort/ort.webgpu.min.mjs
git commit -m "build(ort): bundle ort.webgpu.min.mjs for Supertonic worker"
```

---

### Task 2: Add `recommended` field to `ModelManifestEntry`

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` (interface definition near top of file)

- [ ] **Step 1: Locate the `ModelManifestEntry` interface**

Run: `grep -n "interface ModelManifestEntry" src/lib/local-inference/modelManifest.ts`
Expected: single hit. Open the file at that line.

- [ ] **Step 2: Add `recommended?: boolean` to the interface**

Add the field anywhere after `type: ModelType;`. Use this exact JSDoc:

```ts
  /**
   * When true, the UI surfaces this entry with a "Recommended" badge and sorts
   * it before non-recommended entries within its `type` group. Default `false`.
   */
  recommended?: boolean;
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`
Expected: no new errors. Existing manifest entries are unaffected because the field is optional.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts
git commit -m "feat(tts): add recommended flag to ModelManifestEntry"
```

---

### Task 3: Add `sidMapping` helper module (TDD)

**Files:**
- Create: `src/lib/local-inference/sidMapping.ts`
- Create: `src/lib/local-inference/sidMapping.test.ts`

Pure functions for converting between preset codes (`'M3'`), preset sids (0–9), imported voice IndexedDB keys, and imported voice sids (`dbKey + 10`). Used by both `TtsEngine` and `VoiceLibrarySection`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/sidMapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PRESET_VOICE_ORDER,
  presetSidForVoiceCode,
  voiceCodeForPresetSid,
  importedSidFromDbKey,
  dbKeyFromImportedSid,
  isPresetSid,
  isImportedSid,
} from './sidMapping';

describe('sidMapping', () => {
  it('PRESET_VOICE_ORDER has 10 codes in the expected order', () => {
    expect(PRESET_VOICE_ORDER).toEqual(['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5']);
  });

  it('presetSidForVoiceCode maps codes to fixed sids', () => {
    expect(presetSidForVoiceCode('F1')).toBe(0);
    expect(presetSidForVoiceCode('M3')).toBe(7);
    expect(presetSidForVoiceCode('M5')).toBe(9);
  });

  it('voiceCodeForPresetSid is the inverse of presetSidForVoiceCode', () => {
    expect(voiceCodeForPresetSid(0)).toBe('F1');
    expect(voiceCodeForPresetSid(7)).toBe('M3');
    expect(voiceCodeForPresetSid(9)).toBe('M5');
  });

  it('voiceCodeForPresetSid returns null for non-preset sids', () => {
    expect(voiceCodeForPresetSid(10)).toBeNull();
    expect(voiceCodeForPresetSid(-1)).toBeNull();
    expect(voiceCodeForPresetSid(99)).toBeNull();
  });

  it('importedSidFromDbKey adds the +10 offset', () => {
    expect(importedSidFromDbKey(1)).toBe(11);
    expect(importedSidFromDbKey(42)).toBe(52);
  });

  it('dbKeyFromImportedSid subtracts the +10 offset', () => {
    expect(dbKeyFromImportedSid(11)).toBe(1);
    expect(dbKeyFromImportedSid(52)).toBe(42);
  });

  it('dbKeyFromImportedSid returns null for non-imported sids', () => {
    expect(dbKeyFromImportedSid(7)).toBeNull();
    expect(dbKeyFromImportedSid(9)).toBeNull();
    expect(dbKeyFromImportedSid(-1)).toBeNull();
  });

  it('isPresetSid classifies sids correctly', () => {
    expect(isPresetSid(0)).toBe(true);
    expect(isPresetSid(9)).toBe(true);
    expect(isPresetSid(10)).toBe(false);
    expect(isPresetSid(-1)).toBe(false);
  });

  it('isImportedSid classifies sids correctly', () => {
    expect(isImportedSid(10)).toBe(true);
    expect(isImportedSid(99)).toBe(true);
    expect(isImportedSid(9)).toBe(false);
    expect(isImportedSid(-1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/sidMapping.test.ts`
Expected: FAIL — cannot resolve module `./sidMapping`.

- [ ] **Step 3: Implement the module**

Create `src/lib/local-inference/sidMapping.ts`:

```ts
/**
 * sid (speaker id) numbering for the Supertonic 3 TTS engine.
 *
 * Sids 0–9 map to the 10 official preset voices in a fixed order. Sids ≥ 10
 * map to user-imported voices whose IndexedDB primary key is (sid - 10).
 *
 * The +10 offset keeps preset sids stable across releases and prevents
 * imported voice sids from being recycled when the user deletes one (the
 * IndexedDB autoincrement counter never reuses keys).
 */

/** Voice code → sid order. Index in this array IS the preset sid. */
export const PRESET_VOICE_ORDER = [
  'F1', 'F2', 'F3', 'F4', 'F5',
  'M1', 'M2', 'M3', 'M4', 'M5',
] as const;

export type PresetVoiceCode = (typeof PRESET_VOICE_ORDER)[number];

const PRESET_COUNT = PRESET_VOICE_ORDER.length;
const IMPORTED_SID_OFFSET = 10;

export function presetSidForVoiceCode(code: PresetVoiceCode): number {
  return PRESET_VOICE_ORDER.indexOf(code);
}

export function voiceCodeForPresetSid(sid: number): PresetVoiceCode | null {
  if (sid < 0 || sid >= PRESET_COUNT) return null;
  return PRESET_VOICE_ORDER[sid];
}

export function importedSidFromDbKey(dbKey: number): number {
  return dbKey + IMPORTED_SID_OFFSET;
}

export function dbKeyFromImportedSid(sid: number): number | null {
  if (sid < IMPORTED_SID_OFFSET) return null;
  return sid - IMPORTED_SID_OFFSET;
}

export function isPresetSid(sid: number): boolean {
  return sid >= 0 && sid < PRESET_COUNT;
}

export function isImportedSid(sid: number): boolean {
  return sid >= IMPORTED_SID_OFFSET;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/sidMapping.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/sidMapping.ts src/lib/local-inference/sidMapping.test.ts
git commit -m "feat(tts): add sidMapping helper for Supertonic voice ids"
```

---

### Task 4: Extend `TtsReadyMessage` with `voices?` and `backend?`

**Files:**
- Modify: `src/lib/local-inference/types.ts:279-284`

- [ ] **Step 1: Locate `TtsReadyMessage`**

Run: `grep -n "interface TtsReadyMessage" src/lib/local-inference/types.ts`
Expected: single hit, line ~279.

- [ ] **Step 2: Add the two optional fields**

Replace the interface body so it reads:

```ts
export interface TtsReadyMessage {
  type: 'ready';
  loadTimeMs: number;
  numSpeakers: number;
  sampleRate: number;
  /**
   * Optional named voice list. When present, the UI renders a labeled
   * dropdown using these names instead of falling back to "Speaker 0..N-1"
   * derived from `numSpeakers`. Supertonic populates this; other engines
   * leave it undefined.
   */
  voices?: Array<{
    sid: number;
    name: string;
    source: 'preset' | 'imported';
    gender?: 'M' | 'F';
  }>;
  /** Optional backend hint for UI/debug. Supertonic sets this. */
  backend?: 'webgpu' | 'wasm';
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/types.ts
git commit -m "feat(tts): extend TtsReadyMessage with optional voices + backend"
```

---

### Task 5: Register Supertonic 3 in `modelManifest`

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts` (append to MODELS array)
- Create: `src/lib/local-inference/modelManifest.supertonic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/modelManifest.supertonic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getManifestEntry,
  getModelDownloadUrl,
  selectVariant,
} from './modelManifest';

describe('Supertonic 3 manifest entry', () => {
  const entry = getManifestEntry('supertonic-3');

  it('is registered', () => {
    expect(entry).toBeDefined();
  });

  it('has the expected type/engine/recommended', () => {
    expect(entry!.type).toBe('tts');
    expect(entry!.engine).toBe('supertonic');
    expect(entry!.recommended).toBe(true);
  });

  it('declares numSpeakers = 10 (presets only)', () => {
    expect(entry!.numSpeakers).toBe(10);
  });

  it('uses Supertone/supertonic-3 as the HF model id', () => {
    expect(entry!.hfModelId).toBe('Supertone/supertonic-3');
  });

  it('selects the only variant (default) on any device', () => {
    expect(selectVariant(entry!, [])).toBe('default');
    expect(selectVariant(entry!, ['webgpu'])).toBe('default');
  });

  it('lists 16 files (4 onnx + 2 json + 10 voice json)', () => {
    expect(entry!.variants.default.files).toHaveLength(16);
  });

  it('lists 31 supported languages', () => {
    expect(entry!.ttsConfig!.supportedLanguages).toHaveLength(31);
    expect(entry!.ttsConfig!.supportedLanguages).toContain('en');
    expect(entry!.ttsConfig!.supportedLanguages).not.toContain('zh');
  });

  it('lists 10 preset voices with sids 0..9 in F-then-M order', () => {
    const presets = entry!.ttsConfig!.presetVoices!;
    expect(presets).toHaveLength(10);
    expect(presets.map(p => p.sid)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(presets[0].name).toBe('Sarah');
    expect(presets[7].name).toBe('Robert');
    expect(presets[7].file).toBe('voice_styles/M3.json');
  });

  it('default sid is 7 (Robert)', () => {
    expect(entry!.ttsConfig!.defaultSid).toBe(7);
  });

  it('totalStep is 16', () => {
    expect(entry!.ttsConfig!.totalStep).toBe(16);
  });

  it('total file size is in the [383MiB, 384MiB] envelope', () => {
    const total = entry!.variants.default.files.reduce((s, f) => s + f.sizeBytes, 0);
    expect(total).toBeGreaterThanOrEqual(383 * 1024 * 1024);
    expect(total).toBeLessThanOrEqual(384 * 1024 * 1024);
  });

  it('builds the expected HF download URL', () => {
    const url = getModelDownloadUrl(entry!, 'onnx/duration_predictor.onnx');
    expect(url).toBe(
      'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx/duration_predictor.onnx',
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/modelManifest.supertonic.test.ts`
Expected: FAIL — `getManifestEntry('supertonic-3')` returns undefined.

- [ ] **Step 3: Extend `TtsModelConfig`**

Open `src/lib/local-inference/modelManifest.ts`, locate the `TtsModelConfig` interface (search `interface TtsModelConfig` or the `TtsEngineType` union; the config interface is nearby). Add the following fields if not already present:

```ts
  /** Supertonic: list of 31 supported language codes ('na' added at runtime for fallback). */
  supportedLanguages?: readonly string[];
  /** Supertonic: preset voice metadata, ordered by sid. */
  presetVoices?: Array<{
    sid: number;
    name: string;
    gender: 'M' | 'F';
    /** Relative file path within the model bundle, e.g. 'voice_styles/F1.json'. */
    file: string;
  }>;
  /** Supertonic: default sid when settings.sid is unset or invalid. */
  defaultSid?: number;
  /** Supertonic: diffusion iteration count. Hardcoded to 16. */
  totalStep?: number;
```

These are all optional and additive — they do not break existing engine configs.

- [ ] **Step 4: Append the Supertonic 3 entry to the MODELS array**

Locate the MODELS array (the last existing TTS entry; use `grep -n "engine: 'piper'" src/lib/local-inference/modelManifest.ts | tail` to find a good neighbor). Insert before the closing `];`:

```ts
  {
    id: 'supertonic-3',
    type: 'tts',
    engine: 'supertonic',
    recommended: true,
    hfModelId: 'Supertone/supertonic-3',
    numSpeakers: 10,
    ttsConfig: {
      supportedLanguages: [
        'en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr',
        'hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk',
        'sl','sv','tr','uk','vi',
      ],
      presetVoices: [
        { sid: 0, name: 'Sarah',   gender: 'F', file: 'voice_styles/F1.json' },
        { sid: 1, name: 'Lily',    gender: 'F', file: 'voice_styles/F2.json' },
        { sid: 2, name: 'Jessica', gender: 'F', file: 'voice_styles/F3.json' },
        { sid: 3, name: 'Olivia',  gender: 'F', file: 'voice_styles/F4.json' },
        { sid: 4, name: 'Emily',   gender: 'F', file: 'voice_styles/F5.json' },
        { sid: 5, name: 'Alex',    gender: 'M', file: 'voice_styles/M1.json' },
        { sid: 6, name: 'James',   gender: 'M', file: 'voice_styles/M2.json' },
        { sid: 7, name: 'Robert',  gender: 'M', file: 'voice_styles/M3.json' },
        { sid: 8, name: 'Sam',     gender: 'M', file: 'voice_styles/M4.json' },
        { sid: 9, name: 'Daniel',  gender: 'M', file: 'voice_styles/M5.json' },
      ],
      defaultSid: 7,
      totalStep: 16,
    },
    variants: {
      default: {
        dtype: 'default',
        files: [
          { filename: 'onnx/duration_predictor.onnx', sizeBytes: 3_700_147 },
          { filename: 'onnx/text_encoder.onnx',       sizeBytes: 36_416_150 },
          { filename: 'onnx/vector_estimator.onnx',   sizeBytes: 256_534_781 },
          { filename: 'onnx/vocoder.onnx',            sizeBytes: 101_424_195 },
          { filename: 'onnx/tts.json',                sizeBytes: 8_253 },
          { filename: 'onnx/unicode_indexer.json',    sizeBytes: 277_676 },
          { filename: 'voice_styles/F1.json',         sizeBytes: 292_046 },
          { filename: 'voice_styles/F2.json',         sizeBytes: 292_423 },
          { filename: 'voice_styles/F3.json',         sizeBytes: 290_794 },
          { filename: 'voice_styles/F4.json',         sizeBytes: 291_808 },
          { filename: 'voice_styles/F5.json',         sizeBytes: 291_479 },
          { filename: 'voice_styles/M1.json',         sizeBytes: 291_748 },
          { filename: 'voice_styles/M2.json',         sizeBytes: 292_055 },
          { filename: 'voice_styles/M3.json',         sizeBytes: 290_198 },
          { filename: 'voice_styles/M4.json',         sizeBytes: 291_522 },
          { filename: 'voice_styles/M5.json',         sizeBytes: 291_469 },
        ],
      },
    },
  },
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/modelManifest.supertonic.test.ts`
Expected: PASS, all 12 tests green.

- [ ] **Step 6: Run the full Vitest suite to confirm no other manifest tests broke**

Run: `npx vitest run src/lib/local-inference/`
Expected: existing manifest tests (e.g. `modelManifest.hyMt.test.ts`) still pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts \
        src/lib/local-inference/modelManifest.supertonic.test.ts
git commit -m "feat(tts): register Supertonic 3 in model manifest"
```

---

### Task 6: Show Recommended badge in `ModelManagementSection`

**Files:**
- Modify: `src/components/ConfigPanel/LocalInference/ModelManagementSection.tsx`
- Modify: `src/components/ConfigPanel/LocalInference/ModelManagementSection.scss` (badge styling — check actual path; some sections inline styles)

- [ ] **Step 1: Find the section file**

Run: `find src/components -iname "ModelManagementSection*" -type f`
Expected: one `.tsx` and probably one `.scss`. Note the exact paths.

- [ ] **Step 2: Render the badge next to recommended entries**

Inside the JSX that renders each manifest entry row, add (next to the model name):

```tsx
{entry.recommended && <span className="model-recommended-badge">Recommended</span>}
```

- [ ] **Step 3: Sort recommended entries first within each `type` group**

Wherever the component iterates manifest entries for a given `type`, replace the iterable with a sorted copy. Pattern:

```ts
const sortedEntries = [...entries].sort((a, b) => {
  if (a.recommended === b.recommended) return 0;
  return a.recommended ? -1 : 1;
});
```

If there is no `type` grouping yet, do the sort on the top-level list.

- [ ] **Step 4: Add CSS for the badge**

In the section's SCSS file, add:

```scss
.model-recommended-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  color: #10a37f;
  background: rgba(16, 163, 127, 0.12);
  border: 1px solid rgba(16, 163, 127, 0.4);
  border-radius: 4px;
}
```

(Color matches the primary action color noted in `CLAUDE.md`.)

- [ ] **Step 5: Manual visual verify in dev server**

Run: `npm run dev`
Open the app, navigate to Model Management section. Supertonic 3 should appear at the top of the TTS list with a green "Recommended" badge. Other TTS models render unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/ConfigPanel/LocalInference/ModelManagementSection.tsx \
        src/components/ConfigPanel/LocalInference/ModelManagementSection.scss
git commit -m "feat(ui): show Recommended badge in ModelManagementSection"
```

---

### Task 7: Worker scaffold — init handler + ORT load with WebGPU/WASM fallback

**Files:**
- Create: `public/workers/supertonic-tts.worker.js`

This task creates the worker file and gets it to the point where it dynamically imports ORT, probes WebGPU availability, and posts back a `ready`-shaped message (without actually loading any ONNX yet — those come in Tasks 8–11).

- [ ] **Step 1: Create the worker file with the scaffold**

```js
/**
 * Supertonic 3 TTS Worker — ESM module worker.
 *
 * Loads onnxruntime-web (ESM WebGPU build) dynamically from the bundled
 * /wasm/ort/ directory. Runs a 4-stage diffusion TTS pipeline:
 *   text_encoder → duration_predictor → vector_estimator (×totalStep) → vocoder
 *
 * Protocol (Main → Worker):
 *   { type: 'init', fileUrls, voiceList, ortBaseUrl, ttsConfig }
 *   { type: 'generate', text, sid, speed, lang? }
 *   { type: 'dispose' }
 *
 * Protocol (Worker → Main):
 *   { type: 'ready', loadTimeMs, numSpeakers, sampleRate, voices, backend }
 *   { type: 'status', message }
 *   { type: 'result', samples: Float32Array, sampleRate, generationTimeMs }
 *   { type: 'error', error }
 *   { type: 'disposed' }
 */

let ort = null;
let sessions = null;      // { dpOrt, textEncOrt, vectorEstOrt, vocoderOrt }
let voiceTensors = null;  // Map<sid, { styleTtl, styleDp, name, source, gender }>
let cfgs = null;          // tts.json contents
let indexer = null;       // unicode_indexer.json contents
let sampleRate = 44100;
let totalStep = 16;
let defaultSid = 7;
let backend = 'wasm';

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        await handleInit(msg);
        break;
      case 'generate':
        await handleGenerate(msg);
        break;
      case 'dispose':
        await handleDispose();
        break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err && err.message ? err.message : String(err) });
  }
};

async function handleInit({ fileUrls, voiceList, ortBaseUrl, ttsConfig }) {
  const startTime = performance.now();

  if (ttsConfig) {
    if (typeof ttsConfig.totalStep === 'number') totalStep = ttsConfig.totalStep;
    if (typeof ttsConfig.defaultSid === 'number') defaultSid = ttsConfig.defaultSid;
  }

  // Dynamic import of ORT WebGPU ESM bundle
  ort = await import(ortBaseUrl + '/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = ortBaseUrl + '/';
  ort.env.wasm.numThreads = 1;

  // Detect WebGPU availability (available in worker scope on Chromium 113+)
  const hasWebGPU = typeof self.navigator !== 'undefined'
    && typeof self.navigator.gpu !== 'undefined';
  backend = hasWebGPU ? 'webgpu' : 'wasm';

  self.postMessage({
    type: 'status',
    message: `Initializing Supertonic 3 (backend: ${backend})`,
  });

  // ... ONNX session loading happens in Task 8
  // ... voice tensor parsing happens in Task 9
  // ... ready message posting happens in Task 9

  // PLACEHOLDER FOR SCAFFOLD: report a partial ready so we can wire up
  // main↔worker before the model loading is complete. Will be replaced
  // in Task 9.
  self.postMessage({
    type: 'ready',
    loadTimeMs: Math.round(performance.now() - startTime),
    numSpeakers: voiceList ? voiceList.length : 0,
    sampleRate,
    voices: (voiceList || []).map(v => ({
      sid: v.sid, name: v.name, source: v.source, gender: v.gender,
    })),
    backend,
  });
}

async function handleGenerate(_msg) {
  throw new Error('handleGenerate not implemented yet');
}

async function handleDispose() {
  if (sessions) {
    for (const key of Object.keys(sessions)) {
      try { await sessions[key].release(); } catch { /* ignore */ }
    }
    sessions = null;
  }
  voiceTensors = null;
  cfgs = null;
  indexer = null;
  self.postMessage({ type: 'disposed' });
}
```

The placeholder `ready` message at the end of `handleInit` is **intentional** — it lets us wire up the main-thread side (Task 12) before the heavy ONNX work lands in Tasks 8–11. Each subsequent task replaces a more specific section of this scaffold.

- [ ] **Step 2: Verify the file lints / formats clean**

Run: `npx eslint public/workers/supertonic-tts.worker.js`
Expected: no errors. If the project has different lint rules for workers, follow the same exclusions/overrides used for `piper-plus-tts.worker.js`.

- [ ] **Step 3: Commit**

```bash
git add public/workers/supertonic-tts.worker.js
git commit -m "feat(tts): supertonic worker scaffold with ORT + backend probe"
```

---

### Task 8: Worker — load 4 ONNX sessions + JSON configs with WebGPU/WASM fallback

**Files:**
- Modify: `public/workers/supertonic-tts.worker.js` (`handleInit`)

- [ ] **Step 1: Add a helper to fetch a blob URL as JSON**

Inside `supertonic-tts.worker.js`, near the top (above `handleInit`):

```js
async function fetchBlobAsJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await resp.json();
}

async function fetchBlobAsArrayBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return await resp.arrayBuffer();
}
```

- [ ] **Step 2: Add the session-loading helper with retry on WebGPU→WASM**

Insert above `handleInit`:

```js
const MODEL_KEYS = [
  { key: 'dpOrt',         file: 'onnx/duration_predictor.onnx' },
  { key: 'textEncOrt',    file: 'onnx/text_encoder.onnx' },
  { key: 'vectorEstOrt',  file: 'onnx/vector_estimator.onnx' },
  { key: 'vocoderOrt',    file: 'onnx/vocoder.onnx' },
];

async function loadAllSessions(fileUrls, executionProvider) {
  const opts = {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all',
  };
  const out = {};
  for (const { key, file } of MODEL_KEYS) {
    const url = fileUrls[file];
    if (!url) throw new Error(`Missing model file: ${file}`);
    const bytes = await fetchBlobAsArrayBuffer(url);
    out[key] = await ort.InferenceSession.create(bytes, opts);
    self.postMessage({
      type: 'status',
      message: `Loaded ${file} (${executionProvider})`,
    });
  }
  return out;
}

async function releaseSessions(sessionMap) {
  if (!sessionMap) return;
  for (const key of Object.keys(sessionMap)) {
    try { await sessionMap[key].release(); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 3: Replace the placeholder in `handleInit` with the real load**

In `handleInit`, after the `backend` probe, before the placeholder ready message, replace the placeholder block (everything from `// PLACEHOLDER FOR SCAFFOLD` to the closing brace of the `self.postMessage` call) with:

```js
  // Load 4 ONNX sessions with WebGPU→WASM auto-fallback
  let ep = backend;
  try {
    sessions = await loadAllSessions(fileUrls, ep);
  } catch (err) {
    if (ep === 'webgpu') {
      self.postMessage({
        type: 'status',
        message: `WebGPU init failed (${err.message || err}), falling back to WASM`,
      });
      await releaseSessions(sessions);
      sessions = null;
      ep = 'wasm';
      backend = 'wasm';
      sessions = await loadAllSessions(fileUrls, ep);
    } else {
      throw err;
    }
  }

  // Load tts.json and unicode_indexer.json
  cfgs = await fetchBlobAsJson(fileUrls['onnx/tts.json']);
  indexer = await fetchBlobAsJson(fileUrls['onnx/unicode_indexer.json']);
  sampleRate = cfgs.ae.sample_rate;

  // (Task 9 inserts voice tensor parsing here)

  self.postMessage({
    type: 'ready',
    loadTimeMs: Math.round(performance.now() - startTime),
    numSpeakers: voiceList ? voiceList.length : 0,
    sampleRate,
    voices: (voiceList || []).map(v => ({
      sid: v.sid, name: v.name, source: v.source, gender: v.gender,
    })),
    backend,
  });
```

- [ ] **Step 4: Commit**

```bash
git add public/workers/supertonic-tts.worker.js
git commit -m "feat(tts): supertonic worker loads ONNX sessions + configs"
```

---

### Task 9: Worker — parse preset voice JSONs into tensors

**Files:**
- Modify: `public/workers/supertonic-tts.worker.js` (inside `handleInit`)

- [ ] **Step 1: Add the voice-parsing helper**

Insert above `handleInit`:

```js
function jsonToFloat32Tensor(voiceField) {
  // voiceField shape: { data: nested arrays, dims: [d1, d2, d3] }
  const dims = voiceField.dims;
  if (!Array.isArray(dims)) throw new Error('voice JSON missing dims array');
  const flat = Array.isArray(voiceField.data) ? voiceField.data.flat(Infinity) : null;
  if (!flat) throw new Error('voice JSON data must be a (nested) array');
  return new ort.Tensor('float32', Float32Array.from(flat), dims);
}

async function loadVoiceTensorMap(voiceList) {
  const map = new Map();
  for (const v of voiceList || []) {
    try {
      const json = await fetchBlobAsJson(v.blobUrl);
      if (!json.style_ttl || !json.style_dp) {
        self.postMessage({
          type: 'status',
          message: `Skipping voice ${v.name} (sid ${v.sid}): missing style_ttl/style_dp`,
        });
        continue;
      }
      map.set(v.sid, {
        styleTtl: jsonToFloat32Tensor(json.style_ttl),
        styleDp: jsonToFloat32Tensor(json.style_dp),
        name: v.name,
        source: v.source,
        gender: v.gender,
      });
    } catch (err) {
      self.postMessage({
        type: 'status',
        message: `Skipping voice ${v.name} (sid ${v.sid}): ${err.message || err}`,
      });
    }
  }
  return map;
}
```

The skip-on-error behavior matches the spec error matrix: a single bad voice JSON does not block engine init.

- [ ] **Step 2: Call the helper inside `handleInit`**

In `handleInit`, replace the comment `// (Task 9 inserts voice tensor parsing here)` with:

```js
  voiceTensors = await loadVoiceTensorMap(voiceList || []);

  // Recompute voices payload from the actually-loaded tensors so the UI
  // sees only voices that initialized successfully.
  const loadedVoices = [];
  for (const v of voiceList || []) {
    if (voiceTensors.has(v.sid)) {
      loadedVoices.push({
        sid: v.sid, name: v.name, source: v.source, gender: v.gender,
      });
    }
  }
```

- [ ] **Step 3: Send the recomputed list in the ready message**

Replace the `voices:` line in the `ready` postMessage so it reads:

```js
    voices: loadedVoices,
    numSpeakers: loadedVoices.length,
```

- [ ] **Step 4: Commit**

```bash
git add public/workers/supertonic-tts.worker.js
git commit -m "feat(tts): supertonic worker parses voice_style JSONs into tensors"
```

---

### Task 10: Worker — text preprocessing + Unicode indexer

**Files:**
- Modify: `public/workers/supertonic-tts.worker.js`

Port the official Space's `preprocessText` + `textToUnicodeValues` + `getTextMask` helpers. We **intentionally skip** the 300+ LOC `detectLanguage` function — sokuji passes `lang` explicitly.

- [ ] **Step 1: Add the language allow-list constant**

Insert near the top of the worker (after the `MODEL_KEYS` constant):

```js
const AVAILABLE_LANGS = [
  'en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr',
  'hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk',
  'sl','sv','tr','uk','vi',
];
```

- [ ] **Step 2: Add the `preprocessText` function**

Ported verbatim from `script.js@327`, with one behavior tweak: when `lang` is not in `AVAILABLE_LANGS`, fall back to `'na'` (language-agnostic) and emit a `status` message — do **not** throw. Insert above `handleGenerate`:

```js
function preprocessText(text, lang) {
  text = text.normalize('NFKD');

  // Strip emoji (overlap with main-thread stripEmoji is intentional; this
  // is the official preprocess and we keep parity)
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
    '',
  );

  const replacements = {
    '–': '-', '‑': '-', '—': '-', '_': ' ',
    '“': '"', '”': '"', '‘': "'", '’': "'",
    '´': "'", '`': "'",
    '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ',
    '→': ' ', '←': ' ',
  };
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replaceAll(k, v);
  }

  text = text.replace(/[♥☆♡©\\]/g, '');

  const exprReplacements = { '@': ' at ', 'e.g.,': 'for example,', 'i.e.,': 'that is,' };
  for (const [k, v] of Object.entries(exprReplacements)) {
    text = text.replaceAll(k, v);
  }

  text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!')
             .replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':')
             .replace(/ '/g, "'");
  while (text.includes('""')) text = text.replace(/""/g, '"');
  while (text.includes("''")) text = text.replace(/''/g, "'");
  while (text.includes('``')) text = text.replace(/``/g, '`');
  text = text.replace(/\s+/g, ' ').trim();

  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) {
    text += '.';
  }

  let effectiveLang = lang;
  if (lang && !AVAILABLE_LANGS.includes(lang)) {
    self.postMessage({
      type: 'status',
      message: `Language '${lang}' not supported; using language-agnostic mode (na)`,
    });
    effectiveLang = null;
  }
  text = effectiveLang ? `<${effectiveLang}>${text}</${effectiveLang}>` : `<na>${text}</na>`;

  return text;
}

function textToUnicodeValues(text) {
  return Array.from(text).map(ch => ch.charCodeAt(0));
}

function getTextMask(lengths) {
  const maxLen = Math.max(...lengths);
  return lengths.map(len => {
    const row = new Array(maxLen);
    for (let j = 0; j < maxLen; j++) row[j] = j < len ? 1.0 : 0.0;
    return [row];
  });
}

function applyIndexer(processedTexts) {
  const lengths = processedTexts.map(t => Array.from(t).length);
  const maxLen = Math.max(...lengths);
  const textIds = [];
  const unsupportedChars = new Set();
  for (let i = 0; i < processedTexts.length; i++) {
    const row = new Array(maxLen).fill(0);
    const codes = textToUnicodeValues(processedTexts[i]);
    for (let j = 0; j < codes.length; j++) {
      const idx = indexer[codes[j]];
      if (idx === undefined || idx === null || idx === -1) {
        unsupportedChars.add(Array.from(processedTexts[i])[j]);
        row[j] = 0;
      } else {
        row[j] = idx;
      }
    }
    textIds.push(row);
  }
  return { textIds, textMask: getTextMask(lengths), unsupportedChars: Array.from(unsupportedChars) };
}
```

- [ ] **Step 3: Commit**

```bash
git add public/workers/supertonic-tts.worker.js
git commit -m "feat(tts): supertonic worker text preprocessor + indexer"
```

---

### Task 11: Worker — 4-stage generate pipeline

**Files:**
- Modify: `public/workers/supertonic-tts.worker.js` (`handleGenerate`)

- [ ] **Step 1: Add tensor helpers**

Insert above `handleGenerate`:

```js
function intArrayToTensor(rows, shape) {
  const flat = rows.flat(Infinity).map(x => BigInt(x));
  return new ort.Tensor('int64', BigInt64Array.from(flat), shape);
}

function floatArrayToTensor(rows, shape) {
  const flat = rows.flat(Infinity);
  return new ort.Tensor('float32', Float32Array.from(flat), shape);
}

function sampleNoisyLatent(durationReshaped) {
  const baseChunkSize = cfgs.ae.base_chunk_size;
  const chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
  const ldim = cfgs.ttl.latent_dim;

  const bsz = durationReshaped.length;
  const wavLenMax = Math.max(...durationReshaped.map(d => d[0][0])) * sampleRate;
  const wavLengths = durationReshaped.map(d => Math.floor(d[0][0] * sampleRate));
  const chunkSize = baseChunkSize * chunkCompressFactor;
  const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
  const latentDim = ldim * chunkCompressFactor;

  const latentBuffer = new Float32Array(bsz * latentDim * latentLen);
  let idx = 0;
  for (let b = 0; b < bsz; b++) {
    const validLen = Math.floor((wavLengths[b] + chunkSize - 1) / chunkSize);
    for (let d = 0; d < latentDim; d++) {
      for (let t = 0; t < latentLen; t++) {
        if (t < validLen) {
          const u1 = Math.random(), u2 = Math.random();
          latentBuffer[idx++] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        } else {
          latentBuffer[idx++] = 0;
        }
      }
    }
  }

  const latentMask = wavLengths.map(len => {
    const validLen = Math.floor((len + chunkSize - 1) / chunkSize);
    const row = new Array(latentLen);
    for (let t = 0; t < latentLen; t++) row[t] = t < validLen ? 1.0 : 0.0;
    return [row];
  });

  return { latentBuffer, latentDim, latentLen, latentMask };
}
```

- [ ] **Step 2: Implement `handleGenerate`**

Replace the existing `handleGenerate` placeholder with:

```js
async function handleGenerate({ text, sid, speed, lang }) {
  if (!sessions) throw new Error('Engine not initialized');

  const startTime = performance.now();

  // Look up voice tensors with sid fallback
  let voice = voiceTensors.get(sid);
  if (!voice) {
    self.postMessage({
      type: 'status',
      message: `sid ${sid} not loaded; falling back to default sid ${defaultSid}`,
    });
    voice = voiceTensors.get(defaultSid);
    if (!voice) {
      throw new Error('Default voice not available — engine misconfigured');
    }
  }

  const processed = preprocessText(text, lang);
  const { textIds, textMask, unsupportedChars } = applyIndexer([processed]);
  if (unsupportedChars.length > 0) {
    self.postMessage({
      type: 'status',
      message: `Unsupported characters skipped: ${unsupportedChars.map(c => `"${c}"`).join(', ')}`,
    });
  }

  const bsz = 1;
  const textIdsShape = [bsz, textIds[0].length];
  const textMaskShape = [bsz, 1, textMask[0][0].length];
  const textMaskTensor = floatArrayToTensor(textMask, textMaskShape);

  // Stage 1: duration predictor
  const dpResult = await sessions.dpOrt.run({
    text_ids:  intArrayToTensor(textIds, textIdsShape),
    style_dp:  voice.styleDp,
    text_mask: textMaskTensor,
  });
  const durOnnx = Array.from(dpResult.duration.data);
  const durationFactor = speed && speed > 0 ? 1.0 / speed : 1.0;
  for (let i = 0; i < durOnnx.length; i++) durOnnx[i] *= durationFactor;
  const durReshaped = [];
  for (let b = 0; b < bsz; b++) durReshaped.push([[durOnnx[b]]]);

  // Stage 2: text encoder
  const textEncResult = await sessions.textEncOrt.run({
    text_ids:  intArrayToTensor(textIds, textIdsShape),
    style_ttl: voice.styleTtl,
    text_mask: textMaskTensor,
  });
  const textEmbTensor = textEncResult.text_emb;

  // Stage 3: diffusion (totalStep iterations of vector_estimator)
  const { latentBuffer, latentDim, latentLen, latentMask } = sampleNoisyLatent(durReshaped);
  const latentShape = [bsz, latentDim, latentLen];
  const latentMaskShape = [bsz, 1, latentMask[0][0].length];
  const latentMaskTensor = floatArrayToTensor(latentMask, latentMaskShape);

  const scalarShape = [bsz];
  const totalStepTensor = floatArrayToTensor([new Array(bsz).fill(totalStep)], scalarShape);
  const stepTensors = [];
  for (let step = 0; step < totalStep; step++) {
    stepTensors.push(floatArrayToTensor([new Array(bsz).fill(step)], scalarShape));
  }

  for (let step = 0; step < totalStep; step++) {
    const noisyLatentTensor = new ort.Tensor('float32', latentBuffer, latentShape);
    const r = await sessions.vectorEstOrt.run({
      noisy_latent:  noisyLatentTensor,
      text_emb:      textEmbTensor,
      style_ttl:     voice.styleTtl,
      text_mask:     textMaskTensor,
      latent_mask:   latentMaskTensor,
      total_step:    totalStepTensor,
      current_step:  stepTensors[step],
    });
    latentBuffer.set(r.denoised_latent.data);
  }

  // Stage 4: vocoder
  const vocoderResult = await sessions.vocoderOrt.run({
    latent: new ort.Tensor('float32', latentBuffer, latentShape),
  });
  const wavBatch = vocoderResult.wav_tts.data;
  const wavLen = Math.floor(sampleRate * durOnnx[0]);
  const samples = wavBatch.slice(0, wavLen);

  self.postMessage(
    { type: 'result', samples, sampleRate, generationTimeMs: Math.round(performance.now() - startTime) },
    [samples.buffer],
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add public/workers/supertonic-tts.worker.js
git commit -m "feat(tts): supertonic worker implements 4-stage generate pipeline"
```

---

### Task 12: TtsEngine — supertonic branch (TDD with mock worker)

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`
- Create: `src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsEngine } from './TtsEngine';
import { ModelManager } from '../ModelManager';

class MockWorker {
  static instances: MockWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  constructor(public url: string | URL, public opts?: WorkerOptions) {
    MockWorker.instances.push(this);
  }
  emit(data: unknown) {
    if (this.onmessage) this.onmessage({ data } as MessageEvent);
  }
}

const originalWorker = globalThis.Worker;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe('TtsEngine — supertonic branch', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    (globalThis as any).Worker = MockWorker;
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();

    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({
      'onnx/duration_predictor.onnx': 'blob:dp',
      'onnx/text_encoder.onnx': 'blob:te',
      'onnx/vector_estimator.onnx': 'blob:ve',
      'onnx/vocoder.onnx': 'blob:vc',
      'onnx/tts.json': 'blob:tts',
      'onnx/unicode_indexer.json': 'blob:idx',
      'voice_styles/F1.json': 'blob:f1',
      'voice_styles/F2.json': 'blob:f2',
      'voice_styles/F3.json': 'blob:f3',
      'voice_styles/F4.json': 'blob:f4',
      'voice_styles/F5.json': 'blob:f5',
      'voice_styles/M1.json': 'blob:m1',
      'voice_styles/M2.json': 'blob:m2',
      'voice_styles/M3.json': 'blob:m3',
      'voice_styles/M4.json': 'blob:m4',
      'voice_styles/M5.json': 'blob:m5',
    });
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('creates a module-type worker pointing at the supertonic worker file', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    const w = MockWorker.instances.at(-1)!;
    expect(String(w.url)).toMatch(/supertonic-tts\.worker\.js$/);
    expect(w.opts?.type).toBe('module');

    w.emit({ type: 'ready', loadTimeMs: 100, numSpeakers: 10, sampleRate: 44100,
             voices: Array.from({length: 10}, (_, i) => ({sid: i, name: `V${i}`, source: 'preset'})),
             backend: 'webgpu' });
    const ready = await initPromise;
    expect(ready.numSpeakers).toBe(10);
    expect(ready.sampleRate).toBe(44100);
  });

  it('sends voiceList with all 10 preset sids and matching blobUrls', async () => {
    const engine = new TtsEngine();
    void engine.init('supertonic-3');
    const w = MockWorker.instances.at(-1)!;
    const initMsg = w.postMessage.mock.calls.find(c => c[0].type === 'init')![0];
    expect(initMsg.voiceList).toHaveLength(10);
    expect(initMsg.voiceList[0]).toMatchObject({
      sid: 0, name: 'Sarah', source: 'preset', gender: 'F', blobUrl: 'blob:f1',
    });
    expect(initMsg.voiceList[7]).toMatchObject({
      sid: 7, name: 'Robert', source: 'preset', gender: 'M', blobUrl: 'blob:m3',
    });
  });

  it('forwards voices array from ready message to caller', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    const w = MockWorker.instances.at(-1)!;
    const voices = [{sid: 0, name: 'Sarah', source: 'preset' as const, gender: 'F' as const}];
    w.emit({ type: 'ready', loadTimeMs: 50, numSpeakers: 1, sampleRate: 44100,
             voices, backend: 'wasm' });
    const ready = await initPromise;
    expect(ready.voices).toEqual(voices);
    expect(ready.backend).toBe('wasm');
  });

  it('revokes all blob URLs after ready', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    const w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 50, numSpeakers: 10, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await initPromise;
    // 16 model files (incl. 10 voice JSONs) all revoked
    expect((URL.revokeObjectURL as any).mock.calls.length).toBeGreaterThanOrEqual(16);
  });

  it('generate sends { text, sid, speed, lang }', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    const w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 50, numSpeakers: 10, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await initPromise;
    void engine.generate('hello', 7, 1.0, 'en');
    const genMsg = w.postMessage.mock.calls.find(c => c[0].type === 'generate')![0];
    expect(genMsg).toMatchObject({ type: 'generate', text: 'hello', sid: 7, speed: 1.0, lang: 'en' });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: FAIL — `TtsEngine.init('supertonic-3')` doesn't recognize the supertonic engine yet (will throw or send the wrong init message).

- [ ] **Step 3: Add the supertonic branch in `TtsEngine.init`**

Open `src/lib/local-inference/engine/TtsEngine.ts`. Locate the `init` method. After the existing `isPiperPlus` / `isEdgeTts` flag derivation, add:

```ts
    const isSupertonic = model.engine === 'supertonic';
```

In the `fileUrls` loading block, the supertonic path needs ALL model files (it does not use the sherpa-onnx `package-metadata.json` route). Update the conditional so the path looks like this:

```ts
    if (!isEdgeTts) {
      const manager = ModelManager.getInstance();
      if (!await manager.isModelReady(modelId)) {
        throw new Error(`TTS model "${modelId}" is not downloaded. Download it first via Model Management.`);
      }
      fileUrls = await manager.getModelBlobUrls(modelId);
      dataFileUrls = fileUrls;

      if (!isPiperPlus && !isSupertonic) {
        // Sherpa-onnx path: read Emscripten loadPackage metadata
        const metadataBlobUrl = fileUrls['package-metadata.json'];
        if (!metadataBlobUrl) {
          throw new Error(`Missing package-metadata.json for TTS model "${modelId}"`);
        }
        const metadataResponse = await fetch(metadataBlobUrl);
        dataPackageMetadata = await metadataResponse.json();
        dataFileUrls = {};
        for (const [name, url] of Object.entries(fileUrls)) {
          if (name !== 'package-metadata.json') {
            dataFileUrls[name] = url;
          }
        }
      }
    }
```

In the `Promise` block where `workerUrl` is selected, add the supertonic branch:

```ts
      const workerUrl = isEdgeTts
        ? './workers/edge-tts.worker.js'
        : isPiperPlus
          ? './workers/piper-plus-tts.worker.js'
          : isSupertonic
            ? './workers/supertonic-tts.worker.js'
            : './workers/sherpa-onnx-tts.worker.js';
      this.worker = new Worker(
        workerUrl,
        isSupertonic ? { type: 'module' } : undefined,
      );
```

- [ ] **Step 4: Build the voiceList and send supertonic init message**

At the bottom of the `Promise` block (where the engine-specific init message is posted), add a `else if (isSupertonic)` branch:

```ts
      } else if (isSupertonic) {
        const presets = model.ttsConfig?.presetVoices ?? [];
        const voiceList = presets.map(p => ({
          sid: p.sid,
          name: p.name,
          source: 'preset' as const,
          gender: p.gender,
          blobUrl: fileUrls[p.file],
        })).filter(v => v.blobUrl);

        this.worker.postMessage({
          type: 'init',
          fileUrls: dataFileUrls,
          voiceList,
          ortBaseUrl: new URL(ORT_BUNDLED_PATH, window.location.href).href,
          ttsConfig: model.ttsConfig || {},
        });
```

- [ ] **Step 5: Forward `voices` and `backend` from ready to the resolve payload**

In the same file, locate the `case 'ready':` block in `worker.onmessage`. Change the `resolve(...)` call to include the new fields:

```ts
            resolve({
              loadTimeMs: msg.loadTimeMs,
              numSpeakers: msg.numSpeakers,
              sampleRate: msg.sampleRate,
              voices: msg.voices,
              backend: msg.backend,
            });
```

Update the return type annotation on `init` accordingly:

```ts
async init(modelId: string): Promise<{
  loadTimeMs: number;
  numSpeakers: number;
  sampleRate: number;
  voices?: Array<{ sid: number; name: string; source: 'preset' | 'imported'; gender?: 'M' | 'F' }>;
  backend?: 'webgpu' | 'wasm';
}>
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 7: Run the full local-inference test suite to confirm no regressions**

Run: `npx vitest run src/lib/local-inference/`
Expected: existing TTS engine tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts \
        src/lib/local-inference/engine/TtsEngine.supertonic.test.ts
git commit -m "feat(tts): TtsEngine supertonic branch with voiceList init"
```

---

### Task 13: Settings reconciliation — clamp sid to available voices

**Files:**
- Modify: the consumer of `TtsEngine.init` (typically a hook in `src/stores/settingsStore.ts` or a service in `src/services/`)
- Create: a new test file colocated with the consumer

When `init` resolves with a `voices` array, any persisted `sid` that isn't in the array must be reset to `model.ttsConfig.defaultSid` and the user toasted. This task is small but easy to miss.

- [ ] **Step 1: Find the call site of `TtsEngine.init('supertonic-3')`**

Run: `grep -rn "ttsEngine.init\|TtsEngine.*init\b" src/ --include='*.ts' --include='*.tsx'`
Expected: a few hits (the main TTS service, a Zustand store, possibly a settings reload effect). Identify the one that actually calls `init` with the model id.

- [ ] **Step 2: Write the failing test**

Colocate `*.supertonicSid.test.ts` with the consumer. Template (adjust imports to match the real consumer file):

```ts
import { describe, expect, it, vi } from 'vitest';

// Adjust this import to the real consumer
import { applySupertonicReadyToSettings } from '<path/to/consumer>';

describe('applySupertonicReadyToSettings', () => {
  it('keeps the current sid when it is present in voices', () => {
    const result = applySupertonicReadyToSettings({
      currentSid: 7,
      defaultSid: 7,
      voices: [
        { sid: 0, name: 'Sarah',  source: 'preset' },
        { sid: 7, name: 'Robert', source: 'preset' },
      ],
    });
    expect(result.nextSid).toBe(7);
    expect(result.wasReset).toBe(false);
  });

  it('resets to defaultSid when current sid is not in voices', () => {
    const result = applySupertonicReadyToSettings({
      currentSid: 99,
      defaultSid: 7,
      voices: [{ sid: 7, name: 'Robert', source: 'preset' }],
    });
    expect(result.nextSid).toBe(7);
    expect(result.wasReset).toBe(true);
  });

  it('returns null nextSid when defaultSid is also missing (engine misconfigured)', () => {
    const result = applySupertonicReadyToSettings({
      currentSid: 5,
      defaultSid: 7,
      voices: [{ sid: 0, name: 'Sarah', source: 'preset' }],
    });
    expect(result.nextSid).toBeNull();
    expect(result.wasReset).toBe(true);
  });
});
```

- [ ] **Step 3: Add the pure function**

In the consumer file (or a small helper next to it), add:

```ts
export interface SupertonicReadyVoice {
  sid: number;
  name: string;
  source: 'preset' | 'imported';
  gender?: 'M' | 'F';
}

export interface SupertonicReadySettingsInput {
  currentSid: number;
  defaultSid: number;
  voices: SupertonicReadyVoice[];
}

export interface SupertonicReadySettingsResult {
  nextSid: number | null;
  wasReset: boolean;
}

export function applySupertonicReadyToSettings({
  currentSid,
  defaultSid,
  voices,
}: SupertonicReadySettingsInput): SupertonicReadySettingsResult {
  const sids = new Set(voices.map(v => v.sid));
  if (sids.has(currentSid)) return { nextSid: currentSid, wasReset: false };
  if (sids.has(defaultSid)) return { nextSid: defaultSid, wasReset: true };
  return { nextSid: null, wasReset: true };
}
```

- [ ] **Step 4: Wire the helper into the init handler**

In the same consumer file, after `await engine.init('supertonic-3')` resolves, call `applySupertonicReadyToSettings`. If `wasReset` is true, update the settings store and surface a toast (or push a log to `logStore`):

```ts
const ready = await engine.init('supertonic-3');
if (ready.voices) {
  const r = applySupertonicReadyToSettings({
    currentSid: settingsStore.getState().supertonicSid,
    defaultSid: model.ttsConfig.defaultSid,
    voices: ready.voices,
  });
  if (r.wasReset && r.nextSid !== null) {
    settingsStore.setState({ supertonicSid: r.nextSid });
    logStore.getState().push({
      level: 'info',
      message: 'Selected voice no longer available, switched to default.',
    });
  }
}
```

(Field names like `supertonicSid` may not exist yet — use whatever existing key the settings store has for the current TTS speaker id. If there is no per-engine breakdown, this is fine to leave as the shared `sid` field.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run '<path/to/consumer>.supertonicSid.test.ts'`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add '<path/to/consumer>' '<path/to/consumer>.supertonicSid.test.ts'
git commit -m "feat(tts): clamp persisted sid to available Supertonic voices"
```

---

### Task 14: ONNX magic-number download validation

**Files:**
- Modify: `src/lib/local-inference/ModelManager.ts:129-155` (the file-validation block in `downloadModel`)

The spec error matrix flags missing ONNX magic check as P1. The current code already checks WASM magic; this adds the same defense for `.onnx` files (protobuf VarInt for field 1 = `0x08`).

- [ ] **Step 1: Locate the validation block**

Run: `grep -n "Invalid WASM file" src/lib/local-inference/ModelManager.ts`
Expected: single hit near line 149. The surrounding block validates HTML / size / WASM magic / JSON.

- [ ] **Step 2: Add the ONNX check next to the WASM check**

Right after the existing WASM magic block (the one that ends with `missing WASM magic number`), insert:

```ts
        // 5. ONNX magic check — protobuf field 1 begins with 0x08
        if (ext === 'onnx' && header[0] !== 0x08) {
          throw new Error(
            `Invalid ONNX file ${file.filename}: missing protobuf prefix`,
          );
        }
```

- [ ] **Step 3: Smoke-test by manually corrupting a downloaded file**

Manually verify in DevTools → Application → IndexedDB that an existing ONNX file passes the new check. Optionally, write a quick unit test if the project already mocks `ModelManager.downloadModel` for tests (skip if not).

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/ModelManager.ts
git commit -m "feat(model-manager): validate ONNX magic on download"
```

---

### Task 15: PR-1 end-to-end manual QA

**Files:** none — manual verification only.

- [ ] **Step 1: Build the app and start dev server**

```bash
npm run build && npm run dev
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 2: First-run download in Chrome (WebGPU)**

Open the app in Chrome 113+. Navigate to Model Management → TTS. Verify Supertonic 3 appears first in the list with a green "Recommended" badge. Click Download. In DevTools → Network, confirm all 16 files come from `huggingface.co/Supertone/supertonic-3/resolve/main/...`. Wait for download to finish.

- [ ] **Step 3: Engine init smoke test**

Select Supertonic 3 as the TTS engine. In DevTools console, expect to see status messages: "Initializing Supertonic 3 (backend: webgpu)", then "Loaded onnx/duration_predictor.onnx (webgpu)" ×4, then "ready". Init should complete in 1–4 s on a modern laptop.

- [ ] **Step 4: Inference smoke test**

Switch UI / Target language to English. Trigger a TTS playback (use any source that exercises TTS, e.g. send a chat or load a translation). Expected: clear English speech in the default voice (Robert / M3). Latency should be 0.5–2 s on WebGPU, 3–8 s on WASM.

- [ ] **Step 5: Multi-language sanity**

Repeat Step 4 for: `ja` ("こんにちは、元気ですか"), `ko` ("안녕하세요"), `de` ("Guten Tag, wie geht es Ihnen"), `fr` ("Bonjour, comment allez-vous"). All should produce intelligible speech.

- [ ] **Step 6: Chinese fallback**

Set target language to `zh`. Trigger TTS. Expected: `status` message in DevTools console reading "Language 'zh' not supported; using language-agnostic mode (na)". Audio plays but quality will be visibly worse. **This is intended.** Verify matcha-zh-en is still available and produces correct Chinese.

- [ ] **Step 7: Voice switching**

Cycle through all 10 preset voices in the speaker dropdown. Each should produce audibly distinct output. The dropdown should show "Sarah", "Robert", etc. (named) — not "Speaker 0/1/2".

- [ ] **Step 8: WASM fallback (Firefox)**

Open the app in Firefox (no WebGPU). The init `status` should read "(backend: wasm)" — no WebGPU attempt. Init time 5–15 s. Inference 3–10 s per short sentence.

- [ ] **Step 9: Regression — other TTS still works**

Switch back to piper-en (download if needed), play TTS. Confirm it works unchanged. Switch to matcha-zh-en, play Chinese TTS. Confirm it works unchanged.

- [ ] **Step 10: Commit a `CHANGELOG.md` entry and open PR**

```bash
# Add a CHANGELOG entry under "## Unreleased"
git add CHANGELOG.md
git commit -m "docs(changelog): note Supertonic 3 phase-1 integration"
gh pr create --title "feat(tts): add Supertonic 3 local TTS engine with 10 preset voices" \
  --body "$(cat <<'EOF'
## Summary
- Adds Supertonic 3 (Supertone Inc.) as a new local-inference TTS engine, marked recommended.
- 31 languages from a single ~383 MiB ONNX bundle.
- WebGPU primary, automatic WASM fallback.
- Ships 10 preset voices (F1–F5, M1–M5). Phase 2 (user-imported voices) follows in a separate PR.

## Spec
[2026-05-21-supertonic-3-integration-design.md](docs/superpowers/specs/2026-05-21-supertonic-3-integration-design.md)

## Test plan
- [x] Unit tests pass: \`npx vitest run src/lib/local-inference/\`
- [ ] Manual QA per the design doc §Testing — see PR comments
- [ ] OpenRAIL-M legal review attached

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Do not run `gh pr create` automatically — require explicit user approval per the project's publish-actions consent rule.)

---

## Phase 2 PR — Imported voices

PR scope: add a `voice_styles` IndexedDB store, build a `voiceStorage` CRUD module with validation, merge imported voices into the engine's voiceList at init, expose a `reloadVoices()` method, and ship a `VoiceLibrarySection` UI component for import/rename/delete.

PR title (target): `feat(tts): import custom Supertonic voices from voice_style JSON`

### Task 16: Bump `modelStorage` DB version and add `voice_styles` object store

**Files:**
- Modify: `src/lib/local-inference/modelStorage.ts`

- [ ] **Step 1: Locate the DB version constant**

Run: `grep -n "openDB\|DB_VERSION\|'sokuji-models'\|sokuji-models" src/lib/local-inference/modelStorage.ts`
Expected: a `const DB_VERSION = N` and an `openDB('sokuji-models', N, { upgrade })` call.

- [ ] **Step 2: Bump the version and add the upgrade branch**

Increment `DB_VERSION` by 1. In the `upgrade(db, oldVersion, newVersion)` callback, add a branch that creates the new store when migrating past the previous version. Example pattern (adapt to existing code):

```ts
const DB_VERSION = <PREVIOUS + 1>;

// ...inside openDB upgrade:
upgrade(db, oldVersion) {
  // ... existing branches for older versions ...
  if (oldVersion < <PREVIOUS + 1>) {
    const store = db.createObjectStore('voice_styles', {
      keyPath: 'id',
      autoIncrement: true,
    });
    store.createIndex('engine', 'engine', { unique: false });
  }
}
```

- [ ] **Step 3: Smoke-test the migration**

Run: `npx vitest run src/lib/local-inference/`
Expected: existing modelStorage tests still pass (they reset the DB between runs via `fake-indexeddb`). If any test hardcodes the DB version, update it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/modelStorage.ts
git commit -m "feat(tts): add voice_styles IndexedDB store"
```

---

### Task 17: `voiceStorage` CRUD module (TDD)

**Files:**
- Create: `src/lib/local-inference/voiceStorage.ts`
- Create: `src/lib/local-inference/voiceStorage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  addVoice, listVoices, getVoice, renameVoice, deleteVoice, resetVoiceStorageForTesting,
} from './voiceStorage';

function makeFile(name: string, contents: object): File {
  return new File([JSON.stringify(contents)], name, { type: 'application/json' });
}

const VALID_JSON = {
  style_ttl: { data: [[[0.1, 0.2]]], dims: [1, 1, 2] },
  style_dp:  { data: [[[0.3, 0.4]]], dims: [1, 1, 2] },
};

describe('voiceStorage', () => {
  beforeEach(async () => { await resetVoiceStorageForTesting(); });
  afterEach(async () => { await resetVoiceStorageForTesting(); });

  it('addVoice persists a record with the expected fields', async () => {
    const file = makeFile('my-voice.json', VALID_JSON);
    const v = await addVoice('supertonic-3', 'My Voice', file);
    expect(v.id).toBeGreaterThan(0);
    expect(v.engine).toBe('supertonic-3');
    expect(v.name).toBe('My Voice');
    expect(v.jsonData).toBeInstanceOf(Blob);
    expect(typeof v.importedAt).toBe('number');
  });

  it('listVoices returns all voices for the given engine', async () => {
    await addVoice('supertonic-3', 'A', makeFile('a.json', VALID_JSON));
    await addVoice('supertonic-3', 'B', makeFile('b.json', VALID_JSON));
    const list = await listVoices('supertonic-3');
    expect(list).toHaveLength(2);
  });

  it('addVoice with a duplicate name appends "(2)"', async () => {
    await addVoice('supertonic-3', 'Sarah', makeFile('a.json', VALID_JSON));
    const v2 = await addVoice('supertonic-3', 'Sarah', makeFile('b.json', VALID_JSON));
    expect(v2.name).toBe('Sarah (2)');
    const v3 = await addVoice('supertonic-3', 'Sarah', makeFile('c.json', VALID_JSON));
    expect(v3.name).toBe('Sarah (3)');
  });

  it('renameVoice updates the name without changing the id', async () => {
    const v = await addVoice('supertonic-3', 'Old', makeFile('a.json', VALID_JSON));
    await renameVoice(v.id, 'New');
    const updated = await getVoice(v.id);
    expect(updated!.name).toBe('New');
    expect(updated!.id).toBe(v.id);
  });

  it('deleteVoice removes the record and does not shift other ids', async () => {
    const a = await addVoice('supertonic-3', 'A', makeFile('a.json', VALID_JSON));
    const b = await addVoice('supertonic-3', 'B', makeFile('b.json', VALID_JSON));
    await deleteVoice(a.id);
    expect(await getVoice(a.id)).toBeUndefined();
    expect(await getVoice(b.id)).toBeDefined();
    const c = await addVoice('supertonic-3', 'C', makeFile('c.json', VALID_JSON));
    expect(c.id).toBeGreaterThan(b.id);  // autoincrement does not reuse a.id
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/voiceStorage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module (without validation yet — that's Task 18)**

```ts
import { openDB, type IDBPDatabase } from 'idb';

export interface StoredVoice {
  id: number;
  engine: 'supertonic-3';
  name: string;
  jsonData: Blob;
  importedAt: number;
}

type Engine = StoredVoice['engine'];

const DB_NAME = 'sokuji-models';
const STORE = 'voice_styles';

async function db(): Promise<IDBPDatabase> {
  // Version + upgrade come from modelStorage's openDB call; we just open it
  // without an upgrade callback so we always read the latest schema.
  return openDB(DB_NAME);
}

export async function listVoices(engine: Engine): Promise<StoredVoice[]> {
  const conn = await db();
  return await conn.getAllFromIndex(STORE, 'engine', engine);
}

export async function getVoice(id: number): Promise<StoredVoice | undefined> {
  const conn = await db();
  return await conn.get(STORE, id);
}

export async function addVoice(
  engine: Engine, name: string, file: File,
): Promise<StoredVoice> {
  const existing = await listVoices(engine);
  const finalName = uniquifyName(name, existing.map(v => v.name));
  const jsonData = new Blob([await file.arrayBuffer()], { type: 'application/json' });
  const record: Omit<StoredVoice, 'id'> = {
    engine, name: finalName, jsonData, importedAt: Date.now(),
  };
  const conn = await db();
  const id = await conn.add(STORE, record) as number;
  return { id, ...record };
}

export async function renameVoice(id: number, name: string): Promise<void> {
  const conn = await db();
  const cur = await conn.get(STORE, id);
  if (!cur) throw new Error(`Voice ${id} not found`);
  await conn.put(STORE, { ...cur, name });
}

export async function deleteVoice(id: number): Promise<void> {
  const conn = await db();
  await conn.delete(STORE, id);
}

export async function resetVoiceStorageForTesting(): Promise<void> {
  const conn = await db();
  await conn.clear(STORE);
}

function uniquifyName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/voiceStorage.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/voiceStorage.ts src/lib/local-inference/voiceStorage.test.ts
git commit -m "feat(tts): voiceStorage CRUD for imported Supertonic voices"
```

---

### Task 18: `voiceStorage` import validation (TDD)

**Files:**
- Modify: `src/lib/local-inference/voiceStorage.ts`
- Modify: `src/lib/local-inference/voiceStorage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `voiceStorage.test.ts`:

```ts
import { VoiceImportError } from './voiceStorage';

describe('voiceStorage validation', () => {
  beforeEach(async () => { await resetVoiceStorageForTesting(); });

  it('rejects files larger than 1 MB', async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.json', { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', big))
      .rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects non-JSON content', async () => {
    const f = new File(['this is not json'], 'bad.json', { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'not_json' });
  });

  it('rejects JSON missing style_ttl', async () => {
    const f = new File([JSON.stringify({ style_dp: { data: [], dims: [] } })], 'x.json',
                       { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'missing_field' });
  });

  it('rejects JSON missing style_dp', async () => {
    const f = new File([JSON.stringify({ style_ttl: { data: [], dims: [] } })], 'x.json',
                       { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'missing_field' });
  });

  it('rejects JSON without dims arrays', async () => {
    const f = new File([JSON.stringify({
      style_ttl: { data: [] }, style_dp: { data: [] },
    })], 'x.json', { type: 'application/json' });
    await expect(addVoice('supertonic-3', 'X', f))
      .rejects.toMatchObject({ code: 'invalid_shape' });
  });

  it('VoiceImportError is a class with a code', async () => {
    try {
      const f = new File(['nope'], 'x.json', { type: 'application/json' });
      await addVoice('supertonic-3', 'X', f);
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceImportError);
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/voiceStorage.test.ts`
Expected: validation tests FAIL — current `addVoice` accepts anything.

- [ ] **Step 3: Add `VoiceImportError` and `validateVoiceJson` to `voiceStorage.ts`**

At the top of `voiceStorage.ts` add:

```ts
export type VoiceImportErrorCode =
  | 'too_large' | 'not_json' | 'missing_field' | 'invalid_shape';

export class VoiceImportError extends Error {
  constructor(public code: VoiceImportErrorCode, message: string) {
    super(message);
    this.name = 'VoiceImportError';
  }
}

const MAX_VOICE_BYTES = 1 * 1024 * 1024;

async function validateVoiceFile(file: File): Promise<void> {
  if (file.size > MAX_VOICE_BYTES) {
    throw new VoiceImportError('too_large', `Voice file too large (${file.size} bytes, max ${MAX_VOICE_BYTES})`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new VoiceImportError('not_json', 'Not a valid JSON file');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new VoiceImportError('not_json', 'JSON root must be an object');
  }
  if (!parsed.style_ttl || !parsed.style_dp) {
    throw new VoiceImportError('missing_field', 'Missing style_ttl or style_dp (not a Supertonic voice file)');
  }
  if (!Array.isArray(parsed.style_ttl.dims) || !Array.isArray(parsed.style_dp.dims)) {
    throw new VoiceImportError('invalid_shape', 'style_ttl.dims and style_dp.dims must be arrays');
  }
}
```

- [ ] **Step 4: Call `validateVoiceFile` from `addVoice` BEFORE the blob is built**

Modify `addVoice`:

```ts
export async function addVoice(
  engine: Engine, name: string, file: File,
): Promise<StoredVoice> {
  await validateVoiceFile(file);
  const existing = await listVoices(engine);
  // ... rest unchanged
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/voiceStorage.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/voiceStorage.ts src/lib/local-inference/voiceStorage.test.ts
git commit -m "feat(tts): voiceStorage validates voice_style JSON on import"
```

---

### Task 19: TtsEngine — merge imported voices into voiceList at init

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`
- Modify: `src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `TtsEngine.supertonic.test.ts`:

```ts
import * as voiceStorage from '../voiceStorage';

describe('TtsEngine — supertonic with imported voices', () => {
  beforeEach(() => {
    // (same beforeEach setup as the existing supertonic describe block)
    MockWorker.instances = [];
    (globalThis as any).Worker = MockWorker;
    URL.createObjectURL = vi.fn((_blob: Blob) => `blob:i-${Math.random()}`);
    URL.revokeObjectURL = vi.fn();

    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({
      // Same 16 blob URLs as the other supertonic test
      'onnx/duration_predictor.onnx': 'blob:dp',
      'onnx/text_encoder.onnx': 'blob:te',
      'onnx/vector_estimator.onnx': 'blob:ve',
      'onnx/vocoder.onnx': 'blob:vc',
      'onnx/tts.json': 'blob:tts',
      'onnx/unicode_indexer.json': 'blob:idx',
      'voice_styles/F1.json': 'blob:f1',
      'voice_styles/F2.json': 'blob:f2',
      'voice_styles/F3.json': 'blob:f3',
      'voice_styles/F4.json': 'blob:f4',
      'voice_styles/F5.json': 'blob:f5',
      'voice_styles/M1.json': 'blob:m1',
      'voice_styles/M2.json': 'blob:m2',
      'voice_styles/M3.json': 'blob:m3',
      'voice_styles/M4.json': 'blob:m4',
      'voice_styles/M5.json': 'blob:m5',
    });

    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([
      { id: 1, engine: 'supertonic-3', name: 'Imported A',
        jsonData: new Blob(['{}']), importedAt: 1 },
      { id: 5, engine: 'supertonic-3', name: 'Imported B',
        jsonData: new Blob(['{}']), importedAt: 2 },
    ]);
  });

  it('merges imported voices with presets, sid = dbKey + 10', async () => {
    const engine = new TtsEngine();
    void engine.init('supertonic-3');
    const w = MockWorker.instances.at(-1)!;
    const initMsg = w.postMessage.mock.calls.find(c => c[0].type === 'init')![0];
    expect(initMsg.voiceList).toHaveLength(12);
    expect(initMsg.voiceList.find((v: any) => v.sid === 11)).toMatchObject({
      sid: 11, name: 'Imported A', source: 'imported',
    });
    expect(initMsg.voiceList.find((v: any) => v.sid === 15)).toMatchObject({
      sid: 15, name: 'Imported B', source: 'imported',
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: imported-voice test FAILS — current implementation only sends 10 presets.

- [ ] **Step 3: Update the supertonic branch in `TtsEngine.init`**

In `TtsEngine.ts`, locate the `isSupertonic` branch that builds `voiceList`. Replace it with:

```ts
      } else if (isSupertonic) {
        const presets = model.ttsConfig?.presetVoices ?? [];
        const presetEntries = presets.map(p => ({
          sid: p.sid,
          name: p.name,
          source: 'preset' as const,
          gender: p.gender,
          blobUrl: fileUrls[p.file],
        })).filter(v => v.blobUrl);

        // Add imported voices from IndexedDB. sid = dbKey + 10.
        const { listVoices } = await import('../voiceStorage');
        const imported = await listVoices('supertonic-3');
        const importedEntries = imported.map(v => ({
          sid: v.id + 10,
          name: v.name,
          source: 'imported' as const,
          gender: undefined,
          blobUrl: URL.createObjectURL(v.jsonData),
        }));

        const voiceList = [...presetEntries, ...importedEntries];

        // Track imported blob URLs separately for revocation alongside fileUrls
        for (const e of importedEntries) {
          fileUrls[`__imported_${e.sid}`] = e.blobUrl;
        }

        this.worker.postMessage({
          type: 'init',
          fileUrls: dataFileUrls,
          voiceList,
          ortBaseUrl: new URL(ORT_BUNDLED_PATH, window.location.href).href,
          ttsConfig: model.ttsConfig || {},
        });
```

The `__imported_${sid}` keys are a small trick to make sure `manager.revokeBlobUrls(fileUrls)` (called when `ready` arrives) also frees the imported voice blob URLs without duplicating the revocation logic.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: all supertonic tests now pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts \
        src/lib/local-inference/engine/TtsEngine.supertonic.test.ts
git commit -m "feat(tts): merge imported voices into Supertonic voiceList"
```

---

### Task 20: `TtsEngine.reloadVoices()` (TDD)

**Files:**
- Modify: `src/lib/local-inference/engine/TtsEngine.ts`
- Modify: `src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`

- [ ] **Step 1: Add the failing test**

Append to the imported-voices describe block:

```ts
  it('reloadVoices disposes + re-inits the worker and picks up new voices', async () => {
    const engine = new TtsEngine();
    const initPromise = engine.init('supertonic-3');
    let w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 1, numSpeakers: 12, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await initPromise;
    expect(MockWorker.instances).toHaveLength(1);

    // Simulate a new imported voice
    (voiceStorage.listVoices as any).mockResolvedValue([
      { id: 1, engine: 'supertonic-3', name: 'Imported A',
        jsonData: new Blob(['{}']), importedAt: 1 },
      { id: 5, engine: 'supertonic-3', name: 'Imported B',
        jsonData: new Blob(['{}']), importedAt: 2 },
      { id: 9, engine: 'supertonic-3', name: 'Newly Added',
        jsonData: new Blob(['{}']), importedAt: 3 },
    ]);

    const reloadPromise = engine.reloadVoices();
    expect(MockWorker.instances).toHaveLength(2);  // new worker spawned
    w = MockWorker.instances.at(-1)!;
    w.emit({ type: 'ready', loadTimeMs: 1, numSpeakers: 13, sampleRate: 44100,
             voices: [], backend: 'wasm' });
    await reloadPromise;
    const initMsg = w.postMessage.mock.calls.find(c => c[0].type === 'init')![0];
    expect(initMsg.voiceList).toHaveLength(13);
    expect(initMsg.voiceList.find((v: any) => v.sid === 19)?.name).toBe('Newly Added');
  });

  it('reloadVoices is a no-op when no supertonic model is active', async () => {
    const engine = new TtsEngine();
    // Engine never initialized, no current model
    await engine.reloadVoices();
    expect(MockWorker.instances).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: `reloadVoices` tests FAIL (method does not exist).

- [ ] **Step 3: Add the method to `TtsEngine`**

Append to the `TtsEngine` class (any public method position is fine):

```ts
  /**
   * Dispose the current Supertonic worker and re-init with a fresh voice list
   * (presets + imported voices from IndexedDB). No-op for non-Supertonic engines.
   */
  async reloadVoices(): Promise<void> {
    if (!this.currentModel || this.currentModel.engine !== 'supertonic') {
      return;
    }
    const modelId = this.currentModel.id;
    this.dispose();
    await this.init(modelId);
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/local-inference/engine/TtsEngine.supertonic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/engine/TtsEngine.ts \
        src/lib/local-inference/engine/TtsEngine.supertonic.test.ts
git commit -m "feat(tts): TtsEngine.reloadVoices for Supertonic"
```

---

### Task 21: `VoiceLibrarySection` skeleton + preset rendering

**Files:**
- Create: `src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx`
- Create: `src/components/ConfigPanel/LocalInference/VoiceLibrarySection.scss`

- [ ] **Step 1: Create the component skeleton**

```tsx
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';
import './VoiceLibrarySection.scss';

interface VoiceLibrarySectionProps {
  /** All voices currently reported by the engine (presets + imported). */
  voices: Array<{
    sid: number;
    name: string;
    source: 'preset' | 'imported';
    gender?: 'M' | 'F';
  }>;
  selectedSid: number;
  onSelect: (sid: number) => void;
}

export function VoiceLibrarySection({
  voices, selectedSid, onSelect,
}: VoiceLibrarySectionProps) {
  const { t } = useTranslation();
  const entry = getManifestEntry('supertonic-3');

  const presets = useMemo(
    () => voices.filter(v => v.source === 'preset').sort((a, b) => a.sid - b.sid),
    [voices],
  );
  const imported = useMemo(
    () => voices.filter(v => v.source === 'imported').sort((a, b) => a.sid - b.sid),
    [voices],
  );

  if (!entry) return null;

  return (
    <div className="voice-library-section">
      <div className="voice-library-info">
        {t('voiceLibrary.customVoiceCta', 'Need a custom voice?')}{' '}
        <a
          href="https://supertonic.supertone.ai/voice-builder"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('voiceLibrary.openVoiceBuilder', 'Create one at Voice Builder')}
          <ExternalLink size={14} />
        </a>
        <div className="voice-library-info-sub">
          {t('voiceLibrary.voiceBuilderDisclaimer',
            'Paid Supertone service. Sokuji is not involved in that transaction.')}
        </div>
      </div>

      <h4>{t('voiceLibrary.presets', 'Presets')}</h4>
      <ul className="voice-list">
        {presets.map(v => (
          <li
            key={v.sid}
            className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
            onClick={() => onSelect(v.sid)}
          >
            <span className="voice-name">{v.name}</span>
            {v.gender && <span className="voice-meta">({v.gender})</span>}
          </li>
        ))}
      </ul>

      <h4>{t('voiceLibrary.myVoices', 'My Voices')}</h4>
      {imported.length === 0 ? (
        <div className="voice-library-empty">
          {t('voiceLibrary.emptyHint',
            'Drop a voice_style.json here, or click + to import.')}
        </div>
      ) : (
        <ul className="voice-list">
          {imported.map(v => (
            <li
              key={v.sid}
              className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
              onClick={() => onSelect(v.sid)}
            >
              <span className="voice-name">{v.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the SCSS file**

```scss
.voice-library-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;

  h4 {
    margin: 8px 0 4px;
    font-size: 13px;
    font-weight: 500;
    color: #b0b0b0;
  }
}

.voice-library-info {
  padding: 10px;
  background: rgba(16, 163, 127, 0.08);
  border: 1px solid rgba(16, 163, 127, 0.25);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.4;

  a {
    color: #10a37f;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    &:hover { text-decoration: underline; }
  }
}

.voice-library-info-sub {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.7;
}

.voice-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.voice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #d0d0d0;

  &:hover { background: rgba(255, 255, 255, 0.05); }
  &.selected {
    background: rgba(16, 163, 127, 0.18);
    color: #ffffff;
  }
}

.voice-name { flex: 1; }
.voice-meta {
  font-size: 11px;
  color: #888;
}

.voice-library-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: #808080;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 4px;
}
```

- [ ] **Step 3: Smoke-test in the dev server**

Run: `npm run dev`. Render the component in a Storybook-like sandbox or temporarily import it into the active config panel with fixed props. Verify it lays out correctly: info banner, presets list, empty "My Voices" hint.

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx \
        src/components/ConfigPanel/LocalInference/VoiceLibrarySection.scss
git commit -m "feat(ui): VoiceLibrarySection skeleton with presets rendering"
```

---

### Task 22: `VoiceLibrarySection` — import (file picker + drag/drop)

**Files:**
- Modify: `src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx`

- [ ] **Step 1: Add the import action and drag/drop handlers**

Add an `onImport` prop and update the component to wire it up. Update the props interface and the render tree:

```tsx
import { Plus, Upload } from 'lucide-react';

interface VoiceLibrarySectionProps {
  voices: Array<{
    sid: number;
    name: string;
    source: 'preset' | 'imported';
    gender?: 'M' | 'F';
  }>;
  selectedSid: number;
  onSelect: (sid: number) => void;
  /** Called after a valid voice file has been picked. Implementation
   *  in the parent: calls `voiceStorage.addVoice` and `engine.reloadVoices`. */
  onImport: (file: File) => Promise<void>;
  /** True while a worker reload is in flight. */
  isReloading: boolean;
}
```

Add state and handlers inside the component body:

```tsx
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await onImport(file);
      } catch (err) {
        // Toast is the parent's responsibility — VoiceImportError surfaces there.
        console.warn('Voice import failed:', err);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onImport]);

  const onDrop: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  const onDragOver: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave: React.DragEventHandler = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };
```

Update the "My Voices" header to include the import button, and wrap the empty-state in a droppable area:

```tsx
      <div className="voice-library-my-header">
        <h4>{t('voiceLibrary.myVoices', 'My Voices')}</h4>
        <button
          type="button"
          className="voice-import-btn"
          disabled={isReloading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={14} />
          {t('voiceLibrary.importVoice', 'Import voice…')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          multiple
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      <div
        className={`voice-dropzone${isDragging ? ' dragging' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {imported.length === 0 ? (
          <div className="voice-library-empty">
            <Upload size={16} />
            {t('voiceLibrary.emptyHint',
              'Drop a voice_style.json here, or click Import.')}
          </div>
        ) : (
          <ul className="voice-list">
            {imported.map(v => (
              <li
                key={v.sid}
                className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
                onClick={() => onSelect(v.sid)}
              >
                <span className="voice-name">{v.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 2: Update the SCSS for the new elements**

Append to `VoiceLibrarySection.scss`:

```scss
.voice-library-my-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  h4 { margin: 0; }
}

.voice-import-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  color: #ffffff;
  background: #10a37f;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0d8c6c; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.voice-dropzone {
  transition: background 0.15s ease;
  &.dragging {
    background: rgba(16, 163, 127, 0.12);
    border: 1px dashed #10a37f;
    border-radius: 4px;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx \
        src/components/ConfigPanel/LocalInference/VoiceLibrarySection.scss
git commit -m "feat(ui): VoiceLibrarySection import via file picker + drag/drop"
```

---

### Task 23: `VoiceLibrarySection` — rename + delete

**Files:**
- Modify: `src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx`
- Modify: `src/components/ConfigPanel/LocalInference/VoiceLibrarySection.scss`

- [ ] **Step 1: Add rename and delete props**

```tsx
interface VoiceLibrarySectionProps {
  // ... existing fields ...
  onRename: (sid: number, newName: string) => Promise<void>;
  onDelete: (sid: number) => Promise<void>;
}
```

- [ ] **Step 2: Add per-row rename/delete UI for imported voices**

Add a `useState` for the row currently being edited and replace the imported-row JSX:

```tsx
  const [editingSid, setEditingSid] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState('');

  const startEdit = (sid: number, currentName: string) => {
    setEditingSid(sid);
    setEditName(currentName);
  };

  const commitEdit = async (sid: number) => {
    const name = editName.trim();
    setEditingSid(null);
    if (name && name !== imported.find(v => v.sid === sid)?.name) {
      try { await onRename(sid, name); }
      catch (err) { console.warn('Rename failed:', err); }
    }
  };

  const confirmAndDelete = async (sid: number, name: string) => {
    if (!window.confirm(
      t('voiceLibrary.deleteConfirm', `Delete voice "${name}"?`).replace('{name}', name)
    )) return;
    try { await onDelete(sid); }
    catch (err) { console.warn('Delete failed:', err); }
  };
```

Replace each imported `<li>` row body:

```tsx
              <li
                key={v.sid}
                className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
              >
                {editingSid === v.sid ? (
                  <input
                    autoFocus
                    className="voice-name-edit"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => void commitEdit(v.sid)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitEdit(v.sid);
                      if (e.key === 'Escape') setEditingSid(null);
                    }}
                  />
                ) : (
                  <span
                    className="voice-name"
                    onClick={() => onSelect(v.sid)}
                  >
                    {v.name}
                  </span>
                )}
                <button
                  type="button"
                  className="voice-row-btn"
                  disabled={isReloading || editingSid === v.sid}
                  onClick={() => startEdit(v.sid, v.name)}
                >
                  {t('voiceLibrary.rename', 'Rename')}
                </button>
                <button
                  type="button"
                  className="voice-row-btn voice-row-btn-danger"
                  disabled={isReloading}
                  onClick={() => void confirmAndDelete(v.sid, v.name)}
                >
                  {t('voiceLibrary.delete', 'Delete')}
                </button>
              </li>
```

- [ ] **Step 3: Add styles for buttons and inline edit**

Append to `VoiceLibrarySection.scss`:

```scss
.voice-row {
  .voice-row-btn {
    visibility: hidden;
    margin-left: 6px;
    padding: 2px 8px;
    font-size: 11px;
    background: transparent;
    color: #b0b0b0;
    border: 1px solid #555;
    border-radius: 3px;
    cursor: pointer;

    &:hover:not(:disabled) { color: #fff; border-color: #888; }
    &:disabled { opacity: 0.4; cursor: not-allowed; }

    &.voice-row-btn-danger {
      &:hover:not(:disabled) { color: #fff; background: #e74c3c; border-color: #e74c3c; }
    }
  }

  &:hover .voice-row-btn { visibility: visible; }
}

.voice-name-edit {
  flex: 1;
  padding: 2px 6px;
  font-size: 13px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid #10a37f;
  border-radius: 3px;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx \
        src/components/ConfigPanel/LocalInference/VoiceLibrarySection.scss
git commit -m "feat(ui): VoiceLibrarySection rename + delete imported voices"
```

---

### Task 24: Wire `VoiceLibrarySection` into the ConfigPanel parent

**Files:**
- Modify: the parent component that hosts `ModelManagementSection` (search for it)

- [ ] **Step 1: Find the parent**

Run: `grep -rn "ModelManagementSection" src/ --include='*.tsx'`
Expected: one or two import sites. Identify the parent that controls the active TTS engine state.

- [ ] **Step 2: Add state for voices + reloading**

In the parent, alongside the existing TTS state, add (or hook into existing modelStore state):

```tsx
const [voices, setVoices] = React.useState<Array<{
  sid: number; name: string; source: 'preset' | 'imported'; gender?: 'M' | 'F';
}>>([]);
const [isReloading, setIsReloading] = React.useState(false);
```

Wire `voices` to the result of `engine.init('supertonic-3')` — i.e. wherever the existing code captures `numSpeakers`, also capture `ready.voices` (defaulting to `[]`) and store it in this state. If you have a Zustand store for engine state, add a `voices` field there and select it here instead of useState.

- [ ] **Step 3: Implement the import handler**

```tsx
import { addVoice, renameVoice, deleteVoice, VoiceImportError } from '<path>/voiceStorage';
import { ttsEngine } from '<path>/ttsEngineSingleton';  // adjust to actual singleton
import { useToast } from '<path>/toast';  // adjust to your toast hook

const toast = useToast();

const onImport = async (file: File) => {
  try {
    const fallbackName = file.name.replace(/\.json$/i, '');
    await addVoice('supertonic-3', fallbackName, file);
    setIsReloading(true);
    try {
      await ttsEngine.reloadVoices();
    } finally {
      setIsReloading(false);
    }
  } catch (err) {
    if (err instanceof VoiceImportError) {
      toast.error(`Voice import failed: ${err.message}`);
    } else {
      toast.error('Voice import failed. See console for details.');
      console.error(err);
    }
    throw err;
  }
};

const onRename = async (sid: number, newName: string) => {
  const dbKey = sid - 10;
  if (dbKey < 0) return;  // refuse to rename presets
  await renameVoice(dbKey, newName);
  // Cheap path: refresh the voices state from settingsStore-derived voices
  // by triggering reloadVoices. Tensors don't change, only the label, so this
  // costs a worker restart we choose to accept for code simplicity.
  setIsReloading(true);
  try { await ttsEngine.reloadVoices(); }
  finally { setIsReloading(false); }
};

const onDelete = async (sid: number) => {
  const dbKey = sid - 10;
  if (dbKey < 0) return;
  await deleteVoice(dbKey);
  setIsReloading(true);
  try { await ttsEngine.reloadVoices(); }
  finally { setIsReloading(false); }
};
```

- [ ] **Step 4: Render `VoiceLibrarySection` only when supertonic is active**

```tsx
{activeTtsEngine === 'supertonic' && (
  <VoiceLibrarySection
    voices={voices}
    selectedSid={selectedSid}
    onSelect={setSelectedSid}
    onImport={onImport}
    onRename={onRename}
    onDelete={onDelete}
    isReloading={isReloading}
  />
)}
```

Adjust `activeTtsEngine`, `selectedSid`, and `setSelectedSid` to the names used in the actual file.

- [ ] **Step 5: Verify in dev server**

Run: `npm run dev`. With Supertonic 3 selected:
- The Voice Library section appears.
- Import a valid voice JSON → "Reloading voices…" indicator shows briefly → the new voice appears in My Voices.
- Try importing a bad JSON → toast error, no row added.
- Rename inline → row label updates after a brief reload spinner.
- Delete → confirm dialog → row disappears.
- Select another engine (e.g. piper-en) → Voice Library section disappears.

- [ ] **Step 6: Commit**

```bash
git add '<parent component path>'
git commit -m "feat(ui): wire VoiceLibrarySection import/rename/delete handlers"
```

---

### Task 25: Phase 2 manual QA + PR-2 commit gate

**Files:** none — manual verification.

Repeat the relevant Phase 1 checks (especially the "Engine swap" and "memory stability" checks from the spec's QA section) and add Phase 2 coverage:

- [ ] **Step 1: Voice import happy path**

Acquire a real Voice Builder output JSON (or fabricate a structurally valid stub with realistic tensor shapes for smoke). Drop it on the dropzone. Expected: `Reloading voices…` indicator, then new voice appears with the chosen name and is selectable.

- [ ] **Step 2: Voice import error cases**

- Drop a non-JSON file → toast "Not a valid JSON file"
- Drop a JSON missing `style_ttl` → toast about missing field
- Drop a 5 MB JSON → toast "too large"
- Drop a JSON with same name as existing → name gets `(2)` suffix automatically

- [ ] **Step 3: Rename + delete**

- Rename an imported voice → label updates after brief reload spinner
- Delete the currently selected imported voice → confirm modal → on confirm, voice disappears AND speaker dropdown switches back to the default voice (Robert)

- [ ] **Step 4: Stable sids across restarts**

Import voices A, B, C. Sids should be 11, 12, 13. Delete B. Refresh the page. Confirm A is still sid 11 and C is still sid 13 (no shifting). Import D. D should get sid 14 (autoincrement does not reuse B's id 12).

- [ ] **Step 5: Regression with persisted selection**

Select an imported voice. Refresh the page. Confirm the same voice stays selected (sid in settingsStore is still valid). Delete that voice externally (e.g. via DevTools → IndexedDB → delete the row). Reload — the engine should detect the missing sid via the reconciliation logic and fall back to Robert.

- [ ] **Step 6: Memory leak smoke**

In DevTools Memory tab, snapshot heap. Generate TTS 20 times. Snapshot again. Heap should not grow by more than a few MB. If it does, suspect un-revoked blob URLs.

- [ ] **Step 7: Commit changelog and open PR**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Supertonic 3 phase-2 (imported voices)"
gh pr create --title "feat(tts): import custom Supertonic voices from voice_style JSON" \
  --body "$(cat <<'EOF'
## Summary
- Adds an IndexedDB-backed voice library so users can import paid Voice Builder JSONs.
- New \`voiceStorage\` module + \`voice_styles\` object store.
- \`VoiceLibrarySection\` UI for import (file picker + drag/drop), rename, delete.
- \`TtsEngine.reloadVoices()\` rebuilds the voice list and restarts the worker.

## Depends on
PR for Phase 1 (preset voices) — must merge first.

## Spec
[2026-05-21-supertonic-3-integration-design.md](docs/superpowers/specs/2026-05-21-supertonic-3-integration-design.md)

## Test plan
- [x] Unit tests pass: \`npx vitest run src/lib/local-inference/\`
- [ ] Manual QA per the design doc §Testing
- [ ] OpenRAIL-M legal review still on file

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Do not run `gh pr create` automatically — require explicit user approval per the project's publish-actions consent rule.)

---

## Self-Review Checklist

The following items from the spec all have a corresponding task:

- ✅ ORT bundling change (Task 1)
- ✅ `recommended` field (Tasks 2, 6)
- ✅ Supertonic 3 manifest entry (Task 5)
- ✅ sid mapping (Task 3)
- ✅ `TtsReadyMessage.voices` / `backend` (Task 4)
- ✅ Worker scaffold + ORT load + WebGPU/WASM fallback (Tasks 7, 8)
- ✅ Voice tensor loading (Task 9)
- ✅ UnicodeProcessor port (Task 10)
- ✅ 4-stage generate pipeline (Task 11)
- ✅ TtsEngine supertonic branch (Task 12)
- ✅ Settings reconciliation (Task 13)
- ✅ ModelManagementSection Recommended badge (Task 6)
- ✅ ONNX magic-number validation (Task 14)
- ✅ `voice_styles` IndexedDB store (Task 16)
- ✅ voiceStorage CRUD (Task 17)
- ✅ voiceStorage validation (Task 18)
- ✅ TtsEngine merges imported voices (Task 19)
- ✅ TtsEngine.reloadVoices (Task 20)
- ✅ VoiceLibrarySection UI (Tasks 21, 22, 23)
- ✅ Parent wiring (Task 24)
- ✅ Manual QA (Tasks 15, 25)
- ✅ Two-PR phasing (top-level structure)
- ✅ OpenRAIL-M precondition (header)

Spec items **not** in the plan, by design:

- "Self-hosted CDN mirror" — non-goal in spec
- "Brand voice packs" — non-goal in spec
- "Voice Mixer integration" — non-goal in spec
- "Sentence-internal streaming" — non-goal in spec
- "Built-in language detector" — non-goal in spec
- "Performance benchmark file `bench/supertonic.md`" — explicitly informational, non-blocking in spec; can be filed post-merge
- "Integration test with mocked worker for `import → reload → voices listed`" — covered by Task 19 + Task 20 unit tests with mock worker
