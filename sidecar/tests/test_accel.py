import asyncio
import json
import os
import tempfile

import numpy as np
import pytest
from sokuji_sidecar import accel
from sokuji_sidecar import catalog
from sokuji_sidecar import backends
from sokuji_sidecar import server

os.environ.setdefault("SOKUJI_BENCH_DIR", tempfile.mkdtemp())


def test_probe_assembles_machine(monkeypatch):
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu", "vulkan"))
    monkeypatch.setattr(accel, "_native_gpus",
                        lambda: (("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_translate", "native_tts"}))
    m = accel.probe(force=True)
    assert m.gpus == (("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),)
    assert "native_tts" in m.installed
    assert m.fingerprint  # non-empty, stable hash


def test_probe_degrades_when_detector_throws(monkeypatch):
    def boom(): raise RuntimeError("probe broken")
    monkeypatch.setattr(accel, "_native_gpus", boom)
    monkeypatch.setattr(accel, "_native_kinds", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    m = accel.probe(force=True)
    assert m.gpus == ()  # broken GPU detection → treated as absent, no crash


def test_probe_is_cached(monkeypatch):
    monkeypatch.setattr(accel, "_native_gpus", lambda: ())
    monkeypatch.setattr(accel, "_native_kinds", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    first = accel.probe(force=True)
    monkeypatch.setattr(accel, "_native_gpus",
                        lambda: (("vulkan", "NVIDIA x", 1 << 30),))
    assert accel.probe() is first  # cached: no re-probe without force


def _machine(*, apple=False, installed=frozenset({"native_asr", "native_asr_stream"}), tc=(), gpus=()):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                         apple_silicon=apple, installed=installed,
                         fingerprint="test", tc_kinds=tc, gpus=gpus)


def _nv_gpus(vram_mb=0):
    """tc-probe-shaped NVIDIA device identity: (kind, description, mem_total).
    vram_mb=0 models a probe that saw the device but no memory figure."""
    return (("vulkan", "NVIDIA GeForce RTX 4070", vram_mb << 20),)


# has_nvidia/_dml_adapters died with the ONNX TTS backends (their last
# consumers, slice 4 — R4): the gpu-cuda tier's NVIDIA-presence gate and the
# gpu-dml tier's adapter probe are both gone, so test_has_nvidia_* and
# test_native_gpus_coerces_none_description (which existed solely to prove
# has_nvidia never crashes on a None description) have no equivalent.
# _gpu_vendor (still used by _h_hardware_info) has its own None-description
# coverage in test_hardware_info_reports_amd_gpu_from_tc_probe below.


def test_resolve_real_catalog_sense_voice_cpu(monkeypatch):
    monkeypatch.setattr(accel, "_native_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_asr"}))
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu",))   # no accelerator
    accel.probe(force=True)
    plans = accel.resolve("sense-voice")
    assert plans[0].backend == "native_asr" and plans[0].device == "cpu"


def _plan(device):
    return accel.Plan("ctranslate2", "cpu" if device == "cpu" else "gpu-cuda",
                      device, "int8", "large-v3", 1.0)


def test_fallback_steps_to_cpu_and_sets_notice(monkeypatch):
    class FakeBackend:
        def __init__(self, ok): self.ok = ok; self.loaded = False
        def load(self, a, device, ct, config=None):
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
        def load(self, a, device, ct, config=None): self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([_plan("cpu")])
    assert plan.device == "cpu" and notice is None


def test_fallback_all_fail_raises(monkeypatch):
    class FakeBackend:
        def load(self, a, device, ct, config=None): raise backends.BackendLoadError("nope")
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    import pytest
    with pytest.raises(accel.AllPlansFailed):
        accel.load_with_fallback([_plan("cuda"), _plan("cpu")])


_GIB = 1 << 30


def test_vram_gate_skips_cuda_to_cpu_when_insufficient(monkeypatch):
    # A flexible model (cuda + cpu floor) whose weights can't fit free VRAM is
    # routed straight to CPU — the cuda plan is never even attempted (no OOM).
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 2 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 5 * _GIB)
    attempted = []
    class FakeBackend:
        def load(self, a, device, ct, config=None): attempted.append(device); self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cpu" and attempted == ["cpu"]
    assert notice and "CPU" in notice


def test_vram_gate_allows_cuda_when_sufficient(monkeypatch):
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 10 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 4 * _GIB)
    class FakeBackend:
        def load(self, a, device, ct, config=None): self.device = device; self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cuda" and notice is None


def test_vram_gate_inert_without_estimates(monkeypatch):
    # No CUDA / unknown footprint → gate stays out of the way; the existing
    # try/except path still steps cuda → cpu on a real OOM.
    monkeypatch.setattr(accel, "device_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: None)
    class FakeBackend:
        def __init__(self, ok): self.ok = ok
        def load(self, a, device, ct, config=None):
            if not self.ok: raise backends.BackendLoadError("CUDA out of memory")
            self.loaded = True
    seq = iter([FakeBackend(False), FakeBackend(True)])
    monkeypatch.setattr(accel, "make_backend", lambda name: next(seq))
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cpu"


def test_vram_gate_reads_vendor_agnostic_free(monkeypatch):
    # The proactive gate must read device_free_bytes (tc probe), never NVML.
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 2 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 5 * _GIB)
    attempted = []
    class FakeBackend:
        def load(self, a, device, ct, config=None): attempted.append(device); self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    _b, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cpu" and attempted == ["cpu"]
    assert notice and "CPU" in notice


def test_gpu_only_oom_raises_honest_vram_message(monkeypatch):
    # A GPU-only model (no cpu plan) that OOMs must NOT claim it is "falling
    # back" — there is nowhere to fall back to. Surface an honest VRAM message.
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 1 * _GIB)
    class FakeBackend:
        def load(self, a, device, ct, config=None):
            raise backends.BackendLoadError("CUDA out of memory. Tried to allocate 54.00 MiB")
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    import pytest
    with pytest.raises(accel.AllPlansFailed) as ei:
        accel.load_with_fallback([_plan("cuda")])
    msg = str(ei.value)
    assert "GPU memory" in msg and "falling back" not in msg


