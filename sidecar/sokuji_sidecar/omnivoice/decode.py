# Apache License 2.0
"""Torch-free numpy port of OmniVoice's iterative-unmasking decoder -- the
real classifier-free-guidance + gumbel-scheduled N-step unmasking loop that
drives the 3 backbone ONNX graphs (audio_embeddings -> llm_decoder ->
audio_heads) produced by the corrected bidirectional re-export.

This is a line-for-line port of `OmniVoice._generate_iterative`,
`._predict_tokens_with_scoring`, and the standalone helpers `_get_time_steps` /
`_gumbel_sample` / `_filter_top_k` from the `omnivoice` package
(`omnivoice/models/omnivoice.py`, Apache-2.0, Copyright 2026 Xiaomi Corp),
specialised to **one item** (batch_size == 1) -- the only shape the sidecar's
single-utterance synthesis path ever produces. For one item the model runs a
size-2 classifier-free-guidance batch: row 0 = conditional (full input),
row 1 = unconditional (the target tokens only), with the FULL bidirectional
4-D attention mask that motivated the re-export (a causal export silently
produced garbage; see the strictness tests).

Backbone forward (all fp32 IO on the fp32 oracle; fp16/int4 graphs keep fp32 IO
via keep_io_types, so `run_backbone` reads each graph's declared input dtype and
casts to match):

    embeds = audio_embeddings.run(input_ids (B,8,S) int64, audio_mask (B,S) bool)
           -> inputs_embeds (B,S,1024) fp32
    hidden = llm_decoder.run(inputs_embeds, attention_mask (B,1,S,S) bool)
           -> hidden_states (B,S,1024)
    logits = audio_heads.run(hidden_states) -> logits (B,8,S,1025)

Nothing here imports torch; `numpy` only.
"""
import math
from dataclasses import dataclass

import numpy as np

MASK_ID = 1024          # config.audio_mask_id
NUM_CODEBOOKS = 8       # config.num_audio_codebook
AUDIO_VOCAB = 1025      # config.audio_vocab_size

_ORT_TO_NP = {
    "tensor(float)": np.float32,
    "tensor(float16)": np.float16,
    "tensor(double)": np.float64,
}


@dataclass
class DecodeConfig:
    """The decoding knobs from `OmniVoiceGenerationConfig` that the loop reads,
    with the same library defaults (modeling_omnivoice.py L98)."""
    num_step: int = 32
    guidance_scale: float = 2.0
    t_shift: float = 0.1
    layer_penalty_factor: float = 5.0
    position_temperature: float = 5.0
    class_temperature: float = 0.0


# ---------------------------------------------------------------------------
# Standalone helpers -- verbatim numpy ports of the modeling_omnivoice.py ones
# ---------------------------------------------------------------------------
def _get_time_steps(t_start=0.0, t_end=1.0, num_step=10, t_shift=1.0):
    """Port of `_get_time_steps` (L1509): a linspace warped by the t_shift
    schedule `t_shift*t / (1 + (t_shift-1)*t)`."""
    timesteps = np.linspace(t_start, t_end, num_step + 1)
    timesteps = t_shift * timesteps / (1 + (t_shift - 1) * timesteps)
    return timesteps


def _log_softmax(x, axis=-1):
    """log_softmax over `axis`, numerically stabilised by max-subtraction
    (matches torch.log_softmax for finite inputs)."""
    x = np.asarray(x, dtype=np.float32)
    x_max = np.max(x, axis=axis, keepdims=True)
    shifted = x - x_max
    lse = np.log(np.sum(np.exp(shifted), axis=axis, keepdims=True))
    return shifted - lse


def _filter_top_k(logits, ratio=0.1):
    """Port of `_filter_top_k` (L1494): keep the top ceil(ratio*V) entries per
    row at their positions, set everything else to -inf."""
    k = math.ceil(ratio * logits.shape[-1])
    idx = np.argpartition(logits, -k, axis=-1)[..., -k:]
    out = np.full_like(logits, -np.inf)
    np.put_along_axis(out, idx, np.take_along_axis(logits, idx, axis=-1), axis=-1)
    return out


def _gumbel_sample(logits, temperature, rng):
    """Port of `_gumbel_sample` (L1502): add Gumbel(0,1) noise to logits/temp.
    `rng` is a numpy Generator (the torch original uses global torch.rand)."""
    scaled_logits = np.asarray(logits, dtype=np.float32) / temperature
    u = rng.random(size=scaled_logits.shape).astype(np.float32)
    gumbel_noise = -np.log(-np.log(u + 1e-10) + 1e-10)
    return scaled_logits + gumbel_noise


def _topk_indices(flat_scores, k):
    """Indices of the `k` largest entries (torch.topk(flat, k) semantics).
    -inf entries sort last, so masked positions are never selected; ties break
    by ascending index (stable), matching torch's practical CPU behaviour."""
    order = np.argsort(-flat_scores, kind="stable")
    return order[:k]


