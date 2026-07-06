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


class _FakeNvml:
    """Minimal pynvml stand-in: one device, RTX-4070-shaped. Records lifecycle
    calls so tests can assert init/shutdown pairing."""

    class _Mem:
        total = 12 * 1024 * 1024 * 1024
        free = 9 * 1024 * 1024 * 1024

    def __init__(self, name="NVIDIA GeForce RTX 4070", count=1):
        self._name = name
        self._count = count
        self.inits = 0
        self.shutdowns = 0

    def nvmlInit(self):
        self.inits += 1

    def nvmlShutdown(self):
        self.shutdowns += 1

    def nvmlDeviceGetCount(self):
        return self._count

    def nvmlDeviceGetHandleByIndex(self, i):
        return i

    def nvmlDeviceGetMemoryInfo(self, h):
        return self._Mem()

    def nvmlDeviceGetCudaComputeCapability(self, h):
        return (8, 9)

    def nvmlDeviceGetName(self, h):
        return self._name


def _install_fake_nvml(monkeypatch, fake):
    import sys
    monkeypatch.setitem(sys.modules, "pynvml", fake)


def test_nvidia_gpus_probe_via_nvml(monkeypatch):
    # torch is gone: GPU properties (vram, compute capability, name) come from NVML.
    fake = _FakeNvml()
    _install_fake_nvml(monkeypatch, fake)
    gpus = accel._nvidia_gpus()
    assert gpus == (accel.Gpu("nvidia", "NVIDIA GeForce RTX 4070", 12288, (8, 9)),)
    assert fake.inits == 1 and fake.shutdowns == 1


def test_nvidia_gpus_decodes_bytes_name(monkeypatch):
    # older NVML bindings return bytes from nvmlDeviceGetName
    _install_fake_nvml(monkeypatch, _FakeNvml(name=b"NVIDIA GeForce RTX 4070"))
    gpus = accel._nvidia_gpus()
    assert gpus[0].name == "NVIDIA GeForce RTX 4070"


def test_nvidia_gpus_empty_without_nvml(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "pynvml", None)  # import raises ImportError
    assert accel._nvidia_gpus() == ()


def test_cuda_free_bytes_via_nvml(monkeypatch):
    fake = _FakeNvml()
    _install_fake_nvml(monkeypatch, fake)
    assert accel._cuda_free_bytes() == 9 * 1024 * 1024 * 1024
    assert fake.inits == 1 and fake.shutdowns == 1


def test_cuda_free_bytes_none_without_nvml(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "pynvml", None)
    assert accel._cuda_free_bytes() is None


def test_cuda_free_bytes_none_without_devices(monkeypatch):
    fake = _FakeNvml(count=0)
    _install_fake_nvml(monkeypatch, fake)
    assert accel._cuda_free_bytes() is None


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


def _machine(*, nvidia=(), apple=False, dml=(), installed=frozenset({"transcribe_cpp", "transcribe_cpp_stream"}), tc=(), gpus=()):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, nvidia=nvidia,
                         apple_silicon=apple, dml_adapters=dml, installed=installed,
                         fingerprint="test", tc_kinds=tc, gpus=gpus)


def _nv_gpus(vram_mb=0):
    """tc-probe-shaped NVIDIA device identity: (kind, description, mem_total).
    vram_mb=0 models a probe that saw the device but no memory figure."""
    return (("vulkan", "NVIDIA GeForce RTX 4070", vram_mb << 20),)


def test_has_nvidia_from_tc_description():
    m = _machine(gpus=(("vulkan", "NVIDIA GeForce RTX 4070", 12 << 30),))
    assert accel.has_nvidia(m) is True


def test_has_nvidia_case_insensitive():
    m = _machine(gpus=(("cuda", "nVidia geforce rtx 5080", 16 << 30),))
    assert accel.has_nvidia(m) is True


def test_has_nvidia_false_for_amd():
    m = _machine(gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),))
    assert accel.has_nvidia(m) is False


def test_has_nvidia_false_without_devices():
    assert accel.has_nvidia(_machine()) is False


def _model_cpu_and_cuda():
    # synthetic rows exercising the generic resolver mechanics (tier ranking,
    # override pinning) — backend name only needs to be in `installed`
    return catalog.AsrModel("m", "M", ("multi",), (
        catalog.Deployment("transcribe_cpp", "gpu-cuda", "float16", "large-v3", 1.0),
        catalog.Deployment("transcribe_cpp", "cpu", "int8", "large-v3", 1.0),
    ))


def test_resolve_prefers_gpu_when_nvidia_present():
    m = _machine(gpus=_nv_gpus())
    plans = accel.resolve_deployments(_model_cpu_and_cuda(), m)
    assert [p.device for p in plans] == ["cuda", "cpu"]  # GPU first, CPU floor last


def test_resolve_cpu_only_machine_drops_gpu_plan():
    plans = accel.resolve_deployments(_model_cpu_and_cuda(), _machine())
    assert [p.device for p in plans] == ["cpu"]  # no NVIDIA → only the floor


def test_resolve_override_pins_cpu():
    m = _machine(gpus=_nv_gpus())
    plans = accel.resolve_deployments(_model_cpu_and_cuda(), m, override="cpu")
    assert [p.device for p in plans] == ["cpu", "cuda"]  # CPU pinned to front, GPU still present


def test_resolve_gpu_only_model_on_cpu_machine_is_empty():
    gpu_only = catalog.AsrModel("v", "Voxtral", ("multi",),
                                (catalog.Deployment("llamacpp", "gpu-cuda", "q4", "v", 1.0),))
    assert accel.resolve_deployments(gpu_only, _machine()) == []


def test_resolve_real_catalog_sense_voice_cpu(monkeypatch):
    monkeypatch.setattr(accel, "_tc_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"transcribe_cpp"}))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu",))   # no accelerator
    accel.probe(force=True)
    plans = accel.resolve("sense-voice")
    assert plans[0].backend == "transcribe_cpp" and plans[0].device == "cpu"


def test_resolve_unknown_model_raises():
    with pytest.raises(ValueError):
        accel.resolve("nope", machine=_machine())


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


_GIB = 1 << 30


def test_vram_gate_skips_cuda_to_cpu_when_insufficient(monkeypatch):
    # A flexible model (cuda + cpu floor) whose weights can't fit free VRAM is
    # routed straight to CPU — the cuda plan is never even attempted (no OOM).
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 2 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 5 * _GIB)
    attempted = []
    class FakeBackend:
        def load(self, a, device, ct): attempted.append(device); self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cpu" and attempted == ["cpu"]
    assert notice and "CPU" in notice


