# Native ASR Phase 1 — GPU Proof (CTranslate2-CUDA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Whisper auto-run on the user's NVIDIA GPU through the existing resolver, measure and surface the GPU speedup (RTF), and demote a GPU plan that benchmarks slower than the CPU floor — proven end-to-end on the dev box's RTX 4070.

**Architecture:** Phase 0 already detects the 4070 (`probe()`), ranks `gpu-cuda` above `cpu` with fallback (`resolve`/`load_with_fallback`), and `CTranslate2Backend` already passes `device`/`compute_type` straight to `WhisperModel`. So Phase 1 is mostly catalog data (add `gpu-cuda` deployments to the Whisper rows) plus a lean benchmark/RTF cache in `accel.py` (measure the chosen plan once on first load, cache by hardware fingerprint, surface RTF on `ready`, and feed it back to demote a proven-slow GPU plan).

**Tech Stack:** Python 3.10, `faster-whisper`/`ctranslate2` (CUDA-capable — verified: ct2 4.8.0, `get_cuda_device_count()=1`, system cuDNN 9, `WhisperModel(device='cuda', compute_type='float16')` loads+transcribes), `numpy`, pytest. Sidecar package `sokuji_sidecar` under `sidecar/`.

## Global Constraints

- **The GPU path already works on the dev box — no install.** RTX 4070 SUPER, ct2 4.8.0 sees it, system cuDNN 9 present. The env-gated real tests run with `SOKUJI_RUN_GPU=1`.
- **Benchmark is lean and best-effort:** measure ONLY the resolved plan, ONE-TIME per `(fingerprint, model_id, backend, device, compute_type)` (cached), never raises (a failure just omits RTF), and runs in `init()` BEFORE streaming is wired (no concurrency with the live stream). Clip length `BENCH_SECONDS = 3.0`.
- **Bench cache path:** `~/.cache/sokuji-sidecar/accel-bench.json`, overridable via `SOKUJI_BENCH_DIR` (tests point it at a tmp dir).
- **CPU floor stays unconditional.** GPU tiers are added only to Whisper (CTranslate2). `sense-voice` (sherpa) stays CPU-only — no GPU path (Phase-0 finding).
- **Backend/tier/device strings unchanged:** tier `"gpu-cuda"` → device `"cuda"`, `compute_type="float16"` for the GPU Whisper deployments.
- **Run tests with** `.venv/bin/python -m pytest <paths> -q` from `sidecar/`. Baseline before this plan: 20 passed + env-gated skips.
- **Out of scope:** the NVIDIA backend-pack distribution/signing (separate packaging spec) and the renderer device-override UI + perf badge (a subsequent renderer increment). `ready` carries `rtf`; consuming it in the UI is the renderer increment.
- **Commit messages:** Conventional Commits. No hand-written trailers.

---

## File Structure

**Modify:**
- `sidecar/sokuji_sidecar/catalog.py` — add a `gpu-cuda` deployment (`float16`) to each of the four Whisper rows (sense-voice unchanged).
- `sidecar/sokuji_sidecar/accel.py` — bench cache (`_bench_cache_path`, `bench_load`, `bench_save`, `_bench_key`), `measure_rtf`, `_apply_bench` (demotion), and thread the cache into `resolve`/`resolve_deployments`.
- `sidecar/sokuji_sidecar/asr_engine.py` — `AsrEngine.init()` runs `measure_rtf` after load and adds `rtf` to `self.resolved`.
- `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py` — pure tests + env-gated real-GPU tests.
- `sidecar/tests/test_asr_engine.py` — the `rtf`-in-ready path.

---

## Task 1: GPU-cuda catalog rows for Whisper

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py`
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: each Whisper `AsrModel` now has two deployments — `Deployment("ctranslate2", "gpu-cuda", "float16", <size>, 1.0)` then `Deployment("ctranslate2", "cpu", "int8", <size>, 1.0)`. `sense-voice` unchanged (sherpa cpu-int8 only). The resolver (unchanged) ranks `gpu-cuda` (3.0) above `cpu` (1.0), so on an NVIDIA machine `resolve("whisper-*")` returns `[cuda, cpu]`; on a CPU-only machine `gpu-cuda` is filtered out → `[cpu]`.

- [ ] **Step 1: Write the failing test** (append to `test_accel.py`)

```python
def test_whisper_resolves_gpu_first_on_nvidia():
    m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288),))
    plans = accel.resolve("whisper-tiny", machine=m)
    assert [p.device for p in plans] == ["cuda", "cpu"]
    assert plans[0].compute_type == "float16" and plans[1].compute_type == "int8"


