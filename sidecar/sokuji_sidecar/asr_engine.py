import asyncio
import os
import queue
import time
import numpy as np

TARGET_RATE = 16000
SRC_RATE = 24000
# Gated-streaming pre-roll: silero confirms speech 300-600ms after the true
# onset (threshold ramp + min_speech_duration) — keep this much audio to
# replay into a fresh stream so utterances don't lose their first words.
PREROLL_SAMPLES = int(0.7 * TARGET_RATE)

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
        # Pre-roll ring (gated streaming): the last ~0.7s of audio, replayed
        # into a fresh stream at silero's rising edge — detection lags the true
        # onset by 300-600ms and that audio used to be silently dropped.
        self._preroll = []
        self._preroll_len = 0

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
             vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto",
             pin=None):
        from . import accel
        t0 = time.time()
        # Free any previously-loaded model BEFORE loading the next. The engine is a
        # process singleton reused across sessions; without this, re-init piles a second
        # model into VRAM (PyTorch's caching allocator never returns it) and usage climbs.
        self.close()
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        # Resolve the fastest available backend+device; CPU floor guaranteed.
        plans = accel.resolve(model_id or "sense-voice", override=device or "auto", pin=pin)
        self._backend, plan, notice, mem = accel.load_measured(plans, stage="asr")
        self._language = language or None
        rtf = accel.measure_rtf(self._backend, plan, model_id or "sense-voice", accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
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
        from . import accel
        accel.ledger_release("asr")
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
                       vad_threshold=None, vad_min_silence=None, vad_min_speech=None, device="auto",
                       pin=None):
        """Like init(), but for a STREAMING backend: resolve+load, set up VAD for
        endpointing, and prepare the audio queue + always-stream state (default mode)."""
        import queue as _queue
        self.close()
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        self._backend, plan, notice, mem = self._resolve_streaming_backend(model_id, device, pin)
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        self._language = language or None
        self._audio_q = _queue.Queue()
        self._mode = "always_stream"
        self._stream = self._open_stream()   # always-stream: one long-lived session
        self._preroll = []
        self._preroll_len = 0
        self._pending = ""           # text drained since the last cut (the partial)
        self._partial_acc = []       # per-utterance fallback accumulator
        self._utt_start_sample = 0
        self._sample_cursor = 0
        self._utt_samples = 0        # per-utterance fallback (its own cap)
        self._speech_samples = 0     # speech in the current stream (20s run-on cap)
        self._stop = False

    def _open_stream(self):
        """Open a stream on the loaded backend, forwarding the user's source
        language — the same hint the batch path gives session.run(). Every
        stream (re)open goes through here: init, endpoint-reopen, salvage."""
        return self._backend.open_stream(self._language)

    def _preroll_push(self, samples):
        """Roll `samples` into the pre-roll ring (keeps >= PREROLL_SAMPLES)."""
        self._preroll.append(samples)
        self._preroll_len += len(samples)
        while (len(self._preroll) > 1
               and self._preroll_len - len(self._preroll[0]) >= PREROLL_SAMPLES):
            self._preroll_len -= len(self._preroll.pop(0))

    def _preroll_take(self):
        """Drain the ring: the buffered onset audio (or None), resetting it."""
        if not self._preroll:
            return None
        out = np.concatenate(self._preroll)
        self._preroll, self._preroll_len = [], 0
        return out

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
            # Flush the last stream if it saw speech (its tail text may still be held by the
            # model with _pending empty) — gating on speech, not _pending, mirrors the pause-cut.
            if self._stream is not None and self._speech_samples > 0:
                try:
                    final = await loop.run_in_executor(None, self._stream.end)
                except Exception:
                    final = ""
                self._stream = None
                if final.strip():
                    await send(self._result_event(final))
        elif self._stream is not None:
            await self._finalize(send)

    async def _drive_utterance(self, send, int16_bytes):
        """Process one audio buffer: VAD → manage session → emit events. Factored so
        tests can call _drive_once with scripted VAD. Feeds the buffer to the stream
        ONCE per call — a single buffer spans several VAD windows, so feeding per-event
        would duplicate the audio and scramble the streaming model's features.

        Silero's rising edge lags the true onset by 300-600ms (threshold ramp +
        min_speech_duration): the pre-roll ring replays that audio into the fresh
        stream so utterances keep their first words. A fast utterance (recognition
        quicker than realtime) flips the engine back to the lossless always-stream
        mode — a degrade is not a one-way door."""
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
            self._utt_start_sample = max(0, self._sample_cursor - self._preroll_len)
            self._stream = self._open_stream()
            pre = self._preroll_take()
            if pre is not None:
                self._stream.feed(pre)     # onset audio silero's latency would drop
            await send({"type": "speech_start"})
        if self._stream is not None and "speech" in events:
            self._stream.feed(samples)
            deltas = self._stream.drain()
            if deltas:
                self._partial_acc += deltas
                await send({"type": "partial", "text": "".join(self._partial_acc)})
        ended = False
        if "end" in events and self._stream is not None:
            dur_ms, rec_ms = await self._finalize(send)
            ended = True
            self._preroll, self._preroll_len = [], 0   # ring restarts post-utterance
            if rec_ms < dur_ms:
                import sys
                print("[sokuji-sidecar] streaming caught up — back to always-stream mode",
                      file=sys.stderr, flush=True)
                self._mode = "always_stream"
                self._pending = ""
                self._speech_samples = 0
                self._stream = self._open_stream()
        self._sample_cursor += len(samples)
        if not ended:
            # Ring holds strictly-previous buffers at "start" time; the buffer
            # that ENDED an utterance is excluded so the next pre-roll can't
            # replay the previous utterance's tail.
            self._preroll_push(samples)

    async def _finalize(self, send):
        """end() the stream and emit the result. Returns (dur_ms, rec_ms) so the
        gated drive can decide whether the model runs faster than realtime."""
        import time as _time
        t0 = _time.time()
        loop = asyncio.get_running_loop()
        final = await loop.run_in_executor(None, self._stream.end)
        dur_ms = int((self._sample_cursor - self._utt_start_sample) / TARGET_RATE * 1000)
        rec_ms = int((_time.time() - t0) * 1000)
        if final.strip():
            await send({"type": "result", "text": final.strip(),
                        "startSample": int(self._utt_start_sample),
                        "durationMs": dur_ms,
                        "recognitionTimeMs": rec_ms})
        self._stream = None
        self._partial_acc = []
        return dur_ms, rec_ms

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

    async def _end_and_reopen(self, send):
        """Pause-cut: end() the stream to flush the COMPLETE held tail, emit it as the
        result, then open a fresh stream. Audio arriving during the ~1s end() backs up in
        _audio_q and feeds the new stream after — no leading loss. Per-stream backpressure
        counters reset (end()'s flushed tokens aren't counted via drain())."""
        loop = asyncio.get_running_loop()
        try:
            final = await loop.run_in_executor(None, self._stream.end)
        except Exception:                                # end() failed -> drop this final, still recover
            final = ""
        if final.strip():
            await send(self._result_event(final))
        self._stream = self._open_stream()
        self._pending = ""
        self._speech_samples = 0

    async def _drive_always(self, send, int16_bytes):
        """Always-stream: feed every buffer (no gating); cut a final on silero's endpoint
        (the falling edge, governed by the user's min_silence_duration) — or a 20s run-on
        cap — via end()+reopen, which flushes the COMPLETE held tail. Continuous feed means
        no leading loss."""
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        self._sample_cursor += len(samples)
        self._preroll_push(samples)          # rolling onset copy (consumed at degrade)
        self._stream.feed(samples)                       # continuous, never gated
        try:
            had_speech, rising, falling = self._vad_state(samples)
        except Exception:                                # VAD failure -> assume speech, no edges
            had_speech, rising, falling = True, False, False
        if rising:
            await send({"type": "speech_start"})
        if had_speech:
            self._speech_samples += len(samples)
        deltas = self._stream.drain()
        if deltas:
            self._pending += "".join(deltas)
            await send({"type": "partial", "text": self._pending.strip()})
        if getattr(self._stream, "aborted", False):      # generate died -> salvage + reopen
            if self._pending.strip():
                await send(self._result_event(self._pending))
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = self._open_stream()
            self._pending = ""; self._speech_samples = 0
            return
        # Cut on the silero endpoint (or the run-on cap) whenever this stream has SEEN SPEECH —
        # NOT when _pending has text. The model can hold a short utterance's text until end(),
        # so gating on _pending would drop/merge short or slow-first-token utterances. end()
        # flushes the held text and _end_and_reopen's `if final.strip()` skips truly-empty finals.
        if (falling or self._speech_samples >= 20 * TARGET_RATE) and self._speech_samples > 0:
            await self._end_and_reopen(send)
            return
        # Backpressure = un-processed audio backed up in the queue. This is the
        # only cadence-independent signal: a genuinely slow model makes the
        # run_stream loop fall behind feed_stream, so the queue grows. The two
        # earlier heuristics both mis-fired — counting fed seconds degraded on
        # SILENCE (the model rightly emits nothing), and crediting drained
        # deltas at 80ms/each degraded on transcribe.cpp's committed-prefix
        # adapter (one MERGED delta per drain, committed in 1-2s bursts).
        lag = self._audio_q.qsize() * (len(samples) / TARGET_RATE)
        if self._mode == "always_stream" and lag > 3.0:
            import sys
            print(f"[sokuji-sidecar] streaming has {lag:.1f}s of audio backed up — "
                  "degrading to VAD-gated mode", file=sys.stderr, flush=True)
            if self._pending.strip():
                await send(self._result_event(self._pending))
            try:
                self._stream.abort()
            except Exception:
                pass
            self._stream = None
            self._mode = "per_utterance"
            self._pending = ""
            if had_speech:
                # Backlog usually builds while the model chews on SPEECH, so
                # the degrade typically lands mid-utterance. Without a
                # continuation stream the VAD stays in-speech and no rising
                # edge would ever open one — the rest of the utterance would
                # be dropped. Open it now and replay the ring.
                self._utt_start_sample = max(0, self._sample_cursor - self._preroll_len)
                self._partial_acc = []
                self._stream = self._open_stream()
                pre = self._preroll_take()
                if pre is not None:
                    self._stream.feed(pre)
                await send({"type": "speech_start"})

    def resolves_to_streaming(self, model_id, device, pin=None):
        """Cheap pre-check (no model load): does this model resolve to a STREAMING backend?

        Instantiates a bare backend object (no load()) and reads its STREAMING class flag.
        Only the top-ranked plan is checked; `pin` (the user-pinned quant) must match what
        init/init_streaming will load so both resolve the same plan. Returns False on any
        resolution error so the caller can safely fall back to the offline path."""
        from . import accel, backends
        try:
            plans = accel.resolve(model_id or "sense-voice", override=device or "auto", pin=pin)
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

    def _resolve_streaming_backend(self, model_id, device, pin=None):
        from . import accel
        plans = accel.resolve(model_id or "voxtral-mini-4b-realtime", override=device or "auto", pin=pin)
        return accel.load_measured(plans, stage="asr")   # (backend, plan, notice, memory_bytes)

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


