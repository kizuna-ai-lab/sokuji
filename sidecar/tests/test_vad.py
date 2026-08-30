"""NativeVad: the engine's VAD protocol (is_speech_detected / accept_waveform / empty /
front / pop / flush) over sokuji_native.vad_open. The native Vad is scripted."""
import os
import sys
import types

import numpy as np
import pytest

from sokuji_sidecar import native


class _Ev:
    def __init__(self, kind, sample=0, seg_start=0, seg_end=0):
        self.kind, self.sample, self.probability, self.seg_start, self.seg_end = kind, sample, 0.9, seg_start, seg_end


class _ScriptedVad:
    """feed() returns the scripted event for the k-th window, else None."""
    def __init__(self, script, opened):
        self.script, self.k, self.opened = dict(script), 0, opened
        self.tail = None
        self.resets = 0
        self.closed = False

    def feed(self, pcm512):
        assert len(pcm512) == 512
        ev = self.script.get(self.k)
        self.k += 1
        return ev

    def finalize(self):
        self.k = 0
        return self.tail

    def reset(self):
        self.resets += 1
        self.k = 0

    def close(self):
        self.closed = True


@pytest.fixture
def scripted(monkeypatch):
    holder = {}
    mod = types.ModuleType("sokuji_native")
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: []

    def _open(**kw):
        v = _ScriptedVad(holder.get("script", {}), kw)
        v.tail = holder.get("tail")
        holder["vad"] = v
        return v
    mod.vad_open = _open
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return holder


def _windows(n):
    return [np.full(512, i / 100.0, np.float32) for i in range(n)]


def test_options_are_passed_in_milliseconds(scripted):
    from sokuji_sidecar.vad import NativeVad
    NativeVad(threshold=0.6, min_silence_s=0.5, min_speech_s=0.25, max_speech_s=20.0)
    assert scripted["vad"].opened == {"threshold": 0.6, "min_speech_ms": 250, "min_silence_ms": 500, "max_speech_s": 20.0}


def test_edges_and_segment_queue(scripted):
    from sokuji_sidecar.vad import NativeVad
    # window 1 starts speech at (padded) sample 400; window 4 ends it: segment [400, 2048)
    scripted["script"] = {1: _Ev("start", sample=400), 4: _Ev("end", sample=2048, seg_start=400, seg_end=2048)}
    v = NativeVad()
    assert v.window == 512 and v.empty() and not v.is_speech_detected()
    seen = []
    for w in _windows(6):
        was = v.is_speech_detected()
        v.accept_waveform(w)
        seen.append((was, v.is_speech_detected()))
    assert seen[1] == (False, True)                 # rising edge on window 1
    assert seen[4] == (True, False)                 # falling edge on window 4
    assert not v.empty()
    seg = v.front
    assert seg.start == 400 and len(seg.samples) == 2048 - 400
    assert seg.samples[0] == pytest.approx(0.0)     # window 0 was value 0.00 → sample 400 is in window 0
    assert seg.samples[-1] == pytest.approx(0.03)   # sample 2047 lies in window 3 (value 0.03)
    v.pop()
    assert v.empty()


def test_flush_closes_open_segment_and_resets(scripted):
    from sokuji_sidecar.vad import NativeVad
    scripted["script"] = {0: _Ev("start", sample=0)}
    scripted["tail"] = _Ev("end", sample=1024, seg_start=0, seg_end=1024)
    v = NativeVad()
    for w in _windows(2):
        v.accept_waveform(w)
    assert v.is_speech_detected() and v.empty()
    v.flush()
    assert not v.is_speech_detected()
    assert not v.empty() and v.front.start == 0 and len(v.front.samples) == 1024
    v.pop()
    v.flush()                                       # nothing open: no segment, no error
    assert v.empty()


def test_reset_and_close(scripted):
    from sokuji_sidecar.vad import NativeVad
    scripted["script"] = {0: _Ev("start", sample=0)}
    v = NativeVad()
    v.accept_waveform(_windows(1)[0])
    v.reset()
    assert not v.is_speech_detected() and v.empty() and scripted["vad"].resets == 1
    v.close()
    assert scripted["vad"].closed
    v.close()                                       # idempotent


def test_wrong_window_size_rejected(scripted):
    from sokuji_sidecar.vad import NativeVad
    v = NativeVad()
    with pytest.raises(ValueError):
        v.accept_waveform(np.zeros(100, np.float32))


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_VAD_COMPARE"),
                    reason="set SOKUJI_RUN_VAD_COMPARE=1 (needs sokuji-native + sherpa-onnx + silero_vad.onnx)")
def test_native_vad_matches_sherpa_within_one_frame():
    """Spec §9.4 / §10 row 2: same recording through sherpa-silero and NativeVad; every
    speech-start and speech-end edge within one 512-sample frame (32 ms)."""
    import wave
    import sherpa_onnx
    native.reset_for_tests()
    from sokuji_sidecar.vad import NativeVad
    path = os.environ.get("SOKUJI_VAD_COMPARE_WAV") or os.path.join(
        os.path.dirname(__file__), "..", "..", "native", "build", "cpu", "_deps", "transcribe-src", "samples", "jfk.wav")
    with wave.open(path, "rb") as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = os.environ["SOKUJI_VAD_FILE"]          # the sherpa silero_vad.onnx
    cfg.sample_rate = 16000
    ref = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=30)
    ours = NativeVad()
    ref_edges, our_edges = [], []
    for k in range(len(pcm) // 512):
        w = pcm[k * 512:(k + 1) * 512]
        a = ref.is_speech_detected(); ref.accept_waveform(w); b = ref.is_speech_detected()
        if a != b: ref_edges.append((k, b))
        c = ours.is_speech_detected(); ours.accept_waveform(w); d = ours.is_speech_detected()
        if c != d: our_edges.append((k, d))
    assert len(ref_edges) == len(our_edges), (ref_edges, our_edges)
    for (k1, up1), (k2, up2) in zip(ref_edges, our_edges):
        assert up1 == up2 and abs(k1 - k2) <= 1, (ref_edges, our_edges)
