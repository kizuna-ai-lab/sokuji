# Native ASR Hardware Acceleration — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the sidecar's hardcoded ASR builders into the adapter/resolver/catalog architecture (Approach A) and expose the new `hardware_info` / `models_catalog` / extended-`ready` protocol — with **zero change** to how native ASR behaves today.

**Architecture:** `asr_engine.py` stops branching on model id and instead calls `accel.resolve(model) → [Plan]` then `accel.load_with_fallback(plans) → AsrBackend`. Each framework (CTranslate2, sherpa-onnx) is an `AsrBackend` adapter; `accel.py` owns hardware probing + the ordered-Plan decision + the fallback chain; `catalog.py` is pure data declaring per-model deployments. All deployments in Phase 0 are CPU (the floor); GPU tiers arrive in Phase 1.

**Tech Stack:** Python 3.10, asyncio, `faster-whisper` (CTranslate2), `sherpa-onnx`, `numpy`, pytest 9. The sidecar package is `sokuji_sidecar` under `sidecar/`; tests under `sidecar/tests/`.

## Global Constraints

- **No behavior change for ASR.** The existing env-gated real-model tests (`test_real_engine_transcribes_test_wav`, `test_real_faster_whisper_transcribes`) and all pure tests must stay green. Baseline today: `12 passed, 4 skipped`.
- **Lazy heavy imports.** `faster_whisper`, `sherpa_onnx`, `onnxruntime`, `ctranslate2` are imported **inside** functions/`load()`, never at module top — the sidecar must import on a machine missing any of them.
- **CPU floor is unconditional.** Every Phase-0 deployment is `tier="cpu"`. The resolver/probe code is written GPU-aware (so Phase 1 only adds catalog rows), but no GPU artifact ships here.
- **Backend names are fixed strings:** `"ctranslate2"`, `"sherpa"`. Tier strings: `"cpu"`, `"gpu-cuda"`, `"gpu-metal"`, `"gpu-vulkan"`, `"gpu-dml"`. Device strings: `"cpu"`, `"cuda"`, `"metal"`, `"vulkan"`, `"dml"`.
- **Run tests with:** `.venv/bin/python -m pytest <paths> -q` from the `sidecar/` directory.
- **Commit message style:** Conventional Commits. Body trailer is added by the harness — do not hand-write `Co-Authored-By`.
- **Scope:** Python sidecar only. The renderer (protocol TS types, `NativeModelClient` methods, the "CPU" tier badge in `NativeModelManagementSection`) is the immediate **follow-on plan**, not part of Phase 0.

---

## File Structure

**Create:**
- `sidecar/sokuji_sidecar/backends.py` — `AsrResult`, `BackendLoadError`, the `AsrBackend` protocol, `CTranslate2Backend`, `SherpaBackend`, the `register_backend`/`make_backend` registry.
- `sidecar/sokuji_sidecar/catalog.py` — `Deployment`, `AsrModel`, the `ASR_MODELS` rows, `asr_models()`, `asr_model(id)`.
- `sidecar/sokuji_sidecar/accel.py` — `Gpu`, `Machine`, `probe()`, `Plan`, `resolve_deployments()`, `resolve()`, `load_with_fallback()`, the `hardware_info`/`models_catalog` handlers + `register()`.
- `sidecar/tests/test_backends.py`, `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py` — unit tests.

**Modify:**
- `sidecar/sokuji_sidecar/asr_engine.py` — replace `_build_sherpa`/`_build_faster_whisper` selection in `AsrEngine.init` with `accel.resolve` + `accel.load_with_fallback`; add `device` param; extend the `ready` reply.
- `sidecar/sokuji_sidecar/__main__.py` — register the new `accel` handlers.
- `sidecar/tests/test_asr_engine.py` — add coverage for the resolved-plan path and the extended `ready` (existing tests stay untouched and green).

---

## Task 1: Backend adapter contract + registry

**Files:**
- Create: `sidecar/sokuji_sidecar/backends.py`
- Test: `sidecar/tests/test_backends.py`

**Interfaces:**
- Produces: `AsrResult(text: str, language: str|None=None)`; `BackendLoadError(reason: str)` with `.reason`; `register_backend(cls)` decorator (reads `cls.NAME`); `make_backend(name: str) -> AsrBackend` (raises `BackendLoadError` on unknown name). The `AsrBackend` shape is `NAME: str`, `load(model_ref: str, device: str, compute_type: str) -> None`, `transcribe(samples: np.ndarray, language: str|None) -> AsrResult`, `unload() -> None`, `is_loaded: bool`.

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_backends.py
import numpy as np
import pytest
from sokuji_sidecar import backends


def test_make_backend_unknown_raises():
    with pytest.raises(backends.BackendLoadError):
        backends.make_backend("nope")


def test_register_and_make_returns_instance():
    @backends.register_backend
    class _Dummy:
        NAME = "dummy_test"
        def __init__(self): self.loaded = False
        def load(self, model_ref, device, compute_type): self.loaded = True
        def transcribe(self, samples, language): return backends.AsrResult("x")
        def unload(self): self.loaded = False
        @property
        def is_loaded(self): return self.loaded

    b = backends.make_backend("dummy_test")
    assert b.NAME == "dummy_test"
    b.load("m", "cpu", "int8")
    assert b.is_loaded
    assert b.transcribe(np.zeros(4, np.float32), None).text == "x"


def test_asr_result_defaults():
    r = backends.AsrResult("hello")
    assert r.text == "hello" and r.language is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_backends.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'sokuji_sidecar.backends'`

- [ ] **Step 3: Write minimal implementation**

```python
# sidecar/sokuji_sidecar/backends.py
"""ASR backend adapters: one class per inference framework, all sharing the
load()/transcribe()/unload() contract. The only code that touches a framework's
real API. Heavy frameworks are imported lazily inside load()."""
from dataclasses import dataclass


