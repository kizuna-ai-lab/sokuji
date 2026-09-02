#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "version.h"
#include "sk_internal.h"

#include "ggml-backend.h"
#include "ggml.h"
#include "transcribe.h"
#include "llama.h"

#include <algorithm>
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

/* R32 (slice5b task 3): ggml_barrier() in ggml-cpu.c is a pure spin-wait — no futex, no
 * sched_yield — crossed at every op boundary. Once the worker count reaches the core
 * count there is no spare core to absorb the main thread, the Python interpreter, or any
 * other process on the box; a single descheduled worker makes every other worker
 * spin-burn its full timeslice, and the whole graph stalls until it is rescheduled.
 * Measured on GB10 (nproc=20; moss_tts_nano, pocket_tts, supertonic synth, whisper-tiny
 * ASR; n_threads in {4,6,8,12,16,20}, 4 runs/cell, fresh process per row): n_threads==20
 * (==nproc) is catastrophic everywhere (run-to-run spread 1.18x-4.32x); n_threads==12 is
 * the best point that is simultaneously within ~2% of ASR's own best (12 vs 16: ASR
 * 0.361s vs 0.354s median) AND tight/non-noisy for every TTS family (spread <=1.04x at
 * 12 vs 1.15-1.16x at 16, where pocket_tts is also ~18% *slower* in absolute terms than
 * at 12). 8, this constant's original hypothesis, is tight for TTS too but costs ASR
 * ~26% (0.447s vs 0.354s) — ASR is the latency-critical engine, so 12 wins. Full table:
 * .superpowers/sdd/2026-09-02-sidecar-ggml-only-slice5b-debt/task-3-report.md.
 * kThreadKnee is that measured knee, NOT hardware_concurrency: sk_init() caps an
 * unspecified (0) n_threads at this value so a caller never has to know about the
 * underlying ggml quirk. A positive n_threads is always honored verbatim (see
 * sokuji_native.h's sk_init_options doc) — this policy applies only to the 0 case. */
constexpr int kThreadKnee = 12;

thread_local std::string t_last_error;
std::mutex g_mutex;
bool g_initialised = false;
int  g_threads = 0;
sk_log_cb g_log = nullptr;
void *g_log_user = nullptr;
std::vector<ggml_backend_dev_t> g_devices;

void set_error(const std::string &msg) { t_last_error = msg; }

/* Every entry point that needs a live library calls this first. Caller holds g_mutex. */
bool require_init(const char *what) {
    if (g_initialised) return true;
    set_error(std::string(what) + ": sk_init has not succeeded");
    return false;
}

/* Warnings and errors survive even when the caller registered no sink. ggml names the
 * op it cannot run ("unsupported op 'DIAG_MASK_INF'") through this path immediately
 * before GGML_ABORT kills the process; with g_log NULL that line was dropped, which is
 * the sole reason the slice-4 metal-lane CI abort reached the log with no op name.
 * info/debug stay silent so a sink-less caller is not spammed by ggml's load-time
 * chatter. Levels are the ones ggml_log_bridge below maps to: 3 error, 2 warn, 1 info,
 * 0 debug. */
void log_line(int32_t level, const char *msg) {
    if (g_log) {
        g_log(level, msg, g_log_user);
        return;
    }
    if (level >= 2) {
        std::fprintf(stderr, "[sokuji_native] %s\n", msg);
    }
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
    if (reg_name == "Vulkan") return SK_DEVICE_VULKAN;   // GGML_VK_NAME
    if (reg_name == "MTL")    return SK_DEVICE_METAL;    // GGML_METAL_NAME is "MTL", not "Metal"
    return SK_DEVICE_OTHER;
}

}  // namespace

namespace sk {
void set_error(const std::string &msg) { ::set_error(msg); }
bool require_init(const char *what) { return ::require_init(what); }
std::mutex &mutex() { return g_mutex; }
int threads() { return g_threads; }
const std::vector<ggml_backend_dev_t> &devices() { return g_devices; }
int32_t kind_of(ggml_backend_dev_t dev) { return ::kind_of(dev); }
std::string own_directory() { return ::own_directory(); }
void log_line(int32_t level, const char *msg) { ::log_line(level, msg); }
}  // namespace sk

extern "C" {

SK_API int32_t sk_abi_version(void) { return SK_ABI_VERSION; }
/* Not locked: g_threads is written once (under g_mutex) during sk_init and never again,
 * so an unlocked read here is safe and, unlike sk::threads(), lets a caller that is
 * already inside a locked section (there are none today) call this without deadlocking. */
SK_API int32_t sk_threads(void) { return sk::threads(); }
SK_API const char *sk_version(void) { return SK_VERSION_STRING; }
SK_API const char *sk_last_error(void) { return t_last_error.c_str(); }
SK_API void sk_free(void *p) { std::free(p); }

SK_API const char *sk_engine_versions(void) {
    /* Slice 1 links llama.cpp but calls nothing from it; llama_max_devices() is the one
     * reference that keeps the static archive in the link. Its value is not part of the
     * version string (that string is parsed key=value by the Python side), so it is
     * parked in a volatile the optimiser may not drop. */
    static volatile size_t llama_linked = llama_max_devices();
    (void)llama_linked;
    static const std::string s = std::string("ggml=") + SK_GGML_VERSION +
                                 ";transcribe=" + transcribe_version() +
                                 ";llama=" + SK_LLAMA_VERSION +
                                 ";audiocpp=" + SK_AUDIOCPP_VERSION +
                                 ";lane=" + SK_LANE;
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
    bool threads_explicit = options->n_threads > 0;
    unsigned hw = std::thread::hardware_concurrency();
    if (threads_explicit) {
        g_threads = options->n_threads;
    } else {
        // Parenthesized to defeat windows.h's min/max macros (MSVC C2589/C2059 otherwise —
        // this file includes <windows.h> above on _WIN32).
        g_threads = static_cast<int>(hw == 0 ? 1u : (std::min)(hw, static_cast<unsigned>(kThreadKnee)));
    }
    ggml_log_set(ggml_log_bridge, nullptr);

    std::string dir = options->module_dir && options->module_dir[0] ? options->module_dir : own_directory();
    ggml_backend_load_all_from_path(dir.c_str());

    /* Only devices a stage can be placed on are listed: CPU and (integrated) GPU. ggml also
     * registers accelerator devices — the Accelerate BLAS backend on macOS is one — which
     * are not placement targets and report no memory at all (free = total = 0). They stay
     * in ggml's registry, where llama.cpp's scheduler still picks them up on its own. */
    g_devices.clear();
    size_t skipped = 0;
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        ggml_backend_dev_t dev = ggml_backend_dev_get(i);
        switch (ggml_backend_dev_type(dev)) {
            case GGML_BACKEND_DEVICE_TYPE_CPU:
            case GGML_BACKEND_DEVICE_TYPE_GPU:
            case GGML_BACKEND_DEVICE_TYPE_IGPU:
                g_devices.push_back(dev);
                break;
            default:   /* ACCEL, META */
                ++skipped;
                break;
        }
    }
    if (g_devices.empty()) {
        set_error("sk_init: no ggml backend modules found in " + dir);
        return SK_ERR_BACKEND;
    }
    std::string thread_reason = threads_explicit
        ? "explicit"
        : "native policy: min(hw=" + std::to_string(hw) + ", knee=" + std::to_string(kThreadKnee) +
          ") — ggml's spin-wait barrier degrades once worker count reaches core count";
    log_line(1, ("sk_init: " + std::to_string(g_devices.size()) + " device(s), " +
                 std::to_string(skipped) + " accelerator(s) not listed, modules from " + dir +
                 ", " + std::to_string(g_threads) + " threads (" + thread_reason + ")").c_str());
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
    if (!require_init("sk_device_free_mem")) return SK_ERR_NOT_INITIALISED;
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
