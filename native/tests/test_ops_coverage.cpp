/* The shipped op recordings equal what the engines do TODAY: re-record every family whose
 * model is present and diff. rc 77 only when no model at all is present; otherwise each
 * present family is asserted and each absent one prints SKIPPED. Runs against the
 * SK_RECORD_OPS build (build/record), never the shipping one. The recording device is
 * registered ONCE before the single sk_init (first call wins). */
#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>
#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif
#include "record_common.h"
#include "sk_ops.h"

/* Fix round 1: scratch files carry the pid so two concurrent test_ops_coverage runs on the
 * same host (e.g. two build/record-configured ctest invocations) never interleave writes to
 * the same path — a race that would otherwise look like a real op-graph regression. */
static long sk_getpid() {
#if defined(_WIN32)
    return _getpid();
#else
    return static_cast<long>(getpid());
#endif
}
static std::filesystem::path sk_scratch_dir() {
    if (const char *d = std::getenv("SK_TEST_SCRATCH_DIR"); d && *d) return std::filesystem::path(d);
    return std::filesystem::temp_directory_path();
}
/* Removes its tracked paths when the per-case scope ends (including every early `continue`),
 * so a failed or aborted case never leaves scratch files behind. */
struct ScratchFiles {
    std::vector<std::string> paths;
    ~ScratchFiles() { for (const auto &p : paths) { std::error_code ec; std::filesystem::remove(p, ec); } }
};

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
    // host= is part of the compared key: which side of audio.cpp's host/device split a node
    // came from is exactly what a backend-type refactor upstream would move, and moving it
    // silently would change what the coverage gate refuses.
    for (const auto &d : r.nodes)
        s.insert(sk_op_spelling(d, nullptr) + " ne0=" + std::to_string(d.ne0_src0) + " host=" + std::to_string(d.host ? 1 : 0));
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
    /* F2: a tts recording is only meaningful on a real non-host device — audio.cpp builds a
     * different graph on a host backend, so re-recording on CPU and diffing against a
     * device recording would report the backend difference as engine drift. A CPU-only
     * build (every CI lane without a GPU) therefore SKIPS the tts families outright; it still
     * gates asr/translate, which record on the fake device and are backend-agnostic. */
    const sk_device *tts_dev = tts_record_device(devs, n);
    if (!tts_dev) std::printf("test_ops_coverage: no non-CPU device — tts families will be skipped\n");

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
        /* Checked on EVERY box, before the device skip below: a shipped tts recording taken on
         * a host backend is the F2 defect itself, and it is readable from the file alone. Behind
         * the skip it would be unreachable on exactly the CPU-only machines most likely to have
         * produced it. */
        if (std::string(c.stage) == "tts" && (shipped.recorded_on.empty() || shipped.recorded_on == "cpu")) {
            std::printf("FAIL %s/%s: shipped recording is '# recorded-on: %s' — tts must be recorded on a device\n",
                        c.stage, c.family, shipped.recorded_on.empty() ? "(missing)" : shipped.recorded_on.c_str());
            ++failures;
        }
        // Re-recording a tts family is only meaningful on a real device; the comparison stops here.
        if (std::string(c.stage) == "tts" && !tts_dev) { std::printf("SKIPPED (no device): %s/%s\n", c.stage, c.family); continue; }
        const std::string tmp = (sk_scratch_dir() / ("sk-live-" + std::to_string(sk_getpid()) + "-" + c.stage + "-" + c.family + ".ops")).string();
        ScratchFiles scratch; scratch.paths.push_back(tmp);
        const sk_device *dev = std::string(c.stage) == "tts" ? tts_dev : rec;
        int count = record_family(c.stage, c.family, model, dev, tmp, 1, supertonic);
        if (std::string(c.stage) == "translate") {
            const std::string tmp2 = tmp + ".off";
            scratch.paths.push_back(tmp2);
            int count2 = record_family(c.stage, c.family, model, dev, tmp2, 2, supertonic);
            if (count2 <= 0) { std::printf("FAIL %s/%s: flash-attention-off recording failed\n", c.stage, c.family); ++failures; continue; }
            std::string a, b; read_file(tmp, a); read_file(tmp2, b);
            std::istringstream ls(b); std::string l; while (std::getline(ls, l)) if (l.rfind("op=", 0) == 0) a += l + "\n";
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