# ---------------------------------------------------------------------------
# Backbone forward
# ---------------------------------------------------------------------------
def _input_np_dtype(session, name, default=np.float32):
    for inp in session.get_inputs():
        if inp.name == name:
            return _ORT_TO_NP.get(inp.type, default)
    return default


def run_backbone(sessions, input_ids, audio_mask, attn_mask_4d):
    """One backbone forward over a (B,8,S) token batch with an explicit 4-D
    bool attention mask. Returns audio logits `(B, 8, S, 1025)` fp32 (the
    PyTorch forward's `.logits.to(float32)`)."""
    input_ids = np.asarray(input_ids, dtype=np.int64)
    audio_mask = np.asarray(audio_mask, dtype=np.bool_)
    attn = np.asarray(attn_mask_4d, dtype=np.bool_)

    embeds = sessions["audio_embeddings"].run(
        ["inputs_embeds"],
        {"input_ids": input_ids, "audio_mask": audio_mask})[0]

    llm_dt = _input_np_dtype(sessions["llm_decoder"], "inputs_embeds")
    hidden = sessions["llm_decoder"].run(
        ["hidden_states"],
        {"inputs_embeds": embeds.astype(llm_dt, copy=False),
         "attention_mask": attn})[0]

    heads_dt = _input_np_dtype(sessions["audio_heads"], "hidden_states")
    logits = sessions["audio_heads"].run(
        ["logits"], {"hidden_states": hidden.astype(heads_dt, copy=False)})[0]
    return np.asarray(logits, dtype=np.float32)


# ---------------------------------------------------------------------------
# CFG scoring + batch construction + the unmasking loop
# ---------------------------------------------------------------------------
def _predict_tokens_with_scoring(c_logits, u_logits, cfg, rng):
    """Port of `_predict_tokens_with_scoring` (L1299). Combines conditional and
    unconditional logits under classifier-free guidance, forbids the MASK id,
    and returns (predicted tokens, per-position confidence = max log-prob)."""
    if cfg.guidance_scale != 0:
        c_log_probs = _log_softmax(c_logits, axis=-1)
        u_log_probs = _log_softmax(u_logits, axis=-1)
        log_probs = _log_softmax(
            c_log_probs + cfg.guidance_scale * (c_log_probs - u_log_probs),
            axis=-1)
    else:
        log_probs = _log_softmax(c_logits, axis=-1)

    log_probs = np.array(log_probs, dtype=np.float32, copy=True)
    log_probs[..., MASK_ID] = -np.inf

    if cfg.class_temperature > 0.0:
        filtered_probs = _filter_top_k(log_probs, ratio=0.1)
        pred_tokens = _gumbel_sample(
            filtered_probs, cfg.class_temperature, rng).argmax(axis=-1)
    else:
        pred_tokens = log_probs.argmax(axis=-1)

    confidence_scores = log_probs.max(axis=-1)
    return pred_tokens, confidence_scores


def _build_cfg_batch(input_ids, audio_mask, num_target_tokens):
    """Build the size-2 classifier-free-guidance batch for one item, exactly as
    `_generate_iterative` L1190-1217 with B == 1 (so max_c_len == c_len):

      row 0 (cond)  : full input_ids; full c_len x c_len bidirectional block
      row 1 (uncond): only the trailing `u_len` (target) tokens; a u_len x u_len
                      bidirectional block + a padding diagonal over u_len..c_len

    Accepts input_ids as (8, c_len) or (1, 8, c_len) and audio_mask as (c_len,)
    or (1, c_len). Returns (batch_input_ids, batch_audio_mask, batch_attn,
    c_len, u_len)."""
    input_ids = np.asarray(input_ids, dtype=np.int64)
    if input_ids.ndim == 3:
        input_ids = input_ids[0]
    audio_mask = np.asarray(audio_mask, dtype=np.bool_)
    if audio_mask.ndim == 2:
        audio_mask = audio_mask[0]

    C, c_len = input_ids.shape
    u_len = int(num_target_tokens)
    if u_len > c_len:
        raise ValueError(f"num_target_tokens {u_len} > sequence length {c_len}")
    max_c_len = c_len
    pad_id = MASK_ID

    batch_input_ids = np.full((2, C, max_c_len), pad_id, dtype=np.int64)
    batch_audio_mask = np.zeros((2, max_c_len), dtype=np.bool_)
    batch_attn = np.zeros((2, 1, max_c_len, max_c_len), dtype=np.bool_)

    # Cond (row 0)
    batch_input_ids[0, :, :c_len] = input_ids
    batch_audio_mask[0, :c_len] = audio_mask
    batch_attn[0, :, :c_len, :c_len] = True

    # Uncond (row 1): the last u_len tokens of the cond input (the targets)
    batch_input_ids[1, :, :u_len] = input_ids[:, -u_len:]
    batch_audio_mask[1, :u_len] = audio_mask[-u_len:]
    batch_attn[1, :, :u_len, :u_len] = True
    if max_c_len > u_len:
        pad_diag = np.arange(u_len, max_c_len)
        batch_attn[1, 0, pad_diag, pad_diag] = True

    return batch_input_ids, batch_audio_mask, batch_attn, c_len, u_len


