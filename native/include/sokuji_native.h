/* sokuji-native — the one C ABI the sidecar talks to.
 * Conventions: opaque handles; every call returns sk_status (0 ok, negative error) and
 * sk_last_error() carries a thread-local UTF-8 message; callbacks take a void *user and
 * return bool — false cancels; threads are configured once in sk_init(). Prefixes name
 * the stage (sk_asr_, sk_translate_, sk_tts_), never the engine behind it.
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

#define SK_ABI_VERSION 2

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
    int32_t     n_threads;     /* 0 = native policy: min(hardware_concurrency, an internal
                                 * knee measured on real CPU hardware) rather than raw
                                 * hardware_concurrency. ggml's ggml_barrier() is a pure
                                 * spin-wait with no futex/sched_yield fallback, so once the
                                 * worker count reaches the core count a single descheduled
                                 * worker (the main thread, the Python interpreter, any other
                                 * process) makes every other worker spin-burn its timeslice —
                                 * measured 2.55x run-to-run spread at n_threads==nproc vs
                                 * ~1.03x at the knee (vulkan-perf-investigation.md §Q2).
                                 * The cap is 12, so it only CHANGES anything on a box with
                                 * more than 12 hardware threads: the collapse above is a
                                 * 20-thread Linux/aarch64 measurement (GB10), and a 10-core
                                 * Apple M4 re-run of the same sweep showed no collapse at
                                 * all at n_threads==hw (every family within 1.03x of its own
                                 * best, spreads <=1.025x), which is exactly what min(hw, 12)
                                 * already does there — it runs at hw. A positive value here
                                 * is always honored verbatim — this policy applies ONLY to
                                 * the 0 (unspecified) case — so a caller that wants raw
                                 * hardware_concurrency can still pass it explicitly. See
                                 * sk_threads() for the resolved value. */
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

/* ---- device profile (ABI 2) -------------------------------------------------------- */
enum sk_feature {
    /* Vulkan: RAW feature bits from the physical device. ggml applies further gates
     * before using any of them (build-time GGML_VULKAN_*_GLSLC_SUPPORT, the
     * GGML_VK_DISABLE_* environment, per-driver deny-lists for coopmat), so a set bit
     * means "the device offers it", not "ggml uses it". Diagnostics only; never a gate. */
    SK_FEAT_VK_SHADER_FLOAT16       = 1u << 0,
    SK_FEAT_VK_SHADER_BFLOAT16      = 1u << 1,
    SK_FEAT_VK_INTEGER_DOT          = 1u << 2,
    SK_FEAT_VK_COOPMAT              = 1u << 3,
    SK_FEAT_VK_COOPMAT2             = 1u << 4,
    /* Metal: supports_op ANSWERS (they equal what ggml will do). SIMDGROUP_REDUCTION is
     * the one profile bit that gates — tier level, in the sidecar's _tier_available,
     * because NORM is in every family's graph (ruling R36). */
    SK_FEAT_MTL_SIMDGROUP_REDUCTION = 1u << 5,   /* supports_op(NORM, contiguous f32 src) */
    SK_FEAT_MTL_BFLOAT              = 1u << 6,   /* supports_op(CONCAT, bf16, bf16): has_bfloat alone */
    /* Both: */
    SK_FEAT_UMA                     = 1u << 7,   /* Vulkan: deviceType == INTEGRATED_GPU (ggml's rule); Metal: always */
};

typedef struct sk_device_profile {
    int32_t  index;               /* same flat index as sk_device.index */
    int32_t  known;               /* 0 = nothing below is meaningful; consumers pass through */
    uint32_t features;            /* sk_feature bits; only meaningful when known */
    char     driver_name[256];    /* Vulkan: VkPhysicalDeviceDriverProperties.driverName; Metal: "Metal"; CPU: "" */
    char     driver_version[256]; /* Vulkan: driverInfo; Metal: sysctl kern.osversion; CPU: "" */
    char     device_uuid[40];     /* Vulkan: deviceUUID as 32 hex chars; else "" */
    char     cpu_features[512];   /* CPU device only: "AVX2=1,FMA=1,..." from ggml_backend_get_features */
} sk_device_profile;

/* SK_ERR_INVALID_ARGUMENT for a bad index or NULL out; SK_ERR_NOT_INITIALISED before
 * sk_init; otherwise SK_OK, with known = 0 when the profile could not be read. Strings
 * longer than their buffer are truncated (the buffers are Vulkan's own maxima). */
SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out);

/* ---- op coverage (ABI 2) ------------------------------------------------------------ */
/* One recorded node, spelled "OP.param[src0,src1,src2,src3,src4]->dst" (ggml_op_name and
 * ggml_type_name, "-" for an absent source), and whether the device's supports_op
 * accepted it rebuilt with its recorded shapes. */
