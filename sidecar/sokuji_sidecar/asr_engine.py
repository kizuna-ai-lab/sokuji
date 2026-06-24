import asyncio
import os
import queue
import time
import numpy as np

TARGET_RATE = 16000
SRC_RATE = 24000

# sherpa-onnx silero VAD is documented in the k2-fsa releases (the same GitHub-release
# source as scripts/download-sherpa-wasm.sh). No clean HuggingFace mirror matches the
# exact signature sherpa expects, so resolve it from the release (override via env).
VAD_URL = os.environ.get(
    "SOKUJI_VAD_URL",
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx")


def _downsample_int16_to_f32_16k(int16_bytes, src_rate=SRC_RATE):
    if not int16_bytes:
        return np.zeros(0, dtype=np.float32)
    x = np.frombuffer(int16_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    if src_rate == TARGET_RATE:
        return x
    ratio = TARGET_RATE / src_rate
    n = round(len(x) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.floor(pos).astype(np.int64)
    frac = (pos - i0).astype(np.float32)
    a = x[np.clip(i0, 0, len(x) - 1)]
    b = x[np.clip(i0 + 1, 0, len(x) - 1)]
    return (a + (b - a) * frac).astype(np.float32)


def _resolve_vad_model(model_dir=None):
    """Order: explicit SOKUJI_VAD_FILE → silero_vad.onnx shipped in the model dir →
    download the canonical file from the k2-fsa release into the HF cache."""
    explicit = os.environ.get("SOKUJI_VAD_FILE")
    if explicit and os.path.exists(explicit):
        return explicit
    if model_dir and os.path.exists(f"{model_dir}/silero_vad.onnx"):
        return f"{model_dir}/silero_vad.onnx"
    import urllib.request
    cache = os.path.join(
        os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface")), "sokuji-vad")
    os.makedirs(cache, exist_ok=True)
    dst = os.path.join(cache, "silero_vad.onnx")
    if not os.path.exists(dst):
        urllib.request.urlretrieve(VAD_URL, dst)
    return dst


class AsrEngine:
    """silero VAD segmentation + a pluggable recognizer. Feed Int16 bytes, get text per VAD segment.

    The silero VAD must be fed in fixed window_size (512-sample @16k) chunks, so feed()
    buffers the downsampled audio and only consumes whole windows; the remainder carries
    over to the next feed().
    """

    def __init__(self):
        self._vad = None
        self._backend = None
        self._language = None
        self.resolved = None
        self._window = 512
        self._buf = np.zeros(0, np.float32)
        self._src_rate = SRC_RATE

    def _init_vad(self, sample_rate, vad_threshold, vad_min_silence, vad_min_speech):
        import sherpa_onnx  # lazy: native lib pulled here
        self._src_rate = int(sample_rate)
        vad_cfg = sherpa_onnx.VadModelConfig()
        vad_cfg.silero_vad.model = _resolve_vad_model()
        if vad_threshold is not None:
            vad_cfg.silero_vad.threshold = float(vad_threshold)
        if vad_min_silence is not None:
            vad_cfg.silero_vad.min_silence_duration = float(vad_min_silence)
        if vad_min_speech is not None:
            vad_cfg.silero_vad.min_speech_duration = float(vad_min_speech)
        vad_cfg.sample_rate = TARGET_RATE
        self._window = vad_cfg.silero_vad.window_size
        self._buf = np.zeros(0, np.float32)
        self._vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=30)

    def init(self, model_id=None, language="", sample_rate=SRC_RATE,
             vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
        from . import accel
        t0 = time.time()
        # Free any previously-loaded model BEFORE loading the next. The engine is a
        # process singleton reused across sessions; without this, re-init piles a second
        # model into VRAM (PyTorch's caching allocator never returns it) and usage climbs.
        self.close()
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        # Resolve the fastest available backend+device; CPU floor guaranteed.
        plans = accel.resolve(model_id or "sense-voice", override=device or "auto")
        self._backend, plan, _notice = accel.load_with_fallback(plans)
        self._language = language or None
        rtf = accel.measure_rtf(self._backend, plan, model_id or "sense-voice", accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        # Surface the ACTUAL backend/device the session resolved to. A non-'auto'
        # compute-device choice only reorders plans, so a GPU-only model still loads
        # on CUDA even when 'cpu' was requested — this line makes that visible.
        import sys
        print(f"[sokuji-sidecar] ASR ready: model={model_id or 'sense-voice'} "
              f"backend={plan.backend} device={plan.device} compute={plan.compute_type}"
              + (f" rtf={rtf:.3f} (~{1 / rtf:.0f}x realtime)" if rtf else "")
              + f"  [requested device={device or 'auto'}]", file=sys.stderr, flush=True)
        return int((time.time() - t0) * 1000)

    def close(self):
        """Free the loaded ASR model and its GPU memory. Idempotent — called at the start
        of each init() and when a session connection closes, so VRAM never accumulates.
        Also ends any open streaming session (its generate thread holds an independent
        model reference that unload() alone cannot reclaim)."""
        self._stop = True
        stream = getattr(self, "_stream", None)
        if stream is not None:
            try:
                stream.abort()
            except Exception:
                pass
            self._stream = None
        q = getattr(self, "_audio_q", None)   # unblock run_stream's queue.get promptly
        if q is not None:
            try:
                q.put_nowait(None)
            except Exception:
                pass
        backend = self._backend
        self._backend = None
        if backend is not None:
            try:
                backend.unload()
            except Exception:
                pass

    def _drain(self):
        out = []
        while not self._vad.empty():
            seg = self._vad.front
            samples = np.asarray(seg.samples, dtype=np.float32)
            t0 = time.time()
            text = self._backend.transcribe(samples, self._language).text
            self._vad.pop()
            if text:
                out.append({"type": "result", "text": text,
                            "startSample": int(seg.start),
                            "durationMs": int(len(seg.samples) / TARGET_RATE * 1000),
                            "recognitionTimeMs": int((time.time() - t0) * 1000)})
        return out

    def feed(self, int16_bytes):
        self._buf = np.concatenate([self._buf, _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)])
        out = []
        while len(self._buf) >= self._window:
            was_detected = self._vad.is_speech_detected()
            self._vad.accept_waveform(self._buf[:self._window])
            self._buf = self._buf[self._window:]
            if not was_detected and self._vad.is_speech_detected():
                out.append({"type": "speech_start"})
            out.extend(self._drain())
        return out

    def flush(self):
        self._buf = np.zeros(0, np.float32)   # drop the <32ms sub-window tail
        self._vad.flush()
        return self._drain()

    # ── Streaming branch (STREAMING backends only; offline path above is unchanged) ──

    def is_streaming(self):
        return bool(getattr(self._backend, "STREAMING", False))

    def init_streaming(self, model_id=None, language="", sample_rate=SRC_RATE,
                       vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto"):
        """Like init(), but for a STREAMING backend: resolve+load, set up VAD for
        endpointing, and prepare the audio queue + always-stream state (default mode)."""
        import queue as _queue
        self.close()
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        self._backend = self._resolve_streaming_backend(model_id, device)
        self._language = language or None
        self._audio_q = _queue.Queue()
        self._mode = "always_stream"
        self._stream = self._backend.open_stream()   # always-stream: one long-lived session
        self._pending = ""           # un-segmented text accumulated from drain()
        self._utt_text = ""          # current sentence (the partial)
        self._partial_acc = []       # per-utterance fallback accumulator
        self._utt_start_sample = 0
        self._sample_cursor = 0
        self._utt_samples = 0        # per-utterance fallback (20s cap)
        self._silence_samples = 0    # consecutive silence (always-stream restart)
        self._stream_speech_samples = 0   # speech since last restart (4min safety)
        self._fed_s = 0.0            # audio seconds fed (backpressure, Task 3)
        self._delta_count = 0        # tokens drained (backpressure, Task 3)
        self._stop = False

    def feed_stream(self, int16_bytes):
        """Non-blocking: hand raw audio to the streaming loop (called from on_binary).
        Returns [] — streaming events are pushed asynchronously by run_stream, so there
        is nothing to send synchronously from the _conn feeder loop."""
        self._audio_q.put_nowait(int16_bytes)
        return []

    async def run_stream(self, send):
        """The asyncio streaming loop (Approach A). Owns VAD endpointing, the stream
        session lifecycle, and pushes speech_start/partial/result via `send`."""
        loop = asyncio.get_running_loop()
        while not self._stop:
            try:
                data = await loop.run_in_executor(None, self._audio_q.get, True, 0.1)
            except queue.Empty:
                continue
            if data is None:
                break
            if self._mode == "always_stream":
                await self._drive_always(send, data)
            else:
                await self._drive_utterance(send, data)
        if self._mode == "always_stream":
            if self._utt_text:
                await send(self._result_event(self._utt_text))
        elif self._stream is not None:
            await self._finalize(send)

    async def _drive_utterance(self, send, int16_bytes):
        """Process one audio buffer: VAD → manage session → emit events. Factored so
        tests can call _drive_once with scripted VAD. Feeds the buffer to the stream
        ONCE per call — a single buffer spans several VAD windows, so feeding per-event
        would duplicate the audio and scramble the streaming model's features."""
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        events = self._vad_events(samples)
        if "start" in events:
            # Defensive: in practice _stream is already None here (an "end" precedes every
            # "start", and degrade nulls it) — abort + reopen guards against a stale stream
            # from any source.
            if self._stream is not None:
                try:
                    self._stream.abort()
                except Exception:
                    pass
                self._stream = None
                self._partial_acc = []
            self._utt_start_sample = self._sample_cursor
            self._stream = self._backend.open_stream()
            await send({"type": "speech_start"})
        if self._stream is not None and "speech" in events:
            self._stream.feed(samples)
            deltas = self._stream.drain()
            if deltas:
                self._partial_acc += deltas
                await send({"type": "partial", "text": "".join(self._partial_acc)})
        if "end" in events and self._stream is not None:
            await self._finalize(send)
        self._sample_cursor += len(samples)

    async def _finalize(self, send):
        import time as _time
        t0 = _time.time()
        loop = asyncio.get_running_loop()
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
            data = self._audio_q.get_nowait()
            if self._mode == "always_stream":
                await self._drive_always(send, data)
            else:
                await self._drive_utterance(send, data)

    def _vad_state(self, samples):
        """Run silero VAD over `samples` for STATE only (always-stream): return
        (had_speech, rising, falling). `falling` = silero's endpoint (is_speech_detected
        True->False this buffer), governed by the user's min_silence_duration. Does not
        gate input."""
        had_speech = False
        rising = False
        falling = False
        self._buf = np.concatenate([self._buf, samples])
        while len(self._buf) >= self._window:
            was = self._vad.is_speech_detected()
            self._vad.accept_waveform(self._buf[:self._window])
            self._buf = self._buf[self._window:]
            now = self._vad.is_speech_detected()
            if now:
                had_speech = True
            if not was and now:
                rising = True
            if was and not now:
                falling = True
        return had_speech, rising, falling

    def _result_event(self, text):
        """A `result` envelope. startSample/durationMs are approximate in always-stream."""
        return {"type": "result", "text": text.strip(),
                "startSample": int(self._utt_start_sample),
                "durationMs": int(self._sample_cursor / TARGET_RATE * 1000),
                "recognitionTimeMs": 0}

    async def _flush_and_restart(self, send):
        """Flush any un-punctuated pending text as a final, then restart the stream
        (abort + reopen) — bounds context/VRAM and recovers cleanly during silence."""
        if self._utt_text:
            await send(self._result_event(self._utt_text))
        try:
            self._stream.abort()
        except Exception:
            pass
        self._stream = self._backend.open_stream()
        self._pending = ""
        self._utt_text = ""
        self._silence_samples = 0
        self._stream_speech_samples = 0

    async def _drive_always(self, send, int16_bytes):
        """Always-stream: feed every buffer (no gating); VAD only for the speech-start cue
        + the long-silence restart; drain -> accumulate -> cut finals on sentence punctuation."""
        from .voxtral_stream import split_sentences
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        self._sample_cursor += len(samples)
        self._fed_s += len(samples) / TARGET_RATE
        self._stream.feed(samples)                       # continuous, never gated
        try:
            had_speech, rising = self._vad_state(samples)
        except Exception:                                # VAD failure -> degrade gracefully
            had_speech, rising = True, False             # assume speech; punctuation finals still work
        if rising:
            await send({"type": "speech_start"})
        if had_speech:
            self._silence_samples = 0
            self._stream_speech_samples += len(samples)
        else:
            self._silence_samples += len(samples)
        deltas = self._stream.drain()
        self._delta_count += len(deltas)
        if deltas:
            self._pending += "".join(deltas)
            sentences, remainder = split_sentences(self._pending)
            for s in sentences:
                await send(self._result_event(s))
            self._pending = remainder
            # _utt_text is _pending stripped for the partial display + flush; _pending keeps the raw text for split_sentences.
            self._utt_text = remainder.strip()
            await send({"type": "partial", "text": self._utt_text})
        if getattr(self._stream, "aborted", False):      # generate died -> self-heal: flush + restart
            await self._flush_and_restart(send)
            return
        if self._silence_samples >= int(2.5 * TARGET_RATE):
            await self._flush_and_restart(send)
        elif self._stream_speech_samples >= 4 * 60 * TARGET_RATE and not self._pending:
            await self._flush_and_restart(send)
        lag = self._fed_s - self._delta_count * 0.08          # ~0.56s healthy; >3s = can't keep up
        if self._mode == "always_stream" and lag > 3.0:
            if self._utt_text:
                await send(self._result_event(self._utt_text))
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = None                               # per-utterance opens on next VAD start
            self._mode = "per_utterance"
            self._pending = ""
            self._utt_text = ""

    def resolves_to_streaming(self, model_id, device):
        """Cheap pre-check (no model load): does this model resolve to a STREAMING backend?

        Instantiates a bare backend object (no load()) and reads its STREAMING class flag.
        Only the top-ranked plan is checked. Returns False on any resolution error so the
        caller can safely fall back to the offline path."""
        from . import accel, backends
        try:
            plans = accel.resolve(model_id or "sense-voice", override=device or "auto")
        except Exception:
            return False
        if not plans:
            return False
        try:
            # make_backend() instantiates the class — no model load, no I/O.
            obj = backends.make_backend(plans[0].backend)
            return bool(getattr(obj, "STREAMING", False))
        except Exception:
            return False

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


async def _h_asr_init(state, msg, _b, conn=None):
    import asyncio
    eng = state["asr_engine"]
    model = msg.get("model")
    device = msg.get("device", "auto")
    language = msg.get("language", "")
    sample_rate = msg.get("sampleRate", SRC_RATE)
    vad_threshold = msg.get("vadThreshold")
    vad_min_silence = msg.get("vadMinSilenceDuration")
    vad_min_speech = msg.get("vadMinSpeechDuration")

    # Cheap pre-check: resolve the backend NAME without loading the model, then read
    # its STREAMING flag. This ensures each branch loads the model exactly once.
    is_streaming = (hasattr(eng, "resolves_to_streaming")
                    and eng.resolves_to_streaming(model, device))

    if is_streaming:
        # Streaming path: init_streaming resolves+loads the backend once.
        eng.init_streaming(model, language, sample_rate,
                           vad_threshold, vad_min_silence, vad_min_speech, device)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed_stream
            conn.ctx["stream_task"] = asyncio.create_task(eng.run_stream(conn.send))
        ms = 0
    else:
        # Offline path (unchanged Phase 1 behaviour): init() loads the model once.
        ms = eng.init(model, language, sample_rate,
                      vad_threshold, vad_min_silence, vad_min_speech, device)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed

    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(eng, "resolved", None)
    if resolved:
        reply.update(resolved)  # backend, device, computeType
    return reply, None


async def _h_asr_flush(state, msg, _b, conn=None):
    for out in state["asr_engine"].flush():
        if conn is not None:
            await conn.send(out)
    return {"type": "ok", "id": msg.get("id")}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"asr_init": _h_asr_init, "asr_flush": _h_asr_flush})
