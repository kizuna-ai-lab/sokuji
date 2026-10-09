// sk_tts.cpp's family table and request building, checked without a model: this file
// compiles sk_tts.cpp straight in with SK_TTS_REQUEST_ONLY, which leaves out everything that
// needs the audio.cpp runtime or the library's own state. Plain asserts, like every native
// test here.
#undef NDEBUG
#include <cassert>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#define SK_TTS_REQUEST_ONLY 1
#include "sk_env.h"
#include "sk_tts.cpp"

namespace {

// The nine families' rows as they stood before strict_sends_ref_text, task and
// preset_option existed. The new columns must leave every one of them where it was.
struct PinnedRow {
    const char *name;
    bool streaming, clones, transcript_required;
    int32_t rate;
    bool sample_decode, strict_options;
};
constexpr PinnedRow kPinnedRows[] = {
    {"moss_tts_nano", false, true,  false, 48000, true,  false},
    {"qwen3_tts",     false, true,  true,  24000, false, false},
    {"omnivoice",     true,  true,  true,  24000, false, false},
    {"pocket_tts",    false, true,  false, 24000, false, false},
    {"supertonic",    true,  false, false, 44100, false, false},
    {"voxcpm1",       true,  true,  false, 16000, false, false},
    {"voxcpm2",       true,  true,  false, 48000, false, false},
    {"irodori_tts",   false, true,  false, 48000, false, true},
    {"index_tts2",    false, true,  false, 22050, false, false},
};

// load_language is what sk_tts_options.language carries at load (a card's load_language).
std::unique_ptr<sk_tts> handle_from(const FamilyInfo &info, const char *load_language = nullptr) {
    auto h = std::make_unique<sk_tts>();
    const sk_tts_options opts{info.name, load_language};
    adopt_family(h.get(), info, opts);
    return h;
}

std::unique_ptr<sk_tts> handle_for(const char *family, const char *load_language = nullptr) {
    const FamilyInfo *info = find_family(family);
    assert(info != nullptr);
    return handle_from(*info, load_language);
}

void give_clip(sk_tts *h, const char *ref_text) {
    h->has_clone = true;
    h->clone_audio.sample_rate = 24000;
    h->clone_audio.channels = 1;
    h->clone_audio.samples.assign(2400, 0.1f);
    h->clone_ref_text = ref_text;
    h->has_preset = false;
    h->preset_name.clear();
}

void give_preset(sk_tts *h, const char *name) {
    h->has_preset = true;
    h->preset_name = name;
    h->has_clone = false;
    h->clone_ref_text.clear();
}

bool has(const rt::TaskRequest &r, const char *key) { return r.options.count(key) != 0; }

std::string opt(const rt::TaskRequest &r, const char *key) {
    const auto it = r.options.find(key);
    return it == r.options.end() ? std::string("<absent>") : it->second;
}

std::string cached_voice(const rt::TaskRequest &r) {
    if (!r.voice || !r.voice->speaker || !r.voice->speaker->cached_voice_id) return "<none>";
    return *r.voice->speaker->cached_voice_id;
}

bool carries_clip(const rt::TaskRequest &r) {
    return r.voice && r.voice->speaker && r.voice->speaker->audio.has_value();
}

void existing_rows_are_unchanged() {
    for (const PinnedRow &p : kPinnedRows) {
        const FamilyInfo *f = find_family(p.name);
        assert(f != nullptr);
        assert(f->streaming == p.streaming);
        assert(f->clones == p.clones);
        assert(f->transcript_required == p.transcript_required);
        assert(f->default_rate == p.rate);
        assert(f->sample_decode == p.sample_decode);
        assert(f->strict_options == p.strict_options);
        assert(!f->strict_sends_ref_text);
        assert(f->task == FamilyTask::Tts);
        assert(f->preset_option == nullptr);
        const rt::TaskSpec spec = task_spec_for(*f);
        assert(spec.task == rt::VoiceTaskKind::Tts);
        assert(spec.mode == (p.streaming ? rt::RunMode::Streaming : rt::RunMode::Offline));
    }
    assert(std::size(kFamilies) >= std::size(kPinnedRows));
    assert(find_family("no_such_family") == nullptr);
}

void task_column_picks_the_session_kind() {
    constexpr FamilyInfo clone_only{"fake_clone_only", false, true, false, 24000, false, true, true,
                                    FamilyTask::VoiceCloning, nullptr};
    assert(task_spec_for(clone_only).task == rt::VoiceTaskKind::VoiceCloning);
    assert(task_spec_for(clone_only).mode == rt::RunMode::Offline);
    constexpr FamilyInfo streaming_tts{"fake_streaming", true, false, false, 24000, false, false, false,
                                       FamilyTask::Tts, nullptr};
    assert(task_spec_for(streaming_tts).task == rt::VoiceTaskKind::Tts);
    assert(task_spec_for(streaming_tts).mode == rt::RunMode::Streaming);
}

void adopt_family_copies_every_column() {
    constexpr FamilyInfo row{"fake_row", true, true, true, 22050, true, true, true,
                             FamilyTask::VoiceCloning, "voice_id"};
    const auto h = handle_from(row);
    assert(h->family == "fake_row");
    assert(h->streaming_family && h->clones && h->transcript_required);
    assert(h->default_rate == 22050);
    assert(h->sample_decode && h->strict_options && h->strict_sends_ref_text);
    assert(h->preset_option != nullptr && std::strcmp(h->preset_option, "voice_id") == 0);
}

void strict_family_gets_the_transcript_only_when_its_spec_declares_one() {
    // Strict and declaring no reference_text (irodori_tts's shape): the clip goes, its
    // transcript does not, and neither does do_sample.
    const auto plain = handle_from(FamilyInfo{"fake_strict", false, true, false, 24000, false, true, false,
                                              FamilyTask::Tts, nullptr});
    give_clip(plain.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(plain.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    assert(!has(req, "reference_text"));
    assert(!has(req, "do_sample"));
    assert(opt(req, "seed") == "0");

    // Strict and declaring it: the transcript goes; do_sample still does not.
    const auto with_ref = handle_from(FamilyInfo{"fake_strict_ref", false, true, true, 24000, false, true, true,
                                                 FamilyTask::VoiceCloning, nullptr});
    give_clip(with_ref.get(), "The quick brown fox.");
    req = build_request(with_ref.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(!has(req, "do_sample"));
    assert(opt(req, "seed") == "0");

    // An empty transcript is never sent, strict or not.
    give_clip(with_ref.get(), "");
    req = build_request(with_ref.get(), "Hello.", "en", 1.0f);
    assert(!has(req, "reference_text"));

    // Not strict: the transcript always goes, with do_sample, whatever the new column says.
    const auto free_family = handle_from(FamilyInfo{"fake_free", false, true, false, 24000, false, false, false,
                                                    FamilyTask::Tts, nullptr});
    give_clip(free_family.get(), "Hi there.");
    req = build_request(free_family.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "reference_text") == "Hi there.");
    assert(opt(req, "do_sample") == "false");
}

void preset_reaches_the_engine_by_the_rows_route() {
    const auto cached = handle_from(FamilyInfo{"fake_cached", false, false, false, 24000, false, false, false,
                                               FamilyTask::Tts, nullptr});
    give_preset(cached.get(), "M1");
    rt::TaskRequest req = build_request(cached.get(), "Hello.", "en", 1.0f);
    assert(cached_voice(req) == "M1");
    assert(!has(req, "voice_id"));

    const auto by_option = handle_from(FamilyInfo{"fake_option", false, false, false, 22050, false, true, false,
                                                  FamilyTask::Tts, "voice_id"});
    give_preset(by_option.get(), "Aria");
    req = build_request(by_option.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "voice_id") == "Aria");
    assert(!req.voice.has_value());
    assert(!has(req, "do_sample"));
    assert(opt(req, "seed") == "0");
}

void existing_families_build_the_same_requests() {
    // irodori_tts: strict; Japanese forced through the option; a clip's transcript dropped.
    const auto irodori = handle_for("irodori_tts");
    give_clip(irodori.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(irodori.get(), "Konnichiwa.", "en", 1.0f);
    assert(opt(req, "language") == "ja");
    assert(carries_clip(req) && !has(req, "reference_text"));
    assert(!has(req, "do_sample") && opt(req, "seed") == "0");

    // qwen3_tts: an app code becomes its checkpoint's language name (R14(s4), revised
    // 2026-10-09); the transcript goes; greedy.
    const auto qwen3 = handle_for("qwen3_tts");
    give_clip(qwen3.get(), "The quick brown fox.");
    req = build_request(qwen3.get(), "Hello.", "en", 1.0f);
    assert(req.text_input && req.text_input->language == "english");
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "do_sample") == "false");

    // moss_tts_nano: sampled stop decision (R23); the caller's language passes through.
    const auto moss = handle_for("moss_tts_nano");
    req = build_request(moss.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "do_sample") == "true");
    assert(req.text_input && req.text_input->language == "en");
    assert(!req.voice.has_value());

