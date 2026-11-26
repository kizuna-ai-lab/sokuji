// asrLoad, AsrModel (batch ASR) and AsrStream (streaming ASR). A load runs on the misc
// worker; each loaded model then owns a HandleWorker, and every call on it or on its stream
// is a job on that worker, in call order.
#include "addon.h"
#include "args.h"
#include "errors.h"
#include "job.h"
#include "model.h"
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
//
// It also holds the model's one native stream. The header requires every stream closed
// before its model is unloaded, so Unload() closes it first. The stream functions run on the
// model's worker thread, or once that thread has ended (~AsrModel's Unload).
class AsrHandle {
public:
    AsrHandle() = default;
    ~AsrHandle() { Unload(); }
    AsrHandle(const AsrHandle &) = delete;
    AsrHandle &operator=(const AsrHandle &) = delete;

    void Adopt(sk_asr_model *m) noexcept { m_.store(m); }
    sk_asr_model *get() const noexcept { return m_.load(); }
    void Unload() noexcept {
        if (sk_asr_model *m = m_.exchange(nullptr)) {
            CloseStream();
            sk_asr_unload(m);
        }
    }

    sk_status OpenStream(const char *language) {
        sk_asr_stream *s = nullptr;
        const sk_status st = sk_asr_stream_open(get(), language, &s);
        if (st == SK_OK) stream_ = s;
        return st;
    }
    sk_asr_stream *stream() const noexcept { return stream_; }
    void CloseStream() noexcept {
        if (sk_asr_stream *s = std::exchange(stream_, nullptr)) sk_asr_stream_close(s);
    }

private:
    std::atomic<sk_asr_model *> m_{nullptr};
    sk_asr_stream *stream_ = nullptr;
};

// The outcome of one stream's sk_asr_stream_open. openStream() has returned the stream before
// the open runs on the worker, so a refused open is reported by the stream's next calls.
// Shared by that stream's jobs; read and written only on the model's worker thread.
struct StreamOpen {
    sk_status status = SK_ERR_CANCELLED;          // until the open job runs
    std::string error = kCancelledBeforeStart;
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
    std::string path;   // what was loaded, for the finalizer's warning
};

