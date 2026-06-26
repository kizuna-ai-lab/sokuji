# Native Quant-Variant Selection + FP8 Runtime (A.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At download time, automatically pick the model variant (bf16 / FP8) best suited to this machine's GPU VRAM + architecture (reserving VRAM for the ASR + TTS stages), download and load that variant, with a manual override and a per-variant size UI.

**Architecture:** A model carries multiple variant `Deployment`s (each a repo + compute_type + arch gate). A deterministic pure function `select_variant(model, machine, reserved_bytes, pin)` chooses one; download and load both call it (same inputs → same variant, no persisted state). FP8 loads via transformers' compressed-tensors integration. `select_variant` becomes the single source of truth for "which variant"; the existing `load_with_fallback` remains the runtime OOM safety net.

**Tech Stack:** Python sidecar (transformers 5.13, torch 2.x+cu128, compressed-tensors), React/TypeScript renderer, pytest + vitest.

## Global Constraints

- New dependency: **`compressed-tensors`** (FP8 loader). The FP8 *variant* (not the backend NAME) is gated on `compressed_tensors` being importable.
- FP8 variants only on `hy-mt2-1.8b` / `hy-mt2-7b` (repos `tencent/Hy-MT2-1.8B-FP8`, `tencent/Hy-MT2-7B-FP8`). Gemma/Qwen/ASR/TTS rows unchanged.
- FP8 `min_capability = (8, 9)` (Ada+); bf16 = no gate.
- HY-MT2 FP8 = compressed-tensors / naive-quantized / native `hunyuan_v1_dense` → load with `dtype="auto"`, **no `trust_remote_code`**.
- `select_variant` is deterministic, stage-general, and **not persisted**.
- Quality order encoded explicitly: `bf16 > fp8` (room for `> int4 > nvfp4` later).
- Conservative fallback: if VRAM/arch/estimate is unknown, never gamble on the whole card — bf16-if-fits-else-CPU.
- `translate_engine.py` keeps its role; only its `init` signature gains `reserved_bytes`.
- English-only comments. Every commit message ends with (blank line then):
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Sidecar tests: `cd sidecar && .venv/bin/python -m pytest` (NOT bare `pytest`). Renderer: `npx vitest run <paths>`.

---

