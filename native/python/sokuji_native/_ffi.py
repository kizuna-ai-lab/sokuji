"""ctypes declarations for the slice-1 surface of sokuji_native.h. Keep in lock-step with
the header; SK_ABI_VERSION here is compared against contract.json and sk_abi_version()."""
from ctypes import (CDLL, CFUNCTYPE, POINTER, Structure, c_bool, c_char, c_char_p, c_float, c_int32,
                     c_size_t, c_uint32, c_uint64, c_void_p)

SK_ABI_VERSION = 2

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


# tts/index_tts2 (499 identities, 67 WEIGHT) expands to 901 entries over the widest fallback
# dtype set (7) and 700 over q8_0's 4-dtype rung set — both exceed 512, so the cap is 2048.
SK_OP_COVERAGE_MAX = 2048


class sk_device_profile(Structure):
    _fields_ = [("index", c_int32), ("known", c_int32), ("features", c_uint32),
                ("driver_name", c_char * 256), ("driver_version", c_char * 256),
                ("device_uuid", c_char * 40), ("cpu_features", c_char * 512)]


class sk_op_check(Structure):
    _fields_ = [("name", c_char * 64), ("supported", c_int32)]


class sk_op_coverage(Structure):
    _fields_ = [("n_ops", c_int32), ("all_supported", c_int32),
                ("ops", sk_op_check * SK_OP_COVERAGE_MAX)]


FEATURE_BITS = {  # sk_feature, lower-case without the SK_FEAT_ prefix (DeviceProfile.features names)
    1 << 0: "vk_shader_float16", 1 << 1: "vk_shader_bfloat16", 1 << 2: "vk_integer_dot",
    1 << 3: "vk_coopmat", 1 << 4: "vk_coopmat2",
    1 << 5: "mtl_simdgroup_reduction", 1 << 6: "mtl_bfloat", 1 << 7: "uma",
}


class sk_asr_caps(Structure):
    _fields_ = [("n_languages", c_int32), ("languages", POINTER(c_char_p)), ("supports_streaming", c_bool),
                ("supports_language_detect", c_bool), ("native_sample_rate", c_int32), ("arch", c_char_p)]


class sk_stream_text(Structure):
    _fields_ = [("committed", c_char_p), ("tentative", c_char_p)]


class sk_translate_options(Structure):
    _fields_ = [("n_ctx", c_int32), ("flash_attn", c_int32)]


class sk_message(Structure):
    _fields_ = [("role", c_char_p), ("content", c_char_p)]


class sk_gen_options(Structure):
    _fields_ = [("max_tokens", c_int32), ("assistant_prefill", c_char_p)]


TEXT_CB = CFUNCTYPE(c_bool, c_char_p, c_void_p)

AUDIO_CB = CFUNCTYPE(c_bool, POINTER(c_float), c_size_t, c_int32, c_int32, c_void_p)


class sk_tts_options(Structure):
    _fields_ = [("family", c_char_p), ("language", c_char_p)]


class sk_tts_caps(Structure):
    _fields_ = [("streaming", c_bool), ("clones", c_bool), ("transcript_required", c_bool),
                ("sample_rate", c_int32)]


def bind(lib: CDLL) -> CDLL:
    lib.sk_init.argtypes = [POINTER(sk_init_options)]
    lib.sk_init.restype = c_int32
    lib.sk_devices.argtypes = [POINTER(sk_device), c_int32]
    lib.sk_devices.restype = c_int32
    lib.sk_device_free_mem.argtypes = [c_int32, POINTER(c_uint64)]
    lib.sk_device_free_mem.restype = c_int32
    lib.sk_device_profile_get.argtypes = [c_int32, POINTER(sk_device_profile)]
    lib.sk_device_profile_get.restype = c_int32
    lib.sk_device_supports_ops.argtypes = [c_int32, c_char_p, c_char_p, POINTER(c_char_p), c_int32,
                                           POINTER(sk_op_coverage)]
    lib.sk_device_supports_ops.restype = c_int32
    lib.sk_ops_blob_count.argtypes = []
    lib.sk_ops_blob_count.restype = c_int32
    lib.sk_ops_blob_at.argtypes = [c_int32, POINTER(c_char_p), POINTER(c_char_p), POINTER(c_char_p)]
    lib.sk_ops_blob_at.restype = c_int32
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
    lib.sk_translate_load.argtypes = [c_char_p, POINTER(sk_device), POINTER(sk_translate_options), POINTER(c_void_p)]
    lib.sk_translate_load.restype = c_int32
    lib.sk_translate_chat.argtypes = [c_void_p, POINTER(sk_message), c_int32, POINTER(sk_gen_options), TEXT_CB, c_void_p]
    lib.sk_translate_chat.restype = c_int32
    lib.sk_translate_complete.argtypes = [c_void_p, c_char_p, POINTER(sk_gen_options), TEXT_CB, c_void_p]
    lib.sk_translate_complete.restype = c_int32
    lib.sk_translate_unload.argtypes = [c_void_p]
    lib.sk_translate_unload.restype = None
    lib.sk_tts_load.argtypes = [c_char_p, POINTER(sk_device), POINTER(sk_tts_options), POINTER(c_void_p)]
    lib.sk_tts_load.restype = c_int32
    lib.sk_tts_capabilities.argtypes = [c_void_p, POINTER(sk_tts_caps)]
    lib.sk_tts_capabilities.restype = c_int32
    lib.sk_tts_presets.argtypes = [c_void_p, TEXT_CB, c_void_p]
    lib.sk_tts_presets.restype = c_int32
    lib.sk_tts_set_voice.argtypes = [c_void_p, POINTER(c_float), c_size_t, c_int32, c_char_p]
    lib.sk_tts_set_voice.restype = c_int32
    lib.sk_tts_set_preset.argtypes = [c_void_p, c_char_p]
    lib.sk_tts_set_preset.restype = c_int32
    lib.sk_tts_synth.argtypes = [c_void_p, c_char_p, c_char_p, c_float, AUDIO_CB, c_void_p]
    lib.sk_tts_synth.restype = c_int32
    lib.sk_tts_unload.argtypes = [c_void_p]
    lib.sk_tts_unload.restype = None
    return lib
