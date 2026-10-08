/* The recorder refuses a recording whose WEIGHT sources hold a dtype the passed
 * `# dtypes-in-file` set lacks (owner's ruling 2026-10-06, op-coverage precision): WEIGHT is
 * expanded over that set only, so a dtype outside it would never be asked of a device. Driven
 * through the recording device with a hand-built graph, no model: a 1-D q8_0 head (the shape of
 * pocket_tts's out_eos and irodori_tts's token_out_proj) read by MUL_MAT, and an i32 table read
 * by GET_ROWS, which the expansion skips and the set therefore need not hold. Then a model
 * directory with a companion GGUF beside the main one: its set is the union of both files'
 * matrix dtypes, so a WEIGHT read from the companion is accepted; the same holds for a companion
 * a family loads from a sibling of the model's folder (miotts's codec). Last, the set is taken as the
 * device that ran the WEIGHT loads it: audio.cpp loads a bf16 weight as f16 on Vulkan and Metal,
 * so for a tts recording on those a live f16 is covered by the file's bf16 and a live bf16 is
 * not covered at all, unless the family has a raw-typed device weight path, which keeps bf16
 * and so is covered both ways. A host WEIGHT ran on the CPU and is held against the file's set
 * as it stands; so is everything on cpu, and for asr and translate. A tts WEIGHT may also be f32
 * whatever the file holds, since audio.cpp derives some weights as F32 at load, so a live f32 is
 * covered on every tts device; asr and translate get no such f32. Runs in the SOKUJI_RECORD_OPS
 * configure only, like record_ops. */
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <set>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "ggml.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"
#include "gguf.h"
#include "model_tensors.h"

/* A one-tensor GGUF with zeroed data. */
static void write_gguf(const std::string &path, const char *name, ggml_type type, int64_t ne0, int64_t ne1) {
    ggml_init_params ip = {ggml_tensor_overhead() + ggml_row_size(type, ne0) * ne1 + 256, nullptr, /*no_alloc*/ false};
    ggml_context *ctx = ggml_init(ip);
    ggml_tensor *t = ggml_new_tensor_2d(ctx, type, ne0, ne1);
    ggml_set_name(t, name);
    std::memset(t->data, 0, ggml_nbytes(t));
    gguf_context *g = gguf_init_empty();
    gguf_set_val_str(g, "general.architecture", "test");
    gguf_add_tensor(g, t);
    assert(gguf_write_to_file(g, path.c_str(), /*only_meta*/ false));
    gguf_free(g);
    ggml_free(ctx);
}

/* Records MUL_MAT(main.w, x) and MUL_MAT(codec.w, x) with `names` as the file's tensors. */
static void record_main_and_codec(ggml_backend_dev_t dev, ggml_backend_t rec, const std::vector<std::string> &names) {
    ggml_init_params ip = {16 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, /*no_alloc*/ true};
    ggml_context *ctx = ggml_init(ip);
    ggml_tensor *main_w = ggml_new_tensor_2d(ctx, GGML_TYPE_Q8_0, 32, 64);
    ggml_set_name(main_w, "main.w");
    ggml_tensor *codec_w = ggml_new_tensor_2d(ctx, GGML_TYPE_F16, 32, 4);
    ggml_set_name(codec_w, "codec.w");
    ggml_tensor *x = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, 32, 2);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, ggml_mul_mat(ctx, main_w, x));
    ggml_build_forward_expand(gf, ggml_mul_mat(ctx, codec_w, x));
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx, ggml_backend_dev_buffer_type(dev));
    assert(buf);
    ggml_backend_buffer_clear(buf, 0);
    std::vector<const char *> ptrs;
    for (const auto &s : names) ptrs.push_back(s.c_str());
    const char *rung_ops[] = {"MUL_MAT", "MUL_MAT_ID", "GET_ROWS"};
    sk_record_begin(ptrs.data(), (int32_t)ptrs.size(), rung_ops, 3);
    assert(ggml_backend_graph_compute(rec, gf) == GGML_STATUS_SUCCESS);
    assert(sk_record_node_count() == 2);
    ggml_backend_buffer_free(buf);
    ggml_free(ctx);
}