def test_load_measured_reports_vram_delta_for_cuda(monkeypatch):
    free = iter([10 * _GIB, 2 * _GIB])  # before, after -> 8 GiB used
    monkeypatch.setattr(accel, "device_free_bytes", lambda: next(free))
    monkeypatch.setattr(accel, "_rss_bytes", lambda: 1000)
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    backend, plan, notice, mem = accel.load_measured([_plan("cuda")])
    assert backend == "BE" and plan.device == "cuda" and notice is None
    assert mem == 8 * _GIB


def test_load_measured_reports_rss_delta_for_cpu(monkeypatch):
    rss = iter([1000 * _GIB // 1000, 1400 * _GIB // 1000])  # +400/1000 GiB
    monkeypatch.setattr(accel, "device_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_rss_bytes", lambda: next(rss))
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cpu"), "cuda skipped; using CPU"))
    _b, plan, notice, mem = accel.load_measured([_plan("cpu")])
    assert plan.device == "cpu" and notice == "cuda skipped; using CPU"
    assert mem == 400 * _GIB // 1000


def test_load_measured_omits_memory_when_unmeasurable(monkeypatch):
    monkeypatch.setattr(accel, "device_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_rss_bytes", lambda: None)
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    _b, _p, _n, mem = accel.load_measured([_plan("cuda")])
    assert mem is None


def test_load_measured_omits_nonpositive_delta(monkeypatch):
    free = iter([2 * _GIB, 3 * _GIB])  # "after" higher than "before" -> delta < 0
    monkeypatch.setattr(accel, "device_free_bytes", lambda: next(free))
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    _b, _p, _n, mem = accel.load_measured([_plan("cuda")])
    assert mem is None


def test_hardware_info_handler(monkeypatch):
    monkeypatch.setattr(accel, "_native_gpus",
                        lambda: (("cuda", "NVIDIA GeForce RTX 4070", 12288 << 20),))
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu", "cuda"))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "hardware_info", "id": 7}), None, None))
    assert reply["type"] == "hardware_info_result" and reply["id"] == 7
    assert reply["accelAvailable"] is True
    assert reply["gpus"] == [{"vendor": "nvidia",
                              "name": "NVIDIA GeForce RTX 4070", "vramMb": 12288}]
    assert "sherpa" in reply["backendsInstalled"]


def test_hardware_info_reports_amd_gpu_from_tc_probe(monkeypatch):
    # THE D7 bugfix: gpus[] used to come from NVML, so mac/AMD boxes reported
    # an empty list. The tc probe sees every vendor.
    monkeypatch.setattr(accel, "_native_gpus",
                        lambda: (("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),))
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu", "vulkan"))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    accel.probe(force=True)
    reply, _ = asyncio.run(accel._h_hardware_info({}, {"id": 1}, None))
    assert reply["gpus"] == [{"vendor": "amd", "name": "AMD Radeon RX 7800 XT",
                              "vramMb": 16384}]
    assert reply["accelAvailable"] is True


def test_models_catalog_handler_cpu_machine(monkeypatch):
    monkeypatch.setattr(accel, "_native_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_asr"}))
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu",))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "models_catalog", "id": 3}), None, None))
    assert reply["type"] == "models_catalog_result" and reply["id"] == 3
    by_id = {m["id"]: m for m in reply["models"]}
    assert by_id["sense-voice"]["languages"] == ["zh", "en", "ja", "ko", "yue"]
    sv_tiers = by_id["sense-voice"]["tiers"]
    assert sv_tiers == [
        {"tier": "gpu-vulkan", "backend": "native_asr", "available": False},
        {"tier": "gpu-metal", "backend": "native_asr", "available": False},
        {"tier": "cpu", "backend": "native_asr", "available": True},
    ]
    # 2026-07-05 roster: the whisper star moved to large-v3-turbo
    assert by_id["whisper-large-v3-turbo"]["recommended"] is True
    assert by_id["whisper-large-v3"]["recommended"] is False
    # sizeBytes rides along with the catalog entry — no separate model_sizes round-trip.
    assert by_id["sense-voice"]["sizeBytes"] == 252684608


def test_models_catalog_filter_narrows_results(monkeypatch):
    monkeypatch.setattr(accel, "_native_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "models_catalog", "id": 4, "models": ["sense-voice"]}), None, None))
    ids = [m["id"] for m in reply["models"]]
    assert ids == ["sense-voice"]


def test_bench_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    assert accel.bench_load() == {}  # nothing yet
    key = accel._bench_key("fp123", "whisper-base", "ctranslate2", "cuda", "float16")
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


def test_measure_rtf_runs_and_caches(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))

    class _FakeBackend:
        def transcribe(self, samples, language):
            from sokuji_sidecar.backends import AsrResult
            return AsrResult("")  # near-instant → small rtf

    m = _machine()
    plan = accel.Plan("ctranslate2", "cpu", "cpu", "int8", "tiny", 1.0)
    rtf = accel.measure_rtf(_FakeBackend(), plan, "whisper-base", m)
    assert rtf is not None and rtf >= 0.0
    # cached: a second call returns the same value without re-running
    cache = accel.bench_load()
    assert accel._bench_key(m.fingerprint, "whisper-base", "ctranslate2", "cpu", "int8") in cache


def test_measure_tps_warms_up_benchmarks_and_caches(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))

    class _FakeBackend:
        def __init__(self):
            self.calls = 0

        def translate(self, text, system_prompt, src, tgt, wrap):
            self.calls += 1
            return "bonjour le monde", 12  # 12 "generated" tokens

    m = _machine()
    plan = accel.Plan("qwen_translate", "gpu-cuda", "cuda", "bfloat16", "repo", 1.0)
    b = _FakeBackend()
    tps = accel.measure_tps(b, plan, "qwen2.5-0.5b", m)
    assert tps is not None and tps > 0
    assert b.calls == 2  # one warmup pass + one timed pass

    # cached under a 'tps:'-namespaced key so it never collides with RTF entries
    cache = accel.bench_load()
    assert any(k.startswith("tps:") for k in cache)

    # second call serves from cache — backend untouched, same value
    b2 = _FakeBackend()
    assert accel.measure_tps(b2, plan, "qwen2.5-0.5b", m) == tps
    assert b2.calls == 0


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (needs a GPU transcribe.cpp can drive via Vulkan)")
def test_real_gpu_resolves_and_loads_vulkan(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))  # don't touch the user cache
    accel.probe(force=True)
    plans = accel.resolve("whisper-base")
    assert plans[0].device == "vulkan", f"expected vulkan first, got {[p.device for p in plans]}"
    backend, plan, _notice = accel.load_with_fallback(plans)
    try:
        assert plan.device == "vulkan"
        rtf = accel.measure_rtf(backend, plan, "whisper-base", accel.probe(), force=True)
        assert rtf is not None and rtf < 1.0, f"GPU should be faster than realtime, rtf={rtf}"
    finally:
        backend.unload()


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (needs a GPU transcribe.cpp can drive via Vulkan)")
def test_real_gpu_cpu_override_forces_cpu(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    accel.probe(force=True)
    plans = accel.resolve("whisper-base", override="cpu")
    assert plans[0].device == "cpu"
    backend, plan, _notice = accel.load_with_fallback(plans)
    try:
        assert plan.device == "cpu"
    finally:
        backend.unload()


def test_granite_gated_off_on_cpu_only_machine():
    # no nvidia → gpu-cuda filtered → no plan → NoUsablePlan (gated off)
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve("granite-speech-4.1-2b",
                      machine=_machine(installed=frozenset({"transformers"})))


def test_granite_gated_off_without_transformers_installed():
    # has a GPU but transformers not installed → backend filtered → NoUsablePlan
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve("granite-speech-4.1-2b",
                      machine=_machine(gpus=_nv_gpus(),
                                       installed=frozenset({"ctranslate2"})))


def test_qwen3asr_model_unavailable_without_runtime(monkeypatch):
    from sokuji_sidecar import accel, catalog
    # a GPU machine, but qwen3asr backend not installed (transformers lacks qwen3_asr)
    m = _machine(gpus=_nv_gpus(12000),
                 installed=frozenset({"ctranslate2", "sherpa", "transformers"}))
    plans = accel.resolve_deployments(catalog.asr_model("qwen3-asr-1.7b"), m)
    assert plans == []     # gated off: no usable deployment


def test_installed_find_spec_raise_does_not_nuke_whole_set(monkeypatch):
    """_installed() must never raise when find_spec raises for a module —
    the guarded _has_mod() helper absorbs the exception. Since slice 4 every
    backend name (ASR/translate/TTS alike) gates on the SAME sokuji_native
    wheel (accel._installed's map collapsed to one entry per name, all
    "sokuji_native" — see the module's own comment), a raise for that one
    module now excludes every backend, not just one of several — this is the
    honest post-collapse behavior, not a bug: there genuinely is only one
    external dependency left to probe."""
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def raising_find_spec(name, *a, **k):
        if name == "sokuji_native":
            raise ModuleNotFoundError("no module named sokuji_native")
        return real(name, *a, **k)

    monkeypatch.setattr(accel.importlib.util, "find_spec", raising_find_spec)
    result = accel._installed()          # must NOT raise
    assert result == frozenset()


def test_voxtral_model_unavailable_without_runtime():
    from sokuji_sidecar import accel, catalog
    m = _machine(gpus=_nv_gpus(12000),
                 installed=frozenset({"ctranslate2", "sherpa", "transformers"}))  # no voxtral_realtime
    plans = accel.resolve_deployments(catalog.asr_model("voxtral-mini-4b-realtime"), m)
    assert plans == []     # GPU-only + runtime absent → no usable deployment


def test_models_catalog_kind_translate_returns_qwen_rows(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(
        gpus=_nv_gpus(), tc=("vulkan", "cpu"), installed=frozenset({"native_translate"})))
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"type": "models_catalog", "id": 1, "kind": "translate"}, None))
    ids = [m["id"] for m in reply["models"]]
    assert "qwen2.5-0.5b" in ids and "qwen3-0.6b" in ids
    row = next(m for m in reply["models"] if m["id"] == "qwen2.5-0.5b")
    tiers = {t["tier"]: t["available"] for t in row["tiers"]}
    # No gpu-cuda tier row exists for native_translate at all (R2); the NVIDIA
    # device this fixture reports is seen via Vulkan.
    assert "gpu-cuda" not in tiers
    assert tiers["gpu-vulkan"] is True and tiers["cpu"] is True