def test_whisper_cpu_only_machine_drops_gpu():
    plans = accel.resolve("whisper-tiny", machine=_machine())  # no nvidia
    assert [p.device for p in plans] == ["cpu"]


def test_whisper_cpu_override_pins_cpu_on_nvidia():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))
    plans = accel.resolve("whisper-tiny", override="cpu", machine=m)
    assert plans[0].device == "cpu"


def test_sense_voice_has_no_gpu_deployment():
    plans = accel.resolve("sense-voice", machine=_machine(nvidia=(accel.Gpu("nvidia", "x", 0),)))
    assert [p.device for p in plans] == ["cpu"]  # sherpa stays CPU-only even with a GPU
```

(`_machine` and `accel`/`catalog` are already imported at the top of `test_accel.py` from Phase 0. `resolve` consults the bench cache; with no cache file these tests behave as pure static ranking. To be safe against a stale real cache, set `SOKUJI_BENCH_DIR` to an empty tmp dir for the whole test module — add at the top of `test_accel.py` if not present: `import tempfile, os` and in a module-level `os.environ.setdefault("SOKUJI_BENCH_DIR", tempfile.mkdtemp())`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k "whisper_resolves_gpu or cpu_only_machine_drops or override_pins_cpu_on_nvidia or sense_voice_has_no_gpu" -q`
Expected: FAIL — `whisper-tiny` currently resolves to `["cpu"]` only (no gpu-cuda deployment yet).

- [ ] **Step 3: Add the GPU deployments** (`catalog.py`)

Replace the four Whisper rows in `ASR_MODELS` so each has a `gpu-cuda` (float16) deployment first, then the `cpu` (int8) floor:

```python
    AsrModel("whisper-large-v3", "Whisper large-v3", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "large-v3", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "large-v3", 1.0)), sort_order=1),
    AsrModel("whisper-base", "Whisper base", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "base", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "base", 1.0)),
             recommended=True, sort_order=2),
    AsrModel("whisper-small", "Whisper small", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "small", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "small", 1.0)), sort_order=3),
    AsrModel("whisper-tiny", "Whisper tiny", ("multi",),
             (Deployment("ctranslate2", "gpu-cuda", "float16", "tiny", 1.0),
              Deployment("ctranslate2", "cpu", "int8", "tiny", 1.0)), sort_order=4),
```

Also update the module docstring line 3 from `Phase 0 ships CPU deployments only; GPU tiers are added in Phase 1.` to `Whisper rows carry a gpu-cuda (float16) deployment + a cpu (int8) floor; sherpa models are CPU-only.`

- [ ] **Step 4: Run the new tests + the existing catalog/accel suites**

Run: `.venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -q`
Expected: PASS — the four new tests pass; existing catalog invariants hold (`test_every_model_has_a_cpu_deployment_and_languages` still passes because each Whisper row still has a cpu deployment; `test_sense_voice_uses_sherpa_whisper_uses_ctranslate2` still passes because `whisper-tiny.deployments[0].backend == "ctranslate2"`).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): gpu-cuda deployments for Whisper (resolver auto-selects CUDA)"
```

---

## Task 2: Benchmark cache (path + load/save + key)

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: `_bench_cache_path() -> str` (`<SOKUJI_BENCH_DIR or ~/.cache/sokuji-sidecar>/accel-bench.json`); `bench_load() -> dict` (best-effort, `{}` on any error); `bench_save(cache: dict) -> None` (best-effort, makedirs + atomic-ish write); `_bench_key(fingerprint, model_id, backend, device, compute_type) -> str` (the `"|"`-joined cache key).

- [ ] **Step 1: Write the failing test** (append to `test_accel.py`)

```python
def test_bench_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    assert accel.bench_load() == {}  # nothing yet
    key = accel._bench_key("fp123", "whisper-tiny", "ctranslate2", "cuda", "float16")
    accel.bench_save({key: 0.12})
    assert accel.bench_load()[key] == 0.12


