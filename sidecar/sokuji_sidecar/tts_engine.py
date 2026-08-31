"""TTS stage: resolve the native_tts backend via accel, synthesize, and normalize
output to the renderer's Int16@24k mono contract. Process singleton, reused across
sessions; close() frees VRAM.

Three defects fixed here (spec §5.3, inventory §3):
  1. Model load/measure_rtf_tts, set_voice/set_builtin_voice, and one-shot generate()
     all ran synchronously on the single asyncio event loop this process' whole
     connection dispatch shares — every one-shot synthesis or (re)load stalled ASR/
     translate traffic on every OTHER connection too. All three now run in the
     default executor, mirroring translate_engine._h_translate's existing shape.
  2. tts_cancel only ever flipped a dict flag the STREAMING worker polled; a
     superseding tts_generate cancelled the old asyncio Task but not the executor
     thread actually running the backend's generation, so the old synthesis kept
     consuming the GPU. Both tts_cancel and a superseding tts_generate now ALSO call
     eng.cancel_active() -> backend.cancel(), which reaches the native session itself
     (see tts_backend.NativeTtsBackend.cancel). One-shot generation has no such hook:
     an offline family cannot be interrupted mid-run, so tts_cancel is a documented
     no-op while a one-shot request is in flight.
  3. _to_int16_24k_mono resampled with unantialiased linear interpolation whenever
     src_sr != target_sr (e.g. Supertonic 44100->24000). Now uses soxr, already a
     pinned dependency.
"""
import asyncio
import inspect
import queue
import time

import numpy as np
import soxr

TARGET_RATE = 24000


def _to_int16_24k_mono(samples, src_sr, target_sr=TARGET_RATE) -> bytes:
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim == 2:                       # (n, channels) -> mono, BEFORE resampling
        x = x.mean(axis=1)
    x = x.reshape(-1)
    if src_sr != target_sr and x.size:
        x = soxr.resample(x, src_sr, target_sr).astype(np.float32)
    x = np.clip(x, -1.0, 1.0)
    return (x * 32767.0).astype(np.int16).tobytes()