@dataclass
class AsrResult:
    text: str
    language: str | None = None


class BackendLoadError(Exception):
    """A backend could not honor (device, compute_type). Drives the resolver's
    fallback to the next plan."""
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_BACKENDS: dict[str, type] = {}


def register_backend(cls):
    """Class decorator: register a backend under its NAME for make_backend()."""
    _BACKENDS[cls.NAME] = cls
    return cls


def make_backend(name: str):
    """Instantiate the backend registered under `name`."""
    cls = _BACKENDS.get(name)
    if cls is None:
        raise BackendLoadError(f"unknown backend: {name}")
    return cls()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_backends.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): AsrBackend adapter contract + backend registry"
```

---

## Task 2: CTranslate2Backend (Whisper / faster-whisper)

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py`
- Test: `sidecar/tests/test_backends.py`

**Interfaces:**
- Consumes: `register_backend`, `AsrResult`, `BackendLoadError` (Task 1).
- Produces: `CTranslate2Backend` with `NAME = "ctranslate2"`. `load(model_ref, device, compute_type)` constructs `faster_whisper.WhisperModel(model_ref, device=device, compute_type=compute_type)` where `model_ref` is a size string (`"tiny"`, `"large-v3"`). `transcribe(samples, language)` returns the joined segment text. A construction failure raises `BackendLoadError`.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_backends.py
import sys, types


def _install_fake_faster_whisper(monkeypatch, *, fail=False):
    seg = types.SimpleNamespace(text=" hello")
    captured = {}

    class FakeWhisperModel:
        def __init__(self, model_ref, device, compute_type):
            if fail:
                raise RuntimeError("CUDA driver missing")
            captured["args"] = (model_ref, device, compute_type)
        def transcribe(self, samples, language, beam_size, vad_filter):
            captured["transcribe"] = (len(samples), language, beam_size, vad_filter)
            return [seg], types.SimpleNamespace(language="en")

    mod = types.ModuleType("faster_whisper")
    mod.WhisperModel = FakeWhisperModel
    monkeypatch.setitem(sys.modules, "faster_whisper", mod)
    return captured


def test_ctranslate2_load_and_transcribe(monkeypatch):
    cap = _install_fake_faster_whisper(monkeypatch)
    b = backends.make_backend("ctranslate2")
    assert not b.is_loaded
    b.load("large-v3", "cpu", "int8")
    assert b.is_loaded and cap["args"] == ("large-v3", "cpu", "int8")
    out = b.transcribe(np.zeros(160, np.float32), "en")
    assert out.text == "hello"
    assert cap["transcribe"][1] == "en" and cap["transcribe"][3] is False


def test_ctranslate2_load_failure_raises_backendloaderror(monkeypatch):
    _install_fake_faster_whisper(monkeypatch, fail=True)
    b = backends.make_backend("ctranslate2")
    with pytest.raises(backends.BackendLoadError):
        b.load("large-v3", "cuda", "float16")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_backends.py -k ctranslate2 -q`
Expected: FAIL with `BackendLoadError: unknown backend: ctranslate2`

- [ ] **Step 3: Write minimal implementation**

```python
# append to sidecar/sokuji_sidecar/backends.py
TARGET_RATE = 16000


@register_backend
class CTranslate2Backend:
    """faster-whisper (CTranslate2). model_ref is a Whisper size like 'tiny' or
    'large-v3'; faster-whisper resolves it to the matching Systran CT2 repo."""
    NAME = "ctranslate2"

    def __init__(self):
        self._m = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        from faster_whisper import WhisperModel
        try:
            self._m = WhisperModel(model_ref, device=device, compute_type=compute_type)
        except Exception as e:  # bad device/compute → let the resolver fall back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        segments, _info = self._m.transcribe(
            samples, language=language, beam_size=1, vad_filter=False)
        return AsrResult("".join(s.text for s in segments).strip(), language)

    def unload(self) -> None:
        self._m = None

    @property
    def is_loaded(self) -> bool:
        return self._m is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_backends.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): CTranslate2Backend adapter (Whisper/faster-whisper)"
```

---

## Task 3: SherpaBackend (SenseVoice)

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py`
- Test: `sidecar/tests/test_backends.py`

**Interfaces:**
- Consumes: `register_backend`, `AsrResult`, `BackendLoadError`, `TARGET_RATE` (Tasks 1–2).
- Produces: `SherpaBackend` with `NAME = "sherpa"`. `load(model_ref, device, compute_type)` where `model_ref` is the SenseVoice HF repo id; resolves it via `huggingface_hub.snapshot_download` and builds `sherpa_onnx.OfflineRecognizer.from_sense_voice(...)`. `transcribe(samples, language)` runs one stream (language ignored — SenseVoice auto-detects). Construction failure raises `BackendLoadError`. (Family dispatch for transducer models — parakeet/reazonspeech — is a Phase-0 follow-on; SenseVoice is the only family here.)

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_backends.py
def _install_fake_sherpa(monkeypatch, *, fail=False):
    captured = {}

    class FakeStream:
        def __init__(self): self.result = types.SimpleNamespace(text="  konnichiwa ")
        def accept_waveform(self, rate, samples): captured["fed"] = (rate, len(samples))

    class FakeRecognizer:
        def create_stream(self): return FakeStream()
        def decode_stream(self, s): captured["decoded"] = True

    class FakeOfflineRecognizer:
        @staticmethod
        def from_sense_voice(model, tokens, use_itn, provider="cpu"):
            if fail:
                raise RuntimeError("model file missing")
            captured["from_sense_voice"] = dict(model=model, tokens=tokens,
                                                use_itn=use_itn, provider=provider)
            return FakeRecognizer()

    sherpa = types.ModuleType("sherpa_onnx")
    sherpa.OfflineRecognizer = FakeOfflineRecognizer
    monkeypatch.setitem(sys.modules, "sherpa_onnx", sherpa)

    hub = types.ModuleType("huggingface_hub")
    hub.snapshot_download = lambda repo_id: f"/fake/{repo_id}"
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    return captured


