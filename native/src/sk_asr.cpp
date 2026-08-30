#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include "transcribe.h"

#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

struct sk_asr_model {
    transcribe_model   *model   = nullptr;
    transcribe_session *session = nullptr;
    std::mutex          mutex;
    std::vector<std::string>  language_storage;
    std::vector<const char *> languages;
    std::string         arch;
    sk_asr_caps         caps{};
    bool                stream_open = false;
    std::string         run_text, committed, tentative;
};

namespace {

sk_status map_status(transcribe_status st) {
    switch (st) {
        case TRANSCRIBE_OK:
        case TRANSCRIBE_ERR_OUTPUT_TRUNCATED:       return SK_OK;
        case TRANSCRIBE_ERR_FILE_NOT_FOUND:         return SK_ERR_NOT_FOUND;
        case TRANSCRIBE_ERR_INVALID_ARG:
        case TRANSCRIBE_ERR_BAD_STRUCT_SIZE:
        case TRANSCRIBE_ERR_UNSUPPORTED_LANGUAGE:
        case TRANSCRIBE_ERR_NOT_IMPLEMENTED:
        case TRANSCRIBE_ERR_INPUT_TOO_LONG:
        case TRANSCRIBE_ERR_SAMPLE_RATE:
        case TRANSCRIBE_ERR_UNSUPPORTED_TASK:
        case TRANSCRIBE_ERR_UNSUPPORTED_TIMESTAMPS:
        case TRANSCRIBE_ERR_UNSUPPORTED_PNC:
        case TRANSCRIBE_ERR_UNSUPPORTED_ITN:         return SK_ERR_INVALID_ARGUMENT;
        case TRANSCRIBE_ERR_ABORTED:                return SK_ERR_CANCELLED;
        case TRANSCRIBE_ERR_OOM:
        case TRANSCRIBE_ERR_BACKEND:
        case TRANSCRIBE_ERR_GGUF:
        case TRANSCRIBE_ERR_UNSUPPORTED_ARCH:
        case TRANSCRIBE_ERR_UNSUPPORTED_VARIANT:    return SK_ERR_BACKEND;
        default:                                    return SK_ERR_INTERNAL;
    }
}

sk_status fail(const char *fn, transcribe_status st, const char *detail = nullptr) {
    std::string msg = std::string(fn) + ": " + transcribe_status_string(st);
    if (detail && *detail) msg += std::string(": ") + detail;
    sk::set_error(msg);
    return map_status(st);
}

transcribe_backend_request backend_for(int32_t kind) {
    switch (kind) {
        case SK_DEVICE_CPU:    return TRANSCRIBE_BACKEND_CPU;
        case SK_DEVICE_VULKAN: return TRANSCRIBE_BACKEND_VULKAN;
        case SK_DEVICE_METAL:  return TRANSCRIBE_BACKEND_METAL;
        default:               return TRANSCRIBE_BACKEND_AUTO;
    }
}

struct run_ctx {
    sk_text_cb cb;
    void *user;
    bool cancelled;
};

bool abort_poll(void *p) {                       // transcribe.cpp polls this between decode steps
    auto *c = static_cast<run_ctx *>(p);
    if (!c->cb) return false;
    if (c->cb(nullptr, c->user)) return false;   // keep going
    c->cancelled = true;
    return true;                                 // abort
}

}  // namespace

struct sk_asr_stream {
    sk_asr_model *model;
};

namespace {
// Copy the session's committed/tentative view into the model's buffers (caller holds m->mutex).
sk_status snapshot_text(sk_asr_model *m, const char *fn) {
    transcribe_stream_text t;
    transcribe_stream_text_init(&t);
    transcribe_status st = transcribe_stream_get_text(m->session, &t);
    if (st != TRANSCRIBE_OK) return fail(fn, st);
    m->committed.assign(t.committed_text ? t.committed_text : "", t.committed_text ? t.committed_text_bytes : 0);
    m->tentative.assign(t.tentative_text ? t.tentative_text : "", t.tentative_text ? t.tentative_text_bytes : 0);
    return SK_OK;
}
}  // namespace

