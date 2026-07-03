"""Greedy decode loop for MarianMT ONNX exports (Xenova opus-mt-* layout):
encoder_model_quantized.onnx + decoder_model_merged_quantized.onnx driven with
numpy tensors — no torch, no transformers. The merged decoder takes a
use_cache_branch flag: the first step runs without past (zero-length past
tensors), later steps feed the presents back. Encoder cross-attention presents
are computed once on the first step and reused (the cache branch returns
zero-length dummies for them)."""
import json
import os

import numpy as np


def _load_sessions(model_dir: str):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    enc = ort.InferenceSession(
        os.path.join(model_dir, "onnx", "encoder_model_quantized.onnx"),
        opts, providers=["CPUExecutionProvider"])
    dec = ort.InferenceSession(
        os.path.join(model_dir, "onnx", "decoder_model_merged_quantized.onnx"),
        opts, providers=["CPUExecutionProvider"])
    return enc, dec


def _sanitize_tokenizer_config(cfg: dict) -> dict:
    """tokenizers>=0.20 panics on Marian exports' 'Precompiled' normalizer with a
    null charsmap. A null charsmap is a no-op, so drop the normalizer (same
    effective behavior as transformers.js, which the WASM path uses)."""
    norm = cfg.get("normalizer")
    if isinstance(norm, dict) and norm.get("type") == "Precompiled" \
            and norm.get("precompiled_charsmap") is None:
        cfg = {**cfg, "normalizer": None}
    return cfg


def _load_tokenizer(model_dir: str):
    from tokenizers import Tokenizer
    with open(os.path.join(model_dir, "tokenizer.json")) as f:
        cfg = json.load(f)
    cfg = _sanitize_tokenizer_config(cfg)
    tok = Tokenizer.from_str(json.dumps(cfg))
    tok.enable_truncation(max_length=512)   # Marian positional embeddings cap
    return tok


class MarianOnnxSession:
    def __init__(self, model_dir: str):
        with open(os.path.join(model_dir, "config.json")) as f:
            cfg = json.load(f)
        gen_path = os.path.join(model_dir, "generation_config.json")
        gen = {}
        if os.path.exists(gen_path):
            with open(gen_path) as f:
                gen = json.load(f)
        self._layers = cfg["decoder_layers"]
        self._heads = cfg["decoder_attention_heads"]
        self._head_dim = cfg["d_model"] // self._heads
        self._start = gen.get("decoder_start_token_id",
                              cfg.get("decoder_start_token_id", cfg.get("pad_token_id")))
        self._eos = gen.get("eos_token_id", cfg.get("eos_token_id"))
        self._encoder, self._decoder = _load_sessions(model_dir)
        self._tok = _load_tokenizer(model_dir)
        self._past_names = [f"past_key_values.{i}.{kind}.{kv}"
                            for i in range(self._layers)
                            for kind in ("decoder", "encoder")
                            for kv in ("key", "value")]
        self._present_names = [n.replace("past_key_values", "present")
                               for n in self._past_names]

    def _empty_past(self):
        shape = (1, self._heads, 0, self._head_dim)
        return {n: np.zeros(shape, dtype=np.float32) for n in self._past_names}

    def translate(self, text: str, max_new_tokens: int = 512) -> tuple[str, int]:
        src_ids = np.array([self._tok.encode(text).ids], dtype=np.int64)
        attn = np.ones_like(src_ids)
        enc_out = self._encoder.run(None, {"input_ids": src_ids,
                                           "attention_mask": attn})[0]
        past = self._empty_past()
        ids = [self._start]
        generated = []
        for step in range(max_new_tokens):
            feeds = {"input_ids": np.array([[ids[-1]]], dtype=np.int64),
                     "encoder_attention_mask": attn,
                     "encoder_hidden_states": enc_out,
                     "use_cache_branch": np.array([step > 0])}
            feeds.update(past)
            outs = self._decoder.run(None, feeds)
            logits = outs[0]
            nxt = int(np.argmax(logits[0, -1]))
            generated.append(nxt)
            # Presents: decoder entries always refresh; encoder entries only on
            # the first (no-cache) step — the cache branch returns empty dummies
            # for them. Gate on `step` (which branch we *asked* the graph to
            # run), not on the dummy tensors' shape: real exports place the
            # "empty" 0 in whichever axis the graph happens to pick (observed:
            # batch dim, not the sequence dim), so a shape-based emptiness
            # check is export-fragile and silently accepts a corrupt cache.
            for name, arr in zip(self._present_names, outs[1:]):
                past_name = name.replace("present", "past_key_values")
                if ".decoder." in name or step == 0:
                    past[past_name] = arr
            if nxt == self._eos:
                break
            ids.append(nxt)
        out_ids = [t for t in generated if t != self._eos]
        return self._tok.decode(out_ids, skip_special_tokens=True).strip(), len(generated)