def test_models_catalog_kind_defaults_to_asr(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine())
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"type": "models_catalog", "id": 2}, None))
    ids = [m["id"] for m in reply["models"]]
    assert "sense-voice" in ids       # ASR catalog, unchanged default


def test_new_translate_backends_installed_and_resolvable():
    # Force a REAL probe: an earlier test in this module may have left the
    # module-global probe() cache pointing at a monkeypatched fake Machine
    # (probe(force=True) with fake detectors is a lasting side effect, not
    # reverted by monkeypatch teardown) — this test wants the ACTUAL host's
    # installed set, not whatever an earlier test's fixture happened to leave.
    accel.probe(force=True)
    # native_translate self-gates on the sokuji_native wheel — the dev venv's
    # installed wheel (see module docstring) makes it always "installed" here.
    inst = accel._installed()
    assert "native_translate" in inst
    # and the resolver now produces plans instead of raising NoUsablePlan
    plans = accel.resolve_translate("hy-mt2-1.8b", "auto")
    assert any(p.backend == "native_translate" for p in plans)
    g = accel.resolve_translate("translategemma-4b", "auto")
    assert any(p.backend == "native_translate" for p in g)


# cosyvoice3-0.5b and gpt-sovits-v2pp cards, and the cosyvoice3_onnx/
# gpt_sovits_onnx backends they exercised the "three-site registration
# gotcha" against, are gone (slice 4 — the CosyVoice3/GPT-SoVITS ONNX TTS
# stack was never promoted to a native_tts family). omnivoice-0.6b survives
# but now resolves through the single native_tts backend, covered by
# test_omnivoice_backend_installed_and_resolvable below alongside every
# other TTS card, not a per-backend registration test of its own.


