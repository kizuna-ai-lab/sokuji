/* Internal to libsokuji_native: what sk_common.cpp owns and the other sk_*.cpp files use.
 * Never installed. Each function states its locking rule. */
#pragma once
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>
#include "ggml-backend.h"

namespace sk {
void set_error(const std::string &msg);            // thread-local; read back by sk_last_error()
bool require_init(const char *what);                // caller holds mutex(); sets the error when false
std::mutex &mutex();                                // the library-wide lock (init, device table)
int threads();                                      // resolved sk_init thread count, always > 0 after init
const std::vector<ggml_backend_dev_t> &devices();   // index == sk_device.index; stable after sk_init
int32_t kind_of(ggml_backend_dev_t dev);            // SK_DEVICE_CPU / VULKAN / METAL / OTHER
std::string own_directory();                        // directory containing this shared library
void log_line(int32_t level, const char *msg);      // the sk_init log sink, if any
}  // namespace sk
