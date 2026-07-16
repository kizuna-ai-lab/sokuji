import os

import numpy as np
import pytest

from sokuji_sidecar.gpt_sovits import runtime


def test_fp16_expansion_roundtrip(tmp_path):
    src = np.array([1.0, -0.5, 2.25, 0.0], dtype=np.float16)
    p16 = tmp_path / "vits_fp16.bin"
    src.tofile(p16)
    written = runtime.ensure_fp32_bins(str(tmp_path))
    p32 = tmp_path / "vits_fp32.bin"
    assert str(p32) in written and p32.exists()
    out = np.fromfile(p32, dtype=np.float32)
    np.testing.assert_array_equal(out, src.astype(np.float32))


def test_fp16_expansion_is_idempotent(tmp_path):
    np.zeros(8, dtype=np.float16).tofile(tmp_path / "t2s_shared_fp16.bin")
    first = runtime.ensure_fp32_bins(str(tmp_path))
    assert first
    mtime = os.path.getmtime(tmp_path / "t2s_shared_fp32.bin")
    second = runtime.ensure_fp32_bins(str(tmp_path))
    assert second == []
    assert os.path.getmtime(tmp_path / "t2s_shared_fp32.bin") == mtime


def test_fp16_expansion_rewrites_on_size_mismatch(tmp_path):
    np.zeros(8, dtype=np.float16).tofile(tmp_path / "vits_fp16.bin")
    (tmp_path / "vits_fp32.bin").write_bytes(b"garbage")
    written = runtime.ensure_fp32_bins(str(tmp_path))
    assert written  # stale/corrupt fp32 replaced
    assert (tmp_path / "vits_fp32.bin").stat().st_size == 8 * 4


def test_providers_for_cpu():
    assert runtime.providers_for("cpu") == ["CPUExecutionProvider"]


def test_providers_for_cuda_requires_available(monkeypatch):
    import onnxruntime as ort
    monkeypatch.setattr(ort, "get_available_providers",
                        lambda: ["CPUExecutionProvider"])
    with pytest.raises(RuntimeError, match="CUDA"):
        runtime.providers_for("cuda")


def test_providers_for_unknown_device():
    with pytest.raises(RuntimeError):
        runtime.providers_for("dml")


class _FakeSession:
    def __init__(self, path, sess_options=None, providers=None):
        self._providers = list(providers or [])
    def get_providers(self):
        # simulate ORT silently dropping CUDA (the issue-#277 class of bug)
        return ["CPUExecutionProvider"]


def test_make_session_raises_when_cuda_silently_drops(monkeypatch, tmp_path):
    import onnxruntime as ort
    monkeypatch.setattr(ort, "get_available_providers",
                        lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setattr(ort, "InferenceSession", _FakeSession)
    (tmp_path / "m.onnx").write_bytes(b"")
    with pytest.raises(RuntimeError, match="CUDA"):
        runtime.make_session(str(tmp_path / "m.onnx"), "cuda")


class _HonestSession(_FakeSession):
    def get_providers(self):
        return self._providers


def test_build_model_sessions_optional_prompt_encoder(monkeypatch, tmp_path):
    import onnxruntime as ort
    monkeypatch.setattr(ort, "InferenceSession", _HonestSession)
    for g in ("t2s_encoder_fp32.onnx", "t2s_first_stage_decoder_fp32.onnx",
              "t2s_stage_decoder_fp32.onnx", "vits_fp32.onnx"):
        (tmp_path / g).write_bytes(b"")
    sessions = runtime.build_model_sessions(str(tmp_path), "cpu")
    assert set(sessions) == {"t2s_encoder_fp32.onnx", "t2s_first_stage_decoder_fp32.onnx",
                             "t2s_stage_decoder_fp32.onnx", "vits_fp32.onnx"}