def test_vram_gate_allows_cuda_when_sufficient(monkeypatch):
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 10 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 4 * _GIB)
    class FakeBackend:
        def load(self, a, device, ct): self.device = device; self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cuda" and notice is None


def test_vram_gate_inert_without_estimates(monkeypatch):
    # No CUDA / unknown footprint → gate stays out of the way; the existing
    # try/except path still steps cuda → cpu on a real OOM.
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: None)
    class FakeBackend:
        def __init__(self, ok): self.ok = ok
        def load(self, a, device, ct):
            if not self.ok: raise backends.BackendLoadError("CUDA out of memory")
            self.loaded = True
    seq = iter([FakeBackend(False), FakeBackend(True)])
    monkeypatch.setattr(accel, "make_backend", lambda name: next(seq))
    backend, plan, notice = accel.load_with_fallback([_plan("cuda"), _plan("cpu")])
    assert plan.device == "cpu"


def test_gpu_only_oom_raises_honest_vram_message(monkeypatch):
    # A GPU-only model (no cpu plan) that OOMs must NOT claim it is "falling
    # back" — there is nowhere to fall back to. Surface an honest VRAM message.
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 1 * _GIB)
    class FakeBackend:
        def load(self, a, device, ct):
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
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_rss_bytes", lambda: next(rss))
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cpu"), "cuda skipped; using CPU"))
    _b, plan, notice, mem = accel.load_measured([_plan("cpu")])
    assert plan.device == "cpu" and notice == "cuda skipped; using CPU"
    assert mem == 400 * _GIB // 1000


def test_load_measured_omits_memory_when_unmeasurable(monkeypatch):
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_rss_bytes", lambda: None)
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    _b, _p, _n, mem = accel.load_measured([_plan("cuda")])
    assert mem is None


def test_load_measured_omits_nonpositive_delta(monkeypatch):
    free = iter([2 * _GIB, 3 * _GIB])  # "after" higher than "before" -> delta < 0
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: next(free))
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    _b, _p, _n, mem = accel.load_measured([_plan("cuda")])
    assert mem is None


def test_hardware_info_handler(monkeypatch):
    monkeypatch.setattr(accel, "_tc_gpus",
                        lambda: (("cuda", "NVIDIA GeForce RTX 4070", 12288 << 20),))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu", "cuda"))
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
    assert reply["gpus"] == [{"vendor": "nvidia",
                              "name": "NVIDIA GeForce RTX 4070", "vramMb": 12288}]
    assert "sherpa" in reply["backendsInstalled"]


def test_hardware_info_reports_amd_gpu_from_tc_probe(monkeypatch):
    # THE D7 bugfix: gpus[] used to come from NVML, so mac/AMD boxes reported
    # an empty list. The tc probe sees every vendor.
    monkeypatch.setattr(accel, "_tc_gpus",
                        lambda: (("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu", "vulkan"))
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    accel.probe(force=True)
    reply, _ = asyncio.run(accel._h_hardware_info({}, {"id": 1}, None))
    assert reply["gpus"] == [{"vendor": "amd", "name": "AMD Radeon RX 7800 XT",
                              "vramMb": 16384}]
    assert reply["accelAvailable"] is True


def test_models_catalog_handler_cpu_machine(monkeypatch):
    monkeypatch.setattr(accel, "_tc_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"transcribe_cpp"}))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu",))
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
        {"tier": "gpu-vulkan", "backend": "transcribe_cpp", "available": False},
        {"tier": "gpu-metal", "backend": "transcribe_cpp", "available": False},
        {"tier": "cpu", "backend": "transcribe_cpp", "available": True},
    ]
    # 2026-07-05 roster: the whisper star moved to large-v3-turbo
    assert by_id["whisper-large-v3-turbo"]["recommended"] is True
    assert by_id["whisper-large-v3"]["recommended"] is False
    # sizeBytes rides along with the catalog entry — no separate model_sizes round-trip.
    assert by_id["sense-voice"]["sizeBytes"] == 252684608


def test_models_catalog_filter_narrows_results(monkeypatch):
    monkeypatch.setattr(accel, "_tc_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "sherpa"}))
    accel.probe(force=True)
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "models_catalog", "id": 4, "models": ["sense-voice"]}), None, None))
    ids = [m["id"] for m in reply["models"]]
    assert ids == ["sense-voice"]


def test_whisper_resolves_vulkan_first_on_nvidia():
    m = _machine(gpus=_nv_gpus(12288))
    plans = accel.resolve("whisper-base", machine=m)
    assert [p.device for p in plans] == ["vulkan", "cpu"]
    assert all(p.backend == "transcribe_cpp" and p.compute_type == "q8_0" for p in plans)


def test_whisper_cpu_only_machine_drops_gpu():
    plans = accel.resolve("whisper-base", machine=_machine())  # no nvidia
    assert [p.device for p in plans] == ["cpu"]


def test_whisper_cpu_override_pins_cpu_on_nvidia():
    m = _machine(gpus=_nv_gpus())
    plans = accel.resolve("whisper-base", override="cpu", machine=m)
    assert plans[0].device == "cpu"


def test_sense_voice_resolves_vulkan_then_cpu_on_nvidia():
    m = _machine(gpus=_nv_gpus())
    plans = accel.resolve("sense-voice", machine=m)
    assert [p.device for p in plans] == ["vulkan", "cpu"]


def test_vulkan_tier_from_tc_probe_alone():
    # An AMD/Intel box: no NVML GPUs, no DML — transcribe.cpp's own Vulkan
    # probe is enough to light the gpu-vulkan tier.
    m = _machine(tc=("cpu", "vulkan"))
    plans = accel.resolve("whisper-base", machine=m)
    assert plans[0].device == "vulkan"


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
    m = _machine(gpus=_nv_gpus())
    accel.probe(force=True)
    # seed the cache keyed by the machine we resolve for (m.fingerprint == "test")
    fp = m.fingerprint
    accel.bench_save({
        accel._bench_key(fp, "whisper-base", "transcribe_cpp", "vulkan", "q8_0"): 0.8,
        accel._bench_key(fp, "whisper-base", "transcribe_cpp", "cpu", "q8_0"): 0.3,
    })
    plans = accel.resolve("whisper-base", machine=m)
    assert plans[0].device == "cpu"  # demoted: cpu now leads


