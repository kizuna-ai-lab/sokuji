"""One streaming utterance for Voxtral Mini 4B Realtime. Wraps the experimental
transformers streaming API: a live-fed input_features generator + threaded generate
+ TextIteratorStreamer. feed() appends 16kHz float32 audio (thread-safe); drain()
returns text deltas available now; end() appends the model's right-pad to flush the
tail, joins the generate thread, and returns the full transcript. One session per
utterance — the padding cache + KV live in the generate call and are freed when the
thread joins. Constants verified live (see the plan's Spike findings)."""
import queue
import threading

import numpy as np
from transformers import TextIteratorStreamer


class VoxtralRealtimeStream:
    def __init__(self, model, proc, device, dtype):
        self._model = model
        self._proc = proc
        self._device = device
        self._dtype = dtype
        fe = proc.feature_extractor
        self._FIRST = proc.num_samples_first_audio_chunk
        self._CHUNK = proc.num_samples_per_audio_chunk
        self._HOP = fe.hop_length
        self._WIN = fe.win_length
        self._ADV = proc.audio_length_per_tok
        self._right_pad = proc.num_right_pad_tokens() * proc.raw_audio_length_per_tok
        self._buf = np.zeros(0, np.float32)
        self._lock = threading.Lock()
        self._ended = threading.Event()      # end-of-utterance: right-pad appended
        self._deltas = queue.Queue()         # str tokens; None = generation finished
        self._collected = []                 # accumulated final text
        self._gen_thread = None
        self._reader_thread = None
        self._started = False
        self.aborted = False

    def _buflen(self):
        with self._lock:
            return len(self._buf)

    def _wait_for(self, n):
        """Block until the buffer has >= n samples, or end-of-utterance with no more."""
        while True:
            with self._lock:
                if len(self._buf) >= n:
                    return True
            if self._ended.is_set():
                with self._lock:
                    return len(self._buf) >= n
            self._ended.wait(0.005)

    def _input_features_generator(self, first_features):
        yield first_features
        mel_frame_idx = self._proc.num_mel_frames_first_audio_chunk
        start = mel_frame_idx * self._HOP - self._WIN // 2
        while True:
            end = start + self._CHUNK
            if not self._wait_for(end):
                break
            with self._lock:
                seg = self._buf[start:end].copy()
            inp = self._proc(seg, is_streaming=True, is_first_audio_chunk=False,
                             return_tensors="pt").to(self._device, dtype=self._dtype)
            yield inp.input_features
            mel_frame_idx += self._ADV
            start = mel_frame_idx * self._HOP - self._WIN // 2

    def _start(self):
        with self._lock:
            first_audio = self._buf[:self._FIRST].copy()
        first = self._proc(first_audio, is_streaming=True, is_first_audio_chunk=True,
                           return_tensors="pt").to(self._device, dtype=self._dtype)
        streamer = TextIteratorStreamer(self._proc.tokenizer, skip_special_tokens=True,
                                        clean_up_tokenization_spaces=True)

        def _run():
            try:
                self._model.generate(
                    input_ids=first.input_ids,
                    input_features=self._input_features_generator(first.input_features),
                    num_delay_tokens=first.num_delay_tokens, streamer=streamer)
            except Exception:
                self.aborted = True

        def _read():
            try:
                for tok in streamer:
                    self._collected.append(tok)
                    self._deltas.put(tok)
            finally:
                self._deltas.put(None)

        self._started = True
        self._gen_thread = threading.Thread(target=_run, daemon=True)
        self._gen_thread.start()
        self._reader_thread = threading.Thread(target=_read, daemon=True)
        self._reader_thread.start()

    def feed(self, samples_f32_16k):
        with self._lock:
            self._buf = np.concatenate([self._buf, samples_f32_16k])
        if not self._started and self._buflen() >= self._FIRST:
            self._start()

    def drain(self):
        """Non-blocking: return text deltas available right now."""
        out = []
        while True:
            try:
                v = self._deltas.get_nowait()
            except queue.Empty:
                break
            if v is not None:
                out.append(v)
        return out

    def abort(self):
        """Stop the stream WITHOUT producing a final transcript (e.g. the session
        closed mid-utterance). Set _ended so the input-features generator stops at its
        next wait, let generate finish, join the threads briefly, and drop the heavy
        refs so the model can be reclaimed. Idempotent."""
        self._ended.set()
        if self._gen_thread is not None:
            self._gen_thread.join(timeout=5)
            self._gen_thread = None
        if self._reader_thread is not None:
            self._reader_thread.join(timeout=2)
            self._reader_thread = None
        self._model = None
        self._proc = None

    def end(self):
        """End-of-utterance: append right-pad to flush the tail, drain to completion,
        join the threads, return the full transcript."""
        with self._lock:
            self._buf = np.concatenate([self._buf, np.zeros(self._right_pad, np.float32)])
        self._ended.set()
        if not self._started:        # utterance shorter than the first chunk → start now
            self._start()
        # drain until the reader signals completion (None sentinel)
        while True:
            v = self._deltas.get()
            if v is None:
                break
        if self._gen_thread:
            self._gen_thread.join(timeout=30)
        if self._reader_thread:
            self._reader_thread.join(timeout=5)
        return "".join(self._collected)
