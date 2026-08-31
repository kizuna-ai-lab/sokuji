#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include "llama.h"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

struct sk_translate {
    llama_model    *model = nullptr;
    llama_context  *ctx   = nullptr;
    llama_sampler  *chain = nullptr;   // greedy chain, owns the one sampler it holds
    std::mutex      mutex;
    // Backing storage for llama_model_params.devices when a GPU device was requested at
    // load time: llama.cpp reads this NULL-terminated array during loading only, but it
    // must outlive the (unlocked) call, so it lives on the handle rather than the stack.
    std::vector<ggml_backend_dev_t> devs;
};

namespace {

bool g_llama_backend_ready = false;   // guarded by sk::mutex(); llama_backend_init()/llama_log_set() run once/process

sk_status fail(const char *fn, const std::string &detail) {
    sk::set_error(std::string(fn) + ": llama: " + detail);
    return SK_ERR_BACKEND;
}

// Mirrors sk_common.cpp's ggml_log_bridge: forwards llama's own logger (GGUF metadata dumps,
// tensor-by-tensor load progress, load-failure reasons) into the sk_init log sink instead of
// llama's default of printing straight to stderr. Installed once per process, alongside
// llama_backend_init().
void llama_log_bridge(enum ggml_log_level level, const char *text, void *) {
    int32_t mapped = level >= GGML_LOG_LEVEL_ERROR ? 3 : level == GGML_LOG_LEVEL_WARN ? 2 : level == GGML_LOG_LEVEL_INFO ? 1 : 0;
    std::string line(text ? text : "");
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (!line.empty()) sk::log_line(mapped, line.c_str());
}

sk_status fail_decode(const char *fn, int32_t rc) {
    if (rc == 1) {
        // Not an engine bug: the prompt plus what's been generated so far no longer fits in
        // n_ctx. Caller-configurable (raise n_ctx or shorten the prompt), so this is
        // SK_ERR_INVALID_ARGUMENT rather than SK_ERR_BACKEND — the sidecar can act on the
        // status without string-matching sk_last_error().
        sk::set_error(std::string(fn) + ": context full (prompt + generation exceed n_ctx)");
        return SK_ERR_INVALID_ARGUMENT;
    }
    // rc == 2 and any other positive value are llama's own warnings (2 == "aborted"; the
    // engine reserves other positive codes for future use) rather than a hard failure, but
    // without a specific recovery for them we conservatively surface every one as a backend
    // error. Negative rc (other than the invalid-input-batch case below) is always fatal.
    std::string what = (rc == 2) ? "aborted" : (rc == -1) ? "invalid input batch"
                                              : "fatal decode error (rc=" + std::to_string(rc) + ")";
    return fail(fn, what);
}

// Tokenize `text`; grows the buffer once on the negative-size-needed signal from
// llama_tokenize and retries (that second call is guaranteed to fit). A return so negative
// it signals llama_tokenize's own int32 overflow (rather than "needed size") is reported as
// SK_ERR_INVALID_ARGUMENT instead of negated — negating INT32_MIN is undefined behaviour.
sk_status tokenize(const llama_vocab *vocab, const std::string &text, std::vector<llama_token> &out) {
    out.resize(text.size() + 8);   // generous guess: plus a few for BOS/special tokens
    int32_t n = llama_tokenize(vocab, text.c_str(), static_cast<int32_t>(text.size()),
                                out.data(), static_cast<int32_t>(out.size()), true, true);
    if (n < 0) {
        if (n < -(1 << 28)) {   // overflow guard: llama_tokenize returned INT32_MIN, not a needed-size
            sk::set_error("sk_translate: prompt too large");
            return SK_ERR_INVALID_ARGUMENT;
        }
        out.resize(static_cast<size_t>(-n));
        n = llama_tokenize(vocab, text.c_str(), static_cast<int32_t>(text.size()),
                            out.data(), static_cast<int32_t>(out.size()), true, true);
        if (n < 0) { sk::set_error("sk_translate: tokenize: failed"); return SK_ERR_BACKEND; }
    }
    out.resize(static_cast<size_t>(n));
    return SK_OK;
}

// Renders one decoded token as UTF-8; grows the buffer once on the negative-size-needed
// signal from llama_token_to_piece and retries.
std::string token_piece(const llama_vocab *vocab, llama_token tok) {
    char small[64];
    int32_t n = llama_token_to_piece(vocab, tok, small, sizeof(small), 0, false);
    if (n >= 0) return std::string(small, static_cast<size_t>(n));
    std::vector<char> big(static_cast<size_t>(-n));
    n = llama_token_to_piece(vocab, tok, big.data(), static_cast<int32_t>(big.size()), 0, false);
    return std::string(big.data(), static_cast<size_t>(n > 0 ? n : 0));
}

// Stateless generation shared by sk_translate_chat and sk_translate_complete. Caller holds
// t->mutex. Clears KV memory, evaluates `prompt`, then greedily decodes up to max_tokens,
// invoking cb once per piece; cb returning false cancels before the next decode step.
sk_status generate(sk_translate *t, const std::string &prompt, const sk_gen_options *gen,
                    sk_text_cb cb, void *user) {
    const llama_vocab *vocab = llama_model_get_vocab(t->model);
    llama_memory_clear(llama_get_memory(t->ctx), true);

    std::vector<llama_token> tokens;
    sk_status trc = tokenize(vocab, prompt, tokens);
    if (trc != SK_OK) return trc;
    if (tokens.empty()) {
        // e.g. an empty prompt on a model with add_bos_token=false (Qwen3): zero tokens means
        // no llama_decode call happens below, so llama_sampler_sample would read logits that
        // were never produced (GGML_ASSERT(logits != nullptr), a process-killing abort).
        sk::set_error("sk_translate: prompt tokenized to zero tokens");
        return SK_ERR_INVALID_ARGUMENT;
    }

    // llama clamps the context's actual batch size to min(n_ctx, requested n_batch) at
    // sk_translate_load time, so a small sk_translate_options.n_ctx can make it smaller than
    // the literal 512 we requested — read it back rather than assuming our own request stuck.
    const int32_t n_batch = static_cast<int32_t>(llama_n_batch(t->ctx));
    for (int32_t off = 0; off < static_cast<int32_t>(tokens.size()); off += n_batch) {
        int32_t chunk = std::min(n_batch, static_cast<int32_t>(tokens.size()) - off);
        llama_batch batch = llama_batch_get_one(tokens.data() + off, chunk);
        int32_t rc = llama_decode(t->ctx, batch);
        if (rc != 0) return fail_decode("sk_translate: prompt eval", rc);
    }

    llama_sampler_reset(t->chain);
    int32_t max_tokens = (gen && gen->max_tokens > 0) ? gen->max_tokens : 512;
    for (int32_t i = 0; i < max_tokens; ++i) {
        llama_token tok = llama_sampler_sample(t->chain, t->ctx, -1);
        if (llama_vocab_is_eog(vocab, tok)) break;

        std::string piece = token_piece(vocab, tok);
        if (cb && !cb(piece.c_str(), user)) {
            sk::set_error("sk_translate: cancelled");
            return SK_ERR_CANCELLED;
        }

        llama_batch next = llama_batch_get_one(&tok, 1);
        int32_t rc = llama_decode(t->ctx, next);
        if (rc != 0) return fail_decode("sk_translate: decode", rc);
    }
    return SK_OK;
}

}  // namespace