### Task 1: Probe — GPU VRAM + compute capability

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`Gpu` dataclass ~line 17; `_nvidia_gpus` ~line 36)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: `Gpu(vendor, name, vram_mb, capability)` where `capability: tuple[int,int] | None`. `_nvidia_gpus()` populates `vram_mb` (bytes→MB) and `capability` from torch, best-effort.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_accel.py`:

```python
def test_nvidia_gpus_populates_vram_and_capability(monkeypatch):
    import types, sys
    fake_torch = types.SimpleNamespace(
        cuda=types.SimpleNamespace(
            get_device_properties=lambda i: types.SimpleNamespace(total_memory=12 * 1024**3),
            get_device_capability=lambda i: (8, 9),
        )
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(accel, "_cuda_count", lambda: 1)
    gpus = accel._nvidia_gpus()
    assert len(gpus) == 1
    assert gpus[0].vram_mb == 12 * 1024  # 12 GiB in MB
    assert gpus[0].capability == (8, 9)


def test_nvidia_gpus_degrades_when_torch_fails(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "torch", None)  # import torch → TypeError/ImportError
    monkeypatch.setattr(accel, "_cuda_count", lambda: 1)
    gpus = accel._nvidia_gpus()
    assert len(gpus) == 1 and gpus[0].vram_mb == 0 and gpus[0].capability is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k "vram_and_capability or degrades_when_torch" -v`
Expected: FAIL — `Gpu` has no `capability`; `accel._cuda_count` undefined.

- [ ] **Step 3: Implement**

In `accel.py`, extend `Gpu` and split the device count out of `_nvidia_gpus` so it's patchable:

```python
@dataclass(frozen=True)
class Gpu:
    vendor: str
    name: str
    vram_mb: int
    capability: tuple[int, int] | None = None


def _cuda_count() -> int:
    from ctranslate2 import get_cuda_device_count
    return get_cuda_device_count()


def _nvidia_gpus() -> tuple[Gpu, ...]:
    n = _cuda_count()
    gpus = []
    for i in range(n):
        vram_mb, cap = 0, None
        try:
            import torch
            vram_mb = int(torch.cuda.get_device_properties(i).total_memory // (1024 * 1024))
            cap = tuple(torch.cuda.get_device_capability(i))  # (major, minor)
        except Exception:
            pass
        gpus.append(Gpu("nvidia", "", vram_mb, cap))
    return tuple(gpus)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -v`
Expected: PASS (new tests + existing accel tests — `capability` defaults keep old construction valid).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(native): probe GPU VRAM + compute capability

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Deployment variant fields + HY-MT2 FP8 rows

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (`Deployment` ~line 14; `TRANSLATE_MODELS` ~line 109)
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Produces: `Deployment(backend, tier, compute_type, artifact, rank, min_capability=None, est_bytes=None)`. The `hy-mt2-7b` / `hy-mt2-1.8b` rows gain a `gpu-cuda/fp8` deployment pointing at the `-FP8` repo with `min_capability=(8,9)`.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_catalog.py`:

```python
def test_hymt2_has_fp8_variant():
    from sokuji_sidecar import catalog
    for mid, fp8_repo in [("hy-mt2-7b", "tencent/Hy-MT2-7B-FP8"),
                          ("hy-mt2-1.8b", "tencent/Hy-MT2-1.8B-FP8")]:
        m = catalog.translate_model(mid)
        fp8 = [d for d in m.deployments if d.compute_type == "fp8"]
        assert len(fp8) == 1
        assert fp8[0].tier == "gpu-cuda"
        assert fp8[0].backend == "hunyuan_translate"
        assert fp8[0].artifact == fp8_repo
        assert fp8[0].min_capability == (8, 9)
        # bf16 + cpu still present, bf16 has no capability gate
        bf16 = next(d for d in m.deployments if d.tier == "gpu-cuda" and d.compute_type == "bfloat16")
        assert bf16.min_capability is None
        assert any(d.tier == "cpu" for d in m.deployments)


def test_gemma_has_no_fp8_variant():
    from sokuji_sidecar import catalog
    g = catalog.translate_model("translategemma-4b")
    assert not any(d.compute_type == "fp8" for d in g.deployments)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py::test_hymt2_has_fp8_variant -v`
Expected: FAIL — no fp8 deployment.

- [ ] **Step 3: Implement**

In `catalog.py`, add the two fields to `Deployment`:

```python
@dataclass(frozen=True)
class Deployment:
    backend: str
    tier: str
    compute_type: str
    artifact: str
    rank: float
    min_capability: tuple[int, int] | None = None   # min CUDA compute cap for a GPU variant
    est_bytes: int | None = None                     # footprint estimate; None → model_size(artifact)
```

Add a helper and the FP8 deployments after the existing rows. Replace the two HY-MT2 `_llm_translate_row(...)` entries in `TRANSLATE_MODELS` with rows that append an FP8 variant. Add below `_llm_translate_row`:

```python
def _with_fp8(row, fp8_repo):
    """Return a copy of a TranslateModel row with a gpu-cuda fp8 variant appended."""
    fp8 = Deployment(row.deployments[0].backend, "gpu-cuda", "fp8", fp8_repo, 1.0,
                     min_capability=(8, 9))
    return TranslateModel(row.id, row.name, row.languages,
                          row.deployments + (fp8,),
                          recommended=row.recommended, sort_order=row.sort_order)
```

In `TRANSLATE_MODELS`, wrap the two HY-MT2 rows:

```python
    _with_fp8(_llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B",
                                 "tencent/Hy-MT2-1.8B", "hunyuan_translate", 6),
              "tencent/Hy-MT2-1.8B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B",
                                 "tencent/Hy-MT2-7B", "hunyuan_translate", 7),
              "tencent/Hy-MT2-7B-FP8"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -v`
Expected: PASS (new + existing; the bf16/cpu deployments are unchanged).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(native): Deployment variant fields + HY-MT2 FP8 catalog rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `select_variant` + format gate

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (add `select_variant`, `_format_ready`, `_VARIANT_QUALITY`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `Gpu.vram_mb`, `Gpu.capability` (Task 1); `Deployment.min_capability`, `Deployment.est_bytes` (Task 2); existing `_VRAM_WEIGHT_FACTOR`, `_VRAM_CONTEXT_BYTES`, `_model_weight_bytes`, `machine.installed`.
- Produces: `select_variant(model, machine, reserved_bytes: int, pin: str | None = None) -> Deployment`. `_format_ready(compute_type) -> bool`.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/tests/test_accel.py`:

```python
def _machine(vram_mb, cap, installed=("hunyuan_translate",), ct_ready=True):
    g = accel.Gpu("nvidia", "", vram_mb, cap)
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, nvidia=(g,),
                         apple_silicon=False, dml_adapters=(), installed=frozenset(installed),
                         fingerprint="t")


def _hymt2_7b():
    from sokuji_sidecar import catalog
    return catalog.translate_model("hy-mt2-7b")


def test_select_variant_picks_fp8_on_ada_when_bf16_too_big(monkeypatch):
    # est_bytes: bf16 ~15GB, fp8 ~8GB. 24GB Ada, light 2GB reserve → bf16 fits.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    m = _machine(12 * 1024, (8, 9))                       # 12GB Ada
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=2 * 1024**3)
    assert d.compute_type == "fp8"                        # bf16 (15+headroom) won't fit, fp8 does


def test_select_variant_excludes_fp8_on_ampere(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    m = _machine(12 * 1024, (8, 6))                       # Ampere sm_86 → no FP8
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"                                # bf16 too big, fp8 arch-excluded → cpu floor


def test_select_variant_fp8_dropped_when_compressed_tensors_absent(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: ct != "fp8")
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    m = _machine(12 * 1024, (8, 9))
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"                                # fp8 ungated off, bf16 too big → cpu


def test_select_variant_prefers_bf16_when_it_fits(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 4, "fp8": 2, "float32": 4}[d.compute_type] * 1024**3)
    m = _machine(24 * 1024, (8, 9))
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.compute_type == "bfloat16"                   # both fit → highest quality


def test_select_variant_pin_honored_when_valid(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 4, "fp8": 2, "float32": 4}[d.compute_type] * 1024**3)
    m = _machine(24 * 1024, (8, 9))
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0, pin="fp8")
    assert d.compute_type == "fp8"                        # pinned despite bf16 fitting


