// sk_translate smoke: chat with prefill suppresses thinking, streaming cancels, complete() works.
// Needs a real GGUF: SK_TEST_TRANSLATE_GGUF (Qwen3-0.6B Q8_0). Without it the test SKIPS
// (exit 77, see tests/CMakeLists.txt) — the model is not vendored; CI downloads it
// (native-build.yml), developers export the variable (see native/README.md).
#include "sokuji_native.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static bool collect(const char *piece, void *user) {
    if (piece) static_cast<std::string *>(user)->append(piece);
    return true;
}
struct CancelCtl { int seen = 0; };
static bool cancel_after_3(const char *piece, void *user) {
    auto *c = static_cast<CancelCtl *>(user);
    if (piece) c->seen++;
    return c->seen < 3;
}

int main(int argc, char **argv) {
    const char *gguf = std::getenv("SK_TEST_TRANSLATE_GGUF");
    if (!gguf || !*gguf) { std::fprintf(stderr, "SK_TEST_TRANSLATE_GGUF not set — skip\n"); return 77; }

    const char *module_dir = argc > 1 ? argv[1] : ".";
    sk_init_options iopt = {};
    iopt.abi_version = SK_ABI_VERSION;
    iopt.n_threads = 4;
    iopt.module_dir = module_dir;
    if (sk_init(&iopt) != SK_OK) {
        std::fprintf(stderr, "sk_init failed: %s\n", sk_last_error());
        return 1;
    }

    sk_translate *t = nullptr;
    sk_translate_options topt{}; topt.n_ctx = 2048;
    if (sk_translate_load(gguf, nullptr /* default cpu device as test_asr does */, &topt, &t) != SK_OK) {
        std::fprintf(stderr, "load failed: %s\n", sk_last_error()); return 1;
    }
    // A longer sentence than a bare greeting: greedy decoding of "Good morning." alone
    // finishes in 2 pieces ("Bonjour" + "."), too short to exercise a mid-stream cancel.
    sk_message msgs[2] = {
        {"system", "You are a translator. Translate the user's text from English to French. Output only the translation."},
        {"user", "Good morning, everyone. I hope you have a wonderful and productive day ahead."},
    };
    sk_gen_options gen{}; gen.max_tokens = 64; gen.assistant_prefill = "<think>\n\n</think>\n\n";
    std::string out;
    if (sk_translate_chat(t, msgs, 2, &gen, collect, &out) != SK_OK) {
        std::fprintf(stderr, "chat failed: %s\n", sk_last_error()); return 1;
    }
    std::fprintf(stderr, "chat: %s\n", out.c_str());
    if (out.empty()) return 1;
    if (out.find("<think>") != std::string::npos) { std::fprintf(stderr, "thinking leaked\n"); return 1; }

    CancelCtl ctl;
    sk_status st = sk_translate_chat(t, msgs, 2, &gen, cancel_after_3, &ctl);
    if (st != SK_ERR_CANCELLED) { std::fprintf(stderr, "expected SK_ERR_CANCELLED, got %d\n", st); return 1; }
    if (ctl.seen != 3) { std::fprintf(stderr, "decoded past the cancel: %d\n", ctl.seen); return 1; }

    std::string out2;
    sk_gen_options gen2{}; gen2.max_tokens = 16;
    if (sk_translate_complete(t, "The capital of France is", &gen2, collect, &out2) != SK_OK) {
        std::fprintf(stderr, "complete failed: %s\n", sk_last_error()); return 1;
    }
    std::fprintf(stderr, "complete: %s\n", out2.c_str());
    if (out2.empty()) return 1;

    sk_translate_unload(t);
    std::puts("test_translate ok");
    return 0;
}
