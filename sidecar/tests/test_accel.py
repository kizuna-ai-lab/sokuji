import pytest
from sokuji_sidecar import accel
from sokuji_sidecar import catalog


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
