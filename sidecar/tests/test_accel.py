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
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "funasr_sensevoice"}))
    accel.probe(force=True)
    plans = accel.resolve("sense-voice")
    assert plans[0].backend == "funasr_sensevoice" and plans[0].device == "cpu"


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
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "funasr_sensevoice"}))
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
        {"tier": "gpu-cuda", "backend": "funasr_sensevoice", "available": False},
        {"tier": "cpu", "backend": "funasr_sensevoice", "available": True},
    ]
    assert by_id["whisper-large-v3"]["recommended"] is True
    assert by_id["whisper-base"]["recommended"] is False


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


def test_sense_voice_resolves_gpu_when_present():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"funasr_sensevoice"}))
    plans = accel.resolve("sense-voice", machine=m)
    assert [p.device for p in plans] == ["cuda", "cpu"]  # GPU preferred, CPU floor survives


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
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))
    accel.probe(force=True)
    # seed the cache keyed by the machine we resolve for (m.fingerprint == "test")
    fp = m.fingerprint
    accel.bench_save({
        accel._bench_key(fp, "whisper-tiny", "ctranslate2", "cuda", "float16"): 0.8,
        accel._bench_key(fp, "whisper-tiny", "ctranslate2", "cpu", "int8"): 0.3,
    })
    plans = accel.resolve("whisper-tiny", machine=m)
    assert plans[0].device == "cpu"  # demoted: cpu now leads


def test_resolve_override_beats_demotion(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),))
    fp = m.fingerprint
    # cache says cuda is slower than cpu — AUTO would demote, but an explicit
    # override must win (the benchmark never overrides the user's forced device).
    accel.bench_save({
        accel._bench_key(fp, "whisper-tiny", "ctranslate2", "cuda", "float16"): 0.8,
        accel._bench_key(fp, "whisper-tiny", "ctranslate2", "cpu", "int8"): 0.3,
    })
    plans = accel.resolve("whisper-tiny", override="cuda", machine=m)
    assert plans[0].device == "cuda"  # explicit override beats cache demotion


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


def test_installed_includes_transformers():
    # transformers is a sidecar dependency → detected by _installed()
    assert "transformers" in accel._installed()


def test_voxtral_readiness_requires_mistral_common(monkeypatch):
    # VoxtralRealtimeBackend.load() needs both the transformers voxtral_realtime model AND
    # mistral_common (processor/tokenizer). A half-installed env (model present, mistral_common
    # missing) must NOT advertise voxtral_realtime, else the catalog shows it but load() fails.
    monkeypatch.setattr(accel, "_has_mod", lambda m: m != "mistral_common")  # all present except mistral_common
    assert "voxtral_realtime" not in accel._installed()
    monkeypatch.setattr(accel, "_has_mod", lambda m: True)                   # both present
    assert "voxtral_realtime" in accel._installed()


def test_granite_resolves_gpu_only_on_nvidia_with_transformers():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),), installed=frozenset({"transformers"}))
    plans = accel.resolve("granite-speech-4.1-2b", machine=m)
    assert [p.device for p in plans] == ["cuda"]   # gpu-only → single plan, no cpu floor
    assert plans[0].backend == "transformers" and plans[0].compute_type == "bfloat16"


def test_granite_gated_off_on_cpu_only_machine():
    # no nvidia → gpu-cuda filtered → no plan → NoUsablePlan (gated off)
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve("granite-speech-4.1-2b",
                      machine=_machine(installed=frozenset({"transformers"})))


def test_granite_gated_off_without_transformers_installed():
    # has a GPU but transformers not installed → backend filtered → NoUsablePlan
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve("granite-speech-4.1-2b",
                      machine=_machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                                       installed=frozenset({"ctranslate2"})))


def test_qwen3asr_model_unavailable_without_runtime(monkeypatch):
    from sokuji_sidecar import accel, catalog
    # a GPU machine, but qwen3asr backend not installed (transformers lacks qwen3_asr)
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"ctranslate2", "sherpa", "transformers"}),
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("qwen3-asr-1.7b"), m)
    assert plans == []     # gated off: no usable deployment


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


