/* Spec A §3.2: the .ops text form is the only thing that crosses from the recording build
 * into the shipping library, so it must round-trip exactly — including the WEIGHT sentinel,
 * the op-param blob and the ne maxima the rebuild needs. Pure: no backend, runs everywhere. */
#undef NDEBUG
#include <cassert>
#include <string>
#include "sk_ops.h"
#include "ggml.h"

int main() {
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

    std::string text = sk_ops_format(r);
    assert(text.find("# stage: tts ; family: supertonic") != std::string::npos);
    assert(text.find("# dtypes-in-file: f16 f32") != std::string::npos);
    assert(text.find("# recorded-on: vulkan") != std::string::npos);
    assert(text.find("layout=[0213d,0123s,0123d]") != std::string::npos);
    assert(text.find("nb1=[4,8192,8192,8192]") != std::string::npos);
    assert(text.find("host=1") != std::string::npos);
    assert(text.find("contig=") == std::string::npos);    // the round-1 field is gone
    sk_op_recording back; std::string err;
    assert(sk_ops_parse(text, back, err));
    assert(back.nodes.size() == 3 && back.family == "supertonic" && back.dtypes_in_file.size() == 2);
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
    return 0;
}
