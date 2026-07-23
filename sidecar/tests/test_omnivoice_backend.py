"""Tests for `OmniVoiceOnnxBackend` (tts_backends.py) — the sidecar TTS
backend adapter wiring omnivoice/{runtime,frontend,higgs,decode} together.
Mirrors test_cosyvoice3_backend.py's structure, with the key contract
difference: `set_voice` takes NO `ref_text` (transcript-free cloning — the
engine's `inspect.signature` introspection in tts_engine.py:66-73 picks the
2-arg call path when the parameter is absent)."""
import ast
import inspect
import pathlib

import numpy as np
import pytest

from sokuji_sidecar import tts_backends
from sokuji_sidecar.backends import make_backend, BackendLoadError


def test_flags():
    b = make_backend("omnivoice_onnx")
    assert (b.NAME, b.STREAMING, b.CLONES) == ("omnivoice_onnx", False, True)
    assert b.sample_rate == 24000
    assert not b.is_loaded


def test_set_voice_has_no_ref_text_param():
    # the engine only passes ref_text to backends whose set_voice accepts it
    # (tts_engine.py:66-73) — this backend is transcript-free by design.
    sig = inspect.signature(make_backend("omnivoice_onnx").set_voice)
    assert "ref_text" not in sig.parameters
    assert list(sig.parameters) == ["audio", "sr"]


def test_set_voice_encodes_reference_via_temp_wav_and_cleans_up(monkeypatch, tmp_path):
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()

    captured = {}

    def fake_encode_reference(sessions, path):
        captured["sessions"] = sessions
        captured["path"] = path
        assert pathlib.Path(path).exists()  # temp wav must exist while encoding
        return np.zeros((8, 40), dtype=np.int64)

    monkeypatch.setattr(tts_backends._omnivoice_higgs, "encode_reference",
                        fake_encode_reference)

    audio = np.zeros(16000, dtype=np.float32)
    b.set_voice(audio, 16000)

    assert captured["sessions"] is b._sessions
    assert not pathlib.Path(captured["path"]).exists()  # cleaned up after
    assert isinstance(b._ref_codes, np.ndarray)
    assert b._ref_codes.shape == (8, 40)


def test_set_voice_downmixes_channel_first_multichannel(monkeypatch):
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()

    seen_written = {}

    import soundfile as sf
    real_write = sf.write

    def spy_write(path, data, sr, *a, **k):
        seen_written["data"] = np.asarray(data).copy()
        return real_write(path, data, sr, *a, **k)

    monkeypatch.setattr(tts_backends.sf, "write", spy_write)
    monkeypatch.setattr(tts_backends._omnivoice_higgs, "encode_reference",
                        lambda sessions, path: np.zeros((8, 4), dtype=np.int64))

    # channel-first (2, samples) — average over axis 0 like MOSS._encode_reference
    stereo = np.stack([np.ones(100, np.float32), np.zeros(100, np.float32)])
    b.set_voice(stereo, 16000)

    assert seen_written["data"].ndim == 1
    assert np.allclose(seen_written["data"], 0.5)


def test_generate_defaults_to_builtin_preset_voice_when_no_reference_set(monkeypatch):
    # replaces the old random auto-voice default (issue #351 follow-up):
    # generate() with no reference set now calls set_builtin_voice("classic-zh")
    # rather than passing ref_codes=None straight through.
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()
    assert b._ref_codes is None
    monkeypatch.delenv("SOKUJI_OMNIVOICE_PRESET_VOICE", raising=False)

    seen = {}

    def fake_set_builtin_voice(name):
        seen["preset_name"] = name
        b._ref_codes = np.ones((8, 4), dtype=np.int64)

    monkeypatch.setattr(b, "set_builtin_voice", fake_set_builtin_voice)

    def fake_build_input_ids(tok, text, *, lang, ref_codes, num_target_tokens, denoise):
        seen.update(lang=lang, ref_codes=ref_codes, denoise=denoise, text=text)
        return "IDS", "MASK", 0

    def fake_generate_codes(sessions, ids, amask, n, *, cfg):
        seen["n"] = n
        return np.zeros((8, n), dtype=np.int64)

    def fake_decode(sessions, codes):
        return np.zeros(2400, dtype=np.float32)

    monkeypatch.setattr(tts_backends._omnivoice_frontend, "build_input_ids",
                        fake_build_input_ids)
    monkeypatch.setattr(tts_backends._omnivoice_decode, "generate_codes",
                        fake_generate_codes)
    monkeypatch.setattr(tts_backends._omnivoice_higgs, "decode", fake_decode)

    audio, ms = b.generate("hello world", speed=1.0)

    assert seen["preset_name"] == "classic-zh"
    assert seen["ref_codes"] is b._ref_codes
    assert seen["denoise"] is True
    assert seen["lang"] is None
    assert audio.dtype == np.float32
    assert isinstance(ms, int)