// A call on a stream after close() or finalize(): the Python binding's text and status.
Napi::Promise RejectedClosed(Napi::Env env, const char *what) {
    return Rejected(env, MakeNativeError(env, SK_ERR_INVALID_ARGUMENT, StatusText(what, "stream is closed")).Value());
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

// ---- AsrModel and AsrStream -------------------------------------------------------------------

class AsrStream;

class AsrModel : public Napi::ObjectWrap<AsrModel> {
public:
    static Napi::Function Define(Napi::Env env);
    explicit AsrModel(const Napi::CallbackInfo &info);
    ~AsrModel() override;

private:
    friend class AsrStream;

    Napi::Value Capabilities(const Napi::CallbackInfo &info);
    Napi::Value Run(const Napi::CallbackInfo &info);
    Napi::Value OpenStream(const Napi::CallbackInfo &info);
    Napi::Value Unload(const Napi::CallbackInfo &info);

    bool Unloading() const { return life_.Unloading(); }

    std::shared_ptr<AsrHandle> handle_;
    ModelLifecycle life_;                      // the model's worker thread and unload (model.h)
    Napi::ObjectReference caps_;
    bool streams_ = false;                     // capabilities.supportsStreaming
    AsrStream *open_stream_ = nullptr;         // the one open stream; it holds this object
};

// One stream on an AsrModel; a model has at most one open. openStream() and close() return at
// once: they queue the native open and close on the model's worker, where feed() and
// finalize() run too, so every native stream call happens in the order JS made it. The stream
// holds its model object (a stream never outlives its model).
class AsrStream : public Napi::ObjectWrap<AsrStream> {
public:
    static Napi::Function Define(Napi::Env env);
    explicit AsrStream(const Napi::CallbackInfo &info);
    ~AsrStream() override;

    const std::shared_ptr<StreamOpen> &open() const { return open_; }

    // JS thread, from ~AsrModel (only while the environment is torn down, since this object
    // holds the model): forget the model; its own unload closes the native stream.
    void Detach() { model_ = nullptr; }

private:
    Napi::Value Feed(const Napi::CallbackInfo &info);
    Napi::Value Finalize(const Napi::CallbackInfo &info);
    Napi::Value Close(const Napi::CallbackInfo &info);
    void Leave();

    AsrModel *model_ = nullptr;         // null once closed (or detached)
    Napi::ObjectReference model_ref_;   // keeps the model object alive while this one is
    std::shared_ptr<StreamOpen> open_ = std::make_shared<StreamOpen>();
    bool closed_ = false;               // close() or finalize() was called
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

// The stream jobs. One stream's jobs are queued between its open and its close, and a model's
// next open only after the previous stream's close, so the handle's stream is always the one
// of the job that is running.

// sk_asr_stream_open, queued by openStream(). Native only (nothing to settle): its outcome
// goes to StreamOpen, which the stream's later jobs check first.
class OpenStreamJob : public Job {
public:
    OpenStreamJob(std::shared_ptr<AsrHandle> handle, std::shared_ptr<StreamOpen> open,
                  std::optional<std::string> language)
        : Job("sk_asr_stream_open"), handle_(std::move(handle)), open_(std::move(open)),
          language_(std::move(language)) {}

    void execute() override {
        if (handle_->get() == nullptr) {
            open_->status = SK_ERR_NOT_INITIALISED;
            open_->error = "model is unloaded";
            return;
        }
        open_->status = handle_->OpenStream(language_ ? language_->c_str() : nullptr);
        const char *last = open_->status == SK_OK ? nullptr : sk_last_error();
        open_->error = last ? last : "";
    }

    void settle(Napi::Env) override {}   // never called: a native-only job has no promise

private:
    std::shared_ptr<AsrHandle> handle_;
    std::shared_ptr<StreamOpen> open_;
    std::optional<std::string> language_;
};

// sk_asr_stream_feed. The committed/tentative strings belong to the model and live only until
// the next call on the stream, so they are copied here, on the worker, before the job settles.
class FeedJob : public Job {
public:
    FeedJob(std::shared_ptr<AsrHandle> handle, std::shared_ptr<StreamOpen> open, std::vector<float> pcm)
        : Job("sk_asr_stream_feed"), handle_(std::move(handle)), open_(std::move(open)), pcm_(std::move(pcm)) {}

    void execute() override {
        if (open_->status != SK_OK) return Fail("sk_asr_stream_open", open_->status, open_->error);
        sk_stream_text out{};
        const sk_status st = sk_asr_stream_feed(handle_->stream(), pcm_.data(), pcm_.size(), &out);
        if (st != SK_OK) return Fail("sk_asr_stream_feed", st);
        committed_ = out.committed ? out.committed : "";
        tentative_ = out.tentative ? out.tentative : "";
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Napi::Object text = Napi::Object::New(env);
        text.Set("committed", Napi::String::New(env, committed_));
        text.Set("tentative", Napi::String::New(env, tentative_));
        Resolve(text);
    }

private:
    std::shared_ptr<AsrHandle> handle_;
    std::shared_ptr<StreamOpen> open_;
    std::vector<float> pcm_;
    std::string committed_, tentative_;
};

// sk_asr_stream_finalize: the library calls back once, on this thread, with the final text.
// It never polls, so a signal aborted once the job has started does not stop it.
class FinalizeJob : public Job {
public:
    FinalizeJob(std::shared_ptr<AsrHandle> handle, std::shared_ptr<StreamOpen> open)
        : Job("sk_asr_stream_finalize"), handle_(std::move(handle)), open_(std::move(open)) {}

    void execute() override {
        if (open_->status != SK_OK) return Fail("sk_asr_stream_open", open_->status, open_->error);
        const sk_status st = sk_asr_stream_finalize(handle_->stream(), &FinalizeJob::OnText, this);
        if (st != SK_OK) Fail("sk_asr_stream_finalize", st);
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Resolve(Napi::String::New(env, text_));
    }

private:
    static bool OnText(const char *text, void *user) {
        try {
            static_cast<FinalizeJob *>(user)->text_ = text ? text : "";
            return true;
        } catch (...) {
            return false;   // nothing may unwind into the library
        }
    }

    std::shared_ptr<AsrHandle> handle_;
    std::shared_ptr<StreamOpen> open_;
    std::string text_;
};

// sk_asr_stream_close, queued by close() or finalize() behind the stream's other calls.
// Native only. Should it never run (cancelled as the model goes away), the model's unload
// closes the stream instead (AsrHandle::Unload).
class CloseStreamJob : public Job {
public:
    explicit CloseStreamJob(std::shared_ptr<AsrHandle> handle)
        : Job("sk_asr_stream_close"), handle_(std::move(handle)) {}

    void execute() override { handle_->CloseStream(); }

    void settle(Napi::Env) override {}   // never called: a native-only job has no promise

private:
    std::shared_ptr<AsrHandle> handle_;
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
        loaded_.path = path_;
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
                           InstanceMethod("openStream", &AsrModel::OpenStream),
                           InstanceMethod("unload", &AsrModel::Unload),
                       });
}