def test_select_variant_conservative_when_no_vram(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 4 * 1024**3)
    m = _machine(0, None)                                 # probe couldn't read VRAM
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"                                # never gamble → cpu floor
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k select_variant -v`
Expected: FAIL — `accel.select_variant` / `_format_ready` / `_est_bytes` undefined.

- [ ] **Step 3: Implement**

Add to `accel.py`:

```python
# Higher = better quality. Future formats slot in (int4, nvfp4) without touching callers.
_VARIANT_QUALITY = {"bfloat16": 3.0, "float16": 3.0, "fp8": 2.0, "int4": 1.5, "nvfp4": 1.8}

# Extra runtime/library a compute_type needs beyond its backend NAME being installed.
_FORMAT_MODULE = {"fp8": "compressed_tensors"}


def _format_ready(compute_type: str) -> bool:
    mod = _FORMAT_MODULE.get(compute_type)
    return True if mod is None else _has_mod(mod)


def _est_bytes(d) -> int | None:
    from . import native_models
    if d.est_bytes is not None:
        return d.est_bytes
    return native_models.model_size(d.artifact)


def select_variant(model, machine: Machine, reserved_bytes: int, pin: str | None = None):
    """Pick the best downloadable variant of `model` for this machine. Deterministic:
    same (model, machine, reserved_bytes, pin) → same Deployment. Falls back to the
    CPU floor when no GPU variant fits, the GPU/estimate is unknown, or a format's
    runtime is missing. `pin` (a compute_type) forces that variant when it's valid."""
    gpu = machine.nvidia[0] if machine.nvidia else None
    cpu_floor = next((d for d in model.deployments if d.tier == "cpu"), None)

    def candidate(d) -> bool:
        if d.tier == "cpu":
            return False
        if d.backend not in machine.installed or not _format_ready(d.compute_type):
            return False
        if gpu is None or not gpu.vram_mb or gpu.capability is None:
            return False
        if d.min_capability is not None and gpu.capability < d.min_capability:
            return False
        need = _est_bytes(d)
        if need is None:
            return False
        budget = gpu.vram_mb * 1024 * 1024 - reserved_bytes - _VRAM_CONTEXT_BYTES
        return need * _VRAM_WEIGHT_FACTOR <= budget

    cands = [d for d in model.deployments if candidate(d)]
    if pin is not None:
        pinned = next((d for d in cands if d.compute_type == pin), None)
        if pinned is not None:
            return pinned
    if cands:
        return max(cands, key=lambda d: (_VARIANT_QUALITY.get(d.compute_type, 0.0), d.rank))
    return cpu_floor
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k select_variant -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(native): select_variant download-time variant picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Route `resolve_translate` through `select_variant`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`resolve_translate` ~line 192)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `select_variant` (Task 3), existing `resolve_deployments`/`_tier_available`/`Plan`.
- Produces: `resolve_translate(model_id, override="auto", machine=None, reserved_bytes=0)`. When `override == "auto"` and the model has a fitting GPU variant, returns `[chosen_variant_plan, cpu_floor_plan]`; an explicit device `override` keeps the existing behavior (pins that tier). `reserved_bytes` and an optional `pin` (compute_type) drive `select_variant`.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_accel.py`:

```python
def test_resolve_translate_uses_selected_variant(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(12 * 1024, (8, 9)))
    plans = accel.resolve_translate("hy-mt2-7b", override="auto", reserved_bytes=2 * 1024**3)
    # chosen GPU variant first (fp8), CPU floor last
    assert plans[0].compute_type == "fp8" and plans[0].device == "cuda"
    assert plans[-1].device == "cpu"