    // index_tts2: the caller's language, lowercased, as an option.
    const auto index = handle_for("index_tts2");
    req = build_request(index.get(), "Hello.", "EN", 1.0f);
    assert(opt(req, "language") == "en");

    // supertonic: preset through cached_voice_id; speed through speaking_rate (R6(s4)).
    const auto supertonic = handle_for("supertonic");
    give_preset(supertonic.get(), "M1");
    req = build_request(supertonic.get(), "Hello.", "en", 1.5f);
    assert(cached_voice(req) == "M1");
    assert(opt(req, "speaking_rate") == std::to_string(1.5f));
    req = build_request(supertonic.get(), "Hello.", "en", 1.0f);
    assert(!has(req, "speaking_rate"));

    // pocket_tts: preset through cached_voice_id.
    const auto pocket = handle_for("pocket_tts");
    give_preset(pocket.get(), "alba");
    req = build_request(pocket.get(), "Hello.", "en", 1.0f);
    assert(cached_voice(req) == "alba");

    // voxcpm2: its streaming session turns the bad-case retry off.
    const auto voxcpm2 = handle_for("voxcpm2");
    req = build_request(voxcpm2.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "retry_badcase") == "false");
}

void load_language_is_kept_for_every_family_but_pocket_tts() {
    assert(handle_for("omnivoice", "arz")->forced_language == "arz");
    assert(handle_for("index_tts2", "ja")->forced_language == "ja");
    // pocket_tts's load language names a package ("english", ...), not a request language.
    assert(handle_for("pocket_tts", "english")->forced_language.empty());
    assert(handle_for("omnivoice", nullptr)->forced_language.empty());
    assert(handle_for("omnivoice", "")->forced_language.empty());
}

void load_language_replaces_the_callers_on_every_synth() {
    const auto forced = handle_for("omnivoice", "arz");
    give_clip(forced.get(), "Marhaba.");
    rt::TaskRequest req = build_request(forced.get(), "Hello.", "ar", 1.0f);
    assert(req.text_input && req.text_input->language == "arz");
    req = build_request(forced.get(), "Hello.", nullptr, 1.0f);
    assert(req.text_input && req.text_input->language == "arz");

    const auto plain = handle_for("omnivoice");
    req = build_request(plain.get(), "Hello.", "ar", 1.0f);
    assert(req.text_input && req.text_input->language == "arb");   // OmniVoice's id for it

    const auto pocket = handle_for("pocket_tts", "english");
    req = build_request(pocket.get(), "Hello.", "en", 1.0f);
    assert(req.text_input && req.text_input->language == "en");

    // The family rules apply to whatever language the load left in force.
    const auto qwen3 = handle_for("qwen3_tts", "en");
    req = build_request(qwen3.get(), "Hello.", "zh", 1.0f);
    assert(req.text_input && req.text_input->language == "english");
    const auto index = handle_for("index_tts2", "JA");
    req = build_request(index.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "language") == "ja");
    const auto irodori = handle_for("irodori_tts", "en");
    req = build_request(irodori.get(), "Konnichiwa.", "en", 1.0f);
    assert(opt(req, "language") == "ja");
}

void omnivoice_takes_its_own_ids_for_arabic_and_nepali() {
    // OmniVoice ids them "arb" and "npi" (omnivoice/language_map.inc:39, :430) and refuses "ar" and
    // "ne" (prompt_builder.cpp:255-276).
    const auto omni = handle_for("omnivoice");
    const auto language = [&](const sk_tts *h, const char *code) {
        return build_request(h, "Hello.", code, 1.0f).text_input->language;
    };
    assert(language(omni.get(), "ar") == "arb");
    assert(language(omni.get(), "ne") == "npi");
    assert(language(omni.get(), "ar-EG") == "arb");
    assert(language(omni.get(), "NE_np") == "npi");
    assert(language(omni.get(), "arb") == "arb");
    assert(language(omni.get(), "en") == "en");
    assert(language(omni.get(), "arz") == "arz");
    assert(language(omni.get(), nullptr).empty());
    // VoiceTut's load language replaces the caller's first and is OmniVoice's own Egyptian id.
    const auto voicetut = handle_for("omnivoice", "arz");
    assert(language(voicetut.get(), "ar") == "arz");
    assert(language(voicetut.get(), "ne") == "arz");
    // Another family keeps the app's codes.
    for (const char *family : {"fish_audio", "moss_tts_nano", "chatterbox", "confucius4_tts"}) {
        const auto other = handle_for(family);
        assert(language(other.get(), "ar") == "ar");
        assert(language(other.get(), "ne") == "ne");
    }
}

// The ten names in the qwen3_tts checkpoints' talker_config.codec_language_id, read off the
// 0.6B and 1.7B Base and the 1.7B CustomVoice GGUFs (the same ten in each), never off sk_tts.cpp.
constexpr LanguageName kQwen3CheckpointNames[] = {
    {"zh", "chinese"}, {"en", "english"}, {"ja", "japanese"}, {"ko", "korean"},
    {"de", "german"},  {"fr", "french"},  {"ru", "russian"},  {"pt", "portuguese"},
    {"es", "spanish"}, {"it", "italian"},
};
// The app's 74 base codes (src/lib/local-inference/modelManifest.languages.test.ts).
constexpr const char *kAppCodes[] = {
    "af", "am", "ar", "az", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es",
    "et", "fa", "fi", "fil", "fr", "gl", "gu", "he", "hi", "hr", "hu", "id", "is", "it", "ja",
    "jv", "ka", "kk", "km", "kn", "ko", "lb", "lo", "lt", "lv", "mk", "ml", "mn", "mr", "ms",
    "mt", "my", "ne", "nl", "no", "pl", "ps", "pt", "ro", "ru", "si", "sk", "sl", "so", "sq",
    "sr", "su", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur", "uz", "vi", "yue", "zh",
};
static_assert(std::size(kQwen3CheckpointNames) == 10 && std::size(kAppCodes) == 74, "a list was mistyped");

// Ruling R14(s4), revised 2026-10-09: qwen3_tts is handed its checkpoint's name for the ten
// languages it carries, and "auto" for any other app code.
void qwen3_tts_takes_its_checkpoints_language_names() {
    const auto h = handle_for("qwen3_tts");
    give_clip(h.get(), "The quick brown fox.");
    const auto language = [](const sk_tts *handle, const char *code) {
        const rt::TaskRequest req = build_request(handle, "Hello.", code, 1.0f);
        assert(!has(req, "language"));   // the name rides text_input, as "auto" did
        return req.text_input ? req.text_input->language : std::string("<no text_input>");
    };
    int wrong = 0;
    for (const char *code : kAppCodes) {
        std::string want = "auto";
        for (const auto &pair : kQwen3CheckpointNames)
            if (std::string(pair.code) == code) want = pair.name;
        const std::string got = language(h.get(), code);
        if (got != want) {
            std::fprintf(stderr, "qwen3_tts, code \"%s\": want \"%s\", got \"%s\"\n", code, want.c_str(), got.c_str());
            ++wrong;
        }
    }
    assert(wrong == 0);
    // A region subtag or another case reaches the same name.
    assert(language(h.get(), "ko-KR") == "korean");
    assert(language(h.get(), "PT_br") == "portuguese");
    assert(language(h.get(), "zh-Hant") == "chinese");
    // An unknown code and no code keep "auto".
    assert(language(h.get(), "xx") == "auto");
    assert(language(h.get(), "") == "auto");
    assert(language(h.get(), nullptr) == "auto");
    // The CustomVoice checkpoint's preset path follows the same rule.
    const auto custom_voice = handle_for("qwen3_tts");
    give_preset(custom_voice.get(), "Vivian");
    assert(language(custom_voice.get(), "ja") == "japanese");
    // Other families keep the app's code.
    for (const char *family : {"omnivoice", "fish_audio", "moss_tts_nano", "audio8_tts"}) {
        const auto other = handle_for(family);
        assert(build_request(other.get(), "Hello.", "ko", 1.0f).text_input->language == "ko");
    }
}

void cosyvoice3_requests() {
    // A clip with its transcript: zero_shot, whose prompt is built from reference_text.
    const auto h = handle_for("cosyvoice3");
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    assert(opt(req, "template_name") == "zero_shot");
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(!has(req, "do_sample") && opt(req, "seed") == "0");
    assert(!has(req, "language"));
    // A clip without one: cross_lingual, which clones from the clip alone.
    give_clip(h.get(), "");
    req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "template_name") == "cross_lingual");
    assert(!has(req, "reference_text"));
    // No clip: no template either; the engine refuses that synth itself.
    const auto bare = handle_for("cosyvoice3");
    req = build_request(bare.get(), "Hello.", "en", 1.0f);
    assert(!has(req, "template_name"));
    assert(task_spec_for(*find_family("cosyvoice3")).task == rt::VoiceTaskKind::Tts);
}

