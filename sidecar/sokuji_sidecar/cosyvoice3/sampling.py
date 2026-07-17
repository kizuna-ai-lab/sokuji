"""CosyVoice3 official sampler: nucleus top-p/top-k with repetition-aware resampling.

Port of ras_sampling from FunAudioLLM/CosyVoice inference code (cosyvoice/utils/common.py)
implemented in numpy (no torch).
"""

import numpy as np


def log_softmax(logits: np.ndarray) -> np.ndarray:
    """Numerically stable log-softmax.

    Args:
        logits: input array of log-space logits

    Returns:
        log probabilities with stable computation (uses max-subtraction trick)
    """
    logp = logits.astype(np.float64)
    return logp - np.log(np.sum(np.exp(logp - logp.max()))) - logp.max()


def _softmax(logp: np.ndarray) -> np.ndarray:
    """Convert log probabilities to probabilities with numerical stability.

    Args:
        logp: log probabilities

    Returns:
        normalized probabilities (sum to 1.0)
    """
    p = np.exp(logp - logp.max())
    return p / p.sum()


def _nucleus_sample(probs: np.ndarray, rng: np.random.Generator,
                    top_p: float = 0.8, top_k: int = 25) -> int:
    """Nucleus (top-p) sampling with top-k constraint.

    Selects candidates from the nucleus (cumulative probability up to top_p)
    with at most top_k tokens, using stable descending sort. Selected tokens
    are renormalized and sampled with rng.choice.

    Args:
        probs: probability array
        rng: numpy random generator
        top_p: cumulative probability threshold (0.8 default)
        top_k: maximum number of candidates (25 default)

    Returns:
        sampled token id (integer)
    """
    order = np.argsort(-probs, kind="stable")
    cum, sel = 0.0, []
    for idx in order:
        if cum < top_p and len(sel) < top_k:
            cum += probs[idx]
            sel.append(int(idx))
        else:
            break
    weights = probs[sel]
    return int(rng.choice(sel, p=weights / weights.sum()))


def ras_sampling(logp: np.ndarray, decoded_tokens: list,
                 rng: np.random.Generator,
                 top_p: float = 0.8, top_k: int = 25,
                 win_size: int = 10, tau_r: float = 0.1) -> int:
    """Repetition-aware nucleus sampling (official CosyVoice3 sampler).

    Performs nucleus sampling on log probabilities. If the sampled token
    appeared too frequently in the recent window (>= win_size * tau_r times
    in the last win_size tokens), bans it and resamples from the full
    vocabulary.

    Args:
        logp: log probabilities over vocabulary
        decoded_tokens: full sequence of previously decoded token ids
        rng: numpy random generator
        top_p: nucleus cumulative probability threshold (default 0.8)
        top_k: maximum nucleus size (default 25)
        win_size: history window for repetition check (default 10)
        tau_r: repetition threshold as fraction of win_size (default 0.1)

    Returns:
        sampled token id (integer)
    """
    probs = _softmax(logp)
    top_id = _nucleus_sample(probs, rng, top_p, top_k)
    rep_num = sum(1 for t in decoded_tokens[-win_size:] if t == top_id)
    if rep_num >= win_size * tau_r:
        banned = logp.copy()
        banned[top_id] = -np.inf
        p = _softmax(banned)
        top_id = int(rng.choice(len(p), p=p))
    return top_id
