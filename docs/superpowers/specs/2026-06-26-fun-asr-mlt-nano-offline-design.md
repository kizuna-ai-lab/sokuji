# GPU-native Fun-ASR-MLT-Nano (offline) via FunASR — Design

**Date**: 2026-06-26
**Branch**: `feat/fun-asr-mlt-nano` (off `native-sidecar`)
**Status**: Approved; Phase-0 verified — plan at `docs/superpowers/plans/2026-06-26-fun-asr-mlt-nano-offline.md`

## Summary

Add **`Fun-ASR-MLT-Nano-2512`** — a 31-language, ~800M, Apache-2.0 speech-LLM
(SenseVoice audio encoder + Qwen3-0.6B LLM decoder) — to the native sidecar as an
**offline** ASR backend, through the same `funasr.AutoModel` seam we just shipped
for SenseVoice. GPU-native, honoring an explicit device selection. No streaming,
no vLLM, no engine/transport changes.

## Background & motivation

The sidecar already depends on the `funasr` runtime: `FunAsrSenseVoiceBackend`
loads `SenseVoiceSmall` via `AutoModel(model=..., hub="hf", device=...)`. The
Fun-ASR-Nano family is the same FunASR ecosystem, loaded the same way, so adding
it is an extension of an existing seam rather than a new architecture.

Of the three published variants, **`Fun-ASR-MLT-Nano-2512`** is the right fit for
a real-time *translation* app: 31 languages, Apache-2.0, ~800M (half the size of
Qwen3-ASR-1.7B), claiming parity with / better than Whisper-large-v3 on open data.

### The three Fun-ASR-Nano variants (why MLT)

All three share one architecture (SenseVoice encoder + Qwen3-0.6B decoder, ~800M,
autoregressive, Apache-2.0, native punctuation + ITN). They differ on two axes
only — runtime packaging and language coverage:

| Model | Loader | Coverage | Role |
|-------|--------|----------|------|
| Fun-ASR-Nano-2512 | `funasr AutoModel` (`trust_remote_code`) | Chinese + 7 dialects (Cantonese, Wu, Min, Hakka, Gan, Xiang, Jin) + 26 accents, en, ja | Chinese/dialect depth (CJK) |
| Fun-ASR-Nano-2512-hf | `transformers` (`AutoModelForSeq2SeqLM`/`pipeline`) | same as base Nano | Same weights, repackaged for transformers |
| **Fun-ASR-MLT-Nano-2512** | `funasr AutoModel` (`trust_remote_code`, `remote_code="./model.py"`) | **31 languages** (CJK + SE-Asian + Arabic/Hindi + ~20 European) | **Multilingual breadth — chosen** |

`Nano vs MLT` is a coverage trade (dialect depth vs 31-language breadth);
`Nano vs Nano-hf` is a packaging trade (funasr vs transformers loader of the same
weights). MLT is funasr-only (no `-hf` twin).

## Runtime decision: offline, not streaming

Streaming exists in the FunASR repo (`funasr/models/fun_asr_nano/inference_vllm_streaming.py`,
`FunASRNanoStreamingVLLM`) but is **vLLM-only** and **not demonstrated in any
official Space** (both official Spaces — `Fun-ASR-Nano`, `Fun-ASR-Nano-GPU-Debug`
— run offline `AutoModel.generate()`). vLLM is a heavy GPU-only dependency that
would likely conflict with the sidecar's pinned `transformers` PR-fork (used by
Qwen3-ASR). Therefore: **offline only.** Streaming is explicitly out of scope and
deferred to a future spike if it ever proves worthwhile.

## What the offline path looks like (grounded in the FunASR code + official Spaces)

| Aspect | Finding | Impact |
|--------|---------|--------|
| Output | `res[0]["text"]` is plain text with **native punctuation, no `<\|tags\|>`** | Simpler than SenseVoice — no tag regex; skip `rich_transcription_postprocess` (it injects emoji) to stay text-only |
| `language` | accepts `"auto"`, ISO (`"zh"`/`"en"`), or names (`"Chinese"`); optional | Pass the renderer's ISO source language through, or `"auto"` |
| Input | `generate(input=samples, use_itn=True)` accepts a float32 ndarray | Same shape the engine already feeds |
| VAD / length | without VAD, input capped ~30 s | The engine already segments with silero VAD and feeds short segments — no funasr *internal* VAD needed (same as SenseVoice). **But** that silero VAD (`silero_vad.onnx`) is a downloaded artifact `AsrEngine._init_vad()` loads for every ASR model, so the model's `download_specs` MUST include `VAD_URL` for an offline-only install — see the correction note below. |
| `trust_remote_code` | `AutoModel` fetches + executes `model.py` from the HF snapshot | The one real wrinkle vs SenseVoice — the download must pull custom code, and we accept running official Apache-2.0 repo code |

## Design

### Integration seam

