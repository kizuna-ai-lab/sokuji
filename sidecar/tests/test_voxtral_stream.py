import os
import threading
import time
import types

import numpy as np
import pytest


class _FakeStreamer:
    """Stand-in for TextIteratorStreamer: a thread-safe iterator of strings the
    fake model 'generates'. end-of-iteration is signalled by put(None)."""
    def __init__(self):
        import queue
        self._q = queue.Queue()
    def put_text(self, s): self._q.put(s)
    def end(self): self._q.put(None)
    def __iter__(self): return self
    def __next__(self):
        v = self._q.get()
        if v is None:
            raise StopIteration
        return v


def _fake_proc():
    fe = types.SimpleNamespace(hop_length=160, win_length=400, sampling_rate=16000)

    # processor(samples, is_streaming=, is_first_audio_chunk=, return_tensors=) -> batch
    def _call(samples, is_streaming, is_first_audio_chunk, return_tensors):
        b = {"input_features": _Castable()}
        if is_first_audio_chunk:
            b["input_ids"] = "IDS"
            b["num_delay_tokens"] = 6
        return _FakeBatch(b)

    # SimpleNamespace doesn't support dunder methods on instances; use a class
    class _Proc:
        feature_extractor = fe
        num_samples_first_audio_chunk = 9000
        num_samples_per_audio_chunk = 1680
        num_mel_frames_first_audio_chunk = 56
        audio_length_per_tok = 8
        raw_audio_length_per_tok = 1280
        tokenizer = object()
        @staticmethod
        def num_right_pad_tokens(transcription_delay_ms=None): return 17
        def __call__(self, samples, is_streaming, is_first_audio_chunk, return_tensors):
            return _call(samples, is_streaming, is_first_audio_chunk, return_tensors)

    return _Proc()


class _Castable:
    def to(self, device, dtype=None): return self

class _FakeBatch(dict):
    num_delay_tokens = 6
    input_ids = "IDS"
    input_features = _Castable()
    def to(self, device, dtype=None): return self


def _fake_model(streamer, generated="hello world"):
    class M:
        device = "cpu"
        dtype = "BF16"
        def generate(self, input_ids, input_features, num_delay_tokens, streamer):
            # drain the live generator (proves lazy feeding works), then emit tokens
            for _ in input_features:
                pass
            for tok in generated.split():
                streamer.put_text(tok + " ")
            streamer.end()
    return M()


def test_stream_feed_drain_end(monkeypatch):
    from sokuji_sidecar import voxtral_stream
    proc = _fake_proc()
    streamer = _FakeStreamer()
    monkeypatch.setattr(voxtral_stream, "TextIteratorStreamer", lambda *a, **k: streamer)
    model = _fake_model(streamer)
    s = voxtral_stream.VoxtralRealtimeStream(model, proc, "cpu", "BF16")
    # feed enough to start (>= first chunk), then more
    s.feed(np.zeros(9000, np.float32))
    s.feed(np.zeros(4000, np.float32))
    final = s.end()                       # flushes right-pad, joins the generate thread
    assert final.strip() == "hello world"
    assert s.aborted is False


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (uses cached Voxtral-Mini-4B-Realtime; needs CUDA)")
def test_voxtral_stream_real_gpu_live():
    import glob
    import wave
    import torch
    from huggingface_hub import snapshot_download
    from sokuji_sidecar import backends
    d = snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602",
                          ignore_patterns=["consolidated.safetensors", "*.gitattributes"])
    b = backends.make_backend("voxtral_realtime")
    b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")
    wav = glob.glob(os.path.expanduser(
        "~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-sense-voice*/snapshots/*/test_wavs/en.wav"))[0]
    w = wave.open(wav)
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    s = b.open_stream()
    partials = []
    for i in range(0, len(audio), 1600):          # 100ms chunks
        s.feed(audio[i:i + 1600])
        partials += s.drain()
    final = s.end()
    assert final.strip(), f"empty final: {final!r}"
    assert "tribal" in final.lower() or "gold" in final.lower(), f"unexpected: {final!r}"
    assert len(partials) > 0, "no partials streamed"
    print(f"voxtral stream: {len(partials)} partials, final={final.strip()!r}")
    b.unload()


def test_split_sentences():
    from sokuji_sidecar.voxtral_stream import split_sentences
    assert split_sentences("Ask what you do. Ask not ") == (["Ask what you do."], "Ask not ")
    assert split_sentences("hello wor") == ([], "hello wor")
    assert split_sentences("x. Ask") == (["x."], "Ask")          # delta straddling a boundary
    assert split_sentences("3.5 ml ") == ([], "3.5 ml ")         # decimal NOT split (no space after .)
    assert split_sentences("country.") == ([], "country.")       # no trailing space -> held for flush
    assert split_sentences("a. b! c? d") == (["a.", "b!", "c?"], "d")
    assert split_sentences("") == ([], "")


def test_generate_exception_unblocks_reader_and_end(monkeypatch):
    # If model.generate() raises, _read() must still terminate (via streamer.end() in the
    # except) so it emits the None sentinel and end() returns instead of deadlocking.
    from sokuji_sidecar import voxtral_stream
    proc = _fake_proc()
    streamer = _FakeStreamer()
    monkeypatch.setattr(voxtral_stream, "TextIteratorStreamer", lambda *a, **k: streamer)

    class _BoomModel:
        device = "cpu"
        dtype = "BF16"
        def generate(self, **kwargs):
            raise RuntimeError("generate crashed")

    s = voxtral_stream.VoxtralRealtimeStream(_BoomModel(), proc, "cpu", "BF16")
    s.feed(np.zeros(9000, np.float32))     # >= first chunk -> starts the gen + reader threads
    final = s.end()                        # must return, not hang
    assert s.aborted is True
    assert final == ""                     # nothing generated


def test_drain_preserves_completion_sentinel():
    # drain() must NOT consume the None completion sentinel — end() blocks on get() until it
    # sees None, so if drain() removed it (e.g. generate finished/crashed before end()), end()
    # would hang forever. drain() should requeue the sentinel and stop.
    import queue
    from sokuji_sidecar import voxtral_stream
    s = voxtral_stream.VoxtralRealtimeStream(object(), _fake_proc(), "cpu", "BF16")
    s._deltas.put("a ")
    s._deltas.put("b ")
    s._deltas.put(None)                          # generation finished
    assert s.drain() == ["a ", "b "]             # real deltas returned
    assert s.drain() == []                       # nothing left but the preserved sentinel
    assert s._deltas.get_nowait() is None        # sentinel still there for end()
