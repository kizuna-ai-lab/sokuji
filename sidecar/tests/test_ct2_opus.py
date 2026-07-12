import sys
import types

import pytest


class StubSp:
    """SentencePieceProcessor stand-in: 1 char = 1 piece; decode joins."""
    def __init__(self, model_file):
        self.model_file = model_file
    def encode(self, text, out_type=str):
        return list(text)
    def decode(self, pieces):
        return "".join(pieces)


class StubResult:
    def __init__(self, hyp):
        self.hypotheses = [hyp]


class StubTranslator:
    def __init__(self, model_dir, device, compute_type, inter_threads):
        assert device == "cpu" and compute_type == "int8"
        self.calls = []
    def translate_batch(self, batches, beam_size, max_decoding_length):
        self.calls.append((batches, beam_size, max_decoding_length))
        # echo the source pieces minus the trailing </s>, prefixed
        return [StubResult(["T:"] + batches[0][:-1])]


@pytest.fixture
def ct2(monkeypatch):
    fake_ct2 = types.SimpleNamespace(Translator=StubTranslator)
    fake_sp = types.SimpleNamespace(SentencePieceProcessor=StubSp)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ct2)
    monkeypatch.setitem(sys.modules, "sentencepiece", fake_sp)
    from sokuji_sidecar import ct2_opus
    return ct2_opus


def test_translate_appends_source_eos_and_decodes(ct2):
    s = ct2.Ct2OpusSession("/models/x")
    text, n = s.translate("abc")
    batches, beam, _maxlen = s._translator.calls[0]
    assert batches[0] == ["a", "b", "c", "</s>"]   # manual EOS appended
    assert beam == 1                                # greedy, matches old loop
    assert text == "T:abc"
    assert n == 4                                   # hypothesis token count


def test_translate_truncates_at_510_pieces(ct2):
    s = ct2.Ct2OpusSession("/models/x")
    s.translate("x" * 600)
    batches, _, _ = s._translator.calls[0]
    assert len(batches[0]) == 511                   # 510 pieces + </s>
    assert batches[0][-1] == "</s>"
