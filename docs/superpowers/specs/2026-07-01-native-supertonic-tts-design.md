# Native Supertonic-3 TTS Backend (Design)

**Date:** 2026-07-01
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)
**Tracking:** issue #129 (native sherpa-onnx + transformers for Electron); relates to the native TTS stage (`2026-06-29-native-tts-backend-design.md`), the TTS voice-selection design (`2026-06-29-native-tts-voice-selection-design.md`), and the local-inference UI unification (`2026-06-30-local-inference-ui-unification-design.md`).

## Summary

Add **Supertonic 3** as a third native TTS backend in the Electron Python sidecar, alongside `sherpa_tts` (A-class, non-cloning one-shot) and `moss_onnx` (B-class, autoregressive streaming + reference-clip cloning). Supertonic is a **non-autoregressive 4-stage raw-onnxruntime diffusion pipeline** (`duration_predictor → text_encoder → vector_estimator ×16 → vocoder`, fp32), a direct port of the already-shipped WASM worker `src/lib/local-inference/workers/supertonic-tts.worker.ts`.

The backend runs on onnxruntime in the shared cu128 venv (no new dependency). It plugs into the existing seam (catalog `TtsModel` row → `accel.resolve_tts` → `TtsEngine` → `list_tts_voices` → renderer card), and the renderer reuses the existing native `'list'` voice shape plus the shared `VoiceLibrarySection`, so the native Supertonic model card is structurally identical to the WASM (LOCAL_INFERENCE) Supertonic card, including custom voice import.

### Measured evidence (RTX 4070 SUPER, 10 s audio, 16 diffusion steps, best of 3)

| precision / EP | RTF | wall | vector_estimator ×16 | vocoder |
|---|---|---|---|---|
| fp32 / CPU  | 3.65× | 2740 ms | 2593 ms | 138 ms |
| **fp32 / CUDA** | **63.74×** | 157 ms | 145 ms | 7.1 ms |
| fp16 / CUDA | 59.18× | 169 ms | 155 ms | 8.5 ms |

Supertonic is the most GPU-friendly of the native TTS candidates (non-AR, compute-dense ConvNeXt diffusion): fp32/CUDA is **17× faster than CPU** and already fully real-time. **fp16 gives no benefit** on this hardware (the ConvNeXt compute is already fast in fp32/TF32; the model is small enough that fp16 bandwidth savings do not pay for the `keep_io_types` cast overhead). Therefore native Supertonic ships the **fp32** ONNX as published (no self-export, no fp16 conversion).

## Goals

- A native Supertonic TTS backend that composes per-stage with the existing ASR/translate selection, with GPU (CUDA EP) and CPU tiers via the existing resolver.
- The 10 built-in preset voices (F1–F5, M1–M5 → Sarah, Lily, Jessica, Olivia, Emily, Alex, James, Robert, Sam, Daniel), single-sourced from the sidecar.
- **Full parity with the WASM Supertonic card**, including custom voice import (upload a pre-computed `style_ttl`/`style_dp` JSON), reusing the shared `VoiceLibrarySection` and the renderer `voiceStorage` (IndexedDB).
- No new sidecar dependency (pure onnxruntime, shared venv).

## Non-goals

- fp16 / int8 / TensorRT variants (fp16 measured no benefit; int8 is not published and is a CPU-only format).
- A style-encoder in the app (there is none in the Supertonic export; custom voices are pre-computed JSONs produced by the external Supertone Voice Builder, exactly as in WASM).
- Merging the WASM and native model/voice components (the UI-unification design explicitly keeps two parallel component trees; this design follows that decision).
- Changing any WASM Supertonic behavior.

## Background

Supertonic already ships in the WASM (LOCAL_INFERENCE) provider as `engine: 'supertonic'` (`modelManifest.ts`), running a dedicated raw-ORT worker (not sherpa `OfflineTts`). Its voice model:

- **10 named presets** (sid 0–9 = F1–F5, M1–M5), shown in a gender-annotated dropdown.
- **Custom import**: upload a JSON containing `style_ttl` (1×50×256) and `style_dp` (1×8×16) tensors — validated by `voiceStorage.ts` (`validateVoiceFile`), stored in the shared `sokuji-models` IndexedDB (`voice_styles` store), assigned sid = `dbKey + 10` (`sidMapping.ts`). There is **no style encoder**; the app never derives style vectors from audio.
- UI: the shared `VoiceLibrarySection` with capability `{ importModes: ['upload'], curation: false, presentation: 'dropdown' }`.

