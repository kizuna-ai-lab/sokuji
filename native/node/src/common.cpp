// Process-wide calls: abi, version, engineVersions, contract, init, devices.
#include "errors.h"

#include <napi.h>
#include <sokuji_native.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

namespace sk_node {
namespace {

// ---- log sink ---------------------------------------------------------------------------
// sk_init keeps the log callback of its first successful call for the life of the process,
// and calls it from any thread, also from inside sk_init itself on the JS thread. Lines go
// to JS through a non-blocking thread-safe function, so the logging thread never waits for
// JS. The function is created once per environment, unref'd (it never keeps the process
// alive) and never released; the library may log until the process is gone.

struct LogLine {
    int32_t level;
    std::string message;
};

struct LogContext {
    Napi::FunctionReference sink;   // the JS thread of the owning environment only
};

void DeliverLog(Napi::Env env, Napi::Function, LogContext *ctx, LogLine *raw) {
    std::unique_ptr<LogLine> line(raw);
    if (static_cast<napi_env>(env) == nullptr || ctx == nullptr || ctx->sink.IsEmpty()) return;
    try {
        ctx->sink.Call({Napi::Number::New(env, line->level), Napi::String::New(env, line->message)});
    } catch (...) {
        // As in the Python binding: a sink that throws loses the line, nothing else.
    }
}

using LogTsfn = Napi::TypedThreadSafeFunction<LogContext, LogLine, DeliverLog>;

struct State {
    std::atomic<bool> initialised{false};   // sk_init has succeeded
    std::mutex mu;                          // guards the three fields below
    LogTsfn tsfn;                           // empty until init() is given an onLog
    LogContext *ctx = nullptr;              // tsfn's context, owned by tsfn's finalizer
    napi_env owner = nullptr;               // the environment tsfn belongs to
};

// Never destroyed: native threads may still log while the process exits.
State &state() {
    static State *s = new State();
    return *s;
}

// The sk_log_cb handed to sk_init; `user` is unused.
bool LogToJs(int32_t level, const char *message, void *) {
    try {
        State &s = state();
        std::lock_guard<std::mutex> lock(s.mu);
        if (static_cast<napi_threadsafe_function>(s.tsfn) == nullptr) return true;
        auto line = std::make_unique<LogLine>(LogLine{level, message ? message : ""});
        if (s.tsfn.NonBlockingCall(line.get()) == napi_ok) line.release();
    } catch (...) {
        // Nothing may unwind into the library; the line is lost.
    }
    return true;
}

// Environment teardown: stop posting to a thread-safe function Node is about to finalize.
void ForgetLogSink(void *ctx) {
    State &s = state();
    std::lock_guard<std::mutex> lock(s.mu);
    if (s.ctx == ctx) {
        s.tsfn = LogTsfn();
        s.ctx = nullptr;
        s.owner = nullptr;
    }
}

// Points the log sink at `fn`. Runs only before sk_init has succeeded, so a failed init
// followed by a retry with another onLog uses the new function, as the library does.
void InstallLogSink(Napi::Env env, Napi::Function fn) {
    State &s = state();
    std::lock_guard<std::mutex> lock(s.mu);
    if (s.owner == static_cast<napi_env>(env)) {
        s.ctx->sink = Napi::Persistent(fn);
        return;
    }
    auto owned = std::make_unique<LogContext>();
    owned->sink = Napi::Persistent(fn);
    LogTsfn tsfn = LogTsfn::New(env, "sokuji_native.log", 0, 1, owned.get(),
                                [](Napi::Env, void *, LogContext *c) { delete c; });
    LogContext *ctx = owned.release();   // the function's finalizer deletes it from here on
    // Registered after the function's own hook, so it runs first (hooks run in reverse).
    if (napi_add_env_cleanup_hook(env, ForgetLogSink, ctx) != napi_ok) {
        tsfn.Release();
        throw Napi::Error::New(env, "init: cannot register the log sink's cleanup hook");
    }
    tsfn.Unref(env);
    s.tsfn = tsfn;
    s.ctx = ctx;
    s.owner = env;
}

// ---- helpers ------------------------------------------------------------------------------

const char *KindName(int32_t kind) {
    switch (kind) {
        case SK_DEVICE_CPU: return "cpu";
        case SK_DEVICE_VULKAN: return "vulkan";
        case SK_DEVICE_METAL: return "metal";
        default: return "other";
    }
}

// A fixed-size char field: NUL-terminated by the library, but never read past its size.
Napi::String FieldString(Napi::Env env, const char *field, size_t size) {
    return Napi::String::New(env, field, static_cast<size_t>(std::find(field, field + size, '\0') - field));
}

std::string StringArg(const Napi::CallbackInfo &info, size_t i, const char *what) {
    if (info.Length() <= i || !info[i].IsString()) {
        throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a string");
    }
    return info[i].As<Napi::String>().Utf8Value();
}

// Reads <dir>/contract.json and refuses one whose ABI is not this binding's.
Napi::Value ReadContract(Napi::Env env, const std::string &dir) {
    const std::filesystem::path path = std::filesystem::u8path(dir) / "contract.json";
    std::ifstream in(path, std::ios::binary);
    if (!in) throw MakeNativeError(env, SK_ERR_NOT_FOUND, "contract.json: cannot read " + path.u8string());
    std::ostringstream text;
    text << in.rdbuf();

    Napi::Object json = env.Global().Get("JSON").As<Napi::Object>();
    Napi::Value data;
    try {
        data = json.Get("parse").As<Napi::Function>().Call(json, {Napi::String::New(env, text.str())});
    } catch (const Napi::Error &e) {
        throw MakeNativeError(env, SK_ERR_INVALID_ARGUMENT, "contract.json: " + e.Message());
    }
    Napi::Value abi = data.IsObject() ? data.As<Napi::Object>().Get("abi") : env.Undefined();
    if (!abi.IsNumber() || abi.As<Napi::Number>().DoubleValue() != SK_ABI_VERSION) {
        throw MakeNativeError(env, SK_ERR_INVALID_ARGUMENT,
                              "contract.json ABI " + abi.ToString().Utf8Value() +
                                  " != binding ABI " + std::to_string(SK_ABI_VERSION));
    }
    return data;
}

Napi::Object InitResult(Napi::Env env) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("threads", Napi::Number::New(env, sk_threads()));
    return out;
}

// ---- exports ------------------------------------------------------------------------------

Napi::Value Abi(const Napi::CallbackInfo &info) {
    return Napi::Number::New(info.Env(), sk_abi_version());
}

Napi::Value Version(const Napi::CallbackInfo &info) {
    return Napi::String::New(info.Env(), sk_version());
}

// "ggml=0.25.3;transcribe=0.2.4;...;lane=cpu" → { ggml: '0.25.3', ..., lane: 'cpu' }
Napi::Value EngineVersions(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    Napi::Object out = Napi::Object::New(env);
    std::istringstream raw(sk_engine_versions());
    std::string seg;
    while (std::getline(raw, seg, ';')) {
        const size_t eq = seg.find('=');
        const std::string key = seg.substr(0, eq);
        if (!key.empty()) out.Set(key, eq == std::string::npos ? std::string() : seg.substr(eq + 1));
    }
    return out;
}

Napi::Value Contract(const Napi::CallbackInfo &info) {
    return ReadContract(info.Env(), StringArg(info, 0, "contract: dir"));
}

// init({ moduleDir, threads?, onLog? }) → { threads }. Idempotent: once sk_init has
// succeeded, later calls change nothing and report the threads the first call settled on.
Napi::Value Init(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) throw Napi::TypeError::New(env, "init: options must be an object");
    Napi::Object opts = info[0].As<Napi::Object>();