def test_resolve_override_beats_demotion(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _machine(gpus=_nv_gpus())
    fp = m.fingerprint
    # cache says cuda is slower than cpu — AUTO would demote, but an explicit
    # override must win (the benchmark never overrides the user's forced device).
    accel.bench_save({
        accel._bench_key(fp, "whisper-base", "transcribe_cpp", "vulkan", "q8_0"): 0.8,
        accel._bench_key(fp, "whisper-base", "transcribe_cpp", "cpu", "q8_0"): 0.3,
    })
    # UI sends 'cuda' for GPU — it pins ANY accelerator tier (vulkan here).
    plans = accel.resolve("whisper-base", override="cuda", machine=m)
    assert plans[0].device == "vulkan"  # explicit override beats cache demotion


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
    the guarded _has_mod() helper absorbs the exception and keeps every other
    present backend in the returned frozenset."""
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def raising_find_spec(name, *a, **k):
        if name == "transcribe_cpp":
            raise ModuleNotFoundError("no module named transformers.models.qwen3_asr")
        return real(name, *a, **k)

    monkeypatch.setattr(accel.importlib.util, "find_spec", raising_find_spec)
    result = accel._installed()          # must NOT raise
    assert "transcribe_cpp" not in result   # the raising entry is excluded …
    assert "sherpa_tts" in result           # … but other present backends survive


def test_voxtral_model_unavailable_without_runtime():
    from sokuji_sidecar import accel, catalog
    m = _machine(gpus=_nv_gpus(12000),
                 installed=frozenset({"ctranslate2", "sherpa", "transformers"}))  # no voxtral_realtime
    plans = accel.resolve_deployments(catalog.asr_model("voxtral-mini-4b-realtime"), m)
    assert plans == []     # GPU-only + runtime absent → no usable deployment


def test_resolve_translate_prefers_gpu(monkeypatch):
    # select_variant requires known VRAM + capability to prefer a GPU; the old
    # stub (vram_mb=0, capability=None) correctly falls back to CPU now.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 * 1024**3)  # 1 GiB, fits any GPU
    m = _machine(gpus=_nv_gpus(12288),
                 installed=frozenset({"llamacpp_qwen"}))
    plans = accel.resolve_translate("qwen2.5-0.5b", "auto", m)
    assert plans[0].device == "cuda"
    assert plans[-1].device == "cpu"
    # qwen2.5-0.5b defaults to q8_0 (small-Qwen default); artifact is the upstream GGUF file.
    assert plans[0].artifact == "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf"


def test_resolve_translate_cpu_only_machine():
    m = _machine(installed=frozenset({"llamacpp_qwen"}))
    plans = accel.resolve_translate("qwen3-0.6b", "auto", m)
    assert [p.device for p in plans] == ["cpu"]


def test_resolve_translate_override_cpu_pins_front():
    # An explicit device override bypasses select_variant/quant-default picking
    # and returns every installed+tier-available deployment (both quants), CPU
    # pinned to the front.
    m = _machine(gpus=_nv_gpus(),
                 installed=frozenset({"llamacpp_qwen"}))
    plans = accel.resolve_translate("qwen3-0.6b", "cpu", m)
    assert [p.device for p in plans] == ["cpu", "cpu", "cuda", "cuda"]
    assert plans[0].device == "cpu" and plans[-1].device == "cuda"


def test_resolve_translate_qwen35_no_longer_self_gates():
    # Pre-Task-9, qwen3.5 self-gated off pending transformers' qwen3_5 support
    # (backend "qwen35_translate"). It now lives on a GGUF card behind
    # llamacpp_qwen, an external binary that accel._installed() always reports
    # present (no Python-runtime dependency) — so qwen3.5 resolves like any other
    # LLM translate card, self-gating no longer applies.
    m = _machine(gpus=_nv_gpus(), installed=accel._installed())
    plans = accel.resolve_translate("qwen3.5-0.8b", "auto", m)
    assert plans[0].device == "cuda"
    assert any(p.backend == "llamacpp_qwen" for p in plans)


def test_resolve_translate_unknown_id_raises():
    with pytest.raises(ValueError):
        accel.resolve_translate("nope", "auto", _machine())


def test_models_catalog_kind_translate_returns_qwen_rows(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(
        gpus=_nv_gpus(), installed=frozenset({"llamacpp_qwen"})))
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"type": "models_catalog", "id": 1, "kind": "translate"}, None))
    ids = [m["id"] for m in reply["models"]]
    assert "qwen2.5-0.5b" in ids and "qwen3-0.6b" in ids
    row = next(m for m in reply["models"] if m["id"] == "qwen2.5-0.5b")
    tiers = {t["tier"]: t["available"] for t in row["tiers"]}
    assert tiers["gpu-cuda"] is True and tiers["cpu"] is True


def test_models_catalog_kind_defaults_to_asr(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine())
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"type": "models_catalog", "id": 2}, None))
    ids = [m["id"] for m in reply["models"]]
    assert "sense-voice" in ids       # ASR catalog, unchanged default


def test_new_translate_backends_installed_and_resolvable():
    # llamacpp_* backends run an external binary, not a Python runtime → always "installed".
    inst = accel._installed()
    assert "llamacpp_gemma" in inst
    assert "llamacpp_hunyuan" in inst
    # and the resolver now produces plans instead of raising NoUsablePlan
    plans = accel.resolve_translate("hy-mt2-1.8b", "auto")
    assert any(p.backend == "llamacpp_hunyuan" for p in plans)
    g = accel.resolve_translate("translategemma-4b", "auto")
    assert any(p.backend == "llamacpp_gemma" for p in g)


# NVML probe coverage lives at the top of this file (test_nvidia_gpus_probe_via_nvml
# and friends) — the torch-era probe tests were superseded by them.


# ── select_variant tests ────────────────────────────────────────────────────


def _gpu_machine(vram_mb, installed=("hunyuan_translate",)):
    return _machine(gpus=_nv_gpus(vram_mb), installed=frozenset(installed))


def _hymt2_7b():
    """Synthetic (non-catalog) TranslateModel replicating the pre-llamacpp shape of
    hy-mt2-7b: a gpu-cuda bf16 variant, a cpu float32 floor, and a gpu-cuda fp8
    variant. The real hy-mt2-7b catalog row moved to llamacpp/GGUF quants
    (Task 9), which bypasses this VRAM/format-aware logic entirely (see
    _is_llamacpp in accel.py) — this fixture keeps select_variant's still-live
    generic (non-llamacpp) path under test."""
    from sokuji_sidecar import catalog
    return catalog.TranslateModel("hy-mt2-7b-synthetic", "Hunyuan-MT2 7B (synthetic)", ("multi",), (
        catalog.Deployment("hunyuan_translate", "gpu-cuda", "bfloat16", "tencent/Hy-MT2-7B", 1.0),
        catalog.Deployment("hunyuan_translate", "cpu", "float32", "tencent/Hy-MT2-7B", 1.0),
        catalog.Deployment("hunyuan_translate", "gpu-cuda", "fp8", "tencent/Hy-MT2-7B-FP8", 1.0),
    ))


def test_select_variant_budget_from_tc_probe_totals(monkeypatch):
    # est_bytes: bf16 ~15GB, fp8 ~8GB. 16GB device total (tc probe), 2GB
    # reserve -> budget 13GB; bf16 needs 15x1.2=18GB, fp8 needs 8x1.5=12GB.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    m = _gpu_machine(16 * 1024)
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=2 * 1024**3)
    assert d.compute_type == "fp8"


def test_select_variant_fp8_dropped_when_compressed_tensors_absent(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: ct != "fp8")
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)
    m = _gpu_machine(12 * 1024)
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"                                    # fp8 ungated off, bf16 too big → cpu


def test_select_variant_prefers_bf16_when_it_fits(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 4, "fp8": 2, "float32": 4}[d.compute_type] * 1024**3)
    m = _gpu_machine(24 * 1024)
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.compute_type == "bfloat16"                       # both fit → highest quality


def test_select_variant_pin_honored_when_valid(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 4, "fp8": 2, "float32": 4}[d.compute_type] * 1024**3)
    m = _gpu_machine(24 * 1024)
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0, pin="fp8")
    assert d.compute_type == "fp8"                            # pinned despite bf16 fitting


def test_select_variant_conservative_when_no_vram(monkeypatch):
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 4 * 1024**3)
    m = _gpu_machine(0)                                       # probe couldn't read VRAM
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"                                    # never gamble → cpu floor


def test_select_variant_requires_available_gpu_tier(monkeypatch):
    # A machine with device memory but NO NVIDIA device (AMD seen by the tc
    # probe) must not pick a gpu-cuda variant just because a total exists.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 << 30)
    m = _machine(gpus=(("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),),
                 installed=frozenset({"hunyuan_translate"}))
    d = accel.select_variant(_hymt2_7b(), m, reserved_bytes=0)
    assert d.tier == "cpu"


def test_resolve_translate_explicit_device_override_unchanged(monkeypatch):
    # device override ("cuda"/"cpu") keeps prior tier-pinning behavior, not variant
    # selection. hy-mt2-7b's real backend moved to llamacpp_hunyuan (Task 9); the
    # synthetic-model default installed=("hunyuan_translate",) no longer matches it.
    monkeypatch.setattr(accel, "probe", lambda force=False:
                        _gpu_machine(12 * 1024, installed=("llamacpp_hunyuan",)))
    plans = accel.resolve_translate("hy-mt2-7b", override="cpu")
    assert plans[0].device == "cpu"


def test_resolve_translate_override_honors_quant_pin():
    # Regression: the explicit device-override path used to drop `pin`
    # entirely, so a pinned q8_0 silently resolved through whatever quant
    # _resolve_model's plain tier ranking picked (the rank-default, q4_k_m
    # for qwen3-0.6b, ignoring the pin). override='cpu' + pin='q8_0' must
    # yield ONLY q8_0 rows, cpu pinned to the front.
    m = _machine(gpus=_nv_gpus(),
                 installed=frozenset({"llamacpp_qwen"}))
    plans = accel.resolve_translate("qwen3-0.6b", override="cpu", pin="q8_0", machine=m)
    assert [p.device for p in plans] == ["cpu", "cuda"]
    assert all(p.compute_type == "q8_0" for p in plans)


def test_resolve_translate_override_without_pin_unchanged():
    # No pin -> unchanged behavior: every installed+tier-available deployment
    # across BOTH quants (mirrors test_resolve_translate_override_cpu_pins_front).
    m = _machine(gpus=_nv_gpus(),
                 installed=frozenset({"llamacpp_qwen"}))
    plans = accel.resolve_translate("qwen3-0.6b", override="cpu", machine=m)
    assert {p.compute_type for p in plans} == {"q8_0", "q4_k_m"}


def test_resolve_translate_override_cuda_sets_reserved(monkeypatch):
    # Regression: set_reserved_bytes used to run only on the 'auto' branch,
    # leaving the explicit device-override path (translationDevice: cuda|cpu,
    # a first-class UI control) with a stale/zero reserved-bytes figure, so
    # --fit-target would be sized wrong for a llamacpp cuda load.
    from sokuji_sidecar import llama_runtime as rt
    m = _machine(gpus=_nv_gpus(12288),
                 installed=frozenset({"llamacpp_qwen"}))
    accel.resolve_translate("qwen3-0.6b", override="cuda", reserved_bytes=654321, machine=m)
    assert rt.get_reserved_bytes() == 654321
    rt.set_reserved_bytes(0)


def test_list_variants_marks_supported_and_recommended(monkeypatch):
    # hy-mt2-7b's real catalog row moved to llamacpp/GGUF quants (Task 9), which
    # bypasses the VRAM-based supported/reason math via the _is_llamacpp dedupe
    # branch (see test_list_variants_dedupes_llamacpp). This test keeps the
    # generic (non-llamacpp) list_variants branch under test via a synthetic model,
    # monkeypatching catalog.translate_model since _h_list_variants looks models up
    # by id.
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


def test_fp8_weight_factor_larger_than_bf16_in_select_variant(monkeypatch):
    # FP8 dequantizes at inference time, so peak VRAM is ~1.5x weights (vs 1.2x for bf16).
    # On 12GiB Ada with no reserve: budget = 12-1 = 11GiB.
    # fp8 (8GiB * 1.5 = 12GiB) > 11GiB → must fall back to cpu floor.
    # On 16GiB Ada: budget = 15GiB; fp8 (12GiB) ≤ 15GiB → fp8 chosen.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes",
                        lambda d: {"bfloat16": 15, "fp8": 8, "float32": 15}[d.compute_type] * 1024**3)

    m12 = _gpu_machine(12 * 1024)
    d12 = accel.select_variant(_hymt2_7b(), m12, reserved_bytes=0)
    assert d12.tier == "cpu"  # fp8 8GB*1.5=12GB exceeds 11GB budget

    m16 = _gpu_machine(16 * 1024)
    d16 = accel.select_variant(_hymt2_7b(), m16, reserved_bytes=0)
    assert d16.compute_type == "fp8"  # fp8 12GB ≤ 15GB budget on 16GB card


def test_load_with_fallback_fp8_factor_gates_cuda(monkeypatch):
    # An fp8 plan should use factor 1.5; on a 12GiB free machine with 8GiB weights:
    # budget = 8*1.5 + 1GiB_context = 13GiB > 12GiB free → cuda proactively skipped.
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 12 * _GIB)
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 8 * _GIB)
    fp8_plan = accel.Plan("hunyuan_translate", "gpu-cuda", "cuda", "fp8", "repo", 1.0)
    cpu_pl = _plan("cpu")
    attempted = []
    class FakeBackend:
        def load(self, a, device, ct): attempted.append(device); self.loaded = True
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    backend, plan, notice = accel.load_with_fallback([fp8_plan, cpu_pl])
    assert plan.device == "cpu" and attempted == ["cpu"]
    assert notice and "CPU" in notice


def test_opus_translate_self_gates_on_ctranslate2_and_sentencepiece(monkeypatch):
    from sokuji_sidecar import accel
    real = accel.importlib.util.find_spec

    def present(name, *a, **k):
        if name in ("ctranslate2", "sentencepiece"):
            return object()
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", present)
    assert "ct2_opus_translate" in accel._installed()

    # ...and gates OFF when a required dep is missing — this half fails if the
    # dependency map names the wrong module, which the present-only check
    # (deps happen to be installed in the dev venv) would silently pass.
    def hide_ct2(name, *a, **k):
        return None if name == "ctranslate2" else object()
    monkeypatch.setattr(accel.importlib.util, "find_spec", hide_ct2)
    assert "ct2_opus_translate" not in accel._installed()


def test_resolve_translate_opus_is_cpu_only(monkeypatch):
    from sokuji_sidecar import accel
    # Opus-MT moved to a single cpu/int8 CTranslate2 deployment (no GPU tier);
    # a gpu-cuda deployment simply doesn't exist for this model any more.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 * 1024**3)  # 1 GiB, fits any GPU
    m = _machine(gpus=_nv_gpus(12288),
                 installed=frozenset({"ct2_opus_translate"}))
    plans = accel.resolve_translate("opus-mt-zh-en", "auto", m)
    assert [p.device for p in plans] == ["cpu"]
    assert all(p.backend == "ct2_opus_translate" for p in plans)
    assert plans[0].artifact == "jiangzhuo9357/opus-mt-zh-en-ct2"


def test_resolve_translate_hymt15_prefers_gpu(monkeypatch):
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 * 1024**3)  # 1 GiB, fits any GPU
    m = _machine(gpus=_nv_gpus(12288),
                 installed=frozenset({"llamacpp_hunyuan"}))
    plans = accel.resolve_translate("hy-mt15-1.8b", "auto", m)
    assert plans[0].device == "cuda"
    assert plans[-1].device == "cpu"
    assert all(p.backend == "llamacpp_hunyuan" for p in plans)
    # artifact is the upstream GGUF file artifact for whichever quant select_variant picked
    assert plans[0].artifact.startswith("tencent/HY-MT1.5-1.8B-GGUF/")


def test_resolve_tts_orders_gpu_over_cpu(monkeypatch):
    from sokuji_sidecar import accel
    # a machine with an NVIDIA GPU and both tts backends installed
    machine = _machine(gpus=_nv_gpus(12000),
                       installed=frozenset({"sherpa_tts", "moss_onnx"}))
    plans = accel.resolve_tts("moss-tts-nano", override="auto", machine=machine)
    assert plans[0].tier == "gpu-cuda" and plans[0].device == "cuda"
    assert plans[-1].tier == "cpu"  # cpu floor survives


def test_resolve_tts_cpu_only_machine(monkeypatch):
    from sokuji_sidecar import accel
    machine = _machine(installed=frozenset({"sherpa_tts", "moss_onnx"}))
    plans = accel.resolve_tts("moss-tts-nano", override="auto", machine=machine)
    assert [p.tier for p in plans] == ["cpu"]


def test_resolve_tts_unknown_model_raises():
    from sokuji_sidecar import accel
    import pytest
    with pytest.raises(ValueError):
        accel.resolve_tts("nope")


def test_resolve_tts_arbitrary_sherpa_repo_synthesizes_model():
    # The renderer's piper voice cards carry full HF repo paths as ids
    # (e.g. csukuangfj/vits-piper-en_US-libritts_r-medium); these are not in
    # the short sidecar catalog, but SherpaTtsBackend downloads/loads any repo,
    # so resolve_tts must synthesize an ad-hoc sherpa_tts model instead of raising.
    from sokuji_sidecar import accel
    repo = "csukuangfj/vits-piper-en_US-libritts_r-medium"
    machine = _machine(gpus=_nv_gpus(12000),
                       installed=frozenset({"sherpa_tts", "moss_onnx"}))
    plans = accel.resolve_tts(repo, override="auto", machine=machine)
    assert plans, "expected at least one plan for an arbitrary sherpa repo"
    assert all(p.backend == "sherpa_tts" for p in plans)
    assert all(p.artifact == repo for p in plans)
    assert plans[-1].tier == "cpu"  # cpu floor survives


def test_resolve_tts_unknown_non_sherpa_id_still_raises():
    from sokuji_sidecar import accel
    import pytest
    # An id with no sherpa-family hint must still raise (no blind synthesis).
    machine = _machine(installed=frozenset({"sherpa_tts", "moss_onnx"}))
    with pytest.raises(ValueError):
        accel.resolve_tts("some-org/random-llm-model", machine=machine)


def test_supertonic_installed_and_resolvable():
    # onnxruntime is a sidecar dependency → supertonic self-gates ON here, and
    # resolve_tts must produce a runnable plan (not raise NoUsablePlan).
    assert "supertonic" in accel._installed()
    plans = accel.resolve_tts("supertonic-3", override="cpu")
    assert plans and plans[0].backend == "supertonic"


def test_qwen3_backend_installed_and_resolvable():
    assert "qwen3tts_onnx" in accel._installed()
    plans = accel.resolve_tts("qwen3-tts-0.6b", override="cpu")
    assert plans and plans[0].backend == "qwen3tts_onnx"


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
    assert moss["numSpeakers"] >= 1 and "streaming" in moss


def test_models_catalog_carries_size_bytes_per_model():
    asr = _catalog("asr")
    tts = _catalog("tts")
    assert asr["sense-voice"]["sizeBytes"] > 0
    assert tts["csukuangfj/vits-piper-en_US-amy-low"]["sizeBytes"] == 81105784
    assert tts["csukuangfj/vits-zh-aishell3"]["sizeBytes"] == 123663994
    amy = tts["csukuangfj/vits-piper-en_US-amy-low"]
    assert amy["clones"] is False and amy["numSpeakers"] == 1
    assert amy["repo"] == "csukuangfj/vits-piper-en_US-amy-low"


# ── llamacpp-aware resolution/variant selection (Task 10) ──────────────────
# Named `_llm_machine` (not `_machine`) — the file already has a `_machine`
# helper with a different (kwargs-of-tuples) signature; redefining `_machine`
# here would silently replace it for the whole module and break every earlier
# test that calls it.


def _llm_machine(nvidia=False, apple=False):
    return _machine(gpus=_nv_gpus(12282) if nvidia else (),
                    apple=apple, installed=accel._installed())


def test_select_variant_llamacpp_default_and_pin():
    m = catalog.translate_model("translategemma-4b")
    mach = _llm_machine(nvidia=True)
    chosen = accel.select_variant(m, mach, reserved_bytes=0, pin=None)
    assert (chosen.compute_type, chosen.tier) == ("q4_k_m", "gpu-cuda")
    pinned = accel.select_variant(m, mach, reserved_bytes=0, pin="q8_0")
    assert (pinned.compute_type, pinned.tier) == ("q8_0", "gpu-cuda")


def test_select_variant_llamacpp_metal_and_cpu():
    m = catalog.translate_model("qwen3.5-2b")
    metal = accel.select_variant(m, _llm_machine(apple=True), 0, None)
    assert metal.tier == "gpu-metal"
    cpu = accel.select_variant(m, _llm_machine(), 0, None)
    assert cpu.tier == "cpu"


def test_resolve_translate_same_quant_cpu_floor(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _llm_machine(nvidia=True))
    plans = accel.resolve_translate("hy-mt2-1.8b", pin="q8_0")
    assert [(p.tier, p.compute_type) for p in plans] == [
        ("gpu-cuda", "q8_0"), ("cpu", "q8_0")]


def test_resolve_translate_sets_reserved(monkeypatch):
    from sokuji_sidecar import llama_runtime as rt
    monkeypatch.setattr(accel, "probe", lambda force=False: _llm_machine(nvidia=True))
    accel.resolve_translate("qwen2.5-0.5b", reserved_bytes=123456)
    assert rt.get_reserved_bytes() == 123456
    rt.set_reserved_bytes(0)


def test_vram_gate_skipped_for_llamacpp(monkeypatch):
    """The proactive free-VRAM check must not pre-skip llamacpp cuda plans —
    llama-server's --fit handles memory by partial offload."""
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 1 << 30)  # 1 GiB free
    monkeypatch.setattr(accel, "_model_weight_bytes", lambda a: 8 << 30)
    loaded = []

    class FakeBackend:
        def load(self, ref, device, ct):
            loaded.append(device)
    monkeypatch.setattr(accel, "make_backend", lambda name: FakeBackend())
    plans = [accel.Plan("llamacpp_gemma", "gpu-cuda", "cuda", "q4_k_m", "repo", 2.0),
             accel.Plan("llamacpp_gemma", "cpu", "cpu", "q4_k_m", "repo", 2.0)]
    _b, plan, notice = accel.load_with_fallback(plans)
    assert plan.device == "cuda" and notice is None
    assert loaded == ["cuda"]


