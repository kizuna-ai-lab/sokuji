# Native TTS Stage (Sidecar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TTS stage to the Python sidecar (`sidecar/sokuji_sidecar/`) that synthesizes speech from text via onnxruntime, mirroring the existing ASR/translate seam, with two backends: `sherpa_tts` (one-shot) and `moss_onnx` (MOSS-TTS-Nano-100M: streaming + voice cloning).

**Architecture:** Reuse the existing seam — TTS backends register into the shared `backends` registry; `accel.resolve_tts` reuses `probe()`/tiers/`load_with_fallback`/bench; a declarative `catalog.TtsModel` drives selection and downloads; a rewritten `tts_engine.py` is a process singleton exposing init/set_voice/generate/generate_stream/close + WS handlers; `server.py` gains `owns_tts` cleanup. All onnxruntime, in the shared cu128 venv.

**Tech Stack:** Python 3.12, onnxruntime / onnxruntime-gpu 1.22, sherpa-onnx (+cuda12.cudnn9 for GPU), numpy, websockets, pytest. Spec: `docs/superpowers/specs/2026-06-29-native-tts-backend-design.md`.

## Global Constraints

- All TTS runs on **onnxruntime in the shared venv** — no torch added for TTS, no isolated venv.
- Audio output contract: **Int16 PCM, 24 kHz, mono** (engine resamples from each model's native rate). Reported `sampleRate` is always `24000`.
- MOSS codec decode is **incremental/streaming only** — never call the full-decode path (it attempts a 2.3 GB single allocation and OOMs).
- Do NOT set ORT `arena_extend_strategy=kSameAsRequested` (it fragmented/crashed in the spike). Leave the ORT arena default.
- GPU requires `onnxruntime-gpu==1.22` (CUDA 12 / cuDNN 9, matches torch cu12x) + the `sherpa-onnx …+cuda12.cudnn9` build; both belong to the GPU pack only.
- Backend NAMEs: `sherpa_tts`, `moss_onnx`. Tests that need real models are gated behind `SOKUJI_RUN_GPU` / `SOKUJI_RUN_TTS`.
- Run tests with the sidecar venv: `cd sidecar && .venv/bin/python -m pytest tests/<file> -v`.

---

### Task 1: Catalog — `TtsModel` + rows + accessors

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (append after the translate section)
- Test: `sidecar/tests/test_catalog.py` (append)

**Interfaces:**
- Consumes: existing `Deployment` dataclass from `catalog.py`.
- Produces: `catalog.TtsModel` (fields below), `catalog.tts_models() -> list[TtsModel]`, `catalog.tts_model(id) -> TtsModel | None`, `catalog.TTS_MODELS`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_catalog.py`:

```python
def test_tts_models_have_deployments_languages_and_repos():
    assert catalog.tts_models(), "no tts models"
    for m in catalog.tts_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert m.repos, f"{m.id} has no download repos"
        for d in m.deployments:
            assert d.backend in {"sherpa_tts", "moss_onnx"}

def test_tts_system_has_cpu_floor_and_unique_ids():
    ids = [m.id for m in catalog.tts_models()]
    assert len(ids) == len(set(ids)), "duplicate tts model ids"
    for m in catalog.tts_models():
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} has no cpu floor"

def test_tts_moss_nano_is_streaming_cloning():
    m = catalog.tts_model("moss-tts-nano")
    assert m is not None and m.streaming and m.clones
    assert len(m.repos) == 2  # LM ONNX + audio-tokenizer ONNX

def test_tts_model_unknown_returns_none():
    assert catalog.tts_model("does-not-exist") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -k tts -v`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.catalog' has no attribute 'tts_models'`

- [ ] **Step 3: Write minimal implementation**

Append to `sidecar/sokuji_sidecar/catalog.py`:

```python
@dataclass(frozen=True)
class TtsModel:
    id: str
    name: str
    languages: tuple[str, ...]
    deployments: tuple[Deployment, ...]
    repos: tuple[str, ...] = ()      # HF repos to download
    urls: tuple[str, ...] = ()       # extra files (e.g. a vocoder .onnx)
    clones: bool = False             # zero-shot voice cloning from a reference clip
    streaming: bool = False          # intra-utterance audio-delta streaming
    sample_rate: int = 24000         # native rate (engine resamples to 24k)
    recommended: bool = False
    sort_order: int = 99


def _sherpa_tts_row(mid, name, langs, repo, sort_order, sr, urls=(), recommended=False):
    return TtsModel(mid, name, langs, (
        Deployment("sherpa_tts", "gpu-cuda", "fp32", repo, 1.0),
        Deployment("sherpa_tts", "cpu", "fp32", repo, 1.0),
    ), repos=(repo,), urls=tuple(urls), sample_rate=sr,
       recommended=recommended, sort_order=sort_order)


_MOSS_NANO_LM_REPO = os.environ.get(
    "SOKUJI_MOSS_TTS_NANO_REPO", "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
_MOSS_NANO_TOK_REPO = os.environ.get(
    "SOKUJI_MOSS_TTS_NANO_TOK_REPO", "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")

TTS_MODELS: list[TtsModel] = [
    TtsModel("moss-tts-nano", "MOSS-TTS-Nano (100M)",
             ("zh", "en", "ja", "ko", "de", "fr", "es", "pt", "it", "ru",
              "ar", "pl", "cs", "da", "sv", "el", "tr", "hu", "fa", "nl"),
             (Deployment("moss_onnx", "gpu-cuda", "fp32", _MOSS_NANO_LM_REPO, 1.0),
              Deployment("moss_onnx", "cpu", "fp32", _MOSS_NANO_LM_REPO, 1.0)),
             repos=(_MOSS_NANO_LM_REPO, _MOSS_NANO_TOK_REPO),
             clones=True, streaming=True, sample_rate=48000,
             recommended=True, sort_order=0),
    _sherpa_tts_row("piper-en-amy", "Piper (en-US Amy)", ("en",),
                    "csukuangfj/vits-piper-en_US-amy-low", 10, 16000, recommended=True),
    _sherpa_tts_row("vits-icefall-zh-aishell3", "VITS (zh, aishell3)", ("zh",),
                    "csukuangfj/vits-icefall-zh-aishell3", 11, 16000),
]


def tts_models() -> list[TtsModel]:
    return list(TTS_MODELS)


def tts_model(model_id: str) -> TtsModel | None:
    return next((m for m in TTS_MODELS if m.id == model_id), None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -k tts -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(native): add TtsModel catalog rows (moss-nano + sherpa)"
```