Native has three voice "shapes" (`nativeCatalog.ts` `voiceShape`, rendered by `NativeVoiceSection.tsx`): `'list'` (MOSS: built-in names from `list_tts_voices` + custom voices, dropdown), `'range'` (multi-speaker VITS: numeric speaker-id slider), `'none'` (single-voice Piper). The `'list'` shape already renders the dropdown + custom voices; Supertonic reuses it. The one difference: MOSS's `'list'` custom-voice import is a reference *audio clip* (`setReferenceVoice`), whereas Supertonic's is an *uploaded JSON* — the native voice section will honor `importModes` to select the right affordance and apply path.

Supertonic does not exist in the native catalog, sidecar protocol, or `nativeCatalog.ts` today.

## Architecture

```
renderer (NativeModelManagementSection → NativeModelCard → NativeVoiceSection)
   │  set_voice { voice:name | sid | styleVoice(+binary) }  /  tts_generate → result
   ▼
tts_engine.py        process singleton (existing); threads init `language` to the backend
   ├─ accel.resolve_tts("supertonic-3")   reuse probe/tiers/Plan/load_with_fallback/bench
   ├─ catalog.tts_models()                new TtsModel row
   └─ tts_backends.py                      new SupertonicBackend (raw multi-graph ORT, 4-stage)
native_models.py     download spec (repo Supertone/supertonic-3, ignore audio_samples/* + img/*)
tts_voices.py        list_tts_voices("supertonic-3") → the 10 presets (names/genders single-sourced here)
```

### Backend contract (`SupertonicBackend`)

Class attributes: `NAME = "supertonic"`, `STREAMING = False`, `CLONES = False`, `sample_rate = 44100`.

- `load(model_ref, device, compute_type)`: `snapshot_download(local_files_only)` the repo; build 4 `InferenceSession`s (`duration_predictor`, `text_encoder`, `vector_estimator`, `vocoder`) with `providers=["CUDAExecutionProvider","CPUExecutionProvider"]` when `device == "cuda"` else `["CPUExecutionProvider"]`; load `onnx/tts.json`, `onnx/unicode_indexer.json`, and the 10 `voice_styles/*.json`. On any failure raise `BackendLoadError` (resolver falls back to CPU).
- `set_language(lang)`: store the target language for the `<lang>…</lang>` frontend tag (defaults to `<na>` language-agnostic when unset/unsupported). Threaded from `tts_init`'s `language`.
- `set_builtin_voice(name)` / `set_speaker(sid)`: select a preset's `style_ttl`/`style_dp` (sid order = `PRESET_VOICE_ORDER` F1..M5, mirroring `sidMapping.ts`).
- `set_style_voice(style_ttl, style_dp)`: apply uploaded custom style vectors (numpy arrays) for the next generate.
- `generate(text, speed)` → `(np.float32 samples @ 44100, gen_ms)`: run the ported pipeline — text frontend (NFKD, emoji strip, char replacements, `<lang>` wrap, `unicode_indexer`) → `duration_predictor` → `text_encoder` → Box-Muller noisy latent → `vector_estimator ×16` → `vocoder`. The engine resamples 44100→24000 Int16 (existing `_to_int16_24k_mono`).
- `list_builtin_voices()`: the 10 presets `{voice, language, gender, ...}` (used by `tts_voices.list_builtin_voices`), names matching WASM (Sarah…Daniel).
- `unload()`, `is_loaded`, `sample_rate`.

### Voice facts single-sourcing

The 10 preset names/genders live in the sidecar (a `_SUPERTONIC_VOICES` table in `tts_voices.py`, consistent with `_VOICE_META` for MOSS and the recent "single-source native facts from the sidecar" work). `list_tts_voices("supertonic-3")` returns them; the renderer's `'list'` dropdown renders them. Preset sid↔file mapping (F1..M5) lives in the backend. Names/genders match the WASM manifest for cross-provider consistency.

### Custom voice storage & apply

Custom voices are stored **renderer-side** in the shared `voiceStorage` (IndexedDB `sokuji-models` / `voice_styles` store) — the same store WASM Supertonic uses, so "My Voices" is shared across both providers and survives sidecar restarts. On selection of a custom voice, the renderer sends its `style_ttl`/`style_dp` to the sidecar via an extended `set_voice`:

