// Argument checks shared by the exports. A wrong argument type is a programming error: it
// throws a TypeError synchronously, never a NativeError and never a rejected promise.
#pragma once

#include <napi.h>

#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace sk_node {

inline std::string StringArg(const Napi::CallbackInfo &info, size_t i, const char *what) {
    if (info.Length() <= i || !info[i].IsString()) {
        throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a string");
    }
    return info[i].As<Napi::String>().Utf8Value();
}

// A string, or null/undefined for "none" (the C API's NULL).
inline std::optional<std::string> NullableStringArg(const Napi::CallbackInfo &info, size_t i, const char *what) {
    if (info.Length() <= i || info[i].IsNull() || info[i].IsUndefined()) return std::nullopt;
    if (!info[i].IsString()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a string or null");
    return info[i].As<Napi::String>().Utf8Value();
}

// An integer that fits int32.
inline int32_t IndexArg(const Napi::CallbackInfo &info, size_t i, const char *what) {
    const double v = info.Length() > i && info[i].IsNumber() ? info[i].As<Napi::Number>().DoubleValue() : -1.5;
    if (!(v >= INT32_MIN && v <= INT32_MAX) || std::floor(v) != v) {
        throw Napi::TypeError::New(info.Env(), std::string(what) + " must be an integer");
    }
    return static_cast<int32_t>(v);
}

// deviceIndex: null/undefined → nullopt (the C API's NULL device: auto), else an integer.
inline std::optional<int32_t> DeviceArg(const Napi::CallbackInfo &info, size_t i, const char *what) {
    if (info.Length() <= i || info[i].IsNull() || info[i].IsUndefined()) return std::nullopt;
    if (!info[i].IsNumber()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be an integer or null");
    return IndexArg(info, i, what);
}

// A Float32Array, copied: the copy is what crosses to the worker thread, so the caller may
// reuse or drop its array as soon as the call returns.
inline std::vector<float> Float32Arg(const Napi::CallbackInfo &info, size_t i, const char *what) {
    if (info.Length() <= i || !info[i].IsTypedArray() ||
        info[i].As<Napi::TypedArray>().TypedArrayType() != napi_float32_array) {
        throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a Float32Array");
    }
    Napi::Float32Array a = info[i].As<Napi::Float32Array>();
    const float *data = a.Data();
    return std::vector<float>(data, data + a.ElementLength());
}

// The options bag of a call that runs on a worker: { signal?, <callback>? }.
struct CallOptions {
    Napi::Object signal;        // an AbortSignal; empty when none was given
    Napi::Function callback;    // onProgress / onToken / onAudio; empty when none was given
};

// info[i] is undefined/null or an object. `callback_key` names the callback property (nullptr:
// the call takes none); `callback_required` makes a missing callback a TypeError.
inline CallOptions CallOptionsArg(const Napi::CallbackInfo &info, size_t i, const char *fn,
                                  const char *callback_key = nullptr, bool callback_required = false) {
    Napi::Env env = info.Env();
    CallOptions out;
    if (info.Length() <= i || info[i].IsUndefined() || info[i].IsNull()) {
        if (callback_required) throw Napi::TypeError::New(env, std::string(fn) + ": options." + callback_key + " must be a function");
        return out;
    }
    if (!info[i].IsObject()) throw Napi::TypeError::New(env, std::string(fn) + ": options must be an object");
    Napi::Object opts = info[i].As<Napi::Object>();

    Napi::Value signal = opts.Get("signal");
    if (!signal.IsUndefined() && !signal.IsNull()) {
        // Duck-typed: what the job uses of an AbortSignal.
        Napi::Object s = signal.IsObject() ? signal.As<Napi::Object>() : Napi::Object();
        if (s.IsEmpty() || !s.Get("addEventListener").IsFunction() || !s.Get("removeEventListener").IsFunction()) {
            throw Napi::TypeError::New(env, std::string(fn) + ": options.signal must be an AbortSignal");
        }
        out.signal = s;
    }
    if (callback_key != nullptr) {
        Napi::Value cb = opts.Get(callback_key);
        if (cb.IsFunction()) {
            out.callback = cb.As<Napi::Function>();
        } else if (callback_required || (!cb.IsUndefined() && !cb.IsNull())) {
            throw Napi::TypeError::New(env, std::string(fn) + ": options." + callback_key + " must be a function");
        }
    }
    return out;
}

}  // namespace sk_node
