import numpy as np
import pytest
from sokuji_sidecar.tts_backends import BackendLoadError, Qwen3TtsOnnxBackend


def test_flags():
    assert (Qwen3TtsOnnxBackend.NAME, Qwen3TtsOnnxBackend.STREAMING, Qwen3TtsOnnxBackend.CLONES) \
        == ("qwen3tts_onnx", False, True)


def test_set_voice_requires_loaded_and_builds_icl(monkeypatch):
    b = Qwen3TtsOnnxBackend()
    calls = {}
    b._codec = type("C", (), {"encode": staticmethod(lambda wav: np.ones((4, 16), np.int64))})()
    b._spk_embed = lambda wav: np.zeros(8, np.float32)
    b._tokenize = lambda text: np.arange(6, dtype=np.int64)[None, :]
    b.set_voice(np.zeros(24000, np.float32), 24000, ref_text="hello there")
    vcp = b._voice_prompt
    assert vcp["icl_mode"] == [True] and vcp["ref_code"][0].shape == (4, 16)
    b.set_voice(np.zeros(24000, np.float32), 24000, ref_text="")
    assert b._voice_prompt["x_vector_only_mode"] == [True]   # empty transcript → x-vector fallback


def test_list_builtin_voices_empty():
    assert Qwen3TtsOnnxBackend.list_builtin_voices() == []


def test_set_builtin_voice_loads_bundled_clip_and_builds_icl(tmp_path):
    from scipy.io import wavfile

    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    wav_int16 = (np.full(24000, 0.1, dtype=np.float32) * 32767).astype(np.int16)
    wavfile.write(voices_dir / "Orion.wav", 24000, wav_int16)
    (voices_dir / "Orion.txt").write_text("  Hello, I am Orion.  \n")

    b = Qwen3TtsOnnxBackend()
    b._dir = str(tmp_path)
    b._codec = type("C", (), {"encode": staticmethod(lambda wav: np.ones((4, 16), np.int64))})()
    b._spk_embed = lambda wav: np.zeros(8, np.float32)
    b._tokenize = lambda text: np.arange(6, dtype=np.int64)[None, :]

    b.set_builtin_voice("Orion")

    vcp = b._voice_prompt
    assert vcp["icl_mode"] == [True]
    assert vcp["ref_code"][0].shape == (4, 16)
    assert b._ref_ids is not None


def test_set_builtin_voice_unknown_name_raises(tmp_path):
    b = Qwen3TtsOnnxBackend()
    b._dir = str(tmp_path)
    with pytest.raises(BackendLoadError):
        b.set_builtin_voice("NoSuchVoice")


def test_set_voice_resamples_non_24k_input():
    b = Qwen3TtsOnnxBackend()
    seen = {}

    def spy_embed(wav):
        seen["n"] = len(wav)
        return np.zeros(8, np.float32)

    b._codec = type("C", (), {"encode": staticmethod(lambda wav: np.ones((4, 16), np.int64))})()
    b._spk_embed = spy_embed
    b._tokenize = lambda text: np.arange(6, dtype=np.int64)[None, :]
    b.set_voice(np.zeros(48000, np.float32), 48000, ref_text="")
    # 1s @ 48k must arrive at the speaker encoder as ~1s @ 24k
    assert abs(seen["n"] - 24000) <= 24


def test_set_builtin_voice_accepts_non_24k_clip(tmp_path):
    from scipy.io import wavfile

    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    wav_int16 = (np.full(48000, 0.1, dtype=np.float32) * 32767).astype(np.int16)
    wavfile.write(voices_dir / "Vega.wav", 48000, wav_int16)
    (voices_dir / "Vega.txt").write_text("Hello, I am Vega.")

    b = Qwen3TtsOnnxBackend()
    b._dir = str(tmp_path)
    seen = {}

    def spy_embed(wav):
        seen["n"] = len(wav)
        return np.zeros(8, np.float32)

    b._codec = type("C", (), {"encode": staticmethod(lambda wav: np.ones((4, 16), np.int64))})()
    b._spk_embed = spy_embed
    b._tokenize = lambda text: np.arange(6, dtype=np.int64)[None, :]
    b.set_builtin_voice("Vega")
    assert abs(seen["n"] - 24000) <= 24


def test_tts_backends_no_librosa_or_transformers_import():
    # torch-free gate: the module must not import librosa (numba/llvmlite chain)
    # or transformers (AutoTokenizer) — soxr/soundfile/tokenizers replace them.
    import ast, inspect
    from sokuji_sidecar import tts_backends as m
    tree = ast.parse(inspect.getsource(m))
    imported = {getattr(n, "module", None) or a.name
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in n.names}
    assert not any((x or "").split(".")[0] in ("librosa", "transformers") for x in imported)


def _generate_with_stubs(monkeypatch, env=None):
    """Run backend.generate() with template/runtime stubbed out; return the
    kwargs generate_codes was called with."""
    from types import SimpleNamespace

    captured = {}
    b = Qwen3TtsOnnxBackend()
    b._sessions = {}
    b._cfg = SimpleNamespace(talker=SimpleNamespace(
        codec_eos_token_id=2150, vocab_size=3072, num_code_groups=16))
    b._tokenize = lambda text: np.arange(4, dtype=np.int64)[None, :]
    b._codec = type("C", (), {"decode": staticmethod(
        lambda codes: np.zeros(1920, np.float32))})()

    monkeypatch.setattr(
        "sokuji_sidecar.tts_backends._q3_template.build_talker_inputs",
        lambda *a, **k: (np.zeros((1, 3, 8), np.float32), np.ones((1, 3), np.int64),
                         np.zeros((1, 1, 8), np.float32), np.zeros((1, 1, 8), np.float32)))

    def fake_generate_codes(sessions, cfg_talker, *args, **kwargs):
        captured.update(kwargs)
        return [np.zeros((2, 16), np.int64)], [np.zeros((2, 8), np.float32)]

    monkeypatch.setattr(
        "sokuji_sidecar.tts_backends._q3_runtime.generate_codes", fake_generate_codes)
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)
    b.generate("hi")
    return captured


def test_generate_seed_env_makes_rng_deterministic(monkeypatch):
    env = {"SOKUJI_QWEN3_TTS_SEED": "123"}
    r1 = _generate_with_stubs(monkeypatch, env)["rng"].random(4)
    r2 = _generate_with_stubs(monkeypatch, env)["rng"].random(4)
    assert np.array_equal(r1, r2)


def test_generate_rng_unseeded_by_default(monkeypatch):
    r1 = _generate_with_stubs(monkeypatch)["rng"].random(4)
    r2 = _generate_with_stubs(monkeypatch)["rng"].random(4)
    assert not np.array_equal(r1, r2)


def test_generate_greedy_env_disables_sampling(monkeypatch):
    params = _generate_with_stubs(
        monkeypatch, {"SOKUJI_QWEN3_TTS_GREEDY": "1"})["sampling_params"]
    assert params["do_sample"] is False and params["subtalker_dosample"] is False


def test_generate_default_sampling_params_unchanged(monkeypatch):
    from sokuji_sidecar.tts_backends import _QWEN3_TTS_SAMPLING_PARAMS
    params = _generate_with_stubs(monkeypatch)["sampling_params"]
    assert params["do_sample"] is True and params["subtalker_dosample"] is True
    # greedy runs must never mutate the module-level constant
    _generate_with_stubs(monkeypatch, {"SOKUJI_QWEN3_TTS_GREEDY": "1"})
    assert _QWEN3_TTS_SAMPLING_PARAMS["do_sample"] is True
