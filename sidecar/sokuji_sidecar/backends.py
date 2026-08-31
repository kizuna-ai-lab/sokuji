"""ASR backend adapters: one class per inference framework, all sharing the
load()/transcribe()/unload() contract. The only code that touches a framework's
real API. Heavy frameworks are imported lazily inside load()."""
from dataclasses import dataclass


@dataclass
class AsrResult:
    text: str
    language: str | None = None


class BackendLoadError(Exception):
    """A backend could not honor (device, compute_type). Drives the resolver's
    fallback to the next plan."""
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_BACKENDS: dict[str, type] = {}


def register_backend(cls):
    """Class decorator: register a backend under its NAME for make_backend()."""
    _BACKENDS[cls.NAME] = cls
    return cls


def make_backend(name: str):
    """Instantiate the backend registered under `name`."""
    cls = _BACKENDS.get(name)
    if cls is None:
        raise BackendLoadError(f"unknown backend: {name}")
    return cls()


TARGET_RATE = 16000


# Import at module bottom (after the registry + base classes exist) so the
# native ASR/translate/TTS backends self-register for make_backend() in
# production, where nothing else imports these modules explicitly.
from . import asr_backend  # noqa: E402,F401
from . import translate_backend  # noqa: E402,F401
from . import tts_backend  # noqa: E402,F401
# The nine ONNX/sherpa/MLX TTS backends (sherpa_tts, moss_onnx, supertonic,
# qwen3tts_onnx, cosyvoice3_onnx, omnivoice_onnx, gpt_sovits_onnx, pocket_onnx,
# mlx_audio_tts) still back every TTS catalog row until Task 5 rewires the
# catalog onto native_tts — this import (moved here from tts_engine.py's old
# top-level `from . import tts_backends`) is what registers them for
# make_backend(); without it every tts_init fails AllPlansFailed. Deleted in
# Task 5 with the module.
from . import tts_backends  # noqa: E402,F401