def test_sherpa_load_and_transcribe(monkeypatch):
    cap = _install_fake_sherpa(monkeypatch)
    b = backends.make_backend("sherpa")
    b.load("csukuangfj/sherpa-onnx-sense-voice", "cpu", "int8")
    assert b.is_loaded
    assert cap["from_sense_voice"]["model"].endswith("/model.int8.onnx")
    out = b.transcribe(np.zeros(16000, np.float32), None)
    assert out.text == "konnichiwa" and cap["decoded"] is True
    assert cap["fed"][0] == 16000


def test_sherpa_load_failure_raises(monkeypatch):
    _install_fake_sherpa(monkeypatch, fail=True)
    b = backends.make_backend("sherpa")
    with pytest.raises(backends.BackendLoadError):
        b.load("bad/repo", "cpu", "int8")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_backends.py -k sherpa -q`
Expected: FAIL with `BackendLoadError: unknown backend: sherpa`

- [ ] **Step 3: Write minimal implementation**

```python
# append to sidecar/sokuji_sidecar/backends.py
@register_backend
class SherpaBackend:
    """sherpa-onnx OfflineRecognizer. Phase 0 = SenseVoice (from_sense_voice).
    model_ref is the HF repo id. CPU-only (pip wheel has no GPU runtime)."""
    NAME = "sherpa"

    def __init__(self):
        self._rec = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        import sherpa_onnx
        from huggingface_hub import snapshot_download
        try:
            d = snapshot_download(repo_id=model_ref)
            self._rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt",
                use_itn=True, provider=device)
        except Exception as e:
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        s = self._rec.create_stream()
        s.accept_waveform(TARGET_RATE, samples)
        self._rec.decode_stream(s)
        return AsrResult(s.result.text.strip(), None)

    def unload(self) -> None:
        self._rec = None

    @property
    def is_loaded(self) -> bool:
        return self._rec is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_backends.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): SherpaBackend adapter (SenseVoice)"
```

---

## Task 4: Declarative catalog + language regression guard

**Files:**
- Create: `sidecar/sokuji_sidecar/catalog.py`
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Produces: `Deployment(backend, tier, compute_type, artifact, rank)` (frozen); `AsrModel(id, name, languages, deployments, recommended=False, sort_order=99)` (frozen, `languages`/`deployments` are tuples); `ASR_MODELS: list[AsrModel]`; `asr_models() -> list[AsrModel]`; `asr_model(model_id) -> AsrModel | None`.

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_catalog.py
from sokuji_sidecar import catalog


def test_every_model_has_a_cpu_deployment_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} has no CPU floor"
        for d in m.deployments:
            assert d.backend in {"ctranslate2", "sherpa"}


def test_model_ids_are_unique():
    ids = [m.id for m in catalog.asr_models()]
    assert len(ids) == len(set(ids))


def test_lookup_known_and_unknown():
    assert catalog.asr_model("sense-voice").name == "SenseVoice"
    assert catalog.asr_model("does-not-exist") is None


def test_language_regression_fixtures():
    # Frozen facts verified from HF model cards — must never silently regress.
    assert catalog.asr_model("sense-voice").languages == ("zh", "en", "ja", "ko", "yue")
    assert catalog.asr_model("whisper-large-v3").languages == ("multi",)


def test_sense_voice_uses_sherpa_whisper_uses_ctranslate2():
    assert catalog.asr_model("sense-voice").deployments[0].backend == "sherpa"
    assert catalog.asr_model("whisper-tiny").deployments[0].backend == "ctranslate2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'sokuji_sidecar.catalog'`

- [ ] **Step 3: Write minimal implementation**

```python
# sidecar/sokuji_sidecar/catalog.py
"""Declarative ASR model catalog: per model, which backends/hardware tiers run
it and what artifact each needs. Pure data — adding a model is adding a row.
Phase 0 ships CPU deployments only; GPU tiers are added in Phase 1."""
import os
from dataclasses import dataclass

SENSE_VOICE_REPO = os.environ.get(
    "SOKUJI_ASR_REPO",
    "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")


@dataclass(frozen=True)
class Deployment:
    backend: str        # "ctranslate2" | "sherpa"
    tier: str           # "cpu" (Phase 0); "gpu-cuda"/... later
    compute_type: str   # "int8" | ...
    artifact: str       # backend.load() model_ref: whisper size, or sherpa repo id
    rank: float         # tie-breaker within a tier (higher = preferred)


@dataclass(frozen=True)
class AsrModel:
    id: str
    name: str
    languages: tuple[str, ...]   # ("multi",) means any language
    deployments: tuple[Deployment, ...]
    recommended: bool = False
    sort_order: int = 99


ASR_MODELS: list[AsrModel] = [
    AsrModel("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
             (Deployment("sherpa", "cpu", "int8", SENSE_VOICE_REPO, 1.0),),
             recommended=True, sort_order=0),
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0),),
             recommended=True, sort_order=1),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "base", 1.0),), sort_order=2),
    AsrModel("whisper-small", "Whisper small", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "small", 1.0),), sort_order=3),
    AsrModel("whisper-tiny", "Whisper tiny", ("multi",),
             (Deployment("ctranslate2", "cpu", "int8", "tiny", 1.0),), sort_order=4),
]


def asr_models() -> list[AsrModel]:
    return list(ASR_MODELS)


def asr_model(model_id: str) -> AsrModel | None:
    return next((m for m in ASR_MODELS if m.id == model_id), None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): declarative ASR catalog + language regression guard"
```

---

## Task 5: Hardware probe (`Machine` + `probe()`)

