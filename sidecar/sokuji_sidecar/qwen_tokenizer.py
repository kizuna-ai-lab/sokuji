"""Qwen2-style tokenizer rebuilt from vocab.json + merges.txt with the
`tokenizers` library — a drop-in for transformers' AutoTokenizer in repos that
ship the classic BPE file pair but no tokenizer.json (our Qwen3-TTS ONNX
exports). Structure mirrors Qwen2's tokenizer.json exactly: byte-level BPE, a
Split pre-tokenizer with Qwen's regex, ByteLevel encoding with no prefix space.

Shared by Qwen3-TTS today and reusable by the Qwen3-ASR ORT port (same
Qwen2Tokenizer family)."""
import json
import os

from tokenizers import AddedToken, Regex, Tokenizer, decoders, models, pre_tokenizers

# Qwen2's split pattern (verbatim from Qwen tokenizer.json / tiktoken heritage).
_QWEN2_SPLIT = (
    r"""(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}|"""
    r""" ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+"""
)


def load_qwen2_tokenizer(model_dir: str) -> Tokenizer:
    """Build the tokenizer from `model_dir`/vocab.json + merges.txt. Raises when
    either file is missing (caller surfaces it as a BackendLoadError)."""
    vocab = os.path.join(model_dir, "vocab.json")
    merges = os.path.join(model_dir, "merges.txt")
    tok = Tokenizer(models.BPE.from_file(vocab, merges, byte_fallback=False))
    tok.pre_tokenizer = pre_tokenizers.Sequence([
        pre_tokenizers.Split(Regex(_QWEN2_SPLIT), behavior="isolated", invert=False),
        pre_tokenizers.ByteLevel(add_prefix_space=False, use_regex=False),
    ])
    tok.decoder = decoders.ByteLevel()
    # The specials (<|im_start|>, <|im_end|>, the tts_* family, ...) live in
    # tokenizer_config.json's added_tokens_decoder (ids past the base vocab),
    # NOT in vocab.json — without registering them the chat template shreds
    # into byte-BPE pieces ('<','|','im','_start',...) and the Qwen3-TTS
    # talker-prompt slicing grabs garbage (field-debugged: babble on every
    # device because the model never saw the text). Insert in ascending-id
    # order — `tokenizers` assigns added ids sequentially after the base
    # vocab — then verify each landed on its declared id.
    cfg_path = os.path.join(model_dir, "tokenizer_config.json")
    if os.path.isfile(cfg_path):
        with open(cfg_path, encoding="utf-8") as f:
            added = json.load(f).get("added_tokens_decoder", {})
        for tid, spec in sorted(added.items(), key=lambda kv: int(kv[0])):
            token = AddedToken(
                spec["content"],
                special=bool(spec.get("special", True)),
                normalized=bool(spec.get("normalized", False)),
                lstrip=bool(spec.get("lstrip", False)),
                rstrip=bool(spec.get("rstrip", False)),
                single_word=bool(spec.get("single_word", False)),
            )
            if bool(spec.get("special", True)):
                tok.add_special_tokens([token])
            else:
                tok.add_tokens([token])
            got = tok.token_to_id(spec["content"])
            if got != int(tid):
                raise ValueError(
                    f"added token {spec['content']!r} landed on id {got}, "
                    f"tokenizer_config.json declares {tid} — vocab.json size "
                    f"and added_tokens_decoder ids disagree")
    return tok
