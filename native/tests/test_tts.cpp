// sk_tts smoke: supertonic (streaming, presets, cancel-then-resume) and moss_tts_nano
// (offline, one-shot, voice clone). Needs two real model directories, each holding one
// .gguf (audio.cpp materializes the family's config/voice-style sidecars from the GGUF's
// own embedded metadata, so nothing else needs to live alongside it — see native/README.md):
// SK_TEST_TTS_SUPERTONIC_DIR, SK_TEST_TTS_MOSS_DIR. Without both the test SKIPS (exit 77,
// see tests/CMakeLists.txt) — the models are not vendored; CI downloads them
// (native-build.yml), developers export the variables.
#undef NDEBUG
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "sokuji_native.h"

static const char *env_or_skip(const char *name) {
    const char *v = std::getenv(name);
    if (!v || !*v) { std::printf("test_tts: %s not set, skipping\n", name); std::exit(77); }
    return v;
}

struct Collected {
    std::vector<float> samples;
    int32_t rate = 0;
    int32_t channels = 0;
    int calls = 0;
    bool rate_consistent = true;
};

static bool collect(const float *pcm, size_t n, int32_t rate, int32_t channels, void *user) {
    auto *c = static_cast<Collected *>(user);
    ++c->calls;
    if (c->rate != 0 && c->rate != rate) c->rate_consistent = false;
    c->rate = rate;
    c->channels = channels;
    if (pcm && n > 0) c->samples.insert(c->samples.end(), pcm, pcm + n);
    return true;
}

struct CancelCtl { int calls = 0; };
static bool cancel_after_first(const float *pcm, size_t n, int32_t rate, int32_t channels, void *user) {
    (void)pcm; (void)n; (void)rate; (void)channels;
    static_cast<CancelCtl *>(user)->calls++;
    return false;   // cancel on the very first chunk delivered
}