def test_list_variants_dedupes_llamacpp(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _llm_machine(nvidia=True))
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
    assert by_id["opus-mt-ja-en"]["variantIds"] == ["int8"]


def test_speech_llms_resolve_vulkan_then_cpu_on_nvidia():
    # granite/qwen3/voxtral/cohere all share the transcribe_cpp rows now —
    # on an NVIDIA box they resolve vulkan first with a cpu floor.
    m = _machine(gpus=_nv_gpus(12288))
    for mid in ("granite-speech-4.1-2b", "qwen3-asr-1.7b",
                "voxtral-mini-4b-realtime", "cohere-transcribe-03-2026",
                "fun-asr-mlt-nano"):
        plans = accel.resolve(mid, machine=m)
        assert [p.device for p in plans] == ["vulkan", "cpu"], mid
        assert all(p.backend.startswith("transcribe_cpp") for p in plans), mid


def test_asr_unavailable_without_transcribe_cpp():
    # wheel missing → no ASR model resolves (installed gate)
    m = _machine(installed=frozenset())
    import pytest as _pytest
    with _pytest.raises(accel.NoUsablePlan):
        accel.resolve("whisper-base", machine=m)


# ── Phase E1: GPU identity + fresh memory reads ──────────────────────────────


class _FakeTcDev:
    def __init__(self, kind, desc, total, free, device_type="gpu"):
        self.kind = kind
        self.description = desc
        self.memory_total = total
        self.memory_free = free
        self.device_type = device_type


