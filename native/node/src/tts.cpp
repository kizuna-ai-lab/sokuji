// ttsLoad and Tts. A load runs on the misc worker; each loaded model then owns a HandleWorker,
// and every presets() / setVoice() / setPreset() / synth() on it is a job on that worker, in
// call order. Voice state (a preset or a cloned clip) lives on the native handle and applies
// to every later synth().
//
// The header's per-handle lock is not recursive: an sk_tts_* call on the same handle from
// inside sk_audio_cb deadlocks. No JS runs inside the native callback here (onAudio is posted
// to the JS thread), so a call made from onAudio is just another job, queued behind the synth.
#include "addon.h"
#include "args.h"
#include "errors.h"
#include "job.h"
#include "model.h"
#include "worker.h"

#include <napi.h>
#include <sokuji_native.h>

#include <cfloat>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace sk_node {
namespace {

// The model handle, shared by the Tts object and the jobs queued for it (model.h).
using TtsHandle = NativeHandle<sk_tts, sk_tts_unload>;

// What ttsLoad hands the Tts constructor, through an External.
struct LoadedTts {
    std::shared_ptr<TtsHandle> handle;
    sk_tts_caps caps{};
    std::string path;   // what was loaded, for the finalizer's warning
};

// { streaming, clones, transcriptRequired, sampleRate }, frozen, as the Python binding's
// frozen TtsCaps. sampleRate is the family's expected rate; each chunk carries its own.
Napi::Object CapsObject(Napi::Env env, const sk_tts_caps &c) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("streaming", Napi::Boolean::New(env, c.streaming));
    o.Set("clones", Napi::Boolean::New(env, c.clones));
    o.Set("transcriptRequired", Napi::Boolean::New(env, c.transcript_required));
    o.Set("sampleRate", Napi::Number::New(env, c.sample_rate));
    o.Freeze();
    return o;
}

// ---- Tts --------------------------------------------------------------------------------------

class Tts : public Napi::ObjectWrap<Tts> {
public:
    static Napi::Function Define(Napi::Env env);
    explicit Tts(const Napi::CallbackInfo &info);
    ~Tts() override;

private:
    Napi::Value Capabilities(const Napi::CallbackInfo &info);
    Napi::Value Presets(const Napi::CallbackInfo &info);
    Napi::Value SetVoice(const Napi::CallbackInfo &info);
    Napi::Value SetPreset(const Napi::CallbackInfo &info);
    Napi::Value Synth(const Napi::CallbackInfo &info);
    Napi::Value Unload(const Napi::CallbackInfo &info);

    bool Unloading() const { return life_.Unloading(); }

    std::shared_ptr<TtsHandle> handle_;
    ModelLifecycle life_;   // the model's worker thread and unload (model.h)
    Napi::ObjectReference caps_;
};

// A job on one loaded model: the handle, and the "model is unloaded" answer for a job that
// reaches the worker after the model was freed.
class TtsJob : public Job {
protected:
    TtsJob(const char *what, std::shared_ptr<TtsHandle> handle) : Job(what), handle_(std::move(handle)) {}

    // The native model, or nullptr after recording the unloaded failure.
    sk_tts *Model() {
        sk_tts *t = handle_->get();
        if (t == nullptr) Fail(what(), SK_ERR_NOT_INITIALISED, "model is unloaded");
        return t;
    }

    void SettleVoid(Napi::Env env) {
        if (failed()) return RejectStatus(env);
        Resolve(env.Undefined());
    }

    std::shared_ptr<TtsHandle> handle_;
};

// sk_tts_presets: the library calls back once per name, on this thread; each is copied.
class PresetsJob : public TtsJob {
public:
    explicit PresetsJob(std::shared_ptr<TtsHandle> handle) : TtsJob("sk_tts_presets", std::move(handle)) {}

