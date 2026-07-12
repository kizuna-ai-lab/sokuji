# Native HY-MT1.5 Translation (1.8B + 7B, each + FP8)

## Problem

The LOCAL_NATIVE (Electron sidecar) provider ships HY-MT2 (1.8B/7B) but not
HY-MT1.5. PostHog usage (`translation_session_start`, project "sokuji") shows
`hy-mt15-1.8b-translation` is a top local-translation choice — **96 users / 30
days** via the WASM `local_inference` provider — yet the native provider can't
offer it. The earlier assumption that HY-MT1.5 had no native runtime (it ships
to the WASM app as `onnx-community/HY-MT1.5-1.8B-ONNX`) is wrong: Tencent
publishes original PyTorch repos.

## Goal

Add HY-MT1.5 (1.8B + 7B, each with an FP8 variant) to the native catalog, with
full HY-MT2 parity. The feature is **data only** — no new backend, gate, or
renderer logic.

## Architecture

HY-MT1.5's `config.json` reports `model_type: "hunyuan_v1_dense"`,
`architectures: ["HunYuanDenseV1ForCausalLM"]`, `auto_map: null` (no
`modeling_*.py` in the repo → **no `trust_remote_code`**), and its FP8 repos use
`compressed-tensors` — **identical to HY-MT2**. So the existing
`hunyuan_translate` backend (`AutoModelForCausalLM`, `apply_chat_template`) loads
HY-MT1.5 verbatim, the existing `_installed` gate (`hunyuan_translate` →
`transformers.models.hunyuan_v1_dense`) already covers it, and the FP8
download/resolve/variant-picker machinery applies unchanged.

All 4 HY-MT1.5 repos ship `chat_template.jinja`, so `apply_chat_template` works.

### Prompt reuse (decision)

HY-MT1.5's documented instruction ("Translate the following segment into {t},
without additional explanation.") differs in wording from HY-MT2's
(`_hunyuan_prompt`: "Translate the following text into {t}. Note that you should
only output the translated result…"). **Decision: reuse HY-MT2's prompt for
both** — the two are equivalent translate instructions, and reuse keeps the
backend change at zero. `_hunyuan_prompt` is NOT made model-aware.

## Non-Goals

- New backend / prompt logic (reuse `hunyuan_translate` and its prompt verbatim).
- HY-MT1.5 GGUF / GPTQ-Int4 / 2bit variants (only bf16 + compressed-tensors FP8).
- Renderer FP8 UI work (the existing variant picker derives variants from the
  catalog deployments — FP8 surfaces for free).

## Components / files

Sidecar (`sidecar/sokuji_sidecar/`):
- `catalog.py` — 2 `_with_fp8(_llm_translate_row(...))` rows (1.8B, 7B).
- `native_models.py` — `hy-mt15-*` branch in `_base_specs` download mapping.

Renderer (`src/lib/local-inference/native/`):
- `nativeCatalog.ts` — 2 entries in `NATIVE_TRANSLATION` and in
  `nativeTranslationCards`.

Tests: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_native_models.py`,
`sidecar/tests/test_accel.py`, `src/lib/local-inference/native/nativeCatalog.test.ts`.

## Catalog rows

Mirror the HY-MT2 rows exactly (same `_with_fp8` + `_llm_translate_row` helpers,
backend `hunyuan_translate`), appended after `hy-mt2-7b` (sort_order 7):

```python
    _with_fp8(_llm_translate_row("hy-mt15-1.8b", "Hunyuan-MT1.5 1.8B",
                                 "tencent/HY-MT1.5-1.8B", "hunyuan_translate", 8),
              "tencent/HY-MT1.5-1.8B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt15-7b", "Hunyuan-MT1.5 7B",
                                 "tencent/HY-MT1.5-7B", "hunyuan_translate", 9),
              "tencent/HY-MT1.5-7B-FP8"),
```

Exact repo ids (verified to resolve, note Tencent's `HY` casing differs from
HY-MT2's `Hy`): `tencent/HY-MT1.5-1.8B`, `tencent/HY-MT1.5-1.8B-FP8`,
`tencent/HY-MT1.5-7B`, `tencent/HY-MT1.5-7B-FP8`.

Sizes (informative): 1.8B 3.9 GB / 2.0 GB FP8; 7B 15.3 GB / 7.7 GB FP8.

## Download mapping

A `hy-mt15-*` branch in `_base_specs` (no `ignore` — these repos carry only
weights + tokenizer + config, no `train/`/`imgs/`):

```python
    if model_id in ("hy-mt15-1.8b", "hy-mt15-7b"):
        repo = "tencent/HY-MT1.5-1.8B" if model_id == "hy-mt15-1.8b" else "tencent/HY-MT1.5-7B"
        return {"repos": [repo], "urls": []}
```

The FP8 variant download is unchanged: `select_variant` resolves the FP8
deployment, whose `artifact` (`tencent/HY-MT1.5-*-FP8`) is fetched via the
existing `download_specs(model_id, repo=fp8_repo)` `repo`-override path.

## Renderer

Add 2 entries to `NATIVE_TRANSLATION` and the `nativeTranslationCards` list,
after the HY-MT2 cards (sortOrder 7/8):

```ts
{ id: 'hy-mt15-1.8b', label: 'Hunyuan-MT1.5 1.8B', languages: ['multi'], sortOrder: 9 },
{ id: 'hy-mt15-7b', label: 'Hunyuan-MT1.5 7B', languages: ['multi'], sortOrder: 10 },
```

`languages: ['multi']` (multilingual, like HY-MT2). The id matches the sidecar
catalog id (`hy-mt15-1.8b`/`hy-mt15-7b`) so a selected card resolves/downloads.
The renderer card drops the WASM `-translation` suffix to match the native HY-MT2
id convention. FP8 is offered through the existing variant picker.

## Testing

Sidecar:
- `catalog.translate_model("hy-mt15-1.8b")` / `"hy-mt15-7b"` exist, backend
  `hunyuan_translate`, deployments include a `gpu-cuda fp8` variant
  (`tencent/HY-MT1.5-*-FP8`) + `gpu-cuda bfloat16` + `cpu float32`.
- `download_specs("hy-mt15-1.8b")` → `{"repos": ["tencent/HY-MT1.5-1.8B"], "urls": []}`
  (and 7B), with no `ignore` key.
- `resolve_translate("hy-mt15-1.8b", "auto", gpu_machine_with_fp8_capability)`
  prefers the FP8/GPU plan then the CPU floor (mirror the HY-MT2 resolve test).

Renderer:
- `NATIVE_TRANSLATION` + `nativeTranslationCards(...)` include `hy-mt15-1.8b` and
  `hy-mt15-7b` with `downloadId === selectId`, ordered after the HY-MT2 cards.

## Risks / caveats

- **Prompt parity:** HY-MT1.5 is fed HY-MT2's instruction by design (reuse). Both
  are equivalent "translate into {t}, output only translation" instructions; if a
  field quality regression appears, the fix is a model-aware `_hunyuan_prompt`
  (deferred, not built now).
- **Repo casing:** `tencent/HY-MT1.5-*` (uppercase `HY`) vs HY-MT2's
  `tencent/Hy-MT2-*` — easy to mistype; the ids above are verified.
- **7B has no field usage yet** — added for HY-MT2 parity / higher-quality option;
  its download is large (15.3 GB bf16 / 7.7 GB FP8).
