// Slice-1 surface test. Plain asserts on purpose: no test framework to fetch.
#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include "sokuji_native.h"
#include <cstdio>
#include <cstring>
#include <string>

static int g_log_calls = 0;
static bool log_sink(int, const char *, void *) { ++g_log_calls; return true; }

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";

    assert(sk_abi_version() == SK_ABI_VERSION);
    assert(std::string(sk_version()).rfind("0.", 0) == 0);          // "0.1.0"
    assert(std::strstr(sk_engine_versions(), "ggml=0.22.0") != nullptr);
    assert(std::string(sk_last_error()).empty());

    sk_device before[8];
    assert(sk_devices(before, 8) == 0);                              // nothing before init
    assert(sk_device_free_mem(0, nullptr) == SK_ERR_INVALID_ARGUMENT);

    sk_init_options wrong = {};
    wrong.abi_version = SK_ABI_VERSION + 1;
    assert(sk_init(&wrong) == SK_ERR_INVALID_ARGUMENT);
    assert(std::strstr(sk_last_error(), "ABI") != nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = 4;
    opts.module_dir = module_dir;
    opts.log = log_sink;
    assert(sk_init(&opts) == SK_OK);
    assert(sk_init(&opts) == SK_OK);                                 // idempotent

    sk_device devs[8];
    int n = sk_devices(devs, 8);
    assert(n >= 1);
    bool saw_cpu = false;
    for (int i = 0; i < n; ++i) {
        assert(devs[i].index == i);
        assert(devs[i].name[0] != '\0');
        if (devs[i].kind == SK_DEVICE_CPU) saw_cpu = true;
        uint64_t free_bytes = 0;
        assert(sk_device_free_mem(i, &free_bytes) == SK_OK);
        assert(free_bytes > 0);
    }
    assert(saw_cpu);
    assert(sk_device_free_mem(n + 5, nullptr) == SK_ERR_INVALID_ARGUMENT);

    char *buf = static_cast<char *>(std::malloc(4));
    sk_free(buf);                                                     // must accept malloc'd memory
    sk_free(nullptr);                                                 // and null
    std::printf("test_common: %d devices, %d log lines\n", n, g_log_calls);
    return 0;
}