**Files:**
- Create: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: `Gpu(vendor, name, vram_mb)` (frozen); `Machine(os, arch, cpu_cores, nvidia, apple_silicon, dml_adapters, installed, fingerprint)` (frozen; `nvidia`/`dml_adapters` are tuples, `installed` is frozenset); `probe(force=False) -> Machine` (cached). Detection helpers `_nvidia_gpus()`, `_apple_silicon()`, `_dml_adapters()`, `_installed()` are module-level so tests can monkeypatch them; each is wrapped so a throwing detector degrades to "absent".

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_accel.py
from sokuji_sidecar import accel


def test_probe_assembles_machine(monkeypatch):
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: (accel.Gpu("nvidia", "RTX 4070", 12288),))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    m = accel.probe(force=True)
    assert m.nvidia and m.nvidia[0].name == "RTX 4070"
    assert "sherpa" in m.installed
    assert m.fingerprint  # non-empty, stable hash


def test_probe_degrades_when_detector_throws(monkeypatch):
    def boom(): raise RuntimeError("driver broken")
    monkeypatch.setattr(accel, "_nvidia_gpus", boom)
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    m = accel.probe(force=True)
    assert m.nvidia == ()  # broken GPU detection → treated as absent, no crash


def test_probe_is_cached(monkeypatch):
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    first = accel.probe(force=True)
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: (accel.Gpu("nvidia", "x", 0),))
    assert accel.probe() is first  # cached: no re-probe without force
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'sokuji_sidecar.accel'`

- [ ] **Step 3: Write minimal implementation**

```python
# sidecar/sokuji_sidecar/accel.py
"""Hardware-acceleration resolver: probes the machine, decides the ordered list
of Plans for a model (best first, CPU floor last), and loads with fallback.
The single owner of "which backend on which device"."""
import hashlib
import importlib.util
import os
import platform
from dataclasses import dataclass


@dataclass(frozen=True)
class Gpu:
    vendor: str
    name: str
    vram_mb: int


@dataclass(frozen=True)
class Machine:
    os: str
    arch: str
    cpu_cores: int
    nvidia: tuple[Gpu, ...]
    apple_silicon: bool
    dml_adapters: tuple[str, ...]
    installed: frozenset
    fingerprint: str


def _nvidia_gpus() -> tuple[Gpu, ...]:
    from ctranslate2 import get_cuda_device_count
    n = get_cuda_device_count()
    return tuple(Gpu("nvidia", "", 0) for _ in range(n))


def _apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")


def _dml_adapters() -> tuple[str, ...]:
    import onnxruntime
    return ("dml",) if "DmlExecutionProvider" in onnxruntime.get_available_providers() else ()


def _installed() -> frozenset:
    mods = {"ctranslate2": "faster_whisper", "sherpa": "sherpa_onnx",
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm"}
    return frozenset(b for b, mod in mods.items() if importlib.util.find_spec(mod) is not None)


def _safe(fn, default):
    try:
        return fn()
    except Exception:
        return default


_MACHINE: Machine | None = None


def probe(force: bool = False) -> Machine:
    """Detect hardware once and cache. Any detector that throws degrades to
    'absent' so the CPU floor is always reachable."""
    global _MACHINE
    if _MACHINE is not None and not force:
        return _MACHINE
    nvidia = _safe(_nvidia_gpus, ())
    fp = hashlib.sha1(
        f"{platform.system()}|{platform.machine()}|{','.join(g.name for g in nvidia)}"
        .encode()).hexdigest()[:12]
    _MACHINE = Machine(
        os=platform.system(), arch=platform.machine(), cpu_cores=os.cpu_count() or 1,
        nvidia=nvidia, apple_silicon=_safe(_apple_silicon, False),
        dml_adapters=_safe(_dml_adapters, ()), installed=_safe(_installed, frozenset()),
        fingerprint=fp)
    return _MACHINE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): hardware probe (Machine + cached probe)"
```

---

## Task 6: Resolver (`Plan` + `resolve_deployments` + `resolve`)

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `Machine`, `Gpu`, `probe` (Task 5); `catalog.AsrModel`, `catalog.Deployment`, `catalog.asr_model` (Task 4).
- Produces: `Plan(backend, tier, device, compute_type, artifact, rank)` (frozen); `TIER_RANK`/`TIER_DEVICE` dicts; `_tier_available(tier, machine) -> bool`; `resolve_deployments(model, machine, override="auto") -> list[Plan]` (pure — best first, CPU floor last; `override` in {`"auto"`,`"cpu"`,`"cuda"`,`"metal"`,`"vulkan"`,`"dml"`} pins a tier to the front); `resolve(model_id, override="auto", machine=None) -> list[Plan]` (catalog lookup + probe; raises `ValueError` for unknown id, `NoUsablePlan` when nothing runs here).

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_accel.py
from sokuji_sidecar import catalog


def _machine(*, nvidia=(), apple=False, dml=(), installed=frozenset({"ctranslate2", "sherpa"})):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, nvidia=nvidia,
                         apple_silicon=apple, dml_adapters=dml, installed=installed,
                         fingerprint="test")


def _model_cpu_and_cuda():
    return catalog.AsrModel("m", "M", ("multi",), (
        catalog.Deployment("ctranslate2", "gpu-cuda", "float16", "large-v3", 1.0),
        catalog.Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0),
    ))


def test_resolve_prefers_gpu_when_nvidia_present():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))
    plans = accel.resolve_deployments(_model_cpu_and_cuda(), m)
    assert [p.device for p in plans] == ["cuda", "cpu"]  # GPU first, CPU floor last


def test_resolve_cpu_only_machine_drops_gpu_plan():
    plans = accel.resolve_deployments(_model_cpu_and_cuda(), _machine())
    assert [p.device for p in plans] == ["cpu"]  # no NVIDIA → only the floor


def test_resolve_override_pins_cpu():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))
    plans = accel.resolve_deployments(_model_cpu_and_cuda(), m, override="cpu")
    assert plans[0].device == "cpu"  # forced CPU jumps the queue


def test_resolve_gpu_only_model_on_cpu_machine_is_empty():
    gpu_only = catalog.AsrModel("v", "Voxtral", ("multi",),
                                (catalog.Deployment("llamacpp", "gpu-cuda", "q4", "v", 1.0),))
    assert accel.resolve_deployments(gpu_only, _machine()) == []


def test_resolve_real_catalog_sense_voice_cpu(monkeypatch):
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    plans = accel.resolve("sense-voice")
    assert plans[0].backend == "sherpa" and plans[0].device == "cpu"


def test_resolve_unknown_model_raises():
    import pytest
    with pytest.raises(ValueError):
        accel.resolve("nope", machine=_machine())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k resolve -q`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.accel' has no attribute 'resolve_deployments'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to sidecar/sokuji_sidecar/accel.py
