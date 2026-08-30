"""ctypes declarations for the slice-1 surface of sokuji_native.h. Keep in lock-step with
the header; SK_ABI_VERSION here is compared against contract.json and sk_abi_version()."""
from ctypes import (CDLL, CFUNCTYPE, POINTER, Structure, c_bool, c_char, c_char_p, c_float, c_int32, c_int64,
                     c_size_t, c_uint64, c_void_p)

SK_ABI_VERSION = 1

SK_OK = 0
SK_ERR_INVALID_ARGUMENT = -1
SK_ERR_NOT_INITIALISED = -2
SK_ERR_BACKEND = -3
SK_ERR_NOT_FOUND = -4
SK_ERR_CANCELLED = -5
SK_ERR_INTERNAL = -6

DEVICE_KIND = {0: "cpu", 1: "vulkan", 2: "metal", 99: "other"}

LOG_CB = CFUNCTYPE(c_bool, c_int32, c_char_p, c_void_p)


class sk_init_options(Structure):
    _fields_ = [("abi_version", c_int32), ("n_threads", c_int32), ("module_dir", c_char_p),
                ("log", LOG_CB), ("log_user", c_void_p)]


class sk_device(Structure):
    _fields_ = [("index", c_int32), ("kind", c_int32), ("name", c_char * 64), ("description", c_char * 128),
                ("mem_total", c_uint64), ("mem_free", c_uint64)]


class sk_asr_caps(Structure):
    _fields_ = [("n_languages", c_int32), ("languages", POINTER(c_char_p)), ("supports_streaming", c_bool),
                ("supports_language_detect", c_bool), ("native_sample_rate", c_int32), ("arch", c_char_p)]


class sk_stream_text(Structure):
    _fields_ = [("committed", c_char_p), ("tentative", c_char_p)]


class sk_vad_options(Structure):
    _fields_ = [("weights", c_char_p), ("threshold", c_float), ("min_speech_ms", c_int32), ("min_silence_ms", c_int32),
                ("speech_pad_ms", c_int32), ("max_speech_s", c_float)]


class sk_vad_event(Structure):
    _fields_ = [("kind", c_int32), ("sample", c_int64), ("probability", c_float), ("seg_start", c_int64), ("seg_end", c_int64)]


TEXT_CB = CFUNCTYPE(c_bool, c_char_p, c_void_p)
VAD_KIND = {1: "start", 2: "end"}


def bind(lib: CDLL) -> CDLL:
    lib.sk_init.argtypes = [POINTER(sk_init_options)]
    lib.sk_init.restype = c_int32
    lib.sk_devices.argtypes = [POINTER(sk_device), c_int32]
    lib.sk_devices.restype = c_int32
    lib.sk_device_free_mem.argtypes = [c_int32, POINTER(c_uint64)]
    lib.sk_device_free_mem.restype = c_int32
    lib.sk_abi_version.argtypes = []
    lib.sk_abi_version.restype = c_int32
    lib.sk_version.argtypes = []
    lib.sk_version.restype = c_char_p
    lib.sk_engine_versions.argtypes = []
    lib.sk_engine_versions.restype = c_char_p
    lib.sk_last_error.argtypes = []
    lib.sk_last_error.restype = c_char_p
    lib.sk_free.argtypes = [c_void_p]
    lib.sk_free.restype = None
    lib.sk_audio_families.argtypes = [POINTER(c_char_p), c_int32]
    lib.sk_audio_families.restype = c_int32
    lib.sk_asr_load.argtypes = [c_char_p, POINTER(sk_device), POINTER(c_void_p)]
    lib.sk_asr_load.restype = c_int32
    lib.sk_asr_capabilities.argtypes = [c_void_p, POINTER(sk_asr_caps)]
    lib.sk_asr_capabilities.restype = c_int32
    lib.sk_asr_run.argtypes = [c_void_p, POINTER(c_float), c_size_t, c_char_p, TEXT_CB, c_void_p]
    lib.sk_asr_run.restype = c_int32
    lib.sk_asr_stream_open.argtypes = [c_void_p, c_char_p, POINTER(c_void_p)]
    lib.sk_asr_stream_open.restype = c_int32
    lib.sk_asr_stream_feed.argtypes = [c_void_p, POINTER(c_float), c_size_t, POINTER(sk_stream_text)]
    lib.sk_asr_stream_feed.restype = c_int32
    lib.sk_asr_stream_finalize.argtypes = [c_void_p, TEXT_CB, c_void_p]
    lib.sk_asr_stream_finalize.restype = c_int32
    lib.sk_asr_stream_close.argtypes = [c_void_p]
    lib.sk_asr_stream_close.restype = None
    lib.sk_asr_unload.argtypes = [c_void_p]
    lib.sk_asr_unload.restype = None
    lib.sk_vad_open.argtypes = [POINTER(sk_vad_options), POINTER(c_void_p)]
    lib.sk_vad_open.restype = c_int32
    lib.sk_vad_feed.argtypes = [c_void_p, POINTER(c_float), POINTER(sk_vad_event)]
    lib.sk_vad_feed.restype = c_int32
    lib.sk_vad_finalize.argtypes = [c_void_p, POINTER(sk_vad_event)]
    lib.sk_vad_finalize.restype = c_int32
    lib.sk_vad_reset.argtypes = [c_void_p]
    lib.sk_vad_reset.restype = None
    lib.sk_vad_close.argtypes = [c_void_p]
    lib.sk_vad_close.restype = None
    return lib