extern "C" {

SK_API sk_status sk_asr_load(const char *gguf, const sk_device *device, sk_asr_model **out) {
    if (out) *out = nullptr;
    if (!gguf || !*gguf || !out) { sk::set_error("sk_asr_load: gguf path and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }

    transcribe_model_load_params lp;
    transcribe_model_load_params_init(&lp);
    int threads = 0;
    {
        std::lock_guard<std::mutex> lock(sk::mutex());
        if (!sk::require_init("sk_asr_load")) return SK_ERR_NOT_INITIALISED;
        threads = sk::threads();
        if (device) {
            const auto &devs = sk::devices();
            if (device->index < 0 || static_cast<size_t>(device->index) >= devs.size()) {
                sk::set_error("sk_asr_load: unknown device index " + std::to_string(device->index));
                return SK_ERR_INVALID_ARGUMENT;
            }
            ggml_backend_dev_t dev = devs[static_cast<size_t>(device->index)];
            lp.backend = backend_for(sk::kind_of(dev));                       // Ruling J
            lp.device  = reinterpret_cast<transcribe_device_t>(dev);
        } else {
            lp.backend = TRANSCRIBE_BACKEND_AUTO;
        }
    }   // model loading takes seconds; never hold the library lock for it

    transcribe_model *model = nullptr;
    transcribe_status st = transcribe_model_load_file(gguf, &lp, &model);
    if (st != TRANSCRIBE_OK) return fail("sk_asr_load", st, gguf);

    transcribe_session_params sp;
    transcribe_session_params_init(&sp);
    sp.n_threads = threads;
    transcribe_session *session = nullptr;
    st = transcribe_session_init(model, &sp, &session);
    if (st != TRANSCRIBE_OK) { transcribe_model_free(model); return fail("sk_asr_load: session", st, gguf); }

    auto *h = new sk_asr_model;
    h->model = model;
    h->session = session;

    transcribe_capabilities caps;
    transcribe_capabilities_init(&caps);
    if (transcribe_model_get_capabilities(model, &caps) == TRANSCRIBE_OK) {
        for (int i = 0; i < caps.n_languages && caps.languages; ++i)
            h->language_storage.emplace_back(caps.languages[i] ? caps.languages[i] : "");
        h->caps.supports_streaming       = caps.supports_streaming;
        h->caps.supports_language_detect = caps.supports_language_detect;
        h->caps.native_sample_rate       = caps.native_sample_rate > 0 ? caps.native_sample_rate : 16000;
    } else {
        h->caps.native_sample_rate = 16000;
    }
    h->languages.reserve(h->language_storage.size());          // pointers only after storage is final
    for (const auto &s : h->language_storage) h->languages.push_back(s.c_str());
    h->caps.n_languages = static_cast<int32_t>(h->languages.size());
    h->caps.languages   = h->languages.empty() ? nullptr : h->languages.data();
    const char *arch = transcribe_model_arch_string(model);
    h->arch = arch ? arch : "";
    h->caps.arch = h->arch.c_str();

    *out = h;
    return SK_OK;
}

SK_API sk_status sk_asr_capabilities(sk_asr_model *m, sk_asr_caps *out) {
    if (!m || !out) { sk::set_error("sk_asr_capabilities: model and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(m->mutex);
    *out = m->caps;
    return SK_OK;
}

SK_API sk_status sk_asr_run(sk_asr_model *m, const float *pcm, size_t n, const char *lang, sk_text_cb cb, void *user) {
    if (!m || (!pcm && n > 0) || n > static_cast<size_t>(INT32_MAX)) {
        sk::set_error("sk_asr_run: model and pcm (n <= INT32_MAX) are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(m->mutex);
    if (m->stream_open) { sk::set_error("sk_asr_run: a stream is open on this model"); return SK_ERR_INVALID_ARGUMENT; }
    m->run_text.clear();
    if (n == 0) { if (cb) cb("", user); return SK_OK; }

    transcribe_run_params rp;
    transcribe_run_params_init(&rp);
    rp.language = (lang && *lang) ? lang : nullptr;              // NULL = autodetect (transcribe.h:1041)

    run_ctx ctx{cb, user, false};
    transcribe_set_abort_callback(m->session, abort_poll, &ctx);
    transcribe_status st = transcribe_run(m->session, pcm, static_cast<int>(n), &rp);
    transcribe_set_abort_callback(m->session, nullptr, nullptr);

    if (st == TRANSCRIBE_ERR_ABORTED || ctx.cancelled) { sk::set_error("sk_asr_run: cancelled by the callback"); return SK_ERR_CANCELLED; }
    if (st != TRANSCRIBE_OK && st != TRANSCRIBE_ERR_OUTPUT_TRUNCATED) return fail("sk_asr_run", st);

    const char *text = transcribe_full_text(m->session);
    m->run_text = text ? text : "";
    if (cb) cb(m->run_text.c_str(), user);
    return SK_OK;
}

SK_API sk_status sk_asr_stream_open(sk_asr_model *m, const char *lang, sk_asr_stream **out) {
    if (out) *out = nullptr;
    if (!m || !out) { sk::set_error("sk_asr_stream_open: model and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->caps.supports_streaming) { sk::set_error("sk_asr_stream_open: this model does not support streaming"); return SK_ERR_INVALID_ARGUMENT; }
    if (m->stream_open) { sk::set_error("sk_asr_stream_open: a stream is already open on this model"); return SK_ERR_INVALID_ARGUMENT; }

    transcribe_run_params rp;
    transcribe_run_params_init(&rp);
    rp.language = (lang && *lang) ? lang : nullptr;
    transcribe_stream_params sp;
    transcribe_stream_params_init(&sp);                              // family defaults, AUTO commit policy
    transcribe_status st = transcribe_stream_begin(m->session, &rp, &sp);
    if (st != TRANSCRIBE_OK) return fail("sk_asr_stream_open", st);

    m->stream_open = true;
    m->committed.clear();
    m->tentative.clear();
    *out = new sk_asr_stream{m};
    return SK_OK;
}

SK_API sk_status sk_asr_stream_feed(sk_asr_stream *s, const float *pcm, size_t n, sk_stream_text *out) {
    if (!s || !s->model || (!pcm && n > 0) || n > static_cast<size_t>(INT32_MAX)) {
        sk::set_error("sk_asr_stream_feed: stream and pcm (n <= INT32_MAX) are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    sk_asr_model *m = s->model;
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->stream_open) { sk::set_error("sk_asr_stream_feed: the stream is finalized or closed"); return SK_ERR_INVALID_ARGUMENT; }
    if (n > 0) {
        transcribe_stream_update u;
        transcribe_stream_update_init(&u);
        transcribe_status st = transcribe_stream_feed(m->session, pcm, static_cast<int>(n), &u);
        if (st != TRANSCRIBE_OK) return fail("sk_asr_stream_feed", st);
    }
    sk_status rc = snapshot_text(m, "sk_asr_stream_feed");
    if (rc != SK_OK) return rc;
    if (out) { out->committed = m->committed.c_str(); out->tentative = m->tentative.c_str(); }
    return SK_OK;
}

SK_API sk_status sk_asr_stream_finalize(sk_asr_stream *s, sk_text_cb cb, void *user) {
    if (!s || !s->model) { sk::set_error("sk_asr_stream_finalize: stream is required"); return SK_ERR_INVALID_ARGUMENT; }
    sk_asr_model *m = s->model;
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->stream_open) { sk::set_error("sk_asr_stream_finalize: the stream is finalized or closed"); return SK_ERR_INVALID_ARGUMENT; }
    transcribe_stream_update u;
    transcribe_stream_update_init(&u);
    transcribe_status st = transcribe_stream_finalize(m->session, &u);
    sk_status rc;
    if (st == TRANSCRIBE_OK || st == TRANSCRIBE_ERR_OUTPUT_TRUNCATED) {
        // Ruling N: the final text is the post-finalize FULL hypothesis. committed_text is
        // a best-effort append-only display prefix that transcribe.cpp never rolls back —
        // on moonshine-streaming-tiny it demonstrably ends stale while full_text is right.
        transcribe_stream_text t;
        transcribe_stream_text_init(&t);
        transcribe_status gt = transcribe_stream_get_text(m->session, &t);
        if (gt == TRANSCRIBE_OK) {
            m->run_text.assign(t.full_text ? t.full_text : "", t.full_text ? t.full_text_bytes : 0);
            rc = SK_OK;
        } else {
            rc = fail("sk_asr_stream_finalize", gt);
        }
    } else {
        rc = fail("sk_asr_stream_finalize", st);
    }
    transcribe_stream_reset(m->session);                              // back to idle either way (Ruling F)
    m->stream_open = false;
    if (rc != SK_OK) return rc;
    if (cb) cb(m->run_text.c_str(), user);
    return SK_OK;
}

SK_API void sk_asr_stream_close(sk_asr_stream *s) {
    if (!s) return;
    if (sk_asr_model *m = s->model) {
        std::lock_guard<std::mutex> lock(m->mutex);
        if (m->stream_open) { transcribe_stream_reset(m->session); m->stream_open = false; }   // abandon
    }
    delete s;
}

SK_API void sk_asr_unload(sk_asr_model *m) {
    if (!m) return;
    {
        std::lock_guard<std::mutex> lock(m->mutex);
        if (m->session) transcribe_session_free(m->session);   // tears down any stream state too
        if (m->model)   transcribe_model_free(m->model);
        m->session = nullptr;
        m->model = nullptr;
    }
    delete m;
}

}  // extern "C"