void fireredtts3_requests() {
    assert(base_language_code("ZH-hant_TW") == "zh");
    assert(base_language_code(nullptr).empty());
    assert(std::string(english_language_name("yue")) == "Cantonese");
    assert(english_language_name("xx") == nullptr);

    assert(task_spec_for(*find_family("fireredtts3")).task == rt::VoiceTaskKind::VoiceCloning);
    const auto h = handle_for("fireredtts3");
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    assert(opt(req, "language") == "English");
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(!has(req, "do_sample") && opt(req, "seed") == "0");
    req = build_request(h.get(), "Hello.", "PT_br", 1.0f);
    assert(opt(req, "language") == "Portuguese");
    req = build_request(h.get(), "Hello.", "yue", 1.0f);
    assert(opt(req, "language") == "Cantonese");
    // A code with no name stays on text_input only, where the engine refuses it by name.
    req = build_request(h.get(), "Hello.", "xx", 1.0f);
    assert(!has(req, "language"));
    assert(req.text_input && req.text_input->language == "xx");
    req = build_request(h.get(), "Hello.", nullptr, 1.0f);
    assert(!has(req, "language"));
}

// The names the two vendors write, each with the app's base code for it. They are read off the
// vendors' own lists, never off kLanguageNames, so a slip in one of its rows shows up here.
//
// FireRedTTS-3's tag list: audio.cpp src/models/fireredtts3/tokenizer_text.cpp:20-45, in its order.
constexpr LanguageName kFireRedTags[] = {
    {"zh", "Chinese"},    {"en", "English"},    {"yue", "Cantonese"}, {"ja", "Japanese"},
    {"ko", "Korean"},     {"es", "Spanish"},    {"fr", "French"},     {"ru", "Russian"},
    {"ar", "Arabic"},     {"tr", "Turkish"},    {"id", "Indonesian"}, {"pt", "Portuguese"},
    {"it", "Italian"},    {"nl", "Dutch"},      {"vi", "Vietnamese"}, {"de", "German"},
    {"uk", "Ukrainian"},  {"th", "Thai"},       {"pl", "Polish"},     {"ro", "Romanian"},
    {"el", "Greek"},      {"cs", "Czech"},      {"fi", "Finnish"},    {"hi", "Hindi"},
};
// MOSS-TTS-Local v1.5's language table, in the vendor card's order ("Supported Languages"; its
// codes are the 31 of audio.cpp's model_specs/moss_tts_local.json). The card's Tagalog code is
// "tl"; the app's own base code for it is "fil".
constexpr LanguageName kMossLocalNames[] = {
    {"zh", "Chinese"},    {"yue", "Cantonese"}, {"en", "English"},    {"ar", "Arabic"},
    {"cs", "Czech"},      {"da", "Danish"},     {"nl", "Dutch"},      {"fi", "Finnish"},
    {"fr", "French"},     {"de", "German"},     {"el", "Greek"},      {"he", "Hebrew"},
    {"hi", "Hindi"},      {"hu", "Hungarian"},  {"it", "Italian"},    {"ja", "Japanese"},
    {"ko", "Korean"},     {"mk", "Macedonian"}, {"ms", "Malay"},      {"fa", "Persian (Farsi)"},
    {"pl", "Polish"},     {"pt", "Portuguese"}, {"ro", "Romanian"},   {"ru", "Russian"},
    {"es", "Spanish"},    {"sw", "Swahili"},    {"sv", "Swedish"},    {"fil", "Tagalog"},
    {"th", "Thai"},       {"tr", "Turkish"},    {"vi", "Vietnamese"},
};
// The vendor's own code for Tagalog, which the table keeps beside the app's "fil".
constexpr LanguageName kVendorCodeAliases[] = {{"tl", "Tagalog"}};
static_assert(std::size(kFireRedTags) == 24 && std::size(kMossLocalNames) == 31,
              "a vendor list was mistyped");

template <size_t N>
bool listed_in(const LanguageName (&list)[N], const LanguageName &row) {
    for (const auto &pair : list)
        if (std::string(pair.code) == row.code && std::string(pair.name) == row.name) return true;
    return false;
}

bool vendor_lists_have(const LanguageName &row) {
    return listed_in(kFireRedTags, row) || listed_in(kMossLocalNames, row) || listed_in(kVendorCodeAliases, row);
}

// kLanguageNames is the one table both name-tagged families read, so a slip in any row reaches a
// family. Every pair of both vendors' lists must come out of a request as the vendor's name, and
// every row of the table must be one of those pairs. FireRedTTS-3's rule hands the name of ANY
// table code to its "language" option, which is how the whole table is read here.
void language_names_match_the_vendors() {
    const auto h = handle_for("fireredtts3");
    int wrong = 0;
    const auto check = [&](const LanguageName &pair) {
        const std::string got = opt(build_request(h.get(), "Hello.", pair.code, 1.0f), "language");
        if (got != pair.name) {
            std::fprintf(stderr, "language code \"%s\": want \"%s\", got \"%s\"\n", pair.code, pair.name, got.c_str());
            ++wrong;
        }
    };
    for (const auto &pair : kFireRedTags) check(pair);
    for (const auto &pair : kMossLocalNames) check(pair);
    for (const auto &pair : kVendorCodeAliases) check(pair);
    for (const auto &row : kLanguageNames) {
        if (!vendor_lists_have(row)) {
            std::fprintf(stderr, "table row \"%s\" -> \"%s\" is on no vendor list\n", row.code, row.name);
            ++wrong;
        }
    }
    assert(wrong == 0);
    // 24 FireRedTTS-3 tags + the 9 names only MOSS-TTS-Local lists + the "tl" alias.
    assert(std::size(kLanguageNames) == 34);
}

void moss_tts_local_requests() {
    const auto h = handle_for("moss_tts_local");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(req.text_input && req.text_input->language == "English");
    req = build_request(h.get(), "Hello.", "fil", 1.0f);
    assert(req.text_input->language == "Tagalog");
    req = build_request(h.get(), "Hello.", "FA-ir", 1.0f);
    assert(req.text_input->language == "Persian (Farsi)");
    // No name: an empty slot, which the model reads as "detect the language yourself".
    req = build_request(h.get(), "Hello.", "xx", 1.0f);
    assert(req.text_input->language.empty());
    req = build_request(h.get(), "Hello.", nullptr, 1.0f);
    assert(req.text_input->language.empty());
    assert(!has(req, "language"));
    // Not strict; samples its audio tokens like moss_tts_nano (R23), with the fixed seed.
    assert(opt(req, "do_sample") == "true" && opt(req, "seed") == "0");
    give_clip(h.get(), "The quick brown fox.");
    req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
}

// MOSS-TTS-Local reads its name from text_input.language, where FireRedTTS-3 reads an option:
// all 31 names of the vendor's card (and its "tl") must reach the prompt's slot as written.
void moss_tts_local_takes_the_vendors_names() {
    const auto h = handle_for("moss_tts_local");
    int wrong = 0;
    const auto check = [&](const LanguageName &pair) {
        const rt::TaskRequest req = build_request(h.get(), "Hello.", pair.code, 1.0f);
        const std::string got = req.text_input ? req.text_input->language : std::string("<no text_input>");
        if (got != pair.name) {
            std::fprintf(stderr, "moss_tts_local, code \"%s\": want \"%s\", got \"%s\"\n", pair.code, pair.name, got.c_str());
            ++wrong;
        }
        assert(!has(req, "language"));
    };
    for (const auto &pair : kMossLocalNames) check(pair);
    for (const auto &pair : kVendorCodeAliases) check(pair);
    assert(wrong == 0);
}

void vibevoice_requests() {
    assert(vibevoice_script("").empty());
    const auto h = handle_for("vibevoice");
    rt::TaskRequest req = build_request(h.get(), "Hello there.", "en", 1.0f);
    assert(req.text_input && req.text_input->text == "Speaker 1: Hello there.");
    req = build_request(h.get(), "  First line.\r\n\n\tSecond line.  ", "en", 1.0f);
    assert(req.text_input->text == "Speaker 1: First line.\nSpeaker 1: Second line.");
    // Not strict; greedy, its own default; the fixed seed.
    assert(opt(req, "do_sample") == "false" && opt(req, "seed") == "0");
    give_clip(h.get(), "");
    req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req) && req.text_input->text == "Speaker 1: Hello.");
}

// The engine's line pattern ends in (.*), and "." refuses a CR, so a line carrying a bare CR
// would be dropped (or, alone, make the synth throw "no valid Speaker N: lines"). A CR breaks a
// line the way an LF does; CRLF is one break, because the empty piece between them is skipped.
void vibevoice_breaks_a_line_at_a_bare_cr() {
    assert(vibevoice_script("A\rB") == "Speaker 1: A\nSpeaker 1: B");
    assert(vibevoice_script("A\r\nB") == "Speaker 1: A\nSpeaker 1: B");
    assert(vibevoice_script("A\r\rB\n\rC\r") == "Speaker 1: A\nSpeaker 1: B\nSpeaker 1: C");
    assert(vibevoice_script("\r").empty());
    const auto h = handle_for("vibevoice");
    const rt::TaskRequest req = build_request(h.get(), "Hello there.\rWhat is that?", "en", 1.0f);
    assert(req.text_input->text == "Speaker 1: Hello there.\nSpeaker 1: What is that?");
}

