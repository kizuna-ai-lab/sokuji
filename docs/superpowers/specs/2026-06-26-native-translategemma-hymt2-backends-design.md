# Native TranslateGemma + HY-MT2 Translation Backends

## Problem

The LOCAL_NATIVE provider's translation stage today offers only the Qwen
family (`qwen_translate`, `qwen35_translate`) and Opus-MT. Two model series
worth adding for translation quality and language coverage are absent:

- **TranslateGemma** (Google) — a Gemma-3-based translation VLM, 55 languages.
- **Hunyuan-MT2 / HY-MT2** (Tencent) — `hunyuan_v1_dense` translation LLMs,
  36 languages with a Chinese↔X and minority-language emphasis, Apache-2.0.

This spec adds both as native transformers backends. It is scope (a) of a
two-step effort: (a) wire the models in at bf16; (b) — a **separate, later
spec** — a quantization/precision selector (FP8 / GGUF / NVFP4) that picks the
best variant for the host's VRAM (targets span 6 GB to a 128 GB DGX Spark).
This spec must not block (b), but implements none of it.

## Goal

A user can select TranslateGemma-4B or Hunyuan-MT2 (1.8B / 7B) as the native
translation model, download it on demand, and translate through the existing
ASR → translation → TTS pipeline — identical in behavior to the current Qwen
options, including the just-shipped resolved-memory / degrade display.

## Non-Goals

- **No quantization selection.** Only a bf16 GPU tier + a float32 CPU floor per
  model (mirroring the Qwen rows). FP8/GGUF/NVFP4 variants and any
  VRAM-aware variant picker are deferred to spec (b).
- **No translation-engine changes.** `translate_engine.py` is multimodal over
  backends; new models flow through it unchanged.
- **No new gated-download mechanism.** TranslateGemma uses the same official-repo
  + configured-HF-token path as the already-gated Voxtral model. End-user gated
  access is a pre-existing cross-cutting concern (Voxtral shares it), out of
  scope here.
- **No `trust_remote_code`.** Verified unnecessary (see Architecture).

## Architecture

The translation engine resolves a model id to a plan and calls a registered
backend:

```
translate_engine.init  →  accel.resolve_translate(model_id)  →  accel.load_measured(plans)
                       →  backend.load(artifact, device, compute_type)
session                →  backend.translate(text, system_prompt, src, tgt, wrap)
```

A backend is a class with `load` / `translate` / `unload` / `is_loaded`,
registered by `@register_backend` under its `NAME`. Adding a model is: a
catalog row (declares tiers + backend NAME + repo), a `download_specs` entry,
the backend class, and a renderer descriptor. Everything else — the resolver,
the VRAM gate, `load_measured`'s memory measurement, and the
`memoryBytes`/`fallbackReason` display — is reused untouched.

### Why no `trust_remote_code` for HY-MT2

The HY-MT2 model cards pass `trust_remote_code=True` defensively, but it is not
needed for inference: `hunyuan_v1_dense` is a **native transformers 5.13
architecture** (present in `MODEL_FOR_CAUSAL_LM_MAPPING_NAMES`), and the repos
contain **no `modeling_*.py` / `configuration_*.py` and no `auto_map`** — their
only `.py` files are training scripts under `train/`. Loading with a plain
`AutoModelForCausalLM` and `trust_remote_code=False` therefore runs the native
class and **executes no downloaded Python** — the correct posture for a sidecar
that downloads (and will sign) models.

### Why TranslateGemma loads text-only

TranslateGemma is a Gemma-3 multimodal model. Its default `AutoProcessor`
eagerly builds an image/video processor that hard-requires `torchvision`, for
which the sidecar's `torch 2.x+cu128` build has no wheel — the exact gate
already solved for `qwen35_translate`. The Gemma backend reuses that fix:
drive `AutoTokenizer` + the text model class (`Gemma3ForConditionalGeneration`),
never `AutoProcessor`.

## Components / files

