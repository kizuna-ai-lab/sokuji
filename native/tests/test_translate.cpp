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

    // Explicit CPU device, exactly as test_asr.cpp does: device == NULL leaves llama's own
    // default (all available devices, n_gpu_layers == -1), which on a GPU lane (e.g. CI's
    // mac-arm64 Metal build) would run this test on the GPU instead of pinning CPU like every
    // other native test.
    sk_device devs[8];
    int n_devs = sk_devices(devs, 8);
    const sk_device *cpu = nullptr;
    for (int i = 0; i < n_devs; ++i) if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i];
    if (!cpu) { std::fprintf(stderr, "no CPU device reported by sk_devices\n"); return 1; }

    sk_translate *t = nullptr;
    sk_translate_options topt{}; topt.n_ctx = 2048;
    if (sk_translate_load(gguf, cpu, &topt, &t) != SK_OK) {
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

    // Round-1 review finding 1: a prompt that tokenizes to zero tokens (add_bos_token=false on
    // Qwen3, so an empty prompt has nothing to tokenize) must not reach llama_sampler_sample —
    // it asserts on missing logits and SIGABRTs the whole process. Confirm the guard rejects it
    // cleanly, then confirm the handle is still usable afterwards.
    std::string empty_out;
    sk_status empty_st = sk_translate_complete(t, "", &gen2, collect, &empty_out);
    if (empty_st != SK_ERR_INVALID_ARGUMENT) {
        std::fprintf(stderr, "expected SK_ERR_INVALID_ARGUMENT for an empty prompt, got %d\n", empty_st);
        return 1;
    }
    std::string out3;
    if (sk_translate_complete(t, "The capital of Germany is", &gen2, collect, &out3) != SK_OK) {
        std::fprintf(stderr, "complete after empty-prompt guard failed: %s\n", sk_last_error()); return 1;
    }
    if (out3.empty()) { std::fprintf(stderr, "process survived but produced nothing\n"); return 1; }
    std::fprintf(stderr, "complete after empty-prompt guard: %s\n", out3.c_str());

    // Round-1 review finding 2: llama clamps a context's actual batch size to
    // min(n_ctx, requested n_batch); a hardcoded n_batch=512 chunk loop desyncs from that when
    // n_ctx < 512 and overruns it, aborting the process. Load a second, small-context handle and
    // feed it a prompt long enough to exceed n_ctx — must fail cleanly (not SK_OK), not abort.
    sk_translate *small = nullptr;
    sk_translate_options small_opt{}; small_opt.n_ctx = 256;
    if (sk_translate_load(gguf, cpu, &small_opt, &small) != SK_OK) {
        std::fprintf(stderr, "small-context load failed: %s\n", sk_last_error()); return 1;
    }
    std::string long_prompt;
    for (int i = 0; i < 400; ++i) long_prompt += "The quick brown fox jumps over the lazy dog. ";
    std::string overflow_out;
    sk_gen_options gen3{}; gen3.max_tokens = 8;
    sk_status overflow_st = sk_translate_complete(small, long_prompt.c_str(), &gen3, collect, &overflow_out);
    if (overflow_st == SK_OK) {
        std::fprintf(stderr, "expected a non-SK_OK status for a prompt exceeding n_ctx=256\n"); return 1;
    }
    std::fprintf(stderr, "overflow prompt vs n_ctx=256: status=%d (%s)\n", overflow_st, sk_last_error());
    sk_translate_unload(small);

    sk_translate_unload(t);
    std::puts("test_translate ok");
    return 0;
}