// A label the user typed is text for the one speaker, never a second speaker: the wrapper
// prefixes every line unconditionally.
void vibevoice_keeps_a_typed_speaker_label_as_text() {
    const auto h = handle_for("vibevoice");
    const rt::TaskRequest req = build_request(h.get(), "Speaker 2: hi", "en", 1.0f);
    assert(req.text_input->text == "Speaker 1: Speaker 2: hi");
}

void chatterbox_requests() {
    const auto h = handle_for("chatterbox");
    assert(task_spec_for(*find_family("chatterbox")).task == rt::VoiceTaskKind::VoiceCloning);
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hallo.", "de", 1.0f);
    assert(carries_clip(req));
    // The engine normalises and checks the code itself, so it reaches it as given.
    assert(req.text_input && req.text_input->language == "de");
    assert(!has(req, "language"));
    // Not strict: the transcript goes (and is ignored); sampled T3, its own default. Its
    // engine turns seed 0 into a random draw, so it is given a fixed nonzero seed.
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "do_sample") == "true" && opt(req, "seed") == "1");
    const auto other = handle_for("moss_tts_local");
    assert(opt(build_request(other.get(), "Hello.", "en", 1.0f), "seed") == "0");
}

void chatterbox_turbo_requests() {
    const auto h = handle_for("chatterbox_turbo");
    assert(!h->clones);
    assert(task_spec_for(*find_family("chatterbox_turbo")).task == rt::VoiceTaskKind::Tts);
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(!req.voice.has_value());
    assert(req.text_input && req.text_input->language == "en");
    // Not strict; do_sample is not read by this family, and the fixed seed is. Its T3 maps seed
    // 0 to a constant but its flow noise shares chatterbox's choose_seed, so it too is given a
    // fixed nonzero seed.
    assert(opt(req, "do_sample") == "false" && opt(req, "seed") == "1");
}

void confucius4_tts_requests() {
    const auto h = handle_for("confucius4_tts");
    assert(task_spec_for(*find_family("confucius4_tts")).task == rt::VoiceTaskKind::VoiceCloning);
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "ja", 1.0f);
    assert(carries_clip(req));
    // The caller's code reaches the engine's prompt table unchanged, on text_input.
    assert(req.text_input && req.text_input->language == "ja");
    // Strict, declaring neither reference_text nor do_sample.
    assert(!has(req, "reference_text") && !has(req, "do_sample") && !has(req, "language"));
    assert(opt(req, "seed") == "0");
}

void magpie_tts_requests() {
    const auto h = handle_for("magpie_tts");
    assert(!h->clones && h->preset_option != nullptr && std::strcmp(h->preset_option, "voice_id") == 0);
    give_preset(h.get(), "Sofia");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "pt", 1.0f);
    assert(opt(req, "voice_id") == "Sofia");
    assert(!req.voice.has_value());
    // The engine maps the bare code itself (pt -> pt-BR), from text_input.
    assert(req.text_input && req.text_input->language == "pt");
    assert(!has(req, "language") && !has(req, "do_sample"));
    assert(opt(req, "seed") == "0");
    const auto bare = handle_for("magpie_tts");
    req = build_request(bare.get(), "Hello.", "en", 1.0f);
    assert(!has(req, "voice_id") && !req.voice.has_value());
    // Its voice_id is the preset option: a bare request in one of kitten_tts2's nine languages
    // names no voice.
    req = build_request(bare.get(), "Hello.", "pt", 1.0f);
    assert(!has(req, "voice_id") && !req.voice.has_value());
}

void neutts_requests() {
    const auto h = handle_for("neutts");
    assert(!h->clones && h->preset_option != nullptr && std::strcmp(h->preset_option, "voice_id") == 0);
    give_preset(h.get(), "paul");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "voice_id") == "paul");
    assert(!req.voice.has_value());
    assert(!has(req, "do_sample") && opt(req, "seed") == "0");
}

void kugelaudio_requests() {
    const auto h = handle_for("kugelaudio");
    assert(!h->clones && h->preset_option == nullptr);
    give_preset(h.get(), "english_male");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(cached_voice(req) == "english_male");
    assert(!has(req, "voice_id"));
    // Strict: its spec declares do_sample, but a strict row never sends it.
    assert(!has(req, "do_sample") && opt(req, "seed") == "0");
}

void higgs_audio_tts_requests() {
    const auto h = handle_for("higgs_audio_tts");
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    // Not strict: the transcript goes; do_sample is not read by this family; the seed makes its
    // sampler the host-side seeded one.
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "do_sample") == "false" && opt(req, "seed") == "0");
}

void higgs_max_tokens_scales_with_the_text() {
    // 15 frames a codepoint, between 256 and the engine's default 2048.
    assert(higgs_max_tokens("") == 256);
    assert(higgs_max_tokens("Hello.") == 256);
    assert(higgs_max_tokens(std::string(17, 'a')) == 256);
    assert(higgs_max_tokens(std::string(18, 'a')) == 270);
    assert(higgs_max_tokens(std::string(136, 'a')) == 2040);
    assert(higgs_max_tokens(std::string(137, 'a')) == 2048);
    assert(higgs_max_tokens(std::string(5000, 'a')) == 2048);
    // Codepoints, not bytes: 19 Han characters and punctuation (57 bytes), "Jintian tianqi hen hao,
    // women yiqi qu gongyuan sansan bu ba." The UTF-8 is spelled in escapes so the file stays ASCII.
    assert(higgs_max_tokens("\xE4\xBB\x8A\xE5\xA4\xA9\xE5\xA4\xA9\xE6\xB0\x94\xE5\xBE\x88\xE5\xA5\xBD\xEF\xBC\x8C"
                            "\xE6\x88\x91\xE4\xBB\xAC\xE4\xB8\x80\xE8\xB5\xB7\xE5\x8E\xBB\xE5\x85\xAC\xE5\x9B\xAD"
                            "\xE6\x95\xA3\xE6\x95\xA3\xE6\xAD\xA5\xE5\x90\xA7\xE3\x80\x82") == 285);
    const auto h = handle_for("higgs_audio_tts");
    // "Bu gun hava cox gozeldir, gelin parkda gezintiye cixaq." with its Azerbaijani letters:
    // 55 codepoints, 64 bytes.
    const char *az = "Bu g\xC3\xBCn hava \xC3\xA7ox g\xC3\xB6z\xC9\x99ldir, g\xC9\x99lin parkda g\xC9\x99zintiy\xC9\x99 "
                     "\xC3\xA7\xC4\xB1xaq.";
    rt::TaskRequest req = build_request(h.get(), az, "az", 1.0f);
    assert(opt(req, "max_tokens") == "825" && opt(req, "seed") == "0");
    give_clip(h.get(), "The quick brown fox.");
    req = build_request(h.get(), az, "az", 1.0f);
    assert(opt(req, "max_tokens") == "825" && opt(req, "seed") == "0");
}

// The engine's own words when a take spends max_tokens without its end-of-content code
// (higgs_audio_tts/generator.cpp:542-548): the literal before the cap and the one after it, the
// two pieces is_higgs_runaway matches.
constexpr const char *kRunawayHead = "Higgs TTS generation reached max_tokens (";
constexpr const char *kRunawayTail = ") before EOC for this text chunk; raise it with --max-tokens on the CLI or ";

std::string higgs_runaway(int max_tokens) {
    return kRunawayHead + std::to_string(max_tokens) + kRunawayTail +
           "the \"max_tokens\" request option on the server, or lower --text-chunk-size / \"text_chunk_size\" "
           "so each chunk needs fewer generated frames";
}

// A pin bump that rewords the throw would silently turn the retry off: both literals must still be
// in the pinned audio.cpp's generator.cpp, spelled as above.
void higgs_runaway_text_is_the_pinned_sources() {
    const std::string path = std::string(SK_AUDIOCPP_SOURCE_DIR) + "/src/models/higgs_audio_tts/generator.cpp";
    std::ifstream in(path, std::ios::binary);
    if (!in.good()) std::fprintf(stderr, "cannot read %s\n", path.c_str());
    assert(in.good());
    const std::string source((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    int missing = 0;
    for (const char *literal : {kRunawayHead, kRunawayTail}) {
        if (source.find('"' + std::string(literal) + '"') == std::string::npos) {
            std::fprintf(stderr, "%s no longer spells the literal \"%s\"\n", path.c_str(), literal);
            ++missing;
        }
    }
    assert(missing == 0);
}

// Stands in for prepare + run: records each attempt's seed and max_tokens, throws the error listed
// for its seed, and otherwise returns the seed it ran with.
struct FakeRun {
    std::map<std::string, std::string> errors;
    std::vector<std::string> seeds;
    std::vector<std::string> caps;
    int operator()(const rt::TaskRequest &r) {
        seeds.push_back(opt(r, "seed"));
        caps.push_back(opt(r, "max_tokens"));
        if (const auto it = errors.find(seeds.back()); it != errors.end()) throw std::runtime_error(it->second);
        return std::stoi(seeds.back());
    }
};

std::string attempt_error(const sk_tts *t, const rt::TaskRequest &req, FakeRun &run) {
    try {
        run_retrying_runaway(t, req, run);
    } catch (const std::exception &ex) {
        return ex.what();
    }
    return "<none>";
}

void higgs_runaway_retries_with_the_next_seeds() {
    assert(is_higgs_runaway(higgs_runaway(2048)) && is_higgs_runaway(higgs_runaway(825)));
    assert(!is_higgs_runaway("Higgs TTS max_tokens exceeds model max_position_embeddings"));
    assert(!is_higgs_runaway("Higgs TTS generation exceeds text model max_position_embeddings"));
    assert(!is_higgs_runaway("OuteTTS reached max_tokens before an audio end token and cannot split the "
                             "remaining text further; increase max_tokens"));
    assert(!is_higgs_runaway("sk_tts_synth: audiocpp: " + higgs_runaway(2048)));

    const auto h = handle_for("higgs_audio_tts");
    const rt::TaskRequest req = build_request(h.get(), "Dina iki cuacane apik banget.", "jv", 1.0f);
    const std::vector<std::string> cap(3, opt(req, "max_tokens"));
    // Seed 0 stops: one attempt.
    FakeRun stops;
    assert(run_retrying_runaway(h.get(), req, stops) == 0);
    assert((stops.seeds == std::vector<std::string>{"0"}));
    // Seed 0 runs away, seed 1 stops; seed 1's audio, the same cap.
    FakeRun once{{{"0", higgs_runaway(435)}}};
    assert(run_retrying_runaway(h.get(), req, once) == 1);
    assert((once.seeds == std::vector<std::string>{"0", "1"}));
    assert((once.caps == std::vector<std::string>(cap.begin(), cap.begin() + 2)));
    // Seeds 0 and 1 run away, seed 2 stops.
    FakeRun twice{{{"0", higgs_runaway(435)}, {"1", higgs_runaway(435)}}};
    assert(run_retrying_runaway(h.get(), req, twice) == 2);
    assert((twice.seeds == std::vector<std::string>{"0", "1", "2"}) && twice.caps == cap);
    // All three run away: seed 0's error, and no fourth attempt.
    FakeRun always{{{"0", higgs_runaway(435) + " [seed 0]"}, {"1", higgs_runaway(435)}, {"2", higgs_runaway(435)}}};
    assert(attempt_error(h.get(), req, always) == higgs_runaway(435) + " [seed 0]");
    assert((always.seeds == std::vector<std::string>{"0", "1", "2"}));
    // Any other error is not retried, first attempt or later.
    FakeRun other{{{"0", "Higgs TTS requires text input"}}};
    assert(attempt_error(h.get(), req, other) == "Higgs TTS requires text input");
    assert((other.seeds == std::vector<std::string>{"0"}));
    FakeRun later{{{"0", higgs_runaway(435)}, {"1", "Higgs TTS AR cache cannot grow"}}};
    assert(attempt_error(h.get(), req, later) == "Higgs TTS AR cache cannot grow");
    assert((later.seeds == std::vector<std::string>{"0", "1"}));
    // Another family is never retried, even on these words.
    const auto fish = handle_for("fish_audio");
    FakeRun not_higgs{{{"0", higgs_runaway(2048)}}};
    assert(attempt_error(fish.get(), build_request(fish.get(), "Hello.", "en", 1.0f), not_higgs) == higgs_runaway(2048));
    assert((not_higgs.seeds == std::vector<std::string>{"0"}));
}

void fish_audio_requests() {
    const auto h = handle_for("fish_audio");
    assert(h->transcript_required);
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    // Not strict: the transcript the engine demands with a clip goes; the seed always goes
    // (unset, this family's seed is random).
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "seed") == "0");
}

void breeze_tts_requests() {
    const auto h = handle_for("breeze_tts");
    assert(h->transcript_required && h->strict_options && h->strict_sends_ref_text);
    give_clip(h.get(), "The quick brown fox.");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    // Strict, declaring reference_text (its clone needs it) but not do_sample.
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(!has(req, "do_sample") && opt(req, "seed") == "0");
    assert(task_spec_for(*find_family("breeze_tts")).mode == rt::RunMode::Offline);
}

void audio8_tts_row_columns() {
    // The row's columns, read off audio.cpp's own sources (see the kFamilies comment): offline
    // session, optional clone that needs its transcript, 44.1 kHz, always samples, no spec
    // validation of the request options, a plain Tts session, no preset option.
    const FamilyInfo *f = find_family("audio8_tts");
    assert(f != nullptr);
    assert(!f->streaming && f->clones && f->transcript_required);
    assert(f->default_rate == 44100);
    assert(!f->sample_decode);
    assert(!f->strict_options && !f->strict_sends_ref_text);
    assert(f->task == FamilyTask::Tts && f->preset_option == nullptr);
    const rt::TaskSpec spec = task_spec_for(*f);
    assert(spec.task == rt::VoiceTaskKind::Tts && spec.mode == rt::RunMode::Offline);
}

void audio8_ja_reaches_the_model_as_yue() {
    // audio8_tts's request language only switches its Traditional -> Simplified rewrite, which
    // would turn Japanese kanji into Chinese glyphs; "yue" is the one value that skips it.
    const auto audio8 = handle_for("audio8_tts");
    rt::TaskRequest req = build_request(audio8.get(), "Tokyo.", "ja", 1.0f);
    assert(req.text_input && req.text_input->language == "yue");
    req = build_request(audio8.get(), "Tokyo.", "ja-JP", 1.0f);
    assert(req.text_input->language == "yue");
    req = build_request(audio8.get(), "Ni hao.", "zh", 1.0f);
    assert(req.text_input->language == "zh");
    assert(!has(req, "voice_id"));   // kitten_tts2's named language voices are its alone
    req = build_request(audio8.get(), "Nei hou.", "yue", 1.0f);
    assert(req.text_input->language == "yue");
    req = build_request(audio8.get(), "Hello.", "en", 1.0f);
    assert(req.text_input->language == "en");
    // Only audio8_tts is remapped: another family that forwards the caller's language keeps
    // "ja" (and a region-tagged code) exactly as sent.
    const auto fish = handle_for("fish_audio");
    req = build_request(fish.get(), "Tokyo.", "ja", 1.0f);
    assert(req.text_input->language == "ja");
    req = build_request(fish.get(), "Tokyo.", "ja-JP", 1.0f);
    assert(req.text_input->language == "ja-JP");
    // Not strict: a clip's transcript goes with it; the seed is fixed.
    give_clip(audio8.get(), "The quick brown fox.");
    req = build_request(audio8.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req) && opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "seed") == "0");
}

void soprano_is_sent_only_the_seed() {
    // soprano_tts validates every request option against its spec (soprano_tts/session.cpp:150,216),
    // which declares seed but not do_sample, and it takes no voice of any kind.
    const auto soprano = handle_for("soprano_tts");
    const rt::TaskRequest req = build_request(soprano.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "seed") == "0");
    assert(req.options.size() == 1);
    assert(!req.voice.has_value());
    // The row's columns, read off the same sources as the options: it takes no clip, does not
    // stream, writes 32 kHz and opens an offline Tts session.
    const FamilyInfo *f = find_family("soprano_tts");
    assert(f != nullptr);
    assert(!f->clones && !f->streaming);
    assert(f->default_rate == 32000);
    assert(task_spec_for(*f).mode == rt::RunMode::Offline);
}

void glm_tts_gets_the_clip_and_its_transcript() {
    // glm_tts needs the clip AND its transcript (glm_tts/session.cpp:430-441); it is not strict,
    // so the transcript travels as reference_text, with do_sample (ignored) and the seed.
    const auto glm = handle_for("glm_tts");
    give_clip(glm.get(), "The quick brown fox.");
    const rt::TaskRequest req = build_request(glm.get(), "Hello.", "zh", 1.0f);
    assert(carries_clip(req));
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "do_sample") == "false" && opt(req, "seed") == "0");
}

void outetts_aligns_a_clip_in_one_language_whatever_the_target() {
    // outetts keys a clip's aligned voice profile on reference_language, which otherwise follows
    // the synthesis target (outetts/session.cpp:603-604, 700-712); it is pinned to "auto".
    const auto oute = handle_for("outetts");
    rt::TaskRequest req = build_request(oute.get(), "Hello.", "en", 1.0f);
    assert(!has(req, "reference_language"));          // no clip: nothing to align
    give_clip(oute.get(), "The quick brown fox.");
    req = build_request(oute.get(), "Konnichiwa.", "ja", 1.0f);
    assert(opt(req, "reference_language") == "auto");
    assert(opt(req, "reference_text") == "The quick brown fox.");
    req = build_request(oute.get(), "Ni hao.", "zh", 1.0f);
    assert(opt(req, "reference_language") == "auto");
    assert(req.text_input && req.text_input->language == "zh");   // the target still reaches the text
}

