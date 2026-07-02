import numpy as np
from sokuji_sidecar.qwen3_tts import sampling as S


def test_greedy_argmax_when_not_sampling():
    logits = np.array([[0.1, 2.0, -1.0]], np.float32)
    out = S.sample_next_token(logits, np.random.default_rng(0), do_sample=False, top_k=50, top_p=1.0, temperature=0.9)
    assert out.tolist() == [1]


def test_suppress_tokens_masks_ids():
    logits = np.zeros((1, 5), np.float32)
    out = S.apply_suppress_tokens(logits, [3, 4])
    assert out[0, 3] < -1e8 and out[0, 4] < -1e8 and out[0, 0] == 0


def test_repetition_penalty_divides_positive_and_multiplies_negative():
    logits = np.array([[2.0, -2.0]], np.float32)
    hist = np.array([[0, 1]], np.int64)
    out = S.apply_repetition_penalty(logits, hist, 2.0)
    assert np.isclose(out[0, 0], 1.0) and np.isclose(out[0, 1], -4.0)


def test_top_k_keeps_only_k():
    logits = np.array([[1.0, 2.0, 3.0, 4.0]], np.float32)
    out = S.top_k_top_p_filter(logits, top_k=2, top_p=1.0)
    assert (out[0, :2] < -1e8).all() and out[0, 2] == 3.0 and out[0, 3] == 4.0


def test_sampling_deterministic_with_seeded_rng():
    logits = np.log(np.array([[0.05, 0.9, 0.05]], np.float32))
    a = S.sample_next_token(logits, np.random.default_rng(7), True, 50, 1.0, 1.0)
    b = S.sample_next_token(logits, np.random.default_rng(7), True, 50, 1.0, 1.0)
    assert a.tolist() == b.tolist()