def test_omnivoice_backend_installed_and_resolvable():
    """Catches the registration gotcha: a backend missing from
    accel._installed() renders in the catalog but NoUsablePlan everywhere.
    Every TTS card (not just omnivoice) now shares the one native_tts
    backend, so this doubles as the general native_tts-resolvability check."""
    from sokuji_sidecar import planner

    installed = accel._installed()          # REAL probe of this host's venv
    assert "native_tts" in installed

    machine = accel.Machine(
        os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
        installed=frozenset(installed), fingerprint="t",
        tc_kinds=("vulkan",), gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),))
    plans = planner.resolve_tts("omnivoice-0.6b", machine=machine, platform="linux", cache={})
    assert plans, "omnivoice-0.6b resolved to no usable plan"
    # R19: TTS is cpu-only until GPU execution is validated per family per
    # lane, so even this vulkan-capable machine resolves to cpu, not
    # gpu-vulkan.
    assert plans[0].backend == "native_tts" and plans[0].tier == "cpu"


# ── select_variant tests ────────────────────────────────────────────────────


def _gpu_machine(vram_mb, installed=("hunyuan_translate",)):
    # tc=("vulkan", "cpu") alongside gpus: a real native probe never reports a
    # GPU via `gpus` without ALSO reporting "vulkan" in tc_kinds (both come
    # from the same device list) — has_nvidia's now-deleted NVIDIA-by-
    # description vulkan fallback (slice 4 — R4) used to paper over this gap
    # for a `gpus`-only fixture; a real vulkan signal is required now.
    return _machine(gpus=_nv_gpus(vram_mb), tc=("vulkan", "cpu"), installed=frozenset(installed))


def _hymt2_7b():
    """Synthetic (non-catalog) TranslateModel replicating the pre-native_translate
    shape of hy-mt2-7b: a gpu-vulkan bf16 variant, a cpu float32 floor, and a
    gpu-vulkan fp8 variant (gpu-cuda died with the ONNX backends, slice 4 —
    R4; moved to the one accelerator tier that still exists). The real
    hy-mt2-7b catalog row moved to native_translate GGUF quants (Task 9 /
    slice 3), which bypasses this VRAM/format-aware logic entirely (see
    planner._is_gguf_llm) — this fixture keeps select_variant's still-live
    generic (non-GGUF-LLM) path under test."""
    from sokuji_sidecar import catalog
    return catalog.TranslateModel("hy-mt2-7b-synthetic", "Hunyuan-MT2 7B (synthetic)", ("multi",), (
        catalog.Deployment("hunyuan_translate", "gpu-vulkan", "bfloat16", "tencent/Hy-MT2-7B", 1.0),
        catalog.Deployment("hunyuan_translate", "cpu", "float32", "tencent/Hy-MT2-7B", 1.0),
        catalog.Deployment("hunyuan_translate", "gpu-vulkan", "fp8", "tencent/Hy-MT2-7B-FP8", 1.0),
    ))


def test_list_variants_marks_supported_and_recommended(monkeypatch):
    # hy-mt2-7b's real catalog row moved to native_translate GGUF quants
    # (Task 9 / slice 3), which bypasses the VRAM-based supported/reason math
    # via the _is_gguf_llm dedupe branch (see test_list_variants_dedupes_llamacpp).
    # This test keeps the generic (non-GGUF-LLM) list_variants branch under
    # test via a synthetic model, monkeypatching catalog.translate_model since
    # _h_list_variants looks models up by id.
    from sokuji_sidecar import native_models as nm
    model = _hymt2_7b()
    monkeypatch.setattr(catalog, "translate_model", lambda mid: model if mid == model.id else None)
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    monkeypatch.setattr(accel, "probe", lambda force=False: _gpu_machine(16 * 1024))
    monkeypatch.setattr(nm, "model_size", lambda repo: 8 * 1024**3)
    msg = {"type": "list_variants", "id": 1, "model": model.id, "asrId": None, "ttsId": None}
    reply, _ = asyncio.run(accel._h_list_variants({}, msg, None, None))
    by = {v["computeType"]: v for v in reply["variants"]}
    assert by["fp8"]["supported"] is True and by["fp8"]["repo"] == "tencent/Hy-MT2-7B-FP8"
    assert by["bfloat16"]["supported"] is False           # 15GB*1.2=18GB > 15GB budget (16GiB - 1GiB ctx)
    assert reply["recommended"] == "fp8"


def test_load_with_fallback_fp8_factor_gates_cuda(monkeypatch):
    # An fp8 plan should use factor 1.5; on a 12GiB free machine with 8GiB weights:
    # budget = 8*1.5 + 1GiB_context = 13GiB > 12GiB free → cuda proactively skipped.
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 12 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 8 * _GIB)
    fp8_plan = accel.Plan("hunyuan_translate", "gpu-cuda", "cuda", "fp8", "repo", 1.0)
    cpu_pl = _plan("cpu")
    attempted = []
    class FakeBackend:
        def load(self, a, device, ct, config=None): attempted.append(device); self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([fp8_plan, cpu_pl])
    assert plan.device == "cpu" and attempted == ["cpu"]
    assert notice and "CPU" in notice


def test_supertonic_installed_and_resolvable():
    # Force a REAL probe (see test_new_translate_backends_installed_and_resolvable
    # for why this module-global cache needs a fresh read here).
    accel.probe(force=True)
    # sokuji_native is a sidecar dependency → native_tts self-gates ON here,
    # and resolve_tts must produce a runnable plan (not raise NoUsablePlan).
    assert "native_tts" in accel._installed()
    plans = accel.resolve_tts("supertonic-3", override="cpu")
    assert plans and plans[0].backend == "native_tts" and plans[0].compute_type == "f16"


