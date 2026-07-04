"""CohereOnnxBackend: ORT encoder/decoder-merged greedy loop, torch-free.
Sessions are faked at the onnxruntime seam; the real-model smoke lives behind
SOKUJI_RUN_COHERE_ONNX=1."""
import json
import os
import sys
import types

import numpy as np
import pytest

from sokuji_sidecar import ort_speechllm
from sokuji_sidecar.backends import BackendLoadError, make_backend


PROMPT_TOKENS = ["▁", "<|startofcontext|>", "<|startoftranscript|>", "<|emo:undefined|>",
                 "<|en|>", "<|en|>", "<|pnc|>", "<|noitn|>", "<|notimestamp|>", "<|nodiarize|>"]


class _FakeTok:
    _IDS = {t: 100 + i for i, t in enumerate(dict.fromkeys(PROMPT_TOKENS))}

    def token_to_id(self, t):
        return self._IDS.get(t)

    def decode(self, ids, skip_special_tokens=True):
        return " ".join(f"tok{i}" for i in ids)


class _FakeEncoder:
    def run(self, outs, feeds):
        t = feeds["input_features"].shape[1]
        return [np.zeros((1, t // 8, 1024), np.float32)]

    def get_inputs(self):
        return [types.SimpleNamespace(name="input_features")]


class _FakeDecoder:
    """Emits token 7 three times, then eos (3). Records the feeds per step."""
    EOS = 3

    def __init__(self):
        self.calls = []
        self._step = 0

    def get_inputs(self):
        names = ["input_ids", "attention_mask", "position_ids", "num_logits_to_keep",
                 "encoder_hidden_states"]
        for i in range(8):
            for br in ("decoder", "encoder"):
                for kv in ("key", "value"):
                    names.append(f"past_key_values.{i}.{br}.{kv}")
        return [types.SimpleNamespace(name=n) for n in names]

    def run(self, outs, feeds):
        self.calls.append({k: (v.shape if isinstance(v, np.ndarray) else v)
                           for k, v in feeds.items()})
        past = feeds["past_key_values.0.decoder.key"].shape[2]
        new = feeds["input_ids"].shape[1]
        tok = 7 if self._step < 3 else self.EOS
        self._step += 1
        logits = np.full((1, 1, 16384), -1e9, np.float32)
        logits[0, 0, tok] = 0.0
        out = [logits]
        for i in range(8):
            out.append(np.zeros((1, 8, past + new, 128), np.float32))  # decoder.key
            out.append(np.zeros((1, 8, past + new, 128), np.float32))  # decoder.value
            enc_len = feeds["encoder_hidden_states"].shape[1] if past == 0 else 0
            out.append(np.zeros((1, 8, enc_len, 128), np.float32))     # encoder.key
            out.append(np.zeros((1, 8, enc_len, 128), np.float32))     # encoder.value
        return out


@pytest.fixture
def loaded(monkeypatch, tmp_path):
    (tmp_path / "tokenizer.json").write_text("{}")
    (tmp_path / "generation_config.json").write_text(json.dumps({"eos_token_id": 3}))
    b = make_backend("cohere_onnx")
    dec = _FakeDecoder()
    monkeypatch.setattr(ort_speechllm, "_load_sessions",
                        lambda d, suffix, device: (_FakeEncoder(), dec))
    monkeypatch.setattr(ort_speechllm, "_load_tokenizer", lambda d: _FakeTok())
    monkeypatch.setattr(ort_speechllm, "_snapshot", lambda ref: str(tmp_path))
    b.load("onnx-community/cohere-transcribe-03-2026-ONNX", "cpu", "q4")
    return b, dec


def test_greedy_loop_stops_at_eos_and_decodes(loaded):
    b, dec = loaded
    r = b.transcribe(np.zeros(16000, np.float32), "en")
    assert r.text == "tok7 tok7 tok7"      # eos excluded, specials skipped
    # step 0: full 10-token prompt, no past; steps 1..: single token with past
    assert dec.calls[0]["input_ids"] == (1, 10)
    assert dec.calls[0]["past_key_values.0.decoder.key"] == (1, 8, 0, 128)
    assert dec.calls[1]["input_ids"] == (1, 1)
    assert dec.calls[1]["past_key_values.0.decoder.key"] == (1, 8, 10, 128)
    # encoder KV from step 0 is re-fed on the cache branch, not zero-length
    assert dec.calls[1]["past_key_values.0.encoder.key"][2] > 0
    # attention mask covers past+new; position ids advance
    assert dec.calls[1]["attention_mask"] == (1, 11)


def test_prompt_uses_language_token(loaded):
    b, dec = loaded
    b.transcribe(np.zeros(16000, np.float32), "en")
    # prompt ids came from the tokenizer's convert-tokens path; the language
    # token appears twice (Cohere prompt format duplicates it)
    ids = b._prompt_ids("en")
    assert len(ids) == 10 and ids[4] == ids[5] == _FakeTok._IDS["<|en|>"]


def test_unknown_language_falls_back_to_en(loaded):
    b, dec = loaded
    r = b.transcribe(np.zeros(16000, np.float32), "xx")   # unsupported → en prompt
    assert r.text  # still transcribes rather than raising


def test_cpu_load_failure_raises_backend_error(monkeypatch):
    b = make_backend("cohere_onnx")
    monkeypatch.setattr(ort_speechllm, "_snapshot",
                        lambda ref: (_ for _ in ()).throw(FileNotFoundError("not cached")))
    with pytest.raises(BackendLoadError):
        b.load("onnx-community/cohere-transcribe-03-2026-ONNX", "cpu", "q4")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_COHERE_ONNX"),
                    reason="set SOKUJI_RUN_COHERE_ONNX=1 (needs the 2.1GB q4 snapshot cached)")
def test_real_transcription_smoke():
    import wave
    from huggingface_hub import snapshot_download
    b = make_backend("cohere_onnx")
    b.load("onnx-community/cohere-transcribe-03-2026-ONNX", "cpu", "q4")
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    import time
    t0 = time.perf_counter()
    r = b.transcribe(audio, "en")
    rtf = (time.perf_counter() - t0) / (len(audio) / 16000.0)
    print(f"cohere-onnx cpu RTF={rtf:.3f} text={r.text!r}")
    assert r.text.strip()
