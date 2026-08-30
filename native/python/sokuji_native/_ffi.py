"""ctypes declarations for the slice-1 surface of sokuji_native.h. Keep in lock-step with
the header; SK_ABI_VERSION here is compared against contract.json and sk_abi_version()."""
import ctypes
from ctypes import POINTER, c_bool, c_char, c_char_p, c_int32, c_uint64, c_void_p

SK_ABI_VERSION = 1

SK_OK = 0
SK_ERR_INVALID_ARGUMENT = -1
SK_ERR_NOT_INITIALISED = -2
SK_ERR_BACKEND = -3
SK_ERR_NOT_FOUND = -4
SK_ERR_CANCELLED = -5
SK_ERR_INTERNAL = -6

DEVICE_KIND = {0: "cpu", 1: "vulkan", 2: "metal", 99: "other"}

LOG_CB = ctypes.CFUNCTYPE(c_bool, c_int32, c_char_p, c_void_p)


class sk_init_options(ctypes.Structure):
    _fields_ = [("abi_version", c_int32), ("n_threads", c_int32), ("module_dir", c_char_p),
                ("log", LOG_CB), ("log_user", c_void_p)]


class sk_device(ctypes.Structure):
    _fields_ = [("index", c_int32), ("kind", c_int32), ("name", c_char * 64), ("description", c_char * 128),
                ("mem_total", c_uint64), ("mem_free", c_uint64)]


def bind(lib: ctypes.CDLL) -> ctypes.CDLL:
    lib.sk_init.argtypes = [POINTER(sk_init_options)];           lib.sk_init.restype = c_int32
    lib.sk_devices.argtypes = [POINTER(sk_device), c_int32];      lib.sk_devices.restype = c_int32
    lib.sk_device_free_mem.argtypes = [c_int32, POINTER(c_uint64)]; lib.sk_device_free_mem.restype = c_int32
    lib.sk_abi_version.argtypes = [];                             lib.sk_abi_version.restype = c_int32
    lib.sk_version.argtypes = [];                                 lib.sk_version.restype = c_char_p
    lib.sk_engine_versions.argtypes = [];                         lib.sk_engine_versions.restype = c_char_p
    lib.sk_last_error.argtypes = [];                              lib.sk_last_error.restype = c_char_p
    lib.sk_free.argtypes = [c_void_p];                            lib.sk_free.restype = None
    lib.sk_audio_families.argtypes = [POINTER(c_char_p), c_int32]; lib.sk_audio_families.restype = c_int32
    return lib