def test_qwen3_backend_installed_and_resolvable():
    accel.probe(force=True)
    assert "native_tts" in accel._installed()
    plans = accel.resolve_tts("qwen3-tts-0.6b", override="cpu")
    assert plans and plans[0].backend == "native_tts"


def test_pocket_onnx_installed_and_resolvable():
    # Force a REAL probe: the characterization fixtures below hand-author their
    # own `installed` sets, so they would stay green even if accel._installed()
    # itself gated native_tts off — which would make resolve_tts raise
    # NoUsablePlan for every real machine.
    accel.probe(force=True)
    assert "native_tts" in accel._installed()
    plans = accel.resolve_tts("pocket-tts-en", override="cpu")
    assert plans and plans[0].backend == "native_tts"
    assert plans[0].tier == "cpu" and plans[0].compute_type == "q8_0"


# ── resolve_tts Loader wrapper: downloaded-variant detection + pin plumbing ──
# TTS artifacts are single-file GGUFs (exactly ASR/translate's shape, slice
# 4) — the old whole-repo _downloaded_tts_variants/native_models.model_status
# machinery is gone; resolve_tts now shares _downloaded_quants (per-file
# hf_hub_download(local_files_only=True)) with every other multi-quant kind.


def _tts_variant_card():
    # Same 2-quant ladder shape as every real card (default rank 2.0, alt
    # rank 1.0), backed by native_tts, uniform 3-tier-per-quant — used where
    # a test wants a controlled fixture rather than a real catalog row.
    return catalog.TtsModel(
        "fake-tts", "Fake TTS", ("en",), (
            catalog.Deployment("native_tts", "gpu-vulkan", "bf16", "org/fake/repo/fake-bf16.gguf", 1.0, est_bytes=5_000),
            catalog.Deployment("native_tts", "cpu", "bf16", "org/fake/repo/fake-bf16.gguf", 1.0, est_bytes=5_000),
            catalog.Deployment("native_tts", "gpu-vulkan", "q8_0", "org/fake/repo/fake-q8_0.gguf", 2.0, est_bytes=2_000),
            catalog.Deployment("native_tts", "cpu", "q8_0", "org/fake/repo/fake-q8_0.gguf", 2.0, est_bytes=2_000)),
        family="fake_family", clones=True, streaming=False)


def test_downloaded_quants_checks_each_tts_artifact_file(monkeypatch):
    # _downloaded_quants (shared with ASR/translate) must work unmodified for
    # a TTS card's single-file artifacts: only the cached quant's file is
    # reported downloaded.
    from huggingface_hub import constants as _hf_constants  # noqa: F401
    import sokuji_sidecar.accel as accel_mod

    def fake_hf_hub_download(repo, fname, local_files_only=False):
        # split_artifact("org/fake/repo/fake-q8_0.gguf") -> ("org/fake", "repo/fake-q8_0.gguf")
        # (the first TWO segments are always the repo, everything else is the path).
        if (repo, fname) == ("org/fake", "repo/fake-q8_0.gguf"):
            return "/fake/cache/path"
        raise Exception("not cached")

    monkeypatch.setattr("huggingface_hub.hf_hub_download", fake_hf_hub_download)
    got = accel_mod._downloaded_quants(_tts_variant_card())
    assert got == {"q8_0"}


def test_resolve_tts_wrapper_passes_pin_and_downloaded(monkeypatch):
    seen = {}
    def fake(mid, override, *, machine, platform, cache, downloaded, pin, est_bytes):
        seen.update(downloaded=downloaded, pin=pin)
        return ["sentinel"]
    monkeypatch.setattr(accel.planner, "resolve_tts", fake)
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q8_0"})
    monkeypatch.setattr(catalog, "resolve_tts_card", lambda mid: _tts_variant_card())
    assert accel.resolve_tts("fake-tts", pin="bf16") == ["sentinel"]
    assert seen == {"downloaded": {"q8_0"}, "pin": "bf16"}


def test_models_catalog_emits_tts_variants(monkeypatch):
    cuda_machine = _machine(gpus=_nv_gpus(12000), tc=("vulkan", "cpu"))
    monkeypatch.setattr(accel, "probe", lambda force=False: cuda_machine)
    monkeypatch.setattr(catalog, "tts_models", lambda: [_tts_variant_card()])
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"kind": "tts", "id": 1}, None))
    entry = reply["models"][0]
    by_id = {v["id"]: v for v in entry["variants"]}
    assert set(by_id) == {"bf16", "q8_0"}
    # GGUF-LLM-shaped cards (native_tts, since slice 4) are unconditionally
    # "supported" — the tier fallback (GPU->cpu) handles capacity, no VRAM
    # fit gate — and `recommended` mirrors _llamacpp_variant_row's budget walk.
    assert all(v["supported"] for v in by_id.values())
    assert by_id["bf16"]["recommended"] and not by_id["q8_0"]["recommended"]
    assert by_id["bf16"]["repo"] == "org/fake/repo/fake-bf16.gguf"


def test_measure_rtf_tts_with_fake_backend(tmp_path, monkeypatch):
    from sokuji_sidecar import accel
    import numpy as np
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    class FakeBackend:
        # I2(s4): generate() returns (samples, rate, gen_ms) -- the ACTUAL per-synth
        # rate, which measure_rtf_tts must use for audio_s. `sample_rate` here is the
        # class's advertised caps DEFAULT and is DELIBERATELY different from what
        # generate() actually returns below, so a regression back to
        # getattr(backend, "sample_rate", ...) computes the WRONG audio_s (24000/24000
        # = 1.0s instead of 24000/16000 = 1.5s) and the concrete rtf assertion below
        # catches it instead of just checking "some rtf came back".
        sample_rate = 24000
        def generate(self, text, speed=1.0):
            return np.zeros(24000, np.float32), 16000, 150  # 1.5s audio @ 16000Hz, 150ms gen
    plan = accel.Plan("native_tts", "cpu", "cpu", "q8_0", "repo", 1.0)
    m = accel.probe()
    rtf = accel.measure_rtf_tts(FakeBackend(), plan, "moss-tts-nano", m)
    # 24000 samples @ 16000Hz = 1.5s audio; gen_ms=150 -> rtf = 0.15s / 1.5s = 0.1 exactly.
    assert rtf == pytest.approx(0.1)


