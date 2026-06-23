# Native ASR: Cohere Transcribe (GPU sidecar) — Design

**Status:** Approved design — ready for implementation plan.
**Branch:** `feat/native-asr-cohere` (from `native-sidecar`).
**Date:** 2026-06-24.

## 1. Goal

Run **the same Cohere Transcribe model our browser users already use** in the LOCAL_NATIVE
Python sidecar, full-precision **bf16 on CUDA**, instead of today's 4-bit `q4f16` ONNX/WebGPU
path. The win is parity + hardware: existing Cohere users get the identical model, faster and
at higher quality (no 4-bit weight quantization), by exploiting the GPU.

This is **not** a "should we add a new model" decision — Cohere Transcribe already ships in
LOCAL_INFERENCE (`src/lib/local-inference/workers/cohere-transcribe-webgpu.worker.ts`, model
`onnx-community/cohere-transcribe-03-2026-ONNX`) and has many users. This design is the
GPU-native port of that existing, popular feature.

## 2. Context: what we already have

- **LOCAL_INFERENCE (browser):** `cohere-transcribe-webgpu` runs the model via Transformers.js
  `pipeline('automatic-speech-recognition', …, { device:'webgpu', dtype:'q4f16' })`, Silero VAD,
  batch-per-segment, token streaming. It **requires an explicit source language** (the worker
  throws "Cohere Transcribe requires an explicit source language") — there is no auto-detect.
- **LOCAL_NATIVE (sidecar):** the `AsrBackend` adapter pattern (`load`/`transcribe`/`unload`),
  a `@register_backend` registry, the `accel.py` resolver with a `_installed()` self-gate, the
  `catalog.py` model registry, `native_models.download_specs`, and the renderer
  `nativeCatalog.ts` + `NativeModelManagementSection`. We already shipped two GPU speech-LLM
  ASRs through this path: **Granite Speech 4.1** (`TransformersBackend`) and **Qwen3-ASR**
  (`Qwen3AsrBackend`).

## 3. Verified facts (de-risking complete)

Confirmed by live execution in the actual sidecar venv (`sidecar/.venv`, transformers 5.13.0.dev0):

- `from transformers import CohereAsrForConditionalGeneration` → **OK**, resolves to
  `transformers.models.cohere_asr.modeling_cohere_asr`.
- `importlib.util.find_spec("transformers.models.cohere_asr")` → **present**.
- `Qwen3ASRForConditionalGeneration`, `AutoModelForSpeechSeq2Seq`, `AutoProcessor` all still
  import on the **same** transformers → Cohere **coexists** with Granite + Qwen3 in one venv.

Why there is **no Qwen3-style trap:** `CohereAsr` was merged into transformers **mainline**
(shipped in v5.4.0). It is a first-class class, **not** a separate pip package, so there is no
version pin that could break Granite (unlike `qwen-asr==4.57.6`). The module is already on disk
in our venv because the Qwen3-ASR fork branched from main *after* the Cohere merge. **No venv
changes, no new transformers, no `accelerate`, no `trust_remote_code`.**

Model facts (HuggingFace model card + release blog, `CohereLabs/cohere-transcribe-03-2026`):

| Property | Value |
|---|---|
| Checkpoint | `CohereLabs/cohere-transcribe-03-2026` |
| Weights | safetensors, ~4.13 GB, bf16 |
| Architecture | ~2B, Fast-Conformer encoder (>90% of params) + lightweight Transformer decoder — **a Conformer ASR, not a chat-template speech-LLM** |
| Languages (14) | en, de, fr, it, es, pt, el, nl, pl, ar, vi, zh, ja, ko |
| License | Apache 2.0 |
| Audio | resampled to 16 kHz, multi-channel averaged, log-Mel internally |
| Source language | **required** via `processor(language=…)` — no auto-detect |
| English accuracy | #1 on the Open ASR Leaderboard at release (5.42 WER) |
| VRAM | ~5 GB bf16 — fits the 4070 SUPER 12 GB with margin |

## 4. Decisions

