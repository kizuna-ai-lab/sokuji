// Slice-1 surface test. Plain asserts on purpose: no test framework to fetch.
#undef NDEBUG
#include <algorithm>
#include <cassert>
#include <cstdlib>
#include "sokuji_native.h"
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

static int g_log_calls = 0;
static bool log_sink(int, const char *, void *) { ++g_log_calls; return true; }

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    // argv[2], optional: the n_threads to request from sk_init. Two ctest cases share this
    // binary — "test_common" (explicit, default 3) and "test_common_threads_policy" (0) —
    // to exercise both branches of R32's thread policy without needing a second process
    // inside one already-idempotent sk_init.
    int requested_threads = argc > 2 ? std::atoi(argv[2]) : 3;

    assert(sk_abi_version() == SK_ABI_VERSION);
    assert(std::string(sk_version()) == "0.6.1");
    assert(std::strstr(sk_engine_versions(), "ggml=0.22.0") != nullptr);
    assert(std::strstr(sk_engine_versions(), "transcribe=0.2.2") != nullptr);
    assert(std::strstr(sk_engine_versions(), "llama=0.3.0;") != nullptr);   // normalised: no "v", no suffix
    assert(std::string(sk_last_error()).empty());

    sk_device before[8];
    assert(sk_devices(before, 8) == 0);                              // nothing before init
    uint64_t before_bytes = 0;                                       // pre-init, argument shape is irrelevant:
    assert(sk_device_free_mem(0, nullptr) == SK_ERR_NOT_INITIALISED);// the library is not initialised
    assert(sk_device_free_mem(0, &before_bytes) == SK_ERR_NOT_INITIALISED);
    assert(std::strstr(sk_last_error(), "sk_init") != nullptr);

    sk_init_options wrong = {};
    wrong.abi_version = SK_ABI_VERSION + 1;
    assert(sk_init(&wrong) == SK_ERR_INVALID_ARGUMENT);
    assert(std::strstr(sk_last_error(), "ABI") != nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = requested_threads;
    opts.module_dir = module_dir;
    opts.log = log_sink;
    assert(sk_init(&opts) == SK_OK);
    assert(sk_init(&opts) == SK_OK);                                 // idempotent

    // R32: n_threads > 0 is always honored verbatim; n_threads == 0 resolves to
    // min(hardware_concurrency, the measured knee) — see sk_common.cpp's kThreadKnee.
    int32_t threads = sk_threads();
    if (requested_threads > 0) {
        assert(threads == requested_threads);
    } else {
        constexpr int kThreadKnee = 12;   // keep in sync with sk_common.cpp's kThreadKnee
        unsigned hw = std::thread::hardware_concurrency();
        int expect = static_cast<int>(hw == 0 ? 1u : std::min(hw, static_cast<unsigned>(kThreadKnee)));
        assert(threads == expect);
    }

    sk_device devs[8];
    int n = sk_devices(devs, 8);
    assert(n >= 1);
    bool saw_cpu = false;
    for (int i = 0; i < n; ++i) {
        assert(devs[i].index == i);
        assert(devs[i].name[0] != '\0');
        if (devs[i].kind == SK_DEVICE_CPU) saw_cpu = true;
        assert(devs[i].mem_total > 0);                               // accelerators (0/0) are never listed
        uint64_t free_bytes = 0;
        assert(sk_device_free_mem(i, &free_bytes) == SK_OK);
        assert(free_bytes > 0);
    }
    assert(saw_cpu);
    assert(sk_device_free_mem(n + 5, nullptr) == SK_ERR_INVALID_ARGUMENT);

    char *buf = static_cast<char *>(std::malloc(4));
    sk_free(buf);                                                     // must accept malloc'd memory
    sk_free(nullptr);                                                 // and null

    assert(std::strstr(sk_engine_versions(), "audiocpp=0.7.0") != nullptr);
    const char *fams[16];
    int nf = sk_audio_families(fams, 16);
    assert(nf >= 6);                                                  // may include companion families too
    const char *want[] = {"moss_tts_nano", "omnivoice", "pocket_tts", "qwen3_tts", "silero_vad", "supertonic"};
    for (const char *w : want) {
        bool found = false;
        for (int i = 0; i < nf; ++i) if (std::strcmp(fams[i], w) == 0) found = true;
        assert(found);
    }
    for (int i = 1; i < nf; ++i) assert(std::strcmp(fams[i - 1], fams[i]) < 0);   // sorted, no duplicates

    std::string family_list;
    for (int i = 0; i < nf; ++i) { if (i) family_list += ","; family_list += fams[i]; }
    std::printf("test_common: %d devices, %d log lines, %d audio families [%s]\n",
                n, g_log_calls, nf, family_list.c_str());
    return 0;
}
