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
    bool    strict_options       = false;   // see FamilyInfo::strict_options
    bool    strict_sends_ref_text = false;  // see FamilyInfo::strict_sends_ref_text
    const char *preset_option    = nullptr; // see FamilyInfo::preset_option (a string literal of the row)
    // sk_tts_options.language at load, for every family but pocket_tts (adopt_family). When
    // set, build_request uses it in place of the language each sk_tts_synth passes.
    std::string forced_language;
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

enum class FamilyTask : unsigned char { Tts, VoiceCloning };

struct FamilyInfo {
    const char *name;
    bool        streaming;
    bool        clones;
    bool        transcript_required;
    int32_t     default_rate;
    bool        sample_decode;
    // The family runs runtime::validate_spec_backed_request_options() over the whole request
    // and throws "unknown <Family> request option: <key>" for any key its own
    // model_specs/<family>.json does not declare — so build_request must send a strict family
    // ONLY options its spec lists. Adding an unconditional option below is therefore a live
    // break for such a family, not a no-op it would ignore. irodori_tts, the first strict
    // family, declares neither "do_sample" nor "reference_text".
    bool        strict_options;
    // A strict family whose spec DOES declare "reference_text" (a clone that needs the clip's
    // transcript) sets this, and build_request sends it the transcript the way it sends one to
    // every non-strict family. It is still never sent "do_sample". Ignored when strict_options
    // is false.
    bool        strict_sends_ref_text;
    // The VoiceTaskKind the session is created with at load: Tts for every family that accepts
    // it, clone or not; VoiceCloning for a family whose session refuses Tts at
    // create_task_session.
    FamilyTask  task;
    // How a name given to sk_tts_set_preset reaches the engine. nullptr: as
    // voice.speaker.cached_voice_id. Otherwise the request option that carries it, for a family
    // that reads its preset only from that option and ignores cached_voice_id.
    const char *preset_option;
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
//
// strict_sends_ref_text, task and preset_option are false, Tts and nullptr for all nine rows
// above: irodori_tts, the one strict family among them, declares no reference_text; every one
// accepts a Tts session; and the three with presets (supertonic, pocket_tts, qwen3_tts
// CustomVoice) take them through cached_voice_id.
//
//   name              stream clones transcr rate   sample strict refText task             preset_option
constexpr FamilyInfo kFamilies[] = {
    {"moss_tts_nano", false, true,  false, 48000, true,  false, false, FamilyTask::Tts, nullptr},
    {"qwen3_tts",      false, true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
    {"omnivoice",      true,  true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
    {"pocket_tts",     false, true,  false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    {"supertonic",     true,  false, false, 44100, false, false, false, FamilyTask::Tts, nullptr},
    {"voxcpm1",        true,  true,  false, 16000, false, false, false, FamilyTask::Tts, nullptr},
    {"voxcpm2",        true,  true,  false, 48000, false, false, false, FamilyTask::Tts, nullptr},
    {"irodori_tts",    false, true,  false, 48000, false, true,  false, FamilyTask::Tts, nullptr},
    {"index_tts2",     false, true,  false, 22050, false, false, false, FamilyTask::Tts, nullptr},
    // cosyvoice3 (audio.cpp src/models/cosyvoice3/session.cpp): Tts and clone sessions,
    // offline only (:88-93); the reference clip is mandatory (:170-174); strict options,
    // declaring reference_text and template_name.
    {"cosyvoice3",     false, true,  false, 24000, false, true,  true,  FamilyTask::Tts, nullptr},
    // fireredtts3 (audio.cpp src/models/fireredtts3/session.cpp): the Base checkpoint takes only
    // a VoiceCloning session, offline (:225-237); the clip is mandatory and its continuation
    // prompt is built from reference_text (:73-89); strict options, declaring reference_text and
    // language.
    {"fireredtts3",    false, true,  true,  24000, false, true,  true,  FamilyTask::VoiceCloning, nullptr},
    // moss_tts_local (audio.cpp src/models/moss/moss_tts_local/): offline (loader.cpp:76-79);
    // the clip is optional and no transcript is read (session.cpp:300-311); 48 kHz stereo
    // (:33); do_sample defaults to true (generator.h:23-34) and greedy is moss_tts_nano's
    // runaway (R23), so it samples too.
    {"moss_tts_local", false, true,  false, 48000, true,  false, false, FamilyTask::Tts, nullptr},
    // vibevoice (audio.cpp src/models/vibevoice/): an offline Tts session only (loader.cpp:131);
    // a clip is optional (voice.speaker.audio; cached_voice_id throws, session.cpp:319-321);
    // do_sample defaults to false. Its text is a speaker script (build_request wraps it).
    {"vibevoice",      false, true,  false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // chatterbox (audio.cpp src/models/chatterbox/): a VoiceCloning session, offline
    // (session.cpp:371-377); prepare() refuses a request without a clip (:410-412); do_sample
    // defaults to true (include/engine/models/chatterbox/tts.h:19-32). The engine normalises
    // and checks the language code itself (text_tokenizer.cpp:399-416).
    {"chatterbox",     false, true,  false, 24000, true,  false, false, FamilyTask::VoiceCloning, nullptr},
    // chatterbox_turbo (audio.cpp src/community_models/chatterbox_turbo/session.cpp): an
    // offline Tts session with one built-in voice; prepare() refuses a clip (:76-84); 24 kHz
    // (:104); do_sample is not read.
    {"chatterbox_turbo", false, false, false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // confucius4_tts (audio.cpp src/models/confucius4_tts/): a VoiceCloning session only
    // (session.cpp:173-175); the clip is mandatory and no transcript option exists
    // (request.cpp:140-143); strict; 22.05 kHz (include/engine/models/confucius4_tts/types.h:39).
    // It takes the caller's bare language code from text_input and falls back to zh without one
    // (request.cpp:13-35, tokenizer_text.cpp:283-292). Segment streaming gains nothing on one
    // utterance, so offline.
    {"confucius4_tts", false, true,  false, 22050, false, true,  false, FamilyTask::VoiceCloning, nullptr},
    // magpie_tts (audio.cpp src/models/magpie_tts/): an offline Tts session (session.cpp:75-80);
    // five baked speakers and no cloning; the speaker is read only from the voice_id option, a
    // name or an index (request.cpp:30-52); strict; 22.05 kHz
    // (include/engine/models/magpie_tts/assets.h:62). The engine maps a bare language code
    // itself (tokenizer_text.cpp:1140-1165).
    {"magpie_tts",     false, false, false, 22050, false, true,  false, FamilyTask::Tts, "voice_id"},
    // neutts (audio.cpp src/models/neutts/): built-in speaker prompts read only from the voice_id
    // option, default emily (session.cpp:62-64; an unknown name throws, prompt.cpp:98-100); no
    // cloning in this port; strict; 24 kHz, its codec's output rate (session.cpp:281). Segment
    // streaming gains nothing on one utterance, so offline.
    {"neutts",         false, false, false, 24000, false, true,  false, FamilyTask::Tts, "voice_id"},
    // kugelaudio (audio.cpp src/models/kugelaudio/session.cpp): a Tts session that refuses voice
    // cloning (:24-26, a clip throws at :88-90); four preset voices through voice_id or
    // cached_voice_id (:86-97); strict; 24 kHz (:120). It streams only through a sink, so
    // offline.
    {"kugelaudio",     false, false, false, 24000, false, true,  false, FamilyTask::Tts, nullptr},
    // higgs_audio_tts (audio.cpp src/models/higgs_audio_tts/): an offline Tts session
    // (session.cpp:150-156); a clip is optional (generator.cpp:205-221), its transcript too
    // (session.cpp:253-256); 24 kHz (include/engine/models/higgs_audio_tts/codec.h:81); with a
    // seed its sampler is the host-side seeded one on every backend.
    {"higgs_audio_tts", false, true,  false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // fish_audio (audio.cpp src/models/fish_audio/session.cpp): an offline Tts session only
    // (:306-312); a clip is optional but needs its transcript (:252-259); 44.1 kHz
    // (include/engine/framework/codecs/fish_dac_codec_runtime.h:28); random seed unless sent.
    {"fish_audio",     false, true,  true,  44100, false, false, false, FamilyTask::Tts, nullptr},
    // breeze_tts (audio.cpp src/models/breeze_tts/): Tts, clone or design sessions, offline or
    // streaming (session.cpp:166-178); with a clip it clones and needs the clip's transcript
    // (generator.cpp:1062-1064), so a strict family that is sent reference_text; 24 kHz
    // (speech_decoder.cpp:48). Offline: one utterance gains little from its frame streaming.
    {"breeze_tts",     false, true,  true,  24000, false, true,  true,  FamilyTask::Tts, nullptr},
    // audio8_tts  community_models/audio8_tts/session.cpp: offline chosen of its offline and
    //             streaming sessions (387-391); clone optional, and a clip needs its exact
    //             transcript (268-272); 44.1 kHz codec (767); always samples, never reads
    //             do_sample; request options are not spec-validated.
    {"audio8_tts",     false, true,  true,  44100, false, false, false, FamilyTask::Tts, nullptr},
    // soprano_tts community_models/soprano_tts/session.cpp: offline chosen of offline and
    //             streaming (157, 217); no voice input at all; 32 kHz (vocoder.cpp:440);
    //             strict: prepare()/start_stream() validate every request option against the
    //             spec (150, 216), which declares seed but neither do_sample nor reference_text.
    {"soprano_tts",    false, false, false, 32000, false, true,  false, FamilyTask::Tts, nullptr},
    // glm_tts     community_models/glm_tts/session.cpp: offline only; a clip AND its transcript are
    //             both mandatory (430-441); 24 kHz HiFT (143); always samples, seed defaults to 0;
    //             only glm_tts.* session keys are validated (47-58), request options are not.
    {"glm_tts",        false, true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
};

const FamilyInfo *find_family(const char *name) {
    for (const auto &f : kFamilies)
        if (std::strcmp(f.name, name) == 0) return &f;
    return nullptr;
}

// The task kind and run mode sk_tts_load creates a family's session with.
rt::TaskSpec task_spec_for(const FamilyInfo &info) {
    rt::TaskSpec spec;
    spec.task = info.task == FamilyTask::VoiceCloning ? rt::VoiceTaskKind::VoiceCloning
                                                      : rt::VoiceTaskKind::Tts;
    spec.mode = info.streaming ? rt::RunMode::Streaming : rt::RunMode::Offline;
    return spec;
}

// Copies a family row, and the load options that outlive the load, onto a freshly loaded
// handle (sk_tts_load's last step), so no later call has to look either up again.
void adopt_family(sk_tts *h, const FamilyInfo &info, const sk_tts_options &opts) {
    h->family                = info.name;
    h->streaming_family      = info.streaming;
    h->clones                = info.clones;
    h->transcript_required   = info.transcript_required;
    h->default_rate          = info.default_rate;
    h->sample_decode         = info.sample_decode;
    h->strict_options        = info.strict_options;
    h->strict_sends_ref_text = info.strict_sends_ref_text;
    h->preset_option         = info.preset_option;
    // A card's load language (catalog load_language -> PlanConfig.tts_language ->
    // sk_tts_options.language) is the language every synth on this handle speaks, for a
    // checkpoint driven by a code the app's language picker does not offer. pocket_tts is the
    // exception: its load language names a package ("english", ...) and is consumed at load.
    h->forced_language.clear();
    if (std::strcmp(info.name, "pocket_tts") != 0 && opts.language && *opts.language)
        h->forced_language = opts.language;
}

// SK_TTS_REQUEST_ONLY: native/tests/test_tts_request.cpp compiles this file straight in and
// keeps only the family table and the request building. Everything that needs the audio.cpp
// runtime or sk_common.cpp's state sits inside these guards, so that test links no engine.
#ifndef SK_TTS_REQUEST_ONLY
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
#endif  // SK_TTS_REQUEST_ONLY

// The bare lower-case primary subtag of a language code: "pt-BR" -> "pt", "ZH_cn" -> "zh".
std::string base_language_code(const char *language) {
    std::string code(language ? language : "");
    const size_t cut = code.find_first_of("-_");
    if (cut != std::string::npos) code.resize(cut);
    std::transform(code.begin(), code.end(), code.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return code;
}

// English language names, for a family whose prompt is tagged with a name instead of a code.
struct LanguageName { const char *code; const char *name; };
// The union of FireRedTTS-3's 24 tags and MOSS-TTS-Local v1.5's 31 language names, which are its
// vendor card's table verbatim ("Persian (Farsi)" included), with Tagalog under the app's "fil"
// and the card's own "tl" kept beside it. A family that does not know a name it is handed
// refuses it by name, which is the loud failure wanted for a card that lists no such language.
// "Persian (Farsi)": the vendor README table is the only source; the training tag is unconfirmed.
constexpr LanguageName kLanguageNames[] = {
    {"ar", "Arabic"},     {"cs", "Czech"},      {"da", "Danish"},     {"de", "German"},
    {"el", "Greek"},      {"en", "English"},    {"es", "Spanish"},    {"fa", "Persian (Farsi)"},
    {"fi", "Finnish"},    {"fil", "Tagalog"},   {"fr", "French"},     {"he", "Hebrew"},
    {"hi", "Hindi"},      {"hu", "Hungarian"},  {"id", "Indonesian"}, {"it", "Italian"},
    {"ja", "Japanese"},   {"ko", "Korean"},     {"mk", "Macedonian"}, {"ms", "Malay"},
    {"nl", "Dutch"},      {"pl", "Polish"},     {"pt", "Portuguese"}, {"ro", "Romanian"},
    {"ru", "Russian"},    {"sv", "Swedish"},    {"sw", "Swahili"},    {"th", "Thai"},
    {"tl", "Tagalog"},    {"tr", "Turkish"},    {"uk", "Ukrainian"},  {"vi", "Vietnamese"},
    {"yue", "Cantonese"}, {"zh", "Chinese"},
};

// nullptr for a code with no entry.
const char *english_language_name(const std::string &code) {
    for (const auto &entry : kLanguageNames)
        if (code == entry.code) return entry.name;
    return nullptr;
}

// VibeVoice's speaker script for one plain utterance: every non-blank line, trimmed, becomes
// "Speaker 1: <line>"; blank lines are dropped. A line ends at an LF or a CR (a CRLF is a break
// and an empty piece, which is skipped): the engine's pattern refuses a CR inside a line
// (tokenizer_text.cpp:49-86), so a line left holding one would be dropped.
std::string vibevoice_script(const std::string &text) {
    std::string out;
    size_t start = 0;
    while (start <= text.size()) {
        const size_t end = text.find_first_of("\r\n", start);
        const std::string line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
        const size_t first = line.find_first_not_of(" \t");
        if (first != std::string::npos) {
            const size_t last = line.find_last_not_of(" \t");
            if (!out.empty()) out += '\n';
            out += "Speaker 1: ";
            out += line.substr(first, last - first + 1);
        }
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return out;
}

// Builds the per-call TaskRequest: text, whichever voice state (if any) is stored on the
// handle, speed (supertonic only, Ruling R6(s4)), and the deterministic-synthesis options
// that always apply (Ruling R7(s4)). Caller holds t->mutex.
rt::TaskRequest build_request(const sk_tts *t, const char *text, const char *language, float speed) {
    rt::TaskRequest req;
    // A load-time forced language wins over the caller's (adopt_family). The family rules
    // below (qwen3_tts's "auto", irodori_tts's "ja", index_tts2's option) apply to it as they
    // would to the caller's.
    if (!t->forced_language.empty()) language = t->forced_language.c_str();
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
    // audio8_tts reads the request language for one thing only: Traditional -> Simplified
    // conversion of the text and of the reference transcript, skipped for Cantonese alone
    // (community_models/audio8_tts/session.cpp:500-507; framework/text/chinese_variant.cpp:111-127).
    // Japanese kanji share code points with Traditional forms (東, 銀, 語), so a Japanese request
    // would be rewritten into Simplified glyphs; "yue" is the one value that leaves the text as
    // written, and nothing else in the family reads it.
    if (t->family == "audio8_tts" && base_language_code(req.text_input->language.c_str()) == "ja")
        req.text_input->language = "yue";

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
        // "reference_text" is an OPTION, so a strict family rejects it outright even when
        // the clip itself is perfectly acceptable to it: irodori_tts takes the speaker
        // reference through req.voice (session.cpp's make_request) but declares no
        // reference_text in its spec, and the renderer attaches a transcript to every clip
        // it has one for (LocalNativeClient's setReferenceVoice) out of a single shared clip
        // store — so a clip saved for OmniVoice and then used with Irodori would throw
        // "unknown Irodori-TTS request option: reference_text". The transcript is optional
        // for every family that is not transcript_required, so dropping it here costs a
        // strict family nothing it could have used. A strict family whose spec DOES declare
        // reference_text (FamilyInfo::strict_sends_ref_text) gets it like any other.
        if (!t->clone_ref_text.empty() && (!t->strict_options || t->strict_sends_ref_text))
            req.options["reference_text"] = t->clone_ref_text;
    } else if (t->has_preset) {
        if (t->preset_option) {
            // This family reads its preset from a request option and ignores
            // voice.speaker.cached_voice_id (FamilyInfo::preset_option).
            req.options[t->preset_option] = t->preset_name;
        } else {
            rt::VoiceReference ref;
            ref.cached_voice_id = t->preset_name;
            rt::VoiceCondition voice;
            voice.speaker = std::move(ref);
            req.voice = std::move(voice);
        }
    }

    if (t->family == "supertonic" && speed != 1.0f) {
        req.options["speaking_rate"] = std::to_string(speed);
    }

    // VoxCPM2's STREAMING path hard-rejects its own struct default:
    // "VoxCPM2 streaming generation requires retry_badcase=false"
    // (voxcpm2/generator.cpp). A bad-case retry regenerates from scratch and discards what
    // was already emitted, which is impossible once chunks have gone out to the caller, so
    // the generator refuses rather than silently dropping the retry. voxcpm1 relaxes the
    // same default by itself for streaming sessions; voxcpm2 does not, so say it here.
    // Scoped to the streaming session on purpose: the retry is a real quality feature on
    // the offline path, and hard-coding it off would silently give up bad-case recovery if
    // voxcpm2 is ever switched to Offline in kFamilies.
    if (t->family == "voxcpm2" && t->streaming_family) {
        req.options["retry_badcase"] = "false";
    }

    // CosyVoice3's default template, zero_shot, builds its text prompt from the clip's
    // transcript (audio.cpp src/models/cosyvoice3/session.cpp:180-189); cross_lingual clones
    // from the clip alone, so a clip without a transcript takes that one.
    if (t->family == "cosyvoice3" && t->has_clone)
        req.options["template_name"] = t->clone_ref_text.empty() ? "cross_lingual" : "zero_shot";

    // FireRedTTS-3 tags its prompt with the vendor's English language names and throws for
    // anything else (audio.cpp src/models/fireredtts3/tokenizer_text.cpp:20-45, :214-219); its
    // "language" option wins over text_input (session.cpp:47-55). A code with no name stays on
    // text_input alone, where the engine refuses it by name.
    if (t->family == "fireredtts3" && language && *language) {
        if (const char *name = english_language_name(base_language_code(language)))
            req.options["language"] = name;
    }

    // MOSS-TTS-Local v1.5 reads its prompt's language slot as a NAME, the way its vendor's
    // processor writes it ("English", "French"); audio.cpp copies text_input.language into that
    // slot verbatim (src/models/moss/moss_tts_local/tokenizer_text.cpp:38-45). A code with no
    // name leaves the slot empty, which the model treats as "detect it" (session.cpp:307-311).
    if (t->family == "moss_tts_local") {
        const char *name = (language && *language) ? english_language_name(base_language_code(language)) : nullptr;
        req.text_input->language = name ? name : "";
    }

    // VibeVoice reads its text as a speaker script and silently drops every line that is not
    // "Speaker N: ..." (audio.cpp src/models/vibevoice/tokenizer_text.cpp:49-75); ids are
    // re-based to 0 (:76-85), the speaker a clip conditions. Every non-blank line is one
    // speaker's.
    if (t->family == "vibevoice")
        req.text_input->text = vibevoice_script(req.text_input->text);

    // Ruling R7(s4): deterministic synthesis by default — product behavior AND the parity
    // harness's precondition (Task 3 compares this binding's output against the official
    // CLI) — EXCEPT moss_tts_nano (Ruling R23, .superpowers/moss-eoc-verdict.md): greedy
    // decode never reaches this checkpoint's own end-of-content token for ordinary input
    // (measured: 300-frame/24.000s cap, once, E1; corroborated by the pre-existing parity
    // baseline), while sampling does (measured: real EOC, 2.6-3.7s, 3/3, E2a/b/c, full
    // correct transcript). The seed stays "0" for every family but the two Chatterbox ones
    // (see the seed below) either way — t->sample_decode only picks argmax vs. sample for the
    // two-logit stop decision, it does not reintroduce nondeterminism.
    //
    // `do_sample` is skipped for a strict-options family (see FamilyInfo::strict_options):
    // model_specs/irodori_tts.json declares `seed` but not `do_sample`, and sending it
    // throws. irodori is greedy-free anyway (rectified-flow sampling with a seed), and the
    // seed below — which its spec DOES declare — is what makes it reproducible.
    if (!t->strict_options) {
        req.options["do_sample"] = t->sample_decode ? "true" : "false";
    }
    // The two Chatterbox families are given a nonzero seed. audio.cpp's chatterbox choose_seed
    // turns seed 0 into a std::random_device draw (src/models/chatterbox/component_weights.cpp:
    // 7-13) for its T3 sampler (components/t3_runtime.h:1416) and for the S3Gen flow noise
    // (s3gen_inference.cpp:330-335); the HiFT vocoder takes the seed verbatim. chatterbox_turbo
    // fixes its own T3 at seed 0 (src/community_models/chatterbox_turbo/
    // t3_turbo_component.cpp:141), but its flow noise reuses chatterbox's choose_seed
    // (s3gen_turbo.cpp:79-90), so both families need a nonzero seed for R7(s4)'s deterministic
    // synthesis. Every other pinned family randomises only when no seed is sent.
    req.options["seed"] =
        (t->family == "chatterbox" || t->family == "chatterbox_turbo") ? "1" : "0";
    return req;
}

#ifndef SK_TTS_REQUEST_ONLY
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
#endif  // SK_TTS_REQUEST_ONLY

}  // namespace

#ifndef SK_TTS_REQUEST_ONLY
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

        const rt::TaskSpec task_spec = task_spec_for(*info);

        rt::SessionOptions session_options;
        session_options.backend = backend;
        // moss_tts_local's default ("auto") weight type expands the backbone to f32 on a CPU
        // backend (audio.cpp src/models/moss/moss_tts_local/session.cpp:150-183): one CPU synth of
        // the 7.5 GB q8_0 file peaked at 24.2 GB that way and at 13.1 GB with "native", which
        // keeps the file's own weights (measured 2026-10-06). GPU backends already resolve "auto"
        // to native.
        if (std::strcmp(info->name, "moss_tts_local") == 0)
            session_options.options["moss_tts_local.weight_type"] = "native";
        // breeze_tts on Vulkan: its default policy (breeze_tts/generator.cpp:58-98) casts the
        // activations to bf16 at every layer, and for the F16 KV cache the cast is an unfused
        // ggml_cast f16 -> bf16 (framework/modules/transformers/decoder.cpp:272-288, :813-816,
        // :978-981), a copy ggml-vulkan has no kernel for (ggml-vulkan.cpp:6171, supports_op at
        // :15585-15647): every Vulkan synth aborts. Upstream's own switch (breeze_tts/session.cpp:
        // 61-76) turns the policy off. Only Vulkan: the CPU never enables the policy, and Metal's
        // "auto" is already off.
        if (std::strcmp(info->name, "breeze_tts") == 0 && backend.type == core::BackendType::Vulkan)
            session_options.options["breeze_tts.bf16_activations"] = "off";

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

        adopt_family(h, *info, *opts);
        // A qwen3_tts CustomVoice checkpoint speaks one of its built-in speakers and takes no
        // reference clip: only the Base variant advertises speaker references (audio.cpp
        // src/models/qwen3_tts/loader.cpp:33-51), and the CustomVoice session never reads
        // voice.speaker.audio (session.cpp:617-622). The family row's clone flags describe Base.
        if (std::strcmp(info->name, "qwen3_tts") == 0 && !inspection.capabilities.supports_speaker_reference) {
            h->clones = false;
            h->transcript_required = false;
        }
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
#endif  // SK_TTS_REQUEST_ONLY