1. **Positioning — recommended and sorted first.** Mark Cohere `recommended=True` in both the
   sidecar catalog and the renderer catalog, alongside Qwen3-ASR (which stays recommended), and
   place Cohere **first** in the ASR list — above the recommended CPU defaults (sense-voice,
   whisper-base). Since the renderer sorts `recommended` first then `sortOrder` ascending, Cohere
   takes `sort_order = 0` and the existing ASR rows shift +1 (sense-voice → 1, whisper rows and
   Granite follow, Qwen3 → 8) in **both** catalogs. This reflects Cohere's existing popularity
   with our users. (`sort_order` is advisory and not sent over the wire, so the two catalogs'
   values stay independent — only the relative "Cohere first" ordering must match.)
2. **Explicit source language required.** Cohere has no auto-detect. When Cohere is the selected
   native ASR, the source-language `auto` option is hidden (the user must pick a language) —
   exact parity with the LOCAL_INFERENCE worker.

## 5. Architecture

### 5.1 `CohereAsrBackend` (`sidecar/sokuji_sidecar/backends.py`)

A new `@register_backend` class, `NAME = "cohereasr"`, GPU-only, mirroring `Qwen3AsrBackend`.
The one structural difference from Granite/Qwen3: Cohere is a Conformer ASR, so there is **no
conversation/chat template** — the source language goes through the *processor*, not a prompt.

```python
@register_backend
class CohereAsrBackend:
    """Cohere Transcribe (Fast-Conformer ASR) via native transformers
    (CohereAsrForConditionalGeneration). model_ref is the HF repo; GPU-tier (bf16),
    loaded with .to(device) (no accelerate). Conformer, not a speech-LLM: the source
    language is passed through the processor, not a chat template."""
    NAME = "cohereasr"

    def load(self, model_ref, device, compute_type):
        self._model = None; self._proc = None
        if device == "cpu":
            raise BackendLoadError("cohereasr is GPU-only")
        try:
            import torch
            from transformers import CohereAsrForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
            self._model = CohereAsrForConditionalGeneration.from_pretrained(
                model_ref, dtype=self._dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:   # missing cohere_asr module, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language):
        import torch
        lang = language or "en"   # UI guarantees an explicit language (§5.3); defensive default
        inp = self._proc(samples, sampling_rate=TARGET_RATE, return_tensors="pt",
                         language=lang).to(self._device)
        if "input_features" in inp:                 # the Qwen3 lesson: cast to model dtype
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        text = self._proc.batch_decode(out, skip_special_tokens=True)[0]
        return AsrResult(text.strip(), language)    # prefix-strip helper added only if the spike shows one
```

Open items confirmed by the spike (§6), not assumed: exact processor signature
(`AutoProcessor` vs `CohereAsrProcessor`; whether `input_features` is the right key), whether
the decoded output carries any prefix to strip, and the accepted `language` code form.

### 5.2 Registry wiring (three one-line touches, identical to Qwen3)

- **`catalog.py`** — new row:
  ```python
  AsrModel("cohere-transcribe-03-2026", "Cohere Transcribe",
           ("en","de","fr","it","es","pt","el","nl","pl","ar","vi","zh","ja","ko"),
           (Deployment("cohereasr", "gpu-cuda", "bfloat16",
                       "CohereLabs/cohere-transcribe-03-2026", 1.0),),
           recommended=True, sort_order=0)   # first in the list; existing rows shift +1
  ```
- **`accel.py` `_installed()`** — add `"cohereasr": "transformers.models.cohere_asr"` to the
  `mods` dict. Present on 5.13 → the model lights up immediately; the `_has_mod` self-gate still
  protects builds where the module is absent.
- **`native_models.py` `download_specs`** — before the fallthrough:
  ```python
  if model_id == "cohere-transcribe-03-2026":
      return {"repos": ["CohereLabs/cohere-transcribe-03-2026"], "urls": []}
  ```

### 5.3 Renderer (`src/lib/local-inference/native/nativeCatalog.ts` + `LanguageSection.tsx`)

- **Catalog row** (no change to `NativeModelManagementSection`, which renders it):
  ```ts
  { id: 'cohere-transcribe-03-2026', label: 'Cohere Transcribe',
    languages: ['en','de','fr','it','es','pt','el','nl','pl','ar','vi','zh','ja','ko'],
    recommended: true, sortOrder: 0, requiresExplicitLanguage: true }   // first; existing rows shift +1
  ```
  Add the optional `requiresExplicitLanguage?: boolean` field to the `NativeModelOption` type.
