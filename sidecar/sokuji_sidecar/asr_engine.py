import os, time
import numpy as np

TARGET_RATE = 16000
SRC_RATE = 24000


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


class AsrEngine:
    """sherpa-onnx VAD + offline recognition. Feed Int16@24k bytes, get text per VAD segment."""

    def __init__(self):
        self._vad = None
        self._rec = None

    def init(self, model_id=None, language=""):
        import sherpa_onnx  # lazy: native lib pulled here
        from huggingface_hub import snapshot_download
        t0 = time.time()
        repo = model_id or os.environ.get(
            "SOKUJI_ASR_REPO", "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        d = snapshot_download(repo_id=repo)
        vad_cfg = sherpa_onnx.VadModelConfig()
        local_vad = f"{d}/silero_vad.onnx"
        vad_cfg.silero_vad.model = local_vad if os.path.exists(local_vad) \
            else snapshot_download("csukuangfj/sherpa-onnx-vad") + "/silero_vad.onnx"
        vad_cfg.sample_rate = TARGET_RATE
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
        samples = _downsample_int16_to_f32_16k(int16_bytes)
        out = []
        was_detected = self._vad.is_speech_detected()
        self._vad.accept_waveform(samples)
        if not was_detected and self._vad.is_speech_detected():
            out.append({"type": "speech_start"})
        out.extend(self._drain())
        return out

    def flush(self):
        self._vad.flush()
        return self._drain()


async def _h_asr_init(state, msg, _b, conn=None):
    eng = state["asr_engine"]
    ms = eng.init(msg.get("model"), msg.get("language", ""))
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