def _catalog(kind):
    state = {}; accel.register(state)
    reply, _ = asyncio.run(state["handlers"]["models_catalog"](
        state, {"id": 1, "type": "models_catalog", "kind": kind}, None, None))
    return {m["id"]: m for m in reply["models"]}


def test_models_catalog_asr_carries_order_repo_kind():
    asr = _catalog("asr")
    sv = asr["sense-voice"]
    assert sv["kind"] == "asr"
    assert isinstance(sv["order"], int)
    assert sv["repo"]  # non-empty default repo


def test_models_catalog_tts_kind_lists_models_with_voice_fields():
    tts = _catalog("tts")
    moss = tts["moss-tts-nano"]
    assert moss["kind"] == "tts" and moss["clones"] is True
    assert "streaming" in moss and "numSpeakers" not in moss  # dropped with style_voices (slice 4)
    assert moss["voice"] == {"builtin": "none", "custom": "clip"}


def test_models_catalog_carries_size_bytes_per_model():
    asr = _catalog("asr")
    tts = _catalog("tts")
    assert asr["sense-voice"]["sizeBytes"] > 0
    assert tts["supertonic-3"]["sizeBytes"] == 312784196
    assert tts["moss-tts-nano"]["sizeBytes"] == 193337984
    moss = tts["moss-tts-nano"]
    assert moss["clones"] is True
    assert moss["repo"] == "audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf"


# ── GGUF-LLM-aware resolution/variant selection (Task 10 / slice 3) ─────────
# Named `_llm_machine` (not `_machine`) — the file already has a `_machine`
# helper with a different (kwargs-of-tuples) signature; redefining `_machine`
# here would silently replace it for the whole module and break every earlier
# test that calls it.


def _llm_machine(gpu=False, apple=False):
    return _machine(gpus=_nv_gpus(12282) if gpu else (),
                    tc=("vulkan", "cpu") if gpu else (),
                    apple=apple, installed=accel._installed())


def test_vram_gate_skipped_for_llamacpp(monkeypatch):
    """The proactive free-VRAM check must not pre-skip native_translate cuda
    plans (a defensive no-op today: no catalog row offers native_translate a
    gpu-cuda tier at all, see planner._tier_available's aarch64 comment)."""
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 1 << 30)  # 1 GiB free
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 8 << 30)
    loaded = []

    class FakeBackend:
        def load(self, ref, device, ct, config=None):
            loaded.append(device)
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    plans = [accel.Plan("native_translate", "gpu-cuda", "cuda", "q4_k_m", "repo", 2.0),
             accel.Plan("native_translate", "cpu", "cpu", "q4_k_m", "repo", 2.0)]
    _b, plan, notice = accel.load_with_fallback(plans)
    assert plan.device == "cuda" and notice is None
    assert loaded == ["cuda"]


def test_list_variants_dedupes_llamacpp(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _llm_machine(gpu=True))
    reply, _ = asyncio.run(accel._h_list_variants({}, {"model": "translategemma-4b"}, None, None))
    ids = [v["id"] for v in reply["variants"]]
    assert sorted(ids) == ["q4_k_m", "q8_0"]        # deduped across tiers
    assert all(v["supported"] for v in reply["variants"])
    # stable-total basis: a roomy NVIDIA card recommends the quality quant
    assert reply["recommended"] == "q8_0"


def test_models_catalog_variant_ids(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _llm_machine())
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"kind": "translate"}, None, None))
    by_id = {m["id"]: m for m in reply["models"]}
    assert by_id["translategemma-4b"]["variantIds"] == ["q4_k_m", "q8_0"]


def test_asr_unavailable_without_native():
    # wheel missing → no ASR model resolves (installed gate)
    m = _machine(installed=frozenset())
    import pytest as _pytest
    with _pytest.raises(accel.NoUsablePlan):
        accel.resolve("whisper-base", machine=m)


# ── Phase E1: GPU identity + fresh memory reads ──────────────────────────────


class _FakeDev:
    def __init__(self, index, kind, desc, total, free):
        self.index, self.kind, self.name = index, kind, f"{kind}{index}"
        self.description, self.mem_total, self.mem_free = desc, total, free


def _fake_native_module(monkeypatch, devs):
    import sys, types
    from sokuji_sidecar import native
    mod = types.ModuleType("sokuji_native")
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: list(devs)
    mod.device_free_mem = lambda i: next(d.mem_free for d in devs if d.index == i)
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return mod


def test_machine_gpus_stable_identity(monkeypatch):
    _fake_native_module(monkeypatch, [
        _FakeDev(0, "vulkan", "AMD Radeon RX 7800 XT", 16 << 30, 15 << 30),
        _FakeDev(1, "cpu", "Ryzen 7", 64 << 30, 60 << 30),
    ])
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_asr"}))
    m = accel.probe(force=True)
    assert m.gpus == (("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),)
    assert m.tc_kinds == ("cpu", "vulkan")


def test_fingerprint_ignores_volatile_free(monkeypatch):
    def probe_with_free(free):
        _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "RTX 4070", 12 << 30, free)])
        monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
        monkeypatch.setattr(accel, "_installed", lambda: frozenset())
        return accel.probe(force=True).fingerprint
    assert probe_with_free(10 << 30) == probe_with_free(2 << 30)


def test_device_free_bytes_prefers_native(monkeypatch):
    _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "RTX 4070", 12 << 30, 9 << 30)])
    assert accel.device_free_bytes() == 9 << 30


