// asrLoad and AsrModel (batch ASR). A load runs on the misc worker; each loaded model then
// owns a HandleWorker, and every call on it is a job on that worker, in call order.
#include "addon.h"
#include "args.h"
#include "errors.h"
#include "job.h"
#include "worker.h"

#include <napi.h>
#include <sokuji_native.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace sk_node {
namespace {

// The model handle, shared by the AsrModel object and the jobs queued for it. Unload() frees
// it once, whoever gets there first; the last owner frees it if nobody did.
class AsrHandle {
public:
    AsrHandle() = default;
    ~AsrHandle() { Unload(); }
    AsrHandle(const AsrHandle &) = delete;
    AsrHandle &operator=(const AsrHandle &) = delete;

    void Adopt(sk_asr_model *m) noexcept { m_.store(m); }
    sk_asr_model *get() const noexcept { return m_.load(); }
    void Unload() noexcept {
        if (sk_asr_model *m = m_.exchange(nullptr)) sk_asr_unload(m);
    }

private:
    std::atomic<sk_asr_model *> m_{nullptr};
};

struct AsrCapsData {
    std::vector<std::string> languages;
    bool supports_streaming = false;
    bool supports_language_detect = false;
    int32_t native_sample_rate = 0;
    std::string arch;
};

// What asrLoad hands the AsrModel constructor, through an External.
struct LoadedAsr {
    std::shared_ptr<AsrHandle> handle;
    AsrCapsData caps;
};

// Unloaded (or unloading): the Python binding's text and status.
Napi::Promise RejectedUnloaded(Napi::Env env, const char *what) {
    return Rejected(env, MakeNativeError(env, SK_ERR_NOT_INITIALISED, StatusText(what, "model is unloaded")).Value());
}

// { languages, supportsStreaming, supportsLanguageDetect, nativeSampleRate, arch }, frozen,
// as the Python binding's frozen AsrCaps.
Napi::Object CapsObject(Napi::Env env, const AsrCapsData &c) {
    Napi::Array languages = Napi::Array::New(env, c.languages.size());
    for (size_t i = 0; i < c.languages.size(); ++i) {
        languages.Set(static_cast<uint32_t>(i), Napi::String::New(env, c.languages[i]));
    }
    languages.Freeze();
    Napi::Object o = Napi::Object::New(env);
    o.Set("languages", languages);
    o.Set("supportsStreaming", Napi::Boolean::New(env, c.supports_streaming));
    o.Set("supportsLanguageDetect", Napi::Boolean::New(env, c.supports_language_detect));
    o.Set("nativeSampleRate", Napi::Number::New(env, c.native_sample_rate));
    o.Set("arch", Napi::String::New(env, c.arch));
    o.Freeze();
    return o;
}

// ---- AsrModel ---------------------------------------------------------------------------------

class AsrModel : public Napi::ObjectWrap<AsrModel> {
public:
    static Napi::Function Define(Napi::Env env);
    explicit AsrModel(const Napi::CallbackInfo &info);
    ~AsrModel() override;

    // JS thread, from the unload job's settle: the worker ends right after that job.
    void Stopped();

private:
    Napi::Value Capabilities(const Napi::CallbackInfo &info);
    Napi::Value Run(const Napi::CallbackInfo &info);
    Napi::Value Unload(const Napi::CallbackInfo &info);

    std::shared_ptr<AsrHandle> handle_;
    std::unique_ptr<HandleWorker> worker_;     // null once unloaded
    Napi::ObjectReference caps_;
    Napi::Reference<Napi::Promise> unloading_; // what every unload() returns; set by the first
};

// sk_asr_run with progress. The sk_text_cb trampoline runs on the model's worker thread:
// text == NULL between decode steps (post a progress call, never wait; answer !cancel),
// otherwise the transcript (copy it).
class RunJob : public Job {
public:
    RunJob(std::shared_ptr<AsrHandle> handle, std::vector<float> pcm, std::optional<std::string> language,
           bool progress)
        : Job("sk_asr_run"), handle_(std::move(handle)), pcm_(std::move(pcm)), language_(std::move(language)),
          progress_(progress) {}

    void execute() override {
        sk_asr_model *m = handle_->get();
        if (m == nullptr) return Fail("sk_asr_run", SK_ERR_NOT_INITIALISED, "model is unloaded");
        const sk_status st = sk_asr_run(m, pcm_.data(), pcm_.size(), language_ ? language_->c_str() : nullptr,
                                        &RunJob::OnText, this);
        if (st != SK_OK) Fail("sk_asr_run", st);
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Resolve(Napi::String::New(env, text_));
    }

private:
    static bool OnText(const char *text, void *user) {
        auto *self = static_cast<RunJob *>(user);
        try {
            if (text == nullptr) {
                if (self->progress_) {
                    self->Emit([](Napi::Env, Napi::Function onProgress) {
                        onProgress.Call(std::initializer_list<napi_value>{});
                    });
                }
                return !self->cancel->load();
            }
            self->text_ = text;
            return true;
        } catch (...) {
            return false;   // nothing may unwind into the library (out of memory): stop the run
        }
    }

    std::shared_ptr<AsrHandle> handle_;
    std::vector<float> pcm_;
    std::optional<std::string> language_;
    bool progress_;
    std::string text_;
};

// sk_asr_unload on the model's own thread, behind every job queued before it.
class UnloadJob : public Job {
public:
    UnloadJob(std::shared_ptr<AsrHandle> handle, AsrModel *model)
        : Job("sk_asr_unload"), handle_(std::move(handle)), model_(model) {}

    void execute() override { handle_->Unload(); }