def test_bench_load_is_best_effort_on_corrupt(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    (tmp_path / "accel-bench.json").write_text("{ not json")
    assert accel.bench_load() == {}  # corrupt file → empty, no raise


def test_bench_key_is_stable_and_distinct():
    a = accel._bench_key("fp", "m", "ctranslate2", "cuda", "float16")
    b = accel._bench_key("fp", "m", "ctranslate2", "cpu", "int8")
    assert a != b and a == accel._bench_key("fp", "m", "ctranslate2", "cuda", "float16")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k bench_cache_roundtrip -q`
Expected: FAIL — `module 'sokuji_sidecar.accel' has no attribute 'bench_load'`.

- [ ] **Step 3: Write the cache helpers** (`accel.py`)

Add `import json` and `import time` to the top imports, then append (after `load_with_fallback`, before the handlers):

```python
def _bench_cache_path() -> str:
    base = os.environ.get("SOKUJI_BENCH_DIR", os.path.expanduser("~/.cache/sokuji-sidecar"))
    return os.path.join(base, "accel-bench.json")


def bench_load() -> dict:
    """Best-effort read of the RTF cache. Missing/corrupt file → {}."""
    try:
        with open(_bench_cache_path()) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def bench_save(cache: dict) -> None:
    """Best-effort write of the RTF cache. Never raises."""
    try:
        path = _bench_cache_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass


def _bench_key(fingerprint: str, model_id: str, backend: str, device: str, compute_type: str) -> str:
    return f"{fingerprint}|{model_id}|{backend}|{device}|{compute_type}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k bench -q`
Expected: PASS (3 bench tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): RTF benchmark cache (load/save/key, best-effort)"
```

---

## Task 3: measure_rtf + GPU demotion, threaded into resolve

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `bench_load`/`bench_save`/`_bench_key` (Task 2); `Plan`, `Machine`, `TIER_DEVICE`, `resolve_deployments`, `resolve` (Phase 0).
- Produces: `BENCH_SECONDS = 3.0`; `measure_rtf(backend, plan, model_id, machine, *, force=False) -> float | None` (best-effort; one-time per key unless `force`; runs a 3 s synthetic clip through `backend.transcribe`, caches RTF); `_apply_bench(plans, bench) -> list[Plan]` (demote a non-cpu plan whose cached RTF ≥ the cpu floor's cached RTF); `resolve_deployments` gains optional `bench=None`; `resolve` builds the per-model `bench` dict from the cache and passes it.

- [ ] **Step 1: Write the failing test** (append to `test_accel.py`)

```python
def test_measure_rtf_runs_and_caches(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))

    class _FakeBackend:
        def transcribe(self, samples, language):
            from sokuji_sidecar.backends import AsrResult
            return AsrResult("")  # near-instant → small rtf

    m = _machine()
    plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    rtf = accel.measure_rtf(_FakeBackend(), plan, "whisper-tiny", m)
    assert rtf is not None and rtf >= 0.0
    # cached: a second call returns the same value without re-running
    cache = accel.bench_load()
    assert accel._bench_key(m.fingerprint, "whisper-tiny", "ctranslate2", "cpu", "int8") in cache


def test_apply_bench_demotes_slow_gpu():
    cpu = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    gpu = accel.Plan("ctranslate2", "gpu-cuda", "cuda", "float16", "tiny", 1.0)
    # gpu measured SLOWER than cpu → demote gpu below cpu
    bench = {("ctranslate2", "cuda", "float16"): 0.9, ("ctranslate2", "cpu", "int8"): 0.4}
    assert [p.device for p in accel._apply_bench([gpu, cpu], bench)] == ["cpu", "cuda"]
    # gpu measured FASTER → keep gpu first
    bench2 = {("ctranslate2", "cuda", "float16"): 0.1, ("ctranslate2", "cpu", "int8"): 0.4}
    assert [p.device for p in accel._apply_bench([gpu, cpu], bench2)] == ["cuda", "cpu"]


def test_resolve_demotes_gpu_when_cache_says_slower(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))
    accel.probe(force=True)
    # seed the cache: gpu slower than cpu for whisper-tiny on THIS machine's fingerprint
    fp = accel.probe().fingerprint
    accel.bench_save({
        accel._bench_key(fp, "whisper-tiny", "ctranslate2", "cuda", "float16"): 0.8,
        accel._bench_key(fp, "whisper-tiny", "ctranslate2", "cpu", "int8"): 0.3,
    })
    plans = accel.resolve("whisper-tiny", machine=m)
    assert plans[0].device == "cpu"  # demoted: cpu now leads
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k "measure_rtf or apply_bench or demotes_gpu" -q`
Expected: FAIL — `accel` has no `measure_rtf` / `_apply_bench`.

- [ ] **Step 3: Write the implementation** (`accel.py`)

Add `import numpy as np` to the top imports. Append the benchmark + demotion functions (after `_bench_key`):

```python
BENCH_SECONDS = 3.0


