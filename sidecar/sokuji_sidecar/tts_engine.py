"""TTS stage: resolve a backend (sherpa one-shot or MOSS streaming) via accel,
synthesize, and normalize output to the renderer's Int16@24k mono contract.
Process singleton, reused across sessions; close() frees VRAM."""
import asyncio
import inspect
import queue
import time

import numpy as np

from . import tts_backends  # noqa: F401 — registers sherpa_tts/moss_onnx backends

TARGET_RATE = 24000


def _to_int16_24k_mono(samples, src_sr, target_sr=TARGET_RATE) -> bytes:
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim == 2:                       # (n, channels) -> mono
        x = x.mean(axis=1)
    x = x.reshape(-1)
    if src_sr != target_sr and x.size:
        ratio = target_sr / float(src_sr)
        n = int(round(x.size * ratio))
        pos = np.arange(n, dtype=np.float64) / ratio
        i0 = np.floor(pos).astype(np.int64)
        frac = (pos - i0).astype(np.float32)
        a = x[np.clip(i0, 0, x.size - 1)]
        b = x[np.clip(i0 + 1, 0, x.size - 1)]
        x = a + (b - a) * frac
    x = np.clip(x, -1.0, 1.0)
    return (x * 32767.0).astype(np.int16).tobytes()


class TtsEngine:
    def __init__(self):
        self._backend = None
        self._native_sr = TARGET_RATE
        self.sample_rate = TARGET_RATE      # reported contract rate (always 24k)
        self.streaming = False
        self.clones = False
        self.resolved = None

    def init(self, model_id=None, device="auto", language=""):
        from . import accel, catalog, planner
        t0 = time.time()
        self.close()                        # VRAM hygiene: free any prior model first
        mid = model_id or "moss-tts-nano"
        plans = planner.resolve_tts(mid, override=device or "auto")
        self._backend, plan, notice, mem = accel.load_measured(plans, stage="tts")
        if hasattr(self._backend, "set_language"):
            self._backend.set_language(language or "")
        self._native_sr = getattr(self._backend, "sample_rate", TARGET_RATE)
        self.streaming = bool(getattr(self._backend, "STREAMING", False))
        self.clones = bool(getattr(self._backend, "CLONES", False))
        rtf = accel.measure_rtf_tts(self._backend, plan, mid, accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type,
                         "streaming": self.streaming, "clones": self.clones}
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
        return int((time.time() - t0) * 1000)

    def set_voice(self, audio, sr, ref_text=None):
        wav = np.asarray(audio, dtype=np.float32)
        sr = int(sr)
        params = inspect.signature(self._backend.set_voice).parameters
        if "ref_text" in params:               # ICL cloning backend (e.g. Qwen3)
            self._backend.set_voice(wav, sr, ref_text=ref_text or "")
        else:                                   # clip-only backend (e.g. MOSS) — no transcript arg
            self._backend.set_voice(wav, sr)

    def set_builtin_voice(self, name):
        self._backend.set_builtin_voice(name)

    def set_speaker(self, sid):
        self._backend.set_speaker(int(sid))

    def set_style_voice(self, ttl, dp):
        self._backend.set_style_voice(ttl, dp)

    def generate(self, text, speed=1.0):
        samples, gen_ms = self._backend.generate(text, speed)
        return _to_int16_24k_mono(samples, self._native_sr), gen_ms

    async def generate_stream(self, text, speed, send, should_cancel, msg_id):
        """Drive the backend's frame generator in a worker thread; push tts_chunk
        deltas (Int16@24k) via `send`, then tts_done. Cancellation is checked
        per chunk via should_cancel()."""
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
        if backend is not None:
            try:
                backend.unload()
            except Exception:
                pass


async def _h_tts_init(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    ms = eng.init(msg.get("model"), msg.get("device", "auto"), msg.get("language", ""))
    if conn is not None:
        conn.ctx["owns_tts"] = True
    reply = {"type": "ready", "id": msg.get("id"), "sampleRate": eng.sample_rate,
             "loadTimeMs": ms}
    if eng.resolved:
        reply.update(eng.resolved)
    return reply, None


async def _h_set_voice(state, msg, binary_in, conn=None):
    style = msg.get("styleVoice")
    if style is not None:                     # Supertonic style-vector pair (ttl + dp)
        buf = np.frombuffer(binary_in or b"", dtype=np.float32)
        n = int(np.prod(style["ttlDims"]))
        ttl = buf[:n].reshape(style["ttlDims"]).astype(np.float32)
        dp = buf[n:n + int(np.prod(style["dpDims"]))].reshape(style["dpDims"]).astype(np.float32)
        state["tts_engine"].set_style_voice(ttl, dp)
        return {"type": "ok", "id": msg.get("id")}, None
    name = msg.get("voice")
    sid = msg.get("sid")
    if name:                                  # built-in by name (no binary frame)
        state["tts_engine"].set_builtin_voice(str(name))
    elif sid is not None:                     # numeric speaker id (range models)
        state["tts_engine"].set_speaker(int(sid))
    else:                                     # custom clone from clip
        audio = np.frombuffer(binary_in, dtype=np.float32) if binary_in else np.zeros(0, np.float32)
        state["tts_engine"].set_voice(audio, int(msg.get("sampleRate", 24000)),
                                      ref_text=msg.get("refText"))
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_tts_generate(state, msg, _b, conn=None):
    eng = state["tts_engine"]
    text = msg.get("text", "")
    speed = float(msg.get("speed", 1.0))
    mid = msg.get("id")
    if eng.streaming and conn is not None:
        # Cancel any prior in-flight stream on this connection (one active stream per conn)
        prior = conn.ctx.get("tts_stream_task")
        if prior is not None and not prior.done():
            prior.cancel()

        cancels = state.setdefault("tts_cancels", {})
        cancels[mid] = False

        async def _run_tts_stream():
            try:
                await eng.generate_stream(text, speed, conn.send,
                                          lambda: cancels.get(mid, False), mid)
            finally:
                cancels.pop(mid, None)
                if conn.ctx.get("tts_stream_task") is asyncio.current_task():
                    conn.ctx.pop("tts_stream_task", None)

        conn.ctx["tts_stream_task"] = asyncio.create_task(_run_tts_stream())
        return None, None                  # dispatched; read loop stays live for tts_cancel
    pcm, gen_ms = eng.generate(text, speed)
    reply = {"type": "result", "id": mid, "sampleRate": eng.sample_rate,
             "generationTimeMs": gen_ms, "samples": len(pcm) // 2}
    return reply, pcm


async def _h_tts_cancel(state, msg, _b, conn=None):
    cancels = state.get("tts_cancels") or {}
    if msg.get("id") in cancels:
        cancels[msg.get("id")] = True
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_list_tts_voices(state, msg, _b, conn=None):
    from . import tts_voices
    voices = tts_voices.list_builtin_voices(msg.get("model"))
    return {"type": "list_tts_voices_result", "id": msg.get("id"), "voices": voices}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"tts_init": _h_tts_init, "set_voice": _h_set_voice,
         "tts_generate": _h_tts_generate, "tts_cancel": _h_tts_cancel,
         "list_tts_voices": _h_list_tts_voices})