- **Explicit-language gate** (`LanguageSection.tsx`): the source-language render already hides
  the `auto` option for `LOCAL_INFERENCE`. Extend that guard to also hide `auto` when the
  provider is `LOCAL_NATIVE` **and** the currently selected native ASR row has
  `requiresExplicitLanguage` (via a small selector, e.g. `nativeAsrRequiresExplicitLanguage(id)`
  in `nativeCatalog.ts`). This keeps the rule data-driven so a future no-auto-detect model only
  needs the flag.

## 6. Validation spike (de-risker — run first)

A GPU-gated smoke (`SOKUJI_RUN_GPU`, like the Qwen3 smoke) that mirrors the real flow — download
first, then load from cache — and resolves the unknowns the import test could not:

1. `AutoProcessor.from_pretrained(ref, local_files_only=True)` (after a `snapshot_download(ref)`).
2. `CohereAsrForConditionalGeneration.from_pretrained(ref, dtype=torch.bfloat16,
   local_files_only=True).to("cuda").eval()`.
3. `proc(samples_f32_16k, sampling_rate=16000, return_tensors="pt", language="en")` →
   `model.generate(**inputs, max_new_tokens=256)` → `proc.batch_decode(out, skip_special_tokens=True)`.

Assert / observe: a plausible transcript on a real clip (verify the **output format** — any
prefix to strip?); our **language codes** are accepted (`en`, `ja`, …); **RTF and VRAM** on the
4070; and — the coexistence regression — **Granite and Qwen3 still load** after Cohere
`unload()` + `torch.cuda.empty_cache()`.

## 7. Testing

- **Mocked unit tests** (`sidecar/tests/test_backends.py`): a fake processor + model (mirroring
  the Qwen3 fakes) asserting the bf16 dtype cast, `language=` is passed through, the GPU-only
  guard raises `BackendLoadError` on `cpu`, and the decode path. Plus the
  `SOKUJI_RUN_GPU`-gated real smoke from §6.
- **Catalog** (`test_catalog.py`): the new row — `recommended is True`, `sort_order == 8`, the
  14 languages, backend `cohereasr`. Add `"cohereasr"` to the allowed-backend set.
- **Resolver** (`test_accel.py`): `cohereasr` gated on `transformers.models.cohere_asr`; present
  → resolves a GPU plan on an NVIDIA machine.
- **Renderer** (`nativeCatalog.test.ts`): the Cohere row (recommended, `sortOrder` 0, languages)
  and `requiresExplicitLanguage` truthy; **Cohere now leads the ASR list** (assert it sorts
  ahead of sense-voice / whisper-base), and the existing rows keep their relative order.
- Gates: `pytest` (sidecar) + `vitest` (renderer) are the correctness gates (not `tsc`);
  `npm run build` for renderer wiring.

## 8. Out of scope (YAGNI)

- No GGUF / ONNX / CPU path — the GPU bf16 path **is** the upgrade; CPU is already covered by
  Whisper (`ctranslate2`) and SenseVoice (`sherpa`).
- No word timestamps / diarization / code-switching — the model does not provide them.
- No changes to Qwen3-ASR or Granite, and no new pip dependencies (the GPU path needs nothing
  beyond what Granite/Qwen3 already pull in; `sentencepiece` is already in `requirements.txt`).

## 9. Files touched

- `sidecar/sokuji_sidecar/backends.py` — `CohereAsrBackend`.
- `sidecar/sokuji_sidecar/catalog.py` — the `cohere-transcribe-03-2026` row.
- `sidecar/sokuji_sidecar/accel.py` — `_installed()` gate entry.
- `sidecar/sokuji_sidecar/native_models.py` — `download_specs` branch.
- `sidecar/tests/test_backends.py`, `test_catalog.py`, `test_accel.py` — tests + GPU smoke.
- `src/lib/local-inference/native/nativeCatalog.ts` — row + `requiresExplicitLanguage` +
  selector.
- `src/lib/local-inference/native/nativeCatalog.test.ts` — row test.
- `src/components/Settings/sections/LanguageSection.tsx` — extend the `auto`-hiding guard.
