// translateLoad and Translator. A load runs on the misc worker; each loaded translator then
// owns a HandleWorker, and every chat() / complete() on it is a job on that worker, in call
// order. Each decoded token piece reaches onToken as a Uint8Array of its raw UTF-8 bytes: a
// piece may end inside a multibyte character, so the caller decodes with a streaming
// TextDecoder.
#include "addon.h"
#include "args.h"
#include "errors.h"
#include "job.h"
#include "model.h"
#include "worker.h"

#include <napi.h>
#include <sokuji_native.h>

#include <cstdint>
#include <cstring>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace sk_node {
namespace {

// The translator handle, shared by the Translator object and the jobs queued for it (model.h).
using TranslateHandle = NativeHandle<sk_translate, sk_translate_unload>;

// ---- Translator ---------------------------------------------------------------------------------

class Translator : public Napi::ObjectWrap<Translator> {
public:
    static Napi::Function Define(Napi::Env env);
    explicit Translator(const Napi::CallbackInfo &info);
    ~Translator() override;

private:
    Napi::Value Chat(const Napi::CallbackInfo &info);
    Napi::Value Complete(const Napi::CallbackInfo &info);
    Napi::Value Unload(const Napi::CallbackInfo &info);

    bool Unloading() const { return life_.Unloading(); }

    std::shared_ptr<TranslateHandle> handle_;
    ModelLifecycle life_;   // the translator's worker thread and unload (model.h)
};

// sk_translate_chat / sk_translate_complete. Everything the call reads (messages, prefill,
// prompt) is copied into the job before it is queued, so it outlives the JS call. The
// sk_text_cb trampoline runs on the translator's worker thread once per piece: it copies the
// piece (valid only during the call), posts it to onToken without waiting, and answers
// !cancel, so an abort or a throwing onToken stops the request at its next piece.
class GenerateJob : public Job {
public:
    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Resolve(env.Undefined());
    }

protected:
    GenerateJob(const char *what, std::shared_ptr<TranslateHandle> handle, int32_t max_tokens)
        : Job(what), handle_(std::move(handle)), max_tokens_(max_tokens) {}

    static bool OnToken(const char *piece, void *user) {
        auto *self = static_cast<GenerateJob *>(user);
        try {
            self->Emit([bytes = std::string(piece ? piece : "")](Napi::Env env, Napi::Function onToken) {
                Napi::Uint8Array a = Napi::Uint8Array::New(env, bytes.size());
                if (!bytes.empty()) std::memcpy(a.Data(), bytes.data(), bytes.size());
                onToken.Call({a});
            });
            return !self->cancel->load();
        } catch (...) {
            return false;   // nothing may unwind into the library (out of memory): stop the request
        }
    }

    std::shared_ptr<TranslateHandle> handle_;
    int32_t max_tokens_;   // <= 0: the library's 512
};

struct Message {
    std::string role;
    std::string content;
};

class ChatJob : public GenerateJob {
public:
    ChatJob(std::shared_ptr<TranslateHandle> handle, std::vector<Message> messages, int32_t max_tokens,
            std::optional<std::string> prefill)
        : GenerateJob("sk_translate_chat", std::move(handle), max_tokens), messages_(std::move(messages)),
          prefill_(std::move(prefill)) {}

    void execute() override {
        sk_translate *t = handle_->get();
        if (t == nullptr) return Fail("sk_translate_chat", SK_ERR_NOT_INITIALISED, "model is unloaded");
        std::vector<sk_message> msgs(messages_.size());
        for (size_t i = 0; i < messages_.size(); ++i) {
            msgs[i] = {messages_[i].role.c_str(), messages_[i].content.c_str()};
        }
        sk_gen_options gen{};
        gen.max_tokens = max_tokens_;
        gen.assistant_prefill = prefill_ ? prefill_->c_str() : nullptr;
        // A JS array never holds INT32_MAX objects: the heap gives out first.
        const sk_status st = sk_translate_chat(t, msgs.data(), static_cast<int32_t>(msgs.size()), &gen,
                                               &GenerateJob::OnToken, this);
        if (st != SK_OK) Fail("sk_translate_chat", st);
    }

private:
    std::vector<Message> messages_;
    std::optional<std::string> prefill_;
};

class CompleteJob : public GenerateJob {
public:
    CompleteJob(std::shared_ptr<TranslateHandle> handle, std::string prompt, int32_t max_tokens)
        : GenerateJob("sk_translate_complete", std::move(handle), max_tokens), prompt_(std::move(prompt)) {}

    void execute() override {
        sk_translate *t = handle_->get();
        if (t == nullptr) return Fail("sk_translate_complete", SK_ERR_NOT_INITIALISED, "model is unloaded");
        sk_gen_options gen{};
        gen.max_tokens = max_tokens_;
        const sk_status st = sk_translate_complete(t, prompt_.c_str(), &gen, &GenerateJob::OnToken, this);
        if (st != SK_OK) Fail("sk_translate_complete", st);
    }

private:
    std::string prompt_;
};

// sk_translate_load on the misc worker. Until settle hands the handle to a Translator, the job
// owns it: a load nobody settles (the environment went away) is freed with the job.
class LoadJob : public Job {
public:
    LoadJob(std::string path, std::optional<int32_t> device, sk_translate_options opts)
        : Job("sk_translate_load"), path_(std::move(path)), device_(device), opts_(opts) {}

