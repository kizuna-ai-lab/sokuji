"""Qwen2-style tokenizer rebuilt from vocab.json + merges.txt with the
`tokenizers` library — a drop-in for transformers' AutoTokenizer in repos that
ship the classic BPE file pair but no tokenizer.json (our Qwen3-TTS ONNX
exports). Structure mirrors Qwen2's tokenizer.json exactly: byte-level BPE, a
Split pre-tokenizer with Qwen's regex, ByteLevel encoding with no prefix space.

Shared by Qwen3-TTS today and reusable by the Qwen3-ASR ORT port (same
Qwen2Tokenizer family)."""
import os

from tokenizers import Regex, Tokenizer, decoders, models, pre_tokenizers

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
    return tok
