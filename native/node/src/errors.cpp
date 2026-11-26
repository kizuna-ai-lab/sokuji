#include "errors.h"

#include <sokuji_native.h>

namespace sk_node {

std::string StatusText(const char *what, const std::string &last_error) {
    return std::string(what) + ": " + (last_error.empty() ? "unknown error" : last_error);
}

Napi::Error MakeNativeError(Napi::Env env, int32_t status, const std::string &text) {
    Napi::Error err = Napi::Error::New(env, text + " (status " + std::to_string(status) + ")");
    Napi::Object obj = err.Value();
    // Non-enumerable, like Error.prototype.name, so inspecting the error shows only `status`.
    obj.DefineProperty(Napi::PropertyDescriptor::Value(
        "name", Napi::String::New(env, "NativeError"),
        static_cast<napi_property_attributes>(napi_writable | napi_configurable)));
    obj.Set("status", Napi::Number::New(env, status));
    return err;
}

void ThrowStatus(Napi::Env env, const char *what, int32_t status) {
    const char *last = sk_last_error();
    throw MakeNativeError(env, status, StatusText(what, last ? last : ""));
}

}  // namespace sk_node
