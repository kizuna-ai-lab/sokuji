import asyncio
import queue
import time
import numpy as np

TARGET_RATE = 16000
SRC_RATE = 24000
# Gated-streaming pre-roll: silero confirms speech 300-600ms after the true
# onset (threshold ramp + min_speech_duration) — keep this much audio to
# replay into a fresh stream so utterances don't lose their first words.
PREROLL_SAMPLES = int(0.7 * TARGET_RATE)
RING_SAMPLES = int(0.7 * TARGET_RATE)       # offline pre-roll (start-mark skew absorber)
OFFLINE_CAP_SAMPLES = 30 * TARGET_RATE      # backstop against a lost end mark (client cuts at 20s)


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


class AsrEngine:
    """Mark-driven ASR: the client's vad-web worker owns segmentation and sends
    `start`/`end`/`cancel` edges via mark(); both the offline and streaming halves
    buffer/gate audio between marks and transcribe (or feed) accordingly. A
    pluggable recognizer produces the text.
    """

    def __init__(self):
        self._backend = None
        self._language = None
        self.resolved = None
        self._src_rate = SRC_RATE
        self._streaming = False
        # Offline (mark-driven) segmentation state:
        self._in_speech = False
        self._seg = []              # np.float32 chunks of the open segment
        self._seg_len = 0
        self._seg_start = 0         # first sample index of the open segment (16k, since init)
        self._fed_total = 0         # every 16k sample ever fed since init
        self._ring = []             # pre-roll ring, only fed while NOT in speech
        self._ring_len = 0
        # Streaming pre-roll ring (unchanged, used by the streaming half):
        self._preroll = []
        self._preroll_len = 0

    def init(self, model_id=None, language="", sample_rate=SRC_RATE, device="auto", pin=None):
        from . import accel
        t0 = time.time()
        # Free any previously-loaded model BEFORE loading the next. The engine is a
        # process singleton reused across sessions; without this, re-init piles a second
        # model into VRAM (PyTorch's caching allocator never returns it) and usage climbs.
        self.close()
        self._src_rate = int(sample_rate)
        self._streaming = False
        self._reset_offline()
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
        # on the GPU even when 'cpu' was requested — this line makes that visible.
        import sys
        print(f"[sokuji-sidecar] ASR ready: model={model_id or 'sense-voice'} "
              f"backend={plan.backend} device={plan.device} compute={plan.compute_type}"
              + (f" rtf={rtf:.3f} (~{1 / rtf:.0f}x realtime)" if rtf else "")
              + f"  [requested device={device or 'auto'}]", file=sys.stderr, flush=True)
        return int((time.time() - t0) * 1000)

    def _reset_offline(self):
        self._in_speech = False
        self._seg, self._seg_len, self._seg_start = [], 0, 0
        self._fed_total = 0
        self._ring, self._ring_len = [], 0

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
        self._reset_offline()
        self._streaming = False

    def feed(self, int16_bytes):
        """Buffer downsampled audio for the offline (mark-driven) path: while NOT in
        speech it rolls into the pre-roll ring; while in speech it appends to the open
        segment. Emits no session-start event of its own — that edge comes from the client's mark."""
        x = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        self._fed_total += len(x)
        if not self._in_speech:
            self._ring.append(x)
            self._ring_len += len(x)
            while len(self._ring) > 1 and self._ring_len - len(self._ring[0]) >= RING_SAMPLES:
                self._ring_len -= len(self._ring.pop(0))
            return []
        self._seg.append(x)
        self._seg_len += len(x)
        if self._seg_len >= OFFLINE_CAP_SAMPLES:
            # Lost end mark: transcribe what we have and keep going in-speech.
            out = self._cut()
            self._seg_start = self._fed_total
            return out
        return []

    def mark(self, event):
        """A client VAD edge. Offline: act now, return events to push. Streaming:
        enqueue a sentinel so the mark stays ordered against the queued audio."""
        if self._streaming:
            self._audio_q.put_nowait(("mark", event))
            return []
        if event == "start":
            self._seg = list(self._ring)
            self._seg_len = self._ring_len
            self._seg_start = max(0, self._fed_total - self._ring_len)
            self._ring, self._ring_len = [], 0
            self._in_speech = True
            return []
        if event == "end":
            if not self._in_speech:
                return []
            self._in_speech = False
            self._ring, self._ring_len = [], 0     # never re-seed with this utterance's tail
            return self._cut()
        if event == "cancel":
            self._in_speech = False
            self._seg, self._seg_len = [], 0
            self._ring, self._ring_len = [], 0
            return []
        return []

    def _cut(self):
        """Transcribe the open segment buffer; emits at most one result."""
        if not self._seg:
            return []
        samples = np.concatenate(self._seg)
        self._seg, self._seg_len = [], 0
        t0 = time.time()
        text = self._backend.transcribe(samples, self._language).text
        if not text:
            return []
        return [{"type": "result", "text": text,
                 "startSample": int(self._seg_start),
                 "durationMs": int(len(samples) / TARGET_RATE * 1000),
                 "recognitionTimeMs": int((time.time() - t0) * 1000)}]

    def flush(self):
        if self._in_speech:
            return self.mark("end")
        return []

    # ── Streaming branch (STREAMING backends only; offline path above is unchanged) ──

    def is_streaming(self):
        return bool(getattr(self._backend, "STREAMING", False))

    def init_streaming(self, model_id=None, language="", sample_rate=SRC_RATE, device="auto", pin=None):
        """Like init(), but for a STREAMING backend: resolve+load, and prepare the
        audio queue + always-stream state (default mode). Segmentation is entirely
        client-driven — the client's marks toggle _in_speech; no VAD setup here."""
        import queue as _queue
        self.close()
        self._src_rate = int(sample_rate)
        self._in_speech = False
        self._backend, plan, notice, mem = self._resolve_streaming_backend(model_id, device, pin)
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        self._language = language or None
        self._audio_q = _queue.Queue()
        self._streaming = True       # flip only after _audio_q exists: a vad_mark racing this
                                      # call must never enqueue into a missing/stale queue
        self._mode = "always_stream"
        self._stream = self._open_stream()   # always-stream: one long-lived session
        self._preroll = []
        self._preroll_len = 0
        self._pending = ""           # text drained since the last cut (the partial)
        self._partial_acc = []       # per-utterance fallback accumulator
        self._utt_start_sample = 0
        self._sample_cursor = 0
        self._utt_fed = 0            # per-utterance backstop counter (gated mode)
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
        """The asyncio streaming loop (Approach A). Dispatches queued marks and audio
        via _dispatch, owns the stream session lifecycle, and pushes partial/result via
        `send`. Endpointing is entirely client-driven (see _mark_always/_mark_utterance)."""
        loop = asyncio.get_running_loop()
        while not self._stop:
            try:
                data = await loop.run_in_executor(None, self._audio_q.get, True, 0.1)
            except queue.Empty:
                continue
            if data is None:
                break
            await self._dispatch(send, data)
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

    async def _dispatch(self, send, data):
        """Route one queued item to its handler: a ('mark', event) sentinel goes to
        _mark_always/_mark_utterance, a raw audio buffer to _drive_always/_drive_utterance.
        Shared by run_stream and the _drive_once test seam so marks are handled
        identically in both."""
        if isinstance(data, tuple) and data and data[0] == "mark":
            ev = data[1]
            if self._mode == "always_stream":
                await self._mark_always(send, ev)
            else:
                await self._mark_utterance(send, ev)
            return
        if self._mode == "always_stream":
            await self._drive_always(send, data)
        else:
            await self._drive_utterance(send, data)

    async def _mark_always(self, send, ev):
        """Always-stream mode: marks own the endpoint. "start"/"cancel" just toggle
        _in_speech (the stream is already open and fed continuously); "end" cuts via
        _end_and_reopen when the stream has actually seen speech."""
        if ev == "start":
            self._in_speech = True
            return
        if ev == "cancel":
            self._in_speech = False
            self._speech_samples = 0   # a cancelled stretch must not feed the run-on cap
                                        # or keep the shutdown flush condition alive
            return
        if ev == "end":
            self._in_speech = False
            if self._stream is not None and self._speech_samples > 0:
                await self._end_and_reopen(send)

    async def _mark_utterance(self, send, ev):
        """Gated (per-utterance) mode: marks open/close the session; _drive_utterance
        only feeds audio while _in_speech. A fast utterance (recognition quicker than
        realtime) flips the engine back to the lossless always-stream mode — a degrade
        is not a one-way door."""
        if ev == "start":
            if self._stream is not None:            # stale stream from any source
                try:
                    self._stream.abort()
                except Exception:
                    # Best-effort: the stale stream is discarded on the next line either way.
                    pass
                self._stream = None
                self._partial_acc = []
            self._utt_start_sample = max(0, self._sample_cursor - self._preroll_len)
            self._stream = self._open_stream()
            pre = self._preroll_take()
            if pre is not None:
                self._stream.feed(pre)
            self._in_speech = True
            self._utt_fed = 0
            return
        if ev == "cancel":
            if self._stream is not None:
                try:
                    self._stream.abort()
                except Exception:
                    # Best-effort: the stream is discarded on the next line either way,
                    # and a raise here would break cancel handling itself.
                    pass
                self._stream = None
                self._partial_acc = []
            self._in_speech = False
            self._preroll, self._preroll_len = [], 0
            return
        if ev == "end":
            self._in_speech = False
            if self._stream is None:
                return
            dur_ms, rec_ms = await self._finalize(send)
            self._preroll, self._preroll_len = [], 0
            if rec_ms < dur_ms:
                import sys
                print("[sokuji-sidecar] streaming caught up — back to always-stream mode",
                      file=sys.stderr, flush=True)
                self._mode = "always_stream"
                self._pending = ""
                self._speech_samples = 0
                self._stream = self._open_stream()

    async def _drive_utterance(self, send, int16_bytes):
        """Audio in gated mode. Marks arrive separately (see _mark_utterance); this
        only feeds the open stream while in speech and keeps the pre-roll ring warm
        while out of it. A 20s per-utterance backstop finalizes and reopens in place
        if the client's end mark is lost."""
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        if self._in_speech and self._stream is not None:
            self._stream.feed(samples)
            self._utt_fed += len(samples)
            deltas = self._stream.drain()
            if deltas:
                self._partial_acc += deltas
                await send({"type": "partial", "text": "".join(self._partial_acc)})
            if self._utt_fed >= 20 * TARGET_RATE:   # lost end mark: cut, keep going
                await self._finalize(send)
                self._utt_start_sample = self._sample_cursor   # exclude the just-finalized
                                                                 # portion from the next segment
                self._stream = self._open_stream()
                self._utt_fed = 0
        else:
            self._preroll_push(samples)
        self._sample_cursor += len(samples)

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
            await self._dispatch(send, data)

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
        """Always-stream: feed every buffer (no gating). The client's marks own the
        endpoint (_mark_always cuts via _end_and_reopen on "end"); this only tracks
        speech extent for that decision and forces a cut at the 20s run-on cap as a
        backstop against a lost end mark. Continuous feed means no leading loss."""
        samples = _downsample_int16_to_f32_16k(int16_bytes, self._src_rate)
        self._sample_cursor += len(samples)
        self._preroll_push(samples)          # rolling onset copy (consumed at degrade)
        self._stream.feed(samples)                       # continuous, never gated
        had_speech = self._in_speech
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
        # Run-on cap backstop: the client's "end" mark normally owns the endpoint (see
        # _mark_always); this only forces a cut if that mark is lost or badly delayed.
        if self._speech_samples >= 20 * TARGET_RATE and self._speech_samples > 0:
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
                  "degrading to client-gated mode", file=sys.stderr, flush=True)
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
                # continuation stream the client stays in-speech (no new
                # "start" mark would ever arrive) and the rest of the
                # utterance would be dropped. Open it now and replay the ring.
                self._utt_start_sample = max(0, self._sample_cursor - self._preroll_len)
                self._partial_acc = []
                self._utt_fed = 0   # this engine is a process singleton reused across
                                     # sessions — a stale value here would trip the gated
                                     # 20s backstop on the very next buffer
                self._stream = self._open_stream()
                pre = self._preroll_take()
                if pre is not None:
                    self._stream.feed(pre)

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
    pin = msg.get("variant")   # user-pinned quant (renderer variant picker)

    # Cheap pre-check: resolve the backend NAME without loading the model, then read
    # its STREAMING flag. This ensures each branch loads the model exactly once.
    is_streaming = (hasattr(eng, "resolves_to_streaming")
                    and eng.resolves_to_streaming(model, device, pin=pin))

    if is_streaming:
        # Streaming path: init_streaming resolves+loads the backend once.
        eng.init_streaming(model, language, sample_rate, device=device, pin=pin)
        if conn is not None:
            conn.ctx["on_binary"] = eng.feed_stream
            conn.ctx["stream_task"] = asyncio.create_task(eng.run_stream(conn.send))
            conn.on_close(lambda: _asr_teardown(state, conn))
        ms = 0
    else:
        # Offline path: init() loads the model once. Segmentation is client-driven
        # (vad_mark), so no VAD params are forwarded here.
        ms = eng.init(model, language, sample_rate, device=device, pin=pin)
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


async def _h_vad_mark(state, msg, _b, conn=None):
    """Client VAD edge (fire-and-forget: no id, no reply). Push whatever the
    engine produced (an end mark can complete a segment -> one result)."""
    for out in state["asr_engine"].mark(msg.get("event", "")):
        if conn is not None:
            await conn.send(out)
    return None, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"asr_init": _h_asr_init, "asr_flush": _h_asr_flush, "vad_mark": _h_vad_mark})