TIER_RANK = {"gpu-cuda": 3.0, "gpu-metal": 3.0, "gpu-vulkan": 2.5, "gpu-dml": 2.5, "cpu": 1.0}
TIER_DEVICE = {"cpu": "cpu", "gpu-cuda": "cuda", "gpu-metal": "metal",
               "gpu-vulkan": "vulkan", "gpu-dml": "dml"}


class NoUsablePlan(Exception):
    """A known model has no deployment runnable on this machine (e.g. a GPU-only
    model on a CPU-only box)."""


@dataclass(frozen=True)
class Plan:
    backend: str
    tier: str
    device: str
    compute_type: str
    artifact: str
    rank: float


def _tier_available(tier: str, machine: Machine) -> bool:
    if tier == "cpu":
        return True
    if tier == "gpu-cuda":
        return bool(machine.nvidia)
    if tier == "gpu-metal":
        return machine.apple_silicon
    if tier == "gpu-dml":
        return bool(machine.dml_adapters)
    if tier == "gpu-vulkan":
        return bool(machine.nvidia or machine.dml_adapters)
    return False


def resolve_deployments(model, machine: Machine, override: str = "auto") -> list:
    """Ordered Plans for `model` on `machine`: filter to runnable, rank by tier
    (GPU/NPU >> CPU), then a non-'auto' override pins its tier to the front. The
    CPU floor (if declared) always survives as the last resort."""
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine)]
    usable.sort(key=lambda d: (TIER_RANK.get(d.tier, 0.0), d.rank), reverse=True)
    if override != "auto":
        pinned = [d for d in usable if TIER_DEVICE.get(d.tier) == override]
        rest = [d for d in usable if TIER_DEVICE.get(d.tier) != override]
        usable = pinned + rest
    return [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank)
            for d in usable]


def resolve(model_id: str, override: str = "auto", machine: Machine | None = None) -> list:
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    plans = resolve_deployments(model, machine or probe(), override)
    if not plans:
        raise NoUsablePlan(model_id)
    return plans
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): resolver — ordered Plans with GPU-first ranking + override"
```

---

## Task 7: `load_with_fallback`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `Plan` (Task 6); `backends.make_backend`, `backends.BackendLoadError` (Tasks 1–3).
- Produces: `AllPlansFailed(Exception)`; `load_with_fallback(plans) -> tuple[backend, Plan, str|None]` — tries plans in order, returns the first that loads plus a `notice` (set iff a better plan was skipped); raises `AllPlansFailed` if every plan (including the CPU floor) fails.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_accel.py
from sokuji_sidecar import backends


def _plan(device):
    return accel.Plan("ctranslate2", "cpu" if device == "cpu" else "gpu-cuda",
                      device, "int8", "large-v3", 1.0)


def test_fallback_steps_to_cpu_and_sets_notice(monkeypatch):
    class FakeBackend:
        def __init__(self, ok): self.ok = ok; self.loaded = False
        def load(self, a, device, ct):
            if not self.ok:
                raise backends.BackendLoadError("OOM")
            self.loaded = True
    seq = iter([FakeBackend(False), FakeBackend(True)])
    monkeypatch.setattr(accel, "make_backend", lambda name: next(seq))
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert backend.loaded and plan.device == "cpu"
    assert "falling back" in notice


def test_fallback_first_plan_wins_no_notice(monkeypatch):
    class FakeBackend:
        def load(self, a, device, ct): self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([_plan("cpu")])
    assert plan.device == "cpu" and notice is None


def test_fallback_all_fail_raises(monkeypatch):
    class FakeBackend:
        def load(self, a, device, ct): raise backends.BackendLoadError("nope")
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    import pytest
    with pytest.raises(accel.AllPlansFailed):
        accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k fallback -q`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.accel' has no attribute 'load_with_fallback'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to sidecar/sokuji_sidecar/accel.py
from .backends import make_backend, BackendLoadError


class AllPlansFailed(Exception):
    """Every plan failed to load, including the CPU floor."""


def load_with_fallback(plans: list):
    """Try plans in order; return (backend, plan, notice). `notice` is set when a
    higher-ranked plan was skipped. Raises AllPlansFailed if none load."""
    notice = None
    for plan in plans:
        try:
            backend = make_backend(plan.backend)
            backend.load(plan.artifact, plan.device, plan.compute_type)
            return backend, plan, notice
        except BackendLoadError as e:
            notice = f"{plan.device} unavailable ({e.reason}); falling back"
            continue
    raise AllPlansFailed(notice or "no plans to load")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): load_with_fallback — selection and fallback as one mechanism"
