# Native Model Metadata Single-Sourcing + Sidecar Lifecycle — Design

**Date:** 2026-06-30
**Status:** Approved (design); pending implementation plan

## Goal

Make the Python sidecar the single source of truth for all LOCAL_NATIVE model
*facts* (which ASR/translation/TTS models exist, their languages, recommended
flags, display order, repos, per-machine tier availability, and built-in TTS
voice metadata). Delete the parallel hardcoded copies in the renderer's
`nativeCatalog.ts`. Because the catalog then loads asynchronously from the
sidecar, introduce an explicit sidecar lifecycle state that every dependent UI
surface subscribes to, replacing today's implicit best-effort behavior.

This also fixes a known correctness bug: after a language reversal that leaves no
compatible translation model, the native Start button stays clickable and the
model-info shows a stale "None" — because native readiness never re-runs the
auto-select globally and never distinguishes "sidecar still starting" from "no
model for this pair".

## Background: the duplication that motivates this

The sidecar `catalog.py` is already the authoritative model registry:
`AsrModel` / `TranslateModel` / `TtsModel` dataclasses carry `id`, `name`,
`languages`, `deployments` (with per-tier compute device + dtype), `recommended`,
`sort_order`, and (TTS) `repos` / `sample_rate`. The sidecar already exposes
three catalog handlers in `accel.py`:

- `models_catalog` — per-machine model list with tier availability (ASR/translate only)
- `hardware_info` — GPU presence and installed backends
- `list_variants` — per-deployment GPU support + reasons

The renderer already consumes `models_catalog` via
`nativeModelStore.refreshCatalog()` (stored in `catalog`), and
`gpuTierAvailable(catalog)` already reads the sidecar-provided `tiers`. So GPU
availability for the compute-device selector is *already* sidecar-driven.

The problem is a **second, hand-maintained copy** in `nativeCatalog.ts`:
`NATIVE_ASR`, `NATIVE_TRANSLATION`, `NATIVE_TTS_BY_LANG`, repo hints, and
`BUILTIN_VOICE_META` / `DEFAULT_VOICE_BY_LANG`. These re-encode ids, languages,
recommended flags, ordering, repos, and voice metadata that the sidecar already
owns. The two copies drift, which has produced real bugs (`_repo_for` catalog-id
resolution, `list_tts_voices` fed a catalog id instead of an HF repo).

Note `catalog.py:36-38`: `sort_order` is deliberately *not* sent over the wire
today, with the renderer owning card ordering. This design reverses that — the
sidecar becomes the ordering authority.

## Design decisions (settled during brainstorming)

1. **Boundary: data single-sourced, selection logic stays in the renderer.**
   The sidecar owns model/voice *facts*. The renderer keeps the well-tested
   TypeScript selection logic (`nativeTranslationCards`, `requiredNativeModels`,
   `autoSelectNative`, `curatedBuiltinVoices`, `defaultTtsVoice`, …); those
   functions change only their *input* — from hardcoded arrays to the
   sidecar-sourced catalog/voice descriptors. We do NOT rewrite 29 KB of tested
   TS logic into Python.

2. **Pure async, no hardcoded fallback.** The renderer carries no static model
   list. Before the sidecar responds there is nothing to render; the UI shows a
   `starting` state. Acceptable because (a) LOCAL_NATIVE cannot do inference
   without the sidecar anyway, and (b) once fetched, the catalog is cached in
   `nativeModelStore` for the session, so only the first cold start shows the
   loading state. A build-time generated snapshot is explicitly out of scope
   (YAGNI; revisit only if cold-start flicker becomes a real UX problem).

3. **Built-in voices are single-sourced too.** Voice *metadata* (language,
   curated, unstable, per-language default) moves into the sidecar; the renderer
   keeps the split/sort/pick logic.

4. **Custom (cloned) voices stay frontend-owned (out of scope for
   single-sourcing).** See the dedicated section below.

## TTS models vs voices: the speaker-id model

A TTS card is a TTS **model**. A model's *voice* is a **speaker id**, and models
fall into three shapes by how many speaker ids they expose:

- **single** — one speaker (most piper repos, e.g. `…amy-low`). No voice control;
  the model *is* the voice. `num_speakers == 1`.