def _decode_loop(sessions, batch_input_ids, batch_audio_mask, batch_attn,
                 c_len, u_len, cfg, rng):
    """The N-step unmasking loop of `_generate_iterative` (L1219-1297) for one
    item. `batch_input_ids` is mutated in place across steps (as PyTorch does).
    Returns the generated codes `(8, u_len)` int64."""
    C = NUM_CODEBOOKS
    t_len = u_len

    tokens = np.full((C, u_len), MASK_ID, dtype=np.int64)

    timesteps = _get_time_steps(0.0, 1.0, cfg.num_step, cfg.t_shift)

    # Per-step unmask counts (L1232-1248): partition the total masked cells
    # across steps by the timestep deltas, remainder on the last step.
    total_mask = t_len * C
    rem = total_mask
    sched = []
    for step in range(cfg.num_step):
        if step == cfg.num_step - 1:
            num = rem
        else:
            num = min(
                math.ceil(total_mask * (timesteps[step + 1] - timesteps[step])),
                rem)
        num = int(num)
        sched.append(num)
        rem -= num

    layer_ids = np.arange(C).reshape(1, C, 1)  # (1, 8, 1)

    for step in range(cfg.num_step):
        batch_logits = run_backbone(
            sessions, batch_input_ids, batch_audio_mask, batch_attn)  # (2,8,S,V)

        k = sched[step]
        if k <= 0:
            continue

        # Cond target logits: row 0, trailing t_len positions.
        c_logits = batch_logits[0:1, :, c_len - t_len:c_len, :]  # (1,8,t_len,V)
        # Uncond target logits: row 1, first t_len positions.
        u_logits = batch_logits[1:2, :, :t_len, :]               # (1,8,t_len,V)

        pred_tokens, scores = _predict_tokens_with_scoring(
            c_logits, u_logits, cfg, rng)          # (1,8,t_len), (1,8,t_len)

        # Bias earlier codebooks to unmask first (L1277).
        scores = scores - layer_ids * cfg.layer_penalty_factor

        if cfg.position_temperature > 0.0:
            scores = _gumbel_sample(scores, cfg.position_temperature, rng)

        scores_2d = scores[0]                      # (8, t_len)
        # Already-unmasked positions can never be re-selected (L1283-1285).
        scores_2d = np.where(tokens != MASK_ID, -np.inf, scores_2d)

        topk_idx = _topk_indices(scores_2d.reshape(-1), k)  # into flat (8*t_len)
        flat_tokens = tokens.reshape(-1).copy()
        flat_pred = pred_tokens[0].reshape(-1)
        flat_tokens[topk_idx] = flat_pred[topk_idx]
        tokens = flat_tokens.reshape(C, t_len)

        # Feed the newly-unmasked tokens back into BOTH cond and uncond rows.
        batch_input_ids[0, :, c_len - t_len:c_len] = tokens
        batch_input_ids[1, :, :t_len] = tokens

    return tokens.astype(np.int64)


def generate_codes(sessions, input_ids, audio_mask, num_target_tokens, *,
                   cfg, seed=None):
    """Numpy port of `OmniVoice._generate_iterative` for one item.

    Args:
        sessions: dict with ORT sessions `audio_embeddings` / `llm_decoder` /
            `audio_heads` (e.g. from `runtime.build_sessions`).
        input_ids: conditional token ids, `(8, c_len)` or `(1, 8, c_len)` int
            (style + text [+ ref] + `num_target_tokens` trailing MASK tokens).
        audio_mask: `(c_len,)` or `(1, c_len)` bool -- True where the row is an
            audio (codec) token.
        num_target_tokens: number of audio tokens to generate.
        cfg: a `DecodeConfig` (or any object exposing the same fields).
        seed: optional int seed for the gumbel RNG (position/class sampling).
            Irrelevant when both temperatures are 0 (fully deterministic).

    Returns:
        `np.int64` codes of shape `(8, num_target_tokens)`.
    """
    (batch_input_ids, batch_audio_mask, batch_attn,
     c_len, u_len) = _build_cfg_batch(input_ids, audio_mask, num_target_tokens)
    rng = np.random.default_rng(seed)
    return _decode_loop(sessions, batch_input_ids, batch_audio_mask,
                        batch_attn, c_len, u_len, cfg, rng)