AsrModel::AsrModel(const Napi::CallbackInfo &info) : Napi::ObjectWrap<AsrModel>(info) {
    Napi::Env env = info.Env();
    if (info.Length() != 1 || !info[0].IsExternal()) throw Napi::TypeError::New(env, "AsrModel: use asrLoad()");
    LoadedAsr *loaded = info[0].As<Napi::External<LoadedAsr>>().Data();
    caps_ = Napi::Persistent(CapsObject(env, loaded->caps));
    streams_ = loaded->caps.supports_streaming;
    life_.Start(env, "AsrModel(" + loaded->path + ")");
    handle_ = loaded->handle;
}

// Collected without unload(), or the environment is going away (ModelLifecycle::Teardown).
// The handle's Unload closes an open native stream first.
AsrModel::~AsrModel() {
    if (open_stream_) open_stream_->Detach();
    life_.Teardown(handle_);
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
    if (Unloading()) return RejectedUnloaded(env, "sk_asr_run");
    if (Aborted(opts.signal)) return RejectedCancelled(env, "sk_asr_run");
    if (pcm.empty()) return Resolved(env, Napi::String::New(env, ""));   // sk_asr_run's own n == 0 answer
    auto job = std::make_unique<RunJob>(handle_, std::move(pcm), std::move(language), !opts.callback.IsEmpty());
    return Submit(env, life_.worker(), std::move(job), Value(), opts.callback, opts.signal);
}

// openStream(language | null) → AsrStream. Throws (it returns no promise) when the model is
// unloaded, cannot stream, or already has an open stream; the library's texts and statuses.
// Otherwise returns at once and queues the native open behind earlier calls; an open the
// library refuses there rejects the stream's next feed() or finalize() with its NativeError.
Napi::Value AsrModel::OpenStream(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::optional<std::string> language = NullableStringArg(info, 0, "openStream: language");
    const char *what = "sk_asr_stream_open";
    if (Unloading()) throw MakeNativeError(env, SK_ERR_NOT_INITIALISED, StatusText(what, "model is unloaded"));
    if (!streams_) {
        throw MakeNativeError(env, SK_ERR_INVALID_ARGUMENT, StatusText(what, "this model does not support streaming"));
    }
    if (open_stream_ != nullptr) {
        throw MakeNativeError(env, SK_ERR_INVALID_ARGUMENT, StatusText(what, "a stream is already open on this model"));
    }
    Napi::Object object = Data(env).asr_stream.New({Napi::External<AsrModel>::New(env, this)});
    AsrStream *stream = AsrStream::Unwrap(object);
    life_.worker().post(std::make_unique<OpenStreamJob>(handle_, stream->open(), std::move(language)));
    open_stream_ = stream;   // last: only a stream whose open is queued holds the slot
    return object;
}

