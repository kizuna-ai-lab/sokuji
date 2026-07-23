import pytest

from sokuji_sidecar.omnivoice import runtime


def _capture_factory(calls):
    def factory(path, providers, sess_options):
        calls.append((path, providers))
        return object()
    return factory


def test_graph_files_cover_the_pipeline():
    keys = set(runtime.GRAPH_FILES)
    assert keys == {
        "audio_embeddings", "llm_decoder", "audio_heads",
        "acoustic_encoder", "semantic_encoder", "quantizer_encoder",
        "higgs_decoder",
    }


def test_higgs_graphs_stay_on_cpu_under_cuda():
    calls = []
    runtime.build_sessions("/m", "/higgs", "cuda", 4,
                           session_factory=_capture_factory(calls))
    by_path = {p: prov for p, prov in calls}

    # All cold (higgs) graphs must have CPU-only providers
    for key in runtime.COLD_GRAPHS:
        path = "/higgs/" + runtime.GRAPH_FILES[key]
        assert by_path[path] == ["CPUExecutionProvider"]

    # Hot graph (llm_decoder) must contain CUDA
    hot = "/m/" + runtime.GRAPH_FILES["llm_decoder"]
    providers = by_path[hot]
    assert len(providers) >= 1
    assert isinstance(providers[0], tuple)
    assert providers[0][0] == "CUDAExecutionProvider"


def test_cpu_device_uses_cpu_everywhere():
    calls = []
    runtime.build_sessions("/m", "/higgs", "cpu", 4,
                           session_factory=_capture_factory(calls))
    assert all(prov == ["CPUExecutionProvider"] for _, prov in calls)


def test_build_sessions_keys(tmp_path, monkeypatch):
    seen = []

    def fake_factory(path, providers, sess_options):
        seen.append(path.split("/")[-1])

        class S:  # minimal stub
            def get_providers(self):
                return providers
        return S()

    for f in ["audio_embeddings_encoder.onnx", "llm_decoder.onnx",
              "audio_heads_decoder.onnx"]:
        (tmp_path / f).write_bytes(b"x")
    hg = tmp_path / "audio_tokenizer"
    hg.mkdir()
    for f in ["acoustic_encoder.onnx", "semantic_encoder.onnx",
              "quantizer_encoder.onnx", "higgs_decoder.onnx"]:
        (hg / f).write_bytes(b"x")

    s = runtime.build_sessions(str(tmp_path), str(hg), "cpu", 4,
                                session_factory=fake_factory)
    assert set(s) == {
        "audio_embeddings", "llm_decoder", "audio_heads",
        "acoustic_encoder", "semantic_encoder", "quantizer_encoder",
        "higgs_decoder",
    }
    assert len(seen) == 7
    assert set(seen) == {
        "audio_embeddings_encoder.onnx", "llm_decoder.onnx",
        "audio_heads_decoder.onnx", "acoustic_encoder.onnx",
        "semantic_encoder.onnx", "quantizer_encoder.onnx",
        "higgs_decoder.onnx",
    }


def test_all_seven_sessions_built():
    calls = []
    sessions = runtime.build_sessions("/m", "/higgs", "cpu", 4,
                                      session_factory=_capture_factory(calls))
    assert len(calls) == 7 and len(sessions) == 7


class _FakeSession:
    """Fake session exposing get_providers(), mirroring the real ORT
    InferenceSession attribute the CUDA fail-fast check inspects."""
    def __init__(self, providers):
        self._providers = providers

    def get_providers(self):
        return self._providers


def test_cuda_device_raises_when_hot_session_silently_falls_back_to_cpu():
    def factory(path, providers, sess_options):
        return _FakeSession(["CPUExecutionProvider"])

    with pytest.raises(RuntimeError):
        runtime.build_sessions("/m", "/higgs", "cuda", 4, session_factory=factory)


def test_cuda_device_does_not_raise_when_hot_session_has_cuda_provider():
    def factory(path, providers, sess_options):
        return _FakeSession(["CUDAExecutionProvider", "CPUExecutionProvider"])

    sessions = runtime.build_sessions("/m", "/higgs", "cuda", 4,
                                      session_factory=factory)
    assert len(sessions) == 7


def test_cuda_device_does_not_raise_for_cold_higgs_graph_on_cpu():
    # Cold (higgs) graphs are pinned to CPU even under device="cuda" and
    # must NOT trip the hot-graph CUDA fail-fast check. Real ORT sessions
    # report get_providers() as plain provider-name strings regardless of
    # whether options were passed as (name, opts) tuples, so normalize
    # here the same way.
    def factory(path, providers, sess_options):
        names = [p[0] if isinstance(p, tuple) else p for p in providers]
        return _FakeSession(names)

    sessions = runtime.build_sessions("/m", "/higgs", "cuda", 4,
                                      session_factory=factory)
    assert len(sessions) == 7