def test_resolve_translate_explicit_device_override_unchanged(monkeypatch):
    # device override ("cuda"/"cpu") keeps prior tier-pinning behavior, not variant selection
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(12 * 1024, (8, 9)))
    plans = accel.resolve_translate("hy-mt2-7b", override="cpu")
    assert plans[0].device == "cpu"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k resolve_translate_uses -v`
Expected: FAIL — `resolve_translate` has no `reserved_bytes` and doesn't call `select_variant`.

- [ ] **Step 3: Implement**

Replace `resolve_translate` in `accel.py`:

```python
def resolve_translate(model_id: str, override: str = "auto", machine: Machine | None = None,
                      reserved_bytes: int = 0, pin: str | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.translate_model(model_id)
    if model is None:
        raise ValueError(f"unknown translate model: {model_id}")
    machine = machine or probe()
    if override == "auto":
        chosen = select_variant(model, machine, reserved_bytes, pin)
        cpu = next((d for d in model.deployments if d.tier == "cpu"), None)
        picks = [chosen] + ([cpu] if cpu is not None and cpu is not chosen else [])
        return [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank)
                for d in picks]
    # explicit device override: unchanged tier-pinning path
    return _resolve_model(model, model_id, override, machine)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k resolve_translate -v`
Expected: PASS. Also run the existing translate-resolution tests: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py tests/test_translate_engine.py -v` — Expected: PASS (auto path now returns [variant, cpu]; existing tests that used `override="cuda"`/`"cpu"` keep working).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(native): resolve_translate selects variant + CPU-floor fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: FP8 loading in the Hunyuan backend + dependency

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (`HunyuanTranslateBackend.load`)
- Modify: `sidecar/requirements.txt`
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: existing `HunyuanTranslateBackend`, `BackendLoadError`.
- Produces: `load(model_ref, device, compute_type)` handles `compute_type == "fp8"` by loading without a forced dtype (compressed-tensors applies the quant).

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_translate_backends.py`:

```python
def test_hunyuan_fp8_loads_without_forced_dtype(monkeypatch):
    import sys
    captured = {}
    fake = MagicMock()
    def from_pretrained(ref, **kw):
        captured.update(kw)
        return MagicMock(to=lambda d: MagicMock(eval=lambda: MagicMock()))
    fake.AutoModelForCausalLM.from_pretrained.side_effect = from_pretrained
    fake.AutoTokenizer.from_pretrained.return_value = MagicMock()
    monkeypatch.setitem(sys.modules, "transformers", fake)
    b = tb.HunyuanTranslateBackend()
    b.load("tencent/Hy-MT2-7B-FP8", "cuda", "fp8")
    # fp8 → dtype="auto", NOT a forced torch dtype; no trust_remote_code
    assert captured.get("dtype") == "auto"
    assert "trust_remote_code" not in captured