def _fake_tc_module(devs):
    import types
    mod = types.ModuleType("transcribe_cpp")
    mod.backends = lambda: devs
    return mod


def test_machine_gpus_stable_identity(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "transcribe_cpp", _fake_tc_module([
        _FakeTcDev("vulkan", "AMD Radeon RX 7800 XT", 16 << 30, 15 << 30),
        _FakeTcDev("cpu", "Ryzen 7", 64 << 30, 60 << 30, device_type="cpu"),
    ]))
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"transcribe_cpp"}))
    m = accel.probe(force=True)
    # gpus: STABLE identity only (kind, name, mem_total) — no volatile free
    assert m.gpus == (("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),)
    assert m.tc_kinds == ("cpu", "vulkan")


def test_fingerprint_ignores_volatile_free(monkeypatch):
    import sys
    def probe_with_free(free):
        monkeypatch.setitem(sys.modules, "transcribe_cpp", _fake_tc_module([
            _FakeTcDev("vulkan", "RTX 4070", 12 << 30, free)]))
        monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())
        monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
        monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
        monkeypatch.setattr(accel, "_installed", lambda: frozenset())
        return accel.probe(force=True).fingerprint
    assert probe_with_free(10 << 30) == probe_with_free(2 << 30)


def test_device_free_bytes_prefers_tc(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "transcribe_cpp", _fake_tc_module([
        _FakeTcDev("vulkan", "RTX 4070", 12 << 30, 9 << 30)]))
    assert accel.device_free_bytes() == 9 << 30


def test_device_free_bytes_nvml_fallback(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "transcribe_cpp", None)   # import fails
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: 7 << 30)
    assert accel.device_free_bytes() == 7 << 30


