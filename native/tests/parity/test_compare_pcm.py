import numpy as np
import pytest

from compare_pcm import compare, verdict


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
