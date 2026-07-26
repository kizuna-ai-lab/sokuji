"""qwen_tokenizer: Qwen2-style byte-level BPE rebuilt from vocab.json+merges.txt
via the `tokenizers` library — the torch/transformers-free replacement for
AutoTokenizer in Qwen3-TTS (and later Qwen3-ASR ORT).

The golden test compares ids against transformers' AutoTokenizer on the real
snapshot; it self-skips when the snapshot or transformers is unavailable so CI
without the model cache stays green."""
import os

import pytest

from sokuji_sidecar.qwen_tokenizer import load_qwen2_tokenizer


def _snapshot_dir():
    try:
        from huggingface_hub import snapshot_download
        return snapshot_download("jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32", local_files_only=True)
    except Exception:
        return None


GOLDEN_TEXTS = [
    # Chat-template text FIRST: specials live in tokenizer_config.json's
    # added_tokens_decoder (ids 151643+), not vocab.json — parity here is
    # what keeps the talker-prompt slicing sane (see the atomic test below).
    "<|im_start|>assistant\nHello<|im_end|>\n<|im_start|>assistant\n",
    "Hello, world!",
    "The weather is lovely today, so I will go for a walk in the park.",
    "你好，世界。今天天气不错。",
    "こんにちは、世界。テストです。",
    "안녕하세요 세계",
    "Mixed 中文 and English 123 numbers 456.789",
    "  leading spaces and\n\nnewlines\t tabs ",
    "emoji 🎉🚀 and symbols €¥£ §¶",
    "don't we'll it's I'm you're",
    "",
]


@pytest.mark.skipif(_snapshot_dir() is None, reason="qwen3-tts snapshot not cached")
def test_loads_from_vocab_and_merges():
    d = _snapshot_dir()
    tok = load_qwen2_tokenizer(d)
    ids = tok.encode("Hello, world!", add_special_tokens=False).ids
    assert isinstance(ids, list) and len(ids) > 0
    assert all(isinstance(i, int) for i in ids)


@pytest.mark.skipif(_snapshot_dir() is None, reason="qwen3-tts snapshot not cached")
def test_golden_parity_with_transformers():
    transformers = pytest.importorskip("transformers")
    d = _snapshot_dir()
    ref = transformers.AutoTokenizer.from_pretrained(d, local_files_only=True)
    tok = load_qwen2_tokenizer(d)
    for text in GOLDEN_TEXTS:
        expected = ref.encode(text, add_special_tokens=False)
        actual = tok.encode(text, add_special_tokens=False).ids
        assert actual == expected, f"mismatch for {text!r}"


@pytest.mark.skipif(_snapshot_dir() is None, reason="qwen3-tts snapshot not cached")
def test_special_tokens_encode_atomically():
    """<|im_start|>/<|im_end|>/tts specials come from tokenizer_config.json's
    added_tokens_decoder — without registering them the chat template shreds
    into byte-BPE pieces ('<','|','im','_start',...) and the talker prompt's
    [:3] role / [-5:] closing slices grab garbage. Field-debugged as Qwen3-TTS
    babbling on every device: the model never saw the text."""
    d = _snapshot_dir()
    tok = load_qwen2_tokenizer(d)
    assert tok.encode("<|im_start|>", add_special_tokens=False).ids == [151644]
    ids = tok.encode("<|im_start|>assistant\nHi<|im_end|>\n<|im_start|>assistant\n",
                     add_special_tokens=False).ids
    assert ids[:3] == [151644, 77091, 198]                 # im_start, 'assistant', '\n'
    assert ids[-5:] == [151645, 198, 151644, 77091, 198]   # im_end, '\n', im_start, 'assistant', '\n'


def test_missing_dir_raises():
    # tokenizers' pyo3 layer raises a PLAIN Exception (no narrower class to
    # catch) — pin the message instead so an unrelated bug can't satisfy this.
    with pytest.raises(Exception, match="BPE files"):
        load_qwen2_tokenizer(os.path.join(os.sep, "nonexistent", "dir"))
