/* One forward pass of one family with the recorder armed. Requires: sk_record_register_device()
 * called BEFORE sk_init, sk_init done, `devs`/`n` from sk_devices(). Writes the .ops file. */
#pragma once
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <set>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "gguf.h"
#include "ggml.h"

static const char *const RUNG_OPS[] = {"MUL_MAT", "MUL_MAT_ID", "GET_ROWS"};

static std::string find_gguf(const std::string &path) {     // a directory → its single .gguf; a file → itself
    if (path.size() > 5 && path.compare(path.size() - 5, 5, ".gguf") == 0) return path;
    for (const auto &e : std::filesystem::directory_iterator(path))
        if (e.path().extension() == ".gguf") return e.path().string();
    return "";
}

static bool ignore_text(const char *, void *) { return true; }
static bool ignore_audio(const float *, size_t, int32_t, int32_t, void *) { return true; }
struct Clip { std::vector<float> pcm; int32_t rate = 0; };
static bool grab_audio(const float *pcm, size_t n, int32_t rate, int32_t, void *user) {
    auto *c = static_cast<Clip *>(user); c->pcm.insert(c->pcm.end(), pcm, pcm + n); c->rate = rate; return true;
}

/* A real speech clip for the clone-only families: supertonic preset M1 on the CPU device, made
 * BEFORE recording starts so its nodes never leak into the other family's file. */
static Clip reference_clip(const sk_device *cpu, const std::string &supertonic_dir) {
    Clip c;
    sk_tts_options o{"supertonic", nullptr};
    sk_tts *m = nullptr;
    if (sk_tts_load(supertonic_dir.c_str(), cpu, &o, &m) != SK_OK) return c;
    sk_tts_set_preset(m, "M1");
    sk_tts_synth(m, "The quick brown fox jumps over the lazy dog.", "en", 1.0f, grab_audio, &c);
    sk_tts_unload(m);
    return c;
}

/* Returns the node count written (0 = nothing recorded — treat as a failure). */
static int record_family(const std::string &stage, const std::string &family, const std::string &model,
                         const sk_device *dev, const std::string &out_path, int32_t flash_attn,
                         const std::string &supertonic_dir) {
    const std::string gguf = find_gguf(model);
    std::vector<std::string> names, dtypes_v; std::set<std::string> dtypes;
    {
        gguf_init_params ip = { /*no_alloc*/ true, /*ctx*/ nullptr };
        gguf_context *g = gguf_init_from_file(gguf.c_str(), ip);
        if (!g) { std::fprintf(stderr, "record_family: cannot read %s\n", gguf.c_str()); return 0; }
        for (int64_t i = 0; i < gguf_get_n_tensors(g); ++i) {
            names.push_back(gguf_get_tensor_name(g, i));
            dtypes.insert(ggml_type_name(gguf_get_tensor_type(g, i)));
        }
        gguf_free(g);
    }
    dtypes_v.assign(dtypes.begin(), dtypes.end());
    std::vector<const char *> name_ptrs; for (auto &s : names) name_ptrs.push_back(s.c_str());
    std::vector<const char *> dtype_ptrs; for (auto &s : dtypes_v) dtype_ptrs.push_back(s.c_str());

    Clip ref;
    const bool needs_voice = family == "qwen3_tts" || family == "omnivoice" || family == "index_tts2";
    if (needs_voice) ref = reference_clip(dev, supertonic_dir);

    sk_record_begin(name_ptrs.data(), (int32_t)name_ptrs.size(), RUNG_OPS, 3);
    if (stage == "tts") {
        sk_tts_options o{family.c_str(), family == "pocket_tts" ? "english" : nullptr};
        sk_tts *m = nullptr;
        if (sk_tts_load(model.c_str(), dev, &o, &m) != SK_OK) { std::fprintf(stderr, "tts load: %s\n", sk_last_error()); return 0; }
        if (needs_voice && !ref.pcm.empty()) sk_tts_set_voice(m, ref.pcm.data(), ref.pcm.size(), ref.rate, "The quick brown fox jumps over the lazy dog.");
        if (family == "pocket_tts") sk_tts_set_preset(m, "alba");
        if (sk_tts_synth(m, "The quick brown fox jumps over the lazy dog.", "en", 1.0f, ignore_audio, nullptr) != SK_OK)
            std::fprintf(stderr, "tts synth: %s\n", sk_last_error());
        sk_tts_unload(m);
    } else if (stage == "asr") {
        sk_asr_model *m = nullptr;
        if (sk_asr_load(gguf.c_str(), dev, &m) != SK_OK) { std::fprintf(stderr, "asr load: %s\n", sk_last_error()); return 0; }
        std::vector<float> audio(16000 * 3);
        for (size_t i = 0; i < audio.size(); ++i) audio[i] = 0.1f * std::sin(2 * 3.14159f * 440 * i / 16000.f);
        sk_asr_run(m, audio.data(), audio.size(), "en", ignore_text, nullptr);
        sk_asr_unload(m);
    } else {
        sk_translate_options to{0, flash_attn};
        sk_translate *m = nullptr;
        if (sk_translate_load(gguf.c_str(), dev, &to, &m) != SK_OK) { std::fprintf(stderr, "translate load: %s\n", sk_last_error()); return 0; }
        sk_gen_options gen{16, nullptr};
        sk_translate_complete(m, "Translate to French: Hello, world.", &gen, ignore_text, nullptr);
        sk_translate_unload(m);
    }
    const int count = sk_record_node_count();
    /* The exit code is the regeneration procedure's only automated signal, so a file that did
     * not reach the disk has to read as a failure — not as `count` nodes recorded. */
    if (sk_record_end_to_file(out_path.c_str(), stage.c_str(), family.c_str(),
                              std::filesystem::path(gguf).filename().string().c_str(),
                              dtype_ptrs.data(), (int32_t)dtype_ptrs.size()) != SK_OK) {
        std::fprintf(stderr, "record_family: %s\n", sk_last_error());
        return 0;
    }
    return count;
}