def test_hunyuan_bf16_still_forces_dtype(monkeypatch):
    import sys, types
    captured = {}
    fake = MagicMock()
    def from_pretrained(ref, **kw):
        captured.update(kw)
        return MagicMock(to=lambda d: MagicMock(eval=lambda: MagicMock()))
    fake.AutoModelForCausalLM.from_pretrained.side_effect = from_pretrained
    fake.AutoTokenizer.from_pretrained.return_value = MagicMock()
    monkeypatch.setitem(sys.modules, "transformers", fake)
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(bfloat16="BF16", float32="F32"))
    b = tb.HunyuanTranslateBackend()
    b.load("tencent/Hy-MT2-7B", "cuda", "bfloat16")
    assert captured.get("dtype") == "BF16"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_backends.py -k "fp8_loads or bf16_still" -v`
Expected: FAIL — current `load` always passes `dtype=<torch dtype>`.

- [ ] **Step 3: Implement**

In `translate_backends.py`, change `HunyuanTranslateBackend.load`'s model construction to branch on `compute_type`:

```python
    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            if compute_type == "fp8":
                # Pre-quantized compressed-tensors checkpoint: let its quantization_config
                # drive loading (dtype="auto"); forcing a dtype would fight the quant.
                model = AutoModelForCausalLM.from_pretrained(
                    model_ref, dtype="auto", local_files_only=True)
            else:
                dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
                model = AutoModelForCausalLM.from_pretrained(
                    model_ref, dtype=dtype, local_files_only=True)
            self._model = model.to(device).eval()
            self._device = device
        except Exception as e:
            raise BackendLoadError(str(e))
```

Add to `sidecar/requirements.txt`:

```
compressed-tensors
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_backends.py -v`
Expected: PASS (new + existing hunyuan/gemma/qwen tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/requirements.txt sidecar/tests/test_translate_backends.py
git commit -m "feat(native): FP8 loading via compressed-tensors in hunyuan backend

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Thread the ASR+TTS reserve into translation load

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_engine.py` (`init`, `_h_translate_init`)
- Test: `sidecar/tests/test_translate_engine.py`

**Interfaces:**
- Consumes: `resolve_translate(..., reserved_bytes=, pin=)` (Task 4), `native_models.model_size`.
- Produces: `TranslateEngine.init(model_id, source_lang, target_lang, device="auto", reserved_bytes=0, pin=None)`; the `translate_init` WS handler computes `reserved_bytes` from the message's `asrModel` + `ttsModel` and forwards it.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_translate_engine.py`:

```python
def test_translate_init_forwards_reserved_bytes(monkeypatch):
    import asyncio
    from sokuji_sidecar import translate_engine as te, native_models as nm
    seen = {}
    def fake_init(self, model_id=None, source_lang="", target_lang="", device="auto",
                  reserved_bytes=0, pin=None):
        seen["reserved_bytes"] = reserved_bytes
        self.resolved = {"backend": "x", "device": "cpu", "computeType": "fp8"}
        return 0
    monkeypatch.setattr(te.TranslateEngine, "init", fake_init)
    monkeypatch.setattr(nm, "model_size", lambda mid: {"voxtral-mini-4b-realtime": 8 * 1024**3,
                                                       "piper-en": 100 * 1024**2}.get(mid, 0))
    state = {"translate_engine": te.TranslateEngine()}
    msg = {"type": "translate_init", "id": 1, "model": "hy-mt2-7b",
           "asrModel": "voxtral-mini-4b-realtime", "ttsModel": "piper-en"}
    reply, _ = asyncio.run(te._h_translate_init(state, msg, None, None))
    assert reply["type"] == "ready"
    assert seen["reserved_bytes"] == 8 * 1024**3 + 100 * 1024**2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_engine.py -k forwards_reserved -v`
