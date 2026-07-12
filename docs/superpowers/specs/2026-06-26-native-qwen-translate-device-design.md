# Native Qwen Translation: version ladder + device selection Design

## Context

The LOCAL_NATIVE sidecar's translation engine (`sidecar/sokuji_sidecar/translate_engine.py`) currently has **no device selection** and a single hardcoded Qwen default. `init()` takes only `(model_id, source_lang, target_lang)`; for non-Opus-MT models it loads `Qwen/Qwen2.5-0.5B-Instruct` via `AutoModelForCausalLM.from_pretrained(mid, torch_dtype="auto")` with **no `.to(device)`** — so it lands on CPU implicitly, can't use the GPU, and has no AUTO/CPU/GPU control. ASR, by contrast, has a full hardware resolver (`accel.py`) with AUTO/CPU/GPU device selection, a catalog of per-model deployments, graceful GPU→CPU fallback, and a `ready` reply that echoes the resolved backend/device.

This design gives the translation engine **ASR-parity device selection** (AUTO / CPU / GPU) and a **version ladder of selectable Qwen models** mirroring what the browser LOCAL_INFERENCE provider already offers. It is text-only translation; Qwen3.5 is a VLM-class model but is fed text only (no image tokens), exactly as the browser `qwen35` worker does.

### Why mirror LOCAL_INFERENCE's lineup

The browser provider already ships a curated Qwen translation ladder (`src/lib/local-inference/modelManifest.ts`): `qwen2.5-0.5b-translation`, `qwen3-0.6b-translation`, `qwen3.5-0.8b-translation`, `qwen3.5-2b-translation`. The native sidecar should expose the same versions so the two providers are conceptually aligned. The browser uses ONNX exports (`onnx-community/...`); the native sidecar loads **original PyTorch repos** under the official `Qwen/` org via transformers.

## Locked decisions

- **Model lineup** — four native models mapping to original PyTorch repos:

  | Version | Native id | HF repo (PyTorch) | Model class | Thinking handling |
  |---|---|---|---|---|
  | 2.5 | `qwen2.5-0.5b` | `Qwen/Qwen2.5-0.5B-Instruct` | `AutoModelForCausalLM` + `AutoTokenizer` | none (2.5 has no thinking mode) |
  | 3 | `qwen3-0.6b` | `Qwen/Qwen3-0.6B` | `AutoModelForCausalLM` + `AutoTokenizer` | append ` /no_think` to system prompt |
  | 3.5 | `qwen3.5-0.8b` | `Qwen/Qwen3.5-0.8B` | `Qwen3_5ForConditionalGeneration` + `AutoProcessor` | non-thinking by default |
  | 3.5 | `qwen3.5-2b` | `Qwen/Qwen3.5-2B` | `Qwen3_5ForConditionalGeneration` + `AutoProcessor` | non-thinking by default |