- **range** — a numeric speaker range `0..N-1` (multi-speaker VITS, e.g.
  `…libritts_r-medium`, `vits-icefall-zh-aishell3`). Voice control is a
  speaker-id slider. `num_speakers > 1`, `clones == false`.
- **list** — a discrete named voice list (MOSS built-in speakers Ava/Bella/…)
  plus user clones. Voice control is a dropdown (`VoiceLibrarySection`).
  `clones == true`.

This is the same abstraction the WASM side already ships in
`LocalInferenceVoiceSection` (edge/supertonic = list, other engines = speaker-id
slider when `numSpeakers > 1`, else nothing). Native is brought to parity:
multi-speaker VITS models (today flattened to speaker 0) gain the slider.

Each piper repo is therefore a *model*, not a voice — they belong in the sidecar
TTS catalog exactly like ASR/translation models. The frontend's
`NATIVE_TTS_BY_LANG` (the ~22 piper repos) moves into `catalog.py`'s
`TTS_MODELS`, using the **repo path as the model id** (= today's `selectId` /
persisted `ttsModel`, so no settings migration). The two vestigial short-id
entries (`piper-en-amy`, `vits-icefall-zh-aishell3`) are reconciled to repo-path
ids (the frontend never used the short ids).

`ttsVoice` encodes the in-model selection across all three shapes:
- list → `builtin:<Name>` / `custom:<id>` (existing)
- range → `sid:<n>` (new)
- single → `''` (sid 0)

## Sidecar protocol changes

### `models_catalog` becomes the sole model-list source

- Add a `kind=tts` branch to `_h_models_catalog` (today it handles only
  `asr` / `translate`). Source from `catalog.tts_models()`.
- Complete the TTS catalog first: port all piper models from the frontend's
  `NATIVE_TTS_BY_LANG` into `catalog.py` `TTS_MODELS` (repo-path ids).
- Add `num_speakers: int = 1` to the `TtsModel` dataclass. Single-speaker piper =
  1; multi-speaker counts are read once via `sherpa_onnx.OfflineTts.num_speakers`
  and hardcoded (a catalog fact — the picker needs the slider max before load).
- Extend each model entry in the payload with:
  - `order: number` — from the model's `sort_order` (the sidecar becomes the
    ordering authority; remove the `catalog.py:36-38` "renderer owns ordering"
    note).
  - `repo: string` — the default repo: ASR/translate `deployments[0].artifact`,
    TTS `repos[0]`.
  - `kind: 'asr' | 'translate' | 'tts'` — so the renderer can group without a
    second round of `kind`-scoped requests.
  - TTS only: `numSpeakers: number`, `clones: boolean`, `streaming: boolean` —
    so the renderer picks the single/range/list voice control.
- `NativeModelInfo` (TS type) gains `order: number`, `repo: string`,
  `kind: 'asr' | 'translate' | 'tts'`, and optional
  `numSpeakers?: number`, `clones?: boolean`, `streaming?: boolean`.

### Runtime: speaker-id selection for sherpa

`SherpaTtsBackend.generate` hardcodes `sid=0`. Add `set_speaker(sid: int)` (stores
the selected sid) and have `generate` / `generate_stream` pass it. `_h_set_voice`
gains a third form: a payload carrying `sid` → `backend.set_speaker(int(sid))`
(alongside the existing built-in-name and binary-clip forms).

### `list_tts_voices` returns rich descriptors

