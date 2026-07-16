import numpy as np
import pytest

from sokuji_sidecar import tts_backends
from sokuji_sidecar.backends import BackendLoadError, make_backend


def test_flags_and_registration():
    b = make_backend("gpt_sovits_onnx")
    assert b.NAME == "gpt_sovits_onnx"
    assert b.STREAMING is False
    assert b.CLONES is True
    assert not b.is_loaded


def test_installed_mapping_declares_onnxruntime():
    from sokuji_sidecar import accel
    # Force a REAL probe: an earlier test in the suite may have left the
    # module-global probe() cache pointing at a monkeypatched fake Machine
    # (probe(force=True) with fake detectors is a lasting side effect, not
    # reverted by monkeypatch teardown — see test_accel.py's identical note
    # on test_new_translate_backends_installed_and_resolvable) — this test
    # wants the ACTUAL host's installed set.
    machine = accel.probe(force=True)
    assert "gpt_sovits_onnx" in machine.installed


def _loaded_backend(monkeypatch, tmp_path):
    """Backend with all collaborators faked; no real ONNX anywhere."""
    b = make_backend("gpt_sovits_onnx")
    (tmp_path / "model").mkdir()
    gd = tmp_path / "genie_data"
    (gd / "G2P" / "ChineseG2P").mkdir(parents=True)
    (gd / "G2P" / "EnglishG2P").mkdir(parents=True)
    monkeypatch.setattr(tts_backends, "snapshot_download",
                        lambda repo_id, **kw: str(tmp_path))
    from sokuji_sidecar.gpt_sovits import runtime
    monkeypatch.setattr(runtime, "ensure_fp32_bins", lambda d: [])
    monkeypatch.setattr(runtime, "build_model_sessions",
                        lambda d, dev: {"t2s_encoder_fp32.onnx": object(),
                                        "t2s_first_stage_decoder_fp32.onnx": object(),
                                        "t2s_stage_decoder_fp32.onnx": object(),
                                        "vits_fp32.onnx": object(),
                                        "prompt_encoder_fp32.onnx": object()})
    monkeypatch.setattr(runtime, "make_session", lambda p, dev: object())
    b.load("fake/repo", "cpu", "fp32", None)
    return b


def test_load_wraps_errors_in_backend_load_error(monkeypatch, tmp_path):
    b = make_backend("gpt_sovits_onnx")
    monkeypatch.setattr(tts_backends, "snapshot_download",
                        lambda repo_id, **kw: (_ for _ in ()).throw(OSError("no snapshot")))
    with pytest.raises(BackendLoadError):
        b.load("fake/repo", "cpu", "fp32", None)


def test_set_voice_requires_transcript(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="transcript"):
        b.set_voice(np.zeros(24000, dtype=np.float32), 24000, ref_text="")


def test_set_language_normalizes_and_rejects_unknown(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b.set_language("zh")
    assert b._language == "chinese"
    b.set_language("EN")
    assert b._language == "english"
    b.set_language("ja")
    assert b._language == "japanese"
    b.set_language("")            # empty -> keep default (english)
    with pytest.raises(ValueError):
        b.set_language("ko")


def test_detect_language_for_ref_text():
    from sokuji_sidecar.tts_backends import _gpt_sovits_detect_language
    assert _gpt_sovits_detect_language("不要问你的国家") == "chinese"
    assert _gpt_sovits_detect_language("こんにちは、元気ですか") == "japanese"
    assert _gpt_sovits_detect_language("Ask not what your country") == "english"
    # kanji-only ja is indistinguishable from zh -> zh is the documented default
    assert _gpt_sovits_detect_language("会議") == "chinese"


def test_generate_guards_short_text_with_silence(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()  # pretend a voice is set
    called = []
    b._synth = type("S", (), {"synthesize": lambda self, *a, **k: called.append(1)})()
    samples, ms = b.generate("嗯。", 1.0)
    assert called == []                      # synthesis never invoked
    assert samples.dtype == np.float32
    assert 0 < samples.shape[0] <= 32000 // 2  # brief silence
    assert float(np.abs(samples).max()) == 0.0


def test_generate_zero_output_raises(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    b._synth = type("S", (), {"synthesize": lambda self, *a, **k: None})()
    with pytest.raises(RuntimeError, match="no audio"):
        b.generate("A normal length sentence for synthesis.", 1.0)


def test_generate_requires_voice(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    with pytest.raises(RuntimeError, match="voice"):
        b.generate("Hello there, this is a test.", 1.0)


def test_generate_g2p_crash_returns_silence(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    def _boom(self, *a, **k):
        raise IndexError("string index out of range")
    b._synth = type("S", (), {"synthesize": _boom})()
    samples, ms = b.generate("正常长度的句子应当触发合成路径。", 1.0)
    assert float(np.abs(samples).max()) == 0.0  # degrades to silence, no crash


def test_generate_concatenates_sentence_chunks(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    seen = []
    def _synth(self, chunk, ref, lang):
        seen.append(chunk)
        return np.ones(100, dtype=np.float32)
    b._synth = type("S", (), {"synthesize": _synth})()
    text = "这是第一个足够长的句子，应当被切分。这是第二个足够长的句子，也应当被切分。"
    samples, ms = b.generate(text, 1.0)
    assert len(seen) >= 2
    assert samples.shape[0] == 100 * len(seen)
