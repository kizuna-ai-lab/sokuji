import asyncio
import json
import os
import tempfile

import pytest
from sokuji_sidecar import accel
from sokuji_sidecar import catalog
from sokuji_sidecar import backends
from sokuji_sidecar import server

os.environ.setdefault("SOKUJI_BENCH_DIR", tempfile.mkdtemp())


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
    assert [p.device for p in plans] == ["cpu", "cuda"]  # CPU pinned to front, GPU still present


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
    assert by_id["whisper-large-v3"]["recommended"] is False
    assert by_id["whisper-base"]["recommended"] is True


def test_models_catalog_filter_narrows_results(monkeypatch):
    monkeypatch.setattr(accel, "_nvidia_gpus", lambda: ())
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