    Napi::Value dir_v = opts.Get("moduleDir");
    if (!dir_v.IsString() || dir_v.As<Napi::String>().Utf8Value().empty()) {
        throw Napi::TypeError::New(env, "init: moduleDir must be a non-empty string");
    }
    const std::string dir = dir_v.As<Napi::String>().Utf8Value();

    int32_t threads = 0;
    Napi::Value threads_v = opts.Get("threads");
    if (!threads_v.IsUndefined()) {
        const double t = threads_v.IsNumber() ? threads_v.As<Napi::Number>().DoubleValue() : -1;
        if (!(t >= 0 && t <= INT32_MAX) || std::floor(t) != t) {
            throw Napi::TypeError::New(env, "init: threads must be a non-negative integer");
        }
        threads = static_cast<int32_t>(t);
    }

    Napi::Value log_v = opts.Get("onLog");
    const bool has_log = !log_v.IsUndefined() && !log_v.IsNull();
    if (has_log && !log_v.IsFunction()) throw Napi::TypeError::New(env, "init: onLog must be a function");

    State &s = state();
    if (s.initialised.load()) return InitResult(env);

    ReadContract(env, dir);
    if (sk_abi_version() != SK_ABI_VERSION) {
        throw MakeNativeError(env, SK_ERR_INVALID_ARGUMENT,
                              "library ABI " + std::to_string(sk_abi_version()) +
                                  " != binding ABI " + std::to_string(SK_ABI_VERSION));
    }
    if (has_log) InstallLogSink(env, log_v.As<Napi::Function>());

    sk_init_options o{};
    o.abi_version = SK_ABI_VERSION;
    o.n_threads = threads;
    o.module_dir = dir.c_str();
    o.log = has_log ? LogToJs : nullptr;
    o.log_user = nullptr;
    const sk_status status = sk_init(&o);
    if (status != SK_OK) ThrowStatus(env, "sk_init", status);
    s.initialised.store(true);
    return InitResult(env);
}

// Up to 32 devices, as the Python binding reads; [] before init.
Napi::Value Devices(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::vector<sk_device> buf(32);
    const int32_t n = sk_devices(buf.data(), static_cast<int32_t>(buf.size()));
    Napi::Array out = Napi::Array::New(env, n > 0 ? static_cast<size_t>(n) : 0);
    for (int32_t i = 0; i < n; ++i) {
        const sk_device &d = buf[i];
        Napi::Object o = Napi::Object::New(env);
        o.Set("index", Napi::Number::New(env, d.index));
        o.Set("kind", Napi::String::New(env, KindName(d.kind)));
        o.Set("name", FieldString(env, d.name, sizeof d.name));
        o.Set("description", FieldString(env, d.description, sizeof d.description));
        o.Set("memTotal", Napi::Number::New(env, static_cast<double>(d.mem_total)));
        o.Set("memFree", Napi::Number::New(env, static_cast<double>(d.mem_free)));
        out.Set(static_cast<uint32_t>(i), o);
    }
    return out;
}

}  // namespace

void RegisterCommon(Napi::Env env, Napi::Object exports) {
    exports.Set("abi", Napi::Function::New(env, Abi, "abi"));
    exports.Set("version", Napi::Function::New(env, Version, "version"));
    exports.Set("engineVersions", Napi::Function::New(env, EngineVersions, "engineVersions"));
    exports.Set("contract", Napi::Function::New(env, Contract, "contract"));
    exports.Set("init", Napi::Function::New(env, Init, "init"));
    exports.Set("devices", Napi::Function::New(env, Devices, "devices"));
}

}  // namespace sk_node
