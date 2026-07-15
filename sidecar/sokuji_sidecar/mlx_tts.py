"""macOS MLX TTS backend (spec D5): Qwen3-TTS and MOSS-TTS-Nano on Apple
Silicon via the mlx-audio package. Registered under the NAME "mlx_audio_tts".

mlx-audio's Model.generate() is a generator that yields audio chunks; this
backend adapts those chunks to the shared TTS streaming contract (generate /
generate_stream + set_voice / set_builtin_voice / set_speaker / set_language /
sample_rate), so tts_engine drives it exactly like the ONNX streaming backends.

mlx-audio is an Apple-Silicon-only (Metal) wheel. It is imported LAZILY inside
load(), so importing this module on the Linux/Windows dev venv never touches it;
load() raises BackendLoadError when the wheel is absent, which the accel
resolver treats as a normal fallback to the ONNX cpu row."""
import os
import tempfile
import time

import numpy as np

from .backends import register_backend, BackendLoadError

# Short id -> mlx-community HF repo. Unknown ids (the usual case: the catalog
# Deployment.artifact already IS the mlx-community repo) pass straight through.
MLX_TTS_REPOS: dict[str, str] = {}


def _extract_samples(chunk) -> np.ndarray:
    """Adapt one mlx-audio generation chunk to a 1-D float32 numpy array.

    mlx-audio's generate() yields GenerationResult-like objects; across releases
    the audio payload has appeared under `.audio` (an mlx array), with `.samples`
    / `.wav` as aliases, and the object is sometimes the raw array itself. This
    single function is the seam to fix if the real attribute name — or the
    mlx->numpy conversion (a live mlx array may need mx.eval()/np.array()) —
    differs on Apple hardware. See the deferred mac checklist."""
    data = chunk
    for attr in ("audio", "samples", "wav"):
        val = getattr(chunk, attr, None)
        if val is not None:
            data = val
            break
    return np.asarray(data, dtype=np.float32).reshape(-1)


@register_backend
class MlxAudioTtsBackend:
    NAME = "mlx_audio_tts"
    STREAMING = True
    CLONES = True

    def __init__(self):
        self._model = None
        self._voice = None        # builtin voice name OR a staged reference-clip path
        self._ref_path = None     # temp wav backing a clip clone (cleaned on unload)
        self._ref_text = ""       # reference transcript (ICL) — stored; see checklist
        self._lang = ""
        self.sample_rate = 24000

    # ---- loading -----------------------------------------------------------
    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self._model = None
        try:
            from mlx_audio.tts.utils import load_model
            repo = MLX_TTS_REPOS.get(model_ref, model_ref)
            # The repo is pre-downloaded by native_models; load_model resolves it
            # from the HF cache. device/compute_type are ignored — mlx runs Metal.
            self._model = load_model(repo)
            self.sample_rate = int(getattr(self._model, "sample_rate", 24000) or 24000)
        except Exception as e:  # missing wheel / not Apple Silicon / bad repo → resolver falls back
            self._model = None
            raise BackendLoadError(str(e))

    # ---- voice / language --------------------------------------------------
    def set_language(self, lang) -> None:
        self._lang = lang or ""

    def set_speaker(self, sid) -> None:
        pass  # mlx voices are named, not a numeric speaker range

    def set_builtin_voice(self, name: str) -> None:
        self._clear_ref_file()
        self._voice = str(name)
        self._ref_text = ""

    def set_voice(self, audio, sr, ref_text: str = "") -> None:
        """Zero-shot clone: mlx-audio takes a reference-clip PATH as `voice`, so
        stage the clip to a temp float32 wav and point `voice` at it. The
        reference transcript is stored for ICL models but NOT yet threaded into
        generate() (mlx-audio's documented signature is text/voice/speed) — see
        the deferred mac checklist."""
        import soundfile
        wav = np.asarray(audio, dtype=np.float32)
        if wav.ndim > 1:
            # Reference clips reach set_voice channel-first ([channels, samples]),
            # matching MOSS._encode_reference and Qwen3TtsOnnxBackend.set_voice —
            # average over the CHANNEL axis (0), not the sample/time axis.
            wav = wav.mean(axis=0).astype(np.float32)
        self._clear_ref_file()
        fd, path = tempfile.mkstemp(prefix="sokuji_mlx_ref_", suffix=".wav")
        os.close(fd)
        # Track the temp path BEFORE writing so a soundfile.write failure can't
        # leak it — the next _clear_ref_file()/unload() then removes it.
        self._ref_path = path
        soundfile.write(path, wav, int(sr))
        self._voice = path
        self._ref_text = ref_text or ""

    def _gen_kwargs(self, text, speed) -> dict:
        kw = {"text": str(text or ""), "speed": float(speed)}
        if self._voice is not None:
            kw["voice"] = self._voice
        return kw

    # ---- synthesis ---------------------------------------------------------
    def generate(self, text, speed=1.0):
        t0 = time.time()
        parts = [_extract_samples(c)
                 for c in self._model.generate(**self._gen_kwargs(text, speed))]
        parts = [p for p in parts if p.size]
        # _extract_samples already returns float32 and np.concatenate preserves
        # it, so `full` is float32 — no redundant astype copy of the whole clip.
        full = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
        return full, int((time.time() - t0) * 1000)

    def generate_stream(self, text, speed=1.0):
        for chunk in self._model.generate(**self._gen_kwargs(text, speed)):
            samples = _extract_samples(chunk)
            if samples.size:
                yield samples

    # ---- lifecycle ---------------------------------------------------------
    def _clear_ref_file(self) -> None:
        if self._ref_path:
            try:
                os.remove(self._ref_path)
            except OSError:
                pass
            self._ref_path = None

    def unload(self) -> None:
        self._model = None
        self._clear_ref_file()
        self._voice = None
        self._ref_text = ""

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
