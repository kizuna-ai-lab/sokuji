/* sokuji-native — the one C ABI the sidecar talks to.
 * Conventions: opaque handles; every call returns sk_status (0 ok, negative error) and
 * sk_last_error() carries a thread-local UTF-8 message; callbacks take a void *user and
 * return bool — false cancels; threads are configured once in sk_init(). Prefixes name
 * the stage (sk_asr_, sk_vad_, sk_translate_, sk_tts_), never the engine behind it.
 *
 * Three rules that hold for every call in this header, now and in later slices:
 *   - Nothing works before sk_init() succeeds. Any call that needs a live library
 *     returns SK_ERR_NOT_INITIALISED and sets sk_last_error(); the exceptions are the
 *     pure accessors below (sk_abi_version, sk_version, sk_engine_versions,
 *     sk_last_error, sk_free, and sk_audio_families — compile-time data, no backend
 *     needed) and sk_devices(), which reports 0 devices.
 *   - sk_init() is idempotent, and only the FIRST successful call decides the log sink
 *     and the thread count: a later sk_init() with a different sk_init_options.log
 *     returns SK_OK and changes nothing. The caller must keep that first callback (and
 *     its log_user) alive for the life of the process.
 *   - Strings and buffers this library hands back through an out-parameter are
 *     malloc-allocated and owned by the caller, who releases each one with sk_free().
 *     Pointers RETURNED directly (sk_version, sk_last_error, sk_engine_versions, the
 *     sk_audio_families entries) are static or thread-local storage: never freed. */
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

SK_API sk_status   sk_init(const sk_init_options *options);              /* idempotent; first call wins (see top) */
/* sk_devices lists placement targets only: CPU and GPU devices. ggml accelerator devices
 * (the Accelerate BLAS backend on macOS) are not listed — they are not something a stage
 * is placed on and they report no memory — but they remain loaded and the engines use
 * them on their own. Every listed device reports mem_total > 0 and mem_free > 0. */
SK_API int32_t     sk_devices(sk_device *out, int32_t capacity);        /* returns count written; 0 before sk_init */
SK_API sk_status   sk_device_free_mem(int32_t index, uint64_t *bytes);  /* SK_ERR_NOT_INITIALISED before sk_init */
SK_API int32_t     sk_abi_version(void);
SK_API const char *sk_version(void);                                    /* "0.1.0" */
SK_API const char *sk_engine_versions(void);                            /* "ggml=0.22.0;transcribe=0.2.2;..." */
SK_API const char *sk_last_error(void);                                 /* thread-local, "" when none */
SK_API void        sk_free(void *p);

/* Names of every audio.cpp model family compiled into this library, sorted. Includes
 * companions that share a build target with a selected family. Diagnostic only: the
 * sidecar's catalog decides what is supported. */
SK_API int32_t sk_audio_families(const char **out, int32_t capacity);

/* ---- ASR (transcribe.cpp) ----
 * A model is loaded once per (GGUF, device) and serialises its own compute: sk_asr_run,
 * sk_asr_stream_feed and sk_asr_stream_finalize on the same model never overlap (the
 * engine's 0.x contract). A model has at most one open stream. Pointers in sk_asr_caps
 * belong to the model (valid until sk_asr_unload); pointers in sk_stream_text belong to
 * the model and are valid until the next call on the stream that returned them. A
 * stream never outlives its model: finalize or close every stream before sk_asr_unload
 * — unload tears the session down beneath the handle, and any later call on it is
 * undefined. */
typedef struct sk_asr_model  sk_asr_model;
typedef struct sk_asr_stream sk_asr_stream;

typedef struct sk_asr_caps {
    int32_t            n_languages;
    const char *const *languages;          /* owned by the model; valid until sk_asr_unload */
    bool               supports_streaming;
    bool               supports_language_detect;
    int32_t            native_sample_rate;  /* 16000 for every family the catalog lists */
    const char        *arch;                /* e.g. "whisper"; owned by the model */
} sk_asr_caps;