extern "C" {

SK_API sk_status sk_translate_load(const char *gguf_path, const sk_device *device,
                                    const sk_translate_options *opts, sk_translate **out) {
    if (out) *out = nullptr;
    if (!gguf_path || !*gguf_path || !out) {
        sk::set_error("sk_translate_load: gguf_path and out-pointer are required");
        return SK_ERR_INVALID_ARGUMENT;
    }

    auto *h = new sk_translate();
    llama_model_params mp = llama_model_default_params();
    int threads = 0;
    {
        std::lock_guard<std::mutex> lock(sk::mutex());
        if (!sk::require_init("sk_translate_load")) { delete h; return SK_ERR_NOT_INITIALISED; }
        threads = sk::threads();
        if (!g_llama_backend_ready) {
            llama_log_set(llama_log_bridge, nullptr);   // before init, so init's own log lines route too
            llama_backend_init();
            g_llama_backend_ready = true;
        }
        if (device) {
            const auto &devs = sk::devices();
            if (device->index < 0 || static_cast<size_t>(device->index) >= devs.size()) {
                sk::set_error("sk_translate_load: unknown device index " + std::to_string(device->index));
                delete h;
                return SK_ERR_INVALID_ARGUMENT;
            }
            ggml_backend_dev_t dev = devs[static_cast<size_t>(device->index)];
            if (sk::kind_of(dev) == SK_DEVICE_CPU) {
                mp.n_gpu_layers = 0;
                mp.devices = nullptr;
            } else {
                h->devs = {dev, nullptr};             // NULL-terminated, per llama_model_params.devices
                mp.devices = h->devs.data();
                mp.n_gpu_layers = -1;                 // all layers
            }
        }   // device == NULL: leave llama's own defaults (all available devices)
    }   // model loading takes seconds; never hold the library lock for it

    llama_model *model = llama_model_load_from_file(gguf_path, mp);
    if (!model) {
        delete h;
        return fail("sk_translate_load", std::string("failed to load ") + gguf_path);
    }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = (opts && opts->n_ctx > 0) ? static_cast<uint32_t>(opts->n_ctx) : 4096;
    cp.n_batch         = 512;
    cp.n_threads       = threads;
    cp.n_threads_batch = threads;

    llama_context *ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        llama_model_free(model);
        delete h;
        return fail("sk_translate_load", std::string("failed to create context for ") + gguf_path);
    }

    llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    llama_sampler *chain = llama_sampler_chain_init(sp);
    llama_sampler_chain_add(chain, llama_sampler_init_greedy());   // chain owns it; freed by llama_sampler_free(chain)

    h->model = model;
    h->ctx   = ctx;
    h->chain = chain;
    *out = h;
    return SK_OK;
}