Expected: FAIL — `init` has no `reserved_bytes`; handler doesn't compute the reserve.

- [ ] **Step 3: Implement**

In `translate_engine.py`, add `reserved_bytes`/`pin` to `init` and pass them to `resolve_translate`:

```python
    def init(self, model_id=None, source_lang="", target_lang="", device="auto",
             reserved_bytes=0, pin=None):
        ...
        plans = accel.resolve_translate(model_id or "qwen2.5-0.5b", override=device or "auto",
                                        reserved_bytes=reserved_bytes, pin=pin)
        ...
```

Update `_h_translate_init` to compute the reserve from the other stages:

```python
async def _h_translate_init(state, msg, _b, conn=None):
    from . import native_models
    reserve = 0
    for k in ("asrModel", "ttsModel"):
        mid = msg.get(k)
        if mid:
            reserve += native_models.model_size(mid) or 0
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""),
        msg.get("device", "auto"), reserved_bytes=reserve, pin=msg.get("variant"))
    if conn is not None:
        conn.ctx["owns_translate"] = True
    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(state["translate_engine"], "resolved", None)
    if resolved:
        reply.update(resolved)
    return reply, None
```

(`msg.get("variant")` carries an optional manual pin; LocalNativeClient passes `asrModelId`/`ttsModelId` as `asrModel`/`ttsModel` — Task 8.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_engine.py -v`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_engine.py sidecar/tests/test_translate_engine.py
git commit -m "feat(native): reserve ASR+TTS VRAM when resolving translation variant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `list_variants` WS handler + variant-aware download

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_h_list_variants` + register)
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`download_specs` accepts a variant repo)
- Test: `sidecar/tests/test_accel.py`, `sidecar/tests/test_native_models.py`

**Interfaces:**
- Consumes: `select_variant` (Task 3), `_est_bytes`/`model_size`, `_format_ready`, `_tier_available`.
- Produces: WS `list_variants {model, asrId, ttsId, pin?} → {variants: [{id, computeType, repo, sizeBytes, supported, reason}], recommended}`. `download_specs(model_id, repo=None)` — when `repo` is given, downloads that variant repo.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/tests/test_accel.py`:

```python
def test_list_variants_marks_supported_and_recommended(monkeypatch):
    import asyncio
    from sokuji_sidecar import native_models as nm
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(12 * 1024, (8, 9)))
    monkeypatch.setattr(nm, "model_size", lambda repo: 8 * 1024**3)
    msg = {"type": "list_variants", "id": 1, "model": "hy-mt2-7b", "asrId": None, "ttsId": None}
    reply, _ = asyncio.run(accel._h_list_variants({}, msg, None, None))
    by = {v["computeType"]: v for v in reply["variants"]}
    assert by["fp8"]["supported"] is True and by["fp8"]["repo"] == "tencent/Hy-MT2-7B-FP8"
    assert by["bfloat16"]["supported"] is False           # 15GB > 12GB budget
    assert reply["recommended"] == "fp8"
```

Add to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_variant_repo_override():
    from sokuji_sidecar import native_models as nm
    spec = nm.download_specs("hy-mt2-7b", repo="tencent/Hy-MT2-7B-FP8")
    assert spec["repos"] == ["tencent/Hy-MT2-7B-FP8"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py::test_list_variants_marks_supported_and_recommended tests/test_native_models.py::test_download_specs_variant_repo_override -v`
Expected: FAIL — `_h_list_variants` undefined; `download_specs` has no `repo` param.

- [ ] **Step 3: Implement**

In `native_models.py`, give `download_specs` an optional variant repo override (first thing in the function):

