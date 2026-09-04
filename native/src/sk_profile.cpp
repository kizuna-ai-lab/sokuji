#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include <cstring>
#include <mutex>

extern "C" {

SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out) {
    std::lock_guard<std::mutex> lock(sk::mutex());
    if (!out || index < 0) {
        sk::set_error("sk_device_profile_get: bad index or NULL out-pointer");
        return SK_ERR_INVALID_ARGUMENT;
    }
    if (!sk::require_init("sk_device_profile_get")) return SK_ERR_NOT_INITIALISED;
    if (static_cast<size_t>(index) >= sk::devices().size()) {
        sk::set_error("sk_device_profile_get: bad index");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::memset(out, 0, sizeof *out);
    out->index = index;
    sk::set_error("sk_device_profile_get: not implemented yet");   // Task 2 replaces this body
    return SK_ERR_INTERNAL;
}

SK_API sk_status sk_device_supports_ops(int32_t, const char *, const char *, const char *const *, int32_t,
                                        sk_op_coverage *) {
    sk::set_error("sk_device_supports_ops: not implemented yet");   // Task 5 replaces this body
    return SK_ERR_INTERNAL;
}

}  // extern "C"