Backend-layer-only. `server.py`, `__main__.py`, `asr_engine.py` are **untouched**:
Fun-ASR-Nano is an offline backend, and the WS transport, silero-VAD segmentation,
24→16 kHz downsample, and `{type:"result"}` envelope are model-agnostic — exactly
as with SenseVoice. Touched: `backends.py`, `catalog.py`, `accel.py`,
`native_models.py`, and the renderer `nativeCatalog.ts` (+ tests).

### 1. Backend — generalize into a shared `FunAsrBackend` (`backends.py`)

A shared base holds **all** logic; SenseVoice and Fun-ASR-Nano are thin
config-only subclasses. This keeps the `funasr_sensevoice` NAME stable (zero churn
to the just-merged SenseVoice catalog/tests) while sharing one implementation.

```python
@dataclass(frozen=True)
class _FunAsrConfig:
    trust_remote_code: bool
    postprocess: Callable[[str], tuple[str, str | None]]   # text -> (clean_text, language|None)

def _passthrough(text: str) -> tuple[str, None]:
    return text.strip(), None        # Fun-ASR-Nano: already clean, punctuated, no tags

class _FunAsrBackend:
    """Shared funasr AutoModel offline backend. Subclasses set NAME + CONFIG.
    Honors the device given; the cuda guard rejects cuda when torch lacks CUDA so
    load_with_fallback steps to the correctly-labelled cpu plan."""
    CONFIG: _FunAsrConfig
    # load(model_ref, device, compute_type):
    #   cuda guard (shared) -> AutoModel(model=model_ref, hub="hf", device=dev,
    #       trust_remote_code=self.CONFIG.trust_remote_code, disable_update=True)
    # transcribe(samples, language):
    #   res = generate(input=samples, fs=16000, cache={}, language=language or "auto",
    #                  use_itn=True, batch_size_s=60)
    #   text, lang = self.CONFIG.postprocess(res[0]["text"]); return AsrResult(text, lang)
    # unload() / is_loaded: shared

@register_backend
class FunAsrSenseVoiceBackend(_FunAsrBackend):
    NAME = "funasr_sensevoice"
    CONFIG = _FunAsrConfig(trust_remote_code=False, postprocess=_strip_sensevoice_tags)

@register_backend
class FunAsrNanoBackend(_FunAsrBackend):
    NAME = "funasr_nano"
    CONFIG = _FunAsrConfig(trust_remote_code=True, postprocess=_passthrough)
```

- **Device honored** — no GPU-only guard; the same cuda-fallback guard as SenseVoice.
- **Output is plain punctuated text** — `_passthrough` (no tag regex).
- **language** — pass the renderer's ISO code through, or `"auto"`.
- The generate kwargs are the SenseVoice-proven set; if Phase-0 shows Fun-ASR-Nano
  rejects any (e.g. `batch_size_s`), the kwargs move into `_FunAsrConfig`.

### 2. Catalog row (`catalog.py`)

```python
AsrModel("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
         (<31-language tuple, pulled verbatim from the model card/config>),
         (Deployment("funasr_nano", "gpu-cuda", "float32", FUN_ASR_MLT_REPO, 1.0),
          Deployment("funasr_nano", "cpu", "float32", FUN_ASR_MLT_REPO, 1.0)),
         recommended=True, sort_order=11)   # values confirmed by Phase-0 (below)
```

- `FUN_ASR_MLT_REPO = os.environ.get("SOKUJI_FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-MLT-Nano-2512")`
  — mirrors the `SENSE_VOICE_REPO` override pattern.