/* Records MUL_MAT(w, x) with the file tensor `w` live in `type`. On `backend` through the
 * recording device a node is a device node; through sk_record_compute_graph on a CPU backend it
 * is tagged host, as audio.cpp's host-pinned subgraphs are. */
static void record_weight(ggml_backend_dev_t dev, ggml_backend_t backend, bool host, ggml_type type) {
    ggml_init_params ip = {8 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, /*no_alloc*/ true};
    ggml_context *ctx = ggml_init(ip);
    ggml_tensor *w = ggml_new_tensor_2d(ctx, type, 32, 4);
    ggml_set_name(w, "w");
    ggml_tensor *x = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, 32, 2);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, ggml_mul_mat(ctx, w, x));
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx, ggml_backend_dev_buffer_type(dev));
    assert(buf);
    ggml_backend_buffer_clear(buf, 0);
    const char *names[] = {"w"};
    const char *rung_ops[] = {"MUL_MAT", "MUL_MAT_ID", "GET_ROWS"};
    sk_record_begin(names, 1, rung_ops, 3);
    if (host) assert(sk_record_compute_graph(backend, gf) == GGML_STATUS_SUCCESS);
    else      assert(ggml_backend_graph_compute(backend, gf) == GGML_STATUS_SUCCESS);
    assert(sk_record_node_count() == 1);
    ggml_backend_buffer_free(buf);
    ggml_free(ctx);
}

