"""Reference greedy loop for the v2 layout: prefill takes input_embeds built on the host.

This is the exact procedure the browser worker mirrors: look the prompt ids up in the
external embedding table, splice the encoder output over the <|audio_pad|> block, run
decoder_init once, then decoder_step per token with the stacked KV cache fed back.
"""
import json
import os

import numpy as np


def load_prompt_config(model_dir: str) -> dict:
    p = os.path.join(model_dir, "prompt_config.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def load_embed(model_dir: str) -> np.ndarray:
    """Return the embedding table as float32 [vocab, hidden], whatever dtype it is stored in."""
    cfg = load_prompt_config(model_dir)
    emb = cfg.get("embedding", {"file": "embed_tokens.bin", "dtype": "float32", "shape": [151936, 1024]})
    shape = tuple(emb["shape"])
    p = os.path.join(model_dir, emb["file"])
    if emb["dtype"] == "float32":
        return np.fromfile(p, dtype=np.float32).reshape(shape)
    if emb["dtype"] == "float16":
        return np.fromfile(p, dtype=np.float16).reshape(shape).astype(np.float32)
    if emb["dtype"] == "int8":
        q = np.fromfile(p, dtype=np.int8).reshape(shape).astype(np.float32)
        scales = np.fromfile(os.path.join(model_dir, emb["scales_file"]), dtype=np.float32).reshape(shape[0], 1)
        return q * scales
    raise ValueError(emb["dtype"])


def greedy_decode(sessions, embed_f32, audio_features, prompt_ids, max_tokens=256,
                  eos=(151643, 151645), audio_pad=151676):
    """sessions: {'decoder_init', 'decoder_step'} ORT sessions (v2 I/O). Returns generated ids incl. EOS."""
    ids = np.asarray(prompt_ids)
    pos = np.where(ids == audio_pad)[0]
    a0, a1 = int(pos[0]), int(pos[-1]) + 1
    assert a1 - a0 == audio_features.shape[1], (a1 - a0, audio_features.shape)
    x = embed_f32[ids].copy()
    x[a0:a1] = audio_features[0]
    init, step = sessions["decoder_init"], sessions["decoder_step"]
    f16 = init.get_inputs()[0].type == "tensor(float16)"
    dt = np.float16 if f16 else np.float32
    logits, pk, pv = init.run(["logits", "present_keys", "present_values"], {
        "input_embeds": x[None].astype(dt),
        "position_ids": np.arange(len(ids), dtype=np.int64)[None],
    })
    nxt = int(np.argmax(logits[0, -1].astype(np.float32)))
    out = [nxt]
    p = len(ids)
    while nxt not in eos and len(out) < max_tokens:
        logits, pk, pv = step.run(["logits", "present_keys", "present_values"], {
            "input_embeds": embed_f32[nxt][None, None].astype(dt),
            "position_ids": np.array([[p]], dtype=np.int64),
            "past_keys": pk, "past_values": pv,
        })
        nxt = int(np.argmax(logits[0, -1].astype(np.float32)))
        out.append(nxt)
        p += 1
    return out
