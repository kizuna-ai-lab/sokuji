import numpy as np
from pathlib import Path

from sokuji_sidecar.cosyvoice3 import mel

GOLD = np.load(Path(__file__).parent / "data" / "cosyvoice3_mel_goldens.npz")


def test_whisper_mel_matches_reference():
    out = mel.whisper_log_mel_128(GOLD["sig16"])
    assert out.shape == GOLD["whisper"].shape  # [1, 128, T], last frame dropped
    np.testing.assert_allclose(out, GOLD["whisper"], atol=1e-4)


def test_kaldi_fbank_matches_reference():
    out = mel.kaldi_fbank_80_cmn(GOLD["sig16"])
    assert out.shape == GOLD["kaldi"].shape      # [1, frames, 80]
    np.testing.assert_allclose(out, GOLD["kaldi"], atol=1e-4)
    # CMN: per-bin mean over time is ~0
    np.testing.assert_allclose(out[0].mean(axis=0), 0.0, atol=1e-6)


def test_matcha_mel_matches_reference():
    out = mel.matcha_mel_80(GOLD["sig24"])
    assert out.shape == GOLD["matcha"].shape     # [frames, 80]
    np.testing.assert_allclose(out, GOLD["matcha"], atol=1e-4)


def test_matcha_frame_rate_is_50fps():
    # 24000 / 480 hop = 50 fps: 1 s of audio -> exactly 50 frames
    out = mel.matcha_mel_80(np.zeros(24000, dtype=np.float32))
    assert out.shape[0] == 50


def test_matcha_log_floor():
    out = mel.matcha_mel_80(np.zeros(24000, dtype=np.float32))
    assert np.all(out >= np.log(1e-5) - 1e-6)
