// Slice-1 surface test. Plain asserts on purpose: no test framework to fetch.
#undef NDEBUG
#include <algorithm>
#include <cassert>
#include <cstdlib>
#include "sokuji_native.h"
#include "ggml.h"
#include <cstdio>
#include <cstring>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

static int g_log_calls = 0;
static bool log_sink(int, const char *, void *) { ++g_log_calls; return true; }

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    // argv[2], optional: the n_threads to request from sk_init. Two ctest cases share this
    // binary — "test_common" (explicit, default 3) and "test_common_threads_policy" (0) —
    // to exercise both branches of R32's thread policy without needing a second process
    // inside one already-idempotent sk_init.
    int requested_threads = argc > 2 ? std::atoi(argv[2]) : 3;

    assert(sk_abi_version() == SK_ABI_VERSION);
    assert(std::string(sk_version()) == "1.1.0");
    assert(std::strstr(sk_engine_versions(), "ggml=0.22.0") != nullptr);
    assert(std::strstr(sk_engine_versions(), "transcribe=0.2.3") != nullptr);
    assert(std::strstr(sk_engine_versions(), "llama=0.3.0;") != nullptr);   // normalised: no "v", no suffix
    assert(std::string(sk_last_error()).empty());

    sk_device before[8];
    assert(sk_devices(before, 8) == 0);                              // nothing before init
    uint64_t before_bytes = 0;                                       // pre-init, argument shape is irrelevant:
    assert(sk_device_free_mem(0, nullptr) == SK_ERR_NOT_INITIALISED);// the library is not initialised
    assert(sk_device_free_mem(0, &before_bytes) == SK_ERR_NOT_INITIALISED);
    sk_device_profile pre = {};
    assert(sk_device_profile_get(0, &pre) == SK_ERR_NOT_INITIALISED);
    assert(std::strstr(sk_last_error(), "sk_init") != nullptr);

    sk_init_options wrong = {};
    wrong.abi_version = SK_ABI_VERSION + 1;
    assert(sk_init(&wrong) == SK_ERR_INVALID_ARGUMENT);
    assert(std::strstr(sk_last_error(), "ABI") != nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = requested_threads;
    opts.module_dir = module_dir;
    opts.log = log_sink;
    assert(sk_init(&opts) == SK_OK);
    assert(sk_init(&opts) == SK_OK);                                 // idempotent

    // R32: n_threads > 0 is always honored verbatim; n_threads == 0 resolves to
    // min(hardware_concurrency, the measured knee) — see sk_common.cpp's kThreadKnee.
    int32_t threads = sk_threads();
    if (requested_threads > 0) {
        assert(threads == requested_threads);
    } else {
        constexpr int kThreadKnee = 12;   // keep in sync with sk_common.cpp's kThreadKnee
        unsigned hw = std::thread::hardware_concurrency();
        int expect = static_cast<int>(hw == 0 ? 1u : std::min(hw, static_cast<unsigned>(kThreadKnee)));
        assert(threads == expect);
    }

    sk_device devs[8];
    int n = sk_devices(devs, 8);
    assert(n >= 1);
    bool saw_cpu = false;
    for (int i = 0; i < n; ++i) {
        assert(devs[i].index == i);
        assert(devs[i].name[0] != '\0');
        if (devs[i].kind == SK_DEVICE_CPU) saw_cpu = true;
        assert(devs[i].mem_total > 0);                               // accelerators (0/0) are never listed
        uint64_t free_bytes = 0;
        assert(sk_device_free_mem(i, &free_bytes) == SK_OK);
        assert(free_bytes > 0);
    }
    assert(saw_cpu);

    // ABI 2: the profile call exists and rejects a bad index / NULL out-pointer.
    sk_device_profile prof = {};
    assert(sk_device_profile_get(-1, &prof) == SK_ERR_INVALID_ARGUMENT);
    assert(sk_device_profile_get(0, nullptr) == SK_ERR_INVALID_ARGUMENT);

    assert(sk_device_free_mem(n + 5, nullptr) == SK_ERR_INVALID_ARGUMENT);

    for (int i = 0; i < n; ++i) {
        sk_device_profile p = {};
        assert(sk_device_profile_get(i, &p) == SK_OK);
        assert(p.index == i);
        if (devs[i].kind == SK_DEVICE_CPU) {
            assert(p.known == 1);
            assert(p.cpu_features[0] != '\0');                                // ggml_backend_get_features reached
            assert(std::strlen(p.cpu_features) < sizeof p.cpu_features - 1);  // fits, not truncated
            assert(p.driver_name[0] == '\0');
        }
        if (devs[i].kind == SK_DEVICE_METAL) {
            assert(p.known == 1);
            assert(std::strcmp(p.driver_name, "Metal") == 0);
            assert(p.driver_version[0] != '\0');                              // kern.osversion
            assert(p.features & SK_FEAT_UMA);
            const bool paravirtual = std::strstr(devs[i].description, "aravirtual") != nullptr;
            if (paravirtual) {
                assert(!(p.features & SK_FEAT_MTL_SIMDGROUP_REDUCTION));       // the structured R36 signal
            } else {
                assert(p.features & SK_FEAT_MTL_SIMDGROUP_REDUCTION);
                assert(p.features & SK_FEAT_MTL_BFLOAT);
            }
        }
        if (devs[i].kind == SK_DEVICE_VULKAN && p.known) {                    // Task 3 makes known possible
            assert(std::strlen(p.device_uuid) == 32);
            assert(p.driver_name[0] != '\0');
        }
    }
    { sk_device_profile bad = {}; assert(sk_device_profile_get(n + 5, &bad) == SK_ERR_INVALID_ARGUMENT); }

    // Op coverage: every shipped recording, expanded over its own dtypes-in-file set, is fully
    // supported on the CPU device; error paths are the documented statuses.
    {
        const char *f16[] = {"f16", "f32"};
        // Ruling: sk_op_coverage is ~136 KB (SK_OP_COVERAGE_MAX == 2048); both instances below
        // are declared once at this scope and reused, never redeclared per loop iteration.
        // static: five such locals would otherwise sit in this one function's frame at once,
        // ~680 KB total — over win-x64's 1 MB default thread stack.
        static sk_op_coverage cov = {};
        assert(sk_device_supports_ops(-1, "tts", "supertonic", f16, 2, &cov) == SK_ERR_INVALID_ARGUMENT);
        assert(sk_device_supports_ops(0, "tts", "no-such-family", f16, 2, &cov) == SK_ERR_NOT_FOUND);
        assert(sk_device_supports_ops(0, "tts", "supertonic", f16, 0, &cov) == SK_ERR_INVALID_ARGUMENT);
        const char *bad[] = {"q9_9"};
        assert(sk_device_supports_ops(0, "tts", "supertonic", bad, 1, &cov) == SK_ERR_INVALID_ARGUMENT);
        int cpu_index = -1;
        for (int i = 0; i < n; ++i) if (devs[i].kind == SK_DEVICE_CPU) cpu_index = i;
        int n_tts = 0;
        static sk_op_coverage c = {};
        for (int b = 0; b < sk_ops_blob_count(); ++b) {
            const char *stage = nullptr, *family = nullptr, *text = nullptr;
            sk_ops_blob_at(b, &stage, &family, &text);
            // the dtypes-in-file line: "# dtypes-in-file: a b c"
            std::string t(text);
            if (std::string(stage) == "tts") assert(t.find("WEIGHT") != std::string::npos);   // the leaf rule fired for this family
            auto pos = t.find("# dtypes-in-file:");
            assert(pos != std::string::npos);
            std::string line = t.substr(pos + 17, t.find('\n', pos) - pos - 17);
            std::vector<std::string> dts; std::string tok; std::istringstream ss(line);
            while (ss >> tok) dts.push_back(tok);
            std::vector<const char *> ptrs; for (auto &s : dts) ptrs.push_back(s.c_str());
            c = {};
            assert(sk_device_supports_ops(cpu_index, stage, family, ptrs.data(), (int32_t)ptrs.size(), &c) == SK_OK);
            assert(c.n_ops > 0 && c.n_ops <= SK_OP_COVERAGE_MAX);
            for (int i = 0; i < c.n_ops; ++i) if (!c.ops[i].supported) std::fprintf(stderr, "%s/%s unsupported on cpu: %s\n", stage, family, c.ops[i].name);
            assert(c.all_supported == 1);
            // Fix round 2 (C1), device-independent so every lane guards it: a WEIGHT node is the
            // src0 of a MUL_MAT/MUL_MAT_ID/GET_ROWS and can only hold a float or a quantized
            // type, so the integer index-table dtypes a header also lists must be skipped before
            // expansion. Asking with the raw set and with the integers removed must therefore
            // produce the SAME expansion. (The CPU device accepts integer MUL_MAT, which is why
            // this equality — not all_supported — is what catches the regression here; on Vulkan
            // the same defect refuses the whole family, see the GPU sweep below.)
            {
                std::vector<const char *> no_int;
                for (auto &s : dts)
                    if (s != "i8" && s != "i16" && s != "i32" && s != "i64" && s != "f64") no_int.push_back(s.c_str());
                assert(!no_int.empty());
                static sk_op_coverage cf = {};
                cf = {};
                assert(sk_device_supports_ops(cpu_index, stage, family, no_int.data(), (int32_t)no_int.size(), &cf) == SK_OK);
                assert(cf.n_ops == c.n_ops && cf.all_supported == c.all_supported);
            }
            if (std::string(stage) == "tts") ++n_tts;
        }
        assert(n_tts == 9);

        // Fix round 1: a WEIGHT dtype whose block size does not divide the recorded ne0_src0
        // must be skipped, not asked (no GGUF can hold that tensor in it) — compute the
        // expected n_ops straight from tts/index_tts2's own baked text (it has WEIGHT rows
        // that are not 256-aligned, and at least one not even 32-aligned) and check it
        // against the real call. Plain string parsing, as the fix instructs: "src=[WEIGHT"
        // marks a weight line, "ne0=[<a>," gives its recorded ne0_src0.
        {
            const char *stage = nullptr, *family = nullptr, *text = nullptr;
            for (int b = 0; b < sk_ops_blob_count(); ++b) {
                sk_ops_blob_at(b, &stage, &family, &text);
                if (std::string(stage) == "tts" && std::string(family) == "index_tts2") break;
            }
            assert(std::string(family) == "index_tts2");
            std::string t(text);
            const ggml_type check_types[] = {GGML_TYPE_Q4_K, GGML_TYPE_Q8_0, GGML_TYPE_F32};
            int expected = 0, weight_lines_256 = 0;
            std::istringstream lines(t);
            std::string line;
            while (std::getline(lines, line)) {
                if (line.rfind("op=", 0) != 0) continue;
                const bool is_weight = line.find("src=[WEIGHT") != std::string::npos;
                auto pos = line.find("ne0=[");
                assert(pos != std::string::npos);
                const long long a = std::atoll(line.c_str() + pos + 5);
                if (is_weight) {
                    int aligned = 0;
                    for (ggml_type ty : check_types) if (a % ggml_blck_size(ty) == 0) ++aligned;
                    expected += aligned;
                    if (a % 256 == 0) ++weight_lines_256;
                } else {
                    expected += 1;
                }
            }
            const char *dts3[] = {"q4_K", "q8_0", "f32"};
            c = {};
            assert(sk_device_supports_ops(cpu_index, "tts", "index_tts2", dts3, 3, &c) == SK_OK);
            std::fprintf(stderr, "test_common: tts/index_tts2 q4_K/q8_0/f32 on cpu: expected=%d actual n_ops=%d\n", expected, c.n_ops);
            assert(c.n_ops == expected);
            assert(c.all_supported == 1);
            int q4k_names = 0;
            for (int i = 0; i < c.n_ops; ++i) if (std::strstr(c.ops[i].name, "[q4_K,") != nullptr) ++q4k_names;
            assert(q4k_names == weight_lines_256);

            // A duplicate in weight_dtypes must not double the expansion.
            const char *dup[] = {"q8_0", "q8_0", "f32"};
            const char *nodup[] = {"q8_0", "f32"};
            static sk_op_coverage cd = {}, cn = {};
            assert(sk_device_supports_ops(cpu_index, "tts", "index_tts2", dup, 3, &cd) == SK_OK);
            assert(sk_device_supports_ops(cpu_index, "tts", "index_tts2", nodup, 2, &cn) == SK_OK);
            assert(cd.n_ops == cn.n_ops);
        }
    }

    // Fix round 2 addendum: the block-size skip, the integer-dtype skip and the ask()/grow()
    // rebuild must also work on a real GPU device — the CPU lane cannot exercise any of it, so
    // this block is a no-op there (no Vulkan/Metal device present) and only bites on those
    // lanes. EVERY tts recording is swept with its OWN "# dtypes-in-file" set, the same text
    // the CPU sweep above parses: that is the set the sidecar's post-download query sends
    // (accel.weight_dtypes reads the header), so a set a GPU refuses here is a family the
    // planner refuses in production. Round 1 hard-coded {f16,f32} for supertonic alone and so
    // proved nothing about the real sets — every family holds i32/i64 index tables, and ggml's
    // Vulkan backend refuses to MUL_MAT those.
    //
    // Every one of the nine families is asserted: all nine synthesise on this fleet's real GPUs,
    // so all_supported == 1 is the ground truth and there is no may-refuse list. Round 2 removed
    // the two exceptions round 1 had to carry, by fixing what produced them:
    //   * pocket_tts refused CONV_TRANSPOSE_1D[f16,f32] and CPY[bf16,f16] because the recording
    //     was taken with the model on the CPU — audio.cpp keeps f16 conv kernels and casts
    //     bf16 -> f16 on a HOST backend but casts to f32 on a device one, so those spellings are
    //     the host graph and no GPU is ever asked them. Recorded on the device they are
    //     CONV_TRANSPOSE_1D[f32,f32], which ggml-vulkan accepts.
    //   * irodori_tts refused ROPE.mode0[f32,i32] because one contiguity bool per source made
    //     ask() rebuild every non-contiguous tensor as a transpose, breaking the row contiguity
    //     ggml-vulkan's ROPE requires. Exact layout descriptors rebuild it as the permute it is.
    // CI's own Metal runner is still excluded: a paravirtual device legitimately refuses ops
    // (the same R36 signal already used in the profile assertions above).
    {
        static sk_op_coverage c = {};
        for (int i = 0; i < n; ++i) {
            if (devs[i].kind != SK_DEVICE_VULKAN && devs[i].kind != SK_DEVICE_METAL) continue;
            const bool paravirtual = std::strstr(devs[i].description, "aravirtual") != nullptr;
            int n_swept = 0;
            for (int b = 0; b < sk_ops_blob_count(); ++b) {
                const char *stage = nullptr, *family = nullptr, *text = nullptr;
                sk_ops_blob_at(b, &stage, &family, &text);
                if (std::string(stage) != "tts") continue;
                std::string t(text);
                auto pos = t.find("# dtypes-in-file:");
                assert(pos != std::string::npos);
                std::string line = t.substr(pos + 17, t.find('\n', pos) - pos - 17);
                std::vector<std::string> dts; std::string tok; std::istringstream ss(line);
                while (ss >> tok) dts.push_back(tok);
                std::vector<const char *> ptrs; for (auto &s : dts) ptrs.push_back(s.c_str());
                c = {};
                assert(sk_device_supports_ops(i, stage, family, ptrs.data(), (int32_t)ptrs.size(), &c) == SK_OK);
                assert(c.n_ops > 0 && c.n_ops <= SK_OP_COVERAGE_MAX);
                if (!c.all_supported)
                    for (int j = 0; j < c.n_ops; ++j)
                        if (!c.ops[j].supported)
                            std::fprintf(stderr, "tts/%s unsupported on device %d (%s): %s\n", family, i, devs[i].description, c.ops[j].name);
                std::fprintf(stderr, "test_common: tts/%s [%s] n_ops=%d all_supported=%d on device %d (%s)\n",
                             family, line.c_str(), c.n_ops, c.all_supported, i, devs[i].description);
                if (!paravirtual) assert(c.all_supported == 1);
                ++n_swept;
            }
            assert(n_swept == 9);
        }
    }

    char *buf = static_cast<char *>(std::malloc(4));
    sk_free(buf);                                                     // must accept malloc'd memory
    sk_free(nullptr);                                                 // and null

    assert(std::strstr(sk_engine_versions(), "audiocpp=0.7.1") != nullptr);
    const char *fams[32];
    int nf = sk_audio_families(fams, 32);
    assert(nf >= 10);                                                 // may include companion families too
    const char *want[] = {"index_tts2", "irodori_tts", "moss_tts_nano", "omnivoice", "pocket_tts",
                          "qwen3_tts", "silero_vad", "supertonic", "voxcpm1", "voxcpm2"};
    for (const char *w : want) {
        bool found = false;
        for (int i = 0; i < nf; ++i) if (std::strcmp(fams[i], w) == 0) found = true;
        assert(found);
    }
    for (int i = 1; i < nf; ++i) assert(std::strcmp(fams[i - 1], fams[i]) < 0);   // sorted, no duplicates

    std::string family_list;
    for (int i = 0; i < nf; ++i) { if (i) family_list += ","; family_list += fams[i]; }
    std::printf("test_common: %d devices, %d log lines, %d audio families [%s]\n",
                n, g_log_calls, nf, family_list.c_str());
    return 0;
}
