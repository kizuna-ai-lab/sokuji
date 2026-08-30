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
        self.finalize_calls = 0

    def feed(self, pcm512):
        assert len(pcm512) == 512
        ev = self.script.get(self.k)
        self.k += 1
        return ev

    def finalize(self):
        # Honest fake semantics: the real native finalize() dedupes internally (segments
        # already reported are filtered by its own last_end bookkeeping) and always
        # resets, so an idle finalize() returns None. Model that by handing back the
        # scripted tail exactly once, then going idle.
        self.finalize_calls += 1
        tail, self.tail = self.tail, None
        self.k = 0
        return tail

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
    # (1648 samples, shorter than the default min_speech_s=0.25 window — min_speech_s=0
    # keeps this test about edge detection and slicing, not the suppression feature)
    scripted["script"] = {1: _Ev("start", sample=400), 4: _Ev("end", sample=2048, seg_start=400, seg_end=2048)}
    v = NativeVad(min_speech_s=0.0)
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
    # 1024 samples is shorter than the default min_speech_s=0.25 window; min_speech_s=0
    # keeps this test about flush()/reset semantics, not the suppression feature.
    v = NativeVad(min_speech_s=0.0)
    for w in _windows(2):
        v.accept_waveform(w)
    assert v.is_speech_detected() and v.empty()
    v.flush()
    assert not v.is_speech_detected()
    assert not v.empty() and v.front.start == 0 and len(v.front.samples) == 1024
    v.pop()
    v.flush()                                       # nothing open: no segment, no error
    assert v.empty()


def test_forced_cut_at_max_speech_and_scale_rebase(scripted):
    """audio.cpp's streaming path never applies max_speech_s itself, so NativeVad must force
    the cut: no "end" is scripted before the cap, only a finalize() tail that closes the
    still-open segment. max_speech_s=0.128 s = 2048 samples = 4 windows."""
    from sokuji_sidecar.vad import NativeVad
    scripted["script"] = {0: _Ev("start", sample=0)}
    scripted["tail"] = _Ev("end", sample=2048, seg_start=0, seg_end=2048)
    v = NativeVad(max_speech_s=0.128, min_speech_s=0.0)
    windows = _windows(6)
    for w in windows[:4]:
        v.accept_waveform(w)
    assert not v.is_speech_detected()               # forced cut fired right after window 3
    assert not v.empty()
    seg = v.front
    assert seg.start == 0 and len(seg.samples) == 2048
    assert seg.samples[0] == pytest.approx(0.0)      # window 0's value
    assert seg.samples[-1] == pytest.approx(0.03)    # window 3's value
    assert scripted["vad"].finalize_calls == 1
    v.pop()
    assert v.empty()

    # A scripted later "start" still works: finalize() reset the fake's feed() cursor to 0,
    # so the very next feed() call replays script[0] as a fresh start — and the adapter's own
    # rebase (_audio/_fed cleared in the forced cut) keeps the new segment's scale correct.
    # (the fake's `.tail` was already captured at construction, so re-arm it on the instance.)
    scripted["vad"].tail = _Ev("end", sample=1024, seg_start=0, seg_end=1024)
    for w in windows[4:6]:
        v.accept_waveform(w)
    assert v.is_speech_detected()
    v.flush()
    assert not v.is_speech_detected()
    seg2 = v.front
    assert seg2.start == 0 and len(seg2.samples) == 1024
    assert seg2.samples[0] == pytest.approx(0.04)    # window 4's value
    assert seg2.samples[-1] == pytest.approx(0.05)   # window 5's value


def test_min_speech_suppresses_micro_segment(scripted):
    """audio.cpp's streaming path emits end edges with no min_speech gating; the adapter
    drops anything shorter than min_speech_s itself, the way the old sherpa-onnx VAD did."""
    from sokuji_sidecar.vad import NativeVad
    # start at window 0, end at window 1: segment [0, 400) = 400 samples = 25 ms < 250 ms.
    scripted["script"] = {0: _Ev("start", sample=0), 1: _Ev("end", sample=400, seg_start=0, seg_end=400)}
    v = NativeVad()                                  # default min_speech_s=0.25
    for w in _windows(2):
        v.accept_waveform(w)
    assert v.empty()                                 # the micro-segment was dropped
    assert not v.is_speech_detected()                # but the edge still flipped state


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
    """Spec §9.4 / §10 row 2: measures drift between audio.cpp's bundled silero conversion
    and sherpa-onnx's official silero_vad.onnx on the same recording. ≤1-frame (32 ms)
    agreement on every speech-start/speech-end edge does NOT hold, for two independent
    reasons (Ruling Q, slice-2): (a) algorithmic — audio.cpp's streaming path emits start
    edges with no min_speech gating, so our starts lead sherpa's by a constant ~8 frames
    (≈250 ms = min_speech_s) on every edge, not a per-recording drift; (b) weight-conversion
    drift between audio.cpp's bundled silero conversion and sherpa-onnx's official
    silero_vad.onnx, which also merges a pause the reference keeps split. Aligning the two
    sides' weights alone addresses only (b) and cannot make this gate pass — (a) is a
    structural difference in what the two streaming paths gate on, not a numeric one. This
    xfails with the measured edge lists until both are addressed."""
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
    aligned = (len(ref_edges) == len(our_edges)
               and all(up1 == up2 and abs(k1 - k2) <= 1
                       for (k1, up1), (k2, up2) in zip(ref_edges, our_edges)))
    if not aligned:
        pytest.xfail("known drift, two causes (Ruling Q, slice-2): (a) algorithmic — no "
                     "min_speech gating on live start edges, constant ~8-frame lead; "
                     "(b) silero weight-conversion drift (merged pause). Weight alignment "
                     f"alone cannot pass this gate. ref={ref_edges} native={our_edges}")