def test_device_free_bytes_none_without_gpu(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "transcribe_cpp", _fake_tc_module([
        _FakeTcDev("cpu", "Ryzen", 64 << 30, 60 << 30, device_type="cpu")]))
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)
    assert accel.device_free_bytes() is None


def test_ram_free_bytes_positive():
    n = accel.ram_free_bytes()
    assert n is None or n > 0


# ── Phase E2: translate quant = largest FULLY-resident (budget-aware) ────────


def _gemma():
    # translategemma-4b: default quant q4_k_m (rank 2.0, ~2.49GB), alt q8_0 (~4.13GB)
    return catalog.translate_model("translategemma-4b")


def _gpu_m():
    return _machine(gpus=_nv_gpus(12282),
                    installed=frozenset({"llamacpp_gemma", "transcribe_cpp"}))


def test_variant_plenty_of_budget_picks_largest_quant():
    # 10 GiB budget: q8_0 (4.13GB × 1.1 ≈ 4.5GB) fully fits → quality wins over
    # the curated q4 default.
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                             budget_bytes=10 << 30)
    assert d.compute_type == "q8_0" and d.tier != "cpu"


def test_variant_tight_budget_steps_down_to_default():
    # 3 GiB: q8 (4.5GB need) doesn't fit, q4 (2.49×1.1≈2.7GB) does.
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                             budget_bytes=3 << 30)
    assert d.compute_type == "q4_k_m" and d.tier != "cpu"