- **Single transformers backend strategy** — GPU and CPU are both served by transformers (`.to(device)` + dtype). No CTranslate2/GGUF/quantized CPU path in this increment. CPU runs float32 (works, slower on the 2B); GPU runs bfloat16.
- **Every model gets a CPU floor** — each catalog row carries two deployments: `gpu-cuda` (bfloat16) + `cpu` (float32). So AUTO degrades gracefully to CPU when no GPU, and an explicit CPU override always has a plan to load. (Contrast with ASR's GPU-only speech-LLMs that intentionally `NoUsablePlan` on CPU.)
- **Maximal reuse of `accel.py`** — the resolver internals are already stage-agnostic; only `resolve()`'s catalog lookup is ASR-specific. We add a translation sibling rather than duplicating the resolver.
- **Self-gating for Qwen3.5** — the VLM-class backend is reported available only when `transformers.models.qwen3_5` is importable (same pattern as `qwen3asr`/`cohere_asr`). If the installed transformers lacks the class, the two Qwen3.5 rows simply don't appear — no broken card, no hard failure.
- **Opus-MT untouched** — the existing `OpusMtTranslator` branch (onnxruntime, torch-free, no device concept) stays as-is. The legacy `""`/`"qwen"` default mapping to `Qwen/Qwen2.5-0.5B-Instruct` continues to work.
- **VRAM reality** — on a 12 GB GPU shared with a GPU ASR model (Qwen3-ASR-1.7B ≈ 5 GB), the small translation models (0.5B/0.6B/0.8B ≈ 1–2 GB) co-reside comfortably; Qwen3.5-2B (≈ 4–5 GB) fits alongside ASR (~10 GB total). Larger models are intentionally excluded.

## Components

### 1. Translation catalog — `sidecar/sokuji_sidecar/catalog.py`

Add a `TranslateModel` dataclass (same shape as `AsrModel`) and lookup functions, alongside the existing ASR catalog.

```python
@dataclass(frozen=True)
class TranslateModel:
    id: str
    name: str
    languages: tuple[str, ...]
    deployments: tuple[Deployment, ...]
    recommended: bool = False
    sort_order: int = 99

TRANSLATE_MODELS = [
    TranslateModel("qwen2.5-0.5b", "Qwen 2.5 0.5B", ("multi",),
        (Deployment("qwen_translate", "gpu-cuda", "bfloat16", "Qwen/Qwen2.5-0.5B-Instruct", 1.0),
         Deployment("qwen_translate", "cpu", "float32", "Qwen/Qwen2.5-0.5B-Instruct", 1.0)),
        recommended=True, sort_order=1),
    TranslateModel("qwen3-0.6b", "Qwen 3 0.6B", ("multi",),
        (Deployment("qwen_translate", "gpu-cuda", "bfloat16", "Qwen/Qwen3-0.6B", 1.0),
         Deployment("qwen_translate", "cpu", "float32", "Qwen/Qwen3-0.6B", 1.0)),
        recommended=True, sort_order=2),
    TranslateModel("qwen3.5-0.8b", "Qwen 3.5 0.8B", ("multi",),
        (Deployment("qwen35_translate", "gpu-cuda", "bfloat16", "Qwen/Qwen3.5-0.8B", 1.0),
         Deployment("qwen35_translate", "cpu", "float32", "Qwen/Qwen3.5-0.8B", 1.0)),
        sort_order=3),
    TranslateModel("qwen3.5-2b", "Qwen 3.5 2B", ("multi",),
        (Deployment("qwen35_translate", "gpu-cuda", "bfloat16", "Qwen/Qwen3.5-2B", 1.0),
         Deployment("qwen35_translate", "cpu", "float32", "Qwen/Qwen3.5-2B", 1.0)),
        sort_order=4),
]

def translate_models() -> list[TranslateModel]: return TRANSLATE_MODELS
def translate_model(model_id: str) -> TranslateModel | None: ...
```

`Deployment` is reused unchanged. `languages=("multi",)` mirrors the ASR convention for "any language".

### 2. Resolver sibling — `sidecar/sokuji_sidecar/accel.py`

`resolve()` currently inlines: catalog lookup + bench-cache assembly + `resolve_deployments` + `NoUsablePlan`. Extract the model-object-driven part into a shared helper, then add a translation entry point. No behavior change to ASR.

```python
def _resolve_model(model, model_id, override, machine):
    """Shared: build bench cache for model.deployments, rank, raise NoUsablePlan if empty."""
    # (moved body of current resolve(), minus the catalog.asr_model lookup)

def resolve(model_id, override="auto", machine=None):       # ASR — unchanged signature
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None: raise ValueError(f"unknown asr model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())

def resolve_translate(model_id, override="auto", machine=None):   # new
    from . import catalog
    model = catalog.translate_model(model_id)
    if model is None: raise ValueError(f"unknown translate model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())
```

Extend `_installed()`'s module map with the translation backends:

```python
"qwen_translate": "transformers",                       # 2.5 / 3 (CausalLM) — always present
"qwen35_translate": "transformers.models.qwen3_5",      # 3.5 VLM class — self-gates
```

`resolve_deployments`, `load_with_fallback`, `_tier_available`, `TIER_RANK`/`TIER_DEVICE`, `_apply_bench`, `measure_rtf`, the bench cache, and `probe()` are all reused unchanged.

### 3. Translation backends — `sidecar/sokuji_sidecar/backends.py` (or a new `translate_backends.py`)

Two registered backends exposing a `translate(text, system_prompt, src, tgt, wrap)` method (the translation analogue of `transcribe`), plus the standard `load(model_ref, device, compute_type)` / `unload()` / `is_loaded`. They map `compute_type`→torch dtype and `.to(device)` exactly like the ASR `TransformersBackend`.

```python
@register_backend
class QwenTranslateBackend:           # Qwen 2.5 / 3  — CausalLM
    NAME = "qwen_translate"
    def load(self, model_ref, device, compute_type):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self._dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
        self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
        self._model = AutoModelForCausalLM.from_pretrained(
            model_ref, torch_dtype=self._dtype, local_files_only=True).to(device).eval()
        self._device, self._ref = device, model_ref
    def translate(self, text, system_prompt, src, tgt, wrap):
        sys_p = system_prompt or _default_prompt(src, tgt)
        if "qwen3" in self._ref.lower():       # Qwen3 thinking-mode off
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        # apply_chat_template + generate(max_new_tokens=512, do_sample=False) + decode
        # strip any residual <think>…</think> defensively

@register_backend
class Qwen35TranslateBackend:         # Qwen 3.5  — VLM class, text-only
    NAME = "qwen35_translate"
    def load(self, model_ref, device, compute_type):
        from transformers import Qwen3_5ForConditionalGeneration, AutoProcessor
        # bf16/fp32 + .to(device); AutoProcessor for the chat template
    def translate(self, text, system_prompt, src, tgt, wrap):
        # text-only conversation (no image content); non-thinking by default
```

GPU OOM / missing class / no CUDA all raise `BackendLoadError` → the resolver's `load_with_fallback` advances to the CPU plan. The CPU deployment for each model guarantees a working fallback.

A shared `_default_prompt(src, tgt)` mirrors the renderer's `buildDefaultLocalPrompt` shape (translator instruction, `<transcript>` wrapping, "output only the translation") so behavior matches the browser provider when the renderer sends an empty system prompt.

### 4. Engine wiring — `sidecar/sokuji_sidecar/translate_engine.py`

```python
def init(self, model_id=None, source_lang="", target_lang="", device="auto"):
    self.close()                                   # VRAM hygiene — free prior model first
    self._src, self._tgt = source_lang, target_lang
    if model_id and "opus-mt" in model_id:
        ... # existing OpusMtTranslator branch, no device
        self.resolved = {"backend": "opus_mt", "device": "cpu", "computeType": "int8"}
        return ms
    self._opus = None
    from . import accel
    plans = accel.resolve_translate(model_id or "qwen2.5-0.5b", override=device or "auto")
    self._backend, plan, _notice = accel.load_with_fallback(plans)
    self.resolved = {"backend": plan.backend, "device": plan.device, "computeType": plan.compute_type}
    return ms

def translate(self, text, system_prompt="", wrap_transcript=False):
    if self._opus is not None: ...                 # existing path
    return self._backend.translate(text, system_prompt, self._src, self._tgt, wrap_transcript), ms

def close(self):
    if self._backend is not None: self._backend.unload(); self._backend = None
```

The `translate_init` handler reads `msg.get("device", "auto")`; the `ready` reply merges `self.resolved` (backend/device/computeType) just like ASR's `_h_asr_init`.

Default model id when none is sent changes from `Qwen/Qwen2.5-0.5B-Instruct` (a repo) to the catalog id `qwen2.5-0.5b`. The legacy `""`/`"qwen"` download id mapping in `native_models.py` is preserved for back-compat.

### 5. Download mapping — `sidecar/sokuji_sidecar/native_models.py`

Add `download_specs` rows mapping each native id to its PyTorch repo:

```python
if model_id == "qwen2.5-0.5b": return {"repos": ["Qwen/Qwen2.5-0.5B-Instruct"], "urls": []}
if model_id == "qwen3-0.6b":   return {"repos": ["Qwen/Qwen3-0.6B"], "urls": []}
if model_id == "qwen3.5-0.8b": return {"repos": ["Qwen/Qwen3.5-0.8B"], "urls": []}
if model_id == "qwen3.5-2b":   return {"repos": ["Qwen/Qwen3.5-2B"], "urls": []}
```

The existing `""`/`"qwen"` → `Qwen/Qwen2.5-0.5B-Instruct` (overridable via `SOKUJI_TRANSLATE_MODEL`) stays.

### 6. Catalog feed — `sidecar/sokuji_sidecar/accel.py` (`_h_models_catalog`)

The catalog feed currently serves `catalog.asr_models()` only. Extend it to also serve translate models so the renderer can show per-model tier availability. **Decision: add a `kind` field** (`"asr"` default | `"translate"`) to the `models_catalog` message; `_h_models_catalog` selects `catalog.asr_models()` vs `catalog.translate_models()` accordingly and returns the same `{id, name, languages, recommended, tiers}` shape. (A sibling handler was considered but rejected — one handler with a discriminator keeps the per-tier `available` computation in a single place.) The per-tier `available` computation (`d.backend in m.installed and _tier_available(d.tier, m)`) is reused verbatim — this is what greys out GPU tiers on CPU-only boxes and hides self-gated Qwen3.5.

### 7. Renderer (TypeScript)

- **`settingsStore.ts`** — add `translationDevice: 'auto' | 'cpu' | 'cuda'` (default `'auto'`), mirroring `asrDevice`. Plumb through `LocalNativeSessionConfig` (`IClient.ts`) and the session-config builder (the `asrDevice: settings.asrDevice`-style line).
- **`NativeTranslateClient.ts`** — `init(sourceLang, targetLang, modelId?, device?)` sends `device` on `translate_init`; return the resolved `{backend, device, computeType}` from the `ready` reply (extend `nativeProtocol.ts` if needed).
- **`LocalNativeClient`** — pass `config.translationDevice` to `translate.init(...)`; record the resolved device back into the store (mirror `setAsrResolved`).
- **`nativeCatalog.ts`** — replace the single `Qwen LLM` translation row with the four versioned rows (`qwen2.5-0.5b`, `qwen3-0.6b`, `qwen3.5-0.8b`, `qwen3.5-2b`); keep `''`→default resolution for back-compat. Add tier/availability wiring from the translate catalog feed.
- **UI (`NativeModelManagementSection.tsx`)** — add a translation device segmented control mirroring the ASR one: `cuda` option shown only when a GPU tier is available; disabled while a session is active.

## Data flow

```
UI device control (translationDevice) ─▶ settingsStore ─▶ LocalNativeSessionConfig
  ─▶ LocalNativeClient ─▶ NativeTranslateClient.init(src, tgt, modelId, device)
  ─▶ {translate_init, model, device} over WS
  ─▶ translate_engine.init ─▶ accel.resolve_translate(model_id, device)
      ─▶ ranked Plans (gpu-cuda first under AUTO, CPU floor last)
      ─▶ load_with_fallback ─▶ QwenTranslateBackend | Qwen35TranslateBackend
  ─▶ ready{backend, device, computeType} echoed to UI
  ─▶ translate{text, systemPrompt, wrap} ─▶ backend.translate ─▶ translation{...}
```

## Error handling

- **GPU load failure** (OOM, no CUDA, missing VLM class) → `BackendLoadError` → resolver falls back to the CPU deployment. The `notice` carries the human-readable skip reason.
- **Unknown model id** → `ValueError` from `resolve_translate` (surfaced as an `error` message to the renderer).
- **Self-gated Qwen3.5** — if `transformers.models.qwen3_5` is absent, `qwen35_translate` is not in `machine.installed`; both Qwen3.5 deployments are filtered out → `NoUsablePlan` if a Qwen3.5 model is explicitly requested, and the rows are marked unavailable in the catalog feed so the UI hides them.
- **Model not downloaded** — unchanged: `native_models.status()` returns `absent`; load uses `local_files_only=True` and the renderer gates on download readiness before init.

## Testing

**Sidecar (pytest, mirroring `test_catalog.py` / `test_accel.py` / `test_translate_engine.py`):**
- Catalog: the four translate models are present with both `gpu-cuda` and `cpu` deployments; `translate_model(id)` lookups work; unknown id → `None`.
- `resolve_translate`: AUTO → gpu-cuda first on a CUDA machine, cpu-only machine → cpu plan; explicit `cpu`/`cuda` override reorders correctly; GPU-only-class-missing (qwen3.5 self-gate) excludes those rows.
- Engine: `init(device=...)` calls `resolve_translate` + `load_with_fallback`; `ready` reply includes `resolved`; `close()` unloads the prior backend before re-init (VRAM hygiene); Opus-MT branch still bypasses the resolver.
- Backend (mocked transformers): `qwen_translate` appends `/no_think` for a Qwen3 ref and not for a 2.5 ref; `wrap` wraps in `<transcript>`; thinking residue is stripped.
- GPU smoke (behind `SOKUJI_RUN_GPU`, like `test_qwen3asr_real_gpu_smoke`): one per family — load + translate a short sentence on CUDA, assert non-empty output in the target language.

**Renderer (vitest):**
- `NativeTranslateClient.init` sends `device` on the wire and returns resolved fields.
- `nativeCatalog` exposes the four translate rows; device control shows `cuda` only when a GPU tier is available.
- `settingsStore` persists `translationDevice` and plumbs it into the session config.

## Verification notes (resolved during implementation, not blocking design)

- **Does the sidecar venv's transformers (5.13.0.dev0 fork) include `qwen3_5`?** If yes, Qwen3.5 rows light up; if no, they self-gate off and only 2.5/3 are offered. Either way the increment is correct. Verify with `python -c "import importlib.util; print(importlib.util.find_spec('transformers.models.qwen3_5'))"` in the sidecar venv; if absent and Qwen3.5 is wanted now, note the transformers requirement (do not hard-pin in this increment).
- **Confirm `Qwen/Qwen3.5-0.8B` / `Qwen/Qwen3.5-2B` PyTorch repos** are downloadable (HF research indicates they exist as the base for the onnx-community exports).
