# Qwen3-ASR-1.7B Phase 1 (self-gated plumbing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sidecar plumbing for native-transformers Qwen3-ASR-1.7B — backend, availability gate, catalog row, download mapping — all testable now on transformers 5.12.1 with mocks, and **self-gated off** so it stays invisible/unusable until the runtime has `transformers.models.qwen3_asr`.

**Architecture:** A new `Qwen3AsrBackend` (native `Qwen3ASRForConditionalGeneration` + `AutoProcessor`, the Granite `TransformersBackend` pattern + 3 validated quirks), made GPU-only and gated by adding `qwen3asr → transformers.models.qwen3_asr` to `accel._installed()` (so `d.backend in machine.installed` is False until transformers 5.13.x). Pure-data catalog + download rows. No renderer row this phase.

**Tech Stack:** Python sidecar (`sokuji_sidecar`, pytest), transformers (native qwen3_asr in Phase 2), bf16/CUDA.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-23-native-asr-qwen3-design.md`.
- **GPU-only**: `Qwen3AsrBackend.load(..., device="cpu", ...)` raises `BackendLoadError`.
- **Self-gated**: `qwen3asr` is "installed" only when `transformers.models.qwen3_asr` exists → on transformers 5.12.1 the model has no usable deployment (resolver refuses it; models_catalog reports it unavailable). The backend must `BackendLoadError` (not crash) if ever loaded without the module.
- **`recommended=False`** this phase (flips to `True` in Phase 2 when it actually runs).
- Backend `NAME = "qwen3asr"`; catalog/download id = `qwen3-asr-1.7b`; artifact/repo = `bezzam/Qwen3-ASR-1.7B`; 16-language tuple `("zh","en","ja","ko","yue","ar","de","es","fr","it","pt","ru","th","vi","hi","id")`.
- pytest is the gate (not tsc). English-only comments. Conventional Commits. **No push/PR without consent.**
- **NOT in this plan (Phase 2):** the renderer `nativeCatalog.ts` row + visibility, the transformers upgrade to 5.13.x, re-validating Granite on 5.13.x, the real GPU smoke, and `recommended=True`. (Renderer row deferred because greying a no-tier model as "Requires GPU" is misleading on a GPU box; visibility lands with the upgrade that makes it work.)

---

## Task 1: `_strip_qwen_prefix` + `Qwen3AsrBackend`

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py` (append after `TransformersBackend`)
- Test: `sidecar/tests/test_backends.py`

**Interfaces:**
- Consumes: `AsrResult`, `BackendLoadError`, `register_backend`, `make_backend`, `TARGET_RATE`.
- Produces: `_strip_qwen_prefix(text) -> str`; class `Qwen3AsrBackend` (`NAME="qwen3asr"`) with `load/transcribe/unload/is_loaded`. `transcribe(samples, language)` casts `input_features` to the model dtype, generates, decodes, strips the prefix.

- [ ] **Step 1: Write the failing tests** (append to `test_backends.py`; `sys`, `types`, `contextlib`, `numpy as np`, `pytest`, `backends` already imported)

```python
def test_strip_qwen_prefix():
    assert backends._strip_qwen_prefix("language Chinese<asr_text>foo bar") == "foo bar"
    assert backends._strip_qwen_prefix("  plain text  ") == "plain text"


def test_qwen3asr_is_gpu_only():
    b = backends.make_backend("qwen3asr")
    with pytest.raises(backends.BackendLoadError):
        b.load("bezzam/Qwen3-ASR-1.7B", "cpu", "bfloat16")


def _install_fake_qwen3(monkeypatch, *, decoded="language Chinese<asr_text>hello world"):
    cap = {}

    class FakeFeat:
        def to(self, dtype):
            cap["feat_dtype"] = dtype
            return self

    class FakeIds:
        shape = (1, 4)

    class FakeBatch(dict):
        def to(self, device):
            cap["inp_device"] = device
            return self

    class FakeProc:
        def apply_chat_template(self, conv, tokenize=False, add_generation_prompt=False):
            cap["conv"] = conv
            return "PROMPT"
        def __call__(self, text, audio, sampling_rate, return_tensors):
            cap["sr"] = sampling_rate
            b = FakeBatch(); b["input_features"] = FakeFeat(); b["input_ids"] = FakeIds()
            return b
        def batch_decode(self, seq, skip_special_tokens):
            cap["decoded_slice"] = seq
            return [decoded]

    class FakeGen:
        def __getitem__(self, idx):
            cap["slice"] = idx
            return "NEW"

    class FakeModel:
        def eval(self):
            return self
        def generate(self, **kw):
            cap["gen_kw"] = kw
            return FakeGen()

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo):
            cap["proc_repo"] = repo
            return FakeProc()

    class FakeQwen3:
        @staticmethod
        def from_pretrained(repo, dtype, device_map):
            cap["repo"] = repo; cap["dtype"] = dtype; cap["device_map"] = device_map
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.Qwen3ASRForConditionalGeneration = FakeQwen3
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"; torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_qwen3asr_load_and_transcribe(monkeypatch):
    cap = _install_fake_qwen3(monkeypatch)
    b = backends.make_backend("qwen3asr")
    b.load("bezzam/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert b.is_loaded
    assert cap["repo"] == "bezzam/Qwen3-ASR-1.7B"
    assert cap["dtype"] == "BF16" and cap["device_map"] == "cuda"
    r = b.transcribe(np.zeros(16000, np.float32), "en")
    assert r.text == "hello world"                 # prefix stripped
    assert cap["feat_dtype"] == "BF16"             # input_features cast to model dtype
    assert cap["sr"] == 16000                       # TARGET_RATE
    assert cap["slice"] == (slice(None), slice(4, None))   # decode only new tokens after the 4-token prompt
    assert cap["gen_kw"]["do_sample"] is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k qwen -v`