typedef struct sk_op_check { char name[64]; int32_t supported; } sk_op_check;
/* Widest shipped recording (tts/index_tts2: 499 identities, 67 WEIGHT) expanded over the
 * widest fallback dtype set (7, gen_ops_data.py's WIDEST_FALLBACK) reaches 901 entries, and
 * over q8_0's 4-dtype rung set still 700 — both exceed 512, so the cap is 2048. */
#define SK_OP_COVERAGE_MAX 2048
typedef struct sk_op_coverage {
    int32_t n_ops;            /* entries written */
    int32_t all_supported;    /* 1 iff every entry is supported */
    sk_op_check ops[SK_OP_COVERAGE_MAX];
} sk_op_coverage;

/* stage: "asr" | "translate" | "tts". family: the catalog card's graph_family.
 * weight_dtypes: the ggml type names WEIGHT expands over ("q4_K", "q8_0", "bf16", "f16",
 * "f32", ...), deduplicated internally (first-seen order) before expansion. A WEIGHT node
 * whose recorded row length is not a multiple of a dtype's block size is skipped for that
 * dtype only (no GGUF can hold that tensor in it; f32/f16 have block size 1, so the node is
 * still asked in whichever dtype the real file would use). A dtype that is neither a float
 * (f32/f16/bf16) nor a quantized type is skipped the same way: a WEIGHT node is the src0 of a
 * MUL_MAT/MUL_MAT_ID/GET_ROWS, and the integer types a GGUF header lists (i32/i64) are index
 * tables, never rung weights — so a caller may pass a raw header dtype set straight through.
 * A node the recording tagged `host=1` ran on a host backend — audio.cpp builds a different
 * graph there and never sends those nodes to a device — so it is asked only when `index` names
 * a CPU device, and skipped otherwise. Unknown (stage, family) →
 * SK_ERR_NOT_FOUND; bad index, NULL out, n_weight_dtypes <= 0 or an unknown dtype name →
 * SK_ERR_INVALID_ARGUMENT; more than SK_OP_COVERAGE_MAX expanded entries → SK_ERR_INTERNAL;
 * a backend exception → SK_ERR_BACKEND. Callers treat every error as "unknown", never as
 * "unsupported". */
SK_API sk_status sk_device_supports_ops(int32_t index, const char *stage, const char *family,
                                        const char *const *weight_dtypes, int32_t n_weight_dtypes,
                                        sk_op_coverage *out);

/* The op recordings baked into this library (spec A §3.2): count, and the i-th recording's
 * stage, family and .ops text (pointers owned by the library, valid for its lifetime). */
SK_API int32_t   sk_ops_blob_count(void);
SK_API sk_status sk_ops_blob_at(int32_t i, const char **stage, const char **family, const char **text);

SK_API sk_status   sk_init(const sk_init_options *options);              /* idempotent; first call wins (see top) */
SK_API int32_t     sk_threads(void);   /* resolved n_threads after sk_init (see its doc for the 0 policy); 0 before init */
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

/* ---- Translation (llama.cpp) ----
 * One loaded GGUF chat model per handle. Requests are stateless: each call clears the
 * KV memory, evaluates the prompt, and greedily decodes up to max_tokens, invoking
 * sk_text_cb once per decoded token piece (UTF-8, may split multibyte chars across
 * pieces — concatenate before display). The callback returning false cancels the
 * request (SK_ERR_CANCELLED). Calls on one handle are serialised internally.
 * sk_translate_chat renders the messages through the GGUF's own chat template
 * (llama_chat_apply_template, add_assistant=true) and then appends
 * gen->assistant_prefill verbatim when non-NULL — the mechanism for forcing an empty
 * think block on Qwen3-family models. A GGUF whose template the legacy formatter does
 * not know yields SK_ERR_INVALID_ARGUMENT with a "chat template not supported" message;
 * callers fall back to sk_translate_complete with a self-rendered prompt. */
typedef struct sk_translate sk_translate;
typedef struct sk_translate_options {
    int32_t n_ctx;        /* 0 = 4096 */
    int32_t flash_attn;   /* ABI 2: 0 = llama.cpp's own default, 1 = force on, 2 = force off.
                           * The op recorder records both settings (spec A §3.2.2). */
} sk_translate_options;
typedef struct sk_message { const char *role; const char *content; } sk_message;
typedef struct sk_gen_options {
    int32_t max_tokens;            /* <= 0 = 512 */
    const char *assistant_prefill; /* NULL = none */
} sk_gen_options;
SK_API sk_status sk_translate_load(const char *gguf_path, const sk_device *device,
                                   const sk_translate_options *opts, sk_translate **out);
SK_API sk_status sk_translate_chat(sk_translate *, const sk_message *msgs, int32_t n_msgs,
                                   const sk_gen_options *, sk_text_cb on_token, void *user);
SK_API sk_status sk_translate_complete(sk_translate *, const char *prompt,
                                       const sk_gen_options *, sk_text_cb on_token, void *user);