```python
def download_specs(model_id, repo=None):
    """Map a model id to its download sources. `repo` overrides the model's default
    repo with a chosen variant's repo (the variant id resolves to a sibling repo)."""
    if repo:
        return {"repos": [repo], "urls": []}
    ...  # existing body unchanged
```

In `accel.py`, add the handler and register it:

```python
async def _h_list_variants(state, msg, _b, conn=None):
    from . import catalog, native_models
    m = probe()
    model = catalog.translate_model(msg.get("model"))
    if model is None:
        return {"type": "error", "id": msg.get("id"), "message": "unknown model"}, None
    reserve = sum((native_models.model_size(msg.get(k)) or 0)
                  for k in ("asrId", "ttsId") if msg.get(k))
    chosen = select_variant(model, m, reserve, pin=msg.get("pin"))
    gpu = m.nvidia[0] if m.nvidia else None
    budget = (gpu.vram_mb * 1024 * 1024 - reserve - _VRAM_CONTEXT_BYTES) if (gpu and gpu.vram_mb) else 0
    variants = []
    for d in model.deployments:
        if d.tier == "cpu":
            continue
        need = _est_bytes(d)
        if d.backend not in m.installed or not _format_ready(d.compute_type):
            supported, reason = False, "runtime not installed"
        elif gpu is None or not gpu.vram_mb or gpu.capability is None:
            supported, reason = False, "no usable GPU"
        elif d.min_capability is not None and gpu.capability < d.min_capability:
            supported, reason = False, f"needs compute capability {d.min_capability}"
        elif need is None:
            supported, reason = False, "size unknown"
        elif need * _VRAM_WEIGHT_FACTOR > budget:
            supported, reason = False, "too big for available VRAM"
        else:
            supported, reason = True, "fits"
        variants.append({"id": d.compute_type, "computeType": d.compute_type,
                         "repo": d.artifact, "sizeBytes": need or 0,
                         "supported": supported, "reason": reason})
    return {"type": "list_variants_result", "id": msg.get("id"),
            "variants": variants, "recommended": chosen.compute_type}, None
```

Register it alongside the others:

```python
def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"hardware_info": _h_hardware_info, "models_catalog": _h_models_catalog,
         "list_variants": _h_list_variants})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py tests/test_native_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_accel.py sidecar/tests/test_native_models.py
git commit -m "feat(native): list_variants WS handler + variant-aware download_specs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Renderer — `listVariants` client + types + pipeline reserve plumbing

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts` (message types)
- Modify: `src/lib/local-inference/native/NativeModelClient.ts` (or the existing model-query client) — add `listVariants`
- Modify: `src/services/clients/LocalNativeClient.ts` — pass `asrModel`/`ttsModel`/`variant` in the translate init
- Test: `src/lib/local-inference/native/NativeModelClient.test.ts`