Expected: FAIL — `_strip_qwen_prefix`/`qwen3asr` don't exist.

- [ ] **Step 3: Implement** (append to `backends.py`)

```python
_QWEN_PROMPT = "Transcribe the audio."


def _strip_qwen_prefix(text):
    """Qwen3-ASR emits a structured prefix like 'language Chinese<asr_text>...'."""
    return text.split("<asr_text>", 1)[1].strip() if "<asr_text>" in text else text.strip()


@register_backend
class Qwen3AsrBackend:
    """Qwen3-ASR speech-LLM via native transformers (Qwen3ASRForConditionalGeneration).
    model_ref is the HF repo; GPU-tier (bf16). Requires transformers with the qwen3_asr
    model (5.13.x+); on older transformers load() fails and the resolver excludes it."""
    NAME = "qwen3asr"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"
        self._dtype = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        if device == "cpu":
            raise BackendLoadError("qwen3asr is GPU-only")
        try:
            import torch
            from transformers import Qwen3ASRForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref)
            self._model = Qwen3ASRForConditionalGeneration.from_pretrained(
                model_ref, dtype=self._dtype, device_map=device).eval()
            self._device = device
        except Exception as e:  # missing qwen3_asr model, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        conv = [{"role": "user", "content": [{"type": "audio"}, {"type": "text", "text": _QWEN_PROMPT}]}]
        text = self._proc.apply_chat_template(conv, tokenize=False, add_generation_prompt=True)
        inp = self._proc(text=text, audio=samples, sampling_rate=TARGET_RATE, return_tensors="pt").to(self._device)
        if "input_features" in inp:  # quirk: features are float32, model is bf16
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        decoded = self._proc.batch_decode(out[:, inp["input_ids"].shape[-1]:], skip_special_tokens=True)[0]
        return AsrResult(_strip_qwen_prefix(decoded), language)

    def unload(self) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -v`
Expected: PASS (new qwen tests + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): Qwen3AsrBackend (native transformers, GPU-only) + prefix strip"
```

---

## Task 2: Availability gate in `_installed()`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: `accel._installed()` includes `"qwen3asr"` iff `transformers.models.qwen3_asr` is importable.

- [ ] **Step 1: Write the failing test** (append to `test_accel.py`)

```python
def test_qwen3asr_gated_on_qwen3_asr_module(monkeypatch):
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def fake_find_spec(name, *a, **k):
        if name == "transformers.models.qwen3_asr":
            return None
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", fake_find_spec)
    assert "qwen3asr" not in accel._installed()

    def present(name, *a, **k):
        if name == "transformers.models.qwen3_asr":
            return object()
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", present)
    assert "qwen3asr" in accel._installed()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py::test_qwen3asr_gated_on_qwen3_asr_module -v`
Expected: FAIL — `qwen3asr` not in the `_installed` map.

- [ ] **Step 3: Add the gated entry** (`accel.py`, in `_installed`'s `mods` dict)

```python
def _installed() -> frozenset:
    mods = {"ctranslate2": "faster_whisper", "sherpa": "sherpa_onnx",
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm",
            "transformers": "transformers",
            # qwen3asr needs the native qwen3_asr model (transformers 5.13.x+); until
            # then it is "not installed" so resolve()/models_catalog exclude it.
            "qwen3asr": "transformers.models.qwen3_asr"}
    return frozenset(b for b, mod in mods.items() if importlib.util.find_spec(mod) is not None)
```

- [ ] **Step 4: Run to verify pass + no accel regression**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -v`
Expected: PASS (on this box `transformers.models.qwen3_asr` is absent → `qwen3asr` excluded → `_installed()` unchanged for the other backends, no regression).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): gate qwen3asr backend on the transformers qwen3_asr model"
```

---

## Task 3: Catalog row + self-gate integration test

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (append to `ASR_MODELS`)
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `Deployment`, `AsrModel`, `ASR_MODELS`, `asr_model()`; `accel.resolve`, `accel.probe`, `accel.Machine`.
- Produces: an `AsrModel("qwen3-asr-1.7b", ...)` row, single `Deployment("qwen3asr","gpu-cuda","bfloat16","bezzam/Qwen3-ASR-1.7B",1.0)`, `recommended=False`, `sort_order=7`.

- [ ] **Step 1: Write the failing tests**

In `test_catalog.py`, extend the allowed-backend set in `test_models_have_deployments_and_languages`:

```python
            assert d.backend in {"ctranslate2", "sherpa", "transformers", "qwen3asr"}
