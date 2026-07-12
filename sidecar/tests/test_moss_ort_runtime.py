"""DirectML (spec D1/D2) provider selection + session verification in the
vendored MOSS ORT runtime. No real DML session is created (the dev box is
Linux+NVIDIA): ort.get_available_providers / ort.InferenceSession are stubbed."""
from pathlib import Path

import pytest

from sokuji_sidecar.moss_tts import ort_runtime as rt


def test_normalize_accepts_dml_spellings():
    for raw in ("dml", "DML", "gpu-dml", "DmlExecutionProvider"):
        assert rt._normalize_execution_provider(raw) == rt.EXECUTION_PROVIDER_DML


def test_normalize_still_accepts_cpu_and_cuda():
    assert rt._normalize_execution_provider("cpu") == rt.EXECUTION_PROVIDER_CPU
    assert rt._normalize_execution_provider("cuda") == rt.EXECUTION_PROVIDER_CUDA
    assert rt._normalize_execution_provider("gpu") == rt.EXECUTION_PROVIDER_CUDA


def test_normalize_rejects_unknown():
    with pytest.raises(ValueError):
        rt._normalize_execution_provider("vulkan")


def test_resolve_providers_dml_returns_dml_list(monkeypatch):
    monkeypatch.setattr(rt.ort, "get_available_providers",
                        lambda: ["DmlExecutionProvider", "CPUExecutionProvider"])
    assert rt._resolve_ort_providers("dml") == ["DmlExecutionProvider", "CPUExecutionProvider"]


def test_resolve_providers_dml_missing_raises(monkeypatch):
    monkeypatch.setattr(rt.ort, "get_available_providers",
                        lambda: ["CPUExecutionProvider"])
    with pytest.raises(RuntimeError):
        rt._resolve_ort_providers("dml")


def test_resolve_providers_dml_does_not_preload_cuda(monkeypatch):
    # preload_dlls is CUDA-only (cuDNN/cuBLAS/MSVC); the DML branch must never call it.
    monkeypatch.setattr(rt.ort, "get_available_providers",
                        lambda: ["DmlExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setattr(rt.ort, "preload_dlls",
                        lambda *a, **k: pytest.fail("preload_dlls called on the DML path"),
                        raising=False)
    assert rt._resolve_ort_providers("dml") == ["DmlExecutionProvider", "CPUExecutionProvider"]


def _bare_runtime(execution_provider):
    # Build an OrtCpuRuntime without running __init__ (which loads real models);
    # _session only reads execution_provider / ort_providers / thread_count.
    obj = rt.OrtCpuRuntime.__new__(rt.OrtCpuRuntime)
    obj.execution_provider = execution_provider
    obj.ort_providers = ["DmlExecutionProvider", "CPUExecutionProvider"]
    obj.thread_count = 1
    return obj


def test_session_returns_when_dml_present(monkeypatch):
    class _Sess:
        def __init__(self, *a, **k):
            pass
        def get_providers(self):
            return ["DmlExecutionProvider", "CPUExecutionProvider"]
    monkeypatch.setattr(rt.ort, "InferenceSession", _Sess)
    r = _bare_runtime(rt.EXECUTION_PROVIDER_DML)
    assert isinstance(r._session(Path("x.onnx")), _Sess)


def test_session_raises_when_dml_absent(monkeypatch):
    class _Sess:
        def __init__(self, *a, **k):
            pass
        def get_providers(self):
            return ["CPUExecutionProvider"]  # DirectML silently dropped
    monkeypatch.setattr(rt.ort, "InferenceSession", _Sess)
    r = _bare_runtime(rt.EXECUTION_PROVIDER_DML)
    with pytest.raises(RuntimeError):
        r._session(Path("x.onnx"))
