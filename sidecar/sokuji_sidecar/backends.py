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
