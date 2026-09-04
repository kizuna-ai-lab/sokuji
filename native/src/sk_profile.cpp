#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"
#include "sk_vk_enum.h"

#include "ggml-backend.h"
#include "ggml.h"

#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>

#if defined(__APPLE__)
#  include <sys/sysctl.h>
#endif

namespace {

/* "NAME=value,NAME=value" from the loaded CPU registration — the one capability hook the CPU
 * and Metal registrations expose through get_proc_address (ggml_get_type_traits_cpu is NOT
 * reachable: it lives in the dlopen'd module). Reports the variant ggml actually chose. */
std::string cpu_feature_string(ggml_backend_dev_t dev) {
    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
    if (!reg) return "";
    auto get = reinterpret_cast<ggml_backend_get_features_t>(
        ggml_backend_reg_get_proc_address(reg, "ggml_backend_get_features"));
    if (!get) return "";
    std::string out;
    for (const ggml_backend_feature *f = get(reg); f && f->name; ++f) {
        if (!out.empty()) out += ',';
        out += f->name; out += '='; out += f->value ? f->value : "";
    }
    return out;
}

/* One scratch node, asked of the device's own supports_op. no_alloc: nothing is allocated
 * on the device and nothing runs, so this cannot GGML_ABORT. */
bool ask_supports(ggml_backend_dev_t dev, enum ggml_op op, enum ggml_type t0, enum ggml_type t1) {
    ggml_init_params ip = { /*mem_size*/ 16 * 1024, /*mem_buffer*/ nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) return false;
    bool ok = false;
    ggml_tensor *a = ggml_new_tensor_2d(ctx, t0, 256, 4);
    ggml_tensor *node = nullptr;
    switch (op) {
        case GGML_OP_NORM:   node = ggml_norm(ctx, a, 1e-5f); break;
        case GGML_OP_CONCAT: node = ggml_concat(ctx, a, ggml_new_tensor_2d(ctx, t1, 256, 4), 1); break;
        default: break;
    }
    if (node) ok = ggml_backend_dev_supports_op(dev, node);
    ggml_free(ctx);
    return ok;
}

std::string mac_build() {
#if defined(__APPLE__)
    char buf[64] = {};
    size_t len = sizeof buf;
    if (sysctlbyname("kern.osversion", buf, &len, nullptr, 0) == 0) return buf;
#endif
    return "";
}

void copy_str(char *dst, size_t cap, const std::string &s) { std::snprintf(dst, cap, "%s", s.c_str()); }

}  // namespace

extern "C" {

SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out) {
    std::lock_guard<std::mutex> lock(sk::mutex());
    if (!sk::require_init("sk_device_profile_get")) return SK_ERR_NOT_INITIALISED;
    const auto &devs = sk::devices();
    if (!out || index < 0 || static_cast<size_t>(index) >= devs.size()) {
        sk::set_error("sk_device_profile_get: bad index or NULL out-pointer");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::memset(out, 0, sizeof *out);
    out->index = index;
    ggml_backend_dev_t dev = devs[index];
    try {
        switch (sk::kind_of(dev)) {
            case SK_DEVICE_CPU:
                copy_str(out->cpu_features, sizeof out->cpu_features, cpu_feature_string(dev));
                out->known = 1;
                break;
            case SK_DEVICE_METAL:
                copy_str(out->driver_name, sizeof out->driver_name, "Metal");
                copy_str(out->driver_version, sizeof out->driver_version, mac_build());
                out->features |= SK_FEAT_UMA;
                if (ask_supports(dev, GGML_OP_NORM, GGML_TYPE_F32, GGML_TYPE_F32)) out->features |= SK_FEAT_MTL_SIMDGROUP_REDUCTION;
                if (ask_supports(dev, GGML_OP_CONCAT, GGML_TYPE_BF16, GGML_TYPE_BF16)) out->features |= SK_FEAT_MTL_BFLOAT;
                out->known = 1;
                break;
            case SK_DEVICE_VULKAN:
                out->known = sk_vk_fill_profile(dev, ggml_backend_dev_description(dev), out) ? 1 : 0;
                break;
            default:
                break;                                         // OTHER: known stays 0
        }
    } catch (...) {
        std::memset(out, 0, sizeof *out);                      // no C++ exception crosses the C ABI
        out->index = index;
        sk::log_line(2, "sk_device_profile_get: backend threw while profiling; reporting unknown");
    }
    return SK_OK;
}

}  // extern "C"