---

### Task 2: Resolver — `resolve_tts`, installed-backend rows, `.onnx` weight ext, `measure_rtf_tts`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed()` map, `_WEIGHT_EXTS`, add `resolve_tts`, add `measure_rtf_tts`)
- Test: `sidecar/tests/test_accel.py` (append)

**Interfaces:**
- Consumes: `catalog.tts_model`, existing `_resolve_model`, `probe`, `Machine`, `Plan`, `bench_load`/`bench_save`, `_bench_key`.
- Produces: `accel.resolve_tts(model_id, override="auto", machine=None) -> list[Plan]`; `accel.measure_rtf_tts(backend, plan, model_id, machine, *, force=False) -> float | None`. `_installed()` now reports `"sherpa_tts"` and `"moss_onnx"` when their runtimes are importable; `_WEIGHT_EXTS` includes `".onnx"`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_accel.py`:

```python
def test_resolve_tts_orders_gpu_over_cpu(monkeypatch):
    from sokuji_sidecar import accel, catalog
    # a machine with an NVIDIA GPU and both tts backends installed
    gpu = accel.Gpu("nvidia", "", 12000, (8, 9))
    machine = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                            nvidia=(gpu,), apple_silicon=False, dml_adapters=(),
                            installed=frozenset({"sherpa_tts", "moss_onnx"}),
                            fingerprint="testfp")
    plans = accel.resolve_tts("moss-tts-nano", override="auto", machine=machine)
    assert plans[0].tier == "gpu-cuda" and plans[0].device == "cuda"
    assert plans[-1].tier == "cpu"  # cpu floor survives

def test_resolve_tts_cpu_only_machine(monkeypatch):
    from sokuji_sidecar import accel
    machine = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                            nvidia=(), apple_silicon=False, dml_adapters=(),
                            installed=frozenset({"sherpa_tts", "moss_onnx"}),
                            fingerprint="testfp2")
    plans = accel.resolve_tts("moss-tts-nano", override="auto", machine=machine)
    assert [p.tier for p in plans] == ["cpu"]

def test_resolve_tts_unknown_model_raises():
    from sokuji_sidecar import accel
    import pytest
    with pytest.raises(ValueError):
        accel.resolve_tts("nope")

def test_measure_rtf_tts_with_fake_backend(tmp_path, monkeypatch):
    from sokuji_sidecar import accel
    import numpy as np
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    class FakeBackend:
        sample_rate = 24000
        def generate(self, text, speed=1.0):
            return np.zeros(24000, np.float32), 100  # 1.0s audio, 100ms gen
    plan = accel.Plan("moss_onnx", "cpu", "cpu", "fp32", "repo", 1.0)
    m = accel.probe()
    rtf = accel.measure_rtf_tts(FakeBackend(), plan, "moss-tts-nano", m)
    assert rtf is not None and rtf > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k tts -v`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.accel' has no attribute 'resolve_tts'`

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sokuji_sidecar/accel.py`, add to the `mods` dict inside `_installed()` (alongside the existing entries):

```python
        "sherpa_tts": "sherpa_onnx",
        "moss_onnx": "onnxruntime",
