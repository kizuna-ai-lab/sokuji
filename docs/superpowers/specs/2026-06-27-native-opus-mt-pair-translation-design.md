# Native Opus-MT Pair Translation (13 pairs)

## Problem

The LOCAL_NATIVE (Electron sidecar) provider offers only multilingual LLM
translators (Qwen 0.5/0.6/0.8/2B, TranslateGemma-4B, HY-MT2-1.8B/7B). Legacy
Opus-MT was removed from the sidecar in `9cec5236` (merged via PR #272) because
the multilingual models cover its language pairs.

PostHog usage (`translation_session_start`, project "sokuji") contradicts the
assumption that nobody needs the small pair-specific models: in the last 365
days ~20 users actively selected `opus-mt-*` models across 25 directional pairs,
led by `ru-en` (166 sessions / 27 users), `zh-en` (115 / 20), `en-zh` (101 / 19).
Opus-MT models are tiny (~300 MB) and pair-baked, so they start fast and run on
low-end hardware where a 1.8B+ LLM is painful. Today the native provider has no
way to offer them.

## Goal

Re-add Opus-MT to the sidecar as a first-class **PyTorch MarianMT** translate
backend (GPU bf16 with CPU floor), unified with the existing gemma/hunyuan
backend pattern — NOT the deleted torch-free ONNX path. Expose the high-usage
pairs as **one model = one model card** (opt-in, shown only for the matching
source→target language pair), mirroring how the WASM `local_inference` provider
presents Opus-MT.

Scope is the **13 pairs** above a ≈≥4-users/30-day cutoff:
`ru-en`, `zh-en`, `en-zh`, `hu-en`, `en-es`, `en-ar`, `en-ru`, `es-en`,
`en-vi`, `ar-en`, `ja-en`, `en-jap`, `ko-en`.

## Non-Goals

- **HY-MT1.5-1.8B** — split to its own spec; its native runtime (PyTorch repo /
  arch vs the ONNX-only `onnx-community/HY-MT1.5-1.8B-ONNX` the app ships) is
  unverified.
- Resurrecting the deleted ONNX `opus_mt.py` (torch-free onnxruntime path).
- FP8 / quantized variants for Marian (the bf16 model is already ~300 MB).
- Multilingual Opus aggregates (`opus-mt-en-ROMANCE`, etc.).
- The long-tail pairs below the cutoff (`en-it`, `nl-en`, `fr-en`, `it-en`,
  `es-fr`, `vi-en`, `en-de`, `th-en`, `ru-es`, `en-hi`, `es-ru`).

## Architecture

Opus-MT becomes a sibling backend to the LLM translators, with three differences
that fall out of MarianMT being a small **seq2seq** model rather than a CausalLM:

1. **Model class**: `AutoModelForSeq2SeqLM` (Marian), not `AutoModelForCausalLM`.
2. **Inference**: direct `model.generate(**tokenizer(text))` → decode. No chat
   template, no system prompt, no `<transcript>` wrapping — translation direction
   is baked into the model, so `system_prompt` / `wrap_transcript` are ignored.
3. **Source repos**: `Helsinki-NLP/opus-mt-{src}-{tgt}` — the original PyTorch
   weights + SentencePiece tokenizer in a single repo (the `Xenova/*` ids the
   WASM app uses are ONNX exports and are not used here).

Everything else reuses the existing machinery: catalog rows with
`gpu-cuda`+`cpu` deployments, `resolve_translate` → `load_with_fallback`
(GPU-preferred, CPU floor), `download_specs`, and the renderer card list.

### Why MarianMT over the deleted ONNX backend

The user chose the PyTorch/GPU path to keep a single translate-backend shape.
MarianMT is built into `transformers` (no `trust_remote_code`, no `auto_map`),
loads on GPU in bf16 at ~300 MB, and reuses `load_with_fallback` for the
GPU→CPU step. The deleted ONNX backend hand-rolled KV-cache plumbing and was
CPU-only; dropping it removes that maintenance surface.

## Components / files

Sidecar (`sidecar/sokuji_sidecar/`):
- `translate_backends.py` — new `OpusTranslateBackend` (NAME `opus_translate`).
- `catalog.py` — `_opus_row(src, tgt)` helper + 13 rows in the translate catalog.
- `native_models.py` — `download_specs` mapping for `opus-mt-*`.
- `accel.py` — register `opus_translate` in `_installed` (gate on `transformers`).
  No `resolve_translate` change expected: opus rows flow through the existing
  variant/None-guarded path.

Renderer (`src/lib/local-inference/native/`):
- `nativeCatalog.ts` — add `sourceLang`/`targetLang` to the translation card
  type; add 13 Opus-MT entries; filter them by language pair in
  `nativeTranslationCards`.

Tests: `sidecar/tests/test_translate_backends.py`, `test_catalog.py`,
`test_native_models.py`; `src/lib/local-inference/native/nativeCatalog.test.ts`.

## Catalog rows

A data-driven helper that builds a `TranslateModel` directly (it cannot reuse
`_llm_translate_row`, which hardcodes `languages=("multi",)`), with no
FP8/variant wrapping:

```python
def _opus_row(src, tgt, sort_order):
    mid = f"opus-mt-{src}-{tgt}"
    repo = f"Helsinki-NLP/{mid}"
    return TranslateModel(mid, f"Opus-MT ({src} → {tgt})", (src, tgt), (
        Deployment("opus_translate", "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment("opus_translate", "cpu", "float32", repo, 1.0),
    ), sort_order=sort_order)
```

13 rows for the pairs listed in Goal, sorted after the multilingual LLMs. The id
keeps the Helsinki "jap" quirk (`opus-mt-ja-en`, `opus-mt-en-jap`); the catalog
`languages` are the bare pair (`("ja","en")`) — documentary only, since the
sidecar `TranslateModel` carries no direction and language filtering happens in
the renderer.

## Download mapping

`download_specs(model_id)` for an `opus-mt-*` id returns the single Helsinki repo
plus an `ignore` list that skips the non-PyTorch framework weights (Helsinki repos
ship the same model in 4 frameworks; the backend loads only `pytorch_model.bin`):

```python
if model_id.startswith("opus-mt-"):
    return {"repos": [f"Helsinki-NLP/{model_id}"], "urls": [],
            "ignore": ["tf_model.h5", "rust_model.ot", "flax_model.msgpack"]}
```

No VAD url (translation, not ASR). One repo carries both weights and tokenizer.
The `ignore` patterns are honored by the download filter (`native_models._ignored`,
fnmatch-based), cutting each pair's download by 50-80% (e.g. en-zh: 1446MB → 301MB).

## Backend: `OpusTranslateBackend` (NAME = `opus_translate`)

```python
class OpusTranslateBackend:
    NAME = "opus_translate"

    def load(self, repo, device, compute_type):
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
        self._tok = AutoTokenizer.from_pretrained(repo, local_files_only=True)
        self._model = AutoModelForSeq2SeqLM.from_pretrained(
            repo, dtype=dtype, local_files_only=True).to(device).eval()
        self._device = device

    def translate(self, text, system_prompt, src, tgt, wrap_transcript):
        # Marian is pair-baked: prompt/src/tgt/wrap are ignored.
        import torch
        enc = self._tok(text, return_tensors="pt").to(self._device)
        with torch.no_grad():
            out = self._model.generate(**enc, max_new_tokens=512)
        n = int(out.shape[-1])
        return self._tok.decode(out[0], skip_special_tokens=True).strip(), n

    def unload(self): ...  # standard: drop refs, empty cache
```

- `local_files_only=True` on both loads (offline-first, per the #265 review).
- Gates on `transformers` in `accel._installed` — MarianMT is core, so it is
  effectively always installed; the catalog gate keeps the rows from appearing
  only if `transformers` is somehow absent.

## Renderer: pair-specific cards

`nativeCatalog.ts` today lists translation models with `languages: ['multi']`
only. Add directional fields and pair filtering:

```ts
// card type gains:
sourceLang?: string;  // canonical, e.g. 'ja'
targetLang?: string;  // canonical, e.g. 'en'

// 13 entries, e.g.:
{ id: 'opus-mt-ja-en', label: 'Opus-MT (ja → en)',
  languages: ['ja','en'], sourceLang: 'ja', targetLang: 'en', sortOrder: 20 }
{ id: 'opus-mt-en-jap', label: 'Opus-MT (en → ja)',
  languages: ['en','ja'], sourceLang: 'en', targetLang: 'ja', sortOrder: 21 }
```

`nativeTranslationCards(src, tgt)` returns the multilingual LLMs (always) plus
any Opus-MT card where `canonLang(sourceLang) === canonLang(src)` and
`canonLang(targetLang) === canonLang(tgt)`. Opus-MT is opt-in: never the default
(the recommended Qwen stays default), shown only for the active language pair —
matching the WASM `local_inference` picker. `canonLang` must map the locale
codes seen in the field (`cmn-CN`/`zh_CN`→`zh`, `en-US`→`en`, `ru-RU`→`ru`,
`es-US`→`es`) for the 9 pair languages (zh, en, ru, ja, ko, es, ar, vi, hu).

## VRAM, degrade, and forward compatibility

Marian bf16 is ~300 MB → fits any CUDA GPU with room to spare; the
ASR+TTS VRAM reserve already computed by `resolve_translate` dominates. The
`cpu` floor deployment guarantees a working plan on CPU-only machines (fp32,
still fast for short utterances). `memoryBytes` / `fallbackReason` reporting
flows through `load_measured` unchanged.

## Testing

Sidecar:
- `OpusTranslateBackend.load/translate` with a mocked `AutoModelForSeq2SeqLM`
  + tokenizer (assert generate→decode path, prompt/wrap ignored).
- `resolve_translate('opus-mt-zh-en', 'auto', machine_with_gpu)` → `[cuda, cpu]`
  plans, backend `opus_translate`, no variant.
- `download_specs('opus-mt-zh-en')` → `{repos: ['Helsinki-NLP/opus-mt-zh-en']}`.
- `accel._installed()` includes `opus_translate` when `transformers` present.

Renderer:
- `nativeTranslationCards('ja','en')` includes `opus-mt-ja-en` and excludes
  `opus-mt-en-jap`; a non-Opus pair (e.g. `de`→`fr`) includes none.
- `canonLang` maps the field locale codes for the 9 pair languages.

## Risks / caveats

- **Helsinki repo id verification**: implementation must confirm each of the 13
  `Helsinki-NLP/opus-mt-{src}-{tgt}` repos resolves (mostly 1:1 with the WASM id
  minus the `Xenova/` prefix; the `ja`/`jap` quirk is already encoded). A missing
  repo means dropping or remapping that one pair.
- **Tokenizer deps**: MarianTokenizer needs `sentencepiece` in the sidecar venv;
  confirm it is present (it is a transitive dep of the existing translators, but
  verify).
- **Language-code normalization**: the field emitted both bare and locale codes;
  the renderer filter must canonicalize or pair cards silently won't appear.
- **`ja` vs `jap`**: PostHog also showed a legacy `opus-mt-jap-en` id; it folds
  into `opus-mt-ja-en` (same logical pair). We ship only `opus-mt-ja-en` (ja→en)
  and `opus-mt-en-jap` (en→ja).