def measure_rtf(backend, plan, model_id: str, machine: Machine, *, force: bool = False):
    """Best-effort: run a fixed synthetic clip through backend.transcribe, return
    RTF (elapsed / audio_seconds), cache by (fingerprint, model, backend, device,
    compute_type). One-time per key unless force. Never raises (returns None)."""
    try:
        key = _bench_key(machine.fingerprint, model_id, plan.backend, plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        sr = 16000
        n = int(BENCH_SECONDS * sr)
        t = np.arange(n, dtype=np.float32) / sr
        clip = (0.05 * np.sin(2.0 * np.pi * 220.0 * t)).astype(np.float32)
        t0 = time.time()
        backend.transcribe(clip, None)
        rtf = (time.time() - t0) / BENCH_SECONDS
        cache[key] = rtf
        bench_save(cache)
        return rtf
    except Exception:
        return None


def _apply_bench(plans: list, bench: dict) -> list:
    """Demote any non-cpu plan whose cached RTF is >= the cpu floor's cached RTF
    (proven not faster than CPU). `bench` maps (backend, device, compute_type) -> rtf."""
    if not bench:
        return plans
    cpu = next((p for p in plans if p.tier == "cpu"), None)
    cpu_rtf = bench.get((cpu.backend, cpu.device, cpu.compute_type)) if cpu else None
    if cpu_rtf is None:
        return plans
    fast, slow = [], []
    for p in plans:
        rtf = bench.get((p.backend, p.device, p.compute_type))
        (slow if (p.tier != "cpu" and rtf is not None and rtf >= cpu_rtf) else fast).append(p)
    return fast + slow
```

Change `resolve_deployments` to accept and apply `bench` (add the parameter and the final demotion):

```python
def resolve_deployments(model, machine: Machine, override: str = "auto", bench: dict | None = None) -> list[Plan]:
    """Ordered Plans for `model` on `machine`: filter to runnable, rank by tier
    (GPU/NPU >> CPU), then a non-'auto' override pins its tier to the front, then
    the bench cache demotes a proven-slow GPU plan. CPU floor always survives."""
    usable = [d for d in model.deployments
              if d.backend in machine.installed and _tier_available(d.tier, machine)]
    usable.sort(key=lambda d: (TIER_RANK.get(d.tier, 0.0), d.rank), reverse=True)
    if override != "auto":
        pinned = [d for d in usable if TIER_DEVICE.get(d.tier) == override]
        rest = [d for d in usable if TIER_DEVICE.get(d.tier) != override]
        usable = pinned + rest
    plans = [Plan(d.backend, d.tier, TIER_DEVICE[d.tier], d.compute_type, d.artifact, d.rank)
             for d in usable]
    return _apply_bench(plans, bench) if bench else plans
```

Change `resolve` to build the per-model bench dict from the cache and pass it (note: an explicit `override` still pins to the front *before* demotion, so a forced device is honored even against the cache):

```python
def resolve(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    m = machine or probe()
    cache = bench_load()
    bench = {}
    for d in model.deployments:
        device = TIER_DEVICE[d.tier]
        key = _bench_key(m.fingerprint, model_id, d.backend, device, d.compute_type)
        if key in cache:
            bench[(d.backend, device, d.compute_type)] = cache[key]
    plans = resolve_deployments(model, m, override, bench=bench or None)
    if not plans:
        raise NoUsablePlan(model_id)
    return plans
```

- [ ] **Step 4: Run the new tests + the full accel suite**

Run: `.venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS — the three new tests pass; all existing resolver/fallback/handler tests still pass (the `bench=None` default keeps Phase-0 behavior; `_h_models_catalog` calls `resolve_deployments` without `bench`, so its output is unchanged).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): measure_rtf + cache-driven demotion of proven-slow GPU plans"
```

---

## Task 4: AsrEngine benchmarks on init and reports RTF

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py`
- Test: `sidecar/tests/test_asr_engine.py`

**Interfaces:**
- Consumes: `accel.measure_rtf`, `accel.probe` (Task 3), `accel.resolve`/`accel.load_with_fallback` (Phase 0).
- Produces: `AsrEngine.init()` runs `measure_rtf` on the resolved backend/plan (best-effort, before streaming) and, when it returns a value, adds `rtf` (rounded to 3 dp) to `self.resolved`. The `ready` reply (which already merges `self.resolved`) therefore carries `rtf` when measured.

- [ ] **Step 1: Write the failing test** (append to `test_asr_engine.py`)

```python
def test_engine_init_measures_and_stores_rtf(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "gpu-cuda", "cuda", "float16", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (_FakeBackend(), fake_plan, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: 0.25)
    eng.init(model_id="whisper-tiny", language="en", device="auto")
    assert eng.resolved["device"] == "cuda"
    assert eng.resolved["rtf"] == 0.25


def test_engine_init_omits_rtf_when_benchmark_returns_none(monkeypatch):
    from sokuji_sidecar import asr_engine as ae, accel
    eng = ae.AsrEngine()
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    fake_plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    monkeypatch.setattr(accel, "resolve", lambda model_id, override="auto": [fake_plan])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (_FakeBackend(), fake_plan, None))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)  # benchmark failed
    eng.init(model_id="whisper-tiny", device="auto")
    assert "rtf" not in eng.resolved
```

(`_FakeBackend` is the class already defined in `test_asr_engine.py` from Phase 0 Task 8 — it has a `transcribe` returning an `AsrResult`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_asr_engine.py -k "measures_and_stores_rtf" -q`
Expected: FAIL — `eng.resolved` has no `rtf` key.

- [ ] **Step 3: Write the implementation** (`asr_engine.py`)

In `AsrEngine.init()`, after `self._backend, plan, _notice = accel.load_with_fallback(plans)` and after setting `self._language`, add the benchmark call and extend `self.resolved`:

```python
        self._language = language or None
        rtf = accel.measure_rtf(self._backend, plan, model_id or "sense-voice", accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        return int((time.time() - t0) * 1000)
```

- [ ] **Step 4: Run the new tests + the full asr suite**

Run: `.venv/bin/python -m pytest tests/test_asr_engine.py -q`
Expected: PASS — the two new tests pass; `test_ready_includes_resolved_plan_when_present` and `test_ready_unchanged_when_engine_has_no_resolved` still pass (FakeAsr has no `resolved`, so `ready` stays minimal; the `_ResolvedAsr` fake sets `resolved` without `rtf`, so its `ready` carries backend/device/computeType and no `rtf` — unaffected).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): benchmark resolved plan on init, report rtf on ready"
```

---

## Task 5: GPU-proof on the real 4070 + full verification

**Files:**
- Modify: `sidecar/tests/test_accel.py` (env-gated real-GPU tests)

**Interfaces:**
- Consumes: everything above + the real CUDA runtime.

- [ ] **Step 1: Write the env-gated real-GPU tests** (append to `test_accel.py`)

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (needs NVIDIA GPU + CUDA-enabled ctranslate2)")
def test_real_gpu_resolves_and_loads_cuda(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))  # don't touch the user cache
    accel.probe(force=True)
    plans = accel.resolve("whisper-tiny")
    assert plans[0].device == "cuda", f"expected cuda first, got {[p.device for p in plans]}"
    backend, plan, _notice = accel.load_with_fallback(plans)
    try:
        assert plan.device == "cuda"
        rtf = accel.measure_rtf(backend, plan, "whisper-tiny", accel.probe(), force=True)
        assert rtf is not None and rtf < 1.0, f"GPU should be faster than realtime, rtf={rtf}"
    finally:
        backend.unload()


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (needs NVIDIA GPU + CUDA-enabled ctranslate2)")
def test_real_gpu_cpu_override_forces_cpu(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    accel.probe(force=True)
    plans = accel.resolve("whisper-tiny", override="cpu")
    assert plans[0].device == "cpu"
    backend, plan, _notice = accel.load_with_fallback(plans)
    try:
        assert plan.device == "cpu"
    finally:
        backend.unload()
```

- [ ] **Step 2: Run the full pure suite (no GPU env) to confirm green + skips**

Run: `.venv/bin/python -m pytest -q`
Expected: all pure tests pass; the two new GPU tests show as skipped (no `SOKUJI_RUN_GPU`). No failures.

- [ ] **Step 3: Run the real-GPU proof on the 4070**

Run: `SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_accel.py -k "real_gpu" -q`
Expected: PASS — `resolve("whisper-tiny")` returns cuda-first, the backend loads on `device=='cuda'`, the benchmark RTF is < 1.0 (the 4070 is faster than real-time), and the CPU override forces `device=='cpu'`. This is the Phase-1 GPU proof.

- [ ] **Step 4: Run the prior real-model smokes (confirm CPU path still works end-to-end)**

Run: `SOKUJI_RUN_ASR_MODEL=1 SOKUJI_RUN_FW_MODEL=1 .venv/bin/python -m pytest tests/test_asr_engine.py -k "real" -q`
Expected: PASS — SenseVoice (sherpa CPU) and faster-whisper still transcribe through the resolver (no regression from the GPU rows; sense-voice has no GPU deployment, faster-whisper picks cpu when `SOKUJI_RUN_GPU` is unset because... NOTE: on a GPU box `init()` with no override now resolves whisper to CUDA. The `test_real_faster_whisper_transcribes` test calls `eng.init(model_id="whisper-tiny")` — on the dev box this will now load on **cuda**, which is fine: it still transcribes "gold"/"tribal". If you want to force CPU for that legacy test, it still passes on GPU too.)

- [ ] **Step 5: Commit**

```bash
git add sidecar/tests/test_accel.py
git commit -m "test(sidecar): env-gated GPU proof (whisper auto-cuda on 4070, cpu override)"
```

---

## Self-Review

**Spec coverage** (Phase 1 entry + §3c benchmark + §4 catalog):
- GPU-capable Whisper catalog rows → Task 1. Resolver auto-selects CUDA (Phase-0 ranking, unchanged) → proven in Task 1 (fake nvidia) + Task 5 (real 4070).
- Benchmark/RTF cache: measure chosen plan once, cache by fingerprint, best-effort, never on the streaming hot path → Tasks 2-4. Demote a GPU plan slower than the CPU floor → Task 3.
- Surface RTF on `ready` → Task 4.
- GPU proof end-to-end → Task 5.
- **Deferred (noted, out of scope):** the NVIDIA backend-pack distribution/signing (separate packaging spec); the renderer device-override UI + perf badge that *consumes* `ready.rtf` (subsequent renderer increment). The `device` override is already plumbed sidecar-side (Phase 0); the renderer increment adds the control.

**Placeholder scan:** none — every step has complete code + exact commands. The one inline note in Task 5 step 4 explains a real behavior (whisper now loads on cuda on a GPU box) rather than leaving a gap.

**Type consistency:** `measure_rtf(backend, plan, model_id, machine, *, force=False)` is defined in Task 3 and called identically in Task 4 (`accel.measure_rtf(self._backend, plan, model_id or "sense-voice", accel.probe())`) and Task 5. `_bench_key(fingerprint, model_id, backend, device, compute_type)` has one signature used in Tasks 2/3/5. `_apply_bench(plans, bench)` with `bench` keyed by `(backend, device, compute_type)` matches what `resolve` builds. `resolve_deployments` gains `bench=None` (Phase-0 callers unaffected). `self.resolved["rtf"]` (Task 4) flows through the Phase-0 `ready` merge.

## Notes / decisions

- **Benchmark runs inline in `init()` before streaming** (not in a background thread): the live backend isn't thread-safe for a concurrent benchmark transcribe, and `init()` is already a blocking load step in this sidecar. Cost is a one-time ≤`3s × RTF` added to the *first* init per `(machine, model, plan)`; cached thereafter. On the 4070 that's ~0.2 s; the only slow case is a large Whisper on a CPU-only box (a non-recommended pairing), one-time. This avoids the concurrency hazard of benchmarking a streaming backend and keeps `rtf` available synchronously on `ready`.
- **Demotion only fires from a populated cache** — the very first resolve has no RTF data and uses static tier ranking (GPU first). After the first benchmark, a proven-slow GPU plan is demoted on subsequent resolves. This matches §3c ("demote next time").
- **`SOKUJI_BENCH_DIR`** lets tests isolate the cache; production uses `~/.cache/sokuji-sidecar/accel-bench.json`.