    void execute() override {
        auto handle = std::make_shared<TranslateHandle>();   // allocated first: a load is never leaked
        sk_device dev{};
        if (device_) dev.index = *device_;
        sk_translate *t = nullptr;
        const sk_status st = sk_translate_load(path_.c_str(), device_ ? &dev : nullptr, &opts_, &t);
        if (st != SK_OK) return Fail("sk_translate_load", st);
        handle->Adopt(t);
        handle_ = std::move(handle);
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Resolve(Data(env).translator.New({Napi::External<std::shared_ptr<TranslateHandle>>::New(env, &handle_)}));
    }

private:
    std::string path_;
    std::optional<int32_t> device_;
    sk_translate_options opts_;
    std::shared_ptr<TranslateHandle> handle_;
};

Napi::Function Translator::Define(Napi::Env env) {
    return DefineClass(env, "Translator",
                       {
                           InstanceMethod("chat", &Translator::Chat),
                           InstanceMethod("complete", &Translator::Complete),
                           InstanceMethod("unload", &Translator::Unload),
                       });
}

Translator::Translator(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Translator>(info) {
    Napi::Env env = info.Env();
    if (info.Length() != 1 || !info[0].IsExternal()) throw Napi::TypeError::New(env, "Translator: use translateLoad()");
    life_.Start(env);
    handle_ = *info[0].As<Napi::External<std::shared_ptr<TranslateHandle>>>().Data();
}

// Collected without unload(), or the environment is going away (ModelLifecycle::Teardown).
Translator::~Translator() {
    life_.Teardown(handle_);
}

// messages: [{ role, content }, ...], copied.
std::vector<Message> MessagesArg(const Napi::CallbackInfo &info, size_t i) {
    Napi::Env env = info.Env();
    if (info.Length() <= i || !info[i].IsArray()) throw Napi::TypeError::New(env, "chat: messages must be an array");
    Napi::Array a = info[i].As<Napi::Array>();
    std::vector<Message> out;
    for (uint32_t k = 0; k < a.Length(); ++k) {
        Napi::Value m = a.Get(k);
        Napi::Value role = m.IsObject() ? m.As<Napi::Object>().Get("role") : env.Undefined();
        Napi::Value content = m.IsObject() ? m.As<Napi::Object>().Get("content") : env.Undefined();
        if (!role.IsString() || !content.IsString()) {
            throw Napi::TypeError::New(
                env, "chat: messages[" + std::to_string(k) + "] must be { role: string, content: string }");
        }
        out.push_back({role.As<Napi::String>().Utf8Value(), content.As<Napi::String>().Utf8Value()});
    }
    return out;
}

// chat(messages, { maxTokens?, assistantPrefill? }, { onToken, signal? }) → Promise<void>
Napi::Value Translator::Chat(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::vector<Message> messages = MessagesArg(info, 0);
    Napi::Object gen = OptionsArg(info, 1, "chat: gen");
    const int32_t max_tokens = Int32Option(gen, "maxTokens", 0, "chat: gen.maxTokens");
    std::optional<std::string> prefill = NullableStringOption(gen, "assistantPrefill", "chat: gen.assistantPrefill");
    CallOptions opts = CallOptionsArg(info, 2, "chat", "onToken", true);
    if (Unloading()) return RejectedUnloaded(env, "sk_translate_chat");
    auto job = std::make_unique<ChatJob>(handle_, std::move(messages), max_tokens, std::move(prefill));
    return Submit(env, life_.worker(), std::move(job), Value(), opts.callback, opts.signal);
}

// complete(prompt, { maxTokens? }, { onToken, signal? }) → Promise<void>
Napi::Value Translator::Complete(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string prompt = StringArg(info, 0, "complete: prompt");
    Napi::Object gen = OptionsArg(info, 1, "complete: gen");
    const int32_t max_tokens = Int32Option(gen, "maxTokens", 0, "complete: gen.maxTokens");
    CallOptions opts = CallOptionsArg(info, 2, "complete", "onToken", true);
    if (Unloading()) return RejectedUnloaded(env, "sk_translate_complete");
    auto job = std::make_unique<CompleteJob>(handle_, std::move(prompt), max_tokens);
    return Submit(env, life_.worker(), std::move(job), Value(), opts.callback, opts.signal);
}

// unload() → Promise<void>. Idempotent: every call returns the first call's promise. Jobs
// queued before it still run; then, on the translator's own thread, the model is freed and
// the thread ends. Later calls reject: model is unloaded.
Napi::Value Translator::Unload(const Napi::CallbackInfo &info) {
    return life_.Unload(info.Env(), Value(), "sk_translate_unload", handle_);
}

// translateLoad(path, deviceIndex | null, { nCtx?, flashAttn? }) → Promise<Translator>.
// nCtx 0 is the library's 4096; flashAttn 0 is llama.cpp's own default, 1 on, 2 off.
Napi::Value TranslateLoad(const Napi::CallbackInfo &info) {
    std::string path = StringArg(info, 0, "translateLoad: path");
    std::optional<int32_t> device = DeviceArg(info, 1, "translateLoad: deviceIndex");
    Napi::Object o = OptionsArg(info, 2, "translateLoad: opts");
    sk_translate_options opts{};
    opts.n_ctx = Int32Option(o, "nCtx", 0, "translateLoad: opts.nCtx");
    opts.flash_attn = Int32Option(o, "flashAttn", 0, "translateLoad: opts.flashAttn");
    if (opts.flash_attn < 0 || opts.flash_attn > 2) {
        throw Napi::TypeError::New(info.Env(), "translateLoad: opts.flashAttn must be 0, 1 or 2");
    }
    return Submit(info.Env(), MiscWorker(), std::make_unique<LoadJob>(std::move(path), device, opts));
}

}  // namespace

void RegisterTranslate(Napi::Env env, Napi::Object exports) {
    Data(env).translator = Napi::Persistent(Translator::Define(env));
    exports.Set("translateLoad", Napi::Function::New(env, TranslateLoad, "translateLoad"));
}

}  // namespace sk_node