**Interfaces:**
- Consumes: the `list_variants` WS contract (Task 7); the translate-init message now carrying `asrModel`/`ttsModel`/`variant`.
- Produces: `listVariants(model, asrId, ttsId, pin?) → { variants: VariantInfo[]; recommended: string }` with `interface VariantInfo { id: string; computeType: string; repo: string; sizeBytes: number; supported: boolean; reason: string }`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/local-inference/native/NativeModelClient.test.ts` (mirror its existing WS-mock pattern; read the file's existing mocks first):

```typescript
it('listVariants returns variants + recommended from the sidecar', async () => {
  const client = makeClientWithMockSocket(); // existing helper in this test file
  const p = client.listVariants('hy-mt2-7b', 'voxtral-mini-4b-realtime', null);
  respondWith({ type: 'list_variants_result',
    variants: [{ id: 'fp8', computeType: 'fp8', repo: 'tencent/Hy-MT2-7B-FP8', sizeBytes: 8e9, supported: true, reason: 'fits' }],
    recommended: 'fp8' });
  const r = await p;
  expect(r.recommended).toBe('fp8');
  expect(r.variants[0].supported).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: FAIL — `listVariants` undefined.

- [ ] **Step 3: Implement**

In `nativeProtocol.ts`, add:

```typescript
export interface VariantInfo {
  id: string;
  computeType: string;
  repo: string;
  sizeBytes: number;
  supported: boolean;
  reason: string;
}
export interface ListVariantsResult {
  type: 'list_variants_result';
  variants: VariantInfo[];
  recommended: string;
}
```

In the model client, add a request method following the existing `models_catalog`/request pattern in that file:

```typescript
async listVariants(model: string, asrId: string | null, ttsId: string | null, pin?: string)
  : Promise<{ variants: VariantInfo[]; recommended: string }> {
  const r = await this.request({ type: 'list_variants', model, asrId, ttsId, pin });
  return { variants: r.variants, recommended: r.recommended };
}
```

In `LocalNativeClient.ts`, where `translate.init` is called, also send the other-stage ids + the chosen variant so the sidecar computes the reserve (the init call already exists; thread the config fields). The translate client's `init` and its WS `translate_init` message gain `asrModel`, `ttsModel`, `variant` (read the current `NativeTranslateClient.init` and add these to the sent message).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/native`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native src/services/clients/LocalNativeClient.ts
git commit -m "feat(native): renderer listVariants client + pipeline reserve plumbing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Renderer — model card variant UI (pre/post download + override)

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (the translation `ModelCard`)
- Modify: `src/components/Settings/sections/ModelManagementSection.scss`
- Test: `src/components/Settings/sections/NativeModelManagementSection.test.tsx` (create if absent; otherwise add to the nearest existing Settings test)

**Interfaces:**
- Consumes: `listVariants` (Task 8); the existing card actions `download(id)`/`deleteModel(id)`/`statuses`/`sizes`.

- [ ] **Step 1: Write the failing test**

Add a test asserting the two card states. Use a mocked `listVariants` returning two variants (one supported, one not):

```typescript
it('shows supported variants with sizes before download, resolved variant after', async () => {
  // render the translation card for hy-mt2-7b with listVariants mocked to
  // { variants: [{computeType:'fp8',sizeBytes:8e9,supported:true,...},
  //              {computeType:'bfloat16',sizeBytes:15e9,supported:false,...}], recommended:'fp8' }
  // and status 'absent'
  // → expect a row labelled FP8 with ~8.0 GB and a "recommended" marker;
  //   bf16 row not offered as a download target (unsupported).
  // Then with status 'ready' for the fp8 variant repo →
  //   expect only "FP8 · 8.0 GB" shown, no variant chooser.
});
```

(Fill the render/mocks following the existing Settings card test patterns; assert the visible variant label + size string via `formatMemMb`/byte formatting already used in the section.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections`
Expected: FAIL — the card has no variant chooser.

- [ ] **Step 3: Implement**

In the translation `ModelCard`, when not yet downloaded, fetch `listVariants(spec.selectId, settings.asrModel, settings.ttsModel)` (memoized on those inputs), render the **supported** variants as rows — each `"<COMPUTE_TYPE> · <size>"`, the `recommended` one marked, click pins it — and download the chosen variant's repo. When downloaded (status ready), render only the resolved variant + its size (the cached variant's repo). Reuse the existing byte→GB formatter in the section. Add minimal SCSS for the variant rows (a `--recommended` accent reusing the existing `model-ok` color token).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/ModelManagementSection.scss src/components/Settings/sections/NativeModelManagementSection.test.tsx
git commit -m "feat(native): model card shows per-variant sizes + chosen variant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Real-GPU Validation (controller, after all tasks)

Requires **freeing disk space** first (the dev disk is full). Then:

```bash
cd sidecar
# install the new dep into the existing venv
.venv/bin/pip install compressed-tensors
# download the FP8 variant + load it on the Ada GPU (sm_89)
SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_translate_backends.py -k fp8 -v
```

Expected: the FP8 variant loads on CUDA and translates a sample. Confirm `_h_list_variants` recommends `fp8` on the 12 GB box with a small ASR reserve, and bf16 when reserves are tiny / VRAM large.

## Full Suite Check

After Task 9:

```bash
cd sidecar && .venv/bin/python -m pytest -q
npx vitest run src/lib/local-inference/native src/components/Settings/sections
```
Expected: all green (gated GPU tests SKIPPED without `SOKUJI_RUN_GPU`).
