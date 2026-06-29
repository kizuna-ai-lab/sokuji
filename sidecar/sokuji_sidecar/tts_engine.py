"""TTS stage: resolve a backend (sherpa one-shot or MOSS streaming) via accel,
synthesize, and normalize output to the renderer's Int16@24k mono contract.
Process singleton, reused across sessions; close() frees VRAM."""
import asyncio
import queue
import time

import numpy as np

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
        from . import accel, catalog
        t0 = time.time()
        self.close()                        # VRAM hygiene: free any prior model first
        mid = model_id or "moss-tts-nano"
        plans = accel.resolve_tts(mid, override=device or "auto")
        self._backend, plan, notice, mem = accel.load_measured(plans)
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

    def set_voice(self, audio, sr):
        self._backend.set_voice(np.asarray(audio, dtype=np.float32), int(sr))

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
        backend = self._backend
        self._backend = None
        if backend is not None:
            try:
                backend.unload()
            except Exception:
                pass
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass
