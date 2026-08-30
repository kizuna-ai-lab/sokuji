#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "version.h"

#include "ggml-backend.h"
#include "ggml.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace {

thread_local std::string t_last_error;
std::mutex g_mutex;
bool g_initialised = false;
int  g_threads = 0;
sk_log_cb g_log = nullptr;
void *g_log_user = nullptr;
std::vector<ggml_backend_dev_t> g_devices;
std::string g_engine_versions;

void set_error(const std::string &msg) { t_last_error = msg; }

void log_line(int32_t level, const char *msg) {
    if (g_log) g_log(level, msg, g_log_user);
}

void ggml_log_bridge(enum ggml_log_level level, const char *text, void *) {
    int32_t mapped = level >= GGML_LOG_LEVEL_ERROR ? 3 : level == GGML_LOG_LEVEL_WARN ? 2 : level == GGML_LOG_LEVEL_INFO ? 1 : 0;
    std::string line(text ? text : "");
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (!line.empty()) log_line(mapped, line.c_str());
}

std::string own_directory() {
#if defined(_WIN32)
    HMODULE mod = nullptr;
    GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCSTR>(&own_directory), &mod);
    char path[MAX_PATH] = {};
    GetModuleFileNameA(mod, path, MAX_PATH);
    std::string p(path);
    return p.substr(0, p.find_last_of("\\/"));
#else
    Dl_info info{};
    dladdr(reinterpret_cast<void *>(&own_directory), &info);
    std::string p(info.dli_fname ? info.dli_fname : ".");
    auto slash = p.find_last_of('/');
    return slash == std::string::npos ? "." : p.substr(0, slash);
#endif
}

int32_t kind_of(ggml_backend_dev_t dev) {
    if (ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_CPU) return SK_DEVICE_CPU;
    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
    std::string reg_name = reg ? ggml_backend_reg_name(reg) : "";
    if (reg_name == "Vulkan") return SK_DEVICE_VULKAN;
    if (reg_name == "Metal")  return SK_DEVICE_METAL;
    return SK_DEVICE_OTHER;
}

}  // namespace

extern "C" {

SK_API int32_t sk_abi_version(void) { return SK_ABI_VERSION; }
SK_API const char *sk_version(void) { return SK_VERSION_STRING; }
SK_API const char *sk_last_error(void) { return t_last_error.c_str(); }
SK_API void sk_free(void *p) { std::free(p); }

SK_API const char *sk_engine_versions(void) {
    static const std::string s = std::string("ggml=") + SK_GGML_VERSION + ";lane=" + SK_LANE;
    return s.c_str();
}

SK_API sk_status sk_init(const sk_init_options *options) {
    if (!options) { set_error("sk_init: options is NULL"); return SK_ERR_INVALID_ARGUMENT; }
    if (options->abi_version != SK_ABI_VERSION) {
        set_error("sk_init: ABI mismatch: caller " + std::to_string(options->abi_version) +
                  ", library " + std::to_string(SK_ABI_VERSION));
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_initialised) return SK_OK;

    g_log = options->log;
    g_log_user = options->log_user;
    g_threads = options->n_threads > 0 ? options->n_threads : static_cast<int>(std::thread::hardware_concurrency());
    ggml_log_set(ggml_log_bridge, nullptr);

    std::string dir = options->module_dir && options->module_dir[0] ? options->module_dir : own_directory();
    ggml_backend_load_all_from_path(dir.c_str());

    g_devices.clear();
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) g_devices.push_back(ggml_backend_dev_get(i));
    if (g_devices.empty()) {
        set_error("sk_init: no ggml backend modules found in " + dir);
        return SK_ERR_BACKEND;
    }
    log_line(1, ("sk_init: " + std::to_string(g_devices.size()) + " device(s), modules from " + dir +
                 ", " + std::to_string(g_threads) + " threads").c_str());
    g_initialised = true;
    t_last_error.clear();
    return SK_OK;
}

SK_API int32_t sk_devices(sk_device *out, int32_t capacity) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_initialised || !out || capacity <= 0) return 0;
    int32_t n = 0;
    for (size_t i = 0; i < g_devices.size() && n < capacity; ++i, ++n) {
        sk_device &d = out[n];
        std::memset(&d, 0, sizeof d);
        d.index = static_cast<int32_t>(i);
        d.kind = kind_of(g_devices[i]);
        std::snprintf(d.name, sizeof d.name, "%s", ggml_backend_dev_name(g_devices[i]));
        std::snprintf(d.description, sizeof d.description, "%s", ggml_backend_dev_description(g_devices[i]));
        size_t free_b = 0, total_b = 0;
        ggml_backend_dev_memory(g_devices[i], &free_b, &total_b);
        d.mem_total = total_b;
        d.mem_free = free_b;
    }
    return n;
}

SK_API sk_status sk_device_free_mem(int32_t index, uint64_t *bytes) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!bytes || index < 0 || static_cast<size_t>(index) >= g_devices.size()) {
        set_error("sk_device_free_mem: bad index or NULL out-pointer");
        return SK_ERR_INVALID_ARGUMENT;
    }
    size_t free_b = 0, total_b = 0;
    ggml_backend_dev_memory(g_devices[index], &free_b, &total_b);
    *bytes = free_b;
    return SK_OK;
}

}  // extern "C"
