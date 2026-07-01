# Native Supertonic-3 TTS + Voice Capability Model (Design)

**Date:** 2026-07-01
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)
**Tracking:** issue #129 (native sherpa-onnx + transformers for Electron); relates to the native TTS stage (`2026-06-29-native-tts-backend-design.md`), the TTS voice-selection design (`2026-06-29-native-tts-voice-selection-design.md`), and the local-inference UI unification (`2026-06-30-local-inference-ui-unification-design.md`).

## Summary

Two coupled changes:

1. **A native TTS voice-capability model.** Replace the ad-hoc native voice `shape` (`'none'|'range'|'list'`) with a two-axis capability `voice: { builtin, custom }`, single-sourced from the sidecar catalog. The renderer's voice control, custom-voice storage, and apply-to-sidecar path all derive from the capability — no per-model branches. Existing models (MOSS, VITS, Piper) are retrofitted onto it; **future models (Qwen3-TTS, CosyVoice3, …) integrate by declaring their capability, not by adding UI branches.**

2. **Supertonic 3 as a new native TTS backend.** A non-autoregressive 4-stage raw-onnxruntime diffusion pipeline (`duration_predictor → text_encoder → vector_estimator ×16 → vocoder`, fp32, CPU/CUDA EP), a torch-free port of the WASM worker `src/lib/local-inference/workers/supertonic-tts.worker.ts`. It is the first `custom: 'style'` model and validates the capability model.

The backend runs on onnxruntime in the shared cu128 venv (no new dependency) and plugs into the existing seam (catalog `TtsModel` → `accel.resolve_tts` → `TtsEngine` → `list_tts_voices`).

### Measured evidence (RTX 4070 SUPER, 10 s audio, 16 diffusion steps, best of 3)

| precision / EP | RTF | wall | vector_estimator ×16 | vocoder |
|---|---|---|---|---|
| fp32 / CPU  | 3.65× | 2740 ms | 2593 ms | 138 ms |
| **fp32 / CUDA** | **63.74×** | 157 ms | 145 ms | 7.1 ms |
| fp16 / CUDA | 59.18× | 169 ms | 155 ms | 8.5 ms |

fp32/CUDA is 17× faster than CPU and fully real-time; **fp16 measured no benefit** (ConvNeXt compute is already fast in fp32/TF32; model is small enough that fp16 bandwidth savings don't pay for the cast overhead). Native Supertonic ships the published **fp32** ONNX as-is (no self-export).

## Goals

- One voice-capability model (`{ builtin, custom }`) that drives all native TTS voice UI/storage/apply, single-sourced from the sidecar.
- Retrofit MOSS / VITS / Piper onto it with **no behavior change**.
- Add Supertonic 3 (GPU CUDA + CPU tiers), the first `custom: 'style'` model, with 10 named presets + custom style-vector JSON import, reusing the shared `VoiceLibrarySection` and renderer `voiceStorage`.
- Future models slot in by declaring capability (`{named, clip}` for Qwen3-TTS/CosyVoice3) with zero new renderer branches.
- No new sidecar dependency (pure onnxruntime, shared venv).

## Non-goals

- fp16 / int8 / TensorRT Supertonic variants (fp16 measured no benefit; int8 is CPU-only).
- Implementing Qwen3-TTS / CosyVoice3 here (only their fit into the capability model is designed).
- A style encoder in the app (Supertonic has none; custom voices are pre-computed JSONs from the external Supertone Voice Builder, as in WASM).
- Changing WASM Supertonic behavior.

## The voice-capability model

```
voice: {
  builtin: 'none' | 'range' | 'named'    // how a built-in voice is chosen
  custom:  'none' | 'clip'  | 'style'    // how a user adds a custom voice
}
```

- **`builtin`** — `none` (single voice), `range` (numeric speaker-id slider), `named` (named presets in a dropdown, names from `list_tts_voices`).
- **`custom`** — `none` (no custom voices), `clip` (reference **audio**: record + upload → runtime encodes → `setReferenceVoice`), `style` (upload a pre-computed **style-vector JSON**, no encoder → `setStyleVoice`).

Everything downstream is derived — nothing keys off model identity:

| concern | derivation |
|---|---|
| control shown | `builtin==='range'` → speaker slider; else → `VoiceLibrarySection` dropdown |
| import affordance | `custom==='clip'` → record + upload `audio/*`; `'style'` → upload `.json`; `'none'` → none |
| custom-voice store | `clip` → `nativeVoiceStorage` (audio); `style` → `voiceStorage` (JSON) |
| apply to sidecar | preset → `setVoice(name)`; `clip` → `setReferenceVoice(audio,sr)`; `style` → `setStyleVoice(ttl,dp)` |

### Model → capability map (present + future)

| model | `builtin` | `custom` |
|---|---|---|
| Piper (single) | none | none |
| VITS (multi-speaker) | range | none |
| MOSS (today) | named | clip |
| **Supertonic (this task)** | named | style |
| Qwen3-TTS (future) | named | clip |
| CosyVoice3 (future) | none / named | clip |

Adding Qwen3-TTS later = declare `{named, clip}` → reuses MOSS's entire path. A genuinely new custom mechanism = one new `custom` value + its store/apply, once.

### `ttsVoice` encoding (unchanged, uniform)

Native keeps the single opaque `settings.ttsVoice` string, uniform across all models:
- `builtin:<Name>` — a named preset (`setVoice(name)`).
- `custom:<id>` — a custom voice; `<id>` is the active store's key (audio store for `clip`, JSON store for `style`).
- `sid:<n>` — a `range` speaker id (`setSpeaker(n)`).
- `''` — the language default.

The active custom store is selected by the model's `custom` kind, so `custom:<id>` is unambiguous. (WASM's sid+10 `sidMapping` is a WASM-`ttsSpeakerId` concept and is **not** used natively.)

