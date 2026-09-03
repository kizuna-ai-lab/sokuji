#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include "engine/framework/core/backend.h"
#include "engine/framework/runtime/registry.h"
#include "engine/framework/runtime/model.h"
#include "engine/framework/runtime/session.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <system_error>
#include <vector>

namespace rt = engine::runtime;
namespace core = engine::core;

struct sk_tts {
    std::unique_ptr<rt::ILoadedVoiceModel>       model;
    std::unique_ptr<rt::IVoiceTaskSession>       session;
    rt::IOfflineVoiceTaskSession   *offline   = nullptr;   // both point into *session; never owned here
    rt::IStreamingVoiceTaskSession *streaming = nullptr;
    std::mutex mutex;

    std::string family;
    bool    streaming_family    = false;
    bool    clones               = false;
    bool    transcript_required  = false;
    bool    sample_decode        = false;
    int32_t default_rate         = 0;
    std::vector<std::string> preset_names;   // cached at load; see report §3

    // Voice state applied to every subsequent sk_tts_synth call (contract: "stored on the
    // handle and applied to every subsequent synth"). Setting one clears the other.
    bool          has_clone = false;
    rt::AudioBuffer clone_audio;
    std::string   clone_ref_text;
    bool          has_preset = false;
    std::string   preset_name;
};

