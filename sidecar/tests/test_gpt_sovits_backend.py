import os

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


def test_generate_without_voice_uses_default_builtin(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    (voices_dir / "manifest.json").write_text(
        '[{"name": "classic-en", "language": "en", "default": true}]',
        encoding="utf-8")
    used = []

    def _fake_set_builtin_voice(self, name):
        used.append(name)
        self._reference = object()
    monkeypatch.setattr(tts_backends.GptSovitsOnnxBackend,
                        "set_builtin_voice", _fake_set_builtin_voice)
    b._synth = type("S", (), {"synthesize":
                    lambda self, *a, **k: np.ones(100, dtype=np.float32)})()
    samples, ms = b.generate("A normal length sentence for synthesis.", 1.0)
    assert used == ["classic-en"]
    assert samples.shape[0] > 0


def test_generate_without_voice_and_no_manifest_raises(monkeypatch, tmp_path):
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


def test_generate_mixed_chunk_outcomes_degrade_to_silence(monkeypatch, tmp_path):
    """One chunk raising and another returning None (no exception) must still
    degrade the whole call to silence, not raise — any_chunk_errored is set
    by the raising chunk regardless of what other chunks return."""
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    calls = []

    def _synth(self, chunk, ref, lang):
        calls.append(chunk)
        if len(calls) == 1:
            raise IndexError("string index out of range")
        return None
    b._synth = type("S", (), {"synthesize": _synth})()
    text = "这是第一个足够长的句子，应当被切分。这是第二个足够长的句子，也应当被切分。"
    samples, ms = b.generate(text, 1.0)
    assert len(calls) >= 2
    assert float(np.abs(samples).max()) == 0.0


def test_stage_real_tree_returns_src_when_no_symlinks(tmp_path):
    from sokuji_sidecar.tts_backends import _gpt_sovits_stage_real_tree
    d = tmp_path / "EnglishG2P"
    (d / "taggers").mkdir(parents=True)
    (d / "cmudict.rep").write_text("data")
    (d / "taggers" / "weights.json").write_text("{}")
    assert _gpt_sovits_stage_real_tree(str(d)) == str(d)


def test_stage_real_tree_dereferences_hf_blob_symlinks(tmp_path):
    # HF-cache snapshots symlink into blobs/; nltk pathsec rejects those.
    from sokuji_sidecar.tts_backends import _gpt_sovits_stage_real_tree
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    (blobs / "abc123").write_text("tagger-weights")
    d = tmp_path / "snap" / "EnglishG2P"
    (d / "taggers" / "eng").mkdir(parents=True)
    (d / "cmudict.rep").write_text("plain")  # mixed: one real file
    os.symlink(blobs / "abc123", d / "taggers" / "eng" / "weights.json")

    staged = _gpt_sovits_stage_real_tree(str(d))
    assert staged != str(d)
    staged_file = os.path.join(staged, "taggers", "eng", "weights.json")
    assert os.path.isfile(staged_file) and not os.path.islink(staged_file)
    assert os.path.realpath(staged_file) == staged_file  # no symlink escape
    with open(staged_file) as f:
        assert f.read() == "tagger-weights"
    assert os.path.isfile(os.path.join(staged, "cmudict.rep"))
    # idempotent: second call reuses the staged tree
    assert _gpt_sovits_stage_real_tree(str(d)) == staged


def _snapshot_with_default_voice(tmp_path):
    """Snapshot voices/ with a real tiny default clip + manifest."""
    import json
    import soundfile as sf
    vdir = tmp_path / "voices"
    vdir.mkdir(exist_ok=True)
    sf.write(str(vdir / "classic-en.wav"), np.zeros(2400, dtype=np.float32), 24000)
    (vdir / "classic-en.txt").write_text("ask not")
    (vdir / "manifest.json").write_text(json.dumps(
        [{"name": "classic-en", "language": "en", "default": True}]))


def test_set_builtin_voice_unknown_falls_back_to_default(monkeypatch, tmp_path, capsys):
    # Live regression: a stale renderer setting sent pocket's 'eponine' here;
    # the raw file error killed TTS for the whole session (ttsEnabled: false).
    b = _loaded_backend(monkeypatch, tmp_path)
    _snapshot_with_default_voice(tmp_path)
    applied = []
    monkeypatch.setattr(b, "set_voice",
                        lambda wav, sr, ref_text="": applied.append((sr, ref_text)))
    b.set_builtin_voice("eponine")
    assert applied and applied[0][1] == "ask not"  # default clip's transcript
    assert "falling back to default" in capsys.readouterr().err


def test_set_builtin_voice_unknown_without_manifest_raises(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    with pytest.raises(BackendLoadError, match="unknown builtin voice"):
        b.set_builtin_voice("eponine")


def test_generate_no_audio_error_hints_language_mismatch(monkeypatch, tmp_path):
    # Live repro: tts_init without language left the backend on english while
    # the session spoke Chinese -> instant-EOS -> "no audio". The error must
    # name the likely cause.
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    b._synth = type("S", (), {"synthesize": lambda self, *a, **k: None})()
    with pytest.raises(RuntimeError, match="looks chinese.*session language is english"):
        b.generate("我很高兴。", 1.0)