def test_device_free_bytes_none_without_native(monkeypatch):
    import sys
    from sokuji_sidecar import native
    monkeypatch.setitem(sys.modules, "sokuji_native", None)   # import fails
    native.reset_for_tests()
    assert accel.device_free_bytes() is None


def test_device_free_bytes_none_without_gpu(monkeypatch):
    _fake_native_module(monkeypatch, [_FakeDev(0, "cpu", "Ryzen", 64 << 30, 60 << 30)])
    assert accel.device_free_bytes() is None


def test_ram_free_bytes_positive():
    n = accel.ram_free_bytes()
    assert n is None or n > 0


def test_list_variants_recommends_on_stable_total(monkeypatch):
    # recommendation keys on mem_total (12GB → q8 recommended) even when the
    # transient free is tiny — download advice must not flap session-to-session.
    m = _machine(gpus=_nv_gpus(12288), tc=("vulkan", "cpu"), installed=frozenset({"native_translate"}))
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 1 << 30)
    import asyncio as _a, json as _j
    from sokuji_sidecar import server as _srv
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = _a.run(_srv.handle_message(
        st, _j.dumps({"type": "list_variants", "id": 9, "model": "translategemma-4b"}), None, None))
    assert reply["recommended"] == "q8_0"


def test_models_catalog_exposes_asr_variant_ids_and_deduped_tiers(monkeypatch):
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_asr", "native_asr_stream"}))
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu",))
    monkeypatch.setattr(accel, "_native_gpus", lambda: ())
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "models_catalog", "id": 5, "kind": "asr",
                        "models": ["cohere-transcribe-03-2026", "sense-voice"]}), None, None))
    by_id = {m["id"]: m for m in reply["models"]}
    assert by_id["cohere-transcribe-03-2026"]["variantIds"] == \
        ["q4_k_m", "f16", "q8_0", "q6_k", "q5_k_m"]   # full ladder, default first
    # every ASR card now carries its full ladder → variantIds everywhere
    assert by_id["sense-voice"]["variantIds"][0] == "q8_0"    # default first
    # tiers deduped: 3 entries, not 6, despite the two-quant ladder
    assert [t["tier"] for t in by_id["cohere-transcribe-03-2026"]["tiers"]] == \
        ["gpu-vulkan", "gpu-metal", "cpu"]


def test_ledger_claim_release_other():
    accel.ledger_reset()
    accel.ledger_claim("asr", 1 << 30)
    accel.ledger_claim("tts", 0)            # loaded, but on cpu → holds nothing
    assert accel.ledger_other("translate") == 1 << 30
    assert accel.ledger_other("asr") == 0
    accel.ledger_release("asr")
    assert accel.ledger_other("translate") == 0


def test_ledger_effective_reserve_loaded_stage_reserves_zero():
    """REGRESSION (voxtral Q8 + tiny translate crash, 2026-07-05): a LOADED
    stage's VRAM is already OUT of every free reading --fit takes — re-
    reserving its measured claim double-counts. Measured on the 4070: voxtral
    Q8 claims 6.2GB at load; adding it to --fit-target pushed a 0.8B translate
    LLM fully off a GPU that still had 3.2GB free, and its CUDA remnants then
    crashed llama-server on the first request. Loaded stages contribute 0;
    only not-yet-loaded stages reserve their planned estimate."""
    accel.ledger_reset()
    accel.ledger_claim("asr", 6252 << 20)          # voxtral Q8 measured claim
    planned = {"asr": 5 << 30, "tts": 80 << 20}    # piper is tiny
    r = accel.ledger_effective_reserve("translate", planned)
    assert r == 80 << 20                           # only the unloaded stage


def test_ledger_effective_reserve_unloaded_stages_use_estimates():
    accel.ledger_reset()
    planned = {"asr": 3 << 30, "tts": 4 << 30}     # nothing loaded yet
    r = accel.ledger_effective_reserve("translate", planned)
    assert r == (3 << 30) + (4 << 30)


def test_ledger_effective_reserve_cpu_loaded_stage_reserves_nothing():
    accel.ledger_reset()
    accel.ledger_claim("asr", 0)                   # loaded on cpu
    r = accel.ledger_effective_reserve("translate", {"asr": 3 << 30})
    assert r == 0                                  # fixes the stacked-padding over-reserve


def test_load_measured_claims_into_ledger(monkeypatch):
    accel.ledger_reset()
    frees = iter([10 << 30, 8 << 30])              # 2GB delta during the load
    monkeypatch.setattr(accel, "device_free_bytes", lambda: next(frees))
    monkeypatch.setattr(accel, "_rss_bytes", lambda: None)

    class _B:
        def load(self, a, d, c, config=None): pass
    monkeypatch.setattr(accel, "make_backend", lambda name: _B())
    plans = [accel.Plan("native_asr", "gpu-vulkan", "vulkan", "q8_0", "org/r/f.gguf", 1.0)]
    _b, plan, _n, mem = accel.load_measured(plans, stage="asr")
    assert mem == 2 << 30                          # vulkan delta measured (not cuda-only)
    assert accel.ledger_other("translate") == 2 << 30
    accel.ledger_release("asr")


def test_load_measured_cpu_claims_zero(monkeypatch):
    accel.ledger_reset()
    monkeypatch.setattr(accel, "_rss_bytes", lambda: 1 << 30)

    class _B:
        def load(self, a, d, c, config=None): pass
    monkeypatch.setattr(accel, "make_backend", lambda name: _B())
    plans = [accel.Plan("native_asr", "cpu", "cpu", "q8_0", "org/r/f.gguf", 1.0)]
    accel.load_measured(plans, stage="asr")
    assert accel.ledger_other("translate") == 0    # present but holds no VRAM
    assert "asr" in accel._LEDGER
    accel.ledger_release("asr")


# ── Phase E5(sidecar): full variant list precomputed in models_catalog ───────


