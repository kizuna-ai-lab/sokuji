# Native TTS Voice Selection & Cloning — Design

**Status:** Approved (brainstorming) — ready for implementation planning.

## Goal

Give the native (Electron Python sidecar) TTS stage a user-facing **Voice** experience for voice-capable models (MOSS-TTS-Nano): pick a **built-in named voice** (curated, with an expandable full list) or use a **custom cloned voice** recorded from the mic or uploaded as a file. Custom voices persist in a reusable library (rename/delete). The selected voice applies on the **next session**, consistent with the existing Supertonic (WASM) voice flow.

## Background

- The sidecar backend already supports both mechanisms: `set_voice` (zero-shot clone from a raw reference clip → `_voice_rows`) and built-in named voices via `MossOnnxTtsBackend` / `OnnxTtsRuntime.list_builtin_voices()` (18 voices in `browser_poc_manifest.json`). The renderer exposes neither yet: `NativeTtsClient.setReferenceVoice()` exists but is never called, and there is no built-in voice picker.
- The WASM path has a mature analogue, `VoiceLibrarySection` (Supertonic): sid-numbered presets + user-imported file voices in IndexedDB (`voiceStorage.ts`), with rename/delete and next-session-applied selection.
- Default preset voice is now `Ava` (see issue #277). MOSS-TTS-Nano has a silence-token attractor whose severity varies by voice; deeper silence governance is deferred (#277). This design must not depend on #277.

## Decisions (locked during brainstorming)

1. **Scope:** both a built-in voice picker **and** custom cloning, unified in one Voice section.
2. **Custom voice management:** record (mic) **and** upload (file), saved to a persistent IndexedDB library (rename/delete), reusable across sessions. Stored as **raw audio** (re-encoded via `set_voice` each session).
3. **Built-in picker presentation:** curated list per target language with an expandable "show all" for the full set; unstable voices flagged (pending #277).
4. **Switch timing:** **next session** (no mid-session hot-swap), matching Supertonic.
5. **Built-in voice list source:** **dynamic** — a new `list_tts_voices` WS query reads voice names from the model snapshot. (Decision 1 = B.)
6. **UI:** **generalize** the existing `VoiceLibrarySection` into a capability-driven component used by both Supertonic and native. (Decision 2 = B.)

## Global Constraints

- TypeScript strict; English-only comments/docs. Conventional commits. Tests are the correctness gate (vitest for renderer, pytest for sidecar); `tsc` is not clean repo-wide and is not a gate.
- Do not regress the existing Supertonic `VoiceLibrarySection` behavior.
- No dependency on #277 (silence governance). Unstable built-in voices remain reachable but flagged.
- Selected voice applies on next session only; never hot-swap mid-session.
- Sidecar `list_tts_voices` must not load the heavy ONNX model — read names from the snapshot manifest only.
- All sidecar protocol changes stay backward-compatible (new fields optional; absence = current behavior).

## Architecture Overview

When the selected native TTS model is **voice-capable**, the TTS group in `NativeModelManagementSection` shows a **Voice** section with two groups:

1. **Built-in voices** — curated subset per target language + "show all" expander; default per language (en → `Ava`).
2. **Custom voices** — a library of cloned voices (record / upload), rename/delete.

The selected voice is stored in `settings.ttsVoice` and carried in the session config. At session start, `LocalNativeClient` applies it: built-in → passed to `tts_init`; custom → loaded from storage and sent via `set_voice`. MOSS then synthesizes with that voice (`_voice_rows` for custom, the session preset for built-in).

```
Settings: record/upload ─► nativeVoiceStorage.add ─► library list
          select voice    ─► settings.ttsVoice ('builtin:<Name>' | 'custom:<id>')
Session start: createSessionConfig → ttsVoice → LocalNativeClient.connect
   builtin  → tts.init(model, device, voiceName)         → sidecar sets session preset
   custom   → tts.init(model, device); load clip; tts.setReferenceVoice(clip, sr)
Generate: MOSS uses _voice_rows (custom) or session preset (builtin)
```

## Components

### 1. Sidecar protocol & engine

- **`list_tts_voices` (new request)** → **`list_tts_voices_result { voices: string[] }`**.
  - Handler locates the MOSS snapshot via `huggingface_hub.snapshot_download(repo_id=..., local_files_only=True)` (the catalog repo for the model), reads `browser_poc_manifest.json`, and returns `[v["voice"] for v in manifest["builtin_voices"]]`.
  - Must not instantiate `OnnxTtsRuntime` / load ONNX sessions.
  - If the model is not downloaded (`snapshot_download` raises) → return `{ voices: [] }` (not an error).
  - Optional `model` field on the request selects which TTS model's voices to list; defaults to the catalog's voice-capable MOSS model.
- **`tts_init` gains optional `voice: string`** (built-in name).
  - `TtsEngine.init(model_id, device, language, voice="")` sets the backend's per-instance preset voice for this session when `voice` is non-empty. Replace `MossOnnxTtsBackend.PRESET_VOICE` (class/env) usage with an instance attribute (`self.preset_voice`) defaulting to the env/`"Ava"` value; `_resolve_prompt_audio_codes` uses `self.preset_voice` when `_voice_rows is None`.
  - Unknown/empty `voice` → keep the default preset (no error).
- **`set_voice` (existing)** — unchanged; sets `_voice_rows` from the clip, overriding the preset for the session.

### 2. Renderer protocol & client

- `nativeProtocol.ts`: add `list_tts_voices` (client msg) and `list_tts_voices_result` (server msg); `tts_init` carries optional `voice`.
- `NativeTtsClient.init(model?, device?, voice?)` includes `voice` in `tts_init`. `setReferenceVoice` already exists.
- A settings-time query path for `list_tts_voices` analogous to `NativeModelClient.list_variants` (so the picker can populate without a running session).

### 3. Built-in voice catalog/curation (`nativeCatalog.ts`)

- `NATIVE_BUILTIN_VOICE_CURATION`: renderer-side metadata keyed by voice name — `{ language?: string; curated?: boolean; unstable?: boolean }`. Authoritative names come from `list_tts_voices`; this map only annotates.
- `defaultTtsVoice(targetLanguage): string` → `'builtin:<Name>'` (en → `'builtin:Ava'`; other languages map to a sensible curated default by name; fall back to `'builtin:Ava'`).
- `curatedBuiltinVoices(targetLanguage, allVoices): { curated: string[]; rest: string[] }` — split the dynamic list into a curated subset (shown by default) and the remainder (behind "show all"), ordered for display.
- Capability flag: `nativeTtsModelIsVoiceCapable(modelId)` (true for MOSS; false for piper/icefall A-class). Drives whether the Voice section renders.

### 4. Custom voice storage (`nativeVoiceStorage.ts`)

- IndexedDB object store `native-voices` (autoincrement `id`): `{ id, name, audio: ArrayBuffer (Float32 PCM), sampleRate, createdAt }`.
- API: `listNativeVoices()`, `addNativeVoice(name, Float32Array, sampleRate)`, `renameNativeVoice(id, name)`, `deleteNativeVoice(id)`, plus a test reset helper.
- Name uniquification mirrors `voiceStorage.uniquifyName`.

### 5. Settings (`settingsStore.ts`)

- `localNative.ttsVoice: string` (default `''`). `''` means "use the per-language default".
- `createSessionConfig` (LOCAL_NATIVE branch) adds `ttsVoice: settings.ttsVoice` **verbatim** (may be `''`, `'builtin:<Name>'`, or `'custom:<id>'`). Reconciliation to a concrete voice happens in `LocalNativeClient.connect` (the single reconciliation point), because it needs the async custom-voice list from IndexedDB which the synchronous store cannot read.
- `IClient.LocalNativeSessionConfig` gains `ttsVoice?: string`.

### 6. Reconciliation (`nativeTtsVoiceReconciliation.ts`)

- `reconcileTtsVoice(ttsVoice, customVoiceIds, targetLanguage): string` — if `ttsVoice` is `'custom:<id>'` and `<id>` is absent, return `defaultTtsVoice(targetLanguage)`; if `''`, return `defaultTtsVoice(targetLanguage)`; otherwise pass through. Mirrors `supertonicSidReconciliation`.

### 7. Session wiring (`LocalNativeClient.ts`)

- In `connect`, after determining the TTS model is enabled: `const voice = reconcileTtsVoice(config.ttsVoice, ids, config.targetLanguage)`.
  - `builtin:<Name>` → `await this.tts.init(config.ttsModelId, config.ttsDevice, name)`.
  - `custom:<id>` → `await this.tts.init(config.ttsModelId, config.ttsDevice)`, then load the clip via `nativeVoiceStorage.getNativeVoice(id)` and `await this.tts.setReferenceVoice(float32, sampleRate)`.
- Applied before any generation; no mid-session changes.

### 8. UI — generalized `VoiceLibrarySection`

- Normalized model the component consumes:
  - `VoiceEntry { id: string; label: string; group: 'builtin' | 'custom'; removable: boolean; meta?: { gender?: 'M'|'F'; curated?: boolean; unstable?: boolean; language?: string } }`
  - `VoiceLibraryCapability { importModes: ('upload'|'record')[]; curation: boolean }`
  - Props: `voices, selectedId, onSelect(id), onImport(file), onRecord(clip), onRename(id, name), onDelete(id), capability, isSessionActive`.
- Rendering: a built-in group (curated, with a "show all" expander when `capability.curation` and there are non-curated entries; unstable entries flagged), a custom group, and import controls (upload always; a record button when `'record' ∈ importModes`).
- The component treats `id` as **opaque** — each adapter defines and interprets its own id scheme.
- **Supertonic adapter** (in `ProviderSpecificSettings`): preset voices → `group:'builtin'`, imported → `group:'custom'`, with ids encoding their `sid`; `importModes:['upload']`, `curation:false`. Existing behavior preserved (the adapter maps the component's `id`/callbacks back to the current sid-based props).
- **Native adapter** (in `NativeModelManagementSection`, TTS group): built-in names→`builtin:<Name>`, custom→`custom:<id>`; `importModes:['record','upload']`, `curation:true`. Rendered only when `nativeTtsModelIsVoiceCapable(selected TTS model)`.
- Recording uses `ModernAudioRecorder` (validate ~3–20s, non-silent → Float32 PCM). Upload decodes via `AudioContext.decodeAudioData` → Float32 PCM (downmix to mono).

## Data Flow

1. **Library management (Settings):** record/upload → validate → `nativeVoiceStorage.add` → list refreshes. Rename/delete operate on custom entries.
2. **Selection (Settings):** picking any voice sets `settings.ttsVoice`. Built-in list is the dynamic `list_tts_voices` result annotated/curated by `nativeCatalog`.
3. **Session start:** `createSessionConfig` carries `ttsVoice`; `LocalNativeClient.connect` reconciles and applies it (init `voice` for built-in, `set_voice` for custom).
4. **Generation:** unchanged; MOSS uses the session's `_voice_rows`/preset.

## Error Handling

- Recording: too short/long or silent → reject with a localized message; nothing stored.
- Upload: `decodeAudioData` failure or unsupported file → message; nothing stored.
- Selected custom voice deleted → `reconcileTtsVoice` falls back to the default built-in (no session failure).
- `list_tts_voices` empty (model not downloaded) → built-in picker shows a "download the model first" hint; default still resolvable once downloaded.
- Unstable built-in voices remain selectable behind "show all" with a flag noting possible silence/runaway until #277.
- `set_voice`/`tts_init` errors at session start surface via the existing `onError` path and disable TTS for the session (current behavior), without crashing ASR/translation.

## Testing

Sidecar (pytest):
- `list_tts_voices` reads names from `browser_poc_manifest.json` without loading ONNX; returns `[]` when the snapshot is absent.
- `tts_init` with `voice` sets the session preset; empty/unknown keeps default; `set_voice` still overrides.

Renderer (vitest):
- `nativeVoiceStorage` CRUD + name uniquification.
- `reconcileTtsVoice`: deleted custom → default; `''` → default; valid → pass-through.
- `settingsStore`: `ttsVoice` default `''`, updatable, session config carries the resolved concrete value.
- `NativeTtsClient`: `init` forwards `voice` in `tts_init`; `setReferenceVoice` sends binary + `set_voice`.
- `LocalNativeClient`: built-in path calls `tts.init(model, device, name)`; custom path calls `init` then `setReferenceVoice` with the stored clip; deleted-custom path falls back.
- `nativeCatalog`: `defaultTtsVoice` per language; `curatedBuiltinVoices` split/order; `nativeTtsModelIsVoiceCapable`.
- Generalized `VoiceLibrarySection`: renders built-in + custom groups; curation expander appears only with `curation:true`; record button only when `'record' ∈ importModes`; Supertonic adapter regression tests stay green.

## Build Order (for the plan)

1. Sidecar `list_tts_voices` + `tts_init` voice param (per-instance preset).
2. Renderer protocol/client (`list_tts_voices`, `init(voice)`), `nativeCatalog` curation/default/capability.
3. `settingsStore.ttsVoice` + session config + `IClient`.
4. `LocalNativeClient` built-in voice wiring (built-in picker end-to-end shippable here).
5. `nativeVoiceStorage` + `reconcileTtsVoice`.
6. Generalized `VoiceLibrarySection` + Supertonic adapter (regression) + native adapter (built-in picker UI).
7. Custom cloning: record/upload capture, storage wiring, `LocalNativeClient` custom path (cloning end-to-end shippable here).

## Out of Scope

- Silence governance / runaway mitigation (tracked in #277).
- Per-language curated lists beyond English are best-effort (name-based); refinement is follow-up.
- Voice sharing/export, cloud sync, multi-clip averaging.
