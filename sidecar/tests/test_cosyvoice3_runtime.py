import pytest

from sokuji_sidecar.cosyvoice3 import runtime


def _capture_factory(calls):
    def factory(path, providers, sess_options):
        calls.append((path, providers))
        return object()
    return factory


def test_graph_files_cover_the_pipeline():
    keys = set(runtime.GRAPH_FILES)
    assert keys == {
        "text_embedding", "speech_tokenizer", "campplus",
        "llm_initial", "llm_decode", "llm_decoder", "speech_embedding",
        "flow_token_embedding", "flow_spk_projection", "flow_pre_lookahead",
        "flow_estimator", "hift_f0", "hift_source", "hift_decoder",
    }
    assert runtime.GRAPH_FILES["llm_decode"] == "onnx/llm_backbone_decode_int4.onnx"
    assert runtime.GRAPH_FILES["flow_estimator"] == "onnx/flow_estimator.onnx"


def test_cold_graphs_stay_on_cpu_under_cuda():
    calls = []
    runtime.build_sessions("/m", "cuda", 4, session_factory=_capture_factory(calls))
    by_path = {p: prov for p, prov in calls}

    # All cold graphs must have CPU-only providers
    for key in runtime.COLD_GRAPHS:
        path = "/m/" + runtime.GRAPH_FILES[key]
        assert by_path[path] == ["CPUExecutionProvider"]

    # Hot graph (llm_decode) must contain CUDA
    hot = "/m/" + runtime.GRAPH_FILES["llm_decode"]
    providers = by_path[hot]
    assert len(providers) >= 1
    # First provider should be a tuple with CUDAExecutionProvider
    assert isinstance(providers[0], tuple)
    assert providers[0][0] == "CUDAExecutionProvider"


def test_cpu_device_uses_cpu_everywhere():
    calls = []
    runtime.build_sessions("/m", "cpu", 4, session_factory=_capture_factory(calls))
    assert all(prov == ["CPUExecutionProvider"] for _, prov in calls)


def test_all_fourteen_sessions_built():
    calls = []
    sessions = runtime.build_sessions("/m", "cpu", 4,
                                      session_factory=_capture_factory(calls))
    assert len(calls) == 14 and len(sessions) == 14


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
        runtime.build_sessions("/m", "cuda", 4, session_factory=factory)


def test_cuda_device_does_not_raise_when_hot_session_has_cuda_provider():
    def factory(path, providers, sess_options):
        return _FakeSession(["CUDAExecutionProvider", "CPUExecutionProvider"])

    sessions = runtime.build_sessions("/m", "cuda", 4, session_factory=factory)
    assert len(sessions) == 14
