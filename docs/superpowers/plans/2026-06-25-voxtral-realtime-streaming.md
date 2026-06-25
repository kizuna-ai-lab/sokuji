# Voxtral Mini 4B Realtime — Continuous Streaming (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver continuous, low-latency streaming ASR for Voxtral Mini 4B Realtime in the native sidecar — partials ~480 ms behind speech, a committed final at each VAD endpoint — without touching vLLM, translation, or TTS.

**Architecture:** A per-utterance `VoxtralRealtimeStream` session wraps the experimental transformers streaming API (live-fed `input_features` generator + threaded `generate` + `TextIteratorStreamer`). The engine gains a streaming branch (an asyncio task: audio queue → silero VAD endpointing → feed session, drain deltas → emit `partial`/`result`); offline backends keep the unchanged synchronous path. The transport starts that task for `STREAMING` backends. The renderer mirrors the existing `LocalInferenceClient.partialUserItem` interim→final pattern.

**Tech Stack:** Python sidecar (transformers `5.13.0.dev0`, torch cu128, threading + asyncio, silero VAD via sherpa-onnx); TypeScript/Vitest renderer; pytest.

## Spike findings (verified on the RTX 4070 — these are facts, build on them)

The §6 GPU spike was run live. `mistralai/Voxtral-Mini-4B-Realtime-2602` streams correctly:
- Lazy generator pull confirmed: feeding realtime-paced 100 ms chunks, **83/102 partials arrived while still feeding**; first partial ≈ 0.6 s; VRAM peak **9.04 GB**; transcript correct ("…fifty pieces of gold.").
- `VoxtralRealtimeProcessor` constants: `num_samples_first_audio_chunk=9000`, `num_samples_per_audio_chunk=1680`, `num_mel_frames_first_audio_chunk=56`, `audio_length_per_tok=8`, `raw_audio_length_per_tok=1280`; `feature_extractor.hop_length=160`, `win_length=400`, `sampling_rate=16000`.
- `proc.num_right_pad_tokens` is a **method** `(transcription_delay_ms=None)->int` (the HF doc treats it as a value — that's the doc's bug); `proc.num_right_pad_tokens()` returns **17** at the default 480 ms delay.
- `num_delay_tokens` comes from the first processor call (`first.num_delay_tokens`); `model.config.default_num_delay_tokens = 6`.
- Subsequent-chunk window math: `start = mel_frame_idx*hop - win//2`, advancing `mel_frame_idx += audio_length_per_tok` (8) per chunk; chunk width `num_samples_per_audio_chunk` (1680).
- Clean shutdown: **join the generate thread on end-of-utterance** (the spike's `exit 134`/"terminate called" was un-joined daemon threads at interpreter exit, not a streaming failure).

## Global Constraints

- **Streaming only for `voxtral_realtime`.** Engine branches on a backend class flag `STREAMING = True`. Every offline backend keeps the unchanged synchronous `feed()->list` path.
- **Continuous streaming**, fixed `num_delay_tokens` = the processor default (6 ≈ 480 ms); no UI delay control.
- **VAD = endpoint detector, not a recognition gate.** silero VAD (existing) marks speech-start (open session) and silence/endpoint (finalize + reset). Max-utterance cap = **20 s** forces finalize + reset to bound VRAM.
- **Partials are display-only.** Only the VAD-endpointed **final** enters the existing translation→TTS pipeline; translation/TTS code is untouched.
- **Offline `transcribe()` (Phase 1) stays** for the GPU smoke + fallback. No change to other backends or the WebGPU LOCAL_INFERENCE path.
- **Audio**: renderer feeds Int16@24 kHz; engine downsamples to 16 kHz float32 via the existing `_downsample_int16_to_f32_16k`. `TARGET_RATE = 16000`.
- **Offline load idiom** (Phase 1, reuse): resolve the snapshot dir with `snapshot_download(repo, local_files_only=True)`, load processor + model from the dir.
- **Catalog**: promote `voxtral-mini-4b-realtime` to `recommended=True` (sidecar + renderer); ordering unchanged (`sort_order`/`sortOrder` 9).
- **Wire event**: new id-less `partial {type:'partial', text}`; `result`/`speech_start` unchanged.
- **Tests**: sidecar `cd sidecar && .venv/bin/python -m pytest`; renderer `npm run test`. English-only comments. GPU tests gated on `SOKUJI_RUN_GPU`.

---

### Task 1: `VoxtralRealtimeStream` session + backend `STREAMING` flag

**Files:**
- Create: `sidecar/sokuji_sidecar/voxtral_stream.py`
- Modify: `sidecar/sokuji_sidecar/backends.py` (add `STREAMING = True` + `open_stream()` to `VoxtralRealtimeBackend`)
- Test: `sidecar/tests/test_voxtral_stream.py`

**Interfaces:**
- Consumes: a loaded `model` + `proc` (the backend already loads these in Phase 1's `load()`), `BackendLoadError`.
- Produces: `VoxtralRealtimeStream(model, proc, device, dtype)` with `feed(samples_f32_16k: np.ndarray) -> None`, `drain() -> list[str]` (text deltas available now, non-blocking), `end() -> str` (flush right-pad, join the generate thread, return the full transcript), `aborted` property; and `VoxtralRealtimeBackend.STREAMING = True`, `VoxtralRealtimeBackend.open_stream() -> VoxtralRealtimeStream`. The engine (Task 2) drives these.

- [ ] **Step 1: Write the session unit test (pure helpers + lifecycle with a fake model)**

Create `sidecar/tests/test_voxtral_stream.py`. The test fakes the model/processor so it runs on CPU/no-GPU: the fake `generate` consumes the `input_features` generator and pushes scripted tokens to the `streamer`, so the threading + buffering + right-pad flush are exercised deterministically.

```python
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
    proc = types.SimpleNamespace(
        feature_extractor=fe,
        num_samples_first_audio_chunk=9000,
        num_samples_per_audio_chunk=1680,
        num_mel_frames_first_audio_chunk=56,
        audio_length_per_tok=8,
        raw_audio_length_per_tok=1280,
        num_right_pad_tokens=lambda transcription_delay_ms=None: 17,
    )
    # processor(samples, is_streaming=, is_first_audio_chunk=, return_tensors=) -> batch
    def _call(samples, is_streaming, is_first_audio_chunk, return_tensors):
        b = {"input_features": _Castable()}
        if is_first_audio_chunk:
            b["input_ids"] = "IDS"
            b["num_delay_tokens"] = 6
        return _FakeBatch(b)
    proc.__call__ = _call
    proc.tokenizer = object()
    return proc


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
```

(The realtime correctness — lazy live pull, latency, VRAM — is covered by the GPU test in Step 6; this test pins the buffering/threading/flush contract on CPU.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_voxtral_stream.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sokuji_sidecar.voxtral_stream'`.

- [ ] **Step 3: Implement the streaming session**

Create `sidecar/sokuji_sidecar/voxtral_stream.py` (the verified spike logic, wrapped as a session with a clean thread-joining `end()`):

```python
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

    def end(self):
        """End-of-utterance: append right-pad to flush the tail, drain to completion,
        join the threads, return the full transcript."""
        with self._lock:
            self._buf = np.concatenate([self._buf, np.zeros(self._right_pad, np.float32)])
        self._ended.set()
        if not self._started:        # utterance shorter than the first chunk → start now
            with self._lock:
                if len(self._buf) >= self._FIRST or len(self._buf) > 0:
                    pass
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
```

Then in `sidecar/sokuji_sidecar/backends.py`, add to `VoxtralRealtimeBackend`:

```python
    STREAMING = True

    def open_stream(self):
        if self._model is None:
            raise BackendLoadError("voxtral_realtime not loaded")
        from .voxtral_stream import VoxtralRealtimeStream
        return VoxtralRealtimeStream(self._model, self._proc, self._device, self._dtype)
```

(Other backends have no `STREAMING` attribute; the engine treats its absence as False.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_voxtral_stream.py -v`
Expected: PASS.

- [ ] **Step 5: Write the GPU spike/smoke test (reproduces the validated live spike)**

Append to `sidecar/tests/test_voxtral_stream.py`:

```python
import os


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
```

- [ ] **Step 6: Verify the GPU test skips (and optionally run it on the box)**

Run (no flag): `cd sidecar && .venv/bin/python -m pytest tests/test_voxtral_stream.py -k real_gpu_live -v` → `1 skipped`.
Optionally on the 4070: `SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_voxtral_stream.py -k real_gpu_live -v -s` → PASS, prints partials count + final (model is cached).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/voxtral_stream.py sidecar/sokuji_sidecar/backends.py sidecar/tests/test_voxtral_stream.py
git commit -m "feat(sidecar): VoxtralRealtimeStream session (live streaming) + backend STREAMING flag"
```

---

### Task 2: Engine streaming path (VAD endpointing + emit partial/result)

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (add a streaming branch; offline path unchanged)
- Test: `sidecar/tests/test_asr_engine.py` (append streaming tests with a fake stream session)

**Interfaces:**
- Consumes: `VoxtralRealtimeBackend.STREAMING` + `open_stream()` (Task 1); the existing `_downsample_int16_to_f32_16k`, the silero VAD setup (`_init_vad`), `accel.resolve`/`load_with_fallback`.
- Produces: `AsrEngine.is_streaming -> bool` (True when the resolved backend has `STREAMING`); an async `run_stream(send)` coroutine the transport drives (Task 3), and `feed_stream(int16_bytes)` that enqueues audio. Emits dicts: `{"type":"speech_start"}`, `{"type":"partial","text":...}`, `{"type":"result","text":...,"startSample":...,"durationMs":...,"recognitionTimeMs":...}`.

- [ ] **Step 1: Write the engine streaming test (fake stream session, no GPU, deterministic)**

Append to `sidecar/tests/test_asr_engine.py`:

```python
import asyncio
import numpy as np
from sokuji_sidecar.asr_engine import AsrEngine


class _FakeStream:
    """Scripted stream session: drain() returns queued deltas, end() returns the join."""
    def __init__(self):
        self.fed = 0
        self._pending = ["he", "llo "]
        self.ended = False
    def feed(self, samples):
        self.fed += len(samples)
    def drain(self):
        out, self._pending = self._pending, []
        return out
    def end(self):
        self.ended = True
        return "hello world"


def _streaming_engine(monkeypatch, fake_stream, vad_segments):
    """Build an AsrEngine whose resolved backend is streaming and whose VAD is faked
    to yield a scripted speech_start then endpoint."""
    eng = AsrEngine()
    backend = type("B", (), {"STREAMING": True, "open_stream": lambda self: fake_stream,
                             "unload": lambda self: None})()
    # bypass real resolve/VAD: inject the backend + a fake VAD endpoint generator
    monkeypatch.setattr(eng, "_resolve_streaming_backend", lambda model, device: backend)
    monkeypatch.setattr(eng, "_vad_events", lambda samples: vad_segments)  # ['start'|'speech'|'end']
    return eng


def test_streaming_emits_speech_start_partials_result(monkeypatch):
    fs = _FakeStream()
    eng = _streaming_engine(monkeypatch, fs, vad_segments=["start", "speech", "end"])
    sent = []
    async def send(msg): sent.append(msg)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="cuda")
    # feed one buffer that the fake VAD turns into start→speech→end
    eng.feed_stream(np.zeros(16000, np.int16).tobytes())
    asyncio.run(eng._drive_once(send))   # one iteration of the streaming loop
    types_seen = [m["type"] for m in sent]
    assert types_seen[0] == "speech_start"
    assert "partial" in types_seen
    assert types_seen[-1] == "result"
    assert sent[-1]["text"] == "hello world"
    assert fs.ended is True
```

(Exact private method names — `_drive_once`, `_vad_events`, `_resolve_streaming_backend`, `init_streaming` — are introduced by Step 3; keep them identical there.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming -v`
Expected: FAIL — `AttributeError` (`init_streaming`/`feed_stream`/`_drive_once` not defined).

- [ ] **Step 3: Implement the streaming branch**

In `sidecar/sokuji_sidecar/asr_engine.py`, add (leaving the existing offline `init`/`feed`/`flush` untouched):

```python
    def is_streaming(self):
        return bool(getattr(self._backend, "STREAMING", False))

    def init_streaming(self, model_id=None, language="", sample_rate=SRC_RATE,
                       vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
        """Like init(), but for a STREAMING backend: resolve+load, set up VAD for
        endpointing, and prepare the audio queue + per-utterance stream state."""
        import queue as _queue
        self.close()
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        self._backend = self._resolve_streaming_backend(model_id, device)
        self._language = language or None
        self._audio_q = _queue.Queue()
        self._stream = None
        self._utt_start_sample = 0
        self._sample_cursor = 0
        self._partial_acc = []
        self._utt_samples = 0
        self._stop = False

    def feed_stream(self, int16_bytes):
        """Non-blocking: hand raw audio to the streaming loop (called from on_binary)."""
        self._audio_q.put_nowait(int16_bytes)

    async def run_stream(self, send):
        """The asyncio streaming loop (Approach A). Owns VAD endpointing, the stream
        session lifecycle, and pushes speech_start/partial/result via `send`."""
        loop = __import__("asyncio").get_event_loop()
        while not self._stop:
            try:
                data = await loop.run_in_executor(None, self._audio_q.get, True, 0.1)
            except Exception:
                continue
            if data is None:
                break
            await self._drive(send, data)
        if self._stream is not None:
            await self._finalize(send)

    async def _drive(self, send, int16_bytes):
        """Process one audio buffer: VAD → manage session → emit events. Factored so
        tests can call _drive_once with scripted VAD."""
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        for ev in self._vad_events(samples):
            if ev == "start":
                self._utt_start_sample = self._sample_cursor
                self._stream = self._backend.open_stream()
                await send({"type": "speech_start"})
            elif ev == "speech" and self._stream is not None:
                self._stream.feed(samples)
                deltas = self._stream.drain()
                if deltas:
                    self._partial_acc += deltas
                    await send({"type": "partial", "text": "".join(self._partial_acc)})
            elif ev == "end" and self._stream is not None:
                await self._finalize(send)
        self._sample_cursor += len(samples)

    async def _finalize(self, send):
        import time as _time
        t0 = _time.time()
        loop = __import__("asyncio").get_event_loop()
        final = await loop.run_in_executor(None, self._stream.end)
        dur_ms = int((self._sample_cursor - self._utt_start_sample) / TARGET_RATE * 1000)
        if final.strip():
            await send({"type": "result", "text": final.strip(),
                        "startSample": int(self._utt_start_sample),
                        "durationMs": dur_ms,
                        "recognitionTimeMs": int((_time.time() - t0) * 1000)})
        self._stream = None
        self._partial_acc = []

    async def _drive_once(self, send):
        """Test seam: drive exactly the buffers currently queued, once."""
        while not self._audio_q.empty():
            await self._drive(send, self._audio_q.get_nowait())
```

Add the two helpers the loop relies on (real implementations; the test monkeypatches them):

```python
    def _resolve_streaming_backend(self, model_id, device):
        from . import accel
        plans = accel.resolve(model_id or "voxtral-mini-4b-realtime", override=device or "auto")
        backend, _plan, _notice = accel.load_with_fallback(plans)
        return backend

    def _vad_events(self, samples):
        """Feed `samples` to silero VAD; yield 'start' on rising edge, 'speech' while
        active, 'end' on endpoint (silence) or the 20s max-utterance cap (bounds VRAM)."""
        events = []
        cap = 20 * TARGET_RATE
        self._buf = np.concatenate([self._buf, samples])
        while len(self._buf) >= self._window:
            was = self._vad.is_speech_detected()
            self._vad.accept_waveform(self._buf[:self._window])
            self._buf = self._buf[self._window:]
            now = self._vad.is_speech_detected()
            if not was and now:
                self._utt_samples = 0
                events.append("start")
            if now:
                self._utt_samples += self._window
                events.append("speech")
                if self._utt_samples >= cap:          # force endpoint to bound VRAM
                    events.append("end")
                    self._utt_samples = 0
            if was and not now:
                events.append("end")
        return events
```

(`_vad_events` reuses the engine's existing `_vad`, `_window`, `_buf` from `_init_vad`; `_utt_samples`
(init 0 in `init_streaming`) tracks speech since the last start and forces an `"end"` at the 20 s cap.
After a cap-forced end the engine finalizes the session; the next silence→speech opens a fresh one —
a 20 s+ continuous utterance is split, which is the intended VRAM bound.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming -v`
Expected: PASS. Then full file: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -v` → PASS (offline tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): streaming engine path (VAD endpointing, emit partial/result)"
```

---

### Task 3: Transport wiring (`asr_init` starts the streaming task)

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (the `_h_asr_init` handler) and/or `server.py`
- Test: `sidecar/tests/test_server_conn.py` (or `test_asr_engine.py`) — fake conn

**Interfaces:**
- Consumes: `eng.is_streaming()`, `eng.init_streaming(...)`, `eng.feed_stream(...)`, `eng.run_stream(send)` (Task 2); the existing `_h_asr_init`, `conn.ctx["on_binary"]`, `conn.send`.
- Produces: for a streaming backend, `asr_init` sets `on_binary = eng.feed_stream` and starts `asyncio.create_task(eng.run_stream(conn.send))`; offline backends keep `on_binary = eng.feed` (sync). The `ready` reply shape is unchanged.

- [ ] **Step 1: Write the transport test**

Append to `sidecar/tests/test_asr_engine.py` (handler-level, with a fake engine + fake conn):

```python
import json
from sokuji_sidecar import asr_engine as ae
from sokuji_sidecar import server


def test_asr_init_starts_streaming_task_for_streaming_backend(monkeypatch):
    started = {"task": False, "on_binary": None}

    class FakeEng:
        def init_streaming(self, **kw): started["init"] = kw
        def init(self, *a, **k): started["offline"] = True
        def is_streaming(self): return True
        def feed_stream(self, b): pass
        async def run_stream(self, send): started["task"] = True
        resolved = {"backend": "voxtral_realtime", "device": "cuda", "computeType": "bfloat16"}

    eng = FakeEng()

    async def scenario():
        state = {"asr_engine": eng, "handlers": {}}
        ae.register(state)
        conn = server.Conn(type("WS", (), {"send": lambda self, d: None})())
        reply, _ = await server.handle_message(
            state, json.dumps({"type": "asr_init", "id": 1, "model": "voxtral-mini-4b-realtime",
                               "language": "en", "device": "cuda"}), None, conn)
        await asyncio.sleep(0)            # let the created task run
        return reply, conn

    reply, conn = asyncio.run(scenario())
    assert reply["type"] == "ready"
    assert conn.ctx["on_binary"] == eng.feed_stream    # streaming uses the enqueue feeder
    assert started["task"] is True                     # run_stream task was started
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k starts_streaming_task -v`
Expected: FAIL — current `_h_asr_init` always wires `on_binary = eng.feed` and never starts a task.

- [ ] **Step 3: Branch `_h_asr_init` on streaming**

In `sidecar/sokuji_sidecar/asr_engine.py`, replace the body of `_h_asr_init` so it branches:

```python
async def _h_asr_init(state, msg, _b, conn=None):
    import asyncio
    eng = state["asr_engine"]
    model = msg.get("model")
    # Decide streaming vs offline up front by resolving the backend once.
    eng_is_streaming = False
    if hasattr(eng, "init_streaming"):
        eng.init_streaming(model, msg.get("language", ""), msg.get("sampleRate", SRC_RATE),
                           msg.get("vadThreshold"), msg.get("vadMinSilenceDuration"),
                           msg.get("vadMinSpeechDuration"), msg.get("device", "auto"))
        eng_is_streaming = eng.is_streaming()
    if eng_is_streaming:
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed_stream
            conn.ctx["stream_task"] = asyncio.create_task(eng.run_stream(conn.send))
        ms = 0
    else:
        ms = eng.init(model, msg.get("language", ""), msg.get("sampleRate", SRC_RATE),
                      msg.get("vadThreshold"), msg.get("vadMinSilenceDuration"),
                      msg.get("vadMinSpeechDuration"), msg.get("device", "auto"))
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed
    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(eng, "resolved", None)
    if resolved:
        reply.update(resolved)
    return reply, None
```

(Note: `init_streaming` resolves+loads the backend so `is_streaming()` is accurate; for an offline backend the load happens twice — acceptable, or guard with a dry resolve. Keep `init_streaming` cheap when the resolved backend is not streaming: have it return early without loading the model if `not getattr(backend, "STREAMING", False)`, leaving the offline `init()` to load. Implement that early-return so offline models aren't loaded twice.)

Also extend `server.py` `_conn` cleanup to cancel the task on close (just before `eng.close()`):

```python
        task = conn.ctx.get("stream_task")
        if task is not None:
            task.cancel()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "starts_streaming_task or streaming" -v`
Expected: PASS. Then `cd sidecar && .venv/bin/python -m pytest tests/test_server_conn.py tests/test_server_envelope.py -v` → PASS (offline transport unaffected).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/sokuji_sidecar/server.py sidecar/tests/test_asr_engine.py
git commit -m "feat(sidecar): asr_init starts the streaming task for STREAMING backends"
```

---

### Task 4: Wire `partial` event + `NativeAsrClient.onPartialResult`

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts`, `src/lib/local-inference/native/NativeAsrClient.ts`
- Test: `src/lib/local-inference/native/NativeAsrClient.test.ts`

**Interfaces:**
- Consumes: the id-less `partial {type:'partial', text}` event (Task 2/3).
- Produces: `AsrPartialMsg` in `ServerMsg`; `NativeAsrClient.onPartialResult: ((text: string) => void) | null` invoked on `partial`. Task 5 consumes `onPartialResult`.

- [ ] **Step 1: Write the failing test**

In `src/lib/local-inference/native/NativeAsrClient.test.ts`, add a test that a `partial` message routes to `onPartialResult` and `result` still routes to `onResult`:

```typescript
it('dispatches partial → onPartialResult and id-less result → onResult', () => {
  const c = new NativeAsrClient();
  const partials: string[] = [];
  const finals: string[] = [];
  c.onPartialResult = (t) => partials.push(t);
  c.onResult = (r) => finals.push(r.text);
  // reach the private onMessage via the same path the WS uses
  (c as any).onMessage(JSON.stringify({ type: 'partial', text: 'he llo' }));
  (c as any).onMessage(JSON.stringify({ type: 'result', text: 'hello world', durationMs: 1000, recognitionTimeMs: 50 }));
  expect(partials).toEqual(['he llo']);
  expect(finals).toEqual(['hello world']);
});
```

(If the existing test file constructs the client differently, follow its existing setup; the assertion is the contract.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/local-inference/native/NativeAsrClient.test.ts -t "onPartialResult"`
Expected: FAIL — `onPartialResult` is undefined / `partial` falls through to no handler.

- [ ] **Step 3: Implement**

In `src/lib/local-inference/native/nativeProtocol.ts`, add the message type and union it:

```typescript
export interface AsrPartialMsg { type: 'partial'; text: string; }
```
and add `| AsrPartialMsg` to the `ServerMsg` union.

In `src/lib/local-inference/native/NativeAsrClient.ts`, add the callback field next to `onResult`:

```typescript
  onPartialResult: ((text: string) => void) | null = null;
```
and in `onMessage`, before the `result` branch:

```typescript
    if (msg.type === 'partial') { this.onPartialResult?.(msg.text); return; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: PASS (new test + existing NativeAsrClient tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeAsrClient.ts src/lib/local-inference/native/NativeAsrClient.test.ts
git commit -m "feat(native): partial wire event + NativeAsrClient.onPartialResult"
```

---

### Task 5: `LocalNativeClient` interim→final (`partialUserItem`)

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts`
- Test: `src/services/clients/LocalNativeClient.test.ts`

**Interfaces:**
- Consumes: `NativeAsrClient.onPartialResult` (Task 4); the existing `onAsrResult`, `emit`, `runJob`, `translate`.
- Produces: a `partialUserItem` that updates on partials (no pipeline job) and finalizes on the result (then runs the existing translation job once). Mirrors `LocalInferenceClient`.

- [ ] **Step 1: Write the failing test**

In `src/services/clients/LocalNativeClient.test.ts`, add (using the existing test's fake `asr`/`translate` deps):

```typescript
it('renders partials as one in-progress item and runs the job only on the final', async () => {
  const translate = { init: async () => {}, translate: vi.fn(async () => ({ translatedText: 'T', inferenceTimeMs: 1 })), onError: null, dispose() {} };
  const asr: any = { init: async () => ({ device: 'cuda' }), feedAudio() {}, flush() {}, dispose() {}, onResult: null, onPartialResult: null, onError: null };
  const client = new LocalNativeClient({ asr, translate });
  const items: any[] = [];
  client.setEventHandlers({ onConversationUpdated: ({ item }) => items.push({ id: item.id, status: item.status, text: item.formatted?.transcript }), onOpen() {}, onRealtimeEvent() {} } as any);
  await client.connect(LOCAL_NATIVE_CONFIG);  // reuse the exact config object the existing LocalNativeClient.test.ts connect() test already builds — copy that fixture/factory into this test rather than inventing a new one
  asr.onPartialResult('he');            // partial 1
  asr.onPartialResult('hello');         // partial 2 (same item updates)
  expect(translate.translate).not.toHaveBeenCalled();
  asr.onResult({ text: 'hello world' }); // final
  await new Promise((r) => setTimeout(r, 0));
  expect(translate.translate).toHaveBeenCalledTimes(1);
  const userItems = items.filter((i) => i.id.startsWith('user'));
  expect(new Set(userItems.map((i) => i.id)).size).toBe(1);  // one user item across partials+final
});
```

(Match the existing `LocalNativeClient.test.ts` config/mocks; the assertions are the contract: partials don't translate, finals do, one user item.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/services/clients/LocalNativeClient.test.ts -t "in-progress item"`
Expected: FAIL — no `onPartialResult` wiring; partials are ignored or each becomes a new completed item.

- [ ] **Step 3: Implement (mirror `LocalInferenceClient.partialUserItem`)**

In `src/services/clients/LocalNativeClient.ts`:
- Add a field: `private partialUserItem: ConversationItem | null = null;`
- In `connect()`, wire the callback: `this.asr.onPartialResult = (text: string) => this.onAsrPartial(text);`
- Add the handler:

```typescript
  private onAsrPartial(text: string): void {
    if (!text) return;
    if (!this.partialUserItem) {
      this.partialUserItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'in_progress',
        createdAt: Date.now(), formatted: { transcript: text },
      };
      this.items.push(this.partialUserItem);
      this.emit(this.partialUserItem);
    } else {
      this.partialUserItem.formatted!.transcript = text;
      this.emit(this.partialUserItem, { transcript: text });
    }
  }
```
- Change `onAsrResult` to finalize the partial item instead of always creating a new one:

```typescript
  private onAsrResult(r: { text: string }): void {
    if (!r.text?.trim()) return;
    this.emitEvent('local.native.asr.result', 'server', { text: r.text });
    let userItem = this.partialUserItem;
    if (userItem) {
      userItem.status = 'completed';
      userItem.formatted!.transcript = r.text;
      this.partialUserItem = null;
    } else {
      userItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(), formatted: { transcript: r.text },
      };
      this.items.push(userItem);
    }
    this.emit(userItem);
    this.queue = this.queue.then(() => this.runJob(r.text)).catch((e) => {
      this.emitEvent('local.native.error', 'client', { error: String(e) });
      this.handlers.onError?.(String(e));
    });
  }
```
- In `disconnect()` and `reset()`, add `this.partialUserItem = null;`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/services/clients/LocalNativeClient.test.ts`
Expected: PASS (new test + existing LocalNativeClient tests — the offline `result`-only path still works via the `else` branch).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
git commit -m "feat(native): LocalNativeClient renders streaming partials (interim→final)"
```

---

### Task 6: Promote the catalog row to `recommended`

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py`, `src/lib/local-inference/native/nativeCatalog.ts`
- Test: `sidecar/tests/test_catalog.py`, `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `voxtral-mini-4b-realtime` with `recommended=True` (sidecar) / `recommended: true` (renderer); `sort_order`/`sortOrder` 9 unchanged.

- [ ] **Step 1: Update the tests (RED)**

In `sidecar/tests/test_catalog.py`, change the `test_voxtral_realtime_row` assertion `assert m.recommended is False` → `assert m.recommended is True`.
In `src/lib/local-inference/native/nativeCatalog.test.ts`, change the Voxtral test's `expect(v!.recommended).toBeFalsy();` → `expect(v!.recommended).toBe(true);`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -k voxtral -v` → FAIL; `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts -t "Voxtral"` → FAIL.

- [ ] **Step 3: Flip the flag in both catalogs**

In `sidecar/sokuji_sidecar/catalog.py`, the `voxtral-mini-4b-realtime` `AsrModel`: `recommended=False` → `recommended=True`.
In `src/lib/local-inference/native/nativeCatalog.ts`, the Voxtral row: add `recommended: true` (place before `sortOrder: 9`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -v` → PASS; `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts` → PASS (the recommended-first ordering tests still hold — Voxtral now joins the recommended set but `sortOrder 9` keeps it after the existing recommended rows).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py src/lib/local-inference/native/nativeCatalog.ts sidecar/tests/test_catalog.py src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): promote Voxtral Mini 4B Realtime to recommended (streaming landed)"
```

---

### Task 7: End-to-end streaming GPU smoke (through the engine + transport)

**Files:**
- Test: `sidecar/tests/test_asr_engine.py` (a `SOKUJI_RUN_GPU`-gated end-to-end test driving `run_stream` with a fake conn)

**Interfaces:**
- Consumes: the full streaming path (Tasks 1-3) + a real GPU + the cached model.
- Produces: a gated test that feeds a real clip through `init_streaming` + `feed_stream` + `run_stream`, asserting `speech_start` → partials → a non-empty `result`.

- [ ] **Step 1: Write the gated end-to-end test**

Append to `sidecar/tests/test_asr_engine.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (uses cached Voxtral-Mini-4B-Realtime; needs CUDA)")
def test_streaming_end_to_end_real_gpu():
    import glob, wave, asyncio
    from huggingface_hub import snapshot_download
    snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602",
                      ignore_patterns=["consolidated.safetensors", "*.gitattributes"])
    eng = AsrEngine()
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en",
                       sample_rate=16000, device="cuda")
    wav = glob.glob(os.path.expanduser(
        "~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-sense-voice*/snapshots/*/test_wavs/en.wav"))[0]
    w = wave.open(wav)
    pcm = w.readframes(w.getnframes())
    sent = []
    async def send(m): sent.append(m)
    async def drive():
        for i in range(0, len(pcm), 3200):       # ~100ms @16k int16
            eng.feed_stream(pcm[i:i + 3200])
        eng.feed_stream(None)                     # end-of-stream sentinel
        await eng.run_stream(send)
    asyncio.run(drive())
    types_seen = [m["type"] for m in sent]
    assert "speech_start" in types_seen and "partial" in types_seen
    results = [m for m in sent if m["type"] == "result"]
    assert results and results[-1]["text"].strip()
    print(f"streaming e2e: {types_seen.count('partial')} partials, final={results[-1]['text']!r}")
    eng.close()
```

- [ ] **Step 2: Verify it skips without the flag**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming_end_to_end -v` → `1 skipped`.

- [ ] **Step 3: Run it on the 4070 (model cached)**

Run: `cd sidecar && SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_asr_engine.py -k streaming_end_to_end -v -s`
Expected: PASS — prints partial count + final transcript. If the VAD endpoint never fires on a clip with no trailing silence, the 20 s cap (or end-of-stream sentinel) forces the final; confirm the final is non-empty.

- [ ] **Step 4: Commit**

```bash
git add sidecar/tests/test_asr_engine.py
git commit -m "test(sidecar): end-to-end streaming GPU smoke (speech_start → partials → result)"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full sidecar pytest**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (GPU-gated tests skipped without their flag).

- [ ] **Step 2: Renderer vitest (native + clients)**

Run: `npm run test -- src/lib/local-inference/native/ src/services/clients/LocalNativeClient.test.ts`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit only if Steps 1-3 surfaced fixes**

If a fix was needed: `git add -A && git commit -m "test(native): green streaming suites"`. Otherwise nothing to commit — skip.