def test_generate_uses_cached_reference_codes(monkeypatch):
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()
    b._ref_codes = np.ones((8, 40), dtype=np.int64)

    def boom(name):
        raise AssertionError("set_builtin_voice must not run when ref_codes is already set")

    monkeypatch.setattr(b, "set_builtin_voice", boom)

    seen = {}

    def fake_build_input_ids(tok, text, *, lang, ref_codes, num_target_tokens, denoise):
        seen.update(ref_codes=ref_codes, denoise=denoise)
        return "IDS", "MASK", 0

    monkeypatch.setattr(tts_backends._omnivoice_frontend, "build_input_ids",
                        fake_build_input_ids)
    monkeypatch.setattr(tts_backends._omnivoice_decode, "generate_codes",
                        lambda sessions, ids, amask, n, *, cfg: np.zeros((8, n), np.int64))
    monkeypatch.setattr(tts_backends._omnivoice_higgs, "decode",
                        lambda sessions, codes: np.zeros(100, np.float32))

    b.generate("hello", speed=1.0)

    assert seen["ref_codes"] is b._ref_codes
    assert seen["denoise"] is True


def test_load_clears_stale_ref_codes(monkeypatch):
    b = make_backend("omnivoice_onnx")
    monkeypatch.setattr(tts_backends, "snapshot_download", lambda **k: "/snap")
    monkeypatch.setattr(tts_backends._omnivoice_frontend, "load_tokenizer",
                        lambda d: object())
    monkeypatch.setattr(tts_backends._omnivoice_runtime, "build_sessions",
                        lambda model_dir, higgs_dir, device, threads: {})

    b.load("repo", "cuda", "int4")
    b._ref_codes = np.ones((8, 4), dtype=np.int64)
    b.load("repo", "cuda", "int4")

    assert b._ref_codes is None


def test_load_picks_variant_dir_from_compute_type(monkeypatch):
    b = make_backend("omnivoice_onnx")
    monkeypatch.setattr(tts_backends, "snapshot_download", lambda **k: "/snap")
    seen = {}

    def fake_build_sessions(model_dir, higgs_dir, device, threads):
        seen.update(model_dir=model_dir, higgs_dir=higgs_dir, device=device)
        return {}

    monkeypatch.setattr(tts_backends._omnivoice_frontend, "load_tokenizer",
                        lambda d: seen.setdefault("tok_dir", d) or object())
    monkeypatch.setattr(tts_backends._omnivoice_runtime, "build_sessions",
                        fake_build_sessions)

    b.load("repo", "cuda", "int4")

    assert seen["model_dir"] == "/snap/int4"
    assert seen["higgs_dir"] == "/snap/audio_tokenizer"
    assert seen["tok_dir"] == "/snap/int4"
    assert seen["device"] == "cuda"


def test_load_wraps_failures_in_backend_load_error(monkeypatch):
    b = make_backend("omnivoice_onnx")

    def boom(**k):
        raise RuntimeError("no snapshot")

    monkeypatch.setattr(tts_backends, "snapshot_download", boom)
    with pytest.raises(BackendLoadError):
        b.load("repo", "cuda", "int4")
    assert not b.is_loaded


def test_unload_clears_all_state():
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok, b._ref_codes = {}, object(), np.ones((8, 4))
    b._dir = "/snap"
    b._voice_cache = {"classic-zh": np.ones((8, 4))}
    b.unload()
    assert b._sessions is None and b._tok is None and b._ref_codes is None
    assert b._dir is None  # snapshot root cleared too (parity with CosyVoice3)
    assert b._voice_cache == {}
    assert not b.is_loaded