| File | Change |
|---|---|
| `sidecar/sokuji_sidecar/translate_backends.py` | add `HunyuanTranslateBackend` + `GemmaTranslateBackend`; add `_hunyuan_prompt(tgt)` helper and `_GEMMA_LANG_CODE` name→BCP-47 map |
| `sidecar/sokuji_sidecar/catalog.py` | rename `_qwen_translate_row` → `_llm_translate_row` (now serves 3 families); add 3 rows |
| `sidecar/sokuji_sidecar/native_models.py` | add 3 `download_specs` branches (HY-MT2 ignores `train/*`) |
| `src/lib/local-inference/native/nativeCatalog.ts` | add 3 entries to `NATIVE_TRANSLATION` |
| `sidecar/tests/test_translate_backends.py` | registration + prompt-construction (mocked) + real-GPU gated load/translate |
| `sidecar/tests/test_catalog.py`, `test_native_models.py` | rows + download mapping |

`translate_engine.py` is intentionally **not** in this list.

## Catalog rows

`_qwen_translate_row` is renamed to `_llm_translate_row` (its body is already
family-agnostic — it builds a `gpu-cuda(bfloat16)` + `cpu(float32)` pair from a
backend NAME and repo). Three rows are added:

| catalog id | label | repo (`artifact`) | backend NAME |
|---|---|---|---|
| `translategemma-4b` | TranslateGemma 4B | `google/translategemma-4b-it` | `gemma_translate` |
| `hy-mt2-1.8b` | Hunyuan-MT2 1.8B | `tencent/Hy-MT2-1.8B` | `hunyuan_translate` |
| `hy-mt2-7b` | Hunyuan-MT2 7B | `tencent/Hy-MT2-7B` | `hunyuan_translate` |

Each row: `Deployment(backend, "gpu-cuda", "bfloat16", repo, 1.0)` and
`Deployment(backend, "cpu", "float32", repo, 1.0)`. `sort_order` continues the
existing translate sequence.

## Download mapping

`download_specs(model_id)` gains:

- `translategemma-4b` → `{repos: ["google/translategemma-4b-it"], urls: []}`
- `hy-mt2-1.8b` → `{repos: ["tencent/Hy-MT2-1.8B"], urls: [], ignore: ["train/*"]}`
- `hy-mt2-7b` → `{repos: ["tencent/Hy-MT2-7B"], urls: [], ignore: ["train/*"]}`

The `ignore` skips the repos' training scripts (weights only). Gemma downloads
via the configured HF token, exactly as the already-gated Voxtral repo does.

## Backends

Both backends mirror the structure of `qwen35_translate`: bf16/float32 by
`compute_type`, `.to(device).eval()`, `torch.inference_mode()` greedy decode
(`do_sample=False` — deterministic and testable, consistent with the existing
backends), `_clean_output` reuse, and `unload()` that drops refs and calls
`torch.cuda.empty_cache()`. A failed load raises `BackendLoadError` so the
resolver falls back.

### `HunyuanTranslateBackend` (NAME = `hunyuan_translate`)

- **load:** `AutoTokenizer` + `AutoModelForCausalLM`, `trust_remote_code=False`,
  `local_files_only=True`.
