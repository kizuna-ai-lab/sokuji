/* Spec A §3.2: the .ops text form is the only thing that crosses from the recording build
 * into the shipping library, so it must round-trip exactly — including the WEIGHT sentinel,
 * the op-param blob and the ne maxima the rebuild needs. Pure: no backend, runs everywhere.
 *
 * argv[1], when given, is the shipped recordings' directory (src/ops): every node of every
 * recording there is rebuilt the way the query rebuilds it and checked against its maxbytes. */
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "sokuji_native.h"   // SK_DEVICE_* for sk_ops_device_word
#include "sk_ops.h"
#include "ggml.h"

namespace {

int g_failures = 0;
void check(bool ok, const std::string &what) {
    if (!ok) { std::fprintf(stderr, "FAIL: %s\n", what.c_str()); ++g_failures; }
}

/* One occurrence of a node, as the recorder sees it: its own shapes are its maxima. */
sk_op_desc occurrence(int32_t op, int32_t src0_type, int32_t src1_type, int32_t dst_type,
                      std::array<int64_t, 4> ne_src0, std::array<int64_t, 4> ne_src1, std::array<int64_t, 4> ne_dst) {
    sk_op_desc d{};
    d.op = op; d.dst_type = dst_type;
    d.src_type = {src0_type, src1_type, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    d.max_ne_src0 = ne_src0; d.max_ne_src1 = ne_src1; d.max_ne_dst = ne_dst;
    d.ne0_src0 = ne_src0[0]; d.ne0_src1 = ne_src1[0]; d.ne0_dst = ne_dst[0];
    return d;
}

std::string format_nodes(const std::vector<sk_op_desc> &nodes) {
    sk_op_recording r;
    r.stage = "tts"; r.family = "echo_tts"; r.engine = "test"; r.source_file = "echo.gguf";
    r.recorded_on = "vulkan"; r.dtypes_in_file = {"f32"};
    r.nodes = nodes;
    return sk_ops_format(r);
}

/* The node line of a one-node recording's text. */
std::string op_line(const std::string &text) {
    const auto p = text.find("op=");
    return p == std::string::npos ? std::string() : text.substr(p);
}

/* The bytes of every tensor the query asks for this node, rebuilt exactly as sk_device_supports_ops
 * rebuilds it, against the node's own record of the largest tensor it saw. A WEIGHT source is
 * rebuilt as f32 and not compared: its dtype is the query's choice, not a recorded one. */
bool rebuilt_within_max_bytes(const sk_op_desc &d, std::string &why) {
    ggml_init_params ip = { 64 * 1024, nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) { why = "ggml_init"; return false; }
    ggml_tensor *node = sk_ops_rebuild_node(ctx, d, GGML_TYPE_F32);
    bool ok = node != nullptr;
    if (!node) why = "no node";
    const char *names[] = {"dst", "src0", "src1"};
    const ggml_tensor *ts[] = {node, node ? node->src[0] : nullptr, node ? node->src[1] : nullptr};
    const int32_t types[] = {d.dst_type, d.src_type[0], d.src_type[1]};
    for (int i = 0; ok && i < 3; ++i) {
        if (!ts[i] || types[i] == SK_SRC_WEIGHT) continue;
        if (ggml_nbytes(ts[i]) > d.max_bytes) {
            ok = false;
            why = std::string(names[i]) + " rebuilds to " + std::to_string(ggml_nbytes(ts[i])) +
                  " bytes > maxbytes " + std::to_string(d.max_bytes);
        }
    }
    ggml_free(ctx);
    return ok;
}

/* ggml-vulkan's own (ggml-vulkan.cpp:6021-6026), read by its quantized MUL_MAT branch at :15459;
 * it lives in the Vulkan backend, which a CPU-only lane does not build, so it is restated here. */
bool vk_dim01_contiguous(const ggml_tensor *t) {
    return t->nb[0] == ggml_type_size(t->type) &&
           t->nb[1] == (t->nb[0] * t->ne[0]) / ggml_blck_size(t->type) &&
           (t->ne[3] == 1 || t->nb[3] == t->nb[2] * t->ne[2]);
}

/* The layout predicates the pinned backends' supports_op read: the four of ggml.c, the transpose
 * test ggml-metal's MUL_MAT kernel choice reads (ggml_metal_op_mul_mat_use_mm,
 * ggml-metal-common.cpp:35-42), and ggml-vulkan's dim01 test. */
struct LayoutPredicate { const char *name; bool (*holds)(const ggml_tensor *); };
const LayoutPredicate kLayoutPredicates[] = {
    {"ggml_is_contiguous", ggml_is_contiguous},
    {"ggml_is_contiguous_1", ggml_is_contiguous_1},
    {"ggml_is_contiguous_2", ggml_is_contiguous_2},
    {"ggml_is_contiguous_rows", ggml_is_contiguous_rows},
    {"ggml_is_transposed", ggml_is_transposed},
    {"vk_dim01_contiguous", vk_dim01_contiguous},
};

/* A node rebuilt from its largest occurrence is not the least contiguous shape its identity took,
 * as the maxima are (an extent-1 axis is skipped by ggml_is_contiguous_m_n, ggml.c:1474-1492), so
 * a predicate that differs between the two rebuilds could let a GPU accept a node one of whose
 * smaller occurrences it would refuse. That is harmless only for an op whose supports_op reads
 * no layout predicate on any backend. These are those ops at the pinned ggml (rebuilt tensors
 * carry no buffer, so ggml-cpu's extra-buffer check at ggml-cpu.cpp:434-440 never runs):
 *   - CONT, CPY, DUP with no quantized tensor. ggml-cpu.cpp:443-452 (CPY reads op->type only;
 *     CONT and DUP reach the default at :484-485); ggml-vulkan.cpp:15585-15649 (contiguity only
 *     for a quantized same-type copy, :15643-15646); ggml-metal-device.m:1858-1919 (types only).
 *   - CONCAT with no quantized tensor. ggml-cpu.cpp:484-485 (default); ggml-vulkan.cpp:15740-15742
 *     calling ggml_vk_concat_supported at :321-333 (contiguous_rows only for a quantized type,
 *     :331-332); ggml-metal-device.m:1620-1646 (types only).
 *   - FLASH_ATTN_EXT. ggml-cpu.cpp:484-485 (default); ggml-vulkan.cpp:15475-15522 (head sizes,
 *     types, device features); ggml-metal-device.m:1726-1770 (head sizes, types).
 * Before any switch, ggml-vulkan checks tensor bytes (:15331-15352) and ggml-metal bf16 support
 * (ggml-metal-device.m:1543-1553); neither reads a layout predicate. A flip on any other op fails
 * the shipped pass: the node is then either wrongly accepted or a ruling is due. */
bool reads_no_layout_predicate(const sk_op_desc &d) {
    auto plain = [](int32_t t) { return t == SK_SRC_ABSENT || (t >= 0 && !ggml_is_quantized(static_cast<ggml_type>(t))); };
    const bool unquantized = plain(d.src_type[0]) && plain(d.src_type[1]) && plain(d.dst_type);
    switch (d.op) {
        case GGML_OP_CONT: case GGML_OP_CPY: case GGML_OP_DUP: return unquantized;
        case GGML_OP_CONCAT:         return unquantized;
        case GGML_OP_FLASH_ATTN_EXT: return true;
        default:                     return false;
    }
}

/* Rebuild a node from its largest occurrence and from its maxima, and compare every layout
 * predicate on dst, src0 and src1. Prints each difference; returns the ones outside
 * reads_no_layout_predicate (failures). */
int layout_flips(const sk_op_desc &d, const std::string &where, int &allowed) {
    ggml_init_params ip = { 64 * 1024, nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    sk_op_desc maxima = d;
    maxima.largest.reset();
    const ggml_tensor *real = sk_ops_rebuild_node(ctx, d, GGML_TYPE_F32);
    const ggml_tensor *wide = sk_ops_rebuild_node(ctx, maxima, GGML_TYPE_F32);
    const char *names[] = {"dst", "src0", "src1"};
    const ggml_tensor *r[] = {real, real ? real->src[0] : nullptr, real ? real->src[1] : nullptr};
    const ggml_tensor *w[] = {wide, wide ? wide->src[0] : nullptr, wide ? wide->src[1] : nullptr};
    int failures = 0;
    for (int i = 0; i < 3; ++i) {
        if (!r[i] || !w[i]) continue;
        for (const LayoutPredicate &p : kLayoutPredicates) {
            const bool on_real = p.holds(r[i]), on_maxima = p.holds(w[i]);
            if (on_real == on_maxima) continue;
            const std::string what = where + " " + sk_op_spelling(d, nullptr) + " " + names[i] + " " + p.name +
                                     ": maxima " + (on_maxima ? "1" : "0") + ", real " + (on_real ? "1" : "0");
            if (reads_no_layout_predicate(d)) {
                std::printf("test_ops_format: allowed layout flip %s\n", what.c_str());
                ++allowed;
            } else {
                check(false, "layout flip outside reads_no_layout_predicate: " + what);
                ++failures;
            }
        }
    }
    ggml_free(ctx);
    return failures;
}

}  // namespace

int main(int argc, char **argv) {
    sk_op_recording r;
    r.stage = "tts"; r.family = "supertonic"; r.engine = "audio.cpp 0.7.1 ; ggml 0.22.0";
    r.source_file = "supertonic-3-f16.gguf"; r.recorded_on = "vulkan"; r.dtypes_in_file = {"f16", "f32"};
    sk_op_desc d{};
    d.op = GGML_OP_MUL_MAT; d.dst_type = GGML_TYPE_F32;
    d.src_type = {SK_SRC_WEIGHT, GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    d.ne0_src0 = 1024; d.ne0_src1 = 1024; d.ne0_dst = 1024;
    d.max_ne_src0 = {1024, 1024, 1, 1}; d.max_ne_src1 = {1024, 7, 1, 1}; d.max_ne_dst = {1024, 7, 1, 1};
    d.max_bytes = 4194304;
    r.nodes.push_back(d);
    sk_op_desc u{};
    u.op = GGML_OP_UNARY; u.op_params[0] = GGML_UNARY_OP_GELU; u.dst_type = GGML_TYPE_F32;
    u.src_type = {GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    u.ne0_src0 = 4096; u.ne0_dst = 4096; u.max_ne_src0 = {4096, 7, 1, 1}; u.max_ne_dst = {4096, 7, 1, 1};
    u.max_bytes = 114688;
    r.nodes.push_back(u);
    /* F1: a DENSE PERMUTED src0 (row-contiguous, ne[0] still innermost) and a STRIDED src1
     * (a view into something larger, so its nb must survive the round trip), plus the F2 host
     * flag — the three fields round 1's `contig=[a,b]` could not express. */
    sk_op_desc p{};
    p.op = GGML_OP_ROPE; p.op_params[2] = 0; p.dst_type = GGML_TYPE_F32;
    p.src_type = {GGML_TYPE_F32, GGML_TYPE_I32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    p.ne0_src0 = 64; p.ne0_src1 = 112; p.ne0_dst = 64;
    p.max_ne_src0 = {64, 10, 112, 2}; p.max_ne_src1 = {112, 1, 1, 1}; p.max_ne_dst = {64, 10, 112, 2};
    p.lay_src0.perm = {0, 2, 1, 3};                       // row-contiguous permute
    p.lay_src1.dense = false; p.lay_src1.nb = {4, 8192, 8192, 8192};
    p.host = true;
    p.max_bytes = 1144320;
    r.nodes.push_back(p);
    /* Round 3: a NON-NATURAL strided descriptor — the shape round 2's rebuild got wrong by
     * applying the permutation twice. Verbatim from tts-pocket_tts.ops:68 (op=CONT). Its
     * smallest stride is on axis 1, so perm = {1,0,2,3} and the recorded nb[0] is 2240, the one
     * shipped row whose innermost recorded stride is not the type size. */
    sk_op_desc s{};
    s.op = GGML_OP_CONT; s.dst_type = GGML_TYPE_F32;
    s.src_type = {GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    s.ne0_src0 = 512; s.ne0_dst = 512;
    s.max_ne_src0 = {512, 544, 1, 1}; s.max_ne_dst = {512, 544, 1, 1};
    s.lay_src0.perm = {1, 0, 2, 3}; s.lay_src0.dense = false;
    s.lay_src0.nb = {2240, 4, 1146880, 1146880};
    s.max_bytes = 1114112;
    r.nodes.push_back(s);

    std::string text = sk_ops_format(r);
    assert(text.find("# stage: tts ; family: supertonic") != std::string::npos);
    assert(text.find("# dtypes-in-file: f16 f32") != std::string::npos);
    assert(text.find("# recorded-on: vulkan") != std::string::npos);
    assert(text.find("layout=[0213d,0123s,0123d]") != std::string::npos);
    assert(text.find("nb1=[4,8192,8192,8192]") != std::string::npos);
    assert(text.find("host=1") != std::string::npos);
    assert(text.find("contig=") == std::string::npos);    // the round-1 field is gone
    assert(text.find("layout=[1023s,0123d,0123d]") != std::string::npos);
    assert(text.find("nb0=[2240,4,1146880,1146880]") != std::string::npos);
    sk_op_recording back; std::string err;
    assert(sk_ops_parse(text, back, err));
    assert(back.nodes.size() == 4 && back.family == "supertonic" && back.dtypes_in_file.size() == 2);
    assert(back.recorded_on == "vulkan");
    assert(back.nodes[0].src_type[0] == SK_SRC_WEIGHT && back.nodes[0].max_bytes == 4194304 && back.nodes[0].max_ne_src1[1] == 7);
    assert(back.nodes[1].op_params[0] == GGML_UNARY_OP_GELU);
    assert(sk_op_spelling(back.nodes[0], "q8_0") == "MUL_MAT[q8_0,f32,-,-,-]->f32");
    assert(sk_op_spelling(back.nodes[1], nullptr) == "UNARY.GELU[f32,-,-,-,-]->f32");
    // the layout descriptor survives the round trip, strides and all
    assert((back.nodes[2].lay_src0.perm == std::array<int32_t, 4>{0, 2, 1, 3}) && back.nodes[2].lay_src0.dense);
    assert(!back.nodes[2].lay_src1.dense && back.nodes[2].lay_src1.nb[1] == 8192);
    assert(back.nodes[2].lay_dst.dense && back.nodes[2].host);
    // dense layouts carry no nb line, so a dense descriptor round-trips without one
    assert(back.nodes[0].lay_src0.dense && back.nodes[0].lay_src0.perm[0] == 0 && !back.nodes[0].host);

    // identity ignores the sequence axes: a second node differing only in max_ne merges
    sk_op_desc d2 = d; d2.max_ne_src1 = {1024, 300, 1, 1}; d2.max_bytes = 9000000;
    std::vector<sk_op_desc> v = {d}; sk_ops_add(v, d2);
    assert(v.size() == 1 && v[0].max_ne_src1[1] == 300 && v[0].max_bytes == 9000000);
    // ...but the layout descriptor and the host flag ARE identity: neither merges away
    sk_op_desc d3 = d; d3.lay_src0.perm = {1, 0, 2, 3};
    sk_ops_add(v, d3);
    assert(v.size() == 2);
    sk_op_desc d4 = d; d4.host = true;
    sk_ops_add(v, d4);
    assert(v.size() == 3);
    // dense-nb helper: the natural order is ggml's own packed layout
    assert((sk_layout_dense_nb({0, 1, 2, 3}, {64, 10, 112, 2}, GGML_TYPE_F32) == std::array<int64_t, 4>{4, 256, 2560, 286720}));

    /* Round 3: the REBUILD itself, not just the text. A descriptor is only worth recording if
     * the tensor it rebuilds answers the backends' predicates the way the recorded one did, and
     * for a non-natural strided layout that cannot be reasoned about — round 2's version
     * produced the recorded ne and nb straight from ggml_view_4d and then permuted a second
     * time, silently flipping both predicates below. sk_ops_rebuild_node lives beside the text
     * form precisely so this can be asserted without the library's C ABI. */
    {
        ggml_init_params ip = { 16 * 1024 * 1024, nullptr, /*no_alloc*/ true };
        ggml_context *ctx = ggml_init(ip);
        assert(ctx);

        // (a) the 1023s row: ne and nb come back exactly as recorded, including nb[0] = 2240.
        ggml_tensor *node = sk_ops_rebuild_node(ctx, back.nodes[3], -1);
        assert(node && node->src[0]);
        const ggml_tensor *a = node->src[0];
        assert(a->ne[0] == 512 && a->ne[1] == 544 && a->ne[2] == 1 && a->ne[3] == 1);
        assert(a->nb[0] == 2240 && a->nb[1] == 4 && a->nb[2] == 1146880 && a->nb[3] == 1146880);
        assert(ggml_is_transposed(a));                     // nb[0] > nb[1], as recorded
        assert(!ggml_is_contiguous_rows(a));               // nb[0] != type_size and ne[0] != blck_size
        assert(!ggml_is_contiguous(a));
        // the node itself keeps the recorded op and is not left as a view of its scaffolding
        assert(node->op == GGML_OP_CONT && node->view_src == nullptr);

        // (b) the 0213d row (a row-contiguous permute): rows contiguous, tensor not contiguous.
        ggml_tensor *rope = sk_ops_rebuild_node(ctx, back.nodes[2], -1);
        assert(rope && rope->src[0]);
        const ggml_tensor *q = rope->src[0];
        assert(q->ne[0] == 64 && q->ne[1] == 10 && q->ne[2] == 112 && q->ne[3] == 2);
        assert(q->nb[0] == ggml_type_size(GGML_TYPE_F32));
        assert(ggml_is_contiguous_rows(q));
        assert(!ggml_is_contiguous(q));
        assert(!ggml_is_transposed(q));                    // a permute, not a transpose
        // its strided src1 (0123s) keeps the recorded strides too
        assert(rope->src[1] && rope->src[1]->nb[1] == 8192 && rope->src[1]->ne[0] == 112);

        // (c) a plain dense natural row rebuilds contiguous, and WEIGHT takes the asked dtype.
        ggml_tensor *mm = sk_ops_rebuild_node(ctx, back.nodes[0], GGML_TYPE_Q8_0);
        assert(mm && mm->src[0] && mm->src[0]->type == GGML_TYPE_Q8_0);
        assert(ggml_is_contiguous(mm->src[0]) && ggml_is_contiguous_rows(mm->src[0]));
        assert(mm->src[0]->ne[0] == 1024 && mm->src[0]->ne[1] == 1024);

        ggml_free(ctx);
    }

    assert(!sk_ops_parse("op=NOPE dst=f32\n", back, err) && !err.empty());
    // A stale round-1 file must fail LOUDLY rather than be read with default layouts.
    assert(!sk_ops_parse("op=MUL_MAT dst=f32 src=[f32,-,-,-,-] contig=[1,0]\n", back, err) && !err.empty());
    assert(!sk_ops_parse("op=MUL_MAT dst=f32 src=[f32,-,-,-,-] layout=[0123d,0123d]\n", back, err) && !err.empty());
    assert(!sk_ops_parse("op=MUL_MAT dst=f32 src=[f32,-,-,-,-] layout=[0113d,0123d,0123d]\n", back, err) && !err.empty());
    assert(!sk_ops_parse("op=MUL_MAT dst=f32 src=[f32,-,-,-,-] host=2\n", back, err) && !err.empty());
    // Controller ruling: non-numeric params=/maxbytes= fields must fail cleanly (false +
    // error), not throw std::invalid_argument/std::out_of_range out of sk_ops_parse.
    std::string bad_params_line = "op=MUL_MAT params=" + std::string(128, 'z') + " dst=f32 src=[f32,-,-,-,-]\n";
    assert(!sk_ops_parse(bad_params_line, back, err) && !err.empty());
    assert(!sk_ops_parse("op=MUL_MAT maxbytes=abc dst=f32 src=[f32,-,-,-,-]\n", back, err) && !err.empty());

    // The dtypes a WEIGHT stored in a file dtype is held in on a device. audio.cpp loads a tts
    // bf16 as f16 on Vulkan and Metal; a family with a raw-typed device weight path also keeps
    // bf16; nothing else is mapped. Pinned here so every lane, CPU-only CI included, sees the
    // exception list.
    using V = std::vector<std::string>;
    assert((sk_ops_loaded_weight_dtypes("tts", "vibevoice", "vulkan", "bf16") == V{"f16"}));
    assert((sk_ops_loaded_weight_dtypes("tts", "vibevoice", "metal", "bf16") == V{"f16"}));
    assert((sk_ops_loaded_weight_dtypes("tts", "vibevoice", "vulkan", "q8_0") == V{"q8_0"}));
    assert((sk_ops_loaded_weight_dtypes("tts", "vibevoice", "cpu", "bf16") == V{"bf16"}));
    assert((sk_ops_loaded_weight_dtypes("tts", "vibevoice", "gpu", "bf16") == V{"bf16"}));
    assert((sk_ops_loaded_weight_dtypes("asr", "whisper", "vulkan", "bf16") == V{"bf16"}));
    assert((sk_ops_loaded_weight_dtypes("translate", "qwen3", "metal", "bf16") == V{"bf16"}));
    for (const char *raw : {"audio8_tts", "breeze_tts", "dramabox", "fish_audio", "higgs_audio_tts", "index_tts2",
                            "kugelaudio", "moss_voicegen", "qwen3_tts", "vieneu_v3_turbo"}) {
        assert((sk_ops_loaded_weight_dtypes("tts", raw, "vulkan", "bf16") == V{"bf16", "f16"}));
        assert((sk_ops_loaded_weight_dtypes("tts", raw, "metal", "bf16") == V{"bf16", "f16"}));
        assert((sk_ops_loaded_weight_dtypes("tts", raw, "cpu", "bf16") == V{"bf16"}));
        assert((sk_ops_loaded_weight_dtypes("tts", raw, "vulkan", "f16") == V{"f16"}));
    }
    // Raw-typed paths that never run on Vulkan or Metal: irodori_tts's packed q/k/v/gate is
    // CUDA-only, miotts loads its codec at F32 storage, and miocodec is no tts family.
    for (const char *stored : {"irodori_tts", "miotts", "miocodec"}) {
        assert((sk_ops_loaded_weight_dtypes("tts", stored, "vulkan", "bf16") == V{"f16"}));
        assert((sk_ops_loaded_weight_dtypes("tts", stored, "metal", "bf16") == V{"f16"}));
        assert((sk_ops_loaded_weight_dtypes("tts", stored, "cpu", "bf16") == V{"bf16"}));
    }
    // The `# recorded-on` words, one spelling for the query and the recorder.
    assert(std::string(sk_ops_device_word(SK_DEVICE_VULKAN)) == "vulkan");
    assert(std::string(sk_ops_device_word(SK_DEVICE_METAL)) == "metal");
    assert(std::string(sk_ops_device_word(SK_DEVICE_CPU)) == "cpu");
    assert(std::string(sk_ops_device_word(SK_DEVICE_OTHER)) == "gpu");

    /* A merged node is asked about a tensor that really occurred (ruling 2026-10-07, op-coverage
     * precision). The identity leaves ne[1..3] and the strides out, and the merge keeps their
     * per-axis maxima, so one identity seen in two orientations merges into a tensor that never
     * existed. Echo-TTS's S1-DAC codec at its 640-latent capacity graph holds REPEAT
     * [1,1024]->[1280,1024] and [1,1,1024]->[1280,1,1024] under one identity: 5,242,880 bytes each,
     * merged to [1280,1024,1024,1], 5.37 GB, which ggml-vulkan refuses past its buffer limit. */
    {
        const sk_op_desc a = occurrence(GGML_OP_REPEAT, GGML_TYPE_F32, SK_SRC_ABSENT, GGML_TYPE_F32,
                                        {1, 1024, 1, 1}, {1, 1, 1, 1}, {1280, 1024, 1, 1});
        const sk_op_desc b = occurrence(GGML_OP_REPEAT, GGML_TYPE_F32, SK_SRC_ABSENT, GGML_TYPE_F32,
                                        {1, 1, 1024, 1}, {1, 1, 1, 1}, {1280, 1, 1024, 1});
        sk_op_desc a1 = a, b1 = b;
        a1.max_bytes = b1.max_bytes = 5242880;
        std::vector<sk_op_desc> v;
        sk_ops_add(v, a1); sk_ops_add(v, b1);
        check(v.size() == 1, "repeat: the two orientations are one identity");
        const std::string text = format_nodes(v);
        // The maxima are kept, and the line also carries the largest real occurrence. Both are
        // 5,242,880 bytes; the tie goes to the greater shapes, so arrival order cannot change it.
        const std::string want =
            "op=REPEAT params=- dst=f32 src=[f32,-,-,-,-] ne0=[1,1,1280] max0=[1,1024,1024,1] max1=[1,1,1,1] "
            "maxd=[1280,1024,1024,1] layout=[0123d,0123d,0123d] host=0 maxbytes=5242880 "
            "real0=[1,1024,1,1] real1=[1,1,1,1] reald=[1280,1024,1,1]\n";
        check(op_line(text) == want, "repeat: the line carries the largest real occurrence: got " + op_line(text));
        std::vector<sk_op_desc> w;
        sk_ops_add(w, b1); sk_ops_add(w, a1);
        check(format_nodes(w) == text, "repeat: the line does not depend on arrival order");

        // The fields parse back: formatting the parsed recording gives the same text.
        sk_op_recording parsed; std::string perr;
        const bool parsed_ok = sk_ops_parse(text, parsed, perr);
        check(parsed_ok, "repeat: the line parses: " + perr);
        if (parsed_ok) {
            check(sk_ops_format(parsed) == text, "repeat: format(parse(text)) == text");
            // The node the query rebuilds is that occurrence, no larger than any tensor it saw.
            ggml_init_params ip = { 1024 * 1024, nullptr, /*no_alloc*/ true };
            ggml_context *ctx = ggml_init(ip);
            ggml_tensor *n = sk_ops_rebuild_node(ctx, parsed.nodes[0], -1);
            check(n && n->ne[0] == 1280 && n->ne[1] == 1024 && n->ne[2] == 1 && n->ne[3] == 1,
                  "repeat: the dst rebuilds as the real [1280,1024,1,1]");
            check(n && n->src[0] && n->src[0]->ne[1] == 1024 && n->src[0]->ne[2] == 1,
                  "repeat: src0 rebuilds as the real [1,1024,1,1]");
            check(n && ggml_nbytes(n) <= parsed.nodes[0].max_bytes, "repeat: rebuilt dst bytes <= maxbytes");
            ggml_free(ctx);
            std::string why;
            check(rebuilt_within_max_bytes(parsed.nodes[0], why), "repeat: " + why);
        }
    }
    /* The same through merged strides, echo's CONT: one identity (a strided f32 column, layout
     * 0123s) seen as a 1024-row view with a short row stride and as a 64-row view with a 5 MB
     * one. ne merges to [1,1024,1,1] and nb to [4,5242880,335544320,335544320], a 5.36 GB span,
     * against a largest real view of 330 MB. */
    {
        sk_op_desc a = occurrence(GGML_OP_CONT, GGML_TYPE_F32, SK_SRC_ABSENT, GGML_TYPE_F32,
                                  {1, 1024, 1, 1}, {1, 1, 1, 1}, {1, 1024, 1, 1});
        a.lay_src0.dense = false; a.lay_src0.nb = {4, 8, 8192, 8192};
        a.max_bytes = 8188;                                  // 4 + 1023 * 8: the view; its dst is 4096
        sk_op_desc b = occurrence(GGML_OP_CONT, GGML_TYPE_F32, SK_SRC_ABSENT, GGML_TYPE_F32,
                                  {1, 64, 1, 1}, {1, 1, 1, 1}, {1, 64, 1, 1});
        b.lay_src0.dense = false; b.lay_src0.nb = {4, 5242880, 335544320, 335544320};
        b.max_bytes = 330301444;                             // 4 + 63 * 5242880
        std::vector<sk_op_desc> v;
        sk_ops_add(v, a); sk_ops_add(v, b);
        check(v.size() == 1, "cont: one identity");
        const std::string text = format_nodes(v);
        const std::string want =
            "op=CONT params=- dst=f32 src=[f32,-,-,-,-] ne0=[1,1,1] max0=[1,1024,1,1] max1=[1,1,1,1] "
            "maxd=[1,1024,1,1] layout=[0123s,0123d,0123d] nb0=[4,5242880,335544320,335544320] host=0 "
            "maxbytes=330301444 real0=[1,64,1,1] real1=[1,1,1,1] reald=[1,64,1,1] "
            "realnb0=[4,5242880,335544320,335544320]\n";
        check(op_line(text) == want, "cont: the line carries the real view and its strides: got " + op_line(text));
        sk_op_recording parsed; std::string perr;
        const bool parsed_ok = sk_ops_parse(text, parsed, perr);
        check(parsed_ok, "cont: the line parses: " + perr);
        if (parsed_ok) {
            check(sk_ops_format(parsed) == text, "cont: format(parse(text)) == text");
            ggml_init_params ip = { 1024 * 1024, nullptr, /*no_alloc*/ true };
            ggml_context *ctx = ggml_init(ip);
            ggml_tensor *n = sk_ops_rebuild_node(ctx, parsed.nodes[0], -1);
            const ggml_tensor *s = n ? n->src[0] : nullptr;
            check(s && s->ne[1] == 64 && s->nb[1] == 5242880 && ggml_nbytes(s) == 330301444,
                  "cont: src0 rebuilds as the real 64-row view, 330,301,444 bytes");
            check(n && n->ne[1] == 64, "cont: the dst rebuilds as the real [1,64,1,1]");
            ggml_free(ctx);
            std::string why;
            check(rebuilt_within_max_bytes(parsed.nodes[0], why), "cont: " + why);
        }
    }
    /* Strided src1 and dst, and two occurrences of different sizes. The larger, a [64,32] ADD
     * written through views, is the one kept whichever arrives first, with its own strides for
     * src1 and dst (not the merged ones: the smaller occurrence's nb[3] is larger). */
    {
        sk_op_desc big = occurrence(GGML_OP_ADD, GGML_TYPE_F32, GGML_TYPE_F32, GGML_TYPE_F32,
                                    {64, 32, 1, 1}, {64, 32, 1, 1}, {64, 32, 1, 1});
        big.lay_src1.dense = false; big.lay_src1.nb = {4, 1024, 32768, 32768};
        big.lay_dst.dense = false;  big.lay_dst.nb = {4, 512, 16384, 16384};
        big.max_bytes = 32000;                               // src1: 4 + 63*4 + 31*1024; src0 8192, dst 16128
        sk_op_desc small = occurrence(GGML_OP_ADD, GGML_TYPE_F32, GGML_TYPE_F32, GGML_TYPE_F32,
                                      {64, 1, 16, 1}, {64, 1, 16, 1}, {64, 1, 16, 1});
        small.lay_src1.dense = false; small.lay_src1.nb = {4, 256, 1024, 65536};
        small.lay_dst.dense = false;  small.lay_dst.nb = {4, 256, 512, 32768};
        small.max_bytes = 15616;                             // src1: 4 + 63*4 + 15*1024
        std::vector<sk_op_desc> v, w;
        sk_ops_add(v, big); sk_ops_add(v, small);
        sk_ops_add(w, small); sk_ops_add(w, big);
        check(v.size() == 1 && w.size() == 1, "views: one identity");
        const std::string text = format_nodes(v);
        const std::string want =
            "op=ADD params=- dst=f32 src=[f32,f32,-,-,-] ne0=[64,64,64] max0=[64,32,16,1] max1=[64,32,16,1] "
            "maxd=[64,32,16,1] layout=[0123d,0123s,0123s] nb1=[4,1024,32768,65536] nbd=[4,512,16384,32768] "
            "host=0 maxbytes=32000 real0=[64,32,1,1] real1=[64,32,1,1] reald=[64,32,1,1] "
            "realnb1=[4,1024,32768,32768] realnbd=[4,512,16384,16384]\n";
        check(op_line(text) == want, "views: the larger occurrence with its own src1 and dst strides: got " + op_line(text));
        check(format_nodes(w) == text, "views: larger then smaller and smaller then larger give one line");
        sk_op_recording parsed; std::string perr;
        const bool parsed_ok = sk_ops_parse(text, parsed, perr);
        check(parsed_ok && sk_ops_format(parsed) == text, "views: round trip: " + perr);
        if (parsed_ok) {
            ggml_init_params ip = { 1024 * 1024, nullptr, /*no_alloc*/ true };
            ggml_context *ctx = ggml_init(ip);
            ggml_tensor *n = sk_ops_rebuild_node(ctx, parsed.nodes[0], -1);
            check(n && n->ne[1] == 32 && n->ne[2] == 1 && n->nb[1] == 512 && n->nb[3] == 16384,
                  "views: the dst rebuilds with the real occurrence's strides");
            check(n && n->src[1] && n->src[1]->nb[1] == 1024 && n->src[1]->nb[3] == 32768,
                  "views: src1 rebuilds with the real occurrence's strides");
            ggml_free(ctx);
            std::string why;
            check(rebuilt_within_max_bytes(parsed.nodes[0], why), "views: " + why);
        }
    }
    /* A merge whose maxima ARE an occurrence (a KV-cache step [d,1,h], then the prompt [d,t,h])
     * fabricates nothing, so its line is written exactly as before this rule, with no new field. */
    {
        sk_op_desc step = occurrence(GGML_OP_CPY, GGML_TYPE_F32, SK_SRC_ABSENT, GGML_TYPE_F16,
                                     {64, 1, 8, 1}, {1, 1, 1, 1}, {64, 1, 8, 1});
        step.max_bytes = 2048;
        sk_op_desc prompt = occurrence(GGML_OP_CPY, GGML_TYPE_F32, SK_SRC_ABSENT, GGML_TYPE_F16,
                                       {64, 37, 8, 1}, {1, 1, 1, 1}, {64, 37, 8, 1});
        prompt.max_bytes = 75776;
        std::vector<sk_op_desc> v;
        sk_ops_add(v, step); sk_ops_add(v, prompt);
        const std::string text = format_nodes(v);
        check(op_line(text) ==
                  "op=CPY params=- dst=f16 src=[f32,-,-,-,-] ne0=[64,1,64] max0=[64,37,8,1] max1=[1,1,1,1] "
                  "maxd=[64,37,8,1] layout=[0123d,0123d,0123d] host=0 maxbytes=75776\n",
              "kv: a non-fabricating merge is written as before: got " + op_line(text));
        check(text.find("real") == std::string::npos, "kv: no real-occurrence field");
        sk_op_recording parsed; std::string perr;
        check(sk_ops_parse(text, parsed, perr) && sk_ops_format(parsed) == text, "kv: round trip");
        std::string why;
        check(parsed.nodes.size() == 1 && rebuilt_within_max_bytes(parsed.nodes[0], why), "kv: " + why);
    }
    /* The fields are read as strictly as the others: complete, inside the maxima, on the
     * identity's own row lengths, strides exactly where the layout is strided, and only on a node
     * whose maxima do fabricate. */
    {
        const std::string repeat =
            "op=REPEAT params=- dst=f32 src=[f32,-,-,-,-] ne0=[1,1,1280] max0=[1,1024,1024,1] max1=[1,1,1,1] "
            "maxd=[1280,1024,1024,1] layout=[0123d,0123d,0123d] host=0 maxbytes=5242880";
        const std::string cont =
            "op=CONT params=- dst=f32 src=[f32,-,-,-,-] ne0=[1,1,1] max0=[1,1024,1,1] max1=[1,1,1,1] "
            "maxd=[1,1024,1,1] layout=[0123s,0123d,0123d] nb0=[4,5242880,335544320,335544320] host=0 "
            "maxbytes=330301444";
        const std::string kv =
            "op=CPY params=- dst=f16 src=[f32,-,-,-,-] ne0=[64,1,64] max0=[64,37,8,1] max1=[1,1,1,1] "
            "maxd=[64,37,8,1] layout=[0123d,0123d,0123d] host=0 maxbytes=75776";
        sk_op_recording out; std::string e;
        auto parses = [&](const std::string &line) { e.clear(); return sk_ops_parse(line + "\n", out, e); };
        check(parses(repeat + " real0=[1,1024,1,1] real1=[1,1,1,1] reald=[1280,1024,1,1]"), "strict: a valid line parses: " + e);
        check(parses(cont + " real0=[1,64,1,1] real1=[1,1,1,1] reald=[1,64,1,1] realnb0=[4,5242880,335544320,335544320]"),
              "strict: a valid strided line parses: " + e);
        // A fabricating line from an older recorder, without the fields, still reads (from its maxima).
        check(parses(repeat), "strict: a fabricating line without the fields parses: " + e);
        const char *bad[] = {
            " real0=[1,1024,1,1]",                                                          // incomplete
            " real0=[1,1024,1,1] real1=[1,1,1,1]",                                          // incomplete
            " real0=[1,1024] real1=[1,1,1,1] reald=[1280,1024,1,1]",                        // bad syntax
            " real0=[1,1024,1,1] real1=[1,1,1,1] reald=[1280,2048,1,1]",                    // outside maxd
            " real0=[2,1024,1,1] real1=[1,1,1,1] reald=[1280,1024,1,1]",                    // not the identity's ne0
            " real0=[1,1024,1,1] real1=[1,1,1,1] reald=[1280,1024,1,1] realnb0=[4,4,4,4]",  // strides on a dense layout
            " real0=[1,1024,2,1] real1=[1,1,1,1] reald=[1280,1024,2,1]",                    // larger than maxbytes
        };
        for (const char *b : bad) check(!parses(repeat + b) && !e.empty(), std::string("strict: rejects") + b);
        check(!parses(cont + " real0=[1,64,1,1] real1=[1,1,1,1] reald=[1,64,1,1]") && !e.empty(),
              "strict: rejects a strided src0 without realnb0");
        check(!parses(cont + " real0=[1,64,1,1] real1=[1,1,1,1] reald=[1,64,1,1] realnb0=[4,5242880,671088640,671088640]") && !e.empty(),
              "strict: rejects realnb0 outside nb0");
        check(!parses(kv + " real0=[64,37,8,1] real1=[1,1,1,1] reald=[64,37,8,1]") && !e.empty(),
              "strict: rejects the fields on a node whose maxima fabricate nothing");
    }

    /* Every shipped recording: no node is asked about a tensor larger than any it saw. A line
     * recorded before this rule, whose maxima fabricate and which carries no real occurrence,
     * fails here, so a stale recording cannot ship. And every node rebuilt from its largest
     * occurrence answers each layout predicate as its maxima do, unless its op reads none
     * (reads_no_layout_predicate). */
    if (argc > 1) {
        int files = 0, nodes = 0, from_largest = 0, allowed = 0, flips = 0;
        for (const auto &entry : std::filesystem::directory_iterator(argv[1])) {
            if (entry.path().extension() != ".ops") continue;
            std::ifstream f(entry.path()); std::stringstream ss; ss << f.rdbuf();
            sk_op_recording rec; std::string perr;
            const std::string name = entry.path().filename().string();
            if (!sk_ops_parse(ss.str(), rec, perr)) { check(false, name + " does not parse: " + perr); continue; }
            ++files;
            // The line each identity first appears on, for the messages (a recording that merges
            // two lines of one identity, as translate's does, names the first).
            std::vector<std::pair<int, sk_op_desc>> lines;
            {
                std::istringstream ls(ss.str()); std::string l; int no = 0;
                while (std::getline(ls, l)) {
                    ++no;
                    sk_op_recording one; std::string e;
                    if (l.rfind("op=", 0) == 0 && sk_ops_parse(l + "\n", one, e) && one.nodes.size() == 1)
                        lines.emplace_back(no, one.nodes[0]);
                }
            }
            for (const sk_op_desc &d : rec.nodes) {
                ++nodes;
                int line = 0;
                for (const auto &p : lines) if (p.second.same_node(d)) { line = p.first; break; }
                const std::string where = name + ":" + std::to_string(line);
                std::string why;
                if (!rebuilt_within_max_bytes(d, why)) check(false, where + ": " + sk_op_spelling(d, nullptr) + ": " + why);
                if (!sk_op_uses_largest(d)) continue;
                ++from_largest;
                flips += layout_flips(d, where, allowed);
            }
        }
        check(files > 0, std::string("no .ops file in ") + argv[1]);
        std::printf("test_ops_format: %d shipped recordings, %d nodes rebuilt, %d from their largest occurrence; "
                    "%d layout flips on allowlisted ops, %d outside the allowlist\n",
                    files, nodes, from_largest, allowed, flips);
    }
    if (g_failures) std::fprintf(stderr, "test_ops_format: %d failures\n", g_failures);
    return g_failures ? 1 : 0;
}
