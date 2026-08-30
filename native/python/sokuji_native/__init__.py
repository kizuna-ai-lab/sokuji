"""sokuji_native — the sidecar's one native dependency.

Loads libsokuji_native from the packaged _native/ directory (or SOKUJI_NATIVE_DIR for a
development tree), refuses a contract.json whose ABI differs from _ffi.SK_ABI_VERSION,
and exposes the C surface as plain Python. Slices 2–4 add asr / vad / translate / tts."""
from __future__ import annotations

import ctypes
import json
import os
import pathlib
import platform
import threading
from dataclasses import dataclass

from . import _ffi

__all__ = ["NativeError", "Device", "init", "devices", "device_free_mem", "version",
           "engine_versions", "contract", "audio_families", "native_dir"]


class NativeError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"{message} (status {status})")
        self.status = status


@dataclass(frozen=True)
class Device:
    index: int
    kind: str
    name: str
    description: str
    mem_total: int
    mem_free: int


_lock = threading.Lock()
_lib: ctypes.CDLL | None = None
_contract: dict | None = None
_dll_dir = None          # Windows: os.add_dll_directory() handle — the directory is on the search path only while it lives
_initialised = False     # sk_init succeeded once in this process; later init() calls return without calling native
_log_refs: list = []     # the one trampoline sk_init installed; native keeps it forever, so it may never be collected


def native_dir() -> pathlib.Path:
    override = os.environ.get("SOKUJI_NATIVE_DIR")
    return pathlib.Path(override) if override else pathlib.Path(__file__).parent / "_native"


def _check_contract(path: pathlib.Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("abi") != _ffi.SK_ABI_VERSION:
        raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT,
                          f"contract.json ABI {data.get('abi')} != binding ABI {_ffi.SK_ABI_VERSION}")
    return data


def _library_name() -> str:
    system = platform.system()
    if system == "Windows":
        return "sokuji_native.dll"
    if system == "Darwin":
        return "libsokuji_native.dylib"
    return "libsokuji_native.so"


def _load() -> ctypes.CDLL:
    global _lib, _contract, _dll_dir
    with _lock:
        if _lib is not None:
            return _lib
        d = native_dir()
        _contract = _check_contract(d / "contract.json")
        if platform.system() == "Windows":
            _dll_dir = os.add_dll_directory(str(d))
        lib = _ffi.bind(ctypes.CDLL(str(d / _library_name())))
        if lib.sk_abi_version() != _ffi.SK_ABI_VERSION:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT,
                              f"library ABI {lib.sk_abi_version()} != binding ABI {_ffi.SK_ABI_VERSION}")
        _lib = lib
        return lib


def _raise(lib: ctypes.CDLL, status: int, what: str) -> None:
    msg = (lib.sk_last_error() or b"").decode("utf-8", "replace")
    raise NativeError(status, f"{what}: {msg or 'unknown error'}")


def contract() -> dict:
    _load()
    return dict(_contract or {})


def version() -> str:
    return _load().sk_version().decode()


def engine_versions() -> dict[str, str]:
    raw = _load().sk_engine_versions().decode()   # "ggml=0.22.0;transcribe=0.2.2;...;lane=cpu"
    out: dict[str, str] = {}
    for seg in raw.split(";"):
        key, _, val = seg.partition("=")
        if key:
            out[key] = val
    return out


def init(n_threads: int = 0, log=None) -> None:
    """Idempotent. `log(level, message)` receives ggml and sokuji-native log lines. Only
    the sink passed to the FIRST successful init is honoured — the native side installs it
    once; later calls return at once and ignore a different `log`. A failed init (no
    backend modules, say) leaves the process uninitialised, so a retry is a real retry."""
    global _initialised
    lib = _load()
    with _lock:
        if _initialised:
            return
        opts = _ffi.sk_init_options()
        opts.abi_version = _ffi.SK_ABI_VERSION
        opts.n_threads = int(n_threads)
        opts.module_dir = str(native_dir()).encode()
        trampoline = None
        if log is not None:
            def _cb(level, msg, _user):
                try:
                    log(int(level), (msg or b"").decode("utf-8", "replace"))
                except Exception:
                    pass   # a log sink must never raise into the C caller; the line is lost, nothing else
                return True
            trampoline = _ffi.LOG_CB(_cb)
            opts.log = trampoline
        status = lib.sk_init(ctypes.byref(opts))
        if status != _ffi.SK_OK:
            _raise(lib, status, "sk_init")
        if trampoline is not None:
            _log_refs.append(trampoline)   # native now holds this pointer for the life of the process
        _initialised = True


def devices() -> list[Device]:
    lib = _load()
    buf = (_ffi.sk_device * 32)()
    n = lib.sk_devices(buf, 32)
    return [Device(d.index, _ffi.DEVICE_KIND.get(d.kind, "other"), d.name.decode(), d.description.decode(),
                   int(d.mem_total), int(d.mem_free)) for d in buf[:n]]


def device_free_mem(index: int) -> int:
    lib = _load()
    out = ctypes.c_uint64()
    status = lib.sk_device_free_mem(int(index), ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_device_free_mem")
    return int(out.value)


def audio_families() -> list[str]:
    lib = _load()
    buf = (ctypes.c_char_p * 64)()
    n = lib.sk_audio_families(buf, 64)
    return [buf[i].decode() for i in range(n)]