    void settle(Napi::Env env) override {
        model_->Stopped();   // alive: the job holds the object until it settles
        if (failed()) return RejectStatus(env);
        Resolve(env.Undefined());
    }

private:
    std::shared_ptr<AsrHandle> handle_;
    AsrModel *model_;
};

// sk_asr_load + sk_asr_capabilities on the misc worker. Until settle hands the handle to an
// AsrModel, the job owns it: a load nobody settles (the environment went away) is freed
// with the job.
class LoadJob : public Job {
public:
    LoadJob(std::string path, std::optional<int32_t> device)
        : Job("sk_asr_load"), path_(std::move(path)), device_(device) {}

    void execute() override {
        auto handle = std::make_shared<AsrHandle>();   // allocated first: a load is never leaked
        sk_device dev{};
        if (device_) dev.index = *device_;
        sk_asr_model *m = nullptr;
        sk_status st = sk_asr_load(path_.c_str(), device_ ? &dev : nullptr, &m);
        if (st != SK_OK) return Fail("sk_asr_load", st);
        handle->Adopt(m);

        sk_asr_caps raw{};
        st = sk_asr_capabilities(m, &raw);
        if (st != SK_OK) return Fail("sk_asr_capabilities", st);   // `handle` unloads it
        AsrCapsData &c = loaded_.caps;
        for (int32_t i = 0; raw.languages != nullptr && i < raw.n_languages; ++i) {
            c.languages.emplace_back(raw.languages[i] ? raw.languages[i] : "");
        }
        c.supports_streaming = raw.supports_streaming;
        c.supports_language_detect = raw.supports_language_detect;
        c.native_sample_rate = raw.native_sample_rate;
        c.arch = raw.arch ? raw.arch : "";
        loaded_.handle = std::move(handle);
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Resolve(Data(env).asr_model.New({Napi::External<LoadedAsr>::New(env, &loaded_)}));
    }

private:
    std::string path_;
    std::optional<int32_t> device_;
    LoadedAsr loaded_;
};

Napi::Function AsrModel::Define(Napi::Env env) {
    return DefineClass(env, "AsrModel",
                       {
                           InstanceAccessor("capabilities", &AsrModel::Capabilities, nullptr, napi_enumerable),
                           InstanceMethod("run", &AsrModel::Run),
                           InstanceMethod("unload", &AsrModel::Unload),
                       });
}

AsrModel::AsrModel(const Napi::CallbackInfo &info) : Napi::ObjectWrap<AsrModel>(info) {
    Napi::Env env = info.Env();
    if (info.Length() != 1 || !info[0].IsExternal()) throw Napi::TypeError::New(env, "AsrModel: use asrLoad()");
    LoadedAsr *loaded = info[0].As<Napi::External<LoadedAsr>>().Data();
    caps_ = Napi::Persistent(CapsObject(env, loaded->caps));
    worker_ = std::make_unique<HandleWorker>(env);
    handle_ = loaded->handle;
}

// Collected without unload(), or the environment is going away. Every job holds this object
// until it settles, so outside teardown nothing is queued here and the join is short.
AsrModel::~AsrModel() {
    if (worker_) {
        worker_->cancelAll();
        worker_->stopAndJoin();
    }
    if (handle_) handle_->Unload();
}

void AsrModel::Stopped() {
    if (worker_) worker_->stopAndJoin();
    worker_.reset();
}

Napi::Value AsrModel::Capabilities(const Napi::CallbackInfo &) {
    return caps_.Value();
}

// run(pcm, language, { signal?, onProgress? }) → Promise<string>
Napi::Value AsrModel::Run(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::vector<float> pcm = Float32Arg(info, 0, "run: pcm");
    std::optional<std::string> language = NullableStringArg(info, 1, "run: language");
    CallOptions opts = CallOptionsArg(info, 2, "run", "onProgress");
    if (!unloading_.IsEmpty()) return RejectedUnloaded(env, "sk_asr_run");
    if (Aborted(opts.signal)) return RejectedCancelled(env, "sk_asr_run");
    if (pcm.empty()) return Resolved(env, Napi::String::New(env, ""));   // sk_asr_run's own n == 0 answer
    auto job = std::make_unique<RunJob>(handle_, std::move(pcm), std::move(language), !opts.callback.IsEmpty());
    return Submit(env, *worker_, std::move(job), Value(), opts.callback, opts.signal);
}

// unload() → Promise<void>. Idempotent: every call returns the first call's promise. Jobs
// queued before it still run; the model is freed on its own thread, then the thread ends.
Napi::Value AsrModel::Unload(const Napi::CallbackInfo &info) {
    if (!unloading_.IsEmpty()) return unloading_.Value();
    Napi::Promise p = Submit(info.Env(), *worker_, std::make_unique<UnloadJob>(handle_, this), Value());
    worker_->requestStop();
    unloading_ = Napi::Persistent(p);
    return p;
}

// asrLoad(path, deviceIndex | null) → Promise<AsrModel>
Napi::Value AsrLoad(const Napi::CallbackInfo &info) {
    std::string path = StringArg(info, 0, "asrLoad: path");
    std::optional<int32_t> device = DeviceArg(info, 1, "asrLoad: deviceIndex");
    return Submit(info.Env(), MiscWorker(), std::make_unique<LoadJob>(std::move(path), device));
}

}  // namespace

void RegisterAsr(Napi::Env env, Napi::Object exports) {
    Data(env).asr_model = Napi::Persistent(AsrModel::Define(env));
    exports.Set("asrLoad", Napi::Function::New(env, AsrLoad, "asrLoad"));
}

}  // namespace sk_node
