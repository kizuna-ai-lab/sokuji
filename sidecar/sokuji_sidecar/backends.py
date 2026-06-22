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


@register_backend
class CTranslate2Backend:
    """faster-whisper (CTranslate2). model_ref is a Whisper size like 'tiny' or
    'large-v3'; faster-whisper resolves it to the matching Systran CT2 repo."""
    NAME = "ctranslate2"

    def __init__(self):
        self._m = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        from faster_whisper import WhisperModel
        try:
            self._m = WhisperModel(model_ref, device=device, compute_type=compute_type)
        except Exception as e:  # bad device/compute → let the resolver fall back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        segments, _info = self._m.transcribe(
            samples, language=language, beam_size=1, vad_filter=False)
        return AsrResult("".join(s.text for s in segments).strip(), language)

    def unload(self) -> None:
        self._m = None

    @property
    def is_loaded(self) -> bool:
        return self._m is not None
