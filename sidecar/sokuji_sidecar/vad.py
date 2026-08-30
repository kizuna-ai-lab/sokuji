"""Voice activity detection for the ASR stage (spec §5.1: VAD is an ASR-side capability
implemented by audio.cpp). NativeVad wraps one sokuji_native.Vad behind the protocol
asr_engine.py has always driven — sherpa-onnx's VoiceActivityDetector shape:
is_speech_detected() / accept_waveform(window) / empty() / front / pop() / flush() — but
audio.cpp's STREAMING path implements neither the 20 s force-split nor min_speech
suppression on live edges (only its offline path applies them), so this adapter now
enforces both itself: it force-cuts at max_speech_s and drops end-edges shorter than
min_speech_s, matching what the old sherpa-onnx VAD did for asr_engine.py."""
from dataclasses import dataclass

import numpy as np

from . import native

WINDOW = 512          # samples per accept_waveform call, 16 kHz


@dataclass
class Segment:
    samples: np.ndarray   # the finished segment's audio, [start, end) of everything fed since reset
    start: int            # first sample index (relative to the reset point)


class NativeVad:
    window = WINDOW

    def __init__(self, *, threshold=0.5, min_silence_s=0.5, min_speech_s=0.25, max_speech_s=20.0):
        # sherpa defaults: threshold 0.5, min_silence 0.5 s, min_speech 0.25 s, max_speech 20 s.
        self._vad = native.module().vad_open(threshold=float(threshold),
                                             min_speech_ms=int(round(min_speech_s * 1000)),
                                             min_silence_ms=int(round(min_silence_s * 1000)),
                                             max_speech_s=float(max_speech_s))
        self._min_speech_s = float(min_speech_s)
        self._max_speech_s = float(max_speech_s)
        self._speech = False
        self._queue: list[Segment] = []
        self._audio: list[np.ndarray] = []   # every window since reset, for segment extraction
        self._fed = 0
        self._speech_samples = 0             # consecutive in-speech samples since the last "start"

    # ── the protocol ────────────────────────────────────────────────────────
    def is_speech_detected(self) -> bool:
        return self._speech

    def accept_waveform(self, window) -> None:
        pcm = np.ascontiguousarray(np.asarray(window, dtype=np.float32).reshape(-1))
        if pcm.size != WINDOW:
            raise ValueError(f"NativeVad.accept_waveform: {WINDOW} samples per window, got {pcm.size}")
        self._audio.append(pcm)
        self._fed += WINDOW
        self._apply(self._vad.feed(pcm))
        if self._speech:
            self._speech_samples += WINDOW
            if self._max_speech_s > 0 and self._speech_samples >= self._max_speech_s * 16000:
                self._force_cut()

    def _force_cut(self) -> None:
        """audio.cpp's streaming path ignores max_speech_s entirely (only its offline path
        applies it), so the adapter enforces the 20 s cap itself: finalize() closes the open
        segment through the normal event path and resets the native side's cursor. The cut
        always lands right after a feed (a window boundary), so rebasing `_audio`/`_fed` to a
        fresh scale here — exactly like `flush()` does — loses no audio; the next real speech
        re-triggers a fresh "start" from the reset native detector, same as sherpa's forced
        endpoint."""
        self._apply(self._vad.finalize())
        self._speech = False
        self._speech_samples = 0
        self._audio.clear()
        self._fed = 0

    def empty(self) -> bool:
        return not self._queue

    @property
    def front(self) -> Segment:
        return self._queue[0]

    def pop(self) -> None:
        self._queue.pop(0)

    def flush(self) -> None:
        """End of audio: close an open segment (the native side reports it as END) and
        return to the idle state. Queued segments stay until popped. Always calls the
        native finalize(), even when idle: on an idle VAD it returns None and still
        resets the native side's internal sample cursor — skipping it would leave that
        cursor running while `_fed` restarts at 0 below, so the next utterance's
        seg_start/seg_end (native-absolute) would disagree with `origin = _fed -
        buf.size` in `_slice`."""
        self._apply(self._vad.finalize())
        self._speech = False
        self._speech_samples = 0
        self._audio.clear()
        self._fed = 0

    def reset(self) -> None:
        self._vad.reset()
        self._speech = False
        self._speech_samples = 0
        self._queue.clear()
        self._audio.clear()
        self._fed = 0

    def close(self) -> None:
        vad, self._vad = self._vad, None
        if vad is not None:
            vad.close()

    # ── event → state ──────────────────────────────────────────────────────
    def _apply(self, ev) -> None:
        """audio.cpp's streaming path emits start/end edges with no min_speech gating (only
        its offline path applies it), so an "end" whose segment is shorter than min_speech_s
        is dropped here rather than queued — same suppression the old sherpa-onnx VAD gave
        asr_engine.py for free. `_slice` still runs unconditionally so the audio buffer stays
        trimmed regardless of whether the segment gets queued."""
        if ev is None:
            return
        if ev.kind == "start":
            self._speech = True
            self._speech_samples = 0
        elif ev.kind == "end":
            self._speech = False
            self._speech_samples = 0
            segment = self._slice(ev.seg_start, ev.seg_end)
            if (ev.seg_end - ev.seg_start) >= self._min_speech_s * 16000:
                self._queue.append(Segment(segment, int(ev.seg_start)))

    def _slice(self, start: int, end: int) -> np.ndarray:
        """The audio of [start, end) in absolute samples-since-reset. Audio before `end` is
        dropped afterwards (native segments never overlap, so no later segment needs it);
        `self._fed` counts every sample since reset, which makes the buffer's absolute
        origin exact after any number of trims."""
        buf = np.concatenate(self._audio) if self._audio else np.zeros(0, np.float32)
        origin = self._fed - buf.size                     # absolute index of buf[0]
        lo = max(0, min(int(start) - origin, buf.size))
        hi = max(lo, min(int(end) - origin, buf.size))
        out = buf[lo:hi].copy()
        keep = buf[hi:]
        self._audio = [keep] if keep.size else []
        return out
