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


def _resolve_vad_model(model_dir):
    """Order: explicit SOKUJI_VAD_FILE → silero_vad.onnx shipped in the model dir →
    download the canonical file from the k2-fsa release into the HF cache."""
    explicit = os.environ.get("SOKUJI_VAD_FILE")
    if explicit and os.path.exists(explicit):
        return explicit
    bundled = f"{model_dir}/silero_vad.onnx"
    if os.path.exists(bundled):
        return bundled
    import urllib.request
    cache = os.path.join(
        os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface")), "sokuji-vad")
    os.makedirs(cache, exist_ok=True)
    dst = os.path.join(cache, "silero_vad.onnx")
    if not os.path.exists(dst):
        urllib.request.urlretrieve(VAD_URL, dst)
    return dst


class AsrEngine:
    """sherpa-onnx VAD + offline recognition. Feed Int16@24k bytes, get text per VAD segment.

    The silero VAD must be fed in fixed window_size (512-sample @16k) chunks, so feed()
    buffers the downsampled audio and only consumes whole windows; the remainder carries
    over to the next feed().
    """

    def __init__(self):
        self._vad = None
        self._rec = None
        self._window = 512
        self._buf = np.zeros(0, np.float32)
        self._src_rate = SRC_RATE

    def init(self, model_id=None, language="", sample_rate=SRC_RATE):
        self._src_rate = int(sample_rate)  # actual renderer rate (AudioContext may be 48k, not 24k)
        import sherpa_onnx  # lazy: native lib pulled here
        from huggingface_hub import snapshot_download
        t0 = time.time()
        repo = model_id or os.environ.get(
            "SOKUJI_ASR_REPO", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        d = snapshot_download(repo_id=repo)
        vad_cfg = sherpa_onnx.VadModelConfig()
        vad_cfg.silero_vad.model = _resolve_vad_model(d)
        vad_cfg.sample_rate = TARGET_RATE
        self._window = vad_cfg.silero_vad.window_size
        self._buf = np.zeros(0, np.float32)
        self._vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=30)
        self._rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt", use_itn=True)
        return int((time.time() - t0) * 1000)

    def _drain(self):
        out = []
        while not self._vad.empty():
            seg = self._vad.front
            stream = self._rec.create_stream()
            stream.accept_waveform(TARGET_RATE, seg.samples)
            t0 = time.time()
            self._rec.decode_stream(stream)
            text = stream.result.text.strip()
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
    ms = eng.init(msg.get("model"), msg.get("language", ""), msg.get("sampleRate", SRC_RATE))
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
