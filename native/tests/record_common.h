/* One family's forward passes with the recorder armed: an asr or translate run, or the tts synths
 * a user can reach (synth_reachable_paths). Requires: sk_record_register_device() called BEFORE
 * sk_init, sk_init done, `devs`/`n` from sk_devices(). Writes the .ops file. */
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <iterator>
#include <set>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "sk_ops.h"          // sk_ops_device_word (sk_ops_format.cpp is compiled into every includer)
#include "gguf.h"
#include "ggml.h"
#include "model_path.h"      // find_gguf: a test model directory's main GGUF
#include "model_tensors.h"   // the names and matrix dtypes of the model path's GGUFs

static const char *const RUNG_OPS[] = {"MUL_MAT", "MUL_MAT_ID", "GET_ROWS"};

static bool ignore_text(const char *, void *) { return true; }
static bool ignore_audio(const float *, size_t, int32_t, int32_t, void *) { return true; }
struct Clip { std::vector<float> pcm; int32_t rate = 0; };
static bool grab_audio(const float *pcm, size_t n, int32_t rate, int32_t, void *user) {
    auto *c = static_cast<Clip *>(user); c->pcm.insert(c->pcm.end(), pcm, pcm + n); c->rate = rate; return true;
}

/* F2: the device a TTS recording must be taken on — the first non-CPU device when the build has
 * one. audio.cpp branches its graph construction on host-vs-device (uses_host_graph_plan /
 * is_host_backend: f16 conv kernels and bf16→f16 casts on host, f32 on a device), so a
 * CPU-recorded tts file describes a graph no GPU is ever asked and must never be shipped. */
static const sk_device *tts_record_device(const sk_device *devs, int n) {
    for (int i = 0; i < n; ++i) if (devs[i].kind != SK_DEVICE_CPU && std::strcmp(devs[i].name, "SKREC0") != 0) return &devs[i];
    return nullptr;
}
/* The `# recorded-on` word: the library's own spelling (sk_ops.h), which sk_device_supports_ops
 * maps a device with, so a recording and the query name a device the same way. */
static const char *device_kind_name(const sk_device *d) {
    return sk_ops_device_word(d ? d->kind : SK_DEVICE_CPU);
}

/* The one sentence every recording speaks, and the transcript of the reference clip. */
static const char *const kSentence = "The quick brown fox jumps over the lazy dog.";

/* A real speech clip for the families that clone: supertonic preset M1, made BEFORE recording
 * starts so its nodes never leak into the other family's file. Synthesised on the same device
 * the family will be recorded on. */
static Clip reference_clip(const sk_device *cpu, const std::string &supertonic_dir) {
    Clip c;
    sk_tts_options o{"supertonic", nullptr};
    sk_tts *m = nullptr;
    if (sk_tts_load(supertonic_dir.c_str(), cpu, &o, &m) != SK_OK) return c;
    sk_tts_set_preset(m, "M1");
    sk_tts_synth(m, kSentence, "en", 1.0f, grab_audio, &c);
    sk_tts_unload(m);
    return c;
}

/* The families a user can run only with a reference clip: the sidecar's VOICE_REQUIRED_FAMILIES
 * (sidecar/sokuji_sidecar/catalog.py), plus each family whose every card sets
 * voice_required=True (breeze_tts, whose one card is clone mode only; ruling 2026-10-08,
 * op-coverage precision). sidecar/tests/test_catalog.py computes that union from the catalog and
 * holds this list to it. */
static const char *const kVoiceRequiredFamilies[] = {
    "breeze_tts", "chatterbox", "confucius4_tts", "cosyvoice3", "echo_tts", "fireredtts3",
    "glm_tts", "index_tts2", "miotts", "omnivoice", "qwen3_tts",
};

/* The synths a user of `family` can reach, run on one loaded handle inside one recording window,
 * so the file is the union of their graphs (owner's ruling 2026-10-07, op-coverage precision):
 *   - a voice-required family: the clip synth;
 *   - a family that clones without needing a clip: the bare synth, then the clip synth;
 *   - a family that does not clone: the bare synth.
 * Whether it clones is sk_tts_capabilities'. The clip synth carries the clip's transcript. false,
 * with a stderr line, when a synth, the voice or the preset is refused, or the clip is missing
 * where the family clones. */
