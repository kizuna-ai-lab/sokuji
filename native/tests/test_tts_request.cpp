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

std::unique_ptr<sk_tts> handle_from(const FamilyInfo &info) {
    auto h = std::make_unique<sk_tts>();
    adopt_family(h.get(), info);
    return h;
}

std::unique_ptr<sk_tts> handle_for(const char *family) {
    const FamilyInfo *info = find_family(family);
    assert(info != nullptr);
    return handle_from(*info);
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

}  // namespace

int main() {
    existing_rows_are_unchanged();
    task_column_picks_the_session_kind();
    adopt_family_copies_every_column();
    strict_family_gets_the_transcript_only_when_its_spec_declares_one();
    preset_reaches_the_engine_by_the_rows_route();
    existing_families_build_the_same_requests();
    std::puts("test_tts_request ok");
    return 0;
}