namespace {

struct FamilyInfo {
    const char *name;
    bool        streaming;
    bool        clones;
    bool        transcript_required;
    int32_t     default_rate;
    bool        sample_decode;
};

// Baked-in per report §3/§4: streaming = omnivoice+supertonic only (report §2); clones =
// every family except supertonic ("does not use external speaker references", report §3);
// transcript_required = omnivoice AND qwen3_tts (ruling R15(s4)): omnivoice's
// reference_text is mandatory whenever a ref clip is given (report §3); qwen3_tts's ICL
// clone mode separately requires ref_text one level deeper, inside synth() itself, even
// though this flag used to say otherwise (live-verified, task-7-report.md §3: "Qwen3
// voice clone ICL mode requires reference text"). Flipping it here makes
// sk_tts_set_voice's OWN validation below catch the missing transcript up front, and
// flows caps -> wire -> renderer transcript gating automatically. default_rate per
// report §4 (always re-read the actual result rate too — these families are
// config-driven and could differ from a future checkpoint).
//
// sample_decode (Ruling R23, jiangzhuo 2026-09-01, .superpowers/moss-eoc-verdict.md):
// moss_tts_nano ONLY. That investigation measured, on audio.cpp's own fork ggml with
// SVE excluded (so the matmul is provably correct on both sides), that greedy/argmax
// decoding of moss_tts_nano's end-of-content decision reaches audio.cpp's 300-frame /
// 24.000s max_new_frames cap (measured directly once, E1; corroborated by the
// pre-existing parity baseline's own greedy-decode runaway, not a fresh 3x repeat) for
// a plain sentence ("The quick brown fox jumps over the lazy dog."), producing a
// truncated transcript ("The quick."/"They quick.") — while audio.cpp's own DOCUMENTED
// DEFAULT (do_sample=true) reached the model's real end-of-content token 3/3 (E2a/b/c)
// in 2.6-3.7s with the full sentence transcribed correctly.
// The runaway lives in local_frame_decoder.cpp's argmax-vs-sample choice between the
// "continue" and "stop" logits, not in anything native/src/sk_tts.cpp or the ggml swap
// introduced. MOSS is staying in the recommended roster (controller ruling, same date),
// so it must not run away in production: sample instead of argmax for this family only.
// Seed stays fixed at "0" regardless (see build_request) — sampling here means "not
// argmax", not "not reproducible": a fixed seed still makes a given build's RNG stream,
// and therefore its output, deterministic run to run.
//
// The four families below joined in the 2026-09-03 batch. Their flags come from
// audio.cpp v0.7.1's own sources, not from the upstream model cards:
//   voxcpm1     src/community_models/voxcpm1/session.cpp  offline+streaming; speaker
//               reference optional (continuation-mode cloning, transcript optional via
//               the reference_text request option); 16 kHz.
//   voxcpm2     src/models/voxcpm2/{loader,session}.cpp   offline+streaming; speaker
//               reference optional; 48 kHz.
//   irodori_tts src/models/irodori_tts/session.cpp        offline only; speaker
//               reference optional (no_ref defaults to true, so a bare synth works);
//               48 kHz; Japanese only.
//   index_tts2  src/models/index_tts2/request.cpp         offline only; speaker
//               reference MANDATORY ("IndexTTS2 request requires --voice-ref or
//               voice.speaker.audio"); 22.05 kHz. transcript_required stays false:
//               the reference clip needs no transcript, only the clip itself. Making
//               the missing clip a clean caller error is the sidecar's job
//               (tts_backend._VOICE_REQUIRED_FAMILIES) — this ABI has no
//               "clone is mandatory" capability bit to carry it.
constexpr FamilyInfo kFamilies[] = {
    {"moss_tts_nano", false, true,  false, 48000, true},
    {"qwen3_tts",      false, true,  true,  24000, false},
    {"omnivoice",      true,  true,  true,  24000, false},
    {"pocket_tts",     false, true,  false, 24000, false},
    {"supertonic",     true,  false, false, 44100, false},
    {"voxcpm1",        true,  true,  false, 16000, false},
    {"voxcpm2",        true,  true,  false, 48000, false},
    {"irodori_tts",    false, true,  false, 48000, false},
    {"index_tts2",     false, true,  false, 22050, false},
};

const FamilyInfo *find_family(const char *name) {
    for (const auto &f : kFamilies)
        if (std::strcmp(f.name, name) == 0) return &f;
    return nullptr;
}

// audio.cpp has no status codes (report §5): every failure is a std::exception whose message
// is the only signal. Classify by substring — "does not exist" is our own path-resolution
// failure (package.cpp), "unknown ... session option" / "unsupported speaker" / "reference_text"
// are the families' own request-validation throws, both caller errors; everything else (model
// parse failures, backend/compute errors) is SK_ERR_BACKEND.
sk_status fail(const char *fn, const std::string &what) {
    sk::set_error(std::string(fn) + ": audiocpp: " + what);
    if (what.find("does not exist") != std::string::npos) return SK_ERR_NOT_FOUND;
    const bool caller_error =
        (what.find("unknown") != std::string::npos && what.find("session option") != std::string::npos) ||
        what.find("unsupported speaker") != std::string::npos ||
        what.find("reference_text") != std::string::npos ||
        what.find("model directory contains") != std::string::npos;
    return caller_error ? SK_ERR_INVALID_ARGUMENT : SK_ERR_BACKEND;
}

core::BackendType backend_type_for_kind(int32_t kind) {
    switch (kind) {
        case SK_DEVICE_CPU:    return core::BackendType::Cpu;
        case SK_DEVICE_VULKAN: return core::BackendType::Vulkan;
        case SK_DEVICE_METAL:  return core::BackendType::Metal;
        default:               return core::BackendType::BestAvailable;
    }
}

// engine::core::BackendConfig.device is relative to the OWNING ggml backend registry (e.g. the
// n-th Vulkan device), not sk_device.index, which is a flat index across every device sk_init
// enumerated (engine/framework/core/backend.cpp: find_device_by_backend_type). Recompute it
// here. Unused for BackendType::Cpu — init_backend's Cpu case never reads config.device.
int backend_relative_index(ggml_backend_dev_t dev) {
    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
    if (!reg) return 0;
    for (size_t i = 0; i < ggml_backend_reg_dev_count(reg); ++i)
        if (ggml_backend_reg_dev_get(reg, i) == dev) return static_cast<int>(i);
    return 0;
}

// Builds the per-call TaskRequest: text, whichever voice state (if any) is stored on the
// handle, speed (supertonic only, Ruling R6(s4)), and the deterministic-synthesis options
// that always apply (Ruling R7(s4)). Caller holds t->mutex.
rt::TaskRequest build_request(const sk_tts *t, const char *text, const char *language, float speed) {
    rt::TaskRequest req;
    // Ruling R14(s4): qwen3_tts resolves `language` against a per-checkpoint
    // codec_language_id table keyed by FULL LANGUAGE NAMES baked into the GGUF's own
    // metadata (qwen3_tts/talker.cpp), not ISO codes -- an ISO code like "en" throws
    // "Qwen3 talker unsupported language: en" (live-verified, task-7-report.md §3).
    // "auto" is the talker's own sentinel that skips that lookup entirely via a
    // "nothink" codec prefix. The production caller always passes an ISO code
    // (LocalNativeClient.ts -> tts_engine.set_language -> tts_backend.synth), so map
    // ANY incoming language to "auto" here for this family rather than pass it
    // through -- proven correct output on a real checkpoint by the T7/fix-round
    // loopbacks. Refine to a full-name mapping later only if per-language quality
    // demands it.
    const char *resolved_language = (t->family == "qwen3_tts") ? "auto" : language;
    req.text_input = rt::Transcript{text ? text : "", resolved_language ? resolved_language : ""};

    // Two of the 2026-09-03 families read the language from the REQUEST OPTIONS instead of
    // text_input.language, which they never look at (grep for "language" under
    // src/models/<family>). Without this block they would silently ignore the caller.
    // voxcpm1/voxcpm2 are the opposite case: neither reads a language anywhere (both
    // loaders advertise `languages = {"Auto"}`), so their text_input.language above is a
    // harmless no-op and nothing extra is set here.
    if (t->family == "irodori_tts") {
        // Japanese only: irodori's generation_options_from_request throws
        // "Irodori-TTS language must be ja" for any other value. Set explicitly rather than
        // relying on the default so a future change that forwards the caller's code here
        // fails loudly instead of mislabelling the text.
        req.options["language"] = "ja";
    } else if (t->family == "index_tts2" && language && *language) {
        // ISO code (lowercased) or "auto". Left unset, the 2.5 tokenizer guesses
        // "zh when the text contains Han characters, else en" (tokenizer_text.cpp,
        // encode_for_inference_v2_5) — which mislabels every Japanese utterance as zh.
        std::string lang(language);
        std::transform(lang.begin(), lang.end(), lang.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        req.options["language"] = lang;
    }

    if (t->has_clone) {
        rt::VoiceReference ref;
        ref.audio = t->clone_audio;
        rt::VoiceCondition voice;
        voice.speaker = std::move(ref);
        req.voice = std::move(voice);
        if (!t->clone_ref_text.empty()) req.options["reference_text"] = t->clone_ref_text;
    } else if (t->has_preset) {
        rt::VoiceReference ref;
        ref.cached_voice_id = t->preset_name;
        rt::VoiceCondition voice;
        voice.speaker = std::move(ref);
        req.voice = std::move(voice);
    }

    if (t->family == "supertonic" && speed != 1.0f) {
        req.options["speaking_rate"] = std::to_string(speed);
    }

    // VoxCPM2's streaming path hard-rejects its own struct default:
    // "VoxCPM2 streaming generation requires retry_badcase=false"
    // (voxcpm2/generator.cpp). A bad-case retry regenerates from scratch and discards what
    // was already emitted, which is impossible once chunks have gone out to the caller, so
    // the generator refuses rather than silently dropping the retry. voxcpm1 relaxes the
    // same default by itself for streaming sessions; voxcpm2 does not, so say it here.
    if (t->family == "voxcpm2") {
        req.options["retry_badcase"] = "false";
    }

    // Ruling R7(s4): deterministic synthesis by default — product behavior AND the parity
    // harness's precondition (Task 3 compares this binding's output against the official
    // CLI) — EXCEPT moss_tts_nano (Ruling R23, .superpowers/moss-eoc-verdict.md): greedy
    // decode never reaches this checkpoint's own end-of-content token for ordinary input
    // (measured: 300-frame/24.000s cap, once, E1; corroborated by the pre-existing parity
    // baseline), while sampling does (measured: real EOC, 2.6-3.7s, 3/3, E2a/b/c, full
    // correct transcript). Seed stays "0" for every family either way — t->sample_decode
    // only picks argmax vs. sample for the two-logit stop decision, it does not
    // reintroduce nondeterminism.
    //
    // irodori_tts is the one family here that VALIDATES its request options against its
    // model spec (runtime::validate_spec_backed_request_options, session.cpp) and throws
    // "unknown Irodori-TTS request option: <key>" for anything the spec does not declare.
    // model_specs/irodori_tts.json declares `seed` but not `do_sample`, so the sampling
    // knob is omitted there; irodori is greedy-free anyway (rectified-flow sampling with a
    // seed), and the seed below is what makes it reproducible.
    if (t->family != "irodori_tts") {
        req.options["do_sample"] = t->sample_decode ? "true" : "false";
    }
    req.options["seed"] = "0";
    return req;
}

sk_status synth_offline(sk_tts *t, const rt::TaskRequest &request, sk_audio_cb cb, void *user) {
    sk_status rc = SK_OK;
    try {
        t->session->prepare(rt::build_preparation_request(request));
        rt::TaskResult result = t->offline->run(request);
        if (!result.audio_output.has_value()) {
            sk::set_error("sk_tts_synth: no audio produced");
            rc = SK_ERR_BACKEND;
        } else {
            const auto &audio = *result.audio_output;
            const float *data = audio.samples.empty() ? nullptr : audio.samples.data();
            if (cb && !cb(data, audio.samples.size(), audio.sample_rate, audio.channels, user)) {
                // Ruling R8(s4): offline synth cannot be interrupted mid-run — the callback
                // returning false here discards an already-complete result, it does not abort
                // compute in progress.
                sk::set_error("sk_tts_synth: cancelled");
                rc = SK_ERR_CANCELLED;
            }
        }
    } catch (const std::exception &ex) {
        rc = fail("sk_tts_synth", ex.what());
    }
    return rc;
}

sk_status synth_streaming(sk_tts *t, const rt::TaskRequest &request, sk_audio_cb cb, void *user) {
    sk_status rc = SK_OK;
    try {
        t->session->prepare(rt::build_preparation_request(request));
        t->streaming->start_stream(request);
        int  chunks    = 0;
        bool cancelled = false;
        while (!cancelled) {
            auto event = t->streaming->next_stream_event();
            if (!event.has_value()) break;
            for (const auto &named : event->named_audio_outputs) {
                ++chunks;
                const auto &audio = named.audio;
                const float *data = audio.samples.empty() ? nullptr : audio.samples.data();
                const bool keep_going = !cb || cb(data, audio.samples.size(), audio.sample_rate, audio.channels, user);
                if (!keep_going) { cancelled = true; break; }
            }
        }
        if (cancelled) {
            sk::set_error("sk_tts_synth: cancelled");
            rc = SK_ERR_CANCELLED;
        } else {
            rt::TaskResult final_result = t->streaming->finish_stream();
            // Defensive fallback (report §2): a family that emits only the final result and no
            // chunk events would otherwise deliver nothing at all.
            if (chunks == 0 && final_result.audio_output.has_value()) {
                const auto &audio = *final_result.audio_output;
                const float *data = audio.samples.empty() ? nullptr : audio.samples.data();
                if (cb && !cb(data, audio.samples.size(), audio.sample_rate, audio.channels, user)) {
                    sk::set_error("sk_tts_synth: cancelled");
                    rc = SK_ERR_CANCELLED;
                }
            }
            // chunks > 0: every chunk already went to cb; do not re-deliver the merged buffer.
        }
    } catch (const std::exception &ex) {
        rc = fail("sk_tts_synth", ex.what());
    }
    // Every request (success/cancel/failure) leaves the stream reset so the next request on
    // this handle starts clean (report §2's reset() contract). reset() is a plain
    // IStreamingVoiceTaskSession method, not exempt from the "audio.cpp throws
    // std::exception" rule — letting it escape this extern "C" boundary would std::terminate
    // the whole process from inside ctypes, so it gets its own try/catch. A prior failure
    // takes priority in the returned status; a reset() failure only surfaces when the request
    // itself had otherwise succeeded.
    try {
        t->streaming->reset();
    } catch (const std::exception &ex) {
        if (rc == SK_OK) rc = fail("sk_tts_synth: reset", ex.what());
    }
    return rc;
}

}  // namespace

extern "C" {

SK_API sk_status sk_tts_load(const char *model_path, const sk_device *device,
                              const sk_tts_options *opts, sk_tts **out) {
    if (out) *out = nullptr;
    if (!model_path || !*model_path || !opts || !opts->family || !*opts->family || !out) {
        sk::set_error("sk_tts_load: model_path, opts->family and out-pointer are required");
        return SK_ERR_INVALID_ARGUMENT;
    }

    const FamilyInfo *info = find_family(opts->family);
    if (!info) {
        std::string valid;
        for (const auto &f : kFamilies) {
            if (!valid.empty()) valid += " | ";
            valid += f.name;
        }
        sk::set_error(std::string("sk_tts_load: unknown family '") + opts->family +
                      "'; valid families: " + valid);
        return SK_ERR_INVALID_ARGUMENT;
    }

    core::BackendConfig backend{};
    {
        std::lock_guard<std::mutex> lock(sk::mutex());
        if (!sk::require_init("sk_tts_load")) return SK_ERR_NOT_INITIALISED;
        backend.threads = sk::threads();
        if (device) {
            const auto &devs = sk::devices();
            if (device->index < 0 || static_cast<size_t>(device->index) >= devs.size()) {
                sk::set_error("sk_tts_load: unknown device index " + std::to_string(device->index));
                return SK_ERR_INVALID_ARGUMENT;
            }
            ggml_backend_dev_t dev = devs[static_cast<size_t>(device->index)];
            backend.type = backend_type_for_kind(sk::kind_of(dev));
            backend.device = (backend.type == core::BackendType::Cpu) ? 0 : backend_relative_index(dev);
        } else {
            backend.type = core::BackendType::BestAvailable;   // device == NULL: audio.cpp's own default
        }
    }   // registry/model construction can take seconds; never hold the library lock for it

    auto *h = new sk_tts();
    try {
        // No other thread can reach h yet (it isn't published to *out until the very end), so
        // this lock is uncontended — held anyway so "all access is serialised per handle"
        // (header contract) covers load-time session construction too, not just post-load
        // calls.
        std::lock_guard<std::mutex> lock(h->mutex);
        rt::ModelRegistry registry = rt::make_default_registry();   // cheap; not retained (report §1)

        rt::ModelLoadRequest load_request;
        load_request.model_path = std::filesystem::path(model_path);
        load_request.family_hint = info->name;
        if (std::strcmp(info->name, "pocket_tts") == 0) {
            load_request.options["language"] = (opts->language && *opts->language) ? opts->language : "english";
        }

        rt::ModelInspection inspection = registry.inspect(load_request);
        h->model = registry.load(load_request);

        rt::TaskSpec task_spec;
        task_spec.task = rt::VoiceTaskKind::Tts;
        task_spec.mode = info->streaming ? rt::RunMode::Streaming : rt::RunMode::Offline;

        rt::SessionOptions session_options;
        session_options.backend = backend;

        // Session created AT LOAD (report §9's Xcode precedent): one long-lived session per
        // handle, reused across every sk_tts_synth call.
        h->session   = h->model->create_task_session(task_spec, session_options);
        h->offline   = dynamic_cast<rt::IOfflineVoiceTaskSession *>(h->session.get());
        h->streaming = dynamic_cast<rt::IStreamingVoiceTaskSession *>(h->session.get());
        if (info->streaming) {
            if (!h->streaming) throw std::runtime_error(std::string(info->name) + " session does not support streaming");
        } else {
            if (!h->offline) throw std::runtime_error(std::string(info->name) + " session does not support offline execution");
        }

        // Presets: only supertonic and pocket_tts expose them programmatically (report §3);
        // cached now so sk_tts_presets never needs to inspect() again.
        if (std::strcmp(info->name, "supertonic") == 0) {
            static const std::string kPrefix = "voice_style_";
            for (const auto &asset : inspection.discovered_configs) {
                if (asset.id.compare(0, kPrefix.size(), kPrefix) == 0)
                    h->preset_names.push_back(asset.id.substr(kPrefix.size()));
            }
            std::sort(h->preset_names.begin(), h->preset_names.end());
        } else if (std::strcmp(info->name, "pocket_tts") == 0) {
            // Presets live in embeddings/*.safetensors next to the GGUF FILE ON DISK, not
            // under inspection.model_root: for a GGUF with embedded sidecars, model_root is
            // the materialized $TMPDIR snapshot (config/tokenizer only — see the README's
            // model-directory note), which never contains embeddings/. audio.cpp itself
            // resolves voice presets against tensor_source->source_path().parent_path()
            // (voice_asset_root, pocket_tts/assets.cpp:153, consumed at session.cpp:347) —
            // mirror that here instead of the materialized root.
            std::error_code ec;
            const bool model_is_file = std::filesystem::is_regular_file(load_request.model_path, ec);
            const std::filesystem::path gguf_parent_dir =
                model_is_file ? load_request.model_path.parent_path() : load_request.model_path;
            const std::filesystem::path emb_dir = gguf_parent_dir / "embeddings";
            if (std::filesystem::is_directory(emb_dir, ec)) {
                for (const auto &entry : std::filesystem::directory_iterator(emb_dir, ec)) {
                    if (entry.path().extension() == ".safetensors")
                        h->preset_names.push_back(entry.path().stem().string());
                }
            }
            std::sort(h->preset_names.begin(), h->preset_names.end());
        }

        h->family              = info->name;
        h->streaming_family    = info->streaming;
        h->clones              = info->clones;
        h->transcript_required = info->transcript_required;
        h->default_rate        = info->default_rate;
        h->sample_decode       = info->sample_decode;
    } catch (const std::exception &ex) {
        const sk_status rc = fail("sk_tts_load", ex.what());
        delete h;
        return rc;
    }

    *out = h;
    return SK_OK;
}

SK_API sk_status sk_tts_capabilities(sk_tts *t, sk_tts_caps *out) {
    if (!t || !out) { sk::set_error("sk_tts_capabilities: handle and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(t->mutex);
    out->streaming           = t->streaming_family;
    out->clones              = t->clones;
    out->transcript_required = t->transcript_required;
    out->sample_rate         = t->default_rate;
    return SK_OK;
}

SK_API sk_status sk_tts_presets(sk_tts *t, sk_text_cb on_name, void *user) {
    if (!t) { sk::set_error("sk_tts_presets: handle is required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(t->mutex);
    for (const auto &name : t->preset_names) {
        if (on_name && !on_name(name.c_str(), user)) {
            sk::set_error("sk_tts_presets: cancelled");
            return SK_ERR_CANCELLED;
        }
    }
    return SK_OK;
}

SK_API sk_status sk_tts_set_voice(sk_tts *t, const float *ref_pcm, size_t n, int32_t sample_rate,
                                   const char *ref_text) {
    if (!t || !ref_pcm || n == 0 || sample_rate <= 0) {
        sk::set_error("sk_tts_set_voice: handle, ref_pcm (n > 0) and a positive sample_rate are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(t->mutex);
    if (!t->clones) {
        sk::set_error(std::string("sk_tts_set_voice: family '") + t->family + "' does not support voice cloning");
        return SK_ERR_INVALID_ARGUMENT;
    }
    if (t->transcript_required && (!ref_text || !*ref_text)) {
        sk::set_error(std::string("sk_tts_set_voice: family '") + t->family + "' requires ref_text with a reference clip");
        return SK_ERR_INVALID_ARGUMENT;
    }

    t->clone_audio.sample_rate = sample_rate;
    t->clone_audio.channels    = 1;
    t->clone_audio.samples.assign(ref_pcm, ref_pcm + n);
    t->clone_ref_text = ref_text ? ref_text : "";
    t->has_clone  = true;
    t->has_preset = false;
    t->preset_name.clear();
    return SK_OK;
}

SK_API sk_status sk_tts_set_preset(sk_tts *t, const char *name) {
    if (!t || !name || !*name) { sk::set_error("sk_tts_set_preset: handle and name are required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(t->mutex);
    // supertonic and pocket_tts advertise a COMPLETE, authoritative preset list (report §3:
    // supertonic's fixed style set via inspect(), pocket_tts's embeddings/ directory) —
    // validate against it so a typo fails immediately with a helpful message instead of
    // surfacing later as an opaque "unsupported speaker"-style exception at synth time.
    // qwen3_tts (CustomVoice speaker names are not enumerable through this API, report §3),
    // moss_tts_nano and omnivoice have no discoverable preset list at all, so stay permissive
    // there and let the engine's own request validation apply at synth.
    if (t->family == "supertonic" || t->family == "pocket_tts") {
        const bool known = std::find(t->preset_names.begin(), t->preset_names.end(), name) != t->preset_names.end();
        if (!known) {
            std::string available;
            for (const auto &n : t->preset_names) { if (!available.empty()) available += ", "; available += n; }
            sk::set_error(std::string("sk_tts_set_preset: unknown preset '") + name + "' for family '" + t->family +
                          "'; available: " + (available.empty() ? "(none)" : available));
            return SK_ERR_INVALID_ARGUMENT;
        }
    }
    t->preset_name = name;
    t->has_preset  = true;
    // "clears any clone state" (header contract).
    t->has_clone = false;
    t->clone_audio = rt::AudioBuffer{};
    t->clone_ref_text.clear();
    return SK_OK;
}

SK_API sk_status sk_tts_synth(sk_tts *t, const char *text, const char *language, float speed,
                               sk_audio_cb on_audio, void *user) {
    if (!t || !text) { sk::set_error("sk_tts_synth: handle and text are required"); return SK_ERR_INVALID_ARGUMENT; }
    if (!(speed > 0.0f)) {   // catches <= 0 and NaN (NaN > 0.0f is false); supertonic's own
                              // speaking_rate check throws for this, which would otherwise
                              // classify as SK_ERR_BACKEND rather than a caller error
        sk::set_error("sk_tts_synth: speed must be positive");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(t->mutex);
    const rt::TaskRequest request = build_request(t, text, language, speed);
    return t->streaming_family ? synth_streaming(t, request, on_audio, user)
                                : synth_offline(t, request, on_audio, user);
}

SK_API void sk_tts_unload(sk_tts *t) {
    if (!t) return;
    {
        std::lock_guard<std::mutex> lock(t->mutex);
        t->session.reset();
        t->model.reset();
        t->offline   = nullptr;
        t->streaming = nullptr;
    }
    delete t;
}

}  // extern "C"