SK_API void      sk_translate_unload(sk_translate *);

/* ---- TTS (audio.cpp) ----
 * One loaded model per handle; family is REQUIRED and passed as audio.cpp's family_hint
 * string. One long-lived session per handle (offline or streaming per the family);
 * all access is serialised per handle (audio.cpp sessions are not thread-safe).
 * Voice state (clone clip + reference text, or a preset id) is stored on the handle and
 * applied to every subsequent synth. sk_tts_synth delivers f32 PCM through sk_audio_cb:
 * offline families call it exactly once with the whole buffer; streaming families call
 * it once per pulled chunk. The callback returning false cancels between chunks
 * (streaming) or discards the result (offline, which cannot be interrupted mid-run).
 * The authoritative sample rate rides every callback; caps.sample_rate is the family's
 * expected rate for pre-synth UI. Errors are audio.cpp exceptions mapped to sk_status
 * with sk_last_error carrying ex.what(). The per-handle lock is NOT recursive: calling any
 * sk_tts_* function on the same handle from inside sk_audio_cb (or sk_text_cb passed to
 * sk_tts_presets) deadlocks the calling thread — the callback may only read its own
 * arguments and touch caller-owned state. */
typedef struct sk_tts sk_tts;
typedef struct sk_tts_options {
    const char *family;    /* required: moss_tts_nano | qwen3_tts | omnivoice | pocket_tts |
                            * supertonic | voxcpm1 | voxcpm2 | irodori_tts | index_tts2 */
    const char *language;  /* pocket_tts load-time language package ("english", ...); ignored elsewhere; NULL ok */
} sk_tts_options;
typedef struct sk_tts_caps {
    bool streaming;            /* omnivoice, supertonic, voxcpm1, voxcpm2 */
    bool clones;               /* everything except supertonic */
    bool transcript_required;  /* omnivoice, qwen3_tts: reference_text is mandatory with a ref clip */
    int32_t sample_rate;       /* family default: 48000 moss+voxcpm2+irodori / 24000 qwen3+omnivoice+pocket /
                                * 44100 supertonic / 22050 index_tts2 / 16000 voxcpm1 */
} sk_tts_caps;
typedef bool (*sk_audio_cb)(const float *pcm, size_t n_samples, int32_t sample_rate,
                            int32_t channels, void *user);
SK_API sk_status sk_tts_load(const char *model_path, const sk_device *device,
                      const sk_tts_options *opts, sk_tts **out);
SK_API sk_status sk_tts_capabilities(sk_tts *, sk_tts_caps *);
SK_API sk_status sk_tts_presets(sk_tts *, sk_text_cb on_name, void *user);   /* one call per preset name; supertonic + pocket only, others succeed with zero calls */
SK_API sk_status sk_tts_set_voice(sk_tts *, const float *ref_pcm /* MONO f32 PCM; no channels param */,
                           size_t n /* sample count, not byte count */, int32_t sample_rate,
                           const char *ref_text /* NULL ok except omnivoice */);
SK_API sk_status sk_tts_set_preset(sk_tts *, const char *name);              /* clears any clone state */
SK_API sk_status sk_tts_synth(sk_tts *, const char *text, const char *language, float speed,
                       sk_audio_cb on_audio, void *user);
SK_API void      sk_tts_unload(sk_tts *);

/* ---- op recorder (test builds only: -DSOKUJI_RECORD_OPS=ON) ------------------------- */
#if defined(SK_RECORD_OPS)
/* Register the recording device with ggml's registry. MUST be called before the first
 * sk_init of the process (sk_init enumerates devices once, first call wins). Returns 1. */
SK_API int32_t   sk_record_register_device(void);
/* Start capturing. `weight_names`: every tensor name in the model file; `rung_ops`: the op
 * names whose src0 is a rung-bearing weight ("MUL_MAT", "MUL_MAT_ID", "GET_ROWS") — a src0
 * of one of those ops whose name is in weight_names is recorded as WEIGHT, every other
 * tensor with its literal dtype. */
SK_API void      sk_record_begin(const char *const *weight_names, int32_t n_names,
                                 const char *const *rung_ops, int32_t n_rung_ops);
/* Stop capturing and write the .ops file. `recorded_on` is the ggml device kind the model was
 * loaded on ("vulkan" | "metal" | "cpu"); it becomes the file's `# recorded-on:` header. A tts
 * recording taken on "cpu" is not a valid shipping recording — audio.cpp builds a different
 * graph on a host backend (see sk_ops.h's sk_op_desc::host). */
SK_API sk_status sk_record_end_to_file(const char *path, const char *stage, const char *family,
                                       const char *source_file, const char *recorded_on,
                                       const char *const *dtypes, int32_t n_dtypes);
SK_API int32_t   sk_record_node_count(void);
#endif

#ifdef __cplusplus
}
#endif
#endif /* SOKUJI_NATIVE_H */
