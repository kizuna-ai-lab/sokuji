// sk_tts.cpp's family table and request building, checked without a model: this file
// compiles sk_tts.cpp straight in with SK_TTS_REQUEST_ONLY, which leaves out everything that
// needs the audio.cpp runtime or the library's own state. Plain asserts, like every native
// test here.
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <iterator>

#define SK_TTS_REQUEST_ONLY 1
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

    // qwen3_tts: any language becomes "auto" (R14(s4)); the transcript goes; greedy.
    const auto qwen3 = handle_for("qwen3_tts");
    give_clip(qwen3.get(), "The quick brown fox.");
    req = build_request(qwen3.get(), "Hello.", "en", 1.0f);
    assert(req.text_input && req.text_input->language == "auto");
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
    assert(req.text_input && req.text_input->language == "ar");

    const auto pocket = handle_for("pocket_tts", "english");
    req = build_request(pocket.get(), "Hello.", "en", 1.0f);
    assert(req.text_input && req.text_input->language == "en");

    // The family rules apply to whatever language the load left in force.
    const auto qwen3 = handle_for("qwen3_tts", "en");
    req = build_request(qwen3.get(), "Hello.", "zh", 1.0f);
    assert(req.text_input && req.text_input->language == "auto");
    const auto index = handle_for("index_tts2", "JA");
    req = build_request(index.get(), "Hello.", "en", 1.0f);
    assert(opt(req, "language") == "ja");
    const auto irodori = handle_for("irodori_tts", "en");
    req = build_request(irodori.get(), "Konnichiwa.", "en", 1.0f);
    assert(opt(req, "language") == "ja");
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
    // engine turns seed 0 into a random draw, so it alone is given a fixed nonzero seed.
    assert(opt(req, "reference_text") == "The quick brown fox.");
    assert(opt(req, "do_sample") == "true" && opt(req, "seed") == "1");
    const auto other = handle_for("moss_tts_local");
    assert(opt(build_request(other.get(), "Hello.", "en", 1.0f), "seed") == "0");
}

}  // namespace

int main() {
    existing_rows_are_unchanged();
    task_column_picks_the_session_kind();
    adopt_family_copies_every_column();
    strict_family_gets_the_transcript_only_when_its_spec_declares_one();
    preset_reaches_the_engine_by_the_rows_route();
    existing_families_build_the_same_requests();
    load_language_is_kept_for_every_family_but_pocket_tts();
    load_language_replaces_the_callers_on_every_synth();
    cosyvoice3_requests();
    fireredtts3_requests();
    language_names_match_the_vendors();
    moss_tts_local_requests();
    moss_tts_local_takes_the_vendors_names();
    vibevoice_requests();
    chatterbox_requests();
    std::puts("test_tts_request ok");
    return 0;
}
