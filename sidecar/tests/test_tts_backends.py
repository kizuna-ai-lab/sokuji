import os
import numpy as np
import pytest
from sokuji_sidecar import backends, tts_backends  # noqa: F401 (registers backends)


def test_sherpa_tts_registered_and_flags():
    b = backends.make_backend("sherpa_tts")
    assert b.NAME == "sherpa_tts" and b.STREAMING is False and b.CLONES is False
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TTS"),
                    reason="set SOKUJI_RUN_TTS=1 (downloads the piper model)")
def test_sherpa_tts_cpu_smoke():
    from huggingface_hub import snapshot_download
    snapshot_download("csukuangfj/vits-piper-en_US-amy-low")  # populate cache
    b = backends.make_backend("sherpa_tts")
    b.load("csukuangfj/vits-piper-en_US-amy-low", "cpu", "fp32")
    assert b.is_loaded and b.sample_rate > 0
    samples, gen_ms = b.generate("hello world", 1.0)
    assert isinstance(samples, np.ndarray) and samples.size > 0 and gen_ms >= 0
    b.unload(); assert b.is_loaded is False


def test_moss_onnx_registered_and_flags():
    b = backends.make_backend("moss_onnx")
    assert b.NAME == "moss_onnx" and b.STREAMING is True and b.CLONES is True
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TTS"),
                    reason="set SOKUJI_RUN_TTS=1 (downloads MOSS-TTS-Nano ONNX assets)")
