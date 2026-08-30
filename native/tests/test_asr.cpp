// Slice-2 ASR surface test. Needs a real GGUF: SK_TEST_ASR_GGUF (whisper-tiny Q8_0).
// Without it the test SKIPS (exit 77, see tests/CMakeLists.txt) — the models are not
// vendored; CI downloads them (native-build.yml), developers export the variable.
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "wav.h"

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

    // ---- Task 2: batch run + cancellation ----
    std::vector<float> jfk = read_wav_16k_mono(SK_TEST_SAMPLE_WAV);      // "ask not what your country…", 11 s
    struct Collect { std::string text; int polls = 0; bool cancel_at_first_poll = false; };
    auto on_text = [](const char *text, void *user) -> bool {
        auto *c = static_cast<Collect *>(user);
        if (text == nullptr) { ++c->polls; return !c->cancel_at_first_poll; }   // progress poll
        c->text = text;
        return true;
    };
    Collect c;
    assert(sk_asr_run(m, jfk.data(), jfk.size(), "en", on_text, &c) == SK_OK);
    std::printf("test_asr: run -> %s\n", c.text.c_str());
    assert(c.text.find("ask not") != std::string::npos || c.text.find("Ask not") != std::string::npos);
    assert(c.polls > 0);                                                 // the poll fired at least once

    Collect empty;
    assert(sk_asr_run(m, jfk.data(), 0, "en", on_text, &empty) == SK_OK); // n == 0 short-circuits
    assert(empty.text.empty() && empty.polls == 0);

    Collect cancelled;
    cancelled.cancel_at_first_poll = true;
    assert(sk_asr_run(m, jfk.data(), jfk.size(), nullptr, on_text, &cancelled) == SK_ERR_CANCELLED);
    assert(cancelled.text.empty());                                      // no transcript after a cancel
    assert(std::strstr(sk_last_error(), "cancel") != nullptr);

    Collect again;                                                       // the model is reusable after a cancel
    assert(sk_asr_run(m, jfk.data(), jfk.size(), "en", on_text, &again) == SK_OK);
    assert(!again.text.empty());
    assert(sk_asr_run(nullptr, jfk.data(), jfk.size(), "en", on_text, &again) == SK_ERR_INVALID_ARGUMENT);

    std::printf("test_asr: load/capabilities ok (arch=%s, %d languages)\n", caps.arch, caps.n_languages);
    sk_asr_unload(m);   // caps.arch/languages point into m's storage — print before this call
    sk_asr_unload(nullptr);                                            // must accept null
    return 0;
}