class TtsEngine:
    def __init__(self):
        self._backend = None
        self._native_sr = TARGET_RATE
        self.sample_rate = TARGET_RATE      # reported contract rate (always 24k)
        self.streaming = False
        self.clones = False
        self.model_id = None
        self.resolved = None

    @property
    def is_loaded(self) -> bool:
        return self._backend is not None

    def init(self, model_id=None, device="auto", language="", pin=None):
        from . import accel, catalog
        t0 = time.time()
        self.close()                        # VRAM hygiene: free any prior model first
        mid = model_id or "moss-tts-nano"
        plans = accel.resolve_tts(mid, override=device or "auto", pin=pin)
        self._backend, plan, notice, mem = accel.load_measured(plans, stage="tts")
        if hasattr(self._backend, "set_language"):
            self._backend.set_language(language or "")
        self._native_sr = getattr(self._backend, "sample_rate", TARGET_RATE)
        self.streaming = bool(getattr(self._backend, "STREAMING", False))
        self.clones = bool(getattr(self._backend, "CLONES", False))
        self.model_id = mid
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type,
                         "streaming": self.streaming, "clones": self.clones}
        rtf = accel.measure_rtf_tts(self._backend, plan, mid, accel.probe())
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        return int((time.time() - t0) * 1000)

    def set_voice(self, audio, sr, ref_text=None):
        # native_tts's set_voice always takes ref_text (spec's backend contract), but
        # the ONNX backends this engine still resolves to pre-Task-5 don't all agree:
        # MOSS/OmniVoice are clip-only (no ref_text parameter at all) while Qwen3/
        # CosyVoice3/GPT-SoVITS are ICL cloning. Signature-sniff until the catalog
        # rewire makes every resolvable backend uniform.
        wav = np.asarray(audio, dtype=np.float32)
        sr = int(sr)
        params = inspect.signature(self._backend.set_voice).parameters
        if "ref_text" in params:               # ICL cloning backend (e.g. Qwen3, native_tts)
            self._backend.set_voice(wav, sr, ref_text=ref_text or "")
        else:                                   # clip-only backend (e.g. MOSS) — no transcript arg
            self._backend.set_voice(wav, sr)

    def set_builtin_voice(self, name):
        self._backend.set_builtin_voice(name)

    def set_speaker(self, sid):
        # Still reachable pre-Task-5: the catalog doesn't route to native_tts until
        # then, and the ONNX sherpa_tts/moss_onnx/supertonic backends this engine
        # still resolves to today implement set_speaker (range or documented
        # no-op). native_tts has no equivalent (spec §5.3/§5.5 drops num_speakers
        # with the ONNX backends) -- dies together with this method once the
        # catalog no longer has anything that needs it.
        self._backend.set_speaker(int(sid))

    def set_style_voice(self, ttl, dp):
        # Same story as set_speaker: Supertonic-only, still live until the catalog
        # rewire (Task 5) and the renderer's styleVoice sender (Task 6) both land.
        self._backend.set_style_voice(ttl, dp)

    def list_builtin_voices(self):
        """Delegate to the loaded backend's own list_builtin_voices() when it has
        one. native_tts always does (it's `.presets()`); pre-Task-5, not every
        ONNX backend this engine can still resolve to agrees -- MOSS has no such
        method at all, and Qwen3/CosyVoice3/OmniVoice ship a stub that always
        returns [] (their own comments: "descriptors come from tts_voices...
        (manifest-based)"). A missing method degrades to [] rather than raising;
        tts_voices.py only reaches this once it already decided the loaded model
        is the one being asked about."""
        if hasattr(self._backend, "list_builtin_voices"):
            return self._backend.list_builtin_voices()
        return []

    def cancel_active(self) -> None:
        """Reach through to the loaded backend's own cancel() (see
        NativeTtsBackend.cancel's docstring) -- this is what actually stops native
        generation between chunks. state["tts_cancels"] (set by the callers of this
        method) is a separate, client-side flag: it only stops THIS process from
        relaying further chunks to the wire, and stays useful as a safety net
        independent of whatever the backend itself is doing."""
        backend = self._backend
        if backend is not None and hasattr(backend, "cancel"):
            try:
                backend.cancel()
            except Exception:
                pass

    def generate(self, text, speed=1.0):
        samples, gen_ms = self._backend.generate(text, speed)
        return _to_int16_24k_mono(samples, self._native_sr), gen_ms

    async def generate_stream(self, text, speed, send, should_cancel, msg_id):
        """Drive the backend's frame generator in a worker thread; push tts_chunk
        deltas (Int16@24k) via `send`, then tts_done. Cancellation is checked
        per chunk via should_cancel() -- a client-side stop that complements, but
        does not replace, cancel_active() reaching into the backend itself."""
        loop = asyncio.get_running_loop()
        q: "queue.Queue" = queue.Queue()
        SENTINEL = object()

        def worker():
            try:
                for chunk in self._backend.generate_stream(text, speed):
                    if should_cancel():
                        break
                    q.put(("chunk", chunk))
            except Exception as e:            # surface, then terminate the stream
                q.put(("error", str(e)))
            finally:
                q.put((SENTINEL, None))

        fut = loop.run_in_executor(None, worker)
        t0 = time.time()
        seq = 0
        total = 0
        while True:
            kind, payload = await loop.run_in_executor(None, q.get)
            if kind is SENTINEL:
                break
            if kind == "error":
                await send({"type": "error", "id": msg_id, "message": payload})
                break
            pcm = _to_int16_24k_mono(payload, self._native_sr)
            total += len(pcm) // 2
            await send({"type": "tts_chunk", "id": msg_id, "seq": seq}, binary=pcm)
            seq += 1
        await fut
        await send({"type": "tts_done", "id": msg_id, "totalSamples": total,
                    "generationTimeMs": int((time.time() - t0) * 1000)})

    def close(self):
        from . import accel
        accel.ledger_release("tts")
        backend = self._backend
        self._backend = None
        self.model_id = None
        if backend is not None:
            try:
                backend.unload()
            except Exception:
                pass


def _tts_teardown(state, conn):
    """Free this connection's TTS model when the connection closes.

    Reads the stream task from conn.ctx at close time: tts_generate creates it after
    tts_init registered this cleanup.
    """
    task = conn.ctx.get("tts_stream_task")
    if task is not None:
        task.cancel()
    eng = state.get("tts_engine")
    if eng is not None:
        try:
            eng.close()
        except Exception:
            pass


