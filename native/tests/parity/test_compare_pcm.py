import numpy as np
import pytest

from compare_pcm import compare, main, verdict


def test_identical_is_exact():
    x = np.sin(np.linspace(0, 100, 16000)).astype(np.float32)
    r = compare(x, x.copy())
    assert r.max_abs == 0.0 and r.snr_db == float("inf")
    assert verdict(r, exact=True) is True


def test_small_noise_has_finite_snr():
    rng = np.random.default_rng(0)
    x = np.sin(np.linspace(0, 100, 16000)).astype(np.float32)
    y = x + rng.normal(0, 1e-4, x.shape).astype(np.float32)
    r = compare(x, y)
    assert 0 < r.max_abs < 1e-3
    assert 60 < r.snr_db < 90
    assert verdict(r, exact=True) is False
    assert verdict(r, min_snr=60) is True
    assert verdict(r, min_snr=95) is False


def test_length_mismatch_fails():
    x = np.zeros(100, np.float32)
    with pytest.raises(ValueError):
        compare(x, np.zeros(101, np.float32))


def test_channel_count_mismatch_fails():
    mono = np.zeros(100, np.float32)
    stereo = np.zeros((100, 2), np.float32)
    with pytest.raises(ValueError):
        compare(mono, stereo)


def test_swapped_stereo_channels_are_not_exact():
    # Downmixing would turn [1, -1] and [-1, 1] into the same zero — the comparator must not.
    ref = np.tile(np.array([[1.0, -1.0]], np.float32), (100, 1))
    got = ref[:, ::-1].copy()
    r = compare(ref, got)
    assert r.max_abs == 2.0
    assert verdict(r, exact=True) is False


def test_cli_rejects_sample_rate_mismatch(monkeypatch):
    x = np.zeros(100, np.float32)
    monkeypatch.setattr("compare_pcm._read_wav", lambda path: (x, 16000 if path == "ref.wav" else 24000))
    with pytest.raises(ValueError, match="sample-rate mismatch"):
        main(["ref.wav", "got.wav", "--exact"])