- Add a sidecar-side voice metadata table (in `tts_voices.py`, next to the model
  definitions) that 1:1 mirrors today's renderer `BUILTIN_VOICE_META` +
  `DEFAULT_VOICE_BY_LANG`. Behavior is unchanged; only the home moves. This is
  our editorial product judgment (e.g. "Ava reliably clean", "Adam unstable",
  see #277), so it belongs beside the model, not in the renderer.
- `list_tts_voices` enriches each manifest voice name with that metadata and
  returns:
  ```
  voices: { name: string; language?: string; curated: boolean;
            unstable: boolean; default: boolean }[]
  ```
  `default` marks the voice that is the default for its language (from the moved
  `DEFAULT_VOICE_BY_LANG`).
- The TS type `ListTtsVoicesResultMsg.voices` changes from `string[]` to
  `NativeVoiceInfo[]`. The sidecar has never shipped a release, so the old shape
  is replaced cleanly with no backward-compatibility shim.

## Renderer: store lifecycle + catalog derivation

### `nativeModelStore` lifecycle

Add to the store:

```ts
sidecarStatus: 'idle' | 'starting' | 'ready' | 'unavailable';
ensureCatalog: () => Promise<void>;   // idempotent
retrySidecar: () => Promise<void>;    // manual retry after `unavailable`
```

`ensureCatalog`:
- `idle` / `unavailable` → set `starting`
- `native-host:start` handshake, then fetch in parallel: `models_catalog` for
  `asr` + `translate` + `tts`, and `hardware_info`
- all succeed → set `ready`, populate `catalog`
- any step throws → set `unavailable` (no more silent catch)
- already `ready` → return immediately (in-memory cache; not re-fetched within a
  session)

A partial catalog (e.g. TTS fetched but translate timed out) is treated as
`unavailable`, not accepted — never run selection logic on an incomplete catalog.

`retrySidecar` re-runs `ensureCatalog` from `unavailable`.

### `nativeCatalog.ts` derivation

- Delete `NATIVE_ASR`, `NATIVE_TRANSLATION`, `NATIVE_TTS_BY_LANG`,
  `BUILTIN_VOICE_META`, `DEFAULT_VOICE_BY_LANG`, and the hardcoded repo hints.
- Selection functions take a `catalog: Record<string, NativeModelInfo>` argument
  (kept pure and testable) and filter by `kind` + `languages` + `order` +
  `recommended`. Display names use the sidecar `name` directly (the sidecar even
  computes `Opus-MT (zh → en)` via `_opus_disp`).
- `defaultTtsVoice` / `curatedBuiltinVoices` keep their split/sort/pick logic but
  read the rich voice descriptors (`curated` / `language` / `default`) instead of
  the deleted map.
- The renderer keeps only presentation: i18n strings, perf badges, tier labels,
  and the `builtin:` / `custom:` / `sid:` id encoding.

### Capability-driven native voice control

`NativeVoiceSection` becomes capability-driven, mirroring
`LocalInferenceVoiceSection`. It switches on the selected TTS model's catalog
facts:
- `clones` → **list**: `VoiceLibrarySection` dropdown (built-in descriptors from
  `list_tts_voices` + custom clones). Writes `ttsVoice = builtin:<Name>` /
  `custom:<id>`.
- else `numSpeakers > 1` → **range**: speaker-id slider `0..numSpeakers-1`. Writes
  `ttsVoice = sid:<n>`.
- else **single**: no control. `ttsVoice = ''`.

`reconcileTtsVoice` (session start) resolves `sid:<n>` to the speaker id passed to
the sidecar via `set_voice` `{ sid }`; `builtin:` / `custom:` resolve as today.

## The six UI surfaces subscribe to `sidecarStatus`

| Surface | `starting` | `unavailable` | `ready` |
|---|---|---|---|
| Model cards (`NativeModelManagementSection`) | skeleton "Starting local engine…" | error + retry button | normal cards |
| model-info (`ProviderSection`) | "Starting…" | "Engine unavailable" | resolved (real None distinguished) |
| Start button (`MainPanel`) | disabled + "Starting engine" | disabled + error | normal readiness |
| Download / delete buttons | disabled | disabled | enabled |
| Compute-device GPU option | hidden / Auto-only | CPU-only | read `catalog.tiers` (already) |
| Global indicator (provider header) | "Starting local engine…" | error + retry | none |

## `validateApiKey` integration (folds in the Start-button bug fix)

LOCAL_NATIVE branch:
1. `await ensureCatalog()`.
2. If status is not `ready` → not ready; the message distinguishes `starting`
   ("starting engine") from `unavailable` ("engine unavailable"). Do NOT mutate
   the selection on incomplete data.
3. If `ready` → run global `autoSelectNative(src, tgt, current)` against the
   catalog + real download statuses → persist via `updateLocalNative` → compute
   `asrCompatible && trCompatible && isReady`.

This makes auto-select global (independent of whether the settings panel is
mounted), so it fixes both the Start button and the model-info "None". The
existing panel-bound auto-select effect in `NativeModelManagementSection` is
removed (its logic now lives in the gate).

## Error handling

- `unavailable` is an explicit terminal state carrying a `retrySidecar` action
  (user-triggered retry re-runs `ensureCatalog`).
- Partial catalog fetch → whole `unavailable` (never a half-populated catalog).
- Custom-voice storage failures at session start remain locally caught (must not
  kill TTS; falls back to built-in voices) — unchanged from today.

## Custom (cloned) voices — out of scope for single-sourcing

Custom voices are **user-created runtime data**, not catalog facts. They have
only ever had a single copy, so there is no drift to eliminate. The
single-sourcing effort deliberately does not touch them.

Current handling (unchanged by this work):
- Stored in the renderer's `nativeVoiceStorage` as
  `StoredNativeVoice { id, name, audio, sampleRate }` (the reference-clip
  Float32 samples).
- Id encoding `custom:<id>` vs built-in `builtin:<Name>`.
- `NativeVoiceSection` merges built-in voices (sidecar `list_tts_voices`
  descriptors) into "Presets" and custom voices (`nativeVoiceStorage`) into
  "My Voices" — the merge happens in the UI layer.
- At session start, `LocalNativeClient` resolves a `custom:<id>` to its stored
  clip and sends it via `setReferenceVoice` (the `set_voice` binary frame); the
  sidecar is **stateless** about user clips — it receives the clip transiently
  per session and never persists it.

Only the built-in branch changes: `curatedBuiltinVoices` reads sidecar
descriptors instead of the deleted `BUILTIN_VOICE_META`. The custom branch —
storage, the My Voices list, the `setReferenceVoice` clone path, and the
sidecar's stateless receipt — is untouched.

A fully sidecar-owned voice store (persisting user clips, `list_tts_voices`
returning built-in + custom uniformly) is explicitly rejected for now: it solves
no drift, adds protocol + storage + lifecycle surface, and makes the sidecar
stateful about user data. Revisit only if cross-device voice sync becomes a goal.

## Testing strategy

- **Sidecar (pytest):**
  - `catalog.tts_models()` enumerates all piper models with repo-path ids and a
    `num_speakers` field.
  - `_h_models_catalog` `kind=tts` returns TTS models; every kind carries
    `order` / `repo` / `kind`; TTS entries carry `numSpeakers` / `clones` /
    `streaming`.
  - `list_tts_voices` returns rich descriptors with correct
    `name` / `language` / `curated` / `unstable` / `default`.
  - `SherpaTtsBackend.set_speaker(sid)` makes `generate` emit with that sid;
    `_h_set_voice` `{ sid }` routes to `set_speaker`.
- **Renderer voice control:** `NativeVoiceSection` renders the right control per
  shape — dropdown for `clones`, slider for `numSpeakers > 1`, nothing for single
  — and writes the matching `ttsVoice` encoding; `reconcileTtsVoice` resolves
  `sid:<n>`.
- **Store:** `ensureCatalog` state machine (`starting` → `ready`,
  `starting` → `unavailable`, idempotent no-refetch when `ready`); `retrySidecar`.
- **`nativeCatalog.ts`:** convert the existing ~29 KB test suite from reading the
  hardcoded arrays to passing a fixture catalog — same assertions, new data
  entry point (the largest test-change surface). Same for
  `curatedBuiltinVoices` / `defaultTtsVoice` with fixture descriptors.
- **`validateApiKey` (LOCAL_NATIVE):** extend `settingsStore.nativeGate.test.ts`
  with cases proving that when the sidecar is `starting` / `unavailable`, the
  provider is not ready AND the selection is not mutated; and that when `ready`,
  auto-select reconciles a stale pair globally.
- **Surfaces:** test the high-value renders (Start button + model-info under
  `starting` / `unavailable`). SettingsInitializer / MainPanel wiring mirrors the
  existing untested LOCAL_INFERENCE counterparts.

## Out of scope

- Build-time generated catalog snapshot (cold-start optimization).
- Moving selection/recommendation logic into the sidecar.
- Sidecar-persisted custom voices / cross-device voice sync.
- Single-sourcing WASM (LOCAL_INFERENCE) model metadata — this design covers
  LOCAL_NATIVE only.
