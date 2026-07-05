import numpy as np, os
from sokuji_sidecar.qwen3_tts import config, mel
FIX = os.path.join(os.path.dirname(__file__), "fixtures", "qwen3_tts_config.json")

def _cfg():
    return config.load_model_config(FIX).speaker_encoder

def test_shape_and_frame_count():
    cfg = _cfg()
    n = 24000  # 1s
    m = mel.log_mel(np.zeros(n, np.float32), cfg)
    pad = (cfg.n_fft - cfg.hop_size) // 2
    frames = 1 + (n + 2 * pad - cfg.n_fft) // cfg.hop_size
    assert m.shape == (cfg.num_mels, frames)

def test_silence_hits_log_floor():
    m = mel.log_mel(np.zeros(4096, np.float32), _cfg())
    assert np.allclose(m, np.log(1e-5), atol=1e-3)

def test_tone_energy_lands_in_expected_band():
    cfg = _cfg()
    t = np.arange(24000) / 24000.0
    tone = np.sin(2 * np.pi * 1000 * t).astype(np.float32)   # 1 kHz
    m = mel.log_mel(tone, cfg)
    band = int(np.argmax(m.mean(axis=1)))
    assert 20 <= band <= 60   # 1 kHz sits in the lower-middle Slaney bands (128 mels, fmax 12k)


def test_mel_filterbank_matches_librosa():
    # Golden parity: our numpy Slaney filterbank must match librosa.filters.mel
    # (htk=False, norm='slaney') on the real config. librosa returns float32
    # (its internal rounding), ours stays float64 — agreement at float32
    # precision IS exact parity with what the old code consumed (it upcast
    # librosa's float32 to float64). Self-skips when librosa is absent.
    import pytest
    librosa = pytest.importorskip("librosa")
    cfg = _cfg()
    ours = mel.mel_filterbank(cfg.sample_rate, cfg.n_fft, cfg.num_mels, cfg.fmin, cfg.fmax)
    ref = librosa.filters.mel(sr=cfg.sample_rate, n_fft=cfg.n_fft, n_mels=cfg.num_mels,
                              fmin=cfg.fmin, fmax=cfg.fmax, htk=False, norm="slaney")
    assert ours.shape == ref.shape
    np.testing.assert_allclose(ours, ref.astype(np.float64), rtol=1e-6, atol=1e-8)


def test_log_mel_no_longer_imports_librosa():
    import ast, inspect
    src = inspect.getsource(mel)
    tree = ast.parse(src)
    imported = {getattr(n, "module", None) or a.name
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in n.names}
    assert not any("librosa" in (m or "") for m in imported)
