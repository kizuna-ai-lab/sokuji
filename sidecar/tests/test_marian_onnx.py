import json

import numpy as np
import pytest

from sokuji_sidecar import marian_onnx as mx


class StubTok:
    def encode(self, text):
        class E:
            ids = [11, 12, 0]   # source ids incl. eos
        return E()

    def decode(self, ids, skip_special_tokens=True):
        return " ".join(f"t{i}" for i in ids)


class StubEncoder:
    def run(self, _out, feeds):
        assert feeds["input_ids"].dtype == np.int64
        b, s = feeds["input_ids"].shape
        return [np.zeros((b, s, 16), dtype=np.float32)]


class StubDecoder:
    """Emits 7, 8, then eos (0). Asserts the cache branch protocol.

    Encoder-present shapes on cache-branch steps match Xenova ONNX: batch axis zeroed (0, heads, 1, head_dim).
    """
    def __init__(self):
        self.step = 0

    def get_inputs(self):
        names = ["input_ids", "encoder_attention_mask", "encoder_hidden_states",
                 "use_cache_branch"]
        for i in range(2):
            for kind in ("decoder", "encoder"):
                for kv in ("key", "value"):
                    names.append(f"past_key_values.{i}.{kind}.{kv}")
        return [type("I", (), {"name": n})() for n in names]

    def get_outputs(self):
        names = ["logits"]
        for i in range(2):
            for kind in ("decoder", "encoder"):
                for kv in ("key", "value"):
                    names.append(f"present.{i}.{kind}.{kv}")
        return [type("O", (), {"name": n})() for n in names]

    def run(self, _out, feeds):
        first = not bool(feeds["use_cache_branch"][0])
        if first:
            assert feeds["past_key_values.0.decoder.key"].shape[2] == 0
        else:
            assert feeds["past_key_values.0.decoder.key"].shape[2] == self.step
            assert feeds["past_key_values.0.encoder.key"].shape[2] == 3  # src len, kept
        self.step += 1
        logits = np.zeros((1, feeds["input_ids"].shape[1], 100), dtype=np.float32)
        nxt = {1: 7, 2: 8}.get(self.step, 0)   # step1->7, step2->8, then eos(0)
        logits[0, -1, nxt] = 9.0
        outs = [logits]
        for i in range(2):
            for kind in ("decoder", "encoder"):
                if kind == "decoder":
                    batch, seq = 1, self.step
                elif first:
                    batch, seq = 1, 3  # real encoder, seq=3
                else:
                    batch, seq = 0, 1  # cache-branch dummy: batch zeroed (Xenova shape)
                for _kv in ("key", "value"):
                    outs.append(np.zeros((batch, 4, seq, 4), dtype=np.float32))
        return outs


@pytest.fixture
def model_dir(tmp_path, monkeypatch):
    (tmp_path / "config.json").write_text(json.dumps(
        {"decoder_layers": 2, "decoder_attention_heads": 4, "d_model": 16,
         "eos_token_id": 0}))
    (tmp_path / "generation_config.json").write_text(json.dumps(
        {"decoder_start_token_id": 99, "eos_token_id": 0, "pad_token_id": 99}))
    monkeypatch.setattr(mx, "_load_sessions",
                        lambda d: (StubEncoder(), StubDecoder()))
    monkeypatch.setattr(mx, "_load_tokenizer", lambda d: StubTok())
    return str(tmp_path)


def test_greedy_decode_until_eos(model_dir):
    m = mx.MarianOnnxSession(model_dir)
    text, n = m.translate("whatever")
    assert text == "t7 t8"      # eos excluded, specials skipped by tokenizer
    assert n == 3               # 7, 8, eos — three generated tokens


def test_max_new_tokens_cap(model_dir):
    m = mx.MarianOnnxSession(model_dir)
    _text, n = m.translate("whatever", max_new_tokens=1)
    assert n == 1


class TestSanitizeTokenizerConfig:
    def test_drops_null_charsmap_precompiled_normalizer(self):
        cfg = {"normalizer": {"type": "Precompiled", "precompiled_charsmap": None},
               "other": "field"}
        out = mx._sanitize_tokenizer_config(cfg)
        assert out["normalizer"] is None
        assert out["other"] == "field"

    def test_leaves_other_normalizers_untouched(self):
        cfg = {"normalizer": {"type": "NFKC"}}
        out = mx._sanitize_tokenizer_config(cfg)
        assert out["normalizer"] == {"type": "NFKC"}

    def test_leaves_precompiled_with_charsmap_untouched(self):
        cfg = {"normalizer": {"type": "Precompiled", "precompiled_charsmap": "abc"}}
        out = mx._sanitize_tokenizer_config(cfg)
        assert out["normalizer"] == {"type": "Precompiled", "precompiled_charsmap": "abc"}

    def test_leaves_absent_normalizer_untouched(self):
        cfg = {"other": "field"}
        out = mx._sanitize_tokenizer_config(cfg)
        assert out == {"other": "field"}