## Architecture

```
renderer
  NativeModelManagementSection → NativeModelCard body → NativeVoiceSection   (switch on voice capability)
     custom voices via  voiceStoreFor(capability.custom)  →  { list, add, rename, delete, resolveApply }
  LocalNativeClient: reconcile ttsVoice → apply (setVoice | setSpeaker | setReferenceVoice | setStyleVoice)
     │  set_voice { voice:name | sid | styleVoice(+binary) }  /  tts_generate → result
     ▼
tts_engine.py   process singleton; threads init `language` to the backend
  ├─ accel.resolve_tts("supertonic-3")   existing resolver
  ├─ catalog.tts_models()                 TtsModel rows + voice_capability()
  └─ tts_backends.py                       SupertonicBackend (raw multi-graph ORT, 4-stage)
native_models.py   download spec (repo Supertone/supertonic-3, ignore audio_samples/* + img/*)
tts_voices.py      list_tts_voices("supertonic-3") → 10 presets (names/genders single-sourced here)
```

### Sidecar — capability single-sourcing

`TtsModel` gains two static flags: `named_voices: bool` and `style_voices: bool`. A helper `catalog.voice_capability(model) -> {"builtin", "custom"}`:

- `custom` = `'clip'` if `model.clones` else `'style'` if `model.style_voices` else `'none'`.
- `builtin` = `'named'` if `model.named_voices` else `'range'` if `model.num_speakers > 1` else `'none'`.

Rows: MOSS `named_voices=True` (clones already True → clip); Supertonic `named_voices=True, style_voices=True`; VITS multi (num_speakers>1) → auto `range`; single Piper → `none`. `models_catalog` emits `"voice": voice_capability(mdl)` per TTS model.

### Sidecar — `SupertonicBackend`

`NAME="supertonic"`, `STREAMING=False`, `CLONES=False`, `sample_rate=44100`.
- `load`: snapshot the repo; 4 ORT sessions (`provider=cuda|cpu`); load `tts.json`, `unicode_indexer.json`, 10 preset `voice_styles/*.json`.
- Text frontend (ported from the worker): NFKD, emoji strip, char replacements, `<lang>…</lang>` wrap (from `tts_init` `language`, `<na>` fallback), `unicode_indexer`.
- Diffusion: Box-Muller noisy latent → `vector_estimator ×16` → `vocoder`; engine resamples 44100→24k Int16.
- Voices: `set_speaker(sid)`/`set_builtin_voice(name)` → preset style vectors; `set_style_voice(style_ttl, style_dp)` → uploaded custom; `list_builtin_voices()` → 10 presets (names Sarah…Daniel, genders F×5/M×5).

### Renderer — capability-driven voice UI/storage/apply

