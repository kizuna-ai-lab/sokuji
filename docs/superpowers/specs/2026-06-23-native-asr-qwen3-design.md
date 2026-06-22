# Native ASR: Qwen3-ASR-1.7B (GPU tier) Design

## Context

The LOCAL_NATIVE provider's ASR catalog has Whisper (broad multilingual via faster-whisper/CTranslate2), SenseVoice (zh/en/ja/ko/yue, CPU), and Granite Speech 4.1 (a GPU speech-LLM). A research sweep (the `speech-llm-asr-backends` workflow) compared the next speech-LLM ASR candidates and recommended **Qwen3-ASR** as the best value/effort: open Apache-2.0 weights, SOTA accuracy especially on **CJK** plus **context biasing**, with a clean Python API.

This increment adds **Qwen3-ASR-1.7B on a GPU tier only**. Its value is *accuracy* (CJK + context), not raw language count — Whisper already covers breadth. The CPU 0.6B sherpa-onnx tier is real but deferred to a fast-follow (it needs a separate backend class plus net-new GitHub-tarball download plumbing); see Non-Goals.

Builds on the proven AsrBackend adapter + declarative catalog + GPU-first resolver (Phase 0–2, running Granite/Whisper/SenseVoice on an RTX 4070 SUPER 12 GB).

## Locked decisions

- **GPU tier only** this increment (`gpu-cuda` deployment); no CPU deployment row.
- **`recommended=True`** on `qwen3-asr-1.7b`; do **not** demote SenseVoice or Whisper (GPU-less users still resolve to them).
- **New `Qwen3AsrBackend` class** — do not extend `TransformersBackend` (different model class, custom processor, and a conflicting transformers pin).
- **Language**: pass the user's source language explicitly (mapped to Qwen's full-name string) when set; pass `None` (native auto-detect) when unset. `context=""` (no hotword UI yet).

## Dependency spike — GATES the build (do first)

`qwen-asr==0.0.6` (Apache 2.0) is reported to pin `transformers==4.57.6`. Our sidecar venv runs **transformers 5.12.1** (installed for Granite) with **torch 2.11.0+cu128**. `sherpa_onnx 1.13.3` is already present (irrelevant to the GPU tier).

**Task 0 (spike), before writing any backend code.** Never `pip install qwen-asr` into the main venv first — its pin would downgrade transformers from 5.12.1 and could break Granite. Instead, in a **throwaway venv** (or via PyPI metadata), determine:

1. Is qwen-asr's `transformers` requirement a hard `==4.57.6`, or a floor (`>=`)?
2. Does qwen-asr actually run on 5.12.1?
3. Does Granite (`AutoModelForSpeechSeq2Seq`, granite-speech-4.1) still run on 4.57.6?

Outcomes:
- **Coexist on one transformers version** → single venv, lazy import like Granite. Proceed with the design below unchanged.
- **Cannot coexist** → the GPU Qwen3-ASR backend needs **isolation** (a separate venv invoked via subprocess, or a second sidecar process). This changes the architecture; **stop and surface to the user** with the spike evidence before building further.

Document the spike result and the chosen path. Everything below assumes the coexistence outcome; the isolation contingency is a separate design conversation if the spike forces it.

## Architecture

One new `AsrBackend` adapter, registered alongside the existing three. The resolver, RTF benchmark, catalog, download manager, and renderer catalog are unchanged in shape — we add one model (two-ish data rows) and one backend class, mirroring how Granite was added.

```
VAD float32 @16k segment ─▶ Qwen3AsrBackend.transcribe(samples, language) ─▶ text ─▶ translate ─▶ TTS
                                   │
                          qwen_asr.Qwen3ASRModel (bf16, device_map=cuda)
```

## Components

### 1. `Qwen3AsrBackend` — `sidecar/sokuji_sidecar/backends.py`

Mirror the Granite `TransformersBackend` shape (lazy heavy import, `BackendLoadError(reason)` on failure, `@register_backend`). Uses the `qwen-asr` package directly.

```python
_QWEN_LANG = {
    "zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean",
    "yue": "Cantonese", "ar": "Arabic", "de": "German", "es": "Spanish",
    "fr": "French", "it": "Italian", "pt": "Portuguese", "ru": "Russian",
    "th": "Thai", "vi": "Vietnamese", "hi": "Hindi", "id": "Indonesian",
}

@register_backend
class Qwen3AsrBackend:
    NAME = "qwen3asr"

    def load(self, model_ref, device, compute_type):
        # GPU-only this increment; the CPU tier is the deferred sherpa path.
        if device == "cpu":
            raise BackendLoadError("qwen3asr is GPU-only (no CPU deployment)")
        try:
            import torch
            from qwen_asr import Qwen3ASRModel
            dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            self._model = Qwen3ASRModel.from_pretrained(
                model_ref, dtype=dtype, device_map=device,
                max_inference_batch_size=1, max_new_tokens=256)
        except Exception as e:
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language):
        # `samples` is the engine's VAD segment. qwen-asr requires float32 @16k in
        # [-1, 1]; convert iff the engine passes int16 (match the existing backends'
        # convention — confirm asr_engine's dtype during implementation).
        lang = _QWEN_LANG.get((language or "").lower()) or None
        results = self._model.transcribe(audio=(samples, 16000), language=lang, context="")
        r = results[0]
        return AsrResult(r.text.strip(), getattr(r, "language", language))

    def unload(self):
        self._model = None
        try:
            import torch; torch.cuda.empty_cache()
        except Exception:
            pass
```

Notes:
- `_QWEN_LANG` maps our ISO source codes to Qwen's full-name strings; an unknown/empty hint yields `None` (auto-detect). Keep the map to the languages the catalog advertises.
- `max_new_tokens=256` matches the qwen-asr default; revisit if long CJK segments truncate (Risks).

