/* Op recordings (spec A §3.2): what a family's graph asked of ggml, node by node, captured on
 * one real forward pass and rebuilt for ggml_backend_dev_supports_op. This header is the
 * shared model; sk_ops_format.cpp is the text form (pure — also compiled straight into the
 * test binaries, since the library exports only the sk_* C ABI), sk_ops_record.cpp (test
 * build) captures, cmake/gen_ops_data.py bakes the shipped .ops files into the library, and
 * sk_ops.cpp answers sk_device_supports_ops. */
#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>

constexpr int32_t SK_SRC_ABSENT = -1;
constexpr int32_t SK_SRC_WEIGHT = -2;   // rung-bearing weight (src0 of MUL_MAT / MUL_MAT_ID / GET_ROWS): expanded per dtype at query time

struct sk_op_desc {
    int32_t op = 0;
    std::array<int32_t, 16> op_params{};
    int32_t dst_type = 0;
    std::array<int32_t, 5> src_type{SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    /* Identity includes ne[0] (row length: block sizes, head sizes) but NOT the sequence
     * axes ne[1..3], which vary per decode step; those are kept as maxima for the rebuild. */
    int64_t ne0_src0 = 1, ne0_src1 = 1, ne0_dst = 1;
    std::array<int64_t, 4> max_ne_src0{1, 1, 1, 1}, max_ne_src1{1, 1, 1, 1}, max_ne_dst{1, 1, 1, 1};
    bool contig_src0 = true, contig_src1 = true;
    uint64_t max_bytes = 0;      // largest ggml_nbytes seen among src0/src1/dst for this identity
    bool same_node(const sk_op_desc &o) const {
        return op == o.op && op_params == o.op_params && dst_type == o.dst_type && src_type == o.src_type &&
               ne0_src0 == o.ne0_src0 && ne0_src1 == o.ne0_src1 && ne0_dst == o.ne0_dst &&
               contig_src0 == o.contig_src0 && contig_src1 == o.contig_src1;
    }
};

struct sk_op_recording {
    std::string stage, family, engine, source_file;
    std::vector<std::string> dtypes_in_file;    // ggml_type_name() of every tensor dtype in the GGUF, sorted
    std::vector<sk_op_desc> nodes;
};

std::string sk_ops_format(const sk_op_recording &r);
bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error);
/* "OP.param[src0,src1,src2,src3,src4]->dst" with ggml_op_name()/ggml_type_name(); "-" for an
 * absent source; WEIGHT sources spelled as `weight_type_name` (nullptr → "WEIGHT"). UNARY/GLU
 * carry their kind after the dot; ROPE its mode; everything else no suffix. */
std::string sk_op_spelling(const sk_op_desc &d, const char *weight_type_name);
/* Insert or merge: an equal identity keeps one entry and takes the element-wise max of the
 * ne maxima and max_bytes. */
void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d);