/* Called by sk_asr_run: with text == NULL between decode steps (return false to cancel),
 * and once with the transcript when the run completes. Called by sk_asr_stream_finalize
 * once with the stream's FINAL text — the post-finalize full hypothesis, not the committed
 * display prefix (committed_text is best-effort append-only and never rolled back). `text`
 * is valid only during the call. */
typedef bool (*sk_text_cb)(const char *text, void *user);

typedef struct sk_stream_text {
    const char *committed;   /* append-only prefix; owned by the stream's model and reused
                               * by whichever stream is open; valid until the next call on
                               * that stream */
    const char *tentative;   /* volatile suffix; same lifetime */
} sk_stream_text;

SK_API sk_status sk_asr_load(const char *gguf, const sk_device *device, sk_asr_model **out);   /* device NULL = auto */
SK_API sk_status sk_asr_capabilities(sk_asr_model *, sk_asr_caps *out);
SK_API sk_status sk_asr_run(sk_asr_model *, const float *pcm, size_t n, const char *lang, sk_text_cb, void *user);
SK_API sk_status sk_asr_stream_open(sk_asr_model *, const char *lang, sk_asr_stream **out);
SK_API sk_status sk_asr_stream_feed(sk_asr_stream *, const float *pcm, size_t n, sk_stream_text *out);
SK_API sk_status sk_asr_stream_finalize(sk_asr_stream *, sk_text_cb, void *user);
SK_API void      sk_asr_stream_close(sk_asr_stream *);
SK_API void      sk_asr_unload(sk_asr_model *);

/* ---- VAD (audio.cpp silero_vad) ----
 * A VAD runs on the CPU device, at 16 kHz, on exactly 512-sample chunks fed in order.
 * Events are edge-triggered: START once when speech begins (sample = padded start), END
 * once when it ends (with the finished segment), NONE otherwise. sk_vad_finalize reports a
 * trailing open segment as END and resets. A VAD is not thread-safe; one caller at a time.
 * A failed sk_vad_feed consumes nothing — the engine does not advance its internal sample
 * cursor. Recover by retrying the SAME 512 samples, or by calling sk_vad_reset. Feeding the
 * NEXT chunk after a failure instead silently drops those 512 samples and permanently skews
 * every later sample index the VAD reports. */
typedef struct sk_vad sk_vad;

typedef struct sk_vad_options {
    const char *weights;        /* NULL = silero_vad_16k.safetensors next to this library */
    float       threshold;      /* <= 0 = 0.5 */
    int32_t     min_speech_ms;  /* <= 0 = 250 */
    int32_t     min_silence_ms; /* <= 0 = 100 */
    int32_t     speech_pad_ms;  /* < 0 = 30 (0 is a valid value) */
    float       max_speech_s;   /* <= 0 = unbounded */
} sk_vad_options;

enum sk_vad_kind { SK_VAD_NONE = 0, SK_VAD_SPEECH_START = 1, SK_VAD_SPEECH_END = 2 };

typedef struct sk_vad_event {
    int32_t kind;          /* sk_vad_kind */
    int64_t sample;        /* START: padded start sample; END: end sample */
    float   probability;   /* the probability at the transition */
    int64_t seg_start;     /* END only: the finished segment [seg_start, seg_end) in samples */
    int64_t seg_end;
} sk_vad_event;

SK_API sk_status sk_vad_open(const sk_vad_options *, sk_vad **out);      /* options NULL = all defaults */
SK_API sk_status sk_vad_feed(sk_vad *, const float *pcm512, sk_vad_event *out);   /* exactly 512 samples @ 16 kHz */
SK_API sk_status sk_vad_finalize(sk_vad *, sk_vad_event *out);           /* end of audio: closes an open segment (END or NONE), then resets */
SK_API void      sk_vad_reset(sk_vad *);
SK_API void      sk_vad_close(sk_vad *);

#ifdef __cplusplus
}
#endif
#endif /* SOKUJI_NATIVE_H */