SK_API sk_status sk_translate_chat(sk_translate *t, const sk_message *msgs, int32_t n_msgs,
                                    const sk_gen_options *gen, sk_text_cb on_token, void *user) {
    if (!t || n_msgs < 0 || (!msgs && n_msgs > 0)) {
        sk::set_error("sk_translate_chat: handle and msgs (n_msgs >= 0) are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(t->mutex);

    static const char *kTemplateUnsupported =
        "sk_translate_chat: chat template not supported by the legacy formatter; "
        "render the prompt and use sk_translate_complete";

    const char *tmpl = llama_model_chat_template(t->model, nullptr);
    if (!tmpl) { sk::set_error(kTemplateUnsupported); return SK_ERR_INVALID_ARGUMENT; }

    std::vector<llama_chat_message> chat(static_cast<size_t>(n_msgs));
    size_t total_bytes = 0;
    for (int32_t i = 0; i < n_msgs; ++i) {
        chat[static_cast<size_t>(i)].role    = msgs[i].role    ? msgs[i].role    : "";
        chat[static_cast<size_t>(i)].content = msgs[i].content ? msgs[i].content : "";
        total_bytes += std::strlen(chat[static_cast<size_t>(i)].role)
                     + std::strlen(chat[static_cast<size_t>(i)].content);
    }

    size_t needed = 2 * total_bytes + 1024;   // computed in size_t: total_bytes can approach SIZE_MAX
    if (needed > static_cast<size_t>(INT32_MAX)) {
        sk::set_error("sk_translate_chat: messages too large");
        return SK_ERR_INVALID_ARGUMENT;
    }
    int32_t buf_size = static_cast<int32_t>(needed);
    std::vector<char> buf(static_cast<size_t>(buf_size));
    int32_t n = llama_chat_apply_template(tmpl, chat.data(), static_cast<size_t>(n_msgs), true,
                                           buf.data(), buf_size);
    if (n >= 0 && n > buf_size) {   // buffer was too small; the header docs say re-alloc and re-apply
        buf_size = n;
        buf.resize(static_cast<size_t>(buf_size));
        n = llama_chat_apply_template(tmpl, chat.data(), static_cast<size_t>(n_msgs), true,
                                       buf.data(), buf_size);
    }
    if (n < 0) { sk::set_error(kTemplateUnsupported); return SK_ERR_INVALID_ARGUMENT; }

    std::string prompt(buf.data(), static_cast<size_t>(n));
    if (gen && gen->assistant_prefill) prompt += gen->assistant_prefill;   // Ruling R1(s3): thinking kill-switch

    return generate(t, prompt, gen, on_token, user);
}

SK_API sk_status sk_translate_complete(sk_translate *t, const char *prompt,
                                        const sk_gen_options *gen, sk_text_cb on_token, void *user) {
    if (!t || !prompt) {
        sk::set_error("sk_translate_complete: handle and prompt are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(t->mutex);
    return generate(t, prompt, gen, on_token, user);
}

SK_API void sk_translate_unload(sk_translate *t) {
    if (!t) return;
    {
        std::lock_guard<std::mutex> lock(t->mutex);
        if (t->chain) llama_sampler_free(t->chain);   // frees the chain and the greedy sampler it owns
        if (t->ctx)   llama_free(t->ctx);
        if (t->model) llama_model_free(t->model);
        t->chain = nullptr;
        t->ctx   = nullptr;
        t->model = nullptr;
    }
    delete t;
}

}  // extern "C"