```

---

## Task 8: Wire `AsrEngine` to the resolver (the seam)

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (replace `_build_sherpa`/`_build_faster_whisper` selection in `init`; remove both builders; add `device` param; store `self.resolved`)
- Test: `sidecar/tests/test_asr_engine.py` (existing tests unchanged; add one resolver-path test)

**Interfaces:**
- Consumes: `accel.resolve`, `accel.load_with_fallback` (Tasks 6–7); `AsrResult` via `backend.transcribe` (Task 1).
- Produces: `AsrEngine.init(model_id=None, language="", sample_rate=SRC_RATE, vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto") -> int` now resolves via the catalog and sets `self.resolved = {"backend","device","computeType"}`. `_drain` calls `self._backend.transcribe(samples, self._language).text`.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_asr_engine.py
class _FakeBackend:
    def transcribe(self, samples, language):
        from sokuji_sidecar.backends import AsrResult
        return AsrResult("resolved-text")


def test_engine_init_uses_resolver(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    # Stub VAD so no model/native lib is needed.
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (_FakeBackend(), fake_plan, None))
    ms = eng.init(model_id="whisper-tiny", language="en", device="auto")
    assert isinstance(ms, int)
    assert eng.resolved == {"backend": "ctranslate2", "device": "cpu", "computeType": "int8"}
    # _drain uses the resolved backend's transcribe().text
    import numpy as np
    assert eng._backend.transcribe(np.zeros(4, np.float32), "en").text == "resolved-text"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_asr_engine.py -k resolver -q`
Expected: FAIL — `AttributeError` on `eng._init_vad` (method does not exist yet) or `eng.resolved`.

- [ ] **Step 3: Write minimal implementation**

Replace the two builder functions (`_build_sherpa`, `_build_faster_whisper`, lines 47–74) — delete them — and rewrite `AsrEngine.init` plus `_drain`. Extract the VAD setup into `_init_vad` so it can be stubbed in tests.

```python
# sidecar/sokuji_sidecar/asr_engine.py — AsrEngine methods (replace init + _drain)

    def _init_vad(self, sample_rate, vad_threshold, vad_min_silence, vad_min_speech):
        import sherpa_onnx  # lazy: native lib pulled here
        self._src_rate = int(sample_rate)
        vad_cfg = sherpa_onnx.VadModelConfig()
        vad_cfg.silero_vad.model = _resolve_vad_model()
        if vad_threshold is not None:
            vad_cfg.silero_vad.threshold = float(vad_threshold)
        if vad_min_silence is not None:
            vad_cfg.silero_vad.min_silence_duration = float(vad_min_silence)
        if vad_min_speech is not None:
            vad_cfg.silero_vad.min_speech_duration = float(vad_min_speech)
        vad_cfg.sample_rate = TARGET_RATE
        self._window = vad_cfg.silero_vad.window_size
        self._buf = np.zeros(0, np.float32)
        self._vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=30)

    def init(self, model_id=None, language="", sample_rate=SRC_RATE,
             vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
        from . import accel
        t0 = time.time()
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        # Resolve the fastest available backend+device; CPU floor guaranteed.
        plans = accel.resolve(model_id or "sense-voice", override=device or "auto")
        self._backend, plan, _notice = accel.load_with_fallback(plans)
        self._language = language or None
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        return int((time.time() - t0) * 1000)

    def _drain(self):
        out = []
        while not self._vad.empty():
            seg = self._vad.front
            samples = np.asarray(seg.samples, dtype=np.float32)
            t0 = time.time()
            text = self._backend.transcribe(samples, self._language).text
            self._vad.pop()
            if text:
                out.append({"type": "result", "text": text,
                            "startSample": int(seg.start),
                            "durationMs": int(len(seg.samples) / TARGET_RATE * 1000),
                            "recognitionTimeMs": int((time.time() - t0) * 1000)})
        return out
```

Also update `__init__` to seed the new attributes (replace the `self._rec = None` line):

```python
    def __init__(self):
        self._vad = None
        self._backend = None
        self._language = None
        self.resolved = None
        self._window = 512
        self._buf = np.zeros(0, np.float32)
        self._src_rate = SRC_RATE
```

And add `device` passthrough in the handler (`_h_asr_init`, around line 155):

```python
    ms = eng.init(msg.get("model"), msg.get("language", ""), msg.get("sampleRate", SRC_RATE),
                  msg.get("vadThreshold"), msg.get("vadMinSilenceDuration"),
                  msg.get("vadMinSpeechDuration"), msg.get("device", "auto"))
```

- [ ] **Step 4: Run the new test + the whole sidecar suite**

Run: `.venv/bin/python -m pytest tests/test_asr_engine.py tests/test_backends.py tests/test_catalog.py tests/test_accel.py tests/test_native_models.py tests/test_server_conn.py -q`
Expected: PASS — the new resolver test passes; the existing FakeAsr tests (`test_asr_init_sets_binary_router_and_replies_ready`, etc.) stay green because they replace `AsrEngine` with `FakeAsr`.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "refactor(sidecar): AsrEngine resolves via accel instead of inline builders"
```

---

## Task 9: `hardware_info` handler + registration

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (add handler + `register`)
- Modify: `sidecar/sokuji_sidecar/__main__.py` (call `register_accel`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `probe` (Task 5); the server dispatch contract `handler(state, msg, binary, conn) -> (reply_dict_or_None, binary_or_None)`.
- Produces: `_h_hardware_info` returning `{"type":"hardware_info_result","id",...,"os","arch","cpuCores","gpus":[{vendor,name,vramMb}],"backendsInstalled":[...],"accelAvailable":bool}`; `register(state)` adding the `hardware_info` handler.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_accel.py
import asyncio, json
from sokuji_sidecar import server


def test_hardware_info_handler(monkeypatch):
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: (accel.Gpu("nvidia", "RTX 4070", 12288),))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "hardware_info", "id": 7}), None, None))
    assert reply["type"] == "hardware_info_result" and reply["id"] == 7
    assert reply["accelAvailable"] is True
    assert reply["gpus"][0]["name"] == "RTX 4070"
    assert "sherpa" in reply["backendsInstalled"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k hardware_info -q`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.accel' has no attribute 'register'`

- [ ] **Step 3: Write minimal implementation**

```python
# append to sidecar/sokuji_sidecar/accel.py
async def _h_hardware_info(state, msg, _b, conn=None):
    m = probe()
    return {"type": "hardware_info_result", "id": msg.get("id"),
            "os": m.os, "arch": m.arch, "cpuCores": m.cpu_cores,
            "gpus": [{"vendor": g.vendor, "name": g.name, "vramMb": g.vram_mb} for g in m.nvidia],
            "backendsInstalled": sorted(m.installed),
            "accelAvailable": bool(m.nvidia or m.apple_silicon or m.dml_adapters)}, None


def register(state: dict):
    state.setdefault("handlers", {}).update({"hardware_info": _h_hardware_info})
```

Wire it into `__main__.py`: add the import and call alongside the others.

```python
# sidecar/sokuji_sidecar/__main__.py — inside _run(), after the existing imports
    from .accel import register as register_accel
    ...
    register_models(state)
    register_accel(state)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS (13 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/__main__.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): hardware_info handler + register accel module"
```

---

## Task 10: `models_catalog` handler

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (add handler; extend `register`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `catalog.asr_models`, `probe`, `_tier_available` (Tasks 4–6).
- Produces: `_h_models_catalog` returning `{"type":"models_catalog_result","id",...,"models":[{id,name,languages:[...],recommended,tiers:[{tier,backend,available}]}]}`. `register(state)` now also registers `models_catalog`. (No `sizeMb` here — sizes already come from the existing `model_sizes` handler.)

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_accel.py
def test_models_catalog_handler_cpu_machine(monkeypatch):
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "models_catalog", "id": 3}), None, None))
    assert reply["type"] == "models_catalog_result" and reply["id"] == 3
    by_id = {m["id"]: m for m in reply["models"]}
    assert by_id["sense-voice"]["languages"] == ["zh", "en", "ja", "ko", "yue"]
    sv_tiers = by_id["sense-voice"]["tiers"]
    assert sv_tiers == [{"tier": "cpu", "backend": "sherpa", "available": True}]
    assert by_id["whisper-large-v3"]["recommended"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k models_catalog -q`
Expected: FAIL with `error` reply `unknown message type: models_catalog` (handler not registered).

- [ ] **Step 3: Write minimal implementation**

```python
# append to sidecar/sokuji_sidecar/accel.py
async def _h_models_catalog(state, msg, _b, conn=None):
    from . import catalog
    m = probe()
    wanted = msg.get("models")
    models = catalog.asr_models()
    if wanted:
        models = [x for x in models if x.id in wanted]
    out = []
    for mdl in models:
        tiers = [{"tier": d.tier, "backend": d.backend,
                  "available": d.backend in m.installed and _tier_available(d.tier, m)}
                 for d in mdl.deployments]
        out.append({"id": mdl.id, "name": mdl.name, "languages": list(mdl.languages),
                    "recommended": mdl.recommended, "tiers": tiers})
    return {"type": "models_catalog_result", "id": msg.get("id"), "models": out}, None
```

Extend `register` to include the new handler:

```python
def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"hardware_info": _h_hardware_info, "models_catalog": _h_models_catalog})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS (14 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): models_catalog handler (per-machine tier availability)"
```

---

## Task 11: Extend the `ready` reply with the resolved plan

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (`_h_asr_init` merges `eng.resolved`)
- Test: `sidecar/tests/test_asr_engine.py`

**Interfaces:**
- Consumes: `AsrEngine.resolved` (Task 8).
- Produces: `_h_asr_init` reply gains `backend`/`device`/`computeType` **only when** `getattr(eng, "resolved", None)` is set — so the existing `FakeAsr` (no `resolved`) test stays byte-for-byte green, while the real engine reports what actually loaded.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_asr_engine.py
class _ResolvedAsr(FakeAsr):
    def init(self, *a, **k):
        ms = super().init(*a, **k)
        self.resolved = {"backend": "ctranslate2", "device": "cuda", "computeType": "float16"}
        return ms


def test_ready_includes_resolved_plan_when_present():
    st = {"asr_engine": _ResolvedAsr(), "handlers": {}}
    asr_engine.register(st)
    conn = server.Conn(_FakeWS())
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 1}), None, conn))
    assert reply["backend"] == "ctranslate2"
    assert reply["device"] == "cuda" and reply["computeType"] == "float16"


def test_ready_unchanged_when_engine_has_no_resolved():
    # The plain FakeAsr (no `resolved`) must still get the minimal ready shape.
    st, conn = make()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "asr_init", "id": 2}), None, conn))
    assert reply == {"type": "ready", "id": 2, "loadTimeMs": 33}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_asr_engine.py -k "ready_includes_resolved" -q`