- `NativeTtsClient.setStyleVoice(style_ttl, style_dp)`: send the two float32 arrays as one binary frame (~51 KB) followed by a `{ type: 'set_voice', styleVoice: { ttlDims, dpDims } }` control message (mirroring `setReferenceVoice`'s binary-frame-then-control pattern).
- `nativeProtocol.ts`: extend the `set_voice` message with the `styleVoice` variant.
- Sidecar `_h_set_voice`: when the message carries `styleVoice`, decode the binary frame into `style_ttl`/`style_dp` (per the dims) and call `backend.set_style_voice(...)`.

### Renderer voice shape

`nativeCatalog.ts` `voiceShape` routes Supertonic to `'list'`. Supertonic is `clones=False` yet needs the named-preset + upload library, so the routing is driven by an **explicit capability derived from the catalog** (named presets present + `importModes: ['upload']`), not a `"supertonic"` string special-case. `NativeVoiceSection` renders `VoiceLibrarySection` with `{ importModes: ['upload'], curation: false, presentation: 'dropdown' }` — identical to `LocalInferenceVoiceSection`'s Supertonic branch. Preset selection → `setVoice(name)`; imported selection → `setStyleVoice(vectors)` read from `voiceStorage`; sid encoding reuses `sidMapping` (presets 0–9, imported `dbKey+10`).

## File map

- **New:** `SupertonicBackend` in `sidecar/sokuji_sidecar/tts_backends.py` (port of the worker's 4-stage pipeline + text frontend).
- **Edit (sidecar):** `catalog.py` (Supertonic `TtsModel` row + `SUPERTONIC_LANGS`), `native_models.py` (download spec ignore `audio_samples/*` + `img/*`), `accel.py` (`supertonic` `_installed()` row + RTF bench registration), `tts_voices.py` (`_SUPERTONIC_VOICES` presets + `list_builtin_voices` dispatch), `tts_engine.py` (thread `language` to the backend via `set_language`), `server.py`/`_h_set_voice` (decode the `styleVoice` binary variant).
- **Edit (renderer):** `nativeProtocol.ts` (`set_voice` `styleVoice` variant), `NativeTtsClient.ts` (`setStyleVoice`), `nativeCatalog.ts` (`voiceShape` → `'list'` for Supertonic via capability), `NativeVoiceSection.tsx` (Supertonic branch → `VoiceLibrarySection` with upload capability; apply via `voiceStorage` + `setStyleVoice`).
- **Reuse (no change):** `VoiceLibrarySection.tsx`, `voiceStorage.ts`, `sidMapping.ts`.

## Testing

- **Sidecar** (`.venv/bin/python -m pytest`):
  - `SupertonicBackend`: load with a fixture/mocked sessions; text frontend + `unicode_indexer` correctness (a known string → expected token ids); preset apply (sid→style vectors) and `set_style_voice`; `generate` returns float32 @ 44100 with the expected sample count for a fixed latent length; missing preset → default sid fallback.
  - `catalog`: Supertonic row present with `num_speakers=10`, `clones=False`, `streaming=False`, `sample_rate=44100`, both deployments; `download_specs("supertonic-3")` includes the repo and the `audio_samples/*`+`img/*` ignore patterns.
  - `tts_voices`: `list_tts_voices("supertonic-3")` returns the 10 named presets with genders.
  - `accel`: resolver picks `gpu-cuda` then `cpu` for `supertonic`.
- **Renderer** (`npx vitest run`):
  - `nativeCatalog`: `voiceShape("supertonic-3")` → `'list'`; capability = `{ importModes:['upload'], presentation:'dropdown' }`.
  - `NativeVoiceSection`: Supertonic branch renders `VoiceLibrarySection` with the same capability as the WASM `LocalInferenceVoiceSection` Supertonic branch (characterization mirroring the WASM test); preset select → `setVoice(name)`; imported select → `setStyleVoice`.
  - `NativeTtsClient`: `setStyleVoice` sends the binary frame + `styleVoice` control message.
  - `voiceStorage` reuse: import/rename/delete + sid reconcile on delete behave for native as for WASM (no regression to WASM).

## Global constraints

- TypeScript strict; English-only comments/docs. Conventional commits. Tests (vitest / pytest) are the correctness gate; `tsc` is not repo-clean and is not a gate.
- No new sidecar dependency; Supertonic runs on the existing onnxruntime in the shared cu128 venv. GPU uses `onnxruntime-gpu` (CUDA EP); CPU is the floor.
- **Do not regress** the WASM Supertonic card, the shared `VoiceLibrarySection`/`voiceStorage`/`sidMapping`, or the native MOSS/VITS/Piper voice shapes.
- Ship the published fp32 ONNX as-is (no self-export, no fp16 conversion).
- Preset names/genders match the WASM manifest (Sarah…Daniel).
- Commits stay local (no push/PR without explicit consent).