def test_list_builtin_voices_is_empty():
    # descriptors come from voices/manifest.json (tts_voices), not this method
    assert tts_backends.OmniVoiceOnnxBackend.list_builtin_voices() == []


def test_has_set_builtin_voice_but_not_set_speaker():
    # curated presets (issue #351 follow-up) -> named_voices=True in the
    # catalog card and the backend now exposes set_builtin_voice, like
    # CosyVoice3OnnxBackend; there's still no speaker-range voice axis.
    b = make_backend("omnivoice_onnx")
    assert hasattr(b, "set_builtin_voice")
    assert not hasattr(b, "set_speaker")


def test_set_builtin_voice_requires_loaded_backend():
    b = make_backend("omnivoice_onnx")
    with pytest.raises(BackendLoadError):
        b.set_builtin_voice("classic-zh")


def test_set_builtin_voice_rejects_path_traversal(monkeypatch, tmp_path):
    # Isolate the guard: stage a real .wav that a traversal name WOULD resolve to
    # (`../escaped` → <dir>/voices/../escaped.wav → <dir>/escaped.wav, which exists),
    # and make encode_reference loud. The guard must reject every bad name BEFORE
    # any file I/O, so encode_reference is never reached.
    import soundfile as sf
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()
    b._dir = str(tmp_path)
    (tmp_path / "voices").mkdir()
    sf.write(str(tmp_path / "escaped.wav"), np.zeros(1600, dtype=np.float32), 16000)
    called = []
    monkeypatch.setattr(tts_backends._omnivoice_higgs, "encode_reference",
                        lambda *a, **k: called.append(a) or np.ones((8, 4), dtype=np.int64))
    for bad in ["../escaped", "a/b", "..", "with space", "", "voices/../../x"]:
        with pytest.raises(BackendLoadError):
            b.set_builtin_voice(bad)
    assert called == []  # blocked by the allow-list, not by a missing file


def test_set_builtin_voice_unknown_name_raises(tmp_path):
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()
    b._dir = str(tmp_path)  # voices/ doesn't even exist under here
    with pytest.raises(BackendLoadError):
        b.set_builtin_voice("nonexistent")


def test_set_builtin_voice_encodes_reference_from_wav_only(monkeypatch, tmp_path):
    # transcript-free: only voices/<name>.wav is read, no .txt (unlike
    # CosyVoice3OnnxBackend.set_builtin_voice).
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    wav_path = voices_dir / "classic-zh.wav"
    import soundfile as sf
    sf.write(str(wav_path), np.zeros(1600, dtype=np.float32), 16000)
    b._dir = str(tmp_path)

    calls = []

    def fake_encode_reference(sessions, path):
        calls.append(path)
        assert sessions is b._sessions
        assert path == str(wav_path)
        return np.ones((8, 40), dtype=np.int64)

    monkeypatch.setattr(tts_backends._omnivoice_higgs, "encode_reference",
                        fake_encode_reference)

    b.set_builtin_voice("classic-zh")

    assert len(calls) == 1
    assert isinstance(b._ref_codes, np.ndarray)
    assert b._ref_codes.shape == (8, 40)


def test_set_builtin_voice_second_call_hits_cache(monkeypatch, tmp_path):
    b = make_backend("omnivoice_onnx")
    b._sessions, b._tok = {}, object()
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    import soundfile as sf
    sf.write(str(voices_dir / "classic-zh.wav"), np.zeros(1600, dtype=np.float32), 16000)
    b._dir = str(tmp_path)

    calls = []

    def fake_encode_reference(sessions, path):
        calls.append(path)
        return np.ones((8, 40), dtype=np.int64)

    monkeypatch.setattr(tts_backends._omnivoice_higgs, "encode_reference",
                        fake_encode_reference)

    b.set_builtin_voice("classic-zh")
    b._ref_codes = None  # prove the second call re-populates it from cache
    b.set_builtin_voice("classic-zh")

    assert len(calls) == 1  # encode_reference only ran once
    assert isinstance(b._ref_codes, np.ndarray)
    assert b._ref_codes.shape == (8, 40)


def test_module_has_no_torch_transformers_or_librosa_import():
    pkg = pathlib.Path(tts_backends.__file__).parent / "omnivoice"
    for py in pkg.glob("*.py"):
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                assert not n.startswith(("librosa", "transformers", "torch")), \
                    f"{py.name} imports {n}"
