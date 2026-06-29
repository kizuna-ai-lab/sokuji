"""TTS backend adapters, registered into the shared `backends` registry so the
accel resolver (load_with_fallback) can load them. Contract adds set_voice /
generate / generate_stream on top of load/unload; load_with_fallback only calls
load(), so sharing the registry is safe."""
import os
import time

import numpy as np

from .backends import register_backend, BackendLoadError

# short id -> HF repo (unknown ids are treated as a repo id directly)
SHERPA_TTS_REPOS = {
    "piper-en-amy": "csukuangfj/vits-piper-en_US-amy-low",
}


@register_backend
class SherpaTtsBackend:
    """Non-cloning, one-shot sherpa-onnx OfflineTts. Currently builds a VITS
    config (piper / icefall-zh). Matcha/Kokoro families add their config branch
    here later. provider='cuda' when device=cuda (GPU build), else 'cpu'."""
    NAME = "sherpa_tts"
    STREAMING = False
    CLONES = False

    def __init__(self):
        self._tts = None
        self.sample_rate = 16000

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._tts = None
        try:
            import sherpa_onnx
            from huggingface_hub import snapshot_download
            repo = SHERPA_TTS_REPOS.get(model_ref, model_ref)
            d = snapshot_download(repo_id=repo, local_files_only=True)
            onnx = next(f for f in os.listdir(d)
                        if f.endswith(".onnx") and not f.endswith(".onnx.json"))
            provider = "cuda" if device == "cuda" else "cpu"
            data_dir = f"{d}/espeak-ng-data"
            vits = sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{d}/{onnx}", tokens=f"{d}/tokens.txt",
                data_dir=data_dir if os.path.isdir(data_dir) else "")
            # Chinese vits ships lexicon/dict instead of espeak-ng-data.
            if not os.path.isdir(data_dir) and os.path.exists(f"{d}/lexicon.txt"):
                vits.lexicon = f"{d}/lexicon.txt"
                if os.path.isdir(f"{d}/dict"):
                    vits.dict_dir = f"{d}/dict"
            cfg = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    vits=vits,
                    num_threads=int(os.environ.get("SOKUJI_TTS_THREADS", "4")),
                    provider=provider),
                max_num_sentences=1)
            self._tts = sherpa_onnx.OfflineTts(cfg)
            self.sample_rate = self._tts.sample_rate
        except Exception as e:  # missing wheel / no GPU / bad repo → resolver falls back
            raise BackendLoadError(str(e))

    def set_voice(self, audio, sr):
        pass  # non-cloning

    def generate(self, text, speed=1.0):
        t0 = time.time()
        audio = self._tts.generate(text, sid=0, speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), int((time.time() - t0) * 1000)

    def unload(self) -> None:
        self._tts = None

    @property
    def is_loaded(self) -> bool:
        return self._tts is not None
