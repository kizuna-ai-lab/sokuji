"""Non-cloning TTS via sherpa-onnx OfflineTts (VITS / piper). No reference clip.

Model files (model.onnx + tokens.txt + espeak-ng-data/) are resolved with
huggingface_hub and auto-discovered in the snapshot dir, so any sherpa-onnx
vits-piper repo works by id. Validated: csukuangfj/vits-piper-en_US-amy-low,
RTF ~31x, 16 kHz output (the renderer resamples to 24 kHz).
"""
import os
import time

import numpy as np

# short id -> HF repo (unknown ids are treated as a repo id directly)
PIPER_REPOS = {
    "piper-en-amy": "csukuangfj/vits-piper-en_US-amy-low",
    "piper-en-libritts": "csukuangfj/vits-piper-en_US-libritts_r-medium",
}


class SherpaPiperTts:
    def __init__(self):
        self._tts = None
        self.sample_rate = 16000

    def init(self, model):
        import sherpa_onnx
        from huggingface_hub import snapshot_download
        t0 = time.time()
        repo = PIPER_REPOS.get(model, model)
        d = snapshot_download(repo_id=repo, local_files_only=True)
        onnx = next(f for f in os.listdir(d)
                    if f.endswith(".onnx") and not f.endswith(".onnx.json"))
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=f"{d}/{onnx}", tokens=f"{d}/tokens.txt",
                    data_dir=f"{d}/espeak-ng-data"),
                num_threads=int(os.environ.get("POCKET_NATIVE_THREADS", "2")), provider="cpu"),
            max_num_sentences=1)
        self._tts = sherpa_onnx.OfflineTts(cfg)
        self.sample_rate = self._tts.sample_rate
        return int((time.time() - t0) * 1000)

    def set_voice(self, audio, sr):
        pass  # non-cloning: no reference voice

    def generate(self, text, speed=1.0):
        t0 = time.time()
        audio = self._tts.generate(text, sid=0, speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), int((time.time() - t0) * 1000)
