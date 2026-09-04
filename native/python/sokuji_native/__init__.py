"""sokuji_native — the sidecar's one native dependency.

Loads libsokuji_native from the packaged _native/ directory (or SOKUJI_NATIVE_DIR for a
development tree), refuses a contract.json whose ABI differs from _ffi.SK_ABI_VERSION,
and exposes the C surface as plain Python. Slice 4 adds tts."""
from __future__ import annotations

import codecs
import ctypes
import json
import os
import pathlib
import platform
import threading
from dataclasses import dataclass

import numpy as np

from . import _ffi

__all__ = ["NativeError", "Device", "init", "devices", "device_free_mem", "version",
           "engine_versions", "contract", "audio_families", "native_dir",
           "DeviceProfile", "device_profiles",
           "AsrCaps", "AsrModel", "AsrStream", "StreamText", "asr_load",
           "Translator", "translate_load",
           "TtsCaps", "TtsModel", "tts_load"]


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


@dataclass(frozen=True)
class DeviceProfile:
    index: int
    kind: str
    name: str
    description: str
    mem_total: int
    known: bool
    features: frozenset[str]
    driver_name: str
    driver_version: str
    device_uuid: str
    cpu_features: str


class _State:
    """Process-wide binding state, one instance (`_state`)."""
    lib: ctypes.CDLL | None = None
    contract: dict | None = None
    initialised = False     # sk_init succeeded once; later init() calls return without calling native

    def __init__(self) -> None:
        # Objects native code or the OS loader keeps a pointer to for the life of the
        # process, held here so Python never collects them: the log trampoline sk_init
        # installed, and on Windows the os.add_dll_directory() handle (the directory is
        # on the DLL search path only while that handle lives).
        self.keepalive: list = []


_lock = threading.RLock()   # reentrant: sk_init's log callback may call back into version()/_load()
_state = _State()


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
    with _lock:
        if _state.lib is not None:
            return _state.lib
        d = native_dir()
        _state.contract = _check_contract(d / "contract.json")
        if platform.system() == "Windows":
            _state.keepalive.append(os.add_dll_directory(str(d)))
        lib = _ffi.bind(ctypes.CDLL(str(d / _library_name())))
        if lib.sk_abi_version() != _ffi.SK_ABI_VERSION:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT,
                              f"library ABI {lib.sk_abi_version()} != binding ABI {_ffi.SK_ABI_VERSION}")
        _state.lib = lib
        return lib


def _raise(lib: ctypes.CDLL, status: int, what: str) -> None:
    msg = (lib.sk_last_error() or b"").decode("utf-8", "replace")
    raise NativeError(status, f"{what}: {msg or 'unknown error'}")


def contract() -> dict:
    _load()
    return dict(_state.contract or {})


def version() -> str:
    return _load().sk_version().decode()


def engine_versions() -> dict[str, str]:
    raw = _load().sk_engine_versions().decode()   # "ggml=0.22.0;transcribe=0.2.3;...;lane=cpu"
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
    lib = _load()
    with _lock:
        if _state.initialised:
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
            _state.keepalive.append(trampoline)   # native now holds this pointer for the life of the process
        _state.initialised = True


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


def device_profiles() -> list[DeviceProfile]:
    """One profile per devices() entry (same order, same index). A device whose profile could
    not be read comes back with known=False and every other field empty — never an error."""
    lib = _load()
    out = []
    for d in devices():
        raw = _ffi.sk_device_profile()
        status = lib.sk_device_profile_get(int(d.index), ctypes.byref(raw))
        if status != _ffi.SK_OK:
            _raise(lib, status, "sk_device_profile_get")
        bits = frozenset(name for bit, name in _ffi.FEATURE_BITS.items() if raw.features & bit)
        out.append(DeviceProfile(d.index, d.kind, d.name, d.description, d.mem_total, bool(raw.known),
                                 bits if raw.known else frozenset(),
                                 raw.driver_name.decode("utf-8", "replace"),
                                 raw.driver_version.decode("utf-8", "replace"),
                                 raw.device_uuid.decode("utf-8", "replace"),
                                 raw.cpu_features.decode("utf-8", "replace")))
    return out