def _asr_teardown(state, conn):
    """Free this connection's ASR model when the connection closes (stop = release VRAM).

    Reads the stream task from conn.ctx at close time — the offline path never creates one.
    """
    task = conn.ctx.get("stream_task")
    if task is not None:
        task.cancel()
    eng = state.get("asr_engine")
    if eng is not None:
        try:
            eng.close()
        except Exception:
            pass


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
    pin = msg.get("variant")   # user-pinned quant (renderer variant picker)

    # Cheap pre-check: resolve the backend NAME without loading the model, then read
    # its STREAMING flag. This ensures each branch loads the model exactly once.
    is_streaming = (hasattr(eng, "resolves_to_streaming")
                    and eng.resolves_to_streaming(model, device, pin=pin))

    if is_streaming:
        # Streaming path: init_streaming resolves+loads the backend once.
        eng.init_streaming(model, language, sample_rate,
                           vad_threshold, vad_min_silence, vad_min_speech, device, pin=pin)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed_stream
            conn.ctx["stream_task"] = asyncio.create_task(eng.run_stream(conn.send))
            conn.on_close(lambda: _asr_teardown(state, conn))
        ms = 0
    else:
        # Offline path (unchanged Phase 1 behaviour): init() loads the model once.
        ms = eng.init(model, language, sample_rate,
                      vad_threshold, vad_min_silence, vad_min_speech, device, pin=pin)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed
            conn.on_close(lambda: _asr_teardown(state, conn))

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