Expected: FAIL with `KeyError: 'backend'`

- [ ] **Step 3: Write minimal implementation**

```python
# sidecar/sokuji_sidecar/asr_engine.py — replace _h_asr_init body's return construction
async def _h_asr_init(state, msg, _b, conn=None):
    eng = state["asr_engine"]
    ms = eng.init(msg.get("model"), msg.get("language", ""), msg.get("sampleRate", SRC_RATE),
                  msg.get("vadThreshold"), msg.get("vadMinSilenceDuration"),
                  msg.get("vadMinSpeechDuration"), msg.get("device", "auto"))
    if conn is not None:
        conn.ctx["on_binary"] = eng.feed
    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(eng, "resolved", None)
    if resolved:
        reply.update(resolved)  # backend, device, computeType
    return reply, None
```

- [ ] **Step 4: Run the full sidecar suite**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS — all pure tests green (`test_ready_unchanged_when_engine_has_no_resolved` confirms no regression); env-gated real tests still skipped.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): ready reply reports the resolved backend/device/compute"
```

---

## Task 12: Full-suite + real-model smoke verification

**Files:**
- (No new files — verification gate before declaring Phase 0 done.)

- [ ] **Step 1: Run the entire pure suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all pure tests pass; 4 (or more) env-gated tests skipped. No failures.

- [ ] **Step 2: Run the real SenseVoice path through the new architecture**

Run: `SOKUJI_RUN_ASR_MODEL=1 .venv/bin/python -m pytest tests/test_asr_engine.py::test_real_engine_transcribes_test_wav -q`
Expected: PASS — proves `AsrEngine.init()` → `accel.resolve("sense-voice")` → `SherpaBackend` transcribes the test wav (the "gold"/"tribal" assertion), i.e. **no behavior change** through the refactor.

- [ ] **Step 3: Run the real Whisper path through the new architecture**

Run: `SOKUJI_RUN_FW_MODEL=1 .venv/bin/python -m pytest tests/test_asr_engine.py::test_real_faster_whisper_transcribes -q`
Expected: PASS — proves `init(model_id="whisper-tiny")` → `accel.resolve` → `CTranslate2Backend` transcribes. (Requires network to download faster-whisper tiny.)

- [ ] **Step 4: Commit (verification note only, if anything was adjusted)**

If steps 1–3 required a fix, commit it; otherwise nothing to commit. Phase 0 is complete when all three pass.

```bash
git add -A
git commit -m "test(sidecar): verify Phase 0 ASR architecture against real models" --allow-empty
```

---

## Self-Review

**Spec coverage (Phase 0 rows of the spec):**
- `AsrBackend` interface + adapters → Tasks 1–3 (CTranslate2, Sherpa; the spec's llama.cpp/MLX/onnx adapters are Phases 1–2).
- `catalog.py` declarative rows + verified languages → Task 4 (CPU-floor rows; parakeet-v3/reazonspeech are a noted follow-on needing repo verification, not invented here).
- `accel.py` probe/resolve/benchmark/override + fallback → Tasks 5–7. **Benchmark/cache is intentionally deferred to Phase 1** (it only matters once GPU plans exist to compare; the spec scopes it to device *selection*, which is trivial with CPU-only deployments). The resolver's override + ordered-Plan + fallback are all present now.
- Data-flow protocol (`hardware_info`, `models_catalog`, extended `ready`) → Tasks 9–11.
- `asr_engine` seam → Task 8.
- Testing strategy (pure decision tests, fake Machines, regression-guard fixtures) → Tasks 4–7, 9–10.
- Distribution / UI / error-surface (renderer) → **out of Phase 0 scope** (renderer follow-on; sidecar-side fallback notice plumbing lands with Phase 1's GPU path, where it is observable).

**Placeholder scan:** none — every step has complete code and exact commands. The two deliberate scope-deferrals (benchmark cache; parakeet/reazonspeech rows) are called out explicitly, not left as TODOs in code.

**Type consistency:** `Plan(backend, tier, device, compute_type, artifact, rank)` is used identically in Tasks 6, 7, 8. `make_backend`/`BackendLoadError` from `backends` are consumed by `accel` in Task 7 and tested with the same `BackendLoadError`. `resolved` dict keys (`backend`/`device`/`computeType`) match between Task 8 (producer) and Task 11 (consumer). Handler signature `(state, msg, binary, conn) -> (reply, binary)` matches the existing `server.handle_message` contract in Tasks 9–11.

---

## Follow-on (not this plan)

1. **Renderer consumption** (small plan): `nativeProtocol.ts` types for `hardware_info_result` / `models_catalog_result` + extended `ReadyMsg`; `NativeModelClient.hardwareInfo()` / `modelsCatalog()`; the **"CPU" tier badge** on the ASR cards in `NativeModelManagementSection.tsx`.
2. **Parakeet-v3 + ReazonSpeech rows** (needs sherpa transducer repo verification + `from_transducer` dispatch in `SherpaBackend`).
3. **Phase 1**: CTranslate2-CUDA deployment on the Whisper rows, the NVIDIA backend pack, the benchmark/RTF cache, and the device-override UI.

## Phase 0 — Behavior Notes (post-implementation, from final review)

Two items the final whole-branch review surfaced. Neither blocks Phase 0; both are recorded here for the Phase-1 / renderer follow-on.

1. **ASR model-id narrowing (a deliberate, production-unreachable behavior change).** The old `_build_sherpa(model_id)` used *any* non-`whisper` `model_id` directly as a HuggingFace repo id, so `init(model_id="some/other-repo")` worked. The resolver now raises `ValueError("unknown asr model: …")` for any id not in `catalog.py`'s rows (surfaced to the renderer as an `error` reply, not a crash). This is **unreachable from production**: the renderer's `NATIVE_ASR` only emits `sense-voice` and `whisper-{base,small,tiny}`, all of which are in the catalog, and the `SOKUJI_ASR_REPO` override is still honored for the `sense-voice` deployment's artifact. The "zero behavior change" goal holds for all real traffic; the narrowing only affects manual/arbitrary-repo ids, which no caller used. If arbitrary-repo support is ever wanted, add a fallback in `resolve()` (unknown id → synthesize a sherpa sense-voice deployment).

2. **Catalog drift to reconcile in the renderer follow-on.** `catalog.py` (the sidecar source of truth) and `src/lib/local-inference/native/nativeCatalog.ts` (the renderer's hand-maintained list) have already diverged: the sidecar ships `whisper-large-v3` (recommended) which the renderer list lacks, and the two disagree on which whisper is `recommended`. The design makes `catalog.py` authoritative and the renderer queries it via `models_catalog`. The renderer follow-on plan must wire `models_catalog_result` as the renderer's source (and add a download-size entry for `whisper-large-v3`) so the two lists stop being hand-maintained twins.