struct NameCollector { std::vector<std::string> names; };
static bool collect_name(const char *text, void *user) {
    if (text) static_cast<NameCollector *>(user)->names.emplace_back(text);
    return true;
}

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    const char *supertonic_dir = env_or_skip("SK_TEST_TTS_SUPERTONIC_DIR");
    const char *moss_dir = env_or_skip("SK_TEST_TTS_MOSS_DIR");

    sk_init_options iopt = {};
    iopt.abi_version = SK_ABI_VERSION;
    iopt.n_threads = 4;
    iopt.module_dir = module_dir;
    if (sk_init(&iopt) != SK_OK) {
        std::fprintf(stderr, "sk_init failed: %s\n", sk_last_error());
        return 1;
    }

    // Explicit CPU device, exactly as test_asr.cpp / test_translate.cpp do: device == NULL
    // leaves audio.cpp's own default (BestAvailable), which on a GPU lane would run this
    // test on the GPU instead of pinning CPU like every other native test.
    sk_device devs[8];
    int n_devs = sk_devices(devs, 8);
    const sk_device *cpu = nullptr;
    for (int i = 0; i < n_devs; ++i) if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i];
    if (!cpu) { std::fprintf(stderr, "no CPU device reported by sk_devices\n"); return 1; }

    // ---- supertonic: streaming, presets, cancel-then-resume ----
    sk_tts *st = nullptr;
    sk_tts_options st_opts = {};
    st_opts.family = "supertonic";
    if (sk_tts_load(supertonic_dir, cpu, &st_opts, &st) != SK_OK) {
        std::fprintf(stderr, "supertonic load failed: %s\n", sk_last_error());
        return 1;
    }

    sk_tts_caps st_caps = {};
    if (sk_tts_capabilities(st, &st_caps) != SK_OK) {
        std::fprintf(stderr, "supertonic capabilities failed: %s\n", sk_last_error());
        return 1;
    }
    if (!st_caps.streaming || st_caps.clones || st_caps.sample_rate != 44100) {
        std::fprintf(stderr, "supertonic caps unexpected: streaming=%d clones=%d rate=%d\n",
                      st_caps.streaming, st_caps.clones, st_caps.sample_rate);
        return 1;
    }

    NameCollector names;
    if (sk_tts_presets(st, collect_name, &names) != SK_OK) {
        std::fprintf(stderr, "supertonic presets failed: %s\n", sk_last_error());
        return 1;
    }
    bool has_m1 = false;
    for (auto &n : names.names) if (n == "M1") has_m1 = true;
    if (names.names.size() < 10 || !has_m1) {
        std::fprintf(stderr, "supertonic presets unexpected: %zu names, M1 present=%d\n",
                      names.names.size(), has_m1);
        return 1;
    }
    std::string preset_list;
    for (auto &n : names.names) { if (!preset_list.empty()) preset_list += ","; preset_list += n; }
    std::fprintf(stderr, "supertonic presets: [%s]\n", preset_list.c_str());

    // CQ-2: an unknown preset name is rejected against the cached (authoritative for
    // supertonic) list, not silently accepted and left to fail opaquely at synth time.
    sk_status bad_preset_rc = sk_tts_set_preset(st, "NO_SUCH");
    if (bad_preset_rc != SK_ERR_INVALID_ARGUMENT) {
        std::fprintf(stderr, "expected SK_ERR_INVALID_ARGUMENT for an unknown preset, got %d\n", bad_preset_rc);
        return 1;
    }

    if (sk_tts_set_preset(st, "M1") != SK_OK) {
        std::fprintf(stderr, "supertonic set_preset failed after a rejected preset: %s\n", sk_last_error());
        return 1;
    }

    // Supertonic's default English text-chunk budget is 300 codepoints
    // (supertonic/session.cpp:build_chunk_requests) and streaming yields one event per text
    // chunk (report §2) — a bare "Hello from the parity gate." (28 chars) is one chunk on its
    // own, so this text is long enough (two sentences, >300 chars total) to genuinely span
    // more than one streaming chunk under the family's own defaults.
    Collected st_out;
    sk_status st_rc = sk_tts_synth(st,
        "Hello from the parity gate. This sentence is intentionally long enough to span more than "
        "one streaming chunk, so the cancel-and-resume test can exercise a genuine multi-chunk pull "
        "loop end to end, matching the exact chunk boundaries audio.cpp itself produces for an "
        "ordinary paragraph of prose sent through this interface.",
        "en", 1.0f, collect, &st_out);
    if (st_rc != SK_OK) {
        std::fprintf(stderr, "supertonic synth failed: status=%d %s\n", st_rc, sk_last_error());
        return 1;
    }
    if (st_out.calls < 2 || st_out.samples.empty() || !st_out.rate_consistent || st_out.rate != 44100) {
        std::fprintf(stderr, "supertonic synth unexpected: calls=%d samples=%zu rate=%d consistent=%d\n",
                      st_out.calls, st_out.samples.size(), st_out.rate, st_out.rate_consistent);
        return 1;
    }
    std::fprintf(stderr, "supertonic synth: %d chunk(s), %zu samples, %d Hz\n",
                 st_out.calls, st_out.samples.size(), st_out.rate);

    CancelCtl cancel_ctl;
    sk_status cancel_rc = sk_tts_synth(st,
        "A longer sentence, long enough that a second streaming chunk would surely follow after the "
        "first one, is used here to make sure the callback returning false actually interrupts the "
        "pull loop before the remaining audio chunks are ever produced, rather than merely finishing "
        "a synthesis run that was always going to be a single chunk anyway.",
        "en", 1.0f, cancel_after_first, &cancel_ctl);
    if (cancel_rc != SK_ERR_CANCELLED) {
        std::fprintf(stderr, "expected SK_ERR_CANCELLED, got %d (%s)\n", cancel_rc, sk_last_error());
        return 1;
    }
    if (cancel_ctl.calls != 1) {
        std::fprintf(stderr, "expected exactly 1 chunk before cancel, got %d\n", cancel_ctl.calls);
        return 1;
    }

    Collected st_out2;
    sk_status resume_rc = sk_tts_synth(st, "Still working after a cancel.", "en", 1.0f, collect, &st_out2);
    if (resume_rc != SK_OK || st_out2.samples.empty()) {
        std::fprintf(stderr, "supertonic synth after cancel failed: status=%d %s\n", resume_rc, sk_last_error());
        return 1;
    }
    std::fprintf(stderr, "supertonic synth after cancel: %d chunk(s), %zu samples\n",
                 st_out2.calls, st_out2.samples.size());

    sk_tts_unload(st);

    // ---- moss_tts_nano: offline, one-shot, voice clone ----
    sk_tts *moss = nullptr;
    sk_tts_options moss_opts = {};
    moss_opts.family = "moss_tts_nano";
    if (sk_tts_load(moss_dir, cpu, &moss_opts, &moss) != SK_OK) {
        std::fprintf(stderr, "moss load failed: %s\n", sk_last_error());
        return 1;
    }

    sk_tts_caps moss_caps = {};
    if (sk_tts_capabilities(moss, &moss_caps) != SK_OK) {
        std::fprintf(stderr, "moss capabilities failed: %s\n", sk_last_error());
        return 1;
    }
    if (moss_caps.streaming || !moss_caps.clones) {
        std::fprintf(stderr, "moss caps unexpected: streaming=%d clones=%d\n", moss_caps.streaming, moss_caps.clones);
        return 1;
    }

    Collected moss_out;
    sk_status moss_rc = sk_tts_synth(moss, "Hello from MOSS.", nullptr, 1.0f, collect, &moss_out);
    if (moss_rc != SK_OK) {
        std::fprintf(stderr, "moss synth failed: status=%d %s\n", moss_rc, sk_last_error());
        return 1;
    }
    if (moss_out.calls != 1 || moss_out.rate != 48000 || moss_out.samples.empty()) {
        std::fprintf(stderr, "moss synth unexpected: calls=%d rate=%d samples=%zu\n",
                      moss_out.calls, moss_out.rate, moss_out.samples.size());
        return 1;
    }
    std::fprintf(stderr, "moss synth: %d call(s), %zu samples, %d Hz\n",
                 moss_out.calls, moss_out.samples.size(), moss_out.rate);

    // 1-second 440Hz sine, 24kHz mono — the brief's clone reference clip.
    std::vector<float> ref(24000);
    for (size_t i = 0; i < ref.size(); ++i)
        ref[i] = static_cast<float>(std::sin(2.0 * M_PI * 440.0 * static_cast<double>(i) / 24000.0));
    if (sk_tts_set_voice(moss, ref.data(), ref.size(), 24000, "test") != SK_OK) {
        std::fprintf(stderr, "moss set_voice failed: %s\n", sk_last_error());
        return 1;
    }

    Collected moss_out2;
    sk_status moss_rc2 = sk_tts_synth(moss, "Hello again.", nullptr, 1.0f, collect, &moss_out2);
    if (moss_rc2 != SK_OK) {
        std::fprintf(stderr, "moss clone synth failed: status=%d %s\n", moss_rc2, sk_last_error());
        return 1;
    }
    if (moss_out2.calls != 1 || moss_out2.samples.empty()) {
        std::fprintf(stderr, "moss clone synth unexpected: calls=%d samples=%zu\n",
                      moss_out2.calls, moss_out2.samples.size());
        return 1;
    }
    std::fprintf(stderr, "moss clone synth: %d call(s), %zu samples, %d Hz\n",
                 moss_out2.calls, moss_out2.samples.size(), moss_out2.rate);

    sk_tts_unload(moss);

    std::puts("test_tts ok");
    return 0;
}