static bool synth_reachable_paths(sk_tts *m, const std::string &family, const Clip &ref) {
    sk_tts_caps caps{};
    if (sk_tts_capabilities(m, &caps) != SK_OK) { std::fprintf(stderr, "tts caps: %s\n", sk_last_error()); return false; }
    const bool required = std::any_of(std::begin(kVoiceRequiredFamilies), std::end(kVoiceRequiredFamilies),
                                      [&](const char *f) { return family == f; });
    if (required && !caps.clones) { std::fprintf(stderr, "record_family: %s is voice-required but does not clone\n", family.c_str()); return false; }
    // An empty clip would quietly turn a clone path into a no-voice run: index_tts2 accepts a
    // missing voice, so it would record a graph with none of the clone-path nodes and the diff
    // against the shipped recording would read as an engine regression. Fail the recording.
    if (caps.clones && ref.pcm.empty()) { std::fprintf(stderr, "record_family: reference clip failed for %s\n", family.c_str()); return false; }
    auto synth = [&](const char *path) {
        if (sk_tts_synth(m, kSentence, "en", 1.0f, ignore_audio, nullptr) == SK_OK) return true;
        std::fprintf(stderr, "tts %s synth: %s\n", path, sk_last_error());
        return false;
    };
    if (!required) {
        // The voice a user who picks none speaks with, where the sidecar sets one at load: the
        // first preset of a family in tts_backend._DEFAULT_PRESET_FAMILIES.
        const char *preset = family == "pocket_tts" ? "alba" : nullptr;
        if (preset && sk_tts_set_preset(m, preset) != SK_OK) { std::fprintf(stderr, "tts preset: %s\n", sk_last_error()); return false; }
        if (!synth("bare")) return false;
    }
    if (!caps.clones) return true;
    if (sk_tts_set_voice(m, ref.pcm.data(), ref.pcm.size(), ref.rate, kSentence) != SK_OK) { std::fprintf(stderr, "tts voice: %s\n", sk_last_error()); return false; }
    return synth("clip");
}

/* Returns the node count written (0 = nothing recorded — treat as a failure). */
static int record_family(const std::string &stage, const std::string &family, const std::string &model,
                         const sk_device *dev, const std::string &out_path, int32_t flash_attn,
                         const std::string &supertonic_dir) {
    // The main GGUF: the file the recording's `# source:` names and the path a tts family is
    // loaded from below. The weight names and `# dtypes-in-file:` come from every GGUF the model
    // path stands for, the main one and any companion staged beside it (model_tensors.h), and for
    // a tts family any companion it loads from a sibling folder (recording_tensors, miotts's
    // codec): the union of their matrix-tensor dtypes is the set WEIGHT expands over, and
    // sk_record_end_to_file refuses a recording whose WEIGHT dtype is outside it (owner's ruling
    // 2026-10-06, op-coverage precision).
    const std::string gguf = find_gguf(model);
    if (gguf.empty()) { std::fprintf(stderr, "record_family: no .gguf in %s\n", model.c_str()); return 0; }
    std::vector<std::string> names, dtypes_v; std::set<std::string> dtypes;
    if (!recording_tensors(stage, family, model, names, dtypes)) return 0;
    dtypes_v.assign(dtypes.begin(), dtypes.end());
    std::vector<const char *> name_ptrs; for (auto &s : names) name_ptrs.push_back(s.c_str());
    std::vector<const char *> dtype_ptrs; for (auto &s : dtypes_v) dtype_ptrs.push_back(s.c_str());

    // Whether a tts family clones is known only once it is loaded, inside the window, and the
    // clip has to exist before the window opens: every tts family gets one, and only the
    // families that clone use it.
    const Clip ref = stage == "tts" ? reference_clip(dev, supertonic_dir) : Clip{};

    sk_record_begin(name_ptrs.data(), (int32_t)name_ptrs.size(), RUNG_OPS, 3);
    if (stage == "tts") {
        sk_tts_options o{family.c_str(), family == "pocket_tts" ? "english" : nullptr};
        sk_tts *m = nullptr;
        // The main GGUF file, as the sidecar hands it over in production: a directory that stages
        // companions beside it is ambiguous to audio.cpp's own resolver.
        if (sk_tts_load(gguf.c_str(), dev, &o, &m) != SK_OK) { std::fprintf(stderr, "tts load: %s\n", sk_last_error()); return 0; }
        const bool ok = synth_reachable_paths(m, family, ref);
        sk_tts_unload(m);
        if (!ok) return 0;
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
                              device_kind_name(dev),
                              dtype_ptrs.data(), (int32_t)dtype_ptrs.size()) != SK_OK) {
        std::fprintf(stderr, "record_family: %s\n", sk_last_error());
        return 0;
    }
    return count;
}