- **translate:** single user turn using HY-MT2's documented English template,
  with `tgt` as a full language name (which is what the engine passes):

  > `Translate the following text into {tgt}. Note that you should only output the translated result without any additional explanation: {text}`

  `system_prompt` (the app's custom instructions), when present, overrides the
  default instruction prefix — same override contract as the Qwen backends.
  `wrap` wraps `text` in `<transcript>…</transcript>` as today; `_clean_output`
  strips the tags symmetrically. Returns `(clean_text, generated_token_count)`.

### `GemmaTranslateBackend` (NAME = `gemma_translate`)

- **load:** `AutoTokenizer` + `Gemma3ForConditionalGeneration`,
  `local_files_only=True`. **Never `AutoProcessor`** (torchvision gate).
- **translate:** Gemma's chat template carries per-message
  `source_lang_code` / `target_lang_code` BCP-47 fields. The engine passes full
  language *names*, so a module-level `_GEMMA_LANG_CODE` maps name → code
  (e.g. `"Japanese" → "ja"`), passing the value through unchanged when it is
  already a code or unmapped. Message shape:

  ```python
  [{"role": "user", "content": [{"type": "text",
    "source_lang_code": s_code, "target_lang_code": t_code, "text": text}]}]
  ```

  `max_new_tokens ≈ 256` (Gemma's context is 2K — ample for sentence-level
  translation). `_clean_output` reuse; returns `(clean_text, token_count)`.

  **Primary integration risk:** if `AutoTokenizer.apply_chat_template` does not
  carry the Gemma chat template (it may live on the processor for a multimodal
  model), the backend falls back to constructing the prompt string manually
  from Gemma's documented format. The real-GPU test is the gate that confirms
  which path works.

## Renderer descriptor

`NATIVE_TRANSLATION` in `nativeCatalog.ts` gains three entries
(`languages: ['multi']`, matching the existing LLM-translator convention;
`sortOrder` 6/7/8; no `recommended` flag):

```ts
{ id: 'translategemma-4b', label: 'TranslateGemma 4B', languages: ['multi'], sortOrder: 6 },
{ id: 'hy-mt2-1.8b', label: 'Hunyuan-MT2 1.8B', languages: ['multi'], sortOrder: 7 },
{ id: 'hy-mt2-7b', label: 'Hunyuan-MT2 7B', languages: ['multi'], sortOrder: 8 },
```

Without this, the model is loadable but absent from the picker.

## VRAM, degrade, and forward compatibility

- `hy-mt2-7b` at bf16 is ~15 GB and will not co-reside with the ASR stage on a
  12 GB card: the existing proactive VRAM gate skips its CUDA plan and routes it
  to the float32 CPU floor (slow — single-digit tok/s, acceptable for this cut).
  The reason and measured RAM surface automatically through the shipped
  `fallbackReason` / `memoryBytes` display.
- **Forward compatibility:** the catalog's per-model multi-`Deployment` /
  `compute_type` structure already accommodates the future FP8/GGUF/NVFP4 tiers
  and a VRAM-aware selector. This spec adds no selector code (YAGNI); it only
  records the extension point so spec (b) does not have to repaint the catalog.

## Testing

- **Unit (no GPU):** `make_backend("gemma_translate")` /
  `make_backend("hunyuan_translate")` resolve to the classes. With a mocked
  model/tokenizer, assert the exact prompt/messages fed to `generate`: the
  HY-MT2 instruction string with the target name interpolated, and the Gemma
  message list with `source_lang_code`/`target_lang_code` correctly mapped from
  full names. Assert `_clean_output` strips `<think>`/transcript framing. Mirror
  the existing non-GPU tests in `test_translate_backends.py`.
- **Catalog / download:** `translate_model("hy-mt2-7b")` returns the expected
  two deployments; `download_specs` returns the expected repos and `ignore`.
- **Real-GPU (`SOKUJI_RUN_GPU`):** load each model on CUDA, translate one
  sample, assert a non-empty string and `device == "cuda"`. The Gemma case is
  where the chat-template text path is validated end-to-end.

## Risks / caveats

- **Gemma chat-template path** is the one unknown — validated by the real-GPU
  test, with a manual-prompt fallback if the tokenizer lacks the template.
- **`['multi']` language tagging** slightly over-promises for HY-MT2 (36 langs)
  and Gemma (55 langs), consistent with the existing Qwen rows. Precise
  per-language gating is a possible later refinement, not in scope.
- **TranslateGemma is Gemma-licensed and gated**; downloads require an HF token
  with the license accepted. Dev works via the configured token (as Voxtral
  does); productionizing end-user gated access is pre-existing and out of scope.
- **`hy-mt2-7b` bf16 does not GPU-fit on ≤12 GB alongside ASR** — runs on the
  CPU floor until the quantization spec (b) adds a fitting GPU tier.
