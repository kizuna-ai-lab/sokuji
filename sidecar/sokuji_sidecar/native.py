"""The sidecar's one door to sokuji_native (spec §5.2). Lazily imports the wheel, calls
sk_init exactly once per process with the SOKUJI_NATIVE_THREADS policy (0 = native policy,
i.e. min(hardware_concurrency, a measured knee) — no longer raw hardware concurrency, see
sk_init_options.n_threads's doc in sokuji_native.h for why) and a log sink into `logging`,
and answers device questions. Every other module goes through here; none imports
sokuji_native directly (test_torch_free_gate keeps that honest from slice 5 on)."""
import logging
import os
import threading

from .backends import BackendLoadError

_log = logging.getLogger("sokuji_native")
_LEVELS = {0: logging.DEBUG, 1: logging.INFO, 2: logging.WARNING, 3: logging.ERROR}
_lock = threading.Lock()
_module = None


def _sink(level: int, message: str) -> None:
    _log.log(_LEVELS.get(int(level), logging.INFO), "%s", message)


def module():
    """The initialised sokuji_native module. ImportError when the wheel is absent — callers
    that must degrade (accel.probe) wrap it in _safe; backends turn it into BackendLoadError."""
    global _module
    with _lock:
        if _module is None:
            import sokuji_native  # the wheel; heavy, so only on first use
            sokuji_native.init(n_threads=int(os.environ.get("SOKUJI_NATIVE_THREADS", "0") or 0), log=_sink)
            _module = sokuji_native
        return _module


def devices() -> list:
    return list(module().devices())


def device_for(kind: str):
    """The first device of `kind` ("cpu" | "vulkan" | "metal"), or BackendLoadError — the
    resolver then falls back to the next plan."""
    for d in devices():
        if d.kind == kind:
            return d
    raise BackendLoadError(f"no {kind} device in this process")


def reset_for_tests() -> None:
    global _module
    with _lock:
        _module = None