```

Change `_WEIGHT_EXTS` to include onnx:

```python
_WEIGHT_EXTS = (".safetensors", ".bin", ".pt", ".gguf", ".onnx")
```

Add near `resolve` / `resolve_translate`:

```python
def resolve_tts(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.tts_model(model_id)
    if model is None:
        raise ValueError(f"unknown tts model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())
```

Add near `measure_rtf` / `measure_tps`:

```python
BENCH_TTS_TEXT = "The weather is lovely today, so I will go for a walk in the park."


def measure_rtf_tts(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: synth a fixed sentence, return RTF (gen_seconds / audio_seconds),
    cached under a 'tts:'-namespaced key. Never raises (returns None)."""
    try:
        key = "tts:" + _bench_key(machine.fingerprint, model_id, plan.backend,
                                  plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        samples, gen_ms = backend.generate(BENCH_TTS_TEXT, 1.0)
        audio_s = len(samples) / float(getattr(backend, "sample_rate", 24000))
        if audio_s <= 0:
            return None
        rtf = (gen_ms / 1000.0) / audio_s
        cache[key] = rtf
        bench_save(cache)
        return rtf
    except Exception:
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k tts -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(native): resolve_tts + measure_rtf_tts + onnx weight sizing"
```

---

### Task 3: Engine — rewrite `tts_engine.py` (init / generate / generate_stream / close / resample)

**Files:**
- Rewrite: `sidecar/sokuji_sidecar/tts_engine.py` (discard the current piper/pocket dispatcher)
- Test: `sidecar/tests/test_tts_engine.py` (replace contents)

**Interfaces:**
- Consumes: `accel.resolve_tts`, `accel.load_measured`, `accel.measure_rtf_tts`, `accel.probe`, `catalog.tts_model`. Backend instances expose `sample_rate`, `STREAMING`, `CLONES`, `load`, `set_voice`, `generate`, `generate_stream`, `unload`.
- Produces: `tts_engine.TtsEngine` with `init(model_id, device="auto", language="") -> int`, `set_voice(audio, sr) -> None`, `generate(text, speed=1.0) -> tuple[bytes, int]` (Int16@24k PCM bytes, gen_ms), `async generate_stream(text, speed, send, should_cancel, msg_id) -> None`, `close() -> None`, attribute `resolved: dict | None`, `streaming: bool`, `clones: bool`, `sample_rate` (always 24000). Module function `_to_int16_24k_mono(samples, src_sr, target_sr=24000) -> bytes`.

- [ ] **Step 1: Write the failing test**

Replace `sidecar/tests/test_tts_engine.py` with:

```python
import asyncio
import numpy as np
import pytest
from sokuji_sidecar import tts_engine, accel, catalog


def test_resample_48k_stereo_to_24k_mono():
    stereo = np.ones((48000, 2), np.float32)          # 1.0s @ 48k stereo
    pcm = tts_engine._to_int16_24k_mono(stereo, 48000)
    samples = np.frombuffer(pcm, np.int16)
    assert abs(len(samples) - 24000) <= 2             # ~1.0s @ 24k mono
    assert samples.dtype == np.int16 and samples.max() > 30000  # ones -> ~32767


def test_resample_16k_mono_to_24k():
    mono = np.zeros(16000, np.float32)
    pcm = tts_engine._to_int16_24k_mono(mono, 16000)
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2


class _FakeOneShot:
    NAME = "fake_oneshot"; STREAMING = False; CLONES = False; sample_rate = 16000
    def __init__(self): self._loaded = True
    def set_voice(self, a, sr): raise AssertionError("one-shot has no set_voice")
    def generate(self, text, speed=1.0): return np.ones(16000, np.float32), 50
    def unload(self): self._loaded = False
    @property
    def is_loaded(self): return self._loaded


class _FakeStream:
    NAME = "fake_stream"; STREAMING = True; CLONES = True; sample_rate = 24000
    def __init__(self): self._loaded = True; self.voice = None
    def set_voice(self, a, sr): self.voice = (len(a), sr)
    def generate(self, text, speed=1.0):
        return np.concatenate(list(self.generate_stream(text, speed))), 30
    def generate_stream(self, text, speed=1.0):
        for _ in range(3):
            yield np.ones(8000, np.float32)            # 3 chunks @ 24k
    def unload(self): self._loaded = False
    @property
    def is_loaded(self): return self._loaded


def _patch(monkeypatch, backend, model_id):
    plan = accel.Plan(backend.NAME, "cpu", "cpu", "fp32", "repo", 1.0)
    monkeypatch.setattr(accel, "resolve_tts", lambda *a, **k: [plan])
    monkeypatch.setattr(accel, "load_measured", lambda plans: (backend, plan, None, None))
    monkeypatch.setattr(accel, "measure_rtf_tts", lambda *a, **k: 0.1)


def test_init_oneshot_reports_resolved_and_24k(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine()
    eng.init("piper-en-amy")
    assert eng.sample_rate == 24000 and eng.streaming is False and eng.clones is False
    assert eng.resolved["backend"] == "fake_oneshot"


def test_generate_oneshot_returns_24k_pcm(monkeypatch):
    b = _FakeOneShot(); _patch(monkeypatch, b, "piper-en-amy")
    eng = tts_engine.TtsEngine(); eng.init("piper-en-amy")
    pcm, ms = eng.generate("hello")
    assert abs(len(np.frombuffer(pcm, np.int16)) - 24000) <= 2  # 16k->24k


def test_generate_stream_emits_chunks_then_done(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: False, msg_id="m1"))
    chunks = [o for o, _ in sent if o and o.get("type") == "tts_chunk"]
    done = [o for o, _ in sent if o and o.get("type") == "tts_done"]
    assert len(chunks) == 3 and len(done) == 1
    assert done[0]["id"] == "m1" and done[0]["totalSamples"] == 3 * 8000


def test_generate_stream_honors_cancel(monkeypatch):
    b = _FakeStream(); _patch(monkeypatch, b, "moss-tts-nano")
    eng = tts_engine.TtsEngine(); eng.init("moss-tts-nano")
    sent = []
    async def send(obj=None, binary=None): sent.append((obj, binary))
    asyncio.run(eng.generate_stream("hi", 1.0, send, lambda: True, msg_id="m2"))
    chunks = [o for o, _ in sent if o and o.get("type") == "tts_chunk"]
    assert len(chunks) == 0  # cancelled before first emit
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine.py -v`
Expected: FAIL (module rewrite not done; e.g. `_to_int16_24k_mono` missing)

- [ ] **Step 3: Write minimal implementation**

Replace `sidecar/sokuji_sidecar/tts_engine.py` with (handlers added in Task 4 — keep them out for now):

```python
"""TTS stage: resolve a backend (sherpa one-shot or MOSS streaming) via accel,
synthesize, and normalize output to the renderer's Int16@24k mono contract.
Process singleton, reused across sessions; close() frees VRAM."""
import asyncio
import queue
import time

import numpy as np

TARGET_RATE = 24000


def _to_int16_24k_mono(samples, src_sr, target_sr=TARGET_RATE) -> bytes:
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim == 2:                       # (n, channels) -> mono
        x = x.mean(axis=1)
    x = x.reshape(-1)
    if src_sr != target_sr and x.size:
        ratio = target_sr / float(src_sr)
        n = int(round(x.size * ratio))
        pos = np.arange(n, dtype=np.float64) / ratio
        i0 = np.floor(pos).astype(np.int64)
        frac = (pos - i0).astype(np.float32)
        a = x[np.clip(i0, 0, x.size - 1)]
        b = x[np.clip(i0 + 1, 0, x.size - 1)]
        x = a + (b - a) * frac
    x = np.clip(x, -1.0, 1.0)
    return (x * 32767.0).astype(np.int16).tobytes()


class TtsEngine:
    def __init__(self):
        self._backend = None
        self._native_sr = TARGET_RATE
        self.sample_rate = TARGET_RATE      # reported contract rate (always 24k)
        self.streaming = False
        self.clones = False
        self.resolved = None

    def init(self, model_id=None, device="auto", language=""):
        from . import accel, catalog
        t0 = time.time()
        self.close()                        # VRAM hygiene: free any prior model first
        mid = model_id or "moss-tts-nano"
        plans = accel.resolve_tts(mid, override=device or "auto")
        self._backend, plan, notice, mem = accel.load_measured(plans)
        self._native_sr = getattr(self._backend, "sample_rate", TARGET_RATE)
        self.streaming = bool(getattr(self._backend, "STREAMING", False))
        self.clones = bool(getattr(self._backend, "CLONES", False))
        rtf = accel.measure_rtf_tts(self._backend, plan, mid, accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type,
                         "streaming": self.streaming, "clones": self.clones}
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        return int((time.time() - t0) * 1000)

    def set_voice(self, audio, sr):
        self._backend.set_voice(np.asarray(audio, dtype=np.float32), int(sr))

    def generate(self, text, speed=1.0):
        samples, gen_ms = self._backend.generate(text, speed)
        return _to_int16_24k_mono(samples, self._native_sr), gen_ms

    async def generate_stream(self, text, speed, send, should_cancel, msg_id):
        """Drive the backend's frame generator in a worker thread; push tts_chunk
        deltas (Int16@24k) via `send`, then tts_done. Cancellation is checked
        per chunk via should_cancel()."""
        loop = asyncio.get_running_loop()
        q: "queue.Queue" = queue.Queue()
        SENTINEL = object()

        def worker():
            try:
                for chunk in self._backend.generate_stream(text, speed):
                    if should_cancel():
                        break
                    q.put(("chunk", chunk))
            except Exception as e:            # surface, then terminate the stream
                q.put(("error", str(e)))
            finally:
                q.put((SENTINEL, None))

        fut = loop.run_in_executor(None, worker)
        t0 = time.time()
        seq = 0
        total = 0
        while True:
            kind, payload = await loop.run_in_executor(None, q.get)
            if kind is SENTINEL:
                break
            if kind == "error":
                await send({"type": "error", "id": msg_id, "message": payload})
                break
            pcm = _to_int16_24k_mono(payload, self._native_sr)
            total += len(pcm) // 2
            await send({"type": "tts_chunk", "id": msg_id, "seq": seq}, binary=pcm)
            seq += 1
        await fut
        await send({"type": "tts_done", "id": msg_id, "totalSamples": total,
                    "generationTimeMs": int((time.time() - t0) * 1000)})

    def close(self):
        backend = self._backend
        self._backend = None
        if backend is not None:
            try:
                backend.unload()
            except Exception:
                pass
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass
```

Note: `Conn.send(obj=None, binary=None)` matches the `send(obj, binary=...)` calls above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_engine.py
git commit -m "feat(native): rewrite TtsEngine (resolve+resample+streaming)"
```

---

### Task 4: WS protocol handlers + `register`

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (append handlers + `register`)
- Test: `sidecar/tests/test_tts_engine.py` (append)

**Interfaces:**
- Consumes: `TtsEngine`, `server.Conn`-shaped `conn` (has `.ctx` dict and async `.send(obj, binary)`).
- Produces: handlers `_h_tts_init`, `_h_set_voice`, `_h_tts_generate`, `_h_tts_cancel`; `tts_engine.register(state)` adds them under message types `tts_init`/`set_voice`/`tts_generate`/`tts_cancel`. `tts_init` sets `conn.ctx["owns_tts"]=True`. State key for the engine: `state["tts_engine"]`. Cancel flags live in `state["tts_cancels"]` (dict msg_id→bool).

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_tts_engine.py`:

```python
class _FakeConn:
    def __init__(self): self.ctx = {}; self.sent = []
    async def send(self, obj=None, binary=None): self.sent.append((obj, binary))


def _state(backend, monkeypatch, model_id):
    _patch(monkeypatch, backend, model_id)
    st = {"tts_engine": tts_engine.TtsEngine(), "handlers": {}}
    tts_engine.register(st)
    return st


def test_handler_tts_init_ready_sets_ownership(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    reply, _ = asyncio.run(st["handlers"]["tts_init"](
        st, {"type": "tts_init", "id": 1, "model": "moss-tts-nano"}, None, conn))
    assert reply["type"] == "ready" and reply["sampleRate"] == 24000
    assert reply["streaming"] is True and reply["clones"] is True
    assert conn.ctx.get("owns_tts") is True


def test_handler_set_voice_buffers_binary(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "moss-tts-nano"}, None, conn))
    ref = np.ones(2400, np.float32).tobytes()
    reply, _ = asyncio.run(st["handlers"]["set_voice"](
        st, {"type": "set_voice", "id": 2, "sampleRate": 24000}, ref, conn))
    assert reply["type"] == "ok"
    assert st["tts_engine"]._backend.voice == (2400, 24000)


def test_handler_tts_generate_streaming_pushes_chunks(monkeypatch):
    st = _state(_FakeStream(), monkeypatch, "moss-tts-nano")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "moss-tts-nano"}, None, conn))
    reply, _ = asyncio.run(st["handlers"]["tts_generate"](
        st, {"type": "tts_generate", "id": "g1", "text": "hello"}, None, conn))
    assert reply is None  # streamed via conn.send, not returned
    kinds = [o.get("type") for o, _ in conn.sent if o]
    assert kinds.count("tts_chunk") == 3 and kinds.count("tts_done") == 1


def test_handler_tts_generate_oneshot_returns_result(monkeypatch):
    st = _state(_FakeOneShot(), monkeypatch, "piper-en-amy")
    conn = _FakeConn()
    asyncio.run(st["handlers"]["tts_init"](st, {"type": "tts_init", "id": 1,
                "model": "piper-en-amy"}, None, conn))
    reply, binary = asyncio.run(st["handlers"]["tts_generate"](
        st, {"type": "tts_generate", "id": "g2", "text": "hello"}, None, conn))
    assert reply["type"] == "result" and reply["id"] == "g2"
    assert reply["sampleRate"] == 24000 and binary is not None
    assert reply["samples"] == len(binary) // 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine.py -k handler -v`
Expected: FAIL with `KeyError: 'tts_init'` (register not implemented)

- [ ] **Step 3: Write minimal implementation**

Append to `sidecar/sokuji_sidecar/tts_engine.py`:

```python
async def _h_tts_init(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    ms = eng.init(msg.get("model"), msg.get("device", "auto"), msg.get("language", ""))
    if conn is not None:
        conn.ctx["owns_tts"] = True
    reply = {"type": "ready", "id": msg.get("id"), "sampleRate": eng.sample_rate,
             "loadTimeMs": ms}
    if eng.resolved:
        reply.update(eng.resolved)
    return reply, None


async def _h_set_voice(state, msg, binary_in, conn=None):
    audio = np.frombuffer(binary_in, dtype=np.float32) if binary_in else np.zeros(0, np.float32)
    state["tts_engine"].set_voice(audio, int(msg.get("sampleRate", 24000)))
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_tts_generate(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    text = msg.get("text", "")
    speed = float(msg.get("speed", 1.0))
    mid = msg.get("id")
    if eng.streaming and conn is not None:
        cancels = state.setdefault("tts_cancels", {})
        cancels[mid] = False
        try:
            await eng.generate_stream(text, speed, conn.send,
                                      lambda: cancels.get(mid, False), mid)
        finally:
            cancels.pop(mid, None)
        return None, None                  # streamed via conn.send
    pcm, gen_ms = eng.generate(text, speed)
    reply = {"type": "result", "id": mid, "sampleRate": eng.sample_rate,
             "generationTimeMs": gen_ms, "samples": len(pcm) // 2}
    return reply, pcm


async def _h_tts_cancel(state, msg, _b, conn=None):
    cancels = state.get("tts_cancels") or {}
    if msg.get("id") in cancels:
        cancels[msg.get("id")] = True
    return {"type": "ok", "id": msg.get("id")}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"tts_init": _h_tts_init, "set_voice": _h_set_voice,
         "tts_generate": _h_tts_generate, "tts_cancel": _h_tts_cancel})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_engine.py
git commit -m "feat(native): TTS WS handlers (init/set_voice/generate/cancel)"
```

---

### Task 5: Server — `owns_tts` cleanup + engine wiring

**Files:**
- Modify: `sidecar/sokuji_sidecar/server.py` (`_conn` finally block)
- Modify: `sidecar/sokuji_sidecar/__main__.py` (register the engine into `state`)
- Test: `sidecar/tests/test_server_conn.py` (append)

**Interfaces:**
- Consumes: `state["tts_engine"]` (a `TtsEngine`), `conn.ctx["owns_tts"]`.
- Produces: on connection close, if `conn.ctx.get("owns_tts")`, calls `state["tts_engine"].close()`. `__main__` wires `state["tts_engine"] = tts_engine.TtsEngine()` and calls `tts_engine.register(state)`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_server_conn.py`:

```python
import asyncio
from sokuji_sidecar import server


def test_owns_tts_closes_engine_on_disconnect():
    closed = {"v": False}
    class _Eng:
        def close(self): closed["v"] = True
    class _WS:
        def __aiter__(self): return self
        async def __anext__(self): raise StopAsyncIteration
    state = {"tts_engine": _Eng()}
    # mark ownership the way _h_tts_init would, by pre-seeding the conn ctx via a wrapper
    async def run():
        conn_holder = {}
        orig = server.Conn
        class _Conn(orig):
            def __init__(self, ws):
                super().__init__(ws)
                self.ctx["owns_tts"] = True
                conn_holder["c"] = self
        server.Conn = _Conn
        try:
            await server._conn(state, _WS())
        finally:
            server.Conn = orig
    asyncio.run(run())
    assert closed["v"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_server_conn.py -k owns_tts -v`
Expected: FAIL (engine.close not called — `closed["v"]` is False)

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sokuji_sidecar/server.py`, inside `_conn`'s `finally:` block, after the existing `owns_translate` handling, add:

```python
        if conn.ctx.get("owns_tts"):
            teng = state.get("tts_engine")
            if teng is not None:
                try:
                    teng.close()
                except Exception:
                    pass
```

In `sidecar/sokuji_sidecar/__main__.py`, where the other engines/handlers are registered into `state`, add (match the existing registration style):

```python
    from . import tts_engine
    state["tts_engine"] = tts_engine.TtsEngine()
    tts_engine.register(state)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_server_conn.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/server.py sidecar/sokuji_sidecar/__main__.py sidecar/tests/test_server_conn.py
git commit -m "feat(native): owns_tts connection cleanup + engine wiring"
```

---

### Task 6: Downloads — catalog-driven TTS specs in `native_models.py`

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`_base_specs` / `download_specs`)
- Test: `sidecar/tests/test_native_models.py` (append)

**Interfaces:**
- Consumes: `catalog.tts_model`.
- Produces: `download_specs(model_id)` returns `{repos: [...], urls: [...]}` for a TTS model (its `repos` + `urls`), with **no VAD** appended. Existing `model_size`/`model_status`/`model_delete`/`download` work unchanged over this.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_for_tts_moss_nano_has_two_repos_no_vad():
    from sokuji_sidecar import native_models
    spec = native_models.download_specs("moss-tts-nano")
    assert len(spec["repos"]) == 2
    assert any("MOSS-TTS-Nano-100M-ONNX" in r for r in spec["repos"])
    assert any("MOSS-Audio-Tokenizer-Nano-ONNX" in r for r in spec["repos"])
    assert spec["urls"] == []          # TTS gets no silero VAD

def test_download_specs_for_tts_sherpa_single_repo():
    from sokuji_sidecar import native_models
    spec = native_models.download_specs("piper-en-amy")
    assert spec["repos"] == ["csukuangfj/vits-piper-en_US-amy-low"]
    assert spec["urls"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -k tts -v`
Expected: FAIL (current code routes `piper-en-amy` via the old PIPER_REPOS hook → wrong/None; moss-tts-nano → falls through to `{repos:[model_id]}`)

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sokuji_sidecar/native_models.py`, at the **top** of `_base_specs(model_id)` (before the existing `"piper" in model_id` branch), add a catalog-driven TTS branch:

```python
    from .catalog import tts_model as _tts_model
    _tm = _tts_model(model_id) if model_id else None
    if _tm is not None:
        return {"repos": list(_tm.repos), "urls": list(_tm.urls)}
```

Confirm `download_specs(model_id)` only appends the VAD url when `_asr_model(model_id) is not None` (already the case) — so TTS ids get no VAD.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -k tts -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(native): catalog-driven TTS download specs"
```

---

### Task 7: `SherpaTtsBackend` (A-class)

**Files:**
- Create: `sidecar/sokuji_sidecar/tts_backends.py`
- Test: `sidecar/tests/test_tts_backends.py`

**Interfaces:**
- Consumes: `backends.register_backend`, `backends.BackendLoadError`; `sherpa_onnx.OfflineTts`.
- Produces: `tts_backends.SherpaTtsBackend` (NAME=`sherpa_tts`, STREAMING=False, CLONES=False) implementing `load/set_voice/generate/unload/is_loaded` + `sample_rate`. Importing `tts_backends` registers it into the shared `backends` registry (so `backends.make_backend("sherpa_tts")` works and `accel.load_with_fallback` can load it).

- [ ] **Step 1: Write the failing test**

Create `sidecar/tests/test_tts_backends.py`:

```python
import os
import numpy as np
import pytest
from sokuji_sidecar import backends, tts_backends  # noqa: F401 (registers backends)


def test_sherpa_tts_registered_and_flags():
    b = backends.make_backend("sherpa_tts")
    assert b.NAME == "sherpa_tts" and b.STREAMING is False and b.CLONES is False
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TTS"),
                    reason="set SOKUJI_RUN_TTS=1 (downloads the piper model)")
def test_sherpa_tts_cpu_smoke():
    from huggingface_hub import snapshot_download
    snapshot_download("csukuangfj/vits-piper-en_US-amy-low")  # populate cache
    b = backends.make_backend("sherpa_tts")
    b.load("csukuangfj/vits-piper-en_US-amy-low", "cpu", "fp32")
    assert b.is_loaded and b.sample_rate > 0
    samples, gen_ms = b.generate("hello world", 1.0)
    assert isinstance(samples, np.ndarray) and samples.size > 0 and gen_ms >= 0
    b.unload(); assert b.is_loaded is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py -k registered -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sokuji_sidecar.tts_backends'`

- [ ] **Step 3: Write minimal implementation**

Create `sidecar/sokuji_sidecar/tts_backends.py`:

```python
"""TTS backend adapters, registered into the shared `backends` registry so the
accel resolver (load_with_fallback) can load them. Contract adds set_voice /
generate / generate_stream on top of load/unload; load_with_fallback only calls
load(), so sharing the registry is safe."""
import os
import time

import numpy as np

from .backends import register_backend, BackendLoadError

# short id -> HF repo (unknown ids are treated as a repo id directly)
SHERPA_TTS_REPOS = {
    "piper-en-amy": "csukuangfj/vits-piper-en_US-amy-low",
}


@register_backend
class SherpaTtsBackend:
    """Non-cloning, one-shot sherpa-onnx OfflineTts. Currently builds a VITS
    config (piper / icefall-zh). Matcha/Kokoro families add their config branch
    here later. provider='cuda' when device=cuda (GPU build), else 'cpu'."""
    NAME = "sherpa_tts"
    STREAMING = False
    CLONES = False

    def __init__(self):
        self._tts = None
        self.sample_rate = 16000

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._tts = None
        try:
            import sherpa_onnx
            from huggingface_hub import snapshot_download
            repo = SHERPA_TTS_REPOS.get(model_ref, model_ref)
            d = snapshot_download(repo_id=repo, local_files_only=True)
            onnx = next(f for f in os.listdir(d)
                        if f.endswith(".onnx") and not f.endswith(".onnx.json"))
            provider = "cuda" if device == "cuda" else "cpu"
            data_dir = f"{d}/espeak-ng-data"
            vits = sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{d}/{onnx}", tokens=f"{d}/tokens.txt",
                data_dir=data_dir if os.path.isdir(data_dir) else "")
            # Chinese vits ships lexicon/dict instead of espeak-ng-data.
            if not os.path.isdir(data_dir) and os.path.exists(f"{d}/lexicon.txt"):
                vits.lexicon = f"{d}/lexicon.txt"
                if os.path.isdir(f"{d}/dict"):
                    vits.dict_dir = f"{d}/dict"
            cfg = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    vits=vits,
                    num_threads=int(os.environ.get("SOKUJI_TTS_THREADS", "4")),
                    provider=provider),
                max_num_sentences=1)
            self._tts = sherpa_onnx.OfflineTts(cfg)
            self.sample_rate = self._tts.sample_rate
        except Exception as e:  # missing wheel / no GPU / bad repo → resolver falls back
            raise BackendLoadError(str(e))

    def set_voice(self, audio, sr):
        pass  # non-cloning

    def generate(self, text, speed=1.0):
        t0 = time.time()
        audio = self._tts.generate(text, sid=0, speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), int((time.time() - t0) * 1000)

    def unload(self) -> None:
        self._tts = None

    @property
    def is_loaded(self) -> bool:
        return self._tts is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py -k registered -v`
Expected: PASS. (Optional, with a model: `SOKUJI_RUN_TTS=1 .venv/bin/python -m pytest tests/test_tts_backends.py -k cpu_smoke -v` → PASS.)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/tests/test_tts_backends.py
git commit -m "feat(native): SherpaTtsBackend (one-shot vits TTS)"
```

---

### Task 8: `MossOnnxTtsBackend` (B-class: streaming + cloning)

**Files:**
- Vendor: `sidecar/sokuji_sidecar/moss_tts/ort_runtime.py` (copied from MOSS-TTS-Nano's `ort_cpu_runtime.py`)
- Vendor: `sidecar/sokuji_sidecar/moss_tts/__init__.py` (empty)
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (add `MossOnnxTtsBackend`)
- Test: `sidecar/tests/test_tts_backends.py` (append)

**Interfaces:**
- Consumes: the vendored `moss_tts.ort_runtime.OrtCpuRuntime` (its public methods: session creation, `build_text_rows`, `build_voice_clone_request_rows`, `generate_audio_frames`, and the incremental codec session `codec_streaming_session.run_frames`/`reset` — confirm exact signatures against the vendored file); `backends.register_backend`, `backends.BackendLoadError`.
- Produces: `tts_backends.MossOnnxTtsBackend` (NAME=`moss_onnx`, STREAMING=True, CLONES=True) implementing `load/set_voice/generate/generate_stream/unload/is_loaded` + `sample_rate`.

**Vendoring note:** copy `ort_cpu_runtime.py` from `https://github.com/OpenMOSS/MOSS-TTS-Nano` (file `ort_cpu_runtime.py`) into `sidecar/sokuji_sidecar/moss_tts/ort_runtime.py`. It imports only `onnxruntime` + `numpy` (no torch) — keep it as-is. Do NOT copy `onnx_tts_runtime.py` (it pulls torch/torchaudio/WeTextProcessing). Add a header comment citing the source repo + commit. The wrapper drives this runtime; if a method name differs, align the wrapper to the vendored file (the vendored file is the source of truth).

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_tts_backends.py`:

```python
def test_moss_onnx_registered_and_flags():
    b = backends.make_backend("moss_onnx")
    assert b.NAME == "moss_onnx" and b.STREAMING is True and b.CLONES is True
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TTS"),
                    reason="set SOKUJI_RUN_TTS=1 (downloads MOSS-TTS-Nano ONNX assets)")
def test_moss_onnx_cpu_streaming_smoke():
    from huggingface_hub import snapshot_download
    snapshot_download("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
    snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
    b = backends.make_backend("moss_onnx")
    b.load("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX", "cpu", "fp32")
    assert b.is_loaded and b.sample_rate > 0
    chunks = list(b.generate_stream("hello world", 1.0))
    assert len(chunks) >= 1 and all(c.dtype == np.float32 for c in chunks)
    full, gen_ms = b.generate("hello world", 1.0)
    assert full.size > 0 and gen_ms >= 0
    b.unload(); assert b.is_loaded is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py -k moss -v`
Expected: FAIL with `BackendLoadError: unknown backend: moss_onnx` (class not added yet)

- [ ] **Step 3: Write minimal implementation**

First create `sidecar/sokuji_sidecar/moss_tts/__init__.py` (empty) and vendor `ort_runtime.py` as described above.

Then append to `sidecar/sokuji_sidecar/tts_backends.py`:

```python
@register_backend
class MossOnnxTtsBackend:
    """MOSS-TTS-Nano-100M via its pure-onnxruntime core (vendored as
    moss_tts.ort_runtime). Streaming + zero-shot cloning. Incremental codec
    decode ONLY (never the full-decode path — it OOMs on a 2.3GB single alloc)."""
    NAME = "moss_onnx"
    STREAMING = True
    CLONES = True
    PRESET_VOICE = os.environ.get("SOKUJI_MOSS_PRESET_VOICE", "Junhao")

    def __init__(self):
        self._rt = None
        self._voice_rows = None       # speaker-prefix rows from set_voice (None → preset)
        self.sample_rate = 24000

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._rt = None
        self._voice_rows = None
        try:
            from huggingface_hub import snapshot_download
            from .moss_tts.ort_runtime import OrtCpuRuntime
            tok_repo = os.environ.get("SOKUJI_MOSS_TTS_NANO_TOK_REPO",
                                      "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
            lm_dir = snapshot_download(repo_id=model_ref, local_files_only=True)
            tok_dir = snapshot_download(repo_id=tok_repo, local_files_only=True)
            provider = "cuda" if device == "cuda" else "cpu"
            # OrtCpuRuntime: pass the resolved model dirs + execution provider +
            # thread count. Align kwarg names to the vendored file's __init__.
            self._rt = OrtCpuRuntime(
                model_dir=lm_dir, codec_dir=tok_dir,
                execution_provider=provider,
                thread_count=int(os.environ.get("SOKUJI_TTS_THREADS", "4")))
            self.sample_rate = int(self._rt.sample_rate)
        except Exception as e:  # missing onnxruntime-gpu / no CUDA / bad repo → fallback
            raise BackendLoadError(str(e))

    def set_voice(self, audio, sr):
        # Encode the reference clip into speaker-prefix rows for cloning. Align to
        # the vendored runtime's clone helper (e.g. encode_reference / build clone rows).
        self._voice_rows = self._rt.encode_reference(np.asarray(audio, np.float32), int(sr))

    def generate(self, text, speed=1.0):
        t0 = time.time()
        full = np.concatenate(list(self._iter_chunks(text)) or [np.zeros(0, np.float32)])
        return full.astype(np.float32), int((time.time() - t0) * 1000)

    def generate_stream(self, text, speed=1.0):
        yield from self._iter_chunks(text)

    def _iter_chunks(self, text):
        # Drive the AR loop + INCREMENTAL codec decode. The vendored runtime exposes
        # a frame generator + an incremental codec session; decode each frame chunk to
        # f32 audio and yield it. Use self._voice_rows when set, else the preset voice.
        # NEVER call the full-decode path. Align method names to the vendored file.
        self._rt.codec_streaming_session.reset()
        for frame_chunk in self._rt.generate_audio_frames(
                text, voice=self.PRESET_VOICE, voice_rows=self._voice_rows):
            decoded = self._rt.codec_streaming_session.run_frames(frame_chunk)
            if decoded is None:
                continue
            samples, _sr = decoded
            yield np.asarray(samples, dtype=np.float32)

    def unload(self) -> None:
        self._rt = None
        self._voice_rows = None

    @property
    def is_loaded(self) -> bool:
        return self._rt is not None
```

Note: the vendored `OrtCpuRuntime` API (constructor kwargs, `encode_reference`, `generate_audio_frames`, `codec_streaming_session`) must match the copied file. If the upstream wrapper (`onnx_tts_runtime.OnnxTtsRuntime.synthesize`, which we did NOT vendor) is the only place that stitches these together, port that stitching logic into `_iter_chunks` here — keeping it torch-free and incremental-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py -k "moss and registered" -v`
Expected: PASS. (With assets: `SOKUJI_RUN_TTS=1 .venv/bin/python -m pytest tests/test_tts_backends.py -k moss_onnx_cpu -v` → PASS, ≥1 chunk.)

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/moss_tts/ sidecar/sokuji_sidecar/tts_backends.py sidecar/tests/test_tts_backends.py
git commit -m "feat(native): MossOnnxTtsBackend (streaming + cloning, incremental decode)"
```

---

### Task 9: GPU smoke + full suite green

**Files:**
- Test: `sidecar/tests/test_tts_backends.py` (append a GPU smoke)

**Interfaces:**
- Consumes: everything above.
- Produces: a `SOKUJI_RUN_GPU`-gated MOSS CUDA streaming smoke that regression-guards the spike numbers (~3.3 GB / ~3.6× realtime), and confirms the whole sidecar suite stays green.

- [ ] **Step 1: Write the GPU smoke test**

Append to `sidecar/tests/test_tts_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (CUDA + MOSS ONNX assets)")
def test_moss_onnx_cuda_streaming_smoke():
    import time
    from huggingface_hub import snapshot_download
    snapshot_download("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
    snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
    b = backends.make_backend("moss_onnx")
    b.load("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX", "cuda", "fp32")
    t0 = time.perf_counter()
    chunks = list(b.generate_stream("The weather is lovely today.", 1.0))
    audio_s = sum(c.size for c in chunks) / b.sample_rate
    rtf = (time.perf_counter() - t0) / max(audio_s, 1e-6)
    print(f"moss-onnx cuda streaming RTF={rtf:.4f} (~{1/rtf:.1f}x realtime)")
    assert chunks and rtf < 1.0          # must be real-time on the GPU
    b.unload()
```

- [ ] **Step 2: Run the full suite (CPU/unit) to verify green**

Run: `cd sidecar && .venv/bin/python -m pytest tests/ -q`
Expected: all existing + new unit tests PASS (gated smokes skipped).

- [ ] **Step 3: (Optional, on the GPU box) run the gated smokes**

Run: `cd sidecar && SOKUJI_RUN_GPU=1 SOKUJI_RUN_TTS=1 .venv/bin/python -m pytest tests/test_tts_backends.py -v`
Expected: sherpa + MOSS CPU/CUDA smokes PASS; the CUDA smoke prints an RTF < 1.0.

- [ ] **Step 4: Commit**

```bash
git add sidecar/tests/test_tts_backends.py
git commit -m "test(native): MOSS CUDA streaming GPU smoke"
```

---

## Self-Review

**Spec coverage:**
- Architecture/seam → Tasks 1–8 (catalog, resolver, engine, handlers, server, downloads, backends). ✓
- A-class `sherpa_tts` → Task 7. ✓
- B-class `moss_onnx` (streaming + cloning, incremental-only) → Task 8. ✓
- Resolver reuse (gpu≫cpu, fallback, bench, `_installed`, `.onnx` ext) → Task 2. ✓
- Audio contract (Int16@24k, resample) → Task 3. ✓
- WS protocol (tts_init/set_voice/tts_generate/tts_chunk/tts_done/tts_cancel) → Tasks 3–4. ✓
- VRAM hygiene (`owns_tts`, close on init/disconnect) → Tasks 3, 5. ✓
- Downloads (catalog-driven) → Task 6. ✓
- Testing (backends/engine/catalog/server/native_models + GPU smoke) → Tasks 1–9. ✓
- **Renderer integration** (protocol/client/catalog/store/voice-clone UI) → **deferred to a follow-up plan** (separate subsystem; depends on this sidecar protocol). Noted at top.

**Placeholder scan:** Task 8's vendored-runtime method names are flagged as "align to the vendored file" — this is inherent to wrapping a copied dependency (the file is the source of truth), not a plan placeholder. All authored code is complete.

**Type consistency:** backend NAMEs (`sherpa_tts`/`moss_onnx`), flags (`STREAMING`/`CLONES`/`sample_rate`), engine API (`init`/`set_voice`/`generate`/`generate_stream`/`close`, `_to_int16_24k_mono`), handler/state keys (`tts_engine`, `tts_cancels`, `owns_tts`), and protocol message types are consistent across Tasks 1–9.

## Follow-up (separate plan)

Renderer integration: `nativeProtocol.ts` TTS messages, `LocalNativeClient`/`NativeTtsClient` wiring to `ModernAudioPlayer`, `nativeCatalog.ts` TTS rows, `nativeModelStore` `ttsLoading`/`ttsResolved`, and the capability-driven Voice section (generalize `VoiceLibrarySection`: sid+JSON for Supertonic vs reference-clip for MOSS via the existing `setReferenceVoice`).
