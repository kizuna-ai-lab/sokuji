/* The shipped op recordings equal what the engines do TODAY: re-record every family whose
 * model is present and diff. rc 77 only when no model at all is present; otherwise each
 * present family is asserted and each absent one prints SKIPPED. Runs against the
 * SK_RECORD_OPS build (build/record), never the shipping one. The recording device is
 * registered ONCE before the single sk_init (first call wins). */
#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include "record_common.h"
#include "sk_ops.h"

struct Case { const char *stage, *family, *env; };
static const Case CASES[] = {
    {"tts", "moss_tts_nano", "SK_TEST_TTS_MOSS_DIR"},     {"tts", "supertonic", "SK_TEST_TTS_SUPERTONIC_DIR"},
    {"tts", "qwen3_tts", "SK_TEST_TTS_QWEN3_DIR"},        {"tts", "omnivoice", "SK_TEST_TTS_OMNIVOICE_DIR"},
    {"tts", "pocket_tts", "SK_TEST_TTS_POCKET_DIR"},      {"tts", "voxcpm1", "SK_TEST_TTS_VOXCPM1_DIR"},
    {"tts", "voxcpm2", "SK_TEST_TTS_VOXCPM2_DIR"},        {"tts", "irodori_tts", "SK_TEST_TTS_IRODORI_DIR"},
    {"tts", "index_tts2", "SK_TEST_TTS_INDEX_DIR"},
    {"asr", "whisper", "SK_TEST_ASR_GGUF"},               {"asr", "moonshine_streaming", "SK_TEST_ASR_STREAM_GGUF"},
    {"translate", "qwen3", "SK_TEST_TRANSLATE_GGUF"},
};

static std::set<std::string> spellings(const sk_op_recording &r) {
    std::set<std::string> s;
    for (const auto &d : r.nodes) s.insert(sk_op_spelling(d, nullptr) + " ne0=" + std::to_string(d.ne0_src0));
    return s;
}
static bool read_file(const std::string &p, std::string &out) {
    std::ifstream f(p); if (!f) return false; std::stringstream ss; ss << f.rdbuf(); out = ss.str(); return true;
}

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    const char *supertonic = std::getenv("SK_TEST_TTS_SUPERTONIC_DIR");
    int present = 0, failures = 0;
    for (const Case &c : CASES) if (std::getenv(c.env) && *std::getenv(c.env)) ++present;
    if (present == 0) { std::printf("test_ops_coverage: no models present, skipping\n"); return 77; }
    if (!supertonic) { std::printf("test_ops_coverage: SK_TEST_TTS_SUPERTONIC_DIR is required (reference clip)\n"); return 1; }

    sk_record_register_device();
    sk_init_options opts = {}; opts.abi_version = SK_ABI_VERSION; opts.n_threads = 4; opts.module_dir = module_dir;
    assert(sk_init(&opts) == SK_OK);
    sk_device devs[16]; const int n = sk_devices(devs, 16);
    const sk_device *cpu = nullptr, *rec = nullptr;
    for (int i = 0; i < n; ++i) { if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i]; if (std::strcmp(devs[i].name, "SKREC0") == 0) rec = &devs[i]; }
    assert(cpu && rec);

    for (const Case &c : CASES) {
        const char *model = std::getenv(c.env);
        if (!model || !*model) { std::printf("SKIPPED: %s/%s (%s unset)\n", c.stage, c.family, c.env); continue; }
        const char *stage = nullptr, *family = nullptr, *text = nullptr; bool found = false;
        for (int b = 0; b < sk_ops_blob_count(); ++b) {
            sk_ops_blob_at(b, &stage, &family, &text);
            if (std::string(stage) == c.stage && std::string(family) == c.family) { found = true; break; }
        }
        if (!found) { std::printf("FAIL: %s/%s has a model but no shipped recording\n", c.stage, c.family); ++failures; continue; }
        sk_op_recording shipped; std::string err;
        assert(sk_ops_parse(text, shipped, err));
        const std::string tmp = std::string("/tmp/sk-live-") + c.stage + "-" + c.family + ".ops";
        const sk_device *dev = std::string(c.stage) == "tts" ? cpu : rec;
        int count = record_family(c.stage, c.family, model, dev, tmp, 1, supertonic);
        if (std::string(c.stage) == "translate") {
            const std::string tmp2 = tmp + ".off";
            record_family(c.stage, c.family, model, dev, tmp2, 2, supertonic);
            std::string a, b; read_file(tmp, a); read_file(tmp2, b);
            for (const auto &line : {b}) { std::istringstream ls(line); std::string l; while (std::getline(ls, l)) if (l.rfind("op=", 0) == 0) a += l + "\n"; }
            std::ofstream(tmp) << a;
        }
        if (count <= 0) { std::printf("FAIL %s/%s: recorded nothing\n", c.stage, c.family); ++failures; continue; }
        std::string live_text; read_file(tmp, live_text);
        sk_op_recording live; assert(sk_ops_parse(live_text, live, err));
        const auto a = spellings(shipped), bset = spellings(live);
        int before = failures;
        for (const auto &s : bset) if (!a.count(s)) { std::printf("FAIL %s/%s: engine now uses %s (not in shipped recording)\n", c.stage, c.family, s.c_str()); ++failures; }
        for (const auto &s : a) if (!bset.count(s)) { std::printf("FAIL %s/%s: shipped recording lists %s (engine no longer uses it)\n", c.stage, c.family, s.c_str()); ++failures; }
        if (shipped.dtypes_in_file != live.dtypes_in_file) { std::printf("FAIL %s/%s: dtypes-in-file changed (upstream re-quantised?)\n", c.stage, c.family); ++failures; }
        std::printf("%s/%s: %zu nodes, %s\n", c.stage, c.family, live.nodes.size(), failures == before ? "ok" : "DIFF");
    }
    return failures ? 1 : 0;
}