// unload() → Promise<void>. Idempotent: every call returns the first call's promise. Queued
// jobs are cancelled and the running one stops at its next callback; then, on the model's own
// thread, an open stream is closed and the model freed, and the thread ends. The stream's later
// calls reject: model is unloaded.
Napi::Value AsrModel::Unload(const Napi::CallbackInfo &info) {
    return life_.Unload(info.Env(), Value(), "sk_asr_unload", handle_);
}

Napi::Function AsrStream::Define(Napi::Env env) {
    return DefineClass(env, "AsrStream",
                       {
                           InstanceMethod("feed", &AsrStream::Feed),
                           InstanceMethod("finalize", &AsrStream::Finalize),
                           InstanceMethod("close", &AsrStream::Close),
                       });
}

AsrStream::AsrStream(const Napi::CallbackInfo &info) : Napi::ObjectWrap<AsrStream>(info) {
    if (info.Length() != 1 || !info[0].IsExternal()) {
        throw Napi::TypeError::New(info.Env(), "AsrStream: use AsrModel.openStream()");
    }
    model_ = info[0].As<Napi::External<AsrModel>>().Data();
    model_ref_ = Napi::Persistent(model_->Value());
}

// Collected while still open: closed as close() would close it.
AsrStream::~AsrStream() {
    try {
        Leave();
    } catch (...) {
        // Out of memory queuing the close: the model's unload closes the stream instead.
    }
}

// JS thread: the stream is closed, by close(), finalize() or collection. Frees the model's
// stream slot and queues sk_asr_stream_close behind this stream's calls. Once the model is
// unloading nothing is queued: its unload closes the native stream itself.
void AsrStream::Leave() {
    if (closed_) return;
    closed_ = true;
    AsrModel *model = std::exchange(model_, nullptr);
    if (model == nullptr || model->open_stream_ != this) return;   // detached, or never opened
    model->open_stream_ = nullptr;
    if (!model->Unloading()) model->life_.worker().post(std::make_unique<CloseStreamJob>(model->handle_));
}

// feed(pcm) → Promise<{ committed, tentative }>
Napi::Value AsrStream::Feed(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::vector<float> pcm = Float32Arg(info, 0, "feed: pcm");
    if (closed_) return RejectedClosed(env, "sk_asr_stream_feed");
    if (model_ == nullptr || model_->Unloading()) return RejectedUnloaded(env, "sk_asr_stream_feed");
    auto job = std::make_unique<FeedJob>(model_->handle_, open_, std::move(pcm));
    return Submit(env, model_->life_.worker(), std::move(job), Value());
}

// finalize({ signal? }) → Promise<string>, the final full text. Closes the stream whatever the
// outcome: a signal already aborted rejects with SK_ERR_CANCELLED, and the stream is closed.
Napi::Value AsrStream::Finalize(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    CallOptions opts = CallOptionsArg(info, 0, "finalize");
    if (closed_) return RejectedClosed(env, "sk_asr_stream_finalize");
    if (model_ == nullptr || model_->Unloading()) return RejectedUnloaded(env, "sk_asr_stream_finalize");
    auto job = std::make_unique<FinalizeJob>(model_->handle_, open_);
    Napi::Promise p = Submit(env, model_->life_.worker(), std::move(job), Value(), Napi::Function(), opts.signal);
    Leave();   // the close is queued behind the finalize
    return p;
}

// close(): abandons the stream. Idempotent; returns at once.
Napi::Value AsrStream::Close(const Napi::CallbackInfo &info) {
    Leave();
    return info.Env().Undefined();
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
    Data(env).asr_stream = Napi::Persistent(AsrStream::Define(env));
    exports.Set("asrLoad", Napi::Function::New(env, AsrLoad, "asrLoad"));
}

}  // namespace sk_node