    void execute() override {
        sk_tts *t = Model();
        if (t == nullptr) return;
        const sk_status st = sk_tts_presets(t, &PresetsJob::OnName, this);
        if (st != SK_OK) Fail("sk_tts_presets", st);
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Napi::Array a = Napi::Array::New(env, names_.size());
        for (size_t i = 0; i < names_.size(); ++i) a.Set(static_cast<uint32_t>(i), Napi::String::New(env, names_[i]));
        Resolve(a);
    }

private:
    static bool OnName(const char *name, void *user) {
        try {
            static_cast<PresetsJob *>(user)->names_.emplace_back(name ? name : "");
            return true;
        } catch (...) {
            return false;   // nothing may unwind into the library (out of memory): stop
        }
    }

    std::vector<std::string> names_;
};

// sk_tts_set_voice with the clip and transcript copied into the job.
class SetVoiceJob : public TtsJob {
public:
    SetVoiceJob(std::shared_ptr<TtsHandle> handle, std::vector<float> pcm, int32_t sample_rate,
                std::optional<std::string> ref_text)
        : TtsJob("sk_tts_set_voice", std::move(handle)), pcm_(std::move(pcm)), sample_rate_(sample_rate),
          ref_text_(std::move(ref_text)) {}

    void execute() override {
        sk_tts *t = Model();
        if (t == nullptr) return;
        // An empty clip is the library's to refuse (n == 0: SK_ERR_INVALID_ARGUMENT).
        const sk_status st = sk_tts_set_voice(t, pcm_.data(), pcm_.size(), sample_rate_,
                                              ref_text_ ? ref_text_->c_str() : nullptr);
        if (st != SK_OK) Fail("sk_tts_set_voice", st);
    }

    void settle(Napi::Env env) override { SettleVoid(env); }

private:
    std::vector<float> pcm_;
    int32_t sample_rate_;
    std::optional<std::string> ref_text_;
};

// sk_tts_set_preset.
class SetPresetJob : public TtsJob {
public:
    SetPresetJob(std::shared_ptr<TtsHandle> handle, std::string name)
        : TtsJob("sk_tts_set_preset", std::move(handle)), name_(std::move(name)) {}

    void execute() override {
        sk_tts *t = Model();
        if (t == nullptr) return;
        const sk_status st = sk_tts_set_preset(t, name_.c_str());
        if (st != SK_OK) Fail("sk_tts_set_preset", st);
    }

    void settle(Napi::Env env) override { SettleVoid(env); }

private:
    std::string name_;
};

// sk_tts_synth. The sk_audio_cb trampoline runs on the model's worker thread once per chunk
// (once in all for an offline family): it copies the chunk, which the library may free or
// overwrite as soon as the callback returns, posts it to onAudio without waiting, and answers
// !cancel, so an abort or a throwing onAudio stops a streaming synth at its next chunk. A
// chunk that arrives once the flag is set is not delivered: for an offline family that chunk
// is the whole result, which a false answer discards (the header's contract).
class SynthJob : public TtsJob {
public:
    SynthJob(std::shared_ptr<TtsHandle> handle, std::string text, std::optional<std::string> language, float speed)
        : TtsJob("sk_tts_synth", std::move(handle)), text_(std::move(text)), language_(std::move(language)),
          speed_(speed) {}

    void execute() override {
        sk_tts *t = Model();
        if (t == nullptr) return;
        const sk_status st = sk_tts_synth(t, text_.c_str(), language_ ? language_->c_str() : nullptr, speed_,
                                          &SynthJob::OnAudio, this);
        if (st != SK_OK) Fail("sk_tts_synth", st);
    }

    void settle(Napi::Env env) override { SettleVoid(env); }

private:
    // n_samples counts every float of the buffer: frames × channels, interleaved.
    static bool OnAudio(const float *pcm, size_t n_samples, int32_t sample_rate, int32_t channels, void *user) {
        auto *self = static_cast<SynthJob *>(user);
        try {
            if (self->cancel->load()) return false;
            std::vector<float> samples;
            if (pcm != nullptr) samples.assign(pcm, pcm + n_samples);
            // Copied again into a Float32Array the JS heap owns: Electron's V8 memory cage
            // refuses ArrayBuffers over outside memory.
            self->Emit([samples = std::move(samples), sample_rate, channels](Napi::Env env, Napi::Function onAudio) {
                Napi::Float32Array a = Napi::Float32Array::New(env, samples.size());
                if (!samples.empty()) std::memcpy(a.Data(), samples.data(), samples.size() * sizeof(float));
                onAudio.Call({a, Napi::Number::New(env, sample_rate), Napi::Number::New(env, channels)});
            });
            return !self->cancel->load();
        } catch (...) {
            return false;   // nothing may unwind into the library (out of memory): stop the synth
        }
    }