def test_variant_half_fits_keeps_gpu_via_fit():
    # 1.5 GiB: nothing fully fits, but ≥50% of the smallest quant (2.49GB)
    # → stay on GPU with --fit partial offload at the default quant.
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                             budget_bytes=int(1.5 * (1 << 30)))
    assert d.compute_type == "q4_k_m" and d.tier != "cpu"


def test_variant_starved_budget_goes_cpu():
    # 0.5 GiB: below 50% of the smallest quant → fully-CPU beats heavy offload.
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                             budget_bytes=1 << 29)
    assert d.tier == "cpu"


def test_variant_pin_beats_budget():
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                             budget_bytes=1 << 29, pin="q8_0")
    assert d.compute_type == "q8_0" and d.tier != "cpu"   # user's will, --fit copes


def test_variant_no_budget_reading_keeps_rank_default():
    # budget unknown (no GPU memory reading) → previous behavior: rank default.
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                             budget_bytes=None)
    assert d.compute_type == "q4_k_m" and d.tier != "cpu"


def test_variant_reserved_subtracts_from_budget():
    # 10 GiB budget but 7 GiB reserved for other stages → only q4 fits.
    d = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=7 << 30,
                             budget_bytes=10 << 30)
    assert d.compute_type == "q4_k_m" and d.tier != "cpu"


def test_resolve_translate_auto_matches_recommendation_basis(monkeypatch):
    # LOAD uses the SAME stable mem_total basis as the download recommendation
    # (we always run the downloaded file): a 12GB card recommends+loads q8_0
    # even under transient VRAM pressure (--fit handles placement).
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(12282),
                 installed=frozenset({"llamacpp_gemma"}))
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=m)
    assert plans[0].compute_type == "q8_0" and plans[0].device != "cpu"


def test_resolve_translate_auto_loads_the_downloaded_file(monkeypatch):
    # ... but when the user has (only) q4 downloaded, that IS the model we run.
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    m = _machine(gpus=_nv_gpus(12282),
                 installed=frozenset({"llamacpp_gemma"}))
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=m)
    assert plans[0].compute_type == "q4_k_m"


def test_list_variants_recommends_on_stable_total(monkeypatch):
    # recommendation keys on mem_total (12GB → q8 recommended) even when the
    # transient free is tiny — download advice must not flap session-to-session.
    m = _machine(gpus=_nv_gpus(12288), installed=frozenset({"llamacpp_gemma"}))
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    monkeypatch.setattr(accel, "device_free_bytes", lambda: 1 << 30)
    import asyncio as _a, json as _j
    from sokuji_sidecar import server as _srv
    st = {"handlers": {}}
    accel.register(st)
    reply, _ = _a.run(_srv.handle_message(
        st, _j.dumps({"type": "list_variants", "id": 9, "model": "translategemma-4b"}), None, None))
    assert reply["recommended"] == "q8_0"


# ── Phase E3: ASR quality ladder (budget-aware quant pick) ──────────────────


def test_asr_roomy_budget_upgrades_to_q8(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    # 12 GB card: cohere's q8_0 (2.41GB×1.15) fits → recommend the quality
    # rung. STABLE basis (mem_total) — this is a download recommendation.
    m = _machine(gpus=_nv_gpus(12282))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "q8_0" and plans[0].device == "vulkan"
    # one plan per tier — the ladder narrowed to ONE quant
    assert [p.device for p in plans] == ["vulkan", "cpu"]


def test_asr_tight_budget_keeps_default(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    # a 2 GB card: q8 (2.77GB need) never fits → default stays recommended
    m = _machine(gpus=_nv_gpus(2048))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "q4_k_m"


def test_asr_cpu_only_prefers_smallest_quant(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    # whisper-large-v3 defaults to q8_0, but CPU is bandwidth-bound: the
    # smallest quant (q4_k_m) is both faster and lighter there.
    plans = accel.resolve("whisper-large-v3", machine=_machine())
    assert [p.device for p in plans] == ["cpu"]
    assert plans[0].compute_type == "q4_k_m"


def test_asr_unknown_memory_keeps_default_on_gpu(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    # GPU present but no memory reading at all (vram_mb=0, no tc gpus) →
    # conservative default quant
    m = _machine(gpus=_nv_gpus())
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "q4_k_m" and plans[0].device == "vulkan"


def test_asr_pin_narrows_ladder(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(2048))  # q8 wouldn't fit
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m, pin="q8_0")
    assert all(p.compute_type == "q8_0" for p in plans)   # user's will


def test_asr_pin_listed_only_quant_honored(monkeypatch):
    """REGRESSION (PR #279 review): f16/q5_k_m are listed-only (rank 0.5,
    never auto-recommended) but fully pickable in the UI — a pin on them
    must win, not silently fall back to a curated rung."""
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(12282))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m, pin="f16")
    assert all(p.compute_type == "f16" for p in plans)


def test_asr_downloaded_listed_only_quant_loads(monkeypatch):
    """We always RUN the file the user downloaded — when the only cached
    quant is a listed-only rung (f16), auto must load it, not resolve to a
    curated quant that isn't on disk."""
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"f16"})
    m = _machine(gpus=_nv_gpus(12282))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "f16"


def test_asr_fresh_recommendation_never_listed_only(monkeypatch):
    # Unchanged download-recommendation semantics: nothing cached, roomy
    # 24GB GPU fits even f16, but the budget walk only considers curated
    # rungs — q8_0 stays the recommendation.
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(24564))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "q8_0"