- **`compute_type` is `float32`** (both tiers) — Phase-0 measured the loaded model
  at fp32, 869M params (no float16-that's-really-float32 label, the SenseVoice fix).
- **Tiers**: both `gpu-cuda` AND `cpu` ship. Phase-0 measured CPU RTF 0.22–0.32
  (real-time) — contrary to the autoregressive-is-GPU-only assumption, the small
  Qwen3-0.6B decoder on short VAD segments is CPU-viable, so the cpu tier stays in.
- `recommended=True` (strong Apache-2.0 multilingual, competes with Qwen3-ASR-1.7B
  at half the size). `sort_order` is advisory (the renderer owns card ordering).

### 3. Install gate & dependencies (`accel.py`, `setup.sh`)

- `accel._installed()` maps `"funasr_nano" → "funasr"` (already installed) so the
  row only advertises when funasr imports.
- **No new pip dep expected**, but `trust_remote_code` runs `model.py`, which may
  import packages the venv lacks. Phase-0 reveals this; if so, append to `setup.sh`.

### 4. Download spec (`native_models.py`)

```python
download_specs("fun-asr-mlt-nano") -> {"repos": [FUN_ASR_MLT_REPO], "urls": [VAD_URL]}
```

`snapshot_download` already fetches **all** repo files including `model.py` +
custom code (which `trust_remote_code` then loads from the local snapshot) — no
special handling, no ignore-list. Existing `model_status` / `model_size` /
`model_download` / `model_delete` handle it like every other model.

> **Post-implementation correction (PR #270 review).** The original design said
> `"urls": []` here, reasoning that "the engine segments upstream, so no VAD
> download is needed." That was wrong: `AsrEngine._init_vad()` loads
> `silero_vad.onnx` for **every** ASR model (offline *and* streaming), and it's a
> downloaded artifact — so a user who installed only this model and went offline
> had no VAD and failed at session start. Worse, only SenseVoice declared the VAD,
> and `delete_model` treated SenseVoice as its "owner" (deleting SenseVoice yanked
> the VAD out from under the other ASR models). The shipped fix treats the silero
> VAD as a **shared dependency of all ASR models**: `download_specs` appends
> `VAD_URL` for any ASR-catalog model (matched via `catalog.asr_model(id)`), and
> `delete_model` never removes the 643 KB shared singleton. This also closed the
> identical pre-existing offline gap for whisper / qwen3-asr / cohere / granite /
> voxtral.

### 5. Renderer catalog (`nativeCatalog.ts` + test)

Mirror the sidecar row:
`{ id: 'fun-asr-mlt-nano', label: 'Fun-ASR MLT Nano', languages: [<31>], recommended: true, sortOrder: <n> }`
with a matching `nativeCatalog.test.ts` assertion — same lockstep discipline as the
catalog/renderer pairs already in the tree.

## Phase 0 — verification spike (COMPLETED ✅)

Run on the dev RTX 4070 (funasr 1.3.14, torch 2.11.0+cu128), feeding the cached
sherpa SenseVoice test clips (zh/en/ja/ko/yue) as temp wavs:

| device | RTF | load | VRAM | correctness |
|--------|-----|------|------|-------------|
| cuda:0 | 0.047–0.100 | ~17 s | 3579 MB peak | all 5 langs correct |
| cpu    | 0.223–0.317 | ~18 s | —    | all 5 langs correct |

Results: loads via `trust_remote_code=True` (no `remote_code` needed — funasr 1.3.14
ships `fun_asr_nano/model.py`); **float32, 869M params**; output is clean punctuated
text with **no `<|tags|>`**; `language="auto"` auto-detects all 5; **input must be a
file path** (bare ndarray raises in `data_template`) → feed a temp wav; `tiktoken`
(the `multilingual.tiktoken` tokenizer) is already present via funasr — no new dep.

What was checked (all green):

1. `AutoModel(model="FunAudioLLM/Fun-ASR-MLT-Nano-2512", hub="hf", trust_remote_code=True, device="cuda:0")`
   loads — confirms `model.py` fetch + no missing deps.
2. Feed float32 ndarrays (zh/en/ja/ko + 2-3 European clips) per-segment → confirm
   **plain punctuated text, no tags**, correct transcripts.
3. Confirm `language` accepts ISO codes / `"auto"`.
4. **Measure GPU + CPU RTF** → decide the cpu tier; record VRAM.
5. Read the loaded dtype → set the honest `compute_type` label.

Findings feed back into the catalog row (tiers, dtype) and `setup.sh` (deps) before
any production code lands.

## Testing plan

- **Unit (no model)**: `_passthrough` returns `(clean, None)`; **SenseVoice
  `_strip_sensevoice_tags` regression** (unchanged); config selection
  (`funasr_nano` → `trust_remote_code=True`, `funasr_sensevoice` → `False`); shared
  `load()` passes `trust_remote_code` from config (mock funasr); cuda-guard rejects
  cuda without torch-CUDA (reuse the fake-funasr fixture); `transcribe` passes
  `language` through; empty result → blank.
- **Catalog / accel / native_models**: row present + tiers + languages + backend
  `funasr_nano`; `_installed` mapping; resolver returns the gpu-cuda plan for
  `override="cuda"`/`"auto"`; `models_catalog` handler shape; `download_specs` mapping.
- **Renderer**: `nativeCatalog.test.ts` row.
- **Backend smoke** (gated on funasr + cuda + `SOKUJI_RUN_ASR_MODEL`): load +
  transcribe a canned clip.

## Risks & tradeoffs

| Risk | Mitigation |
|------|-----------|
| `trust_remote_code` executes repo `model.py` | Official Apache-2.0 FunAudioLLM org; accepted, called out. This is the only arbitrary-code path in the backend set; the download/load pull unpinned `main`. Future hardening: pin a known-good `revision=` (e.g. via a `SOKUJI_FUNASR_NANO_REV` knob) so an unreviewed upstream push can't silently execute new code. |
| `model.py` pulls unlisted deps | Phase-0 catches → add to `setup.sh` |
| CPU not real-time (AR decoder) | cpu tier verification-gated; default GPU-only like peers |
| Exact 31-language list | Pulled verbatim from card / `config.json`, not guessed |
| `compute_type` honesty | Labelled from measured dtype |
| Download size (~0.9–1.6 GB) | Existing model-download UX |

## Out of scope

- Streaming / vLLM (`inference_vllm_streaming.py`, `FunASRNanoStreamingVLLM`).
- The base `Fun-ASR-Nano-2512` and the `-hf` transformers variant.
- Emotion / speaker-diarization / timestamps; a separate punctuation model
  (Fun-ASR-Nano punctuates natively).
- Translation pairing / renderer UX beyond the catalog row.