```

Append the row + frozen-language fixtures:

```python
def test_qwen3_asr_row():
    m = catalog.asr_model("qwen3-asr-1.7b")
    assert m is not None
    assert m.languages == ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
                           "fr", "it", "pt", "ru", "th", "vi", "hi", "id")
    assert m.recommended is False        # Phase 1: not selectable/recommended yet
    assert m.sort_order == 7
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B")
```

In `test_accel.py`, a self-gate integration test (a GPU machine WITHOUT qwen3asr installed → the model has no usable plan):

```python
def test_qwen3asr_model_unavailable_without_runtime(monkeypatch):
    from sokuji_sidecar import accel, catalog
    # a GPU machine, but qwen3asr backend not installed (transformers lacks qwen3_asr)
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(name="x", memory_mb=12000),) if hasattr(accel, "Gpu") else ("x",),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"ctranslate2", "sherpa", "transformers"}),
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("qwen3-asr-1.7b"), m)
    assert plans == []     # gated off: no usable deployment
```

(If `accel.Machine`/`accel.Gpu` construction differs, read `accel.py`'s `Machine`/`Gpu` dataclasses and build a minimal instance with `installed` lacking `"qwen3asr"`; the assertion is that `resolve_deployments` returns `[]`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py::test_qwen3asr_model_unavailable_without_runtime -v`
Expected: FAIL — `asr_model("qwen3-asr-1.7b")` is `None`.

- [ ] **Step 3: Add the catalog row** (`catalog.py`, append to `ASR_MODELS` after the granite rows)

```python
    AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
             ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
              "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
             (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B", 1.0),),
             recommended=False, sort_order=7),
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -v`
Expected: PASS (incl. `test_system_has_a_cpu_floor` — Whisper/sense-voice still provide it).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): catalog row for qwen3-asr-1.7b (gated, recommended=False)"
```

---

## Task 4: `download_specs` mapping

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`download_specs`)
- Test: `sidecar/tests/test_native_models.py` (`test_download_specs_mapping`)

**Interfaces:**
- Produces: `download_specs("qwen3-asr-1.7b") == {"repos": ["bezzam/Qwen3-ASR-1.7B"], "urls": []}`.

- [ ] **Step 1: Write the failing assertion** (add to `test_download_specs_mapping`)

```python
    assert nm.download_specs('qwen3-asr-1.7b')['repos'] == ['bezzam/Qwen3-ASR-1.7B']
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py::test_download_specs_mapping -v`
Expected: FAIL — bare-id fallthrough returns `['qwen3-asr-1.7b']`.

- [ ] **Step 3: Add the explicit branch** (`download_specs`, before the final `return {"repos": [model_id], "urls": []}`)

```python
    if model_id == "qwen3-asr-1.7b":
        return {"repos": ["bezzam/Qwen3-ASR-1.7B"], "urls": []}
```

- [ ] **Step 4: Run to verify pass + the whole sidecar suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass (the new qwen tests + no regression; the env-gated GPU tests skip).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): download_specs branch for qwen3-asr-1.7b"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- `Qwen3AsrBackend` + `_strip_qwen_prefix` + the 3 quirks → Task 1.
- Self-gate (`_installed` qwen3asr → qwen3_asr) → Task 2; integration (model unavailable) → Task 3.
- Catalog row (gated, recommended=False) → Task 3.
- `download_specs` branch → Task 4.
- Deferred to Phase 2 (correctly absent): renderer row + visibility, transformers upgrade, Granite re-validation on 5.13.x, real GPU smoke, `recommended=True`.

**Placeholder scan:** none — complete code throughout. The one read-and-adapt note (Task 3 `accel.Machine`/`Gpu` construction) is bounded: the assertion is fixed (`resolve_deployments(...) == []`); only the Machine literal may need field-name tweaks the implementer reads from `accel.py`.

**Type/name consistency:** `qwen3asr` (backend NAME + catalog `Deployment.backend` + the `_installed` key + the `test_catalog` allowed set), `qwen3-asr-1.7b` (catalog/download id), `bezzam/Qwen3-ASR-1.7B` (artifact + download repo), the 16-language tuple (catalog + its test), `_strip_qwen_prefix`/`_QWEN_PROMPT` (Task 1 impl + test). `transcribe(samples, language)` matches the backend contract; `samples` float32 pass-through (asr_engine convention).

## Notes

- The whole increment is invisible + unusable on transformers 5.12.1 (no renderer row + the self-gate). Phase 2 (separate plan, when PR #43838 ships in transformers ~5.13.x) adds the renderer row, upgrades transformers, re-validates Granite + the suite, un-skips a real GPU smoke, and flips `recommended=True`.
- `accel.importlib.util.find_spec` is monkeypatched in Task 2's test — `accel.py` already does `import importlib.util` (line 5), so `accel.importlib.util.find_spec` is the patch target.
