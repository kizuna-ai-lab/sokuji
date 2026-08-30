/* sokuji-native — the one C ABI the sidecar talks to.
 * Conventions: opaque handles; every call returns sk_status (0 ok, negative error) and
 * sk_last_error() carries a thread-local UTF-8 message; callbacks take a void *user and
 * return bool — false cancels; memory the library hands out is released with sk_free();
 * threads are configured once in sk_init(). Prefixes name the stage (sk_asr_, sk_vad_,
 * sk_translate_, sk_tts_), never the engine behind it. */
#ifndef SOKUJI_NATIVE_H
#define SOKUJI_NATIVE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#  if defined(SOKUJI_NATIVE_BUILD)
#    define SK_API __declspec(dllexport)
#  else
#    define SK_API __declspec(dllimport)
#  endif
#else
#  define SK_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SK_ABI_VERSION 1

typedef int32_t sk_status;
enum {
    SK_OK                   =  0,
    SK_ERR_INVALID_ARGUMENT = -1,
    SK_ERR_NOT_INITIALISED  = -2,
    SK_ERR_BACKEND          = -3,
    SK_ERR_NOT_FOUND        = -4,
    SK_ERR_CANCELLED        = -5,
    SK_ERR_INTERNAL         = -6,
};

/* level: 0 debug, 1 info, 2 warn, 3 error. Return value is ignored for logs but kept
 * so every callback in this ABI has the same shape. */
typedef bool (*sk_log_cb)(int32_t level, const char *message, void *user);

typedef struct sk_init_options {
    int32_t     abi_version;   /* must equal SK_ABI_VERSION */
    int32_t     n_threads;     /* 0 = hardware concurrency */
    const char *module_dir;    /* directory holding the ggml backend modules; NULL = next to this library */
    sk_log_cb   log;           /* optional */
    void       *log_user;
} sk_init_options;

enum sk_device_kind { SK_DEVICE_CPU = 0, SK_DEVICE_VULKAN = 1, SK_DEVICE_METAL = 2, SK_DEVICE_OTHER = 99 };

typedef struct sk_device {
    int32_t  index;            /* stable for the life of the process */
    int32_t  kind;             /* sk_device_kind */
    char     name[64];         /* e.g. "Vulkan0", "CPU" */
    char     description[128]; /* e.g. "NVIDIA GB10" */
    uint64_t mem_total;
    uint64_t mem_free;         /* snapshot at enumeration time; use sk_device_free_mem for fresh values */
} sk_device;

SK_API sk_status   sk_init(const sk_init_options *options);
SK_API int32_t     sk_devices(sk_device *out, int32_t capacity);        /* returns count written; 0 before sk_init */
SK_API sk_status   sk_device_free_mem(int32_t index, uint64_t *bytes);
SK_API int32_t     sk_abi_version(void);
SK_API const char *sk_version(void);                                    /* "0.1.0" */
SK_API const char *sk_engine_versions(void);                            /* "ggml=0.22.0;transcribe=0.2.2;..." */
SK_API const char *sk_last_error(void);                                 /* thread-local, "" when none */
SK_API void        sk_free(void *p);

/* Names of the audio.cpp model families compiled into this library, sorted. Diagnostic
 * only: the sidecar's catalog is the source of truth for what a user can pick. */
SK_API int32_t sk_audio_families(const char **out, int32_t capacity);

#ifdef __cplusplus
}
#endif
#endif /* SOKUJI_NATIVE_H */
