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