def audio_families() -> list[str]:
    lib = _load()
    buf = (ctypes.c_char_p * 64)()
    n = lib.sk_audio_families(buf, 64)
    return [buf[i].decode() for i in range(n)]


def _pcm(x):
    """(ctypes float32 array, n) from a C-contiguous float32 buffer (zero copy: a numpy
    float32 array), any other buffer-protocol object, or a plain sequence of floats."""
    try:
        mv = memoryview(x)
    except TypeError:
        vals = [float(v) for v in x]
        return (ctypes.c_float * len(vals))(*vals), len(vals)
    if mv.format == "f" and mv.c_contiguous:
        n = mv.nbytes // 4
        arr = (ctypes.c_float * n).from_buffer_copy(mv) if mv.readonly else (ctypes.c_float * n).from_buffer(mv)
        return arr, n
    flat = mv.tolist()
    while flat and isinstance(flat[0], list):        # ndim > 1: flatten row-major
        flat = [v for row in flat for v in row]
    vals = [float(v) for v in flat]
    return (ctypes.c_float * len(vals))(*vals), len(vals)


@dataclass(frozen=True)
class AsrCaps:
    languages: tuple[str, ...]
    supports_streaming: bool
    supports_language_detect: bool
    native_sample_rate: int
    arch: str


@dataclass(frozen=True)
class StreamText:
    committed: str
    tentative: str


class AsrStream:
    """One open stream on an AsrModel. feed() returns the committed/tentative view after
    the chunk; finalize() returns the final committed text and closes the stream; close()
    abandons it. Both are idempotent."""

    def __init__(self, lib, handle, model):
        self._lib = lib
        self._h = handle
        self._model = model     # keeps the AsrModel (and its C handle) alive for as long as this stream is

    def feed(self, pcm) -> StreamText:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT, "sk_asr_stream_feed: stream is closed")
        arr, n = _pcm(pcm)
        out = _ffi.sk_stream_text()
        status = self._lib.sk_asr_stream_feed(self._h, ctypes.cast(arr, ctypes.POINTER(ctypes.c_float)), n, ctypes.byref(out))
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_asr_stream_feed")
        return StreamText((out.committed or b"").decode("utf-8", "replace"), (out.tentative or b"").decode("utf-8", "replace"))

    def finalize(self) -> str:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT, "sk_asr_stream_finalize: stream is closed")
        got: list[str] = []
        cb = _ffi.TEXT_CB(lambda text, _user: (got.append((text or b"").decode("utf-8", "replace")), True)[1])
        status = self._lib.sk_asr_stream_finalize(self._h, cb, None)
        if status != _ffi.SK_OK:
            self.close()
            _raise(self._lib, status, "sk_asr_stream_finalize")
        self.close()
        return got[0] if got else ""

    def close(self) -> None:
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_asr_stream_close(h)
        if self._model is not None and getattr(self._model, "_stream", None) is self:
            self._model._stream = None
        self._model = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass  # finalizers must never raise (see TtsModel.__del__)


class AsrModel:
    """A loaded ASR model. Compute on one model is serialised by the library."""

    def __init__(self, lib, handle, caps: AsrCaps):
        self._lib = lib
        self._h = handle
        self.capabilities = caps
        self._stream = None     # the at-most-one open stream (a stream must never outlive its model)

    def run(self, pcm, language: str | None = None, on_poll=None) -> str:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_asr_run: model is unloaded")
        arr, n = _pcm(pcm)
        got: list[str] = []

        def _cb(text, _user):
            if text is None:
                # An exception raised here propagates into ctypes, which swallows it and
                # returns the default False instead — the run then cancels and surfaces as
                # SK_ERR_CANCELLED. Callers should not raise from on_poll.
                return True if on_poll is None else bool(on_poll())
            got.append(text.decode("utf-8", "replace"))
            return True

        cb = _ffi.TEXT_CB(_cb)
        status = self._lib.sk_asr_run(self._h, ctypes.cast(arr, ctypes.POINTER(ctypes.c_float)), n,
                                      language.encode() if language else None, cb, None)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_asr_run")
        return got[0] if got else ""

    def open_stream(self, language: str | None = None) -> AsrStream:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_asr_stream_open: model is unloaded")
        out = ctypes.c_void_p()
        status = self._lib.sk_asr_stream_open(self._h, language.encode() if language else None, ctypes.byref(out))
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_asr_stream_open")
        st = AsrStream(self._lib, out.value, self)
        self._stream = st
        return st

    def unload(self) -> None:
        st, self._stream = self._stream, None
        if st is not None:
            st.close()          # an explicit unload with a live stream must close it, not dangle it
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_asr_unload(h)

    def __del__(self):
        try:
            self.unload()
        except Exception:
            pass  # finalizers must never raise (see TtsModel.__del__)


