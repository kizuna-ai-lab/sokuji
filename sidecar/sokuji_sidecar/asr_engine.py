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


def _build_sherpa(model_id):
    """sense-voice offline recognizer → returns recognize(samples16k_float32) -> str."""
    import sherpa_onnx
    from huggingface_hub import snapshot_download
    repo = model_id or os.environ.get(
        "SOKUJI_ASR_REPO", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    d = snapshot_download(repo_id=repo)
    rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt", use_itn=True)

    def recognize(samples16k):
        s = rec.create_stream()
        s.accept_waveform(TARGET_RATE, samples16k)
        rec.decode_stream(s)
        return s.result.text.strip()
    return recognize


def _build_faster_whisper(model_id, language):
    """faster-whisper (CTranslate2) recognizer. model id like whisper-tiny / whisper-large-v3."""
    from faster_whisper import WhisperModel
    size = model_id.replace("faster-whisper-", "").replace("whisper-", "") or "tiny"
    wm = WhisperModel(size, device="cpu", compute_type="int8")

    def recognize(samples16k):
        segments, _info = wm.transcribe(samples16k, language=language, beam_size=1, vad_filter=False)
        return "".join(s.text for s in segments).strip()
    return recognize


class AsrEngine:
    """silero VAD segmentation + a pluggable recognizer. Feed Int16 bytes, get text per VAD segment.

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

    def init(self, model_id=None, language="", sample_rate=SRC_RATE,
             vad_threshold=None, vad_min_silence=None, vad_min_speech=None):
        self._src_rate = int(sample_rate)  # actual renderer rate (AudioContext may be 48k, not 24k)
        import sherpa_onnx  # lazy: native lib pulled here
        t0 = time.time()
        # silero VAD — shared segmentation for both recognizer backends. Tunable
        # threshold / min-silence / min-speech mirror the LOCAL_INFERENCE VAD knobs;
        # unset values keep sherpa-onnx defaults.
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
        # recognizer is pluggable: model id containing "whisper" → faster-whisper, else sense-voice
        lang = language or None
        if model_id and "whisper" in model_id:
            self._recognize = _build_faster_whisper(model_id, lang)
        else:
            self._recognize = _build_sherpa(model_id)
        return int((time.time() - t0) * 1000)

    def _drain(self):
        out = []
        while not self._vad.empty():
            seg = self._vad.front
            samples = np.asarray(seg.samples, dtype=np.float32)
            t0 = time.time()
            text = self._recognize(samples)
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
                  msg.get("vadThreshold"), msg.get("vadMinSilenceDuration"), msg.get("vadMinSpeechDuration"))
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
