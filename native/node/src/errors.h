// NativeError: the one error shape the addon throws or rejects with for a native failure.
#pragma once

#include <napi.h>

#include <cstdint>
#include <string>

namespace sk_node {

// "<what>: <last error, or 'unknown error' when it is empty>" — the Python binding's text.
std::string StatusText(const char *what, const std::string &last_error);

// An Error with name 'NativeError', a numeric `status` (the sk_status) and the message
// "<text> (status <status>)".
Napi::Error MakeNativeError(Napi::Env env, int32_t status, const std::string &text);

// Throws MakeNativeError(env, status, StatusText(what, sk_last_error())). sk_last_error() is
// thread-local and only meaningful right after the failing call, so call this on the thread
// that got `status`, before any other sk_* call.
[[noreturn]] void ThrowStatus(Napi::Env env, const char *what, int32_t status);

}  // namespace sk_node
