// Slice-2 ASR surface test. Needs a real GGUF: SK_TEST_ASR_GGUF (whisper-tiny Q8_0).
// Without it the test SKIPS (exit 77, see tests/CMakeLists.txt) — the models are not
// vendored; CI downloads them (native-build.yml), developers export the variable.
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include "sokuji_native.h"

static const char *env_or_skip(const char *name) {
    const char *v = std::getenv(name);
    if (!v || !*v) { std::printf("test_asr: %s not set, skipping\n", name); std::exit(77); }
    return v;
}

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    const char *gguf = env_or_skip("SK_TEST_ASR_GGUF");

    sk_asr_model *before = nullptr;
    assert(sk_asr_load(gguf, nullptr, &before) == SK_ERR_NOT_INITIALISED);   // nothing before sk_init
    assert(before == nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = 4;
    opts.module_dir = module_dir;
    assert(sk_init(&opts) == SK_OK);

    sk_asr_model *m = nullptr;
    assert(sk_asr_load("/nonexistent/model.gguf", nullptr, &m) == SK_ERR_NOT_FOUND);
    assert(m == nullptr && std::strstr(sk_last_error(), "sk_asr_load") != nullptr);

    sk_device devs[8];
    int n = sk_devices(devs, 8);
    const sk_device *cpu = nullptr;
    for (int i = 0; i < n; ++i) if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i];
    assert(cpu != nullptr);

    assert(sk_asr_load(gguf, cpu, &m) == SK_OK);
    assert(m != nullptr);
    sk_asr_caps caps = {};
    assert(sk_asr_capabilities(m, &caps) == SK_OK);
    assert(caps.native_sample_rate == 16000);
    assert(caps.arch != nullptr && caps.arch[0] != '\0');
    assert(caps.n_languages > 0 && caps.languages != nullptr);        // whisper publishes its 99
    bool saw_en = false;
    for (int i = 0; i < caps.n_languages; ++i) if (std::strcmp(caps.languages[i], "en") == 0) saw_en = true;
    assert(saw_en);
    assert(caps.supports_streaming == false);                          // whisper: batch only
    assert(sk_asr_capabilities(nullptr, &caps) == SK_ERR_INVALID_ARGUMENT);
    std::printf("test_asr: load/capabilities ok (arch=%s, %d languages)\n", caps.arch, caps.n_languages);
    sk_asr_unload(m);   // caps.arch/languages point into m's storage — print before this call
    sk_asr_unload(nullptr);                                            // must accept null
    return 0;
}
