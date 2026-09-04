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
    r.source_file = "supertonic-3-f16.gguf"; r.dtypes_in_file = {"f16", "f32"};
    sk_op_desc d{};
    d.op = GGML_OP_MUL_MAT; d.dst_type = GGML_TYPE_F32;
    d.src_type = {SK_SRC_WEIGHT, GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    d.ne0_src0 = 1024; d.ne0_src1 = 1024; d.ne0_dst = 1024;
    d.max_ne_src0 = {1024, 1024, 1, 1}; d.max_ne_src1 = {1024, 7, 1, 1}; d.max_ne_dst = {1024, 7, 1, 1};
    d.contig_src0 = d.contig_src1 = true; d.max_bytes = 4194304;
    r.nodes.push_back(d);
    sk_op_desc u{};
    u.op = GGML_OP_UNARY; u.op_params[0] = GGML_UNARY_OP_GELU; u.dst_type = GGML_TYPE_F32;
    u.src_type = {GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    u.ne0_src0 = 4096; u.ne0_dst = 4096; u.max_ne_src0 = {4096, 7, 1, 1}; u.max_ne_dst = {4096, 7, 1, 1};
    u.contig_src0 = true; u.max_bytes = 114688;
    r.nodes.push_back(u);

    std::string text = sk_ops_format(r);
    assert(text.find("# stage: tts ; family: supertonic") != std::string::npos);
    assert(text.find("# dtypes-in-file: f16 f32") != std::string::npos);
    sk_op_recording back; std::string err;
    assert(sk_ops_parse(text, back, err));
    assert(back.nodes.size() == 2 && back.family == "supertonic" && back.dtypes_in_file.size() == 2);
    assert(back.nodes[0].src_type[0] == SK_SRC_WEIGHT && back.nodes[0].max_bytes == 4194304 && back.nodes[0].max_ne_src1[1] == 7);
    assert(back.nodes[1].op_params[0] == GGML_UNARY_OP_GELU);
    assert(sk_op_spelling(back.nodes[0], "q8_0") == "MUL_MAT[q8_0,f32,-,-,-]->f32");
    assert(sk_op_spelling(back.nodes[1], nullptr) == "UNARY.GELU[f32,-,-,-,-]->f32");
    // identity ignores the sequence axes: a second node differing only in max_ne merges
    sk_op_desc d2 = d; d2.max_ne_src1 = {1024, 300, 1, 1}; d2.max_bytes = 9000000;
    std::vector<sk_op_desc> v = {d}; sk_ops_add(v, d2);
    assert(v.size() == 1 && v[0].max_ne_src1[1] == 300 && v[0].max_bytes == 9000000);
    assert(!sk_ops_parse("op=NOPE dst=f32\n", back, err) && !err.empty());
    // Controller ruling: non-numeric params=/maxbytes= fields must fail cleanly (false +
    // error), not throw std::invalid_argument/std::out_of_range out of sk_ops_parse.
    std::string bad_params_line = "op=MUL_MAT params=" + std::string(128, 'z') + " dst=f32 src=[f32,-,-,-,-]\n";
    assert(!sk_ops_parse(bad_params_line, back, err) && !err.empty());
    assert(!sk_ops_parse("op=MUL_MAT maxbytes=abc dst=f32 src=[f32,-,-,-,-]\n", back, err) && !err.empty());
    return 0;
}