def asr_load(path: str, device: Device | None = None) -> AsrModel:
    lib = _load()
    out = ctypes.c_void_p()
    dev = None
    if device is not None:
        dev = _ffi.sk_device()
        dev.index = int(device.index)
    status = lib.sk_asr_load(str(path).encode(), ctypes.byref(dev) if dev is not None else None, ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_asr_load")
    raw = _ffi.sk_asr_caps()
    status = lib.sk_asr_capabilities(out.value, ctypes.byref(raw))
    if status != _ffi.SK_OK:
        lib.sk_asr_unload(out.value)
        _raise(lib, status, "sk_asr_capabilities")
    langs = tuple(raw.languages[i].decode() for i in range(raw.n_languages)) if raw.languages else ()
    caps = AsrCaps(langs, bool(raw.supports_streaming), bool(raw.supports_language_detect),
                   int(raw.native_sample_rate), (raw.arch or b"").decode())
    return AsrModel(lib, out.value, caps)


class Translator:
    """A loaded GGUF chat model (llama.cpp). Requests are stateless — chat()/complete()
    each clear the KV cache before evaluating their own prompt from scratch — and calls on
    one handle are serialised by the library. chat() renders `messages` through the GGUF's
    own chat template and appends `assistant_prefill` verbatim (the Qwen3 empty-think-block
    trick); a model whose template the legacy formatter does not know raises NativeError and
    callers should fall back to complete() with a self-rendered prompt."""

    def __init__(self, lib, handle):
        self._lib = lib
        self._h = handle

    def _make_cb(self, on_token):
        """Builds the ctypes trampoline for sk_text_cb, plus the machinery to reassemble
        it. Per sokuji_native.h (translation section, ~line 163): sk_text_cb is invoked
        once per decoded token piece, and a piece MAY split a multibyte UTF-8 character
        across pieces — concatenate before display. A byte-level BPE tokenizer routinely
        does this mid-CJK-character, so pieces must be decoded with a stateful
        incremental decoder, not independently — decoding each piece on its own turns a
        split boundary into U+FFFD (R41).

        Returns (trampoline, got, flush): `got` accumulates decoded text as pieces
        arrive — the same text on_token sees, piece for piece. `flush()` must be called
        once after the native call returns (chat()/complete() do this) to emit whatever
        trailing bytes never completed a character — generation ending mid-character is
        abnormal but must not crash; it surfaces as a single replacement character."""
        got: list[str] = []
        dec = codecs.getincrementaldecoder("utf-8")("replace")

        def _cb(text, _user):
            piece = dec.decode(text or b"")
            if not piece:
                return True   # bytes buffered mid-character; nothing complete yet
            got.append(piece)
            if on_token is None:
                return True
            # An exception raised here propagates into ctypes, which swallows it and
            # returns the default False instead — the request then cancels and surfaces as
            # SK_ERR_CANCELLED. Callers should not raise from on_token.
            return on_token(piece) is not False

        def _flush():
            tail = dec.decode(b"", final=True)
            if tail:
                got.append(tail)
                if on_token is not None:
                    # Same tolerance as the trampoline above, where ctypes swallows a
                    # raise: the native call has already returned, so there is nothing
                    # left to cancel — an on_token failure here must not turn a finished
                    # translation into an exception. Return value is ignored for the same
                    # reason.
                    try:
                        on_token(tail)
                    except Exception:
                        pass  # deliberate: parity with the trampoline, where ctypes swallows the raise

        return _ffi.TEXT_CB(_cb), got, _flush

    def chat(self, messages, max_tokens: int = 512, assistant_prefill: str | None = None, on_token=None) -> str:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_translate_chat: model is unloaded")
        # ctypes keeps no reference from a Structure's c_char_p field, so the encoded bytes
        # must be kept alive here (in `encoded`, `prefill`) for the duration of the call.
        encoded = [(m["role"].encode(), m["content"].encode()) for m in messages]
        msgs = (_ffi.sk_message * len(encoded))()
        for i, (role, content) in enumerate(encoded):
            msgs[i].role = role
            msgs[i].content = content
        gen = _ffi.sk_gen_options()
        gen.max_tokens = int(max_tokens)
        prefill = assistant_prefill.encode() if assistant_prefill is not None else None
        gen.assistant_prefill = prefill
        cb, got, flush = self._make_cb(on_token)
        status = self._lib.sk_translate_chat(self._h, msgs, len(encoded), ctypes.byref(gen), cb, None)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_translate_chat")
        flush()
        return "".join(got)

    def complete(self, prompt: str, max_tokens: int = 512, on_token=None) -> str:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_translate_complete: model is unloaded")
        gen = _ffi.sk_gen_options()
        gen.max_tokens = int(max_tokens)
        gen.assistant_prefill = None
        cb, got, flush = self._make_cb(on_token)
        status = self._lib.sk_translate_complete(self._h, prompt.encode(), ctypes.byref(gen), cb, None)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_translate_complete")
        flush()
        return "".join(got)

    def unload(self) -> None:
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_translate_unload(h)

    def __del__(self):
        try:
            self.unload()
        except Exception:
            pass  # finalizers must never raise (see TtsModel.__del__)


def translate_load(path: str, device: Device | None = None, n_ctx: int = 0) -> Translator:
    lib = _load()
    out = ctypes.c_void_p()
    dev = None
    if device is not None:
        dev = _ffi.sk_device()
        dev.index = int(device.index)
    opts = _ffi.sk_translate_options()
    opts.n_ctx = int(n_ctx)
    opts.flash_attn = 0
    status = lib.sk_translate_load(str(path).encode(), ctypes.byref(dev) if dev is not None else None,
                                   ctypes.byref(opts), ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_translate_load")
    return Translator(lib, out.value)


@dataclass(frozen=True)
class TtsCaps:
    streaming: bool
    clones: bool
    transcript_required: bool
    sample_rate: int


def _copy_audio_cb_pcm(pcm, n_samples: int, channels: int = 1) -> np.ndarray:
    """`pcm` points at a buffer that audio.cpp owns and may free or overwrite the instant
    the callback returns — this MUST run inside the callback and produce an independent,
    owned array before that happens. `n_samples` is the total float count of the
    (possibly multi-channel interleaved) buffer, already channel-inclusive. Shape is
    numpy-natural: 1-D `(frames,)` for mono, 2-D `(frames, channels)` for anything else —
    moss_tts_nano's audio tokenizer is stereo, and `channels` here is the C ABI's own
    value (native/src/sk_tts.cpp forwards `audio.channels` verbatim at every sk_audio_cb
    call site; it was already correct, only this binding was dropping it)."""
    if not n_samples or not pcm:
        return np.empty(0, dtype=np.float32)
    flat = np.ctypeslib.as_array(pcm, shape=(int(n_samples),)).copy()
    ch = int(channels)
    return flat.reshape(-1, ch) if ch > 1 else flat


class TtsModel:
    """A loaded TTS model (audio.cpp): one family, one long-lived session per handle
    (offline or streaming per the family), calls serialised by the library. Voice state
    (a preset id or a cloned reference clip) lives on the handle and applies to every
    subsequent synth(); set_preset()/set_voice() overwrite each other. The per-handle lock
    is not recursive: calling another method on this same handle from inside on_chunk (or
    from a presets() callback) deadlocks the calling thread — on_chunk may only read its
    own arguments and touch caller-owned state."""

    def __init__(self, lib, handle, caps: TtsCaps):
        self._lib = lib
        self._h = handle
        self.capabilities = caps

    def presets(self) -> list[str]:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_tts_presets: model is unloaded")
        got: list[str] = []
        cb = _ffi.TEXT_CB(lambda text, _user: (got.append((text or b"").decode("utf-8", "replace")), True)[1])
        status = self._lib.sk_tts_presets(self._h, cb, None)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_tts_presets")
        return got

    def set_voice(self, pcm, sample_rate: int, ref_text: str | None = None) -> None:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_tts_set_voice: model is unloaded")
        arr, n = _pcm(pcm)
        # ctypes keeps no reference from a plain call argument here either; `text` is kept
        # alive as a local for the duration of the call below.
        text = ref_text.encode() if ref_text is not None else None
        status = self._lib.sk_tts_set_voice(self._h, ctypes.cast(arr, ctypes.POINTER(ctypes.c_float)), n,
                                            int(sample_rate), text)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_tts_set_voice")

    def set_preset(self, name: str) -> None:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_tts_set_preset: model is unloaded")
        status = self._lib.sk_tts_set_preset(self._h, name.encode())
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_tts_set_preset")

    def synth(self, text: str, language: str | None = None, speed: float = 1.0,
             on_chunk=None) -> tuple[np.ndarray, int]:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_tts_synth: model is unloaded")
        chunks: list[np.ndarray] = []
        last_rate = self.capabilities.sample_rate

        def _cb(pcm, n_samples, sample_rate, channels, _user):
            nonlocal last_rate
            copy = _copy_audio_cb_pcm(pcm, n_samples, channels)
            chunks.append(copy)
            last_rate = int(sample_rate)
            if on_chunk is None:
                return True
            # An exception raised here propagates into ctypes, which swallows it and
            # returns the default False instead — the request then cancels and surfaces as
            # SK_ERR_CANCELLED. Callers should not raise from on_chunk.
            return on_chunk(copy, int(sample_rate)) is not False

        cb = _ffi.AUDIO_CB(_cb)
        status = self._lib.sk_tts_synth(self._h, text.encode(), language.encode() if language else None,
                                        float(speed), cb, None)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_tts_synth")
        # axis=0 concatenates along the frame axis for both shapes _copy_audio_cb_pcm can
        # produce: 1-D (frames,) mono chunks, or 2-D (frames, channels) multi-channel ones.
        samples = np.concatenate(chunks, axis=0) if chunks else np.empty(0, dtype=np.float32)
        return samples, last_rate

    def unload(self) -> None:
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_tts_unload(h)

    def __del__(self):
        try:
            self.unload()
        except Exception:
            # __del__ must never raise: finalizers can run during interpreter shutdown
            # when module globals are already gone, and an exception here is unreportable.
            pass


def tts_load(path: str, family: str, device: Device | None = None, language: str | None = None) -> TtsModel:
    lib = _load()
    out = ctypes.c_void_p()
    dev = None
    if device is not None:
        dev = _ffi.sk_device()
        dev.index = int(device.index)
    # ctypes keeps no reference from a Structure's c_char_p field, so the encoded bytes
    # must be kept alive here for the duration of the call.
    family_b = family.encode()
    language_b = language.encode() if language is not None else None
    opts = _ffi.sk_tts_options()
    opts.family = family_b
    opts.language = language_b
    status = lib.sk_tts_load(str(path).encode(), ctypes.byref(dev) if dev is not None else None,
                             ctypes.byref(opts), ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_tts_load")
    raw = _ffi.sk_tts_caps()
    status = lib.sk_tts_capabilities(out.value, ctypes.byref(raw))
    if status != _ffi.SK_OK:
        lib.sk_tts_unload(out.value)
        _raise(lib, status, "sk_tts_capabilities")
    caps = TtsCaps(bool(raw.streaming), bool(raw.clones), bool(raw.transcript_required), int(raw.sample_rate))
    return TtsModel(lib, out.value, caps)
