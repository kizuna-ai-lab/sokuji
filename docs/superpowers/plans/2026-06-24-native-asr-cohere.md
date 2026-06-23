# Cohere Transcribe Native (GPU Sidecar) ASR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cohere Transcribe (`CohereLabs/cohere-transcribe-03-2026`) as a GPU-native ASR in the Python sidecar — the full-precision bf16/CUDA twin of the existing LOCAL_INFERENCE WebGPU model — so existing Cohere users get the same model, faster and at higher quality.

**Architecture:** A new `CohereAsrBackend` that mirrors the shipped `Qwen3AsrBackend` (transformers speech model, GPU bf16, `.to(device)` with no `accelerate`, `local_files_only=True`). It is wired through the same four seams as Granite/Qwen3: the `accel` resolver self-gate, the sidecar `catalog`, `native_models.download_specs`, and the renderer `nativeCatalog`. Cohere is `recommended` and sorted **first**.

**Tech Stack:** Python sidecar (`sokuji_sidecar`, pytest), transformers 5.13.0.dev0 + torch 2.11.0+cu128, React/TypeScript renderer (vitest).

## Global Constraints

- **Checkpoint:** `CohereLabs/cohere-transcribe-03-2026` (safetensors, bf16, ~4.13 GB). Apache 2.0.
- **Runtime class:** `from transformers import CohereAsrForConditionalGeneration, AutoProcessor` — mainline (`transformers.models.cohere_asr`), already present in our venv (5.13.0.dev0). No `trust_remote_code`, no `accelerate`, no new pip deps.
- **Backend NAME:** `cohereasr`. **GPU-only:** raise `BackendLoadError("cohereasr is GPU-only")` when `device == "cpu"`. Load with `.to(device).eval()` (never `device_map`). Pass `local_files_only=True` to **both** `from_pretrained` calls.
- **Conformer, not a speech-LLM:** the source language is passed via `processor(..., language=lang)` — NO chat template, NO input-prompt slicing on the generated tokens.
- **Languages (14, verbatim):** `en, de, fr, it, es, pt, el, nl, pl, ar, vi, zh, ja, ko`.
- **Positioning:** `recommended=True` and sorted **first** — `sort_order`/`sortOrder = 0`; the existing ASR rows shift +1 in **both** catalogs, relative order preserved. (`sort_order` is advisory and not sent over the wire; the two catalogs' integers stay independent — only "Cohere first" must hold in both.)
- **Explicit language:** Cohere has no auto-detect. The renderer already hides the `auto` source option for `LOCAL_NATIVE` (`LanguageSection.tsx:522`), so the requirement is met at the UI; the backend additionally defaults a missing/`"auto"` language to `"en"`.
- **Comments:** English only. **Commits:** Conventional Commits. **Gates:** `pytest` (sidecar) + `vitest` (renderer), NOT `tsc`; `npm run build` for renderer wiring.

## Deviation from the spec (resolved during planning)

Spec §5.3 proposed a `requiresExplicitLanguage` flag on the native catalog plus a `LanguageSection` guard. **This is already done in existing code** — `LanguageSection.tsx:522` renders the `auto` source option only when the provider is neither `LOCAL_INFERENCE` nor `LOCAL_NATIVE`, so native never offers `auto`. Adding the flag would be unused. This plan therefore **omits** the flag and the `LanguageSection` change, and instead defends the backend against a stale `auto`/empty language value (Task 1). No renderer-logic change is needed beyond the catalog row (Task 4).

---

## Task 1: `CohereAsrBackend` + tests + GPU smoke

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py` (append a new backend class after `Qwen3AsrBackend`, which ends at line ~223)
- Test: `sidecar/tests/test_backends.py` (append fakes + tests)

**Interfaces:**
- Consumes: `register_backend`, `BackendLoadError`, `AsrResult`, `TARGET_RATE` (all defined at the top of `backends.py`); `make_backend(name)`.
- Produces: a backend registered under `NAME = "cohereasr"` with `load(model_ref, device, compute_type)`, `transcribe(samples, language) -> AsrResult`, `unload()`, `is_loaded` — the same contract Granite/Qwen3 expose.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_backends.py`:

```python
def test_cohereasr_is_gpu_only():
    b = backends.make_backend("cohereasr")
    with pytest.raises(backends.BackendLoadError):
        b.load("CohereLabs/cohere-transcribe-03-2026", "cpu", "bfloat16")


def _install_fake_cohere(monkeypatch, *, decoded="hello world"):
    cap = {}

    class FakeFeat:
        def to(self, dtype):
            cap["feat_dtype"] = dtype
            return self

    class FakeBatch(dict):
        def to(self, device):
            cap["inp_device"] = device
            return self

    class FakeProc:
        # Cohere processor: positional audio + sampling_rate + language (no chat template)
        def __call__(self, samples, sampling_rate, return_tensors, language):
            cap["sr"] = sampling_rate
            cap["language"] = language
            b = FakeBatch()
            b["input_features"] = FakeFeat()
            return b
        def batch_decode(self, seq, skip_special_tokens):
            cap["decoded_seq"] = seq
            return [decoded]

    class FakeModel:
        def to(self, device):
            cap["model_device"] = device
            return self
        def eval(self):
            return self
        def generate(self, **kw):
            cap["gen_kw"] = kw
            return "OUT"

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo, local_files_only=False):
            cap["proc_repo"] = repo
            cap["proc_local_files_only"] = local_files_only
            return FakeProc()

    class FakeCohere:
        @staticmethod
        def from_pretrained(repo, dtype, local_files_only=False):
            cap["repo"] = repo
            cap["dtype"] = dtype
            cap["model_local_files_only"] = local_files_only
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.CohereAsrForConditionalGeneration = FakeCohere
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"
    torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_cohereasr_load_and_transcribe(monkeypatch):
    cap = _install_fake_cohere(monkeypatch)
    b = backends.make_backend("cohereasr")
    b.load("CohereLabs/cohere-transcribe-03-2026", "cuda", "bfloat16")
    assert b.is_loaded
    assert cap["repo"] == "CohereLabs/cohere-transcribe-03-2026"
    assert cap["dtype"] == "BF16" and cap["model_device"] == "cuda"
    assert cap["proc_local_files_only"] is True
    assert cap["model_local_files_only"] is True
    r = b.transcribe(np.zeros(16000, np.float32), "ja")
    assert r.text == "hello world"            # decoded + stripped, no prefix logic
    assert cap["feat_dtype"] == "BF16"          # input_features cast to model dtype
    assert cap["sr"] == 16000                   # TARGET_RATE
    assert cap["language"] == "ja"              # explicit language passed through
    assert cap["gen_kw"]["do_sample"] is False
    b.unload()
    assert not b.is_loaded


def test_cohereasr_defaults_missing_language_to_english(monkeypatch):
    cap = _install_fake_cohere(monkeypatch)
    b = backends.make_backend("cohereasr")
    b.load("CohereLabs/cohere-transcribe-03-2026", "cuda", "bfloat16")
    b.transcribe(np.zeros(16000, np.float32), "")        # empty → en
    assert cap["language"] == "en"
    b.transcribe(np.zeros(16000, np.float32), "auto")    # stale 'auto' value → en
    assert cap["language"] == "en"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k cohere -v`
Expected: FAIL — `make_backend("cohereasr")` raises `BackendLoadError("unknown backend: cohereasr")` (not yet registered).

- [ ] **Step 3: Implement the backend**

Append to `sidecar/sokuji_sidecar/backends.py` (after `Qwen3AsrBackend`):

```python
@register_backend
class CohereAsrBackend:
    """Cohere Transcribe (Fast-Conformer ASR) via native transformers
    (CohereAsrForConditionalGeneration). model_ref is the HF repo; GPU-tier (bf16),
    loaded with .to(device) (no accelerate). A Conformer encoder-decoder, NOT a
    chat-template speech-LLM: the source language is passed through the processor and
    generate() returns only the transcription (no input-prompt slicing). Cohere has no
    auto-detect, so a missing/'auto' language defaults to English."""
    NAME = "cohereasr"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"
        self._dtype = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
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
        except Exception as e:  # missing cohere_asr module, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        lang = language if language and language != "auto" else "en"  # no auto-detect
        inp = self._proc(samples, sampling_rate=TARGET_RATE, return_tensors="pt",
                         language=lang).to(self._device)
        if "input_features" in inp:  # features are float32, model is bf16
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        text = self._proc.batch_decode(out, skip_special_tokens=True)[0]
        return AsrResult(text.strip(), language)

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k cohere -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the GPU validation smoke (the de-risker)**

Append to `sidecar/tests/test_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads CohereLabs/cohere-transcribe-03-2026 ~4GB; needs CUDA)")
def test_cohereasr_real_gpu_smoke():
    # Real flow: manager downloads first, backend loads from cache.
    from huggingface_hub import snapshot_download
    snapshot_download("CohereLabs/cohere-transcribe-03-2026")
    b = backends.make_backend("cohereasr")
    b.load("CohereLabs/cohere-transcribe-03-2026", "cuda", "bfloat16")
    assert b.is_loaded
    clip = np.zeros(16000 * 3, np.float32)   # 3 s silence — exercises the full path
    t0 = time.perf_counter()
    r = b.transcribe(clip, "en")
    rtf = (time.perf_counter() - t0) / 3.0
    assert isinstance(r.text, str)           # may be empty for silence; must not raise
    print(f"cohere-transcribe-03-2026 RTF={rtf:.4f}")
    b.unload()
    # coexistence regression: Granite + Qwen3 still load after Cohere unload + empty_cache
    import torch
    torch.cuda.empty_cache()
    g = backends.make_backend("transformers")
    g.load("ibm-granite/granite-speech-4.1-2b", "cuda", "bfloat16")
    assert g.is_loaded
    g.unload()
    q = backends.make_backend("qwen3asr")
    q.load("bezzam/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert q.is_loaded
    q.unload()
```

Run (skips without the env var): `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k cohere -v`
Expected: the 3 unit tests PASS, `test_cohereasr_real_gpu_smoke` SKIPPED.

> **Controller note (run the smoke to validate reality):** before approving this task, run
> `cd sidecar && SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_backends.py::test_cohereasr_real_gpu_smoke -v -s`.
> Confirm: a non-raising transcribe, a sane RTF print, and Granite + Qwen3 still load after.
> **If the real processor differs from the Qwen3-mirror assumption** — e.g. it needs `CohereAsrProcessor`
> instead of `AutoProcessor`, a different call signature, slicing of the generated tokens, or a decoded
> prefix to strip — fix `transcribe()`/`load()` and the matching fake in Step 1, then re-run.

- [ ] **Step 6: Run the whole sidecar suite + commit**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass, GPU smoke skipped.

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): CohereAsrBackend (Cohere Transcribe, GPU bf16)"
```

---

## Task 2: Resolver self-gate (`accel._installed`)

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:60-67` (the `_installed()` `mods` dict)
- Test: `sidecar/tests/test_accel.py` (append)

**Interfaces:**
- Consumes: `accel._installed()`, `accel._has_mod`, `accel.resolve_deployments(model, machine)`, `accel.Machine`, `accel.Gpu`, `catalog.asr_model(id)`.
- Produces: `"cohereasr"` present in `_installed()` iff `transformers.models.cohere_asr` is importable; a Cohere catalog row resolves a `cuda` plan on an NVIDIA machine that has the runtime, and `[]` without it.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_accel.py`:

```python
def test_cohereasr_resolves_gpu_on_nvidia_with_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"cohereasr", "transformers"}),
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("cohere-transcribe-03-2026"), m)
    assert [p.device for p in plans] == ["cuda"]
    assert plans[0].backend == "cohereasr" and plans[0].compute_type == "bfloat16"


def test_cohereasr_model_unavailable_without_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"ctranslate2", "sherpa", "transformers"}),  # no cohereasr
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("cohere-transcribe-03-2026"), m)
    assert plans == []     # gated off: no usable deployment


def test_cohereasr_gated_on_cohere_asr_module(monkeypatch):
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def fake_find_spec(name, *a, **k):
        if name == "transformers.models.cohere_asr":
            return None
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", fake_find_spec)
    assert "cohereasr" not in accel._installed()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k cohere -v`
Expected: `test_cohereasr_resolves_gpu_on_nvidia_with_runtime` FAILS (the catalog row does not exist yet → `asr_model(...)` returns `None` → `resolve_deployments(None, m)` raises) and `test_cohereasr_gated_on_cohere_asr_module` FAILS (`cohereasr` not in `_installed()` because the mods entry is absent).

> Note: the catalog row lands in Task 3. To unblock the two resolver tests here, this task adds **only** the `_installed()` entry; the row-dependent tests (`*_with_runtime`, `*_without_runtime`) will pass once Task 3 adds the row. Run them again at the end of Task 3. Implement Step 3 now; the `gated_on_cohere_asr_module` test passes immediately.

- [ ] **Step 3: Add the gate entry**

In `sidecar/sokuji_sidecar/accel.py`, extend the `mods` dict in `_installed()` (the dict currently ending with the `qwen3asr` entry):

```python
def _installed() -> frozenset:
    mods = {"ctranslate2": "faster_whisper", "sherpa": "sherpa_onnx",
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm",
            "transformers": "transformers",
            # qwen3asr needs the native qwen3_asr model (transformers 5.13.x+); until
            # then it is "not installed" so resolve()/models_catalog exclude it.
            "qwen3asr": "transformers.models.qwen3_asr",
            # cohereasr needs the native cohere_asr model (mainline since transformers
            # 5.4); present in our 5.13 venv. Same self-gate as qwen3asr.
            "cohereasr": "transformers.models.cohere_asr"}
    return frozenset(b for b, mod in mods.items() if _has_mod(mod))
```

- [ ] **Step 4: Run the module-gate test**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py::test_cohereasr_gated_on_cohere_asr_module -v`
Expected: PASS. (The two row-dependent tests still fail until Task 3 — that is expected and resolved there.)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): self-gate cohereasr on transformers.models.cohere_asr"
```

---

## Task 3: Catalog row (first) + download spec

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py:34-62` (insert the Cohere row first; bump every existing `sort_order` +1)
- Modify: `sidecar/sokuji_sidecar/native_models.py:24-43` (add a `download_specs` branch)
- Test: `sidecar/tests/test_catalog.py` (add the row test, extend the allowed-backend set, update the Qwen3 `sort_order` assertion)
- Test: `sidecar/tests/test_native_models.py` (add a `download_specs` assertion — create the file if absent)

**Interfaces:**
- Consumes: `AsrModel`, `Deployment` (`catalog.py`); `catalog.asr_model(id)`; `native_models.download_specs(model_id)`.
- Produces: `catalog.asr_model("cohere-transcribe-03-2026")` with `recommended=True`, `sort_order=0`, the 14 languages, one `cohereasr/gpu-cuda/bfloat16` deployment; `download_specs("cohere-transcribe-03-2026") == {"repos": ["CohereLabs/cohere-transcribe-03-2026"], "urls": []}`. This row makes Task 2's `*_with_runtime` / `*_without_runtime` tests pass.

- [ ] **Step 1: Write the failing tests**

In `sidecar/tests/test_catalog.py`, extend the allowed-backend set in `test_models_have_deployments_and_languages` (currently `{"ctranslate2", "sherpa", "transformers", "qwen3asr"}`) to include `"cohereasr"`, update the Qwen3 row test's `sort_order` from `7` to `8`, and append the Cohere row test:

```python
def test_cohere_asr_row():
    m = catalog.asr_model("cohere-transcribe-03-2026")
    assert m is not None
    assert m.languages == ("en", "de", "fr", "it", "es", "pt", "el",
                           "nl", "pl", "ar", "vi", "zh", "ja", "ko")
    assert m.recommended is True
    assert m.sort_order == 0          # sorted first
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("cohereasr", "gpu-cuda", "bfloat16", "CohereLabs/cohere-transcribe-03-2026")


def test_cohere_is_first_qwen3_shifted():
    ids = [m.id for m in catalog.asr_models()]
    assert ids[0] == "cohere-transcribe-03-2026"           # inserted first in the list
    assert catalog.asr_model("qwen3-asr-1.7b").sort_order == 8   # shifted +1 from 7
    assert catalog.asr_model("sense-voice").sort_order == 1      # shifted +1 from 0
```

In `sidecar/tests/test_native_models.py` (create it if it does not exist, with `from sokuji_sidecar import native_models` at the top), append:

```python
def test_download_specs_cohere():
    assert native_models.download_specs("cohere-transcribe-03-2026") == \
        {"repos": ["CohereLabs/cohere-transcribe-03-2026"], "urls": []}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_native_models.py -v`
Expected: FAIL — `asr_model("cohere-transcribe-03-2026")` is `None`; `download_specs` returns the fallthrough `{"repos": ["cohere-transcribe-03-2026"], "urls": []}`; the Qwen3 `sort_order` is still 7.

- [ ] **Step 3: Insert the catalog row first and shift the rest +1**

In `sidecar/sokuji_sidecar/catalog.py`, make the Cohere row the **first** entry of `ASR_MODELS` and add +1 to every existing `sort_order` (0→1, 1→2, …, 7→8):

```python
ASR_MODELS: list[AsrModel] = [
    AsrModel("cohere-transcribe-03-2026", "Cohere Transcribe",
             ("en", "de", "fr", "it", "es", "pt", "el",
              "nl", "pl", "ar", "vi", "zh", "ja", "ko"),
             (Deployment("cohereasr", "gpu-cuda", "bfloat16",
                         "CohereLabs/cohere-transcribe-03-2026", 1.0),),
             recommended=True, sort_order=0),
    AsrModel("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
             (Deployment("sherpa", "cpu", "int8", SENSE_VOICE_REPO, 1.0),),
             recommended=True, sort_order=1),
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "large-v3", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0)), sort_order=2),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "base", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "base", 1.0)),
             recommended=True, sort_order=3),
    AsrModel("whisper-small", "Whisper small", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "small", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "small", 1.0)), sort_order=4),
    AsrModel("whisper-tiny", "Whisper tiny", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "tiny", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "tiny", 1.0)), sort_order=5),
    AsrModel("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)", ("en", "fr", "de", "es", "pt", "ja"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b", 1.0),),
             sort_order=6),
    AsrModel("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)", ("en", "fr", "de", "es", "pt"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b-plus", 1.0),),
             sort_order=7),
    AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
             ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
              "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
             (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B", 1.0),),
             recommended=True, sort_order=8),
]
```

- [ ] **Step 4: Add the download spec**

In `sidecar/sokuji_sidecar/native_models.py`, add a branch in `download_specs` **before** the final `return {"repos": [model_id], "urls": []}` fallthrough (right after the `qwen3-asr-1.7b` branch at line ~42):

```python
    if model_id == "cohere-transcribe-03-2026":
        return {"repos": ["CohereLabs/cohere-transcribe-03-2026"], "urls": []}
```

- [ ] **Step 5: Run the catalog/download tests + the Task-2 resolver tests**

Run:
```bash
cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_native_models.py \
  tests/test_accel.py -k "cohere or row or catalog or download or qwen3" -v
```
Expected: PASS — including Task 2's `test_cohereasr_resolves_gpu_on_nvidia_with_runtime` and `test_cohereasr_model_unavailable_without_runtime` (now that the row exists), and the updated `test_qwen3_asr_row` (sort_order 8).

- [ ] **Step 6: Run the whole sidecar suite + commit**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass, GPU smoke skipped.

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/native_models.py \
        sidecar/tests/test_catalog.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): cohere-transcribe-03-2026 catalog row (recommended, first) + download spec"
```

---

## Task 4: Renderer catalog row (first)

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts:22-31` (insert the Cohere row first in `NATIVE_ASR`; bump every existing `sortOrder` +1)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts` (add the Cohere row test; update the assertions that assumed sense-voice / whisper-base lead)

**Interfaces:**
- Consumes: `NATIVE_ASR`, `compatibleNativeAsr(src)`, `nativeAsrCards(src)`, `nativeAsrForLanguage(src, cur)`, `byRecommendedThenOrder` (all in `nativeCatalog.ts`).
- Produces: a Cohere `NativeModelOption` (`recommended: true`, `sortOrder: 0`, 14 languages) that leads `compatibleNativeAsr` / `nativeAsrCards` for every language it supports (en/de/fr/it/es/pt/el/nl/pl/ar/vi/zh/ja/ko).

- [ ] **Step 1: Update + add the failing tests**

In `src/lib/local-inference/native/nativeCatalog.test.ts`, make these edits (Cohere now leads for languages it supports — `zh`, `de`, `ja`, etc. — while `yue`, which Cohere does not support, still leads with sense-voice):

1. In the `'language compatibility + ASR auto-select'` test, change:
   - `expect(compatibleNativeAsr('zh').map((m) => m.id)[0]).toBe('sense-voice');` → `.toBe('cohere-transcribe-03-2026');`
   - `expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');` → `.toBe('cohere-transcribe-03-2026');`
   - `expect(nativeAsrForLanguage('de', 'sense-voice')).toBe('whisper-base');` → `.toBe('cohere-transcribe-03-2026');`
   - Leave `nativeAsrForLanguage('zh', 'sense-voice')` as `'sense-voice'` (sense-voice still supports zh, so a still-compatible current choice is kept).

2. In `'includes whisper-large-v3 as an available, non-recommended ASR option'`, change:
   - `expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');` → `.toBe('cohere-transcribe-03-2026');`

3. In `'exposes Granite speech-LLM ASR options with language-specific gating'`, change:
   - `expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');` → `.toBe('cohere-transcribe-03-2026');`

4. Replace the body of `'includes Qwen3-ASR 1.7B as a recommended GPU option with verbatim sidecar languages'`'s last two assertions:
   - `expect(q!.sortOrder).toBe(7);` → `expect(q!.sortOrder).toBe(8);`
   - `expect(nativeAsrCards('zh')[0].selectId).toBe('sense-voice');` → `.toBe('cohere-transcribe-03-2026');`
   - `expect(nativeAsrCards('de')[0].selectId).toBe('whisper-base');` → `.toBe('cohere-transcribe-03-2026');`

5. Add a new test:

```javascript
  it('includes Cohere Transcribe as the first (recommended) ASR with its 14 languages', () => {
    const c = NATIVE_ASR.find((m) => m.id === 'cohere-transcribe-03-2026');
    expect(c).toBeTruthy();
    expect(c!.languages).toEqual(['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko']);
    expect(c!.recommended).toBe(true);
    expect(c!.sortOrder).toBe(0);
    // Cohere leads for every language it supports...
    expect(nativeAsrCards('zh')[0].selectId).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrCards('ja')[0].selectId).toBe('cohere-transcribe-03-2026');
    expect(nativeAsrCards('de')[0].selectId).toBe('cohere-transcribe-03-2026');
    // ...but not for Cantonese (yue), which Cohere does not support → sense-voice still leads
    expect(nativeAsrCards('yue')[0].selectId).toBe('sense-voice');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — the new test and the edited assertions reference `cohere-transcribe-03-2026`, which is not in `NATIVE_ASR` yet (Cohere absent → sense-voice/whisper-base still lead).

- [ ] **Step 3: Insert the renderer row first and shift the rest +1**

In `src/lib/local-inference/native/nativeCatalog.ts`, make Cohere the first `NATIVE_ASR` entry and add +1 to every existing `sortOrder`:

```typescript
export const NATIVE_ASR: NativeModelOption[] = [
  { id: 'cohere-transcribe-03-2026', label: 'Cohere Transcribe', languages: ['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko'], recommended: true, sortOrder: 0 },
  { id: 'sense-voice', label: 'SenseVoice', languages: ['zh', 'en', 'ja', 'ko', 'yue'], recommended: true, sortOrder: 1 },
  { id: 'whisper-base', label: 'Whisper base', languages: ['multi'], recommended: true, sortOrder: 2 },
  { id: 'whisper-small', label: 'Whisper small', languages: ['multi'], sortOrder: 3 },
  { id: 'whisper-tiny', label: 'Whisper tiny', languages: ['multi'], sortOrder: 4 },
  { id: 'whisper-large-v3', label: 'Whisper large-v3', languages: ['multi'], sortOrder: 5 },
  { id: 'granite-speech-4.1-2b', label: 'Granite Speech 4.1 (2B)', languages: ['en', 'fr', 'de', 'es', 'pt', 'ja'], sortOrder: 6 },
  { id: 'granite-speech-4.1-2b-plus', label: 'Granite Speech 4.1 (2B+)', languages: ['en', 'fr', 'de', 'es', 'pt'], sortOrder: 7 },
  { id: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B', languages: ['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id'], recommended: true, sortOrder: 8 },
];
```

- [ ] **Step 4: Run the renderer tests + build**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (the new Cohere test + all updated assertions).

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): Cohere Transcribe renderer catalog row (recommended, first)"
```

---

## Self-Review

**Spec coverage:**
- §5.1 `CohereAsrBackend` → Task 1. §5.2 catalog row → Task 3; `accel` gate → Task 2; `download_specs` → Task 3. §5.3 renderer row → Task 4; the explicit-language gate is satisfied by existing code (see Deviation) and the backend default (Task 1). §6 validation spike → Task 1 Step 5 (GPU smoke + controller note). §7 testing → tasks' mocked unit tests + the catalog/accel/renderer tests. §8 YAGNI (no GGUF/ONNX/CPU, no timestamps) → nothing added. §4 decisions: recommended+first → Tasks 3 & 4; explicit language → Deviation + Task 1.
- **Gap check:** the only spec item not implemented verbatim is §5.3's `requiresExplicitLanguage` flag, deliberately dropped (already-satisfied; see Deviation). No other gaps.

**Placeholder scan:** none — every code step carries complete code and exact commands.

**Type/value consistency:** backend `NAME = "cohereasr"`, checkpoint `CohereLabs/cohere-transcribe-03-2026`, gate module `transformers.models.cohere_asr`, the 14-language tuple/array, `sort_order`/`sortOrder = 0` with existing rows +1, and the Qwen3 `sort_order` 7→8 update are identical across Tasks 1–4 and both catalogs. The Cohere-first ordering is asserted in both `test_catalog.py` (`test_cohere_is_first_qwen3_shifted`) and `nativeCatalog.test.ts`.
