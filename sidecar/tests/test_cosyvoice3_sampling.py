import numpy as np

from sokuji_sidecar.cosyvoice3.sampling import log_softmax, ras_sampling


def _peaked_logits(n=6761, peak=42, value=50.0):
    x = np.zeros(n)
    x[peak] = value
    return x


def test_log_softmax_normalizes():
    lp = log_softmax(_peaked_logits())
    assert abs(np.exp(lp).sum() - 1.0) < 1e-9


def test_deterministic_peak_wins():
    rng = np.random.default_rng(0)
    lp = log_softmax(_peaked_logits(peak=42))
    assert ras_sampling(lp, [], rng) == 42


def test_masked_ids_never_sampled():
    rng = np.random.default_rng(0)
    lp = log_softmax(np.zeros(6761))
    lp[6561:] = -np.inf                       # the min_len stop-mask
    for _ in range(200):
        assert ras_sampling(lp, [], rng) < 6561


def test_repetition_triggers_resample():
    # peak token appeared in the last-10 window -> RAS bans it and samples
    # from the full softmax; with the peak banned, another id must come out.
    rng = np.random.default_rng(0)
    lp = log_softmax(_peaked_logits(peak=7, value=50.0))
    out = ras_sampling(lp, [7], rng)
    assert out != 7


def test_repetition_outside_window_ignored():
    rng = np.random.default_rng(0)
    lp = log_softmax(_peaked_logits(peak=7, value=50.0))
    decoded = [7] + [1] * 10                  # the 7 is outside the last-10
    assert ras_sampling(lp, decoded, rng) == 7
