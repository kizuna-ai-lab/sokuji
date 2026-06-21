import json, os, time
import numpy as np
from . import pocket_bundle as pb
from . import pocket_inference as pi
from .pocket_tokenizer import PocketTokenizer


class PocketEngine:
    sample_rate = pb.SAMPLE_RATE

    def __init__(self):
        self._sessions = None
        self._meta = None
        self._bos = None
        self._tok = None
        self._flow = None

    def init(self, model_dir=None):
        t0 = time.time()
        d = pb.resolve_bundle_dir(model_dir)
        self._sessions = pi.load_sessions(d, int(os.environ.get("POCKET_NATIVE_THREADS", "2")))
        self._meta = json.load(open(f"{d}/{pb.METADATA_FILE}"))
        self._bos = (pb.parse_npy_float32(f"{d}/{pb.BOS_FILE}")
                     if self._meta.get("insert_bos_before_voice") else None)
        self._tok = PocketTokenizer(f"{d}/{pb.TOKENIZER_FILE}")
        return int((time.time() - t0) * 1000)

    def set_voice(self, audio: np.ndarray, sr: int):
        ref = pi.resample_to_24k(audio, sr)
        emb = pi.encode_reference(self._sessions, ref)
        self._flow = pi.build_voice_conditioned_state(self._sessions, self._meta, emb, self._bos)

    def generate(self, text: str, speed: float = 1.0):
        if self._flow is None:
            raise RuntimeError("no reference voice set")
        t0 = time.time()
        ids = np.array(self._tok.encode_ids(text), np.int64).reshape(1, -1)
        tc = self._sessions["textConditioner"].run(None, {"token_ids": ids})[0]
        out = pi.generate(self._sessions, self._meta, tc, self._flow,
                          lsd_steps=pb.DEFAULT_LSD_STEPS, max_frames=pb.DEFAULT_MAX_FRAMES)
        return out, int((time.time() - t0) * 1000)


async def _h_init(state, msg, _b):
    ms = state["engine"].init(msg.get("modelDir"))
    return {"type": "ready", "id": msg.get("id"),
            "sampleRate": state["engine"].sample_rate, "loadTimeMs": ms}, None


async def _h_set_voice(state, msg, binary_in):
    audio = np.frombuffer(binary_in, dtype=np.float32)
    state["engine"].set_voice(audio, int(msg.get("sampleRate", pb.SAMPLE_RATE)))
    return {"type": "ok", "id": msg.get("id")}, None


async def _h_generate(state, msg, _b):
    samples, gen_ms = state["engine"].generate(msg.get("text", ""), float(msg.get("speed", 1.0)))
    pcm = np.ascontiguousarray(samples, dtype=np.float32).tobytes()
    reply = {"type": "result", "id": msg.get("id"), "sampleRate": state["engine"].sample_rate,
             "generationTimeMs": gen_ms, "samples": int(len(samples))}
    return reply, pcm


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"init": _h_init, "set_voice": _h_set_voice, "generate": _h_generate})
