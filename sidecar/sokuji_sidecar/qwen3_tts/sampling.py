"""Sampling primitives for Qwen3 TTS.

Verbatim port of sampling functions from reference run_pipeline.py lines 225-303.
"""

from typing import Optional, Iterable

import numpy as np


def softmax(logits: np.ndarray) -> np.ndarray:
    """Compute softmax over the last axis.

    Args:
        logits: Unnormalized log probabilities.

    Returns:
        Normalized probabilities.
    """
    max_val = np.max(logits, axis=-1, keepdims=True)
    shifted = logits - max_val
    exp = np.exp(shifted)
    denom = np.sum(exp, axis=-1, keepdims=True)
    return exp / denom


def apply_suppress_tokens(logits: np.ndarray, suppress_tokens: Optional[Iterable[int]]) -> np.ndarray:
    """Suppress specified token IDs by masking their logits.

    Args:
        logits: Logit scores of shape [batch, vocab].
        suppress_tokens: Iterable of token IDs to suppress.

    Returns:
        Logits with suppressed tokens masked to -1.0e9.
    """
    if not suppress_tokens:
        return logits
    out = logits.copy()
    for tok in suppress_tokens:
        if 0 <= tok < out.shape[-1]:
            out[:, tok] = -1.0e9
    return out


def apply_repetition_penalty(
    logits: np.ndarray, token_hist: Optional[np.ndarray], penalty: float
) -> np.ndarray:
    """Apply repetition penalty to discourage repeated tokens.

    Divides positive scores by penalty and multiplies negative scores by penalty.

    Args:
        logits: Logit scores of shape [batch, vocab].
        token_hist: Token history of shape [batch, seq_len].
        penalty: Penalty factor (1.0 = no penalty).

    Returns:
        Logits with repetition penalty applied.
    """
    if token_hist is None or penalty is None or penalty == 1.0:
        return logits
    out = logits.copy()
    for b in range(out.shape[0]):
        if token_hist.shape[1] == 0:
            continue
        for tok in np.unique(token_hist[b]):
            if tok < 0 or tok >= out.shape[-1]:
                continue
            score = out[b, tok]
            if score >= 0:
                out[b, tok] = score / penalty
            else:
                out[b, tok] = score * penalty
    return out


def top_k_top_p_filter(logits: np.ndarray, top_k: int, top_p: float) -> np.ndarray:
    """Apply top-k and top-p (nucleus) filtering.

    Suppresses tokens outside top-k by probability and top-p by cumulative probability.

    Args:
        logits: Logit scores of shape [batch, vocab].
        top_k: Keep only top-k tokens (ignored if None or <= 0).
        top_p: Cumulative probability threshold (ignored if None or >= 1.0).

    Returns:
        Filtered logits with suppressed tokens masked to -1.0e9.
    """
    out = logits.copy()
    batch, vocab = out.shape

    if top_k is not None and top_k > 0 and top_k < vocab:
        for b in range(batch):
            thresh = np.partition(out[b], -top_k)[-top_k]
            out[b, out[b] < thresh] = -1.0e9

    if top_p is not None and top_p < 1.0:
        for b in range(batch):
            order = np.argsort(out[b])[::-1]
            sorted_logits = out[b, order]
            probs = softmax(sorted_logits)
            cum = np.cumsum(probs)
            mask = cum > top_p
            if mask.any():
                mask[0] = False
                out[b, order[mask]] = -1.0e9

    return out


def sample_next_token(
    logits: np.ndarray,
    rng: np.random.Generator,
    do_sample: bool,
    top_k: int,
    top_p: float,
    temperature: float,
) -> np.ndarray:
    """Sample the next token given logits.

    Args:
        logits: Logit scores of shape [batch, vocab].
        rng: NumPy random generator for sampling.
        do_sample: If False, return argmax (greedy).
        top_k: Top-k filtering parameter.
        top_p: Top-p (nucleus) filtering parameter.
        temperature: Temperature scaling (normalized to 1.0 if <= 0).

    Returns:
        Sampled token indices of shape [batch] and dtype int64.
    """
    if temperature is None or temperature <= 0:
        temperature = 1.0

    scaled = logits / float(temperature)

    if not do_sample:
        return np.argmax(scaled, axis=-1).astype(np.int64)

    filtered = top_k_top_p_filter(scaled, top_k=top_k, top_p=top_p)
    probs = softmax(filtered)

    out = np.empty((probs.shape[0],), dtype=np.int64)
    for b in range(probs.shape[0]):
        p = probs[b]
        if not np.isfinite(p).any() or p.sum() == 0:
            out[b] = int(np.argmax(scaled[b]))
        else:
            out[b] = int(rng.choice(p.shape[0], p=p))

    return out