async def _h_tts_init(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    loop = asyncio.get_running_loop()
    # Off the event loop: model load (and the full synthesis measure_rtf_tts runs
    # inside it) must not stall this connection's ASR/translate traffic while it's
    # happening -- defect 1.
    #
    # Ownership-window caveat (ledgered slice-5 debt, not fixed here): eng.init()
    # calls close() on entry for VRAM hygiene, but that now runs off-loop too, so a
    # stale teardown from a PRIOR tts_init on this same connection could in
    # principle still be racing a fresh init's on_close registration below --
    # translate_engine's init/teardown pair has the same unfixed ownership window.
    ms = await loop.run_in_executor(
        None, lambda: eng.init(msg.get("model"), msg.get("device", "auto"),
                               msg.get("language", ""), pin=msg.get("variant")))
    # This connection owns the TTS model: closing it frees the model from VRAM.
    if conn is not None:
        conn.on_close(lambda: _tts_teardown(state, conn))
    reply = {"type": "ready", "id": msg.get("id"), "sampleRate": eng.sample_rate,
             "loadTimeMs": ms}
    if eng.resolved:
        reply.update(eng.resolved)
    return reply, None


async def _h_set_voice(state, msg, binary_in, conn=None):
    """Every branch is one of: a Supertonic style-vector pair, a built-in preset by
    name, a numeric speaker id (range models), or a custom clone from a reference
    clip (raw Float32 PCM in `binary_in`, optional refText). The style-vector and
    numeric-sid forms belong to backends native_tts doesn't have an equivalent for
    (spec §5.3/§5.5) -- they stay wired here because the catalog still resolves to
    the ONNX sherpa_tts/moss_onnx/supertonic backends until Task 5 rewires it onto
    native_tts, and the renderer still sends them until Task 6 removes those
    senders; this handler goes on serving whatever the loaded backend supports."""
    eng = state["tts_engine"]
    loop = asyncio.get_running_loop()
    style = msg.get("styleVoice")
    if style is not None:                     # Supertonic style-vector pair (ttl + dp)
        buf = np.frombuffer(binary_in or b"", dtype=np.float32)
        n = int(np.prod(style["ttlDims"]))
        ttl = buf[:n].reshape(style["ttlDims"]).astype(np.float32)
        dp = buf[n:n + int(np.prod(style["dpDims"]))].reshape(style["dpDims"]).astype(np.float32)
        await loop.run_in_executor(None, lambda: eng.set_style_voice(ttl, dp))
        return {"type": "ok", "id": msg.get("id")}, None
    name = msg.get("voice")
    sid = msg.get("sid")
    if name:                                  # built-in by name (no binary frame)
        await loop.run_in_executor(None, eng.set_builtin_voice, str(name))
    elif sid is not None:                     # numeric speaker id (range models)
        await loop.run_in_executor(None, eng.set_speaker, int(sid))
    else:                                      # custom clone from clip
        audio = np.frombuffer(binary_in, dtype=np.float32) if binary_in else np.zeros(0, np.float32)
        sr = int(msg.get("sampleRate", 24000))
        ref_text = msg.get("refText")
        await loop.run_in_executor(None, lambda: eng.set_voice(audio, sr, ref_text=ref_text))
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_tts_generate(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    loop = asyncio.get_running_loop()
    text = msg.get("text", "")
    speed = float(msg.get("speed", 1.0))
    mid = msg.get("id")
    if eng.streaming and conn is not None:
        cancels = state.setdefault("tts_cancels", {})
        # Cancel any prior in-flight stream on this connection (one active stream per
        # conn): flip its cancel flag AND reach into the backend's own cancel()
        # BEFORE detaching the asyncio Task -- cancelling only the Task stops it at
        # its next await, but the actual generation runs in a separate executor
        # thread that otherwise keeps consuming the GPU until the backend notices
        # (defect 2).
        prior = conn.ctx.get("tts_stream_task")
        if prior is not None and not prior.done():
            prior_mid = conn.ctx.get("tts_stream_mid")
            if prior_mid is not None:
                cancels[prior_mid] = True
            eng.cancel_active()
            prior.cancel()

        cancels[mid] = False

        async def _run_tts_stream():
            try:
                await eng.generate_stream(text, speed, conn.send,
                                          lambda: cancels.get(mid, False), mid)
            finally:
                cancels.pop(mid, None)
                if conn.ctx.get("tts_stream_task") is asyncio.current_task():
                    conn.ctx.pop("tts_stream_task", None)
                    conn.ctx.pop("tts_stream_mid", None)

        conn.ctx["tts_stream_task"] = asyncio.create_task(_run_tts_stream())
        conn.ctx["tts_stream_mid"] = mid
        return None, None                  # dispatched; read loop stays live for tts_cancel
    # One-shot generation cannot be interrupted mid-run (offline families run to
    # completion once started) -- off the event loop for the same reason init is
    # (defect 1); tts_cancel against it is a no-op by design (defect 2).
    pcm, gen_ms = await loop.run_in_executor(None, lambda: eng.generate(text, speed))
    reply = {"type": "tts_generate_result", "id": mid, "sampleRate": eng.sample_rate,
             "generationTimeMs": gen_ms, "samples": len(pcm) // 2}
    return reply, pcm


async def _h_tts_cancel(state, msg, _b, conn=None):
    cancels = state.get("tts_cancels") or {}
    mid = msg.get("id")
    if mid in cancels:
        cancels[mid] = True
    eng = state.get("tts_engine")
    if eng is not None:
        eng.cancel_active()
    return {"type": "ok", "id": mid}, None


async def _h_list_tts_voices(state, msg, _b, conn=None):
    from . import tts_voices
    voices = tts_voices.list_builtin_voices(msg.get("model"), state.get("tts_engine"))
    return {"type": "list_tts_voices_result", "id": msg.get("id"), "voices": voices}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"tts_init": _h_tts_init, "set_voice": _h_set_voice,
         "tts_generate": _h_tts_generate, "tts_cancel": _h_tts_cancel,
         "list_tts_voices": _h_list_tts_voices})
