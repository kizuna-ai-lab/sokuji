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


def test_qwen3_tts_onnx_load_materializes_symlinks_and_builds_sessions(monkeypatch, tmp_path):
    """Qwen3TtsOnnxBackend.load must (1) deref the snapshot's onnx/ subdir
    through hf_symlinks.materialize_symlinks before touching it (the
    >2GB talker graph's external-data file is an HF-cache symlink that ORT's
    external-data validation rejects) and (2) build the ONNX sessions from
    that same onnx/ subdir with the caller's device. Mirrors the MOSS
    load-test pattern above: every real collaborator (snapshot_download,
    the tokenizer/config/codec loaders, session building) is stubbed so this
    is a pure wiring test, not an integration test."""
    from sokuji_sidecar import tts_backends as tb
    captured = {}

    monkeypatch.delenv("SOKUJI_TTS_THREADS", raising=False)
    monkeypatch.setitem(_sys.modules, "huggingface_hub",
                        _types.SimpleNamespace(
                            snapshot_download=lambda repo_id, local_files_only=True: str(tmp_path)))
    monkeypatch.setattr("sokuji_sidecar.qwen_tokenizer.load_qwen2_tokenizer",
                        lambda model_dir: object())
    monkeypatch.setattr(tb._hf_symlinks, "materialize_symlinks",
                        lambda d: captured.setdefault("materialize_dir", d))
    monkeypatch.setattr(tb._q3_config, "load_model_config", lambda d: object())

    def fake_build_sessions(onnx_dir, device, threads):
        captured["build_sessions_args"] = (onnx_dir, device, threads)
        return {}
    monkeypatch.setattr(tb._q3_runtime, "build_sessions", fake_build_sessions)
    monkeypatch.setattr(tb._q3_runtime.Embeddings, "from_sessions",
                        classmethod(lambda cls, sessions: object()))
    monkeypatch.setattr(tb._q3_codec, "Codec12Hz", lambda sessions: object())

    b = tb.Qwen3TtsOnnxBackend()
    b.load("some/qwen3-tts-repo", "cpu", "fp32", None)

    expected_dir = f"{tmp_path}/onnx"
    assert captured["materialize_dir"] == expected_dir
    assert captured["build_sessions_args"] == (expected_dir, "cpu", 4)
    assert b.is_loaded


def test_pocket_onnx_registered_and_flags(monkeypatch):
    monkeypatch.delenv("SOKUJI_POCKET_PRESET_VOICE", raising=False)
    b = backends.make_backend("pocket_onnx")
    assert b.NAME == "pocket_onnx" and b.STREAMING is False and b.CLONES is True
    assert b.is_loaded is False and b.sample_rate == 24000
    assert b.preset_voice == "alba"


def test_pocket_set_builtin_voice_unknown_raises():
    b = backends.make_backend("pocket_onnx")
    b._voices = {}                      # already "parsed": empty -> nothing matches
    with pytest.raises(backends.BackendLoadError):
        b.set_builtin_voice("nope")


def test_pocket_set_builtin_voice_maps_record_to_flow_state():
    b = backends.make_backend("pocket_onnx")
    b._meta = {"flow_lm_state_manifest": [
        {"input_name": "state_0", "dtype": "float32", "shape": [1, 4], "fill": "nan",
         "module": "layer.0", "key": "cache"},
        {"input_name": "state_1", "dtype": "int64", "shape": [1], "fill": "zeros",
         "module": "layer.0", "key": "step"},
    ]}
    b._voices = {"alba": {"layer.0/cache": np.ones((1, 2), np.float32),
                          "layer.0/offset": np.asarray([2], np.int64)}}
    b.set_builtin_voice("alba")
    assert np.array_equal(b._flow["state_0"][:, :2], np.ones((1, 2), np.float32))
    assert np.isnan(b._flow["state_0"][:, 2:]).all()
    assert b._flow["state_1"][0] == 2


def test_pocket_generate_defaults_to_preset_voice(monkeypatch):
    from sokuji_sidecar import pocket_inference as pi

    class _Tok:
        def encode_ids(self, text):
            return [1, 2, 3]

    class _Sess:
        def run(self, names, feeds):
            return [np.zeros((1, 3, 8), np.float32)]

    b = backends.make_backend("pocket_onnx")
    b._tok = _Tok()
    b._sessions = {"textConditioner": _Sess()}
    b._meta = {}
    applied = []

    def fake_builtin(name):
        applied.append(name)
        b._flow = {"state_0": np.zeros(1, np.float32)}

    monkeypatch.setattr(b, "set_builtin_voice", fake_builtin)
    monkeypatch.setattr(pi, "generate", lambda *a, **k: np.zeros(2400, np.float32))
    samples, ms = b.generate("hello")
    # No voice picked yet -> the preset is applied (the post-load RTF probe
    # generates before the renderer ever sends set_voice).
    assert applied == ["alba"]
    assert samples.shape == (2400,) and ms >= 0


def test_pocket_load_missing_snapshot_raises_backend_load_error(monkeypatch):
    import huggingface_hub

    def boom(**kw):
        raise FileNotFoundError("not cached")

    monkeypatch.setattr(huggingface_hub, "snapshot_download", boom)
    b = backends.make_backend("pocket_onnx")
    with pytest.raises(backends.BackendLoadError):
        b.load("jiangzhuo9357/pocket-tts-en-onnx", "cpu", "int8")
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("POCKET_MODEL_DIR"),
                    reason="set POCKET_MODEL_DIR to a local Pocket bundle dir")
def test_pocket_backend_builtin_voices_end_to_end(monkeypatch):
    """The KV-mapping failure mode is audio that PLAYS but carries the wrong
    timbre — shape/finiteness checks can't see it. Teeth: with a seeded rng and
    one intra-op thread (bitwise-deterministic), the same builtin voice twice is
    byte-identical while two different voices diverge. A mapping that collapsed
    to manifest defaults (ignoring the record) would make every voice sound the
    same and fail the alba-vs-javert assertion."""
    import huggingface_hub
    d = os.environ["POCKET_MODEL_DIR"]
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda **kw: d)
    monkeypatch.setenv("POCKET_NATIVE_THREADS", "1")
    real_rng = np.random.default_rng
    monkeypatch.setattr(np.random, "default_rng", lambda *a, **k: real_rng(0))
    b = backends.make_backend("pocket_onnx")
    b.load("mirror-not-needed-locally", "cpu", "int8")
    assert b.is_loaded and b.sample_rate == 24000
    text = "The quick brown fox jumps over the lazy dog."
    b.set_builtin_voice("alba")
    a1, ms1 = b.generate(text)
    a2, _ = b.generate(text)
    assert np.array_equal(a1, a2)                       # seeded -> deterministic
    assert np.isfinite(a1).all() and len(a1) > 24000 and np.abs(a1).max() > 0.05
    b.set_builtin_voice("javert")
    a3, _ = b.generate(text)
    assert a1.shape != a3.shape or not np.array_equal(a1, a3)
    b.unload()
    assert b.is_loaded is False