def test_installed_find_spec_raise_does_not_nuke_whole_set(monkeypatch):
    """_installed() must never raise when find_spec raises for a sub-module.
    The qwen3asr entry can trigger ModuleNotFoundError if `transformers` itself
    is absent; the guarded _has_mod() helper must absorb the exception and keep
    all other present backends in the returned frozenset."""
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def raising_find_spec(name, *a, **k):
        if name == "transformers.models.qwen3_asr":
            raise ModuleNotFoundError("no module named transformers.models.qwen3_asr")
        return real(name, *a, **k)

    monkeypatch.setattr(accel.importlib.util, "find_spec", raising_find_spec)
    result = accel._installed()          # must NOT raise
    assert "qwen3asr" not in result      # the raising entry is excluded …
    assert "transformers" in result      # … but other present backends survive


def test_cohereasr_resolves_gpu_on_nvidia_with_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"cohere_transformers", "transformers"}),
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("cohere-transcribe-03-2026"), m)
    assert [p.device for p in plans] == ["cuda"]
    assert plans[0].backend == "cohere_transformers" and plans[0].compute_type == "bfloat16"


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
    assert "cohere_transformers" not in accel._installed()


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (NVIDIA GPU + CUDA torch + transformers + Granite cached)")
def test_real_gpu_granite_transcribes(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))  # isolate the bench cache
    accel.probe(force=True)
    plans = accel.resolve("granite-speech-4.1-2b-plus")
    assert plans[0].device == "cuda" and plans[0].backend == "transformers", \
        f"expected transformers/cuda, got {[(p.backend, p.device) for p in plans]}"
    backend, plan, _notice = accel.load_with_fallback(plans)
    try:
        from huggingface_hub import snapshot_download
        import wave
        d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        w = wave.open(f"{d}/test_wavs/en.wav", "rb")
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        text = backend.transcribe(audio, None).text.lower()
        assert "gold" in text or "tribal" in text, f"unexpected transcript: {text!r}"
        rtf = accel.measure_rtf(backend, plan, "granite-speech-4.1-2b-plus", accel.probe(), force=True)
        assert rtf is not None and rtf < 1.0, f"speech-LLM should be faster than realtime on GPU, rtf={rtf}"
    finally:
        backend.unload()


def test_voxtral_realtime_gated_on_voxtral_realtime_module(monkeypatch):
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def absent(name, *a, **k):
        if name == "transformers.models.voxtral_realtime":
            return None
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", absent)
    assert "voxtral_realtime" not in accel._installed()

    def present(name, *a, **k):
        if name == "transformers.models.voxtral_realtime":
            return object()
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", present)
    assert "voxtral_realtime" in accel._installed()


def test_voxtral_resolves_gpu_on_nvidia_with_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"voxtral_realtime", "transformers"}),
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("voxtral-mini-4b-realtime"), m)
    assert [p.device for p in plans] == ["cuda"]
    assert plans[0].backend == "voxtral_realtime" and plans[0].compute_type == "bfloat16"


def test_voxtral_model_unavailable_without_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"ctranslate2", "sherpa", "transformers"}),  # no voxtral_realtime
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("voxtral-mini-4b-realtime"), m)
    assert plans == []     # GPU-only + runtime absent → no usable deployment


def test_resolve_translate_prefers_gpu():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"qwen_translate"}))
    plans = accel.resolve_translate("qwen2.5-0.5b", "auto", m)
    assert [p.device for p in plans] == ["cuda", "cpu"]
    assert plans[0].artifact == "Qwen/Qwen2.5-0.5B-Instruct"


def test_resolve_translate_cpu_only_machine():
    m = _machine(installed=frozenset({"qwen_translate"}))
    plans = accel.resolve_translate("qwen3-0.6b", "auto", m)
    assert [p.device for p in plans] == ["cpu"]


def test_resolve_translate_override_cpu_pins_front():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"qwen_translate"}))
    plans = accel.resolve_translate("qwen3-0.6b", "cpu", m)
    assert [p.device for p in plans] == ["cpu", "cuda"]


def test_resolve_translate_qwen35_self_gates_off():
    # transformers lacks qwen3_5 → qwen35_translate not installed → no plan.
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"qwen_translate"}))
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve_translate("qwen3.5-0.8b", "auto", m)


def test_resolve_translate_unknown_id_raises():
    with pytest.raises(ValueError):
        accel.resolve_translate("nope", "auto", _machine())


def test_models_catalog_kind_translate_returns_qwen_rows(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(
        nvidia=(accel.Gpu("nvidia", "x", 0),), installed=frozenset({"qwen_translate"})))
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