def test_moss_onnx_cpu_streaming_smoke():
    from huggingface_hub import snapshot_download
    snapshot_download("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
    snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
    b = backends.make_backend("moss_onnx")
    b.load("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX", "cpu", "fp32")
    assert b.is_loaded and b.sample_rate > 0
    chunks = list(b.generate_stream("hello world", 1.0))
    assert len(chunks) >= 1 and all(c.dtype == np.float32 for c in chunks)
    full, gen_ms = b.generate("hello world", 1.0)
    assert full.size > 0 and gen_ms >= 0
    b.unload(); assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (CUDA + MOSS ONNX assets)")
def test_moss_onnx_cuda_streaming_smoke():
    import time
    from huggingface_hub import snapshot_download
    snapshot_download("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX")
    snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
    b = backends.make_backend("moss_onnx")
    b.load("OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX", "cuda", "fp32")
    t0 = time.perf_counter()
    chunks = list(b.generate_stream("The weather is lovely today.", 1.0))
    audio_s = sum(c.size for c in chunks) / b.sample_rate
    rtf = (time.perf_counter() - t0) / max(audio_s, 1e-6)
    print(f"moss-onnx cuda streaming RTF={rtf:.4f} (~{1/rtf:.1f}x realtime)")
    assert chunks and rtf < 1.0          # must be real-time on the GPU
    b.unload()


def test_set_builtin_voice_sets_voice_rows_from_manifest(monkeypatch):
    from sokuji_sidecar.tts_backends import MossOnnxTtsBackend
    b = MossOnnxTtsBackend()
    class FakeRt:
        def list_builtin_voices(self):
            return [{"voice": "Ava", "prompt_audio_codes": [[1, 2]]},
                    {"voice": "Bella", "prompt_audio_codes": [[3, 4]]}]
    b._rt = FakeRt()
    b.set_builtin_voice("Bella")
    assert b._voice_rows == [[3, 4]]

def test_set_builtin_voice_unknown_name_raises():
    from sokuji_sidecar.tts_backends import MossOnnxTtsBackend, BackendLoadError
    b = MossOnnxTtsBackend()
    class FakeRt:
        def list_builtin_voices(self): return [{"voice": "Ava", "prompt_audio_codes": [[1]]}]
    b._rt = FakeRt()
    import pytest
    with pytest.raises(Exception):
        b.set_builtin_voice("Nope")


from sokuji_sidecar.tts_backends import SherpaTtsBackend


class _FakeOfflineTts:
    sample_rate = 16000
    def __init__(self): self.calls = []
    def generate(self, text, sid=0, speed=1.0):
        self.calls.append(sid)
        class _A: samples = [0.0]
        return _A()


def test_sherpa_generate_uses_selected_speaker():
    b = SherpaTtsBackend()
    b._tts = _FakeOfflineTts()
    b.set_speaker(7)
    b.generate("hello")
    assert b._tts.calls == [7]


def test_sherpa_defaults_to_speaker_zero():
    b = SherpaTtsBackend()
    b._tts = _FakeOfflineTts()
    b.generate("hello")
    assert b._tts.calls == [0]


import sys as _sys
import types as _types


@pytest.mark.parametrize("device,expected", [("cpu", "cpu"), ("cuda", "cuda"), ("dml", "dml")])
def test_moss_load_maps_device_to_execution_provider(monkeypatch, tmp_path, device, expected):
    """MossOnnxTtsBackend.load must hand OrtCpuRuntime the device label unchanged
    for cuda/dml and 'cpu' otherwise. The runtime itself (provider list, session
    verification) is covered by test_moss_ort_runtime.py; here it is stubbed."""
    from sokuji_sidecar import tts_backends as tb
    captured = {}

    class FakeRt:
        def __init__(self, model_dir, execution_provider, thread_count):
            captured["ep"] = execution_provider
            self.codec_meta = {"codec_config": {"sample_rate": 24000}}

    monkeypatch.setattr("sokuji_sidecar.moss_tts.ort_runtime.OrtCpuRuntime", FakeRt)
    monkeypatch.setitem(_sys.modules, "sentencepiece",
                        _types.SimpleNamespace(SentencePieceProcessor=lambda model_file: object()))
    monkeypatch.setitem(_sys.modules, "huggingface_hub",
                        _types.SimpleNamespace(
                            snapshot_download=lambda repo_id, local_files_only=True: str(tmp_path)))
    monkeypatch.setattr(tb.MossOnnxTtsBackend, "_stage_layout",
                        staticmethod(lambda lm, tok: str(tmp_path)))

    b = tb.MossOnnxTtsBackend()
    b.load("some/lm-repo", device, "fp32")
    assert captured["ep"] == expected
    assert b.is_loaded


def _patch_qwen3tts_collaborators(monkeypatch, tmp_path, captured):
    """Stub every collaborator Qwen3TtsOnnxBackend.load reaches for (snapshot
    download, tokenizer, ONNX session builder, embeddings, codec), capturing the
    variant_dir handed to build_sessions — mirrors the mocking style of
    test_moss_load_maps_device_to_execution_provider above."""
    from sokuji_sidecar import tts_backends as tb

    monkeypatch.setitem(_sys.modules, "huggingface_hub",
                        _types.SimpleNamespace(
                            snapshot_download=lambda repo_id, local_files_only=True: str(tmp_path)))
    monkeypatch.setattr("sokuji_sidecar.qwen_tokenizer.load_qwen2_tokenizer", lambda d: object())

    def fake_build_sessions(onnx_dir, device, threads, variant_dir=None):
        captured["variant_dir"] = variant_dir
        return {}

    monkeypatch.setattr(tb._q3_runtime, "build_sessions", fake_build_sessions)
    monkeypatch.setattr(tb._q3_config, "load_model_config", lambda d: object())
    monkeypatch.setattr(tb._q3_runtime.Embeddings, "from_sessions",
                        classmethod(lambda cls, sessions: object()))
    monkeypatch.setattr(tb._q3_codec, "Codec12Hz", lambda sessions: object())
    return tb


@pytest.mark.parametrize("device,subdir,make_dir,expect_variant", [
    ("cuda", "onnx-bf16", True, True),      # real qwen3-tts card on cuda: variant selected
    ("cpu", "onnx-bf16", True, False),      # non-cuda device: never selects a variant
    ("cuda", None, False, False),           # config.variant_subdir=None (e.g. no card sets it): no variant
    ("cuda", "onnx-bf16", False, False),    # subdir configured but absent from the snapshot: falls back
    ("cuda", "custom-subdir", True, True),  # arbitrary subdir name from the card, NOT the literal
                                             # "onnx-bf16" — proves the value is read from config, not
                                             # hard-coded (this case cannot pass against the old hard-coded
                                             # "onnx-bf16" string, which would never look for this dir)
])
def test_qwen3tts_load_variant_dir_from_config(monkeypatch, tmp_path, device, subdir, make_dir,
                                               expect_variant):
    """Qwen3TtsOnnxBackend.load must source the CUDA-only bf16 variant subdir from
    config.variant_subdir (the card's cuda_variant_subdir, plumbed through
    PlanConfig in Task 5) instead of a hard-coded 'onnx-bf16' string — while
    reproducing the exact old behavior: device must be cuda AND the subdir must
    both be configured and exist on disk before it is selected."""
    from sokuji_sidecar.planner import PlanConfig
    if make_dir:
        (tmp_path / subdir).mkdir()
    captured = {}
    tb = _patch_qwen3tts_collaborators(monkeypatch, tmp_path, captured)

    b = tb.Qwen3TtsOnnxBackend()
    b.load("some/repo", device, "fp32", config=PlanConfig(variant_subdir=subdir))

    if expect_variant:
        assert captured["variant_dir"] == str(tmp_path / subdir)
    else:
        assert captured["variant_dir"] is None


def test_qwen3tts_load_variant_dir_none_when_config_omitted(monkeypatch, tmp_path):
    """load(..., config=None) — the default when a caller doesn't pass one — must
    never select a variant dir, even on cuda with the dir present on disk."""
    (tmp_path / "onnx-bf16").mkdir()
    captured = {}
    tb = _patch_qwen3tts_collaborators(monkeypatch, tmp_path, captured)

    b = tb.Qwen3TtsOnnxBackend()
    b.load("some/repo", "cuda", "fp32")  # config defaults to None

    assert captured["variant_dir"] is None