void outetts_gets_a_token_budget_that_fits_cjk() {
    // Its own estimate gives unspaced text 12 tokens a codepoint (outetts/tokenizer.cpp:117-141);
    // the explicit max_tokens its spec declares replaces it, with or without a clip.
    const auto oute = handle_for("outetts");
    // "Ane wa eki no chikaku no chiisana panya de yakitate no pan wo kaimashita." in kanji and kana.
    const char *ja = "\xE5\xA7\x89\xE3\x81\xAF\xE9\xA7\x85\xE3\x81\xAE\xE8\xBF\x91\xE3\x81\x8F\xE3\x81\xAE\xE5\xB0\x8F"
                     "\xE3\x81\x95\xE3\x81\xAA\xE3\x83\x91\xE3\x83\xB3\xE5\xB1\x8B\xE3\x81\xA7\xE7\x84\xBC\xE3\x81\x8D"
                     "\xE3\x81\x9F\xE3\x81\xA6\xE3\x81\xAE\xE3\x83\x91\xE3\x83\xB3\xE3\x82\x92\xE8\xB2\xB7\xE3\x81\x84"
                     "\xE3\x81\xBE\xE3\x81\x97\xE3\x81\x9F\xE3\x80\x82";
    rt::TaskRequest req = build_request(oute.get(), ja, "ja", 1.0f);
    assert(opt(req, "max_tokens") == "2048");
    give_clip(oute.get(), "The quick brown fox.");
    req = build_request(oute.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "max_tokens") == "2048");
    assert(opt(req, "seed") == "0" && opt(req, "do_sample") == "false");
}

void set_process_env(const char *name, const char *value) {   // value == nullptr: unset
#if defined(_WIN32)
    _putenv_s(name, value ? value : "");
#else
    if (value) setenv(name, value, 1); else unsetenv(name);
#endif
}

void echo_tts_clones_in_a_voice_cloning_session_with_the_adaptive_window() {
    const FamilyInfo *echo = find_family("echo_tts");
    assert(echo != nullptr);
    // Its session refuses a Tts task (echo_tts/session.cpp:229-232).
    assert(task_spec_for(*echo).task == rt::VoiceTaskKind::VoiceCloning);
    assert(task_spec_for(*echo).mode == rt::RunMode::Offline);
    // Strict, and its spec declares no reference_text: the clip goes alone, with the seed.
    const auto h = handle_for("echo_tts");
    give_clip(h.get(), "The quick brown fox.");
    const rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req));
    assert(!has(req, "reference_text") && !has(req, "do_sample"));
    assert(opt(req, "seed") == "0");
    assert(!has(req, "max_duration_sec"));   // the window is sized by the adaptive estimate, not pinned
    // sk_init switches the adaptive window on unless the environment already decided (sk_env.h;
    // the Python suite checks that sk_init calls it). The switch is process-wide: put it back as
    // it was, so no other case sees this one's value.
    const char *kSwitch = "AUDIOCPP_ECHO_TTS_ADAPTIVE_WINDOW";
    const char *before = std::getenv(kSwitch);
    const std::string saved = before ? before : "";
    set_process_env(kSwitch, nullptr);
    sk::set_engine_env_defaults();
    assert(std::getenv(kSwitch) != nullptr && std::strcmp(std::getenv(kSwitch), "1") == 0);
    set_process_env(kSwitch, "0");
    sk::set_engine_env_defaults();
    assert(std::strcmp(std::getenv(kSwitch), "0") == 0);
    set_process_env(kSwitch, before ? saved.c_str() : nullptr);
}

void kitten_tts2_speaks_a_language_through_its_named_voice() {
    // kitten_tts2 has no language switch; nine voices are named after their language, and the
    // request option voice_id picks one, over a preset and the Bruno default
    // (kitten_tts2/session.cpp:170, :168, :164).
    const auto kitten = handle_for("kitten_tts2");
    rt::TaskRequest req = build_request(kitten.get(), "Guten Morgen.", "de", 1.0f);
    assert(opt(req, "voice_id") == "German");
    req = build_request(kitten.get(), "Guten Morgen.", "de-AT", 1.0f);
    assert(opt(req, "voice_id") == "German");
    req = build_request(kitten.get(), "Ni hao.", "zh", 1.0f);
    assert(opt(req, "voice_id") == "Chinese");
    req = build_request(kitten.get(), "Hello.", "en", 1.0f);
    assert(!has(req, "voice_id"));                       // the default voice
    req = build_request(kitten.get(), "Konnichiwa.", "ja", 1.0f);
    assert(!has(req, "voice_id"));
    // Strict. Its S3Gen flow noise reuses chatterbox's choose_seed, so it is given the same
    // fixed nonzero seed (see build_request).
    assert(!has(req, "do_sample") && !has(req, "language") && opt(req, "seed") == "1");
    // A preset the user chose wins, through cached_voice_id.
    give_preset(kitten.get(), "Bella");
    req = build_request(kitten.get(), "Guten Morgen.", "de", 1.0f);
    assert(cached_voice(req) == "Bella" && !has(req, "voice_id"));
    assert(opt(req, "seed") == "1");
    // So does a clip, and this strict family is sent its transcript.
    give_clip(kitten.get(), "The quick brown fox.");
    req = build_request(kitten.get(), "Guten Morgen.", "de", 1.0f);
    assert(carries_clip(req) && !has(req, "voice_id"));
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(!has(req, "do_sample") && opt(req, "seed") == "1");
}