def _catalog_reply(monkeypatch, gpus=(), kind="asr", models=None):
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed",
                        lambda: frozenset({"native_asr", "native_asr_stream", "native_translate"}))
    monkeypatch.setattr(accel, "_native_kinds", lambda: ("cpu", "vulkan") if gpus else ("cpu",))
    monkeypatch.setattr(accel, "_native_gpus", lambda: gpus)
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    req = {"type": "models_catalog", "id": 7, "kind": kind}
    if models:
        req["models"] = models
    reply, _ = asyncio.run(server.handle_message(st, json.dumps(req), None, None))
    return {m["id"]: m for m in reply["models"]}


def test_catalog_variants_full_ladder_sorted_quality_desc(monkeypatch):
    by_id = _catalog_reply(monkeypatch, gpus=(("vulkan", "RTX 4070", 12 << 30),),
                           models=["cohere-transcribe-03-2026"])
    v = by_id["cohere-transcribe-03-2026"]["variants"]
    assert [x["id"] for x in v] == ["f16", "q8_0", "q6_k", "q5_k_m", "q4_k_m"]
    assert all(x["sizeBytes"] > 0 for x in v)
    assert all(x["supported"] for x in v)     # 12GB fits even f16 (4.1GB×1.15)
    assert sum(1 for x in v if x["recommended"]) == 1


def test_catalog_variants_supported_respects_small_gpu(monkeypatch):
    by_id = _catalog_reply(monkeypatch, gpus=(("vulkan", "iGPU", 2 << 30),),
                           models=["cohere-transcribe-03-2026"])
    v = {x["id"]: x for x in by_id["cohere-transcribe-03-2026"]["variants"]}
    assert not v["f16"]["supported"]          # 4.1GB into 2GB: no
    assert v["q4_k_m"]["supported"]           # 1.56GB×1.15 fits
    rec = [x["id"] for x in by_id["cohere-transcribe-03-2026"]["variants"] if x["recommended"]]
    assert rec == ["q4_k_m"]


def test_catalog_variants_cpu_only_recommends_smallest(monkeypatch):
    by_id = _catalog_reply(monkeypatch, models=["whisper-large-v3"])
    v = by_id["whisper-large-v3"]["variants"]
    rec = [x["id"] for x in v if x["recommended"]]
    assert rec == ["q4_k_m"]                  # bandwidth-bound CPU: smallest wins


def test_catalog_variants_translate_kind_included(monkeypatch):
    by_id = _catalog_reply(monkeypatch, gpus=_nv_gpus(12288),
                           kind="translate", models=["translategemma-4b"])
    v = by_id["translategemma-4b"]["variants"]
    assert [x["id"] for x in v] == ["q8_0", "q4_k_m"]
    assert all(x["supported"] for x in v)     # tier fallback (GPU->cpu) handles capacity
    assert [x["id"] for x in v if x["recommended"]] == ["q8_0"]


def test_catalog_variants_carry_reason_data(monkeypatch):
    by_id = _catalog_reply(monkeypatch, gpus=(("vulkan", "iGPU", 2 << 30),),
                           models=["cohere-transcribe-03-2026"])
    entry = by_id["cohere-transcribe-03-2026"]
    assert entry["deviceMemBytes"] == 2 << 30
    f16 = next(v for v in entry["variants"] if v["id"] == "f16")
    # needBytes = fit-check figure (size × factor) the renderer localizes into
    # "needs ~X — this machine has Y"
    assert f16["needBytes"] == int(f16["sizeBytes"] * 1.15)
    assert not f16["supported"]


def test_no_nvml_left_in_package():
    # D7: NVML is fully removed — no package module may import the NVML binding.
    import pathlib
    needle = "pyn" + "vml"  # split literal so this guard is not its own grep hit
    pkg = pathlib.Path(accel.__file__).parent
    # rglob so subpackages (qwen3_tts/, moss_tts/, …) are covered, not just top level.
    hits = [str(p.relative_to(pkg)) for p in pkg.rglob("*.py") if needle in p.read_text()]
    assert hits == []


# TIER_RANK/TIER_DEVICE's gpu-cuda/gpu-dml entries, and the mlx_audio_tts
# backend they and _dml_adapters/has_nvidia existed to serve, all died with
# the ONNX/MLX TTS backends (their last catalog consumers, slice 4 — R4):
# test_dml_tier_constants_place_dml_below_cuda and the two
# test_mlx_audio_tts_* tests have no equivalent. Post-slice-4 Machine shape:
# no `nvidia`/`dml_adapters`/`ort_cuda` fields — accelerator identity is
# `gpus` (kind, description, mem_total) plus `tc_kinds`, both from the same
# native probe.


def test_gpu_metal_tier_available_on_apple_silicon():
    from sokuji_sidecar import accel
    m = accel.Machine(os="Darwin", arch="arm64", cpu_cores=8,
                      apple_silicon=True, installed=frozenset(),
                      fingerprint="as", tc_kinds=())
    assert accel._tier_available("gpu-metal", m) is True


def test_gpu_metal_tier_available_via_tc_metal_kind():
    from sokuji_sidecar import accel
    # Intel Mac: the metal ACCELERATOR is present (tc reports it), so the tier is
    # available — the Apple-Silicon requirement is enforced separately by
    # _platform_ok(requires_apple_silicon), not here.
    m = accel.Machine(os="Darwin", arch="arm64", cpu_cores=8,
                      apple_silicon=False, installed=frozenset(),
                      fingerprint="intel-mac", tc_kinds=("cpu", "metal"))
    assert accel._tier_available("gpu-metal", m) is True


def test_model_weight_bytes_without_variant_dir_counts_everything(tmp_path):
    onnx_dir = tmp_path / "onnx"
    onnx_dir.mkdir()
    (onnx_dir / "talker.onnx").write_bytes(b"x" * 100)
    (onnx_dir / "talker.onnx.data").write_bytes(b"x" * 50)
    from sokuji_sidecar import accel
    assert accel._model_weight_bytes(str(tmp_path)) == 150