    std::string text_;
    std::optional<std::string> language_;
    float speed_;
};

// sk_tts_load + sk_tts_capabilities on the misc worker. Until settle hands the handle to a
// Tts, the job owns it: a load nobody settles (the environment went away) is freed with the
// job.
class LoadJob : public Job {
public:
    LoadJob(std::string path, std::optional<int32_t> device, std::string family, std::optional<std::string> language)
        : Job("sk_tts_load"), path_(std::move(path)), device_(device), family_(std::move(family)),
          language_(std::move(language)) {}

    void execute() override {
        auto handle = std::make_shared<TtsHandle>();   // allocated first: a load is never leaked
        sk_device dev{};
        if (device_) dev.index = *device_;
        sk_tts_options opts{};
        opts.family = family_.c_str();
        opts.language = language_ ? language_->c_str() : nullptr;
        sk_tts *t = nullptr;
        sk_status st = sk_tts_load(path_.c_str(), device_ ? &dev : nullptr, &opts, &t);
        if (st != SK_OK) return Fail("sk_tts_load", st);
        handle->Adopt(t);
        st = sk_tts_capabilities(t, &loaded_.caps);
        if (st != SK_OK) return Fail("sk_tts_capabilities", st);   // `handle` unloads it
        loaded_.handle = std::move(handle);
        loaded_.path = path_;
    }

    void settle(Napi::Env env) override {
        if (failed()) return RejectStatus(env);
        Resolve(Data(env).tts.New({Napi::External<LoadedTts>::New(env, &loaded_)}));
    }

private:
    std::string path_;
    std::optional<int32_t> device_;
    std::string family_;
    std::optional<std::string> language_;
    LoadedTts loaded_;
};

Napi::Function Tts::Define(Napi::Env env) {
    return DefineClass(env, "Tts",
                       {
                           InstanceAccessor("capabilities", &Tts::Capabilities, nullptr, napi_enumerable),
                           InstanceMethod("presets", &Tts::Presets),
                           InstanceMethod("setVoice", &Tts::SetVoice),
                           InstanceMethod("setPreset", &Tts::SetPreset),
                           InstanceMethod("synth", &Tts::Synth),
                           InstanceMethod("unload", &Tts::Unload),
                       });
}