- `NativeModelInfo` gains `voice: { builtin; custom }` (from the sidecar).
- `nativeCatalog`: replace `voiceShape` with `voiceCapability(model)` reading `model.voice`. Keep `sidFromTtsVoice`/`ttsVoiceForSid` (range).
- **New `nativeVoiceStores.ts`**: a uniform `NativeVoiceStore` interface — `list(): {id,name}[]`, `add(file)`, `rename(id,name)`, `delete(id)`, `resolveApply(id): {kind:'clip',audio,sampleRate} | {kind:'style',styleTtl,styleDp}` — with two implementations (`clip` over `nativeVoiceStorage`, `style` over `voiceStorage`), selected by `voiceStoreFor(custom, modelId)`. Adding a `custom` kind = add one store adapter.
- `NativeVoiceSection`: switch on `capability.builtin`/`capability.custom` — `range` → slider; else → `VoiceLibrarySection` (named presets + custom entries, `importModes` from `custom`). Capture routes to the active store's `add`.
- `NativeModelManagementSection`: pick the store via `voiceStoreFor`, load custom voices, wire import/rename/delete generically. No per-model code.
- `LocalNativeClient`: `custom:<id>` → `store.resolveApply(id)` → `setReferenceVoice` or `setStyleVoice`; `builtin:<Name>` → `setVoice`; `sid:<n>` → `setSpeaker`.
- `NativeTtsClient.setStyleVoice(styleTtl, styleDp)`; `nativeProtocol` `set_voice` gains a `styleVoice: { ttlDims, dpDims }` variant (style vectors sent as one binary frame + dims, mirroring `setReferenceVoice`).
- `nativeTtsVoiceReconciliation`: reconcile `custom:<id>` against the active store's ids, generic over `custom` kind.

## File map

**Sidecar (`sidecar/sokuji_sidecar/`):**
- NEW `supertonic_frontend.py` (text frontend, pure).
- MODIFY `tts_backends.py` (`SupertonicBackend`), `catalog.py` (`named_voices`/`style_voices` fields, `voice_capability()`, Supertonic row + MOSS flag), `native_models.py` (ignore `audio_samples/*`,`img/*`), `accel.py` (`_installed` supertonic; emit `voice` in `models_catalog`), `tts_voices.py` (`_SUPERTONIC_VOICES` + dispatch), `tts_engine.py` (thread `language`; decode `styleVoice`).

**Renderer (`src/`):**
- NEW `lib/local-inference/native/nativeVoiceStores.ts` (`NativeVoiceStore` + clip/style impls + `voiceStoreFor`).
- MODIFY `lib/local-inference/native/nativeProtocol.ts` (`voice` on `NativeModelInfo`; `styleVoice` set_voice variant), `NativeTtsClient.ts` (`setStyleVoice`), `nativeCatalog.ts` (`voiceCapability` replaces `voiceShape`), `nativeTtsVoiceReconciliation.ts` (store-generic), `components/Settings/sections/NativeVoiceSection.tsx` (capability switch), `NativeModelManagementSection.tsx` (store-driven wiring), `services/clients/LocalNativeClient.ts` (capability apply).
- REUSE (no change): `VoiceLibrarySection.tsx`, `voiceStorage.ts`, `nativeVoiceStorage.ts`.

## Testing

- **Sidecar** (`.venv/bin/python -m pytest`): `SupertonicBackend` (frontend+indexer correctness, 4-stage generate @44100, preset/style apply, list presets); `catalog.voice_capability` for MOSS `{named,clip}` / Supertonic `{named,style}` / VITS `{range,none}` / Piper `{none,none}`; Supertonic row; download ignore; `_installed` supertonic; `list_tts_voices("supertonic-3")` presets; `tts_engine` language threading + `styleVoice` decode.
- **Renderer** (`npx vitest run`): `voiceCapability` mapping; `nativeVoiceStores` clip + style impls (`resolveApply` discriminated union); `NativeVoiceSection` renders slider for `range`, `VoiceLibrarySection` for named with the right `importModes` per `custom`; MOSS characterization stays green (no behavior change); `NativeTtsClient.setStyleVoice` protocol; `reconcileTtsVoice` store-generic; `LocalNativeClient` apply per capability.

## Global constraints

- TypeScript strict; English-only comments/docs. Conventional commits. Tests (vitest / pytest) are the correctness gate; `tsc` is not a gate.
- No new sidecar dependency; Supertonic runs on the existing onnxruntime in the shared cu128 venv. GPU = CUDA EP; CPU floor.
- Ship the published Supertonic **fp32** ONNX as-is.
- **No behavior change** for MOSS / VITS / Piper — the retrofit is structural. Add MOSS/VITS characterization tests before relocating logic where practical.
- Preset names/genders match the WASM manifest (Sarah…Daniel; F×5, M×5). `defaultSid=7` (Robert). `totalStep=16`.
- Do not regress the shared `VoiceLibrarySection` / `voiceStorage` / `nativeVoiceStorage` or WASM Supertonic.
- Commits stay LOCAL (no push/PR).