void miotts_finds_its_codec_beside_the_model_folder() {
    namespace fs = std::filesystem;
    const fs::path root = fs::temp_directory_path() /
        ("sk-miotts-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directories(root / "MioTTS-1.7B-GGUF");
    fs::create_directories(root / "MioCodec-25Hz-44.1kHz-v2-GGUF");
    const fs::path lm = root / "MioTTS-1.7B-GGUF" / "miotts-1.7b-q8_0.gguf";
    const fs::path codec = root / "MioCodec-25Hz-44.1kHz-v2-GGUF" / "miocodec-25hz-44khz-v2-q8_0.gguf";
    std::ofstream(lm) << "lm";
    const FamilyInfo *mio = find_family("miotts");
    assert(mio != nullptr);
    bool threw = false;
    try {
        family_load(*mio, lm);
    } catch (const std::exception &e) {
        threw = std::string(e.what()).find("does not exist") != std::string::npos;   // -> SK_ERR_NOT_FOUND
    }
    assert(threw);
    std::ofstream(codec) << "codec";
    FamilyLoad got = family_load(*mio, lm);
    assert(got.model_path == lm);
    assert(got.session_options.size() == 1);
    assert(got.session_options[0].first == "miotts.codec_model_path");
    assert(fs::path(got.session_options[0].second) == codec);
    got = family_load(*mio, lm.parent_path());          // the model's folder works the same
    assert(fs::path(got.session_options[0].second) == codec);
    got = family_load(*mio, lm.parent_path() / "");     // and with a trailing separator
    assert(fs::path(got.session_options[0].second) == codec);
    // The op recorder reads the same file through the same helper (model_tensors.h).
    const auto companions = sk::tts_sibling_companions("miotts", lm);
    assert(companions.size() == 1 && companions[0].path == codec);
    // Every other family loads its path as given, with no session options.
    got = family_load(*find_family("audio8_tts"), lm);
    assert(got.model_path == lm && got.session_options.empty());
    assert(sk::tts_sibling_companions("audio8_tts", lm).empty());
    // miotts samples by default (sample_decode), with the fixed seed: its sampler is an
    // mt19937 seeded with the seed it is sent (models/miotts/causal_lm.cpp:963), random only when
    // none is (session.cpp:164-165).
    const auto h = handle_for("miotts");
    give_clip(h.get(), "");
    const rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(carries_clip(req) && opt(req, "do_sample") == "true" && opt(req, "seed") == "0");
    fs::remove_all(root);
}

void lfm2_audio_loads_its_package_directory_and_speaks_auto() {
    namespace fs = std::filesystem;
    const fs::path root = fs::temp_directory_path() /
        ("sk-lfm2-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directories(root);
    const fs::path backbone = root / "LFM2.5-Audio-1.5B-Q8_0.gguf";
    std::ofstream(backbone) << "backbone";
    const FamilyInfo *lfm2 = find_family("lfm2_audio");
    assert(lfm2 != nullptr);
    // A backbone file becomes its package directory, the file chosen by session option.
    FamilyLoad got = family_load(*lfm2, backbone);
    assert(got.model_path == root);
    assert(got.session_options.size() == 1);
    assert(got.session_options[0].first == "lfm2_audio.model_gguf");
    assert(got.session_options[0].second == "LFM2.5-Audio-1.5B-Q8_0.gguf");
    // A directory passes through: audio.cpp picks its only backbone.
    got = family_load(*lfm2, root);
    assert(got.model_path == root && got.session_options.empty());
    // The package's parts sit in the backbone's own folder: no companion is looked for outside it.
    assert(sk::tts_sibling_companions("lfm2_audio", backbone).empty());
    fs::remove_all(root);
    // The card's load language "auto" replaces any app code (the checkpoint accepts "", "auto" or
    // its own); strict: the seed alone; a preset through cached_voice_id.
    const auto h = handle_for("lfm2_audio", "auto");
    rt::TaskRequest req = build_request(h.get(), "Hello.", "en-US", 1.0f);
    assert(req.text_input && req.text_input->language == "auto");
    assert(opt(req, "seed") == "0" && req.options.size() == 1);
    give_preset(h.get(), "uk_female");
    req = build_request(h.get(), "Hello.", "en", 1.0f);
    assert(cached_voice(req) == "uk_female");
}

// Every family's columns, read off audio.cpp 54aa279 and never off kFamilies. Cites are paths in
// that tree: src/ unless the path starts with include/, spec = model_specs/<family>.json.
struct ExpectedRow {
    const char *name;
    bool streaming, clones, transcript_required;
    int32_t rate;
    bool sample_decode, strict, strict_sends_ref_text;
    FamilyTask task;
    const char *preset_option;
};
// streaming=false is a choice, not a missing mode, for the eight families whose spec lists
// streaming but which sokuji opens offline (one utterance gains little from it): pocket_tts,
// confucius4_tts, neutts, kugelaudio, breeze_tts, audio8_tts, soprano_tts, lfm2_audio.
constexpr ExpectedRow kExpectedRows[] = {
    //   name              stream clones transcr rate   sample strict refText task             preset_option
    // models/moss/moss_tts_nano/session.cpp:33 48 kHz, :219 Tts or clone;
    // include/engine/models/moss/moss_tts_nano/types.h:12 samples
    {"moss_tts_nano",   false, true,  false, 48000, true,  false, false, FamilyTask::Tts, nullptr},
    // models/qwen3_tts/prompt_tts_voice_clone.cpp:37 ICL clone needs the transcript;
    // tokenizer_speech_decoder.cpp:45 24 kHz; greedy by R7 although types.h:25 samples
    {"qwen3_tts",       false, true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
    // models/omnivoice/prompt_builder.cpp:772 a clip needs its transcript; spec lists streaming;
    // include/engine/models/omnivoice/assets.h:54 24 kHz
    {"omnivoice",       true,  true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
    // models/pocket_tts/session.cpp:495 Tts; include/engine/models/pocket_tts/types.h:62 24 kHz
    {"pocket_tts",      false, true,  false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // models/supertonic/session.cpp:77 Tts only, no clip; spec lists streaming;
    // include/engine/models/supertonic/assets.h:14 44.1 kHz
    {"supertonic",      true,  false, false, 44100, false, false, false, FamilyTask::Tts, nullptr},
    // community_models/voxcpm1/assets.cpp:121 the checkpoint's out_sample_rate (16000 in the
    // shipped GGUF); spec lists streaming
    {"voxcpm1",         true,  true,  false, 16000, false, false, false, FamilyTask::Tts, nullptr},
    // models/voxcpm2/assets.cpp:119 the checkpoint's out_sample_rate (48000 in the shipped GGUF);
    // spec lists streaming
    {"voxcpm2",         true,  true,  false, 48000, false, false, false, FamilyTask::Tts, nullptr},
    // models/irodori_tts/session.cpp:447 strict, spec declares seed but neither do_sample nor
    // reference_text; codec.cpp:469 48 kHz
    {"irodori_tts",     false, true,  false, 48000, false, true,  false, FamilyTask::Tts, nullptr},
    // models/index_tts2/request.cpp:88 the clip is mandatory, no transcript;
    // include/engine/models/index_tts2/types.h:70 22.05 kHz; greedy by R7 although :138 samples
    {"index_tts2",      false, true,  false, 22050, false, false, false, FamilyTask::Tts, nullptr},
    // models/cosyvoice3/session.cpp:88 Tts or clone, :159 strict, spec declares reference_text;
    // include/engine/models/cosyvoice3/assets.h:13 24 kHz
    {"cosyvoice3",      false, true,  false, 24000, false, true,  true,  FamilyTask::Tts, nullptr},
    // models/fireredtts3/session.cpp:225-237 Base takes a VoiceCloning session, :73-89 the prompt
    // is built from reference_text, :304 strict;
    // include/engine/models/fireredtts3/assets.h:40 24 kHz
    {"fireredtts3",     false, true,  true,  24000, false, true,  true,  FamilyTask::VoiceCloning, nullptr},
    // models/moss/moss_tts_local/loader.cpp:76-79 offline, Tts or clone; session.cpp:33 48 kHz;
    // include/engine/models/moss/moss_tts_local/generator.h:25 samples
    {"moss_tts_local",  false, true,  false, 48000, true,  false, false, FamilyTask::Tts, nullptr},
    // models/vibevoice/loader.cpp:131 Tts only; session.cpp:319-321 a clip is optional;
    // include/engine/models/vibevoice/types.h:18 greedy, assets.h:83 24 kHz
    {"vibevoice",       false, true,  false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // models/chatterbox/session.cpp:371-377 VoiceCloning only;
    // include/engine/models/chatterbox/tts.h:30 samples, conditionals.h:17 24 kHz
    {"chatterbox",      false, true,  false, 24000, true,  false, false, FamilyTask::VoiceCloning, nullptr},
    // community_models/chatterbox_turbo/session.cpp:54 Tts, :76-84 refuses a clip, :104 24 kHz;
    // reads no do_sample
    {"chatterbox_turbo", false, false, false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // models/confucius4_tts/session.cpp:173 VoiceCloning only, :229 strict, spec declares neither
    // do_sample nor reference_text; include/engine/models/confucius4_tts/types.h:39 22.05 kHz
    {"confucius4_tts",  false, true,  false, 22050, false, true,  false, FamilyTask::VoiceCloning, nullptr},
    // models/magpie_tts/request.cpp:30-52 the speaker is the voice_id option only, session.cpp:75
    // Tts, :107 strict; include/engine/models/magpie_tts/assets.h:62 22.05 kHz
    {"magpie_tts",      false, false, false, 22050, false, true,  false, FamilyTask::Tts, "voice_id"},
    // models/neutts/session.cpp:62-64 the speaker is the voice_id option only, :236 strict,
    // :281 + include/engine/models/neutts/assets.h:34 24 kHz
    {"neutts",          false, false, false, 24000, false, true,  false, FamilyTask::Tts, "voice_id"},
    // models/kugelaudio/session.cpp:24-26 Tts, refuses a clip, :86-97 voice_id or cached_voice_id,
    // :39 strict, :120 24 kHz
    {"kugelaudio",      false, false, false, 24000, false, true,  false, FamilyTask::Tts, nullptr},
    // models/higgs_audio_tts/generator.cpp:205-221 clip optional, session.cpp:253-256 transcript
    // optional; include/engine/models/higgs_audio_tts/codec.h:81 24 kHz
    {"higgs_audio_tts", false, true,  false, 24000, false, false, false, FamilyTask::Tts, nullptr},
    // models/fish_audio/session.cpp:252-259 a clip needs its transcript, :310 Tts;
    // include/engine/framework/codecs/fish_dac_codec_runtime.h:28 44.1 kHz
    {"fish_audio",      false, true,  true,  44100, false, false, false, FamilyTask::Tts, nullptr},
    // models/breeze_tts/session.cpp:113 strict, spec declares reference_text,
    // generator.cpp:1062-1064 a clip needs its transcript; speech_decoder.cpp:48 24 kHz
    {"breeze_tts",      false, true,  true,  24000, false, true,  true,  FamilyTask::Tts, nullptr},
    // community_models/audio8_tts/session.cpp:268-272 a clip needs its transcript, :767 44.1 kHz;
    // request options are not validated
    {"audio8_tts",      false, true,  true,  44100, false, false, false, FamilyTask::Tts, nullptr},
    // community_models/soprano_tts/session.cpp:150 strict, spec declares neither do_sample nor
    // reference_text, no voice;
    // include/engine/community_models/soprano_tts/assets.h:37 32 kHz
    {"soprano_tts",     false, false, false, 32000, false, true,  false, FamilyTask::Tts, nullptr},
    // community_models/glm_tts/session.cpp:430-441 clip and transcript mandatory, :143 24 kHz;
    // reads no do_sample
    {"glm_tts",         false, true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
    // community_models/outetts/session.cpp:700-703 a clip needs its transcript; dac.cpp:663 24 kHz;
    // reads no do_sample; spec declares reference_language
    {"outetts",         false, true,  true,  24000, false, false, false, FamilyTask::Tts, nullptr},
    // community_models/echo_tts/session.cpp:229 VoiceCloning only, :581 strict, spec declares
    // neither do_sample nor reference_text, :586-591 clip mandatory, :64 44.1 kHz
    {"echo_tts",        false, true,  false, 44100, false, true,  false, FamilyTask::VoiceCloning, nullptr},
    // community_models/kitten_tts2/session.cpp:161 strict, spec declares reference_text, :172-175
    // a clip needs its transcript, :194 24 kHz
    {"kitten_tts2",     false, true,  true,  24000, false, true,  true,  FamilyTask::Tts, nullptr},
    // models/miotts/session.cpp:570 Tts only, :700-703 clip mandatory; assets.cpp:45 samples;
    // include/engine/models/miocodec/assets.h:18 44.1 kHz
    {"miotts",          false, true,  false, 44100, true,  false, false, FamilyTask::Tts, nullptr},
    // community_models/lfm2_audio/session.cpp:447 strict, spec declares neither do_sample nor
    // reference_text, :461-463 refuses a clip; assets.cpp:317 24 kHz
    {"lfm2_audio",      false, false, false, 24000, false, true,  false, FamilyTask::Tts, nullptr},
};

// Collects every disagreement, so one run names each family and column that is off.
struct Audit {
    int wrong = 0;
    void text(const char *family, const std::string &what, const std::string &want, const std::string &got) {
        if (want == got) return;
        std::fprintf(stderr, "%s, %s: want \"%s\", got \"%s\"\n", family, what.c_str(), want.c_str(), got.c_str());
        ++wrong;
    }
    void flag(const char *family, const std::string &what, bool want, bool got) {
        text(family, what, want ? "true" : "false", got ? "true" : "false");
    }
};

std::string task_name(FamilyTask task) { return task == FamilyTask::Tts ? "Tts" : "VoiceCloning"; }
std::string mode_name(rt::RunMode mode) { return mode == rt::RunMode::Streaming ? "Streaming" : "Offline"; }
std::string text_or_null(const char *s) { return s ? s : "<null>"; }

void family_set_matches_the_table() {
    Audit a;
    std::set<std::string> listed;
    for (const ExpectedRow &e : kExpectedRows) {
        a.flag(e.name, "listed once in the table", true, listed.insert(e.name).second);
        a.flag(e.name, "has a kFamilies row", true, find_family(e.name) != nullptr);
    }
    for (const FamilyInfo &f : kFamilies)
        a.flag(f.name, "has a table entry", true, listed.count(f.name) != 0);
    a.text("kFamilies", "row count", std::to_string(std::size(kExpectedRows)), std::to_string(std::size(kFamilies)));
    assert(a.wrong == 0);
}

void row_columns_match_the_table() {
    Audit a;
    for (const ExpectedRow &e : kExpectedRows) {
        const FamilyInfo *f = find_family(e.name);
        if (!f) continue;   // family_set_matches_the_table names it
        a.flag(e.name, "streaming", e.streaming, f->streaming);
        a.flag(e.name, "clones", e.clones, f->clones);
        a.flag(e.name, "transcript_required", e.transcript_required, f->transcript_required);
        a.text(e.name, "default_rate", std::to_string(e.rate), std::to_string(f->default_rate));
        a.flag(e.name, "sample_decode", e.sample_decode, f->sample_decode);
        a.flag(e.name, "strict_options", e.strict, f->strict_options);
        a.flag(e.name, "strict_sends_ref_text", e.strict_sends_ref_text, f->strict_sends_ref_text);
        a.text(e.name, "task", task_name(e.task), task_name(f->task));
        a.text(e.name, "preset_option", text_or_null(e.preset_option), text_or_null(f->preset_option));
        // What sk_tts_load opens the session with follows the row.
        const rt::TaskSpec spec = task_spec_for(*f);
        a.text(e.name, "session task", task_name(e.task),
               spec.task == rt::VoiceTaskKind::VoiceCloning ? "VoiceCloning" : "Tts");
        a.text(e.name, "session mode", e.streaming ? "Streaming" : "Offline", mode_name(spec.mode));
    }
    assert(a.wrong == 0);
}

// A strict family is never sent do_sample; any other is sent it, true only for sample_decode.
void check_sampling(Audit &a, const ExpectedRow &e, const rt::TaskRequest &req, const char *when) {
    a.text(e.name, std::string(when) + ": do_sample", e.strict ? "<absent>" : (e.sample_decode ? "true" : "false"),
           opt(req, "do_sample"));
}

// max_tokens goes to outetts, fixed, and to higgs_audio_tts, scaled to the text ("Hello." is under
// its floor), whatever the voice; to no other family.
void check_max_tokens(Audit &a, const ExpectedRow &e, const rt::TaskRequest &req, const char *when) {
    const std::string name = e.name;
    a.text(e.name, std::string(when) + ": max_tokens",
           name == "outetts" ? "2048" : name == "higgs_audio_tts" ? "256" : "<absent>", opt(req, "max_tokens"));
}

// The app's "ko" reaches text_input as a name for the two families whose prompt is tagged with
// one, and as given for every other.
void check_text_language(Audit &a, const ExpectedRow &e, const sk_tts *h) {
    const std::string name = e.name;
    const rt::TaskRequest req = build_request(h, "Hello.", "ko", 1.0f);
    a.text(e.name, "bare: text language for ko",
           name == "qwen3_tts" ? "korean" : name == "moss_tts_local" ? "Korean" : "ko",
           req.text_input ? req.text_input->language : std::string("<no text_input>"));
}

void requests_honour_each_row() {
    constexpr const char *kTranscript = "The quick brown fox.";
    constexpr const char *kPreset = "Aria";
    Audit a;
    for (const ExpectedRow &e : kExpectedRows) {
        {
            const auto h = handle_for(e.name);
            const rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
            check_sampling(a, e, req, "bare");
            check_max_tokens(a, e, req, "bare");
            check_text_language(a, e, h.get());
            a.flag(e.name, "bare: voice", false, req.voice.has_value());
            a.flag(e.name, "bare: reference_text", false, has(req, "reference_text"));
            a.flag(e.name, "bare: reference_language", false, has(req, "reference_language"));
        }
        if (e.clones) {
            const auto h = handle_for(e.name);
            give_clip(h.get(), kTranscript);
            rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
            check_sampling(a, e, req, "clip");
            check_max_tokens(a, e, req, "clip");
            a.flag(e.name, "clip: carries the clip", true, carries_clip(req));
            a.text(e.name, "clip: cached_voice_id", "<none>", cached_voice(req));
            a.text(e.name, "clip: reference_text", !e.strict || e.strict_sends_ref_text ? kTranscript : "<absent>",
                   opt(req, "reference_text"));
            a.text(e.name, "clip: reference_language", std::strcmp(e.name, "outetts") == 0 ? "auto" : "<absent>",
                   opt(req, "reference_language"));
            give_clip(h.get(), "");
            req = build_request(h.get(), "Hello.", "en", 1.0f);
            a.flag(e.name, "clip without a transcript: reference_text", false, has(req, "reference_text"));
        }
        {
            const auto h = handle_for(e.name);
            give_preset(h.get(), kPreset);
            const rt::TaskRequest req = build_request(h.get(), "Hello.", "en", 1.0f);
            check_sampling(a, e, req, "preset");
            check_max_tokens(a, e, req, "preset");
            std::string carriers;   // the options whose value is the preset
            for (const auto &[key, value] : req.options)
                if (value == kPreset) carriers += (carriers.empty() ? "" : ",") + key;
            a.text(e.name, "preset: cached_voice_id", e.preset_option ? "<none>" : kPreset, cached_voice(req));
            a.text(e.name, "preset: options carrying it", e.preset_option ? e.preset_option : "", carriers);
            a.flag(e.name, "preset: reference_text", false, has(req, "reference_text"));
            a.flag(e.name, "preset: reference_language", false, has(req, "reference_language"));
        }
    }
    assert(a.wrong == 0);
}

}  // namespace

int main() {
    family_set_matches_the_table();
    row_columns_match_the_table();
    requests_honour_each_row();
    existing_rows_are_unchanged();
    task_column_picks_the_session_kind();
    adopt_family_copies_every_column();
    strict_family_gets_the_transcript_only_when_its_spec_declares_one();
    preset_reaches_the_engine_by_the_rows_route();
    existing_families_build_the_same_requests();
    load_language_is_kept_for_every_family_but_pocket_tts();
    load_language_replaces_the_callers_on_every_synth();
    omnivoice_takes_its_own_ids_for_arabic_and_nepali();
    qwen3_tts_takes_its_checkpoints_language_names();
    cosyvoice3_requests();
    fireredtts3_requests();
    language_names_match_the_vendors();
    moss_tts_local_requests();
    moss_tts_local_takes_the_vendors_names();
    vibevoice_requests();
    vibevoice_keeps_a_typed_speaker_label_as_text();
    vibevoice_breaks_a_line_at_a_bare_cr();
    chatterbox_requests();
    chatterbox_turbo_requests();
    confucius4_tts_requests();
    magpie_tts_requests();
    neutts_requests();
    kugelaudio_requests();
    higgs_audio_tts_requests();
    higgs_max_tokens_scales_with_the_text();
    higgs_runaway_text_is_the_pinned_sources();
    higgs_runaway_retries_with_the_next_seeds();
    fish_audio_requests();
    breeze_tts_requests();
    audio8_tts_row_columns();
    audio8_ja_reaches_the_model_as_yue();
    soprano_is_sent_only_the_seed();
    glm_tts_gets_the_clip_and_its_transcript();
    outetts_aligns_a_clip_in_one_language_whatever_the_target();
    outetts_gets_a_token_budget_that_fits_cjk();
    echo_tts_clones_in_a_voice_cloning_session_with_the_adaptive_window();
    kitten_tts2_speaks_a_language_through_its_named_voice();
    miotts_finds_its_codec_beside_the_model_folder();
    lfm2_audio_loads_its_package_directory_and_speaks_auto();
    std::puts("test_tts_request ok");
    return 0;
}