Tts::Tts(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Tts>(info) {
    Napi::Env env = info.Env();
    if (info.Length() != 1 || !info[0].IsExternal()) throw Napi::TypeError::New(env, "Tts: use ttsLoad()");
    LoadedTts *loaded = info[0].As<Napi::External<LoadedTts>>().Data();
    caps_ = Napi::Persistent(CapsObject(env, loaded->caps));
    life_.Start(env, "Tts(" + loaded->path + ")");
    handle_ = loaded->handle;
}

// Collected without unload(), or the environment is going away (ModelLifecycle::Teardown).
Tts::~Tts() {
    life_.Teardown(handle_);
}

Napi::Value Tts::Capabilities(const Napi::CallbackInfo &) {
    return caps_.Value();
}

// presets() → Promise<string[]>: the family's preset names (supertonic and pocket_tts; every
// other family has none).
Napi::Value Tts::Presets(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (Unloading()) return RejectedUnloaded(env, "sk_tts_presets");
    return Submit(env, life_.worker(), std::make_unique<PresetsJob>(handle_), Value());
}

// setVoice(pcm, sampleRate, refText | null) → Promise<void>: a mono reference clip, copied.
Napi::Value Tts::SetVoice(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::vector<float> pcm = Float32Arg(info, 0, "setVoice: pcm");
    const int32_t sample_rate = Int32Value(env, info.Length() > 1 ? info[1] : env.Undefined(), "setVoice: sampleRate");
    std::optional<std::string> ref_text = NullableStringArg(info, 2, "setVoice: refText");
    if (Unloading()) return RejectedUnloaded(env, "sk_tts_set_voice");
    auto job = std::make_unique<SetVoiceJob>(handle_, std::move(pcm), sample_rate, std::move(ref_text));
    return Submit(env, life_.worker(), std::move(job), Value());
}

// setPreset(name) → Promise<void>. Clears a cloned voice.
Napi::Value Tts::SetPreset(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string name = StringArg(info, 0, "setPreset: name");
    if (Unloading()) return RejectedUnloaded(env, "sk_tts_set_preset");
    return Submit(env, life_.worker(), std::make_unique<SetPresetJob>(handle_, std::move(name)), Value());
}

// speed as the C float. Beyond float's range a double becomes the infinity of its sign (the
// library refuses -inf, NaN and anything <= 0 itself).
float SpeedArg(const Napi::CallbackInfo &info, size_t i) {
    if (info.Length() <= i || !info[i].IsNumber()) throw Napi::TypeError::New(info.Env(), "synth: speed must be a number");
    const double d = info[i].As<Napi::Number>().DoubleValue();
    if (d > FLT_MAX) return INFINITY;
    if (d < -FLT_MAX) return -INFINITY;
    return static_cast<float>(d);
}

// synth(text, language | null, speed, { onAudio, signal? }) → Promise<void>. onAudio(pcm,
// sampleRate, channels) gets each chunk as its own Float32Array (interleaved when channels > 1),
// all of them before the promise settles.
Napi::Value Tts::Synth(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string text = StringArg(info, 0, "synth: text");
    std::optional<std::string> language = NullableStringArg(info, 1, "synth: language");
    const float speed = SpeedArg(info, 2);
    CallOptions opts = CallOptionsArg(info, 3, "synth", "onAudio", true);
    if (Unloading()) return RejectedUnloaded(env, "sk_tts_synth");
    auto job = std::make_unique<SynthJob>(handle_, std::move(text), std::move(language), speed);
    return Submit(env, life_.worker(), std::move(job), Value(), opts.callback, opts.signal);
}

// unload() → Promise<void>. Idempotent: every call returns the first call's promise. Queued
// jobs are cancelled and the running one stops at its next chunk (an offline synth runs to its
// end); then, on the model's own thread, the model is freed and the thread ends. Later calls
// reject: model is unloaded.
Napi::Value Tts::Unload(const Napi::CallbackInfo &info) {
    return life_.Unload(info.Env(), Value(), "sk_tts_unload", handle_);
}

// ttsLoad(path, deviceIndex | null, { family, language? }) → Promise<Tts>. family is the
// audio.cpp family (sk_tts_options.family); language is pocket_tts's load-time language
// package, ignored by the other families.
Napi::Value TtsLoad(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string path = StringArg(info, 0, "ttsLoad: path");
    std::optional<int32_t> device = DeviceArg(info, 1, "ttsLoad: deviceIndex");
    Napi::Object o = OptionsArg(info, 2, "ttsLoad: opts");
    Napi::Value family = o.Get("family");
    if (!family.IsString()) throw Napi::TypeError::New(env, "ttsLoad: opts.family must be a string");
    std::optional<std::string> language = NullableStringOption(o, "language", "ttsLoad: opts.language");
    auto job = std::make_unique<LoadJob>(std::move(path), device, family.As<Napi::String>().Utf8Value(),
                                         std::move(language));
    return Submit(env, MiscWorker(), std::move(job));
}

}  // namespace

void RegisterTts(Napi::Env env, Napi::Object exports) {
    Data(env).tts = Napi::Persistent(Tts::Define(env));
    exports.Set("ttsLoad", Napi::Function::New(env, TtsLoad, "ttsLoad"));
}

}  // namespace sk_node
