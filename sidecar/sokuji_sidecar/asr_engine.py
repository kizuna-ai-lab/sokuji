import os, time
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
        self._init_vad(sample_rate, vad_threshold, vad_min_silence, vad_min_speech)
        # Resolve the fastest available backend+device; CPU floor guaranteed.
        plans = accel.resolve(model_id or "sense-voice", override=device or "auto")
        self._backend, plan, _notice = accel.load_with_fallback(plans)
        self._language = language or None
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        return int((time.time() - t0) * 1000)

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


async def _h_asr_init(state, msg, _b, conn=None):
    eng = state["asr_engine"]
    ms = eng.init(msg.get("model"), msg.get("language", ""), msg.get("sampleRate", SRC_RATE),
                  msg.get("vadThreshold"), msg.get("vadMinSilenceDuration"),
                  msg.get("vadMinSpeechDuration"), msg.get("device", "auto"))
    if conn is not None:
        conn.ctx["on_binary"] = eng.feed   # route subsequent binary frames to the recognizer
    return {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}, None


async def _h_asr_flush(state, msg, _b, conn=None):
    for out in state["asr_engine"].flush():
        if conn is not None:
            await conn.send(out)
    return {"type": "ok", "id": msg.get("id")}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"asr_init": _h_asr_init, "asr_flush": _h_asr_flush})