int main(int argc, char **argv) {
    sk_record_register_device();                                   // BEFORE sk_init: first call wins
    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION; opts.n_threads = 1; opts.module_dir = argc > 1 ? argv[1] : ".";
    assert(sk_init(&opts) == SK_OK);
    ggml_backend_dev_t dev = ggml_backend_dev_by_name("SKREC0");
    assert(dev);
    ggml_backend_t rec = ggml_backend_dev_init(dev, nullptr);
    assert(rec);

    ggml_init_params ip = {16 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, /*no_alloc*/ true};
    ggml_context *ctx = ggml_init(ip);
    ggml_tensor *head = ggml_new_tensor_1d(ctx, GGML_TYPE_Q8_0, 32);
    ggml_set_name(head, "head.weight");
    ggml_tensor *table = ggml_new_tensor_2d(ctx, GGML_TYPE_I32, 4, 8);
    ggml_set_name(table, "table");
    ggml_tensor *x = ggml_new_tensor_2d(ctx, GGML_TYPE_F32, 32, 2);
    ggml_tensor *idx = ggml_new_tensor_1d(ctx, GGML_TYPE_I32, 2);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, ggml_mul_mat(ctx, head, x));
    ggml_build_forward_expand(gf, ggml_get_rows(ctx, table, idx));
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx, ggml_backend_dev_buffer_type(dev));
    assert(buf);
    ggml_backend_buffer_clear(buf, 0);                             // row 0, zero scales: any values do

    const char *names[] = {"head.weight", "table"};                // the "file's" tensors
    const char *rung_ops[] = {"MUL_MAT", "MUL_MAT_ID", "GET_ROWS"};
    sk_record_begin(names, 2, rung_ops, 3);
    assert(ggml_backend_graph_compute(rec, gf) == GGML_STATUS_SUCCESS);
    assert(sk_record_node_count() == 2);

    const std::string out = "sk-record-guard.ops";
    std::filesystem::remove(out);

    // The head's q8_0 is missing from the set: refused, naming the family and the dtype, and
    // nothing is written. The i32 table is not named: the expansion never asks an integer dtype.
    const char *no_q8[] = {"f16", "f32"};
    assert(sk_record_end_to_file(out.c_str(), "tts", "guard_family", "x.gguf", "vulkan", no_q8, 2) == SK_ERR_INVALID_ARGUMENT);
    const std::string err = sk_last_error();
    std::fprintf(stderr, "test_record_guard: refused as expected: %s\n", err.c_str());
    assert(err.find("tts/guard_family") != std::string::npos);
    assert(err.find("q8_0") != std::string::npos);
    assert(err.find("i32") == std::string::npos);
    assert(!std::filesystem::exists(out));

    // The same recording, still in memory, with the head's dtype in the set: written.
    const char *with_q8[] = {"q8_0", "f32"};
    assert(sk_record_end_to_file(out.c_str(), "tts", "guard_family", "x.gguf", "vulkan", with_q8, 2) == SK_OK);
    assert(std::filesystem::exists(out));
    std::filesystem::remove(out);

    // A new recording starts with none of the last one's WEIGHT dtypes.
    sk_record_begin(names, 2, rung_ops, 3);
    const char *only_f32[] = {"f32"};
    assert(sk_record_end_to_file(out.c_str(), "tts", "guard_family", "x.gguf", "vulkan", only_f32, 1) == SK_OK);
    std::filesystem::remove(out);

    ggml_backend_buffer_free(buf);
    ggml_free(ctx);

    // A model directory as the test cache stages one: a q8_0 main GGUF and an f16 companion
    // beside it. Its set is both files' matrix dtypes, and its names both files'
    // tensors; the main file alone has neither the f16 nor the codec's name.
    namespace fs = std::filesystem;
    const fs::path dir = "sk-record-guard-model";
    fs::remove_all(dir);
    fs::create_directories(dir);
    write_gguf((dir / "model-q8_0.gguf").string(), "main.w", GGML_TYPE_Q8_0, 32, 64);
    write_gguf((dir / "codec-f16.gguf").string(), "codec.w", GGML_TYPE_F16, 32, 4);
    std::vector<std::string> dir_names, file_names;
    std::set<std::string> dir_dtypes, file_dtypes;
    assert(model_tensors(dir.string(), dir_names, dir_dtypes));
    assert((dir_dtypes == std::set<std::string>{"f16", "q8_0"}));
    assert((std::set<std::string>(dir_names.begin(), dir_names.end()) == std::set<std::string>{"codec.w", "main.w"}));
    assert(model_tensors((dir / "model-q8_0.gguf").string(), file_names, file_dtypes));
    assert((file_dtypes == std::set<std::string>{"q8_0"}));

    // The main file's set alone refuses the codec's f16 WEIGHT; the directory's union accepts it.
    record_main_and_codec(dev, rec, dir_names);
    std::vector<const char *> main_only;
    for (const auto &s : file_dtypes) main_only.push_back(s.c_str());
    assert(sk_record_end_to_file(out.c_str(), "tts", "guard_family", "model-q8_0.gguf", "vulkan",
                                 main_only.data(), (int32_t)main_only.size()) == SK_ERR_INVALID_ARGUMENT);
    assert(std::string(sk_last_error()).find("f16") != std::string::npos);
    std::vector<const char *> both;
    for (const auto &s : dir_dtypes) both.push_back(s.c_str());
    assert(sk_record_end_to_file(out.c_str(), "tts", "guard_family", "model-q8_0.gguf", "vulkan",
                                 both.data(), (int32_t)both.size()) == SK_OK);
    std::filesystem::remove(out);
    fs::remove_all(dir);

    // MioTTS's layout: its codec is staged in a sibling of the model's folder, where sk_tts_load
    // points the family at it (sk_tts_companions.h). A miotts recording's set and names take the
    // codec in through that same helper; the model's folder alone holds neither.
    const fs::path card = "sk-record-guard-miotts";
    fs::remove_all(card);
    fs::create_directories(card / "MioTTS-1.7B-GGUF");
    fs::create_directories(card / "MioCodec-25Hz-44.1kHz-v2-GGUF");
    const std::string lm_dir = (card / "MioTTS-1.7B-GGUF").string();
    const fs::path codec_file = card / "MioCodec-25Hz-44.1kHz-v2-GGUF" / "miocodec-25hz-44khz-v2-q8_0.gguf";
    write_gguf((card / "MioTTS-1.7B-GGUF" / "miotts-1.7b-q8_0.gguf").string(), "main.w", GGML_TYPE_Q8_0, 32, 64);
    write_gguf(codec_file.string(), "codec.w", GGML_TYPE_F16, 32, 4);
    std::vector<std::string> mio_names, lm_names;
    std::set<std::string> mio_dtypes, lm_dtypes;
    assert(tts_model_tensors("miotts", lm_dir, mio_names, mio_dtypes));
    assert((mio_dtypes == std::set<std::string>{"f16", "q8_0"}));
    assert((std::set<std::string>(mio_names.begin(), mio_names.end()) == std::set<std::string>{"codec.w", "main.w"}));
    assert(tts_model_tensors("audio8_tts", lm_dir, lm_names, lm_dtypes));   // no companion elsewhere
    assert((lm_dtypes == std::set<std::string>{"q8_0"}));
    record_main_and_codec(dev, rec, mio_names);
    std::vector<const char *> lm_only, mio_set;
    for (const auto &s : lm_dtypes) lm_only.push_back(s.c_str());
    for (const auto &s : mio_dtypes) mio_set.push_back(s.c_str());
    assert(sk_record_end_to_file(out.c_str(), "tts", "miotts", "miotts-1.7b-q8_0.gguf", "vulkan",
                                 lm_only.data(), (int32_t)lm_only.size()) == SK_ERR_INVALID_ARGUMENT);
    assert(sk_record_end_to_file(out.c_str(), "tts", "miotts", "miotts-1.7b-q8_0.gguf", "vulkan",
                                 mio_set.data(), (int32_t)mio_set.size()) == SK_OK);
    std::filesystem::remove(out);
    // A codec that is not there fails the read, as it fails sk_tts_load.
    fs::remove(codec_file);
    std::vector<std::string> gone_names;
    std::set<std::string> gone_dtypes;
    assert(!tts_model_tensors("miotts", lm_dir, gone_names, gone_dtypes));
    fs::remove_all(card);

    // The set as the recording device loads it. audio.cpp's BackendWeightStore loads a Native
    // BF16 tensor as F16 when its backend is Vulkan or Metal (backend_weight_store.h:273-286),
    // so a tts file holding bf16 records f16 WEIGHTs there; llama.cpp and transcribe.cpp load
    // the file's dtype as is. A family with a raw-typed device weight path (qwen3_tts's
    // speech-decoder output_proj, kugelaudio's lm_head) also keeps bf16, so either is covered.
    // A host WEIGHT runs on the CPU, where nothing is converted. audio.cpp builds some weights as
    // F32 whatever the file holds (make_f32 and type_for_derived_storage, backend_weight_store.h:
    // 133-142 and 246-251), so a tts set covers f32 on every device even where the file holds
    // none. Every case is run before any is asserted, so one failing case does not hide the
    // others.
    ggml_backend_t cpu = ggml_backend_init_by_type(GGML_BACKEND_DEVICE_TYPE_CPU, nullptr);
    assert(cpu);
    ggml_backend_dev_t cpu_dev = ggml_backend_get_device(cpu);
    struct Case {
        const char *what, *stage, *family, *recorded_on;
        bool host;
        ggml_type live;
        std::vector<const char *> file;
        sk_status want;
    };
    const Case cases[] = {
        {"tts on vulkan, live f16, file bf16", "tts", "guard_family", "vulkan", false, GGML_TYPE_F16, {"bf16", "f32"}, SK_OK},
        {"tts on metal, live f16, file bf16", "tts", "guard_family", "metal", false, GGML_TYPE_F16, {"bf16", "f32"}, SK_OK},
        {"tts on cpu, live f16, file bf16", "tts", "guard_family", "cpu", false, GGML_TYPE_F16, {"bf16", "f32"}, SK_ERR_INVALID_ARGUMENT},
        {"tts on cpu, live bf16, file bf16", "tts", "guard_family", "cpu", false, GGML_TYPE_BF16, {"bf16", "f32"}, SK_OK},
        {"tts on vulkan, live bf16, file bf16", "tts", "guard_family", "vulkan", false, GGML_TYPE_BF16, {"bf16", "f32"}, SK_ERR_INVALID_ARGUMENT},
        {"asr on vulkan, live f16, file bf16", "asr", "guard_family", "vulkan", false, GGML_TYPE_F16, {"bf16"}, SK_ERR_INVALID_ARGUMENT},
        {"translate on metal, live f16, file bf16", "translate", "guard_family", "metal", false, GGML_TYPE_F16, {"bf16"}, SK_ERR_INVALID_ARGUMENT},
        {"qwen3_tts on vulkan, live bf16, file bf16", "tts", "qwen3_tts", "vulkan", false, GGML_TYPE_BF16, {"bf16", "f32"}, SK_OK},
        {"qwen3_tts on vulkan, live f16, file bf16", "tts", "qwen3_tts", "vulkan", false, GGML_TYPE_F16, {"bf16", "f32"}, SK_OK},
        {"kugelaudio on metal, live bf16, file bf16", "tts", "kugelaudio", "metal", false, GGML_TYPE_BF16, {"bf16", "f32"}, SK_OK},
        {"tts on vulkan, host live bf16, file bf16", "tts", "guard_family", "vulkan", true, GGML_TYPE_BF16, {"bf16"}, SK_OK},
        {"tts on vulkan, host live f16, file bf16", "tts", "guard_family", "vulkan", true, GGML_TYPE_F16, {"bf16"}, SK_ERR_INVALID_ARGUMENT},
        {"tts on vulkan, live f32, file f16 q8_0", "tts", "guard_family", "vulkan", false, GGML_TYPE_F32, {"f16", "q8_0"}, SK_OK},
        {"tts on cpu, live f32, file f16 q8_0", "tts", "guard_family", "cpu", false, GGML_TYPE_F32, {"f16", "q8_0"}, SK_OK},
        {"tts on vulkan, host live f32, file f16 q8_0", "tts", "guard_family", "vulkan", true, GGML_TYPE_F32, {"f16", "q8_0"}, SK_OK},
        {"asr on vulkan, live f32, file f16 q8_0", "asr", "guard_family", "vulkan", false, GGML_TYPE_F32, {"f16", "q8_0"}, SK_ERR_INVALID_ARGUMENT},
        {"translate on cpu, live f32, file f16 q8_0", "translate", "guard_family", "cpu", false, GGML_TYPE_F32, {"f16", "q8_0"}, SK_ERR_INVALID_ARGUMENT},
    };
    int failed = 0;
    for (const Case &c : cases) {
        if (c.host) record_weight(cpu_dev, cpu, true, c.live);
        else        record_weight(dev, rec, false, c.live);
        const sk_status got = sk_record_end_to_file(out.c_str(), c.stage, c.family, "x.gguf", c.recorded_on,
                                                    c.file.data(), (int32_t)c.file.size());
        const std::string why = got == SK_OK ? "" : sk_last_error();
        bool ok = got == c.want;
        // A refusal names the live dtype it could not place and the set it was held against, as
        // the device that ran it loads the file, and writes nothing.
        if (ok && got != SK_OK) {
            const std::string where = std::string(", outside the dtypes-in-file set as ") + (c.host ? "cpu" : c.recorded_on) + " loads it (";
            ok = why.find(std::string("holds ") + ggml_type_name(c.live) + where) != std::string::npos &&
                 !std::filesystem::exists(out);
        }
        std::fprintf(stderr, "test_record_guard: %s: %s (want %s)%s%s\n", c.what, got == SK_OK ? "accepted" : "refused",
                     c.want == SK_OK ? "accepted" : "refused", why.empty() ? "" : ": ", why.c_str());
        if (!ok) { std::fprintf(stderr, "test_record_guard: FAILED: %s\n", c.what); ++failed; }
        std::filesystem::remove(out);
    }
    assert(failed == 0);

    ggml_backend_free(cpu);
    ggml_backend_free(rec);
    std::printf("test_record_guard: ok\n");
    return 0;
}