### 2. Catalog row — `sidecar/sokuji_sidecar/catalog.py` (append to `ASR_MODELS`)

```python
AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
         ("zh", "en", "ja", "ko", "yue", "ar", "de", "es", "fr", "it",
          "pt", "ru", "th", "vi", "hi", "id"),
         (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "Qwen/Qwen3-ASR-1.7B", 1.0),),
         recommended=True, sort_order=7),
```

- Single `gpu-cuda` deployment (no CPU row this increment). `artifact` = the HF repo `Qwen/Qwen3-ASR-1.7B` (qwen-asr's `from_pretrained` model_ref).
- `sort_order=7` places it after Granite (5/6).
- `recommended=True`; SenseVoice/Whisper keep their existing flags (no demotion).
- Languages are a curated subset of the model's 52 (the major + CJK set we advertise as source-compatible); the model still auto-detects others at runtime. Expandable later.

### 3. Download mapping — `sidecar/sokuji_sidecar/native_models.py`

Add an **explicit** branch in `download_specs`, before the bare-id fallthrough (the fallthrough would use the bare id as the repo → the known silent-`ready` failure mode):

```python
if model_id == "qwen3-asr-1.7b":
    return {"repos": ["Qwen/Qwen3-ASR-1.7B"], "urls": []}
```

`model_status`/`model_size` work unchanged (standard HF snapshot). No tarball path needed (that's the deferred CPU tier).

### 4. Renderer catalog — `src/lib/local-inference/native/nativeCatalog.ts` (`NATIVE_ASR`)

```typescript
{ id: 'qwen3-asr-1.7b', /* name/label per existing row shape */
  languages: ['zh','en','ja','ko','yue','ar','de','es','fr','it','pt','ru','th','vi','hi','id'],
  recommended: true, sortOrder: 7 },
```

Match the exact existing `NATIVE_ASR` row shape (Granite rows are the template). `tierLabel('gpu-cuda')` already exists — no new UI plumbing. The languages array must equal the sidecar catalog's tuple (the Granite-increment review checks this verbatim).

### 5. Language threading

`asr_engine` already passes the source-language hint into `backend.transcribe(samples, language)` (Granite uses it). The backend maps it via `_QWEN_LANG`. No engine change beyond confirming the hint reaches the backend.

## Error handling

- Load failure (import error, missing transitive deps, OOM, no CUDA) → `BackendLoadError(reason)`; the resolver demotes and the `load_with_fallback` chain lands on Whisper/SenseVoice.
- `device == "cpu"` → `BackendLoadError` (GPU-only this increment) — so an Auto resolve on a GPU-less machine never tries this backend.
- Download: the explicit `download_specs` branch + the already-shipped global "fail loud on a no-op download" guard.

## Testing

- **pytest (no model)**: catalog row present and well-formed; `download_specs("qwen3-asr-1.7b")["repos"] == ["Qwen/Qwen3-ASR-1.7B"]`; `make_backend("qwen3asr")` registers; `_QWEN_LANG` mapping (e.g. `ja`→`Japanese`, unknown→`None`); GPU-only hard-fail (`load(..., device="cpu", ...)` raises `BackendLoadError`) with `qwen_asr` import mocked.
- **GPU-gated real smoke** (`SOKUJI_RUN_GPU=1`): load `Qwen/Qwen3-ASR-1.7B`, transcribe a ~3 s clip, assert non-empty text + measure RTF; skipped without the flag/model.
- **renderer vitest**: the new `nativeCatalog.ts` row (id/languages/recommended/sortOrder); `gpuTierAvailable`/compat helpers still pass; update `incompatibleNativeAsr`-style assertions if the new language set shifts them.
- **build**: `npm run build`.

## Global constraints

- vitest / pytest are the correctness gates (not tsc).
- GPU-only deployment this increment; `recommended=True` without demoting SenseVoice/Whisper.
- Reuse the Granite `TransformersBackend` pattern: lazy heavy import, `BackendLoadError`, `@register_backend`, `device_map`/`.to(device)`.
- The renderer language array must match the sidecar catalog tuple verbatim.
- English-only comments. Conventional Commits. No pushing/PR without explicit consent.
- Task 0 dependency spike gates the build; the isolation contingency is a separate design conversation.

## Non-goals (deferred)

- **CPU 0.6B sherpa tier** — a fast-follow: a new `Qwen3SherpaBackend` (`OfflineRecognizer.from_qwen3_asr`, not SenseVoice's constructor) **plus** a GitHub-release-tarball download/status path in `native_models.py` (the model isn't an HF snapshot). This is the bulk of the CPU work and is intentionally out of scope here.
- Context-bias / hotword UI (`context=""` for now).
- flash-attn (optional ~10–20% throughput; needs a CUDA build step).
- Expanding the advertised language list to all 52.

## Risks / unknowns

- **[HIGH] transformers pin (4.57.6 vs 5.12.1).** Resolved by Task 0 spike; contingency = venv isolation (separate design).
- **[MED] Heavy transitive deps.** qwen-asr reportedly pulls `nagisa` (MeCab), `soynlp`, and needs a `sox` binary — verify they install in the sidecar venv and ship in the packaged Electron sidecar.
- **[MED] Sequential VRAM.** ~5 GB resident for ASR; must not co-reside with TTS + translation on 12 GB — confirm the sidecar loads/unloads per stage.
- **[LOW] `max_new_tokens` truncation** on long CJK-dense VAD segments (256) — verify against real segment lengths; bump to 512 if needed.
- **[LOW] Sample dtype seam.** Confirm whether `asr_engine` passes int16 or float32 to `transcribe`; qwen-asr needs float32 @16k — convert in the backend if the engine passes int16.
