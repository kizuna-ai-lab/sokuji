"""TTS stage dispatcher. init.model containing 'piper'/'vits' -> non-cloning
sherpa-onnx OfflineTts; else -> Pocket (voice cloning, needs set_voice). Both
backends expose generate(text, speed) -> (np.float32 samples, gen_ms) and
.sample_rate. Reuses the Phase 1 TTS WS protocol (init/set_voice/generate)."""
import numpy as np


def _is_piper(model):
    return bool(model) and ("piper" in model or "vits" in model)


class TtsEngine:
    def __init__(self):
        self._backend = None
        self.sample_rate = 24000

    def init(self, model=None):
        if _is_piper(model):
            from .sherpa_tts import SherpaPiperTts
            self._backend = SherpaPiperTts()
            ms = self._backend.init(model)
        else:
            from .pocket_engine import PocketEngine
            self._backend = PocketEngine()
            ms = self._backend.init()
        self.sample_rate = self._backend.sample_rate
        return ms

    def set_voice(self, audio, sr):
        self._backend.set_voice(np.asarray(audio, dtype=np.float32), sr)

    def generate(self, text, speed=1.0):
        return self._backend.generate(text, speed)


async def _h_init(state, msg, _b, conn=None):
    ms = state["engine"].init(msg.get("model"))
    return {"type": "ready", "id": msg.get("id"),
            "sampleRate": state["engine"].sample_rate, "loadTimeMs": ms}, None


async def _h_set_voice(state, msg, binary_in, conn=None):
    audio = np.frombuffer(binary_in, dtype=np.float32)
    state["engine"].set_voice(audio, int(msg.get("sampleRate", 24000)))
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_generate(state, msg, _b, conn=None):
    samples, gen_ms = state["engine"].generate(msg.get("text", ""), float(msg.get("speed", 1.0)))
    pcm = np.ascontiguousarray(samples, dtype=np.float32).tobytes()
    reply = {"type": "result", "id": msg.get("id"), "sampleRate": state["engine"].sample_rate,
             "generationTimeMs": gen_ms, "samples": int(len(samples))}
    return reply, pcm


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"init": _h_init, "set_voice": _h_set_voice, "generate": _h_generate})
