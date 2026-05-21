# Supertonic 3 Local TTS Integration

**Date**: 2026-05-21
**Status**: Design

## Summary

Integrate **Supertonic 3** (Supertone Inc., HYBE subsidiary) as a new local
TTS engine in Sokuji's local-inference stack. Supertonic 3 is a ~99M-parameter
ONNX TTS model covering **31 languages** from a single checkpoint, with
WebGPU + WASM browser inference. After this change Supertonic 3 becomes the
**recommended default** local TTS model for its 31 supported languages, while
existing piper / matcha models stay as fallbacks (notably for Chinese, which
Supertonic 3 does not cover).

This spec covers two phases shipped together:

- **Phase 1 — Preset voices**: the 10 official preset voices (F1–F5, M1–M5)
  bundled with the public model.
- **Phase 2 — Imported voices**: a per-user voice library that loads
  `voice_style.json` files produced by Supertone's hosted
  [Voice Builder](https://supertonic.supertone.ai/voice-builder) service, so
  users can plug paid custom voices into the local engine without us touching
  the cloning pipeline.

## Goals

- Add Supertonic 3 as a peer of `piper-plus` / `sherpa-onnx-tts` / `edge-tts`,
  reusing `ModelManager`, manifest, and storage with zero refactor of the
  existing engines.
- Load directly from `Supertone/supertonic-3` via the existing `hfModelId`
  path — no self-hosted mirror.
- WebGPU auto-detection with automatic fallback to WASM, modeled on the
  official static Space.
- User voice import: drag/drop or file picker, stored in IndexedDB, surfaces
  in the existing voice dropdown via stable `sid`.
- Mark Supertonic 3 as `recommended: true`. Existing local TTS models remain
  available; no migration prompts for already-downloaded users.

## Non-Goals

- **Self-hosted CDN mirror** of Supertonic 3 ONNX bundle: not needed since
  HuggingFace `resolve/main` URLs serve CORS. Avoids engaging the OpenRAIL-M
  redistribution question for a 401 MB blob.
- **Voice cloning encoder**: not open-sourced by Supertone. We do not attempt
  to reconstruct it. Users wanting custom voices must use the (paid) hosted
  Voice Builder.
- **Brand voice packs** (Kizuna AI's own preset voices bundled with sokuji):
  legal review required first; out of scope for this spec.
- **Voice Mixer** (community PyQt5 tool for blending existing voice JSONs):
  not exposed in the UI; legal grey area, low product value.
- **Sentence-internal streaming synthesis**: the official demo splits text into
  punctuation-delimited chunks for progressive playback. We use whole-sentence
  generation matching the current `TtsEngine.generate(text)` contract.
  Revisit if first-byte latency on long passages becomes a complaint.
- **Diffusion `totalStep` user setting**: hardcoded to 16 (official default).
  No quality/speed slider until usage data warrants one.
- **Expression tag (`<laugh>` / `<breath>` / `<sigh>`) injection**: pass-through
  only; we do not prompt-engineer or post-process to insert them.
- **Built-in language detection**: the official `script.js` carries a 300+ LOC
  Unicode-script + stopword detector. Sokuji already knows source/target
  language explicitly; we drop the detector entirely.
- **Replacing existing TTS models**: no piper/matcha removal; existing
  downloads keep working.

## Background

### Model

- Repo: [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) — 4 ONNX + 2 JSON + 10 voice JSONs, ~398 MB
- Architecture: diffusion-style pipeline
  `text_encoder → duration_predictor → vector_estimator (iterated totalStep×) → vocoder`
- Output: 44.1 kHz 16-bit WAV-equivalent Float32Array
- License: model **OpenRAIL-M**, code MIT
- 31 supported languages: en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr,
  hi, hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi
- **Notably absent**: Chinese (`zh`) and Thai (`th`). Chinese users continue
  on matcha-zh-en / piper-plus.

### Voice Builder (external, optional)

- Hosted Supertone web service at `supertonic.supertone.ai/voice-builder`
- Login required; one-time per-voice purchase
- Outputs offline-usable `voice_style.json` containing `style_ttl` + `style_dp`
  tensors (~292 KB each)
- We do **not** integrate with Voice Builder programmatically — users obtain
  the JSON externally and import it into sokuji.

### Existing local-inference TTS landscape

- `engine: 'sherpa-onnx'` (piper, matcha, vits, kokoro variants) — classic
  worker, Emscripten `loadPackage`
- `engine: 'piper-plus'` — classic worker, OpenJTalk WASM + ORT Web UMD
- `engine: 'edge-tts'` — classic worker, WebSocket streaming, MP3 decode
- `TtsEngineType` already includes `'supertonic'` as a placeholder; no
  implementation today.

## Architecture

```
sokuji-react/
├── scripts/copy-ort-wasm.sh               # MODIFIED — add ort.webgpu.min.mjs to FILES
├── public/workers/
│   └── supertonic-tts.worker.js           # NEW — ESM module worker
├── src/lib/local-inference/
│   ├── modelManifest.ts                   # MODIFIED — add 'supertonic-3' entry
│   ├── engine/TtsEngine.ts                # MODIFIED — supertonic branch + voices + reloadVoices
│   ├── voiceStorage.ts                    # NEW — IndexedDB voice library
│   ├── modelStorage.ts                    # MODIFIED — DB upgrade adds 'voice_styles' store
│   └── types.ts                           # MODIFIED — TtsReadyMessage.voices? / .backend?
└── src/components/ConfigPanel/LocalInference/
    ├── ModelManagementSection.tsx         # MODIFIED — Recommended badge
    └── VoiceLibrarySection.tsx            # NEW — preset list + import UI
```

### Component responsibilities

#### `public/workers/supertonic-tts.worker.js` (new, ~400 LOC)

ESM module worker (`new Worker(url, { type: 'module' })`). Loads ORT from
the bundled `public/wasm/ort/` directory via dynamic import.

**Prerequisite asset**: `ort.webgpu.min.mjs` (ESM build of onnxruntime-web
1.23+ with both WASM and WebGPU EPs) must be added to `public/wasm/ort/`.
The current bundled ORT directory ships only the UMD `ort.wasm.min.js`
(used by piper-plus via `importScripts`) plus internal JSEP runtime
modules — no ESM WebGPU entry. Add `"ort.webgpu.min.mjs"` to the `FILES`
array in `scripts/copy-ort-wasm.sh` so it gets copied from
`node_modules/onnxruntime-web/dist/` on every `npm install` and Electron
postinstall. Without this file the worker cannot load.

Init message:

```ts
{
  type: 'init',
  fileUrls: Record<string, string>,   // 4 ONNX + tts.json + unicode_indexer.json
  voiceList: Array<{
    sid: number,
    name: string,
    source: 'preset' | 'imported',
    gender?: 'M' | 'F',
    blobUrl: string,                    // voice_style JSON blob
  }>,
  ortBaseUrl: string,                   // absolute URL to /wasm/ort/
  ttsConfig: { totalStep: number, defaultSid: number },
}
```

Behavior:

1. `const ort = await import(ortBaseUrl + '/ort.webgpu.min.mjs')` — dynamic
   ESM import; works in module workers and lets us keep `ortBaseUrl`
   runtime-configurable. (`ortBaseUrl` is `./wasm/ort` resolved to an absolute
   URL — same convention as piper-plus.) The accompanying
   `ort-wasm-simd-threaded.jsep.wasm` and `ort-wasm-simd-threaded.jsep.mjs`
   files (already bundled) get auto-loaded by ORT for the WebGPU and WASM
   EPs respectively.
2. Probe `navigator.gpu` (available in worker scope on Chromium 113+).
3. Try `executionProviders: ['webgpu']` for all 4 sessions; on any session
   create error, dispose any partial sessions and retry with
   `executionProviders: ['wasm']`.
4. Fetch `tts.json` → `sampleRate = cfgs.ae.sample_rate` (44100).
5. Fetch `unicode_indexer.json` → indexer table.
6. For each voice in `voiceList`: fetch its blob URL, parse JSON, build
   `style_ttl` / `style_dp` `ort.Tensor` objects, store in a `Map<sid, {...}>`.
7. Post `ready` with `voices` metadata (no blobUrls — caller will revoke).

Generate message:

```ts
{ type: 'generate', text: string, sid: number, speed: number, lang?: string }
```

Pipeline (matches official `helper.js`):

1. `UnicodeProcessor`: text + lang → textIds (int64) + textMask (float32),
   collecting `unsupportedChars` for status reporting.
2. `text_encoder({ text_ids, text_mask, style_ttl })` → `text_emb`.
3. `duration_predictor({ text_emb, style_dp })` → `duration`.
4. Diffusion loop `for step in 0..totalStep-1`:
   `vector_estimator({ noisy_latent, text_emb, style_dp, current_step, total_step })`.
5. `vocoder({ latent })` → `wav_tts` (Float32Array @ 44.1 kHz).
6. Post `result` with samples + sampleRate + generationTimeMs.

If `sid` not in the voice Map → fall back to `defaultSid`, emit `status`
message warning the main thread (which will rewrite `settingsStore`).

If `lang` is not in the 31-language list → use `'na'` (language-agnostic)
internally, emit `status` once per init.

#### `src/lib/local-inference/modelManifest.ts` (modified)

Add one entry:

```ts
{
  id: 'supertonic-3',
  type: 'tts',
  engine: 'supertonic',
  recommended: true,
  hfModelId: 'Supertone/supertonic-3',
  numSpeakers: 10,
  ttsConfig: {
    supportedLanguages: ['en','ko','ja','ar','bg','cs','da','de','el','es',
                         'et','fi','fr','hi','hr','hu','id','it','lt','lv',
                         'nl','pl','pt','ro','ru','sk','sl','sv','tr','uk','vi'],
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
    defaultSid: 7,    // Robert (matches official demo default)
    totalStep: 16,
  },
  variants: {
    default: {
      dtype: 'default',
      files: [
        { filename: 'onnx/duration_predictor.onnx', sizeBytes: 3_700_000 },
        { filename: 'onnx/text_encoder.onnx',       sizeBytes: 36_400_000 },
        { filename: 'onnx/vector_estimator.onnx',   sizeBytes: 257_000_000 },
        { filename: 'onnx/vocoder.onnx',            sizeBytes: 101_000_000 },
        { filename: 'onnx/tts.json',                sizeBytes: 8_250 },
        { filename: 'onnx/unicode_indexer.json',    sizeBytes: 278_000 },
        { filename: 'voice_styles/F1.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/F2.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/F3.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/F4.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/F5.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/M1.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/M2.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/M3.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/M4.json',         sizeBytes: 292_000 },
        { filename: 'voice_styles/M5.json',         sizeBytes: 292_000 },
      ],
    },
  },
}
```

Approximate total: 401 MB. Exact sizes must be re-verified once during
implementation (HuggingFace API `GET /api/datasets/.../tree/main`).

The `recommended` field is new. Existing manifest entries omit it; UI treats
missing as `false`.

#### `src/lib/local-inference/voiceStorage.ts` (new, ~120 LOC)

Reuses the existing `sokuji-models` IndexedDB database by adding a new
object store `voice_styles` in the next schema version bump.

Schema:

```ts
interface StoredVoice {
  id: number;              // auto-increment primary key
  engine: 'supertonic-3';  // future-proofing for other engines
  name: string;
  jsonData: Blob;          // raw voice_style JSON
  importedAt: number;
}
```

API (Promise-based, uses `idb` library):

```ts
listVoices(engine: 'supertonic-3'): Promise<StoredVoice[]>
getVoice(id: number): Promise<StoredVoice | undefined>
addVoice(engine: 'supertonic-3', name: string, file: File): Promise<StoredVoice>
renameVoice(id: number, name: string): Promise<void>
deleteVoice(id: number): Promise<void>
```

`addVoice` validates before insert:

- file < 1 MB
- `JSON.parse` succeeds
- parsed object has `style_ttl.data` (array) and `style_dp.data` (array)
- if name collides, append `(2)` / `(3)` etc.

Returns the inserted record (with assigned `id`). Throws typed errors for UI
toast mapping.

`sid = id + 10` is computed at the call site in `TtsEngine`, not stored.

#### `src/lib/local-inference/engine/TtsEngine.ts` (modified)

Add `engine === 'supertonic'` branch in `init`:

1. `ModelManager.getModelBlobUrls('supertonic-3')` → blob URLs for ONNX +
   tts.json + unicode_indexer.json + 10 preset voice JSONs.
2. `voiceStorage.listVoices('supertonic-3')` → imported voices.
3. Build `voiceList`:
   - For each preset in `model.ttsConfig.presetVoices`: `{ sid, name, source: 'preset', gender, blobUrl: fileUrls[file] }`
   - For each imported voice: convert `jsonData` Blob to blob URL, push
     `{ sid: id + 10, name, source: 'imported', blobUrl }`
4. `new Worker('./workers/supertonic-tts.worker.js', { type: 'module' })`
5. Post `init` with `fileUrls` (model files only, voice JSONs included via
   `voiceList.blobUrl`), `voiceList`, `ortBaseUrl`, `ttsConfig`.
6. On `ready`, revoke all blob URLs (model + voice), forward `voices` to
   caller, store in engine state.

Extend `init`'s return type:

```ts
{
  loadTimeMs: number;
  numSpeakers: number;
  sampleRate: number;
  voices?: Array<{ sid, name, source, gender? }>;  // new
  backend?: 'webgpu' | 'wasm';                      // new
}
```

`generate(text, sid, speed, lang)` signature unchanged — sid carries the voice
identity for all engines.

Add public method `reloadVoices()`:

```ts
async reloadVoices(): Promise<void> {
  if (this.currentModel?.engine !== 'supertonic') return;
  const modelId = this.currentModel.id;
  this.dispose();
  await this.init(modelId);
}
```

Called by `VoiceLibrarySection` after import / delete / rename.

#### `src/lib/local-inference/types.ts` (modified)

```ts
export interface TtsReadyMessage {
  type: 'ready';
  loadTimeMs: number;
  numSpeakers: number;
  sampleRate: number;
  voices?: Array<{
    sid: number;
    name: string;
    source: 'preset' | 'imported';
    gender?: 'M' | 'F';
  }>;
  backend?: 'webgpu' | 'wasm';
}
```

Existing engines do not set `voices` / `backend`; UI treats them as optional.

#### `src/components/ConfigPanel/LocalInference/ModelManagementSection.tsx` (modified)

Render a "Recommended" badge next to entries where
`manifest.recommended === true`. Sort `recommended` entries first within their
`type` group.

#### `src/components/ConfigPanel/LocalInference/VoiceLibrarySection.tsx` (new, ~180 LOC)

Visible only when the active TTS engine is `supertonic`. Layout:

```
┌─ Voice Library ──────────────────────────────────────────────┐
│ ┌─ Info ──────────────────────────────────────────────────┐  │
│ │ Need a custom voice? Create one at Voice Builder ↗      │  │
│ │ (paid Supertone service; we don't host it)               │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  Presets (10)                                                  │
│   ○ Robert (M3) — selected                                     │
│   ○ Sarah (F1)                                                 │
│   ... (10 rows, click to select)                               │
│                                                                │
│  ──────────────────────────────────────                        │
│  My Voices                              [+ Import voice…]      │
│   ○ My Custom Voice           [edit] [delete]                  │
│   (empty state: "Drop a voice_style.json here, or click +")   │
└────────────────────────────────────────────────────────────────┘
```

Drag-drop on the whole panel; click `+` opens file picker. Validation errors
shown as inline toasts.

Renaming: inline text edit on row hover.
Deletion: confirm dialog. If the deleted voice is currently selected,
`settingsStore.setSid(defaultSid)` automatically.

After any mutation: `ttsEngine.reloadVoices()`; show "Reloading voices…"
spinner during the ~1–3s WebGPU re-compile.

## Data Flow

### Download

```
User clicks "Download Supertonic 3"
  → modelStore.downloadModel('supertonic-3')
  → ModelManager.downloadModel reads manifest
  → for each file: fetch from
       https://huggingface.co/Supertone/supertonic-3/resolve/main/<filename>
     with streaming progress, validation, IndexedDB store
  → setMetadata(status='downloaded')
```

Existing path, zero new code.

### Init

```
TtsEngine.init('supertonic-3')
  → ModelManager.getModelBlobUrls → 16 blob URLs (model + preset voices)
  → voiceStorage.listVoices → imported voices
  → assemble voiceList (sid 0-9 preset, sid = id+10 imported)
  → new Worker(.., {type:'module'})
  → postMessage init
  → worker: import ort, try WebGPU, fallback WASM, load 4 ONNX,
            fetch JSON configs, build voice tensors
  → worker postMessage ready { voices, backend }
  → TtsEngine: revoke all blob URLs, forward to modelStore
  → modelStore.voices populated, VoiceLibrarySection re-renders
```

### Generate

```
caller.generate(text, sid, speed, lang)
  → TtsEngine.stripEmoji
  → worker.postMessage generate
  → worker: UnicodeProcessor → text_encoder → duration_predictor
            → diffusion (16 steps of vector_estimator)
            → vocoder → Float32Array @ 44.1kHz
  → worker postMessage result
  → caller resolves promise, hands to ModernAudioPlayer
```

### Voice import

```
User drops voice_style.json
  → VoiceLibrarySection validates (size, JSON, fields)
  → name prompt (default from filename)
  → voiceStorage.addVoice → IndexedDB autoinc → record returned
  → ttsEngine.reloadVoices() → dispose + init
  → new voice appears in voices list
  → (optional) settingsStore.setSid(newSid) to pre-select
```

### Voice delete

```
User clicks delete → confirm modal
  → voiceStorage.deleteVoice(id)
  → if settingsStore.sid === id+10: settingsStore.setSid(defaultSid)
  → ttsEngine.reloadVoices()
```

### Voice rename

```
Inline edit → blur or Enter
  → voiceStorage.renameVoice(id, newName)
  → modelStore mutates voices list locally (no worker reload — tensor data unchanged)
```

### Backend fallback

```
worker init:
  let useWebGPU = !!self.navigator.gpu
  let ep = useWebGPU ? 'webgpu' : 'wasm'
  try { create all 4 InferenceSessions with [ep] }
  catch {
    if (useWebGPU) {
      release sessions, ep = 'wasm', retry
    } else throw
  }
  ready { backend: useWebGPU ? 'webgpu' : 'wasm' }
```

## Error Handling

Errors are categorized as **P0** (blocking), **P1** (degraded but functional),
**P2** (logged only).

### Download

| Error | Handling | Severity |
|---|---|---|
| Network interrupt | `AbortError`; partial files kept for resume (existing) | P1 |
| HF rate-limit (429/503) | Surface "Try again in a minute"; no auto-retry this iteration | P0 |
| CORS failure | Should not happen with `huggingface.co/resolve/main`; surfaces as fetch error | P0 |
| HTML response (CDN error page) | Existing `header[0] === 0x3C` check | P0 |
| Size mismatch (>20%) | Existing check | P0 |
| Invalid JSON | Existing check | P0 |
| Invalid ONNX (no protobuf prefix) | Add `header[0] === 0x08` check for `.onnx` files in ModelManager | P1 |
| `QuotaExceededError` | Toast "Need ~400 MB free disk space"; don't mutate metadata | P0 |
| User cancellation | Existing cancel logic | P1 |

### Worker init

| Error | Handling | Severity |
|---|---|---|
| ORT module path wrong | Throw at worker startup; surface as worker error | P0 (dev-only) |
| `navigator.gpu === undefined` | Not an error; WASM path; `ready.backend = 'wasm'` | P2 |
| WebGPU adapter request fails | Same as above | P2 |
| WebGPU `InferenceSession.create` throws | Catch, dispose partial sessions, retry WASM | P1 |
| WASM also fails | Throw; UI shows "Browser doesn't support local TTS for this model" | P0 |
| Missing model file (deleted between download and use) | Throw "Missing file X; re-download the model"; surface "Re-download" button | P0 |
| Single preset voice JSON parse failure | Skip that voice; emit `status` warning; engine remains usable | P1 |
| `tts.json` / `unicode_indexer.json` parse failure | Throw (engine cannot function without them) | P0 |

### Voice import

| Error | Handling | Severity |
|---|---|---|
| Not valid JSON | Toast "Not a valid JSON file" | P1 |
| File > 1 MB | Toast "Voice file too large (max 1 MB)" | P1 |
| Missing `style_ttl.data` or `style_dp.data` | Toast "Not a Supertonic voice file" | P1 |
| `dims` field missing | Toast "Voice file has invalid tensor metadata" | P1 |
| Name collision | Auto-append `(2)`, `(3)` | P2 |
| IndexedDB write fails (`QuotaExceededError`) | Toast "Storage full" | P0 |
| `reloadVoices` fails after insert | Roll back: delete the just-added voice; toast "Failed to load voice, removed" | P1 |
| Concurrent generate during import | Queue the reload until current generate resolves; show "Reloading voices…" | P2 |

Shape validation is **existence-only**. We don't verify `style_ttl` /
`style_dp` tensor dimensions because the official spec doesn't publish them.
Wrong dimensions surface at `vector_estimator` inference time; the generic
runtime error path catches that.

### Generate runtime

| Error | Handling | Severity |
|---|---|---|
| `lang` not in 31-language list | Worker uses `'na'`; main thread logs once per init | P2 |
| Empty text after `stripEmoji` | Return empty `Float32Array` (existing behavior) | P2 |
| Unsupported Unicode characters | Worker substitutes id `0` (per official); emits `status` with `unsupportedChars` array; main thread logs | P2 |
| `sid` not in voice Map | Worker falls back to `defaultSid`; emits `status`; main thread updates `settingsStore.sid = defaultSid` and toasts "Imported voice no longer available, switched to Robert" | P1 |
| Very long text (e.g. > 500 chars) | No hard truncation. If `vector_estimator` OOMs, fall through to runtime error path | P2 |
| WebGPU device lost mid-generation | Worker emits error containing "device lost"; main thread auto `dispose + init` + retry **once**; second failure surfaces as plain error | P1 |
| `vector_estimator` OOM | Catch in worker, retry with WASM EP (one full re-init), retry generate once | P1 |
| Concurrent generate | Existing reject "A generation request is already in progress" | P0 (caller bug) |
| Worker uncaught exception | `worker.onerror` rejects pending, marks `isReady = false`; UI shows "TTS engine crashed, retry" | P0 |
| Dispose during pending | Existing reject "TTS engine disposed" | P2 |

### Invariants

- `settingsStore.sid` is always in `voices[].sid`. Engine init validates and
  rewrites if needed.
- IndexedDB transactions are atomic (handled by `idb`).
- Every `dispose` revokes all blob URLs (model + voice). A 401 MB leak would
  be very visible — guard with explicit revocation in `finally` paths.

### User-visible error UX

- **Recoverable** (network, transient OOM): toast + retry button.
- **User action required** (disk full, file corrupt, voice deleted): modal
  with explicit next step.
- **Fatal** (WASM init failed): TTS section disabled with explanation. Do
  **not** silently fall through to cloud TTS — could trigger unexpected
  billing or privacy concerns.

## Testing

### Unit tests (Vitest + `fake-indexeddb`)

- `voiceStorage.test.ts` — CRUD + validation
- `modelManifest.test.ts` — Supertonic 3 entry well-formed, URL composition,
  size envelope, 10 presets / 31 languages assertions
- `sidMapping.test.ts` — preset/imported sid conversions
- `TtsEngine.test.ts` — supertonic branch dispatch, voices passthrough,
  blob URL revoke on dispose, concurrent reject

### Integration tests (Vitest + mocked worker)

- `supertonic-integration.test.ts` — full init/generate/reload protocol with
  a stub worker; verifies main↔worker message shapes and `settingsStore`
  reconciliation on deleted-sid

### Worker self-tests

Not in CI. Real ONNX inference is covered by manual QA.

### Manual QA checklist

Tracked in companion file `2026-05-21-supertonic-3-integration-manual-test.md`
(created during implementation):

- Browser × backend matrix: Chrome (WebGPU), Edge (WebGPU), Firefox (WASM)
- Inference quality: en, ja, ko, ru, ar, de, fr (one short sentence each)
- **Confirm zh is unsupported** and falls back as expected (matcha-zh-en
  remains the recommended path for Chinese users)
- Voice switching across all 10 presets
- Voice import: valid file, invalid JSON, missing field, oversize, name
  collision
- Voice rename / delete; deleting selected voice
- Long text (500 chars), all-emoji text, unsupported Unicode
- Engine swap (Supertonic → piper-en → Supertonic) without leaks
- 50-generation memory-stability run
- Regression: piper-en, matcha-zh-en, edge-tts still functional

### Performance baseline (informational, non-blocking)

Record one short-sentence (~12 chars) latency on three devices:
MacBook M-series, Intel laptop with integrated GPU, mid-range Android.
Tracked in `bench/supertonic.md`. Used later to evaluate `totalStep` and
WebGPU OOM thresholds — not a merge gate.

## Risks and Open Questions

### Legal — OpenRAIL-M scope

OpenRAIL-M's use-based restrictions need legal sign-off before sokuji ships
Supertonic 3 to its commercial userbase. Conservative read: shipping the
ONNX runtime locally and letting users synthesize their own text is
defensible; bundling celebrity-impersonation voices would not be. This
spec only ships the 10 official presets, leaving voice cloning to the
user's own Voice Builder transaction with Supertone.

**Action**: legal review before merging implementation PR. Block on this.

### Voice Builder pricing / commercial terms

Voice Builder is paid and login-gated. We don't have visibility into the
"What rights do I have for purchased voices?" FAQ answer. Users may discover
restrictions only after purchase. Our docs should disclaim that we're not
party to that transaction.

### Diffusion latency on low-end devices

`vector_estimator` runs 16× per generate. On WASM-only mid-range hardware,
short-sentence latency may exceed 5s, which is bad for translation UX.
Measurement comes during manual QA. Mitigations if it's bad:

- Drop `totalStep` from 16 to 8 (quality cost not yet quantified)
- Show a "Slow device — use cloud TTS?" hint when WASM is active and
  generate time exceeds a threshold

Not a v1 blocker, but a credible reason we might roll back `recommended`
from `true` for users without WebGPU.

### Worker module loading in Electron / extension

`new Worker(url, { type: 'module' })` works in modern browsers and Electron
renderer. Need to confirm:

- Sokuji's Electron build's CSP allows ESM workers (it should — they're
  treated like normal scripts)
- The browser extension's content security policy doesn't choke on dynamic
  ESM imports from `chrome-extension://...` origin

Verify during implementation; not expected to block.

### Chinese-language gap

Supertonic 3 lists no Chinese language. The model can still generate
"lang-agnostic" output that's intelligible but worse. The plan keeps
matcha-zh-en as the recommended path for Chinese, but UI needs to
communicate this clearly when a Chinese user has Supertonic 3 downloaded
and selects zh as their target language.

### voice_style JSON forward compatibility

Supertonic 2 → 3 used different voice JSON formats. If Supertone ships
Supertonic 4 with another format break, all imported voices become invalid.
Mitigation: store `engine: 'supertonic-3'` discriminator with each voice;
do not show v3 voices in a v4 engine.

## Implementation Phasing

Although Phase 1 + Phase 2 are designed together, the implementation can
land as two PRs to reduce review surface:

1. **PR 1 — Phase 1**: manifest entry, worker, engine branch, 10 presets
   selectable from a basic dropdown. No `VoiceLibrarySection`, no
   `voiceStorage`. Recommended badge in ModelManagementSection.

2. **PR 2 — Phase 2**: `voiceStorage`, `VoiceLibrarySection`, import / rename
   / delete UX, `reloadVoices`. Cosmetic upgrade to the voice dropdown to
   distinguish imported voices.

Both PRs gated on legal sign-off for OpenRAIL-M.