def test_asr_single_quant_cards_unaffected(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(12282))
    plans = accel.resolve("sense-voice", machine=m)
    assert [p.compute_type for p in plans] == ["q8_0", "q8_0"]


def test_models_catalog_exposes_asr_variant_ids_and_deduped_tiers(monkeypatch):
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"transcribe_cpp", "transcribe_cpp_stream"}))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu",))
    monkeypatch.setattr(accel, "_tc_gpus", lambda: ())
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


def test_asr_quant_pick_prefers_downloaded(monkeypatch):
    # a 12GB card would recommend q8_0, but only q4_k_m is in the local cache
    # → we run the model the user downloaded, full stop.
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    m = _machine(gpus=_nv_gpus(12282))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "q4_k_m"


def test_translate_quant_pick_prefers_downloaded(monkeypatch):
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    m = _machine(gpus=_nv_gpus(12282),
                 installed=frozenset({"llamacpp_gemma"}))
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=m)
    assert plans[0].compute_type == "q4_k_m"


def test_quant_pick_ignores_download_state_when_nothing_cached(monkeypatch):
    # fresh machine, nothing downloaded: recommend by the stable basis (the
    # gate then walks the user through downloading that quant)
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(12282))
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].compute_type == "q8_0"


# ── Phase E4: cross-stage VRAM ledger ────────────────────────────────────────


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
        def load(self, a, d, c): pass
    monkeypatch.setattr(accel, "make_backend", lambda name: _B())
    plans = [accel.Plan("transcribe_cpp", "gpu-vulkan", "vulkan", "q8_0", "org/r/f.gguf", 1.0)]
    _b, plan, _n, mem = accel.load_measured(plans, stage="asr")
    assert mem == 2 << 30                          # vulkan delta measured (not cuda-only)
    assert accel.ledger_other("translate") == 2 << 30
    accel.ledger_release("asr")


def test_load_measured_cpu_claims_zero(monkeypatch):
    accel.ledger_reset()
    monkeypatch.setattr(accel, "_rss_bytes", lambda: 1 << 30)

    class _B:
        def load(self, a, d, c): pass
    monkeypatch.setattr(accel, "make_backend", lambda name: _B())
    plans = [accel.Plan("transcribe_cpp", "cpu", "cpu", "q8_0", "org/r/f.gguf", 1.0)]
    accel.load_measured(plans, stage="asr")
    assert accel.ledger_other("translate") == 0    # present but holds no VRAM
    assert "asr" in accel._LEDGER
    accel.ledger_release("asr")


# ── Phase E5(sidecar): full variant list precomputed in models_catalog ───────


def _catalog_reply(monkeypatch, gpus=(), kind="asr", models=None):
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed",
                        lambda: frozenset({"transcribe_cpp", "transcribe_cpp_stream", "llamacpp_gemma"}))
    monkeypatch.setattr(accel, "_tc_kinds", lambda: ("cpu", "vulkan") if gpus else ("cpu",))
    monkeypatch.setattr(accel, "_tc_gpus", lambda: gpus)
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
    # translate needs an NVIDIA/Metal machine (no vulkan llama flavor yet)
    by_id = _catalog_reply(monkeypatch, gpus=_nv_gpus(12288),
                           kind="translate", models=["translategemma-4b"])
    v = by_id["translategemma-4b"]["variants"]
    assert [x["id"] for x in v] == ["q8_0", "q4_k_m"]
    assert all(x["supported"] for x in v)     # llama always runs via --fit
    assert [x["id"] for x in v if x["recommended"]] == ["q8_0"]


# ── E4 tail: Apple unified memory — never go CPU for memory reasons ─────────


def _mac_machine(installed=frozenset({"llamacpp_gemma", "transcribe_cpp"})):
    return accel.Machine(os="Darwin", arch="arm64", cpu_cores=10, nvidia=(),
                         apple_silicon=True, dml_adapters=(), installed=installed,
                         fingerprint="mac", tc_kinds=("cpu", "metal"),
                         gpus=(("metal", "Apple M2", 16 << 30),))


def test_llamacpp_unified_memory_never_degrades_to_cpu_for_memory():
    # Starved budget on Apple Silicon: CPU shares the SAME memory pool, so
    # moving there frees nothing — stay on metal, --fit handles pressure.
    d = accel.select_variant(_gemma(), _mac_machine(), reserved_bytes=0,
                             budget_bytes=1 << 29)
    assert d.tier == "gpu-metal"
    # discrete-GPU machine with the same budget still bails to cpu (E2 rule)
    d2 = accel.select_variant(_gemma(), _gpu_m(), reserved_bytes=0,
                              budget_bytes=1 << 29)
    assert d2.tier == "cpu"


# ── E6: bench demotion for the translate AUTO path (tps-keyed) ──────────────


def test_translate_auto_demotes_gpu_when_bench_says_cpu_faster(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(12282),
                 installed=frozenset({"llamacpp_gemma"}))
    # measured: gpu decodes SLOWER than cpu (tps lower) for the chosen quant
    accel.bench_save({
        "tps:" + accel._bench_key(m.fingerprint, "translategemma-4b", "llamacpp_gemma", "cuda", "q8_0"): 5.0,
        "tps:" + accel._bench_key(m.fingerprint, "translategemma-4b", "llamacpp_gemma", "cpu", "q8_0"): 12.0,
    })
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=m)
    assert plans[0].device == "cpu"        # demoted: cpu decodes faster here


def test_translate_auto_keeps_gpu_without_bench(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    m = _machine(gpus=_nv_gpus(12282),
                 installed=frozenset({"llamacpp_gemma"}))
    plans = accel.resolve_translate("translategemma-4b", "auto", machine=m)
    assert plans[0].device == "cuda"       # no measurements → estimate order


def test_asr_bench_demotion_uses_quant_keyed_entries(tmp_path, monkeypatch):
    # post-E3 narrowing: plans carry ONE quant; bench keys must match it
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: {"q4_k_m"})
    m = _machine(gpus=_nv_gpus(12282))
    accel.bench_save({
        accel._bench_key(m.fingerprint, "cohere-transcribe-03-2026", "transcribe_cpp", "vulkan", "q4_k_m"): 0.9,
        accel._bench_key(m.fingerprint, "cohere-transcribe-03-2026", "transcribe_cpp", "cpu", "q4_k_m"): 0.2,
    })
    plans = accel.resolve("cohere-transcribe-03-2026", machine=m)
    assert plans[0].device == "cpu"        # measured slower on GPU → demoted


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
