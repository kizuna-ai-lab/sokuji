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

/* EXACT layout of one recorded tensor, replacing the old single "contiguous?" bool.
 *
 * Fix round 2 (F1): one bool cannot distinguish the two ways a tensor is non-contiguous, and
 * the backends check predicates that tell them apart. A PERMUTE that keeps ne[0] innermost
 * (`ggml_permute(x,0,2,1,3)`) leaves rows contiguous; a TRANSPOSE does not. Modelling every
 * non-contiguous source as a transpose refused irodori_tts's ROPE on Vulkan
 * (ggml-vulkan wants `ggml_is_contiguous_rows(src0)`) although the real graph satisfies it.
 *
 * `perm` is the axis order by ASCENDING stride — perm[k] is the axis with the k-th smallest
 * nb. {0,1,2,3} is ggml's natural order; {1,0,2,3} is a transpose; {0,2,1,3} is a
 * row-contiguous permute. `dense` says nb equals the packed layout under that permutation
 * (nb[perm[k]] = type_size × ∏ ne[perm[j<k]], the first factor divided by the block size), so
 * a dense tensor is fully described by perm + ne and is rebuilt by permuting a packed base.
 * A STRIDED tensor (a view into something larger) additionally carries its `nb` and is rebuilt
 * with ggml_view_4d on a base big enough to hold it — never grown, since the strides are the
 * thing being modelled. */
struct sk_layout {
    std::array<int32_t, 4> perm{0, 1, 2, 3};
    bool dense = true;
    std::array<int64_t, 4> nb{0, 0, 0, 0};   // recorded only when !dense; merged as a maximum, like the ne maxima
    /* Identity is perm + dense. `nb` is deliberately NOT part of it: a view into a growing KV
     * cache has strides that scale with the step, exactly like ne[1..3], and folding them into
     * the identity would multiply one node into one entry per decode step. */
    bool same_layout(const sk_layout &o) const { return perm == o.perm && dense == o.dense; }
};

struct sk_op_desc {
    int32_t op = 0;
    std::array<int32_t, 16> op_params{};
    int32_t dst_type = 0;
    std::array<int32_t, 5> src_type{SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    /* Identity includes ne[0] (row length: block sizes, head sizes) but NOT the sequence
     * axes ne[1..3], which vary per decode step; those are kept as maxima for the rebuild. */
    int64_t ne0_src0 = 1, ne0_src1 = 1, ne0_dst = 1;
    std::array<int64_t, 4> max_ne_src0{1, 1, 1, 1}, max_ne_src1{1, 1, 1, 1}, max_ne_dst{1, 1, 1, 1};
    sk_layout lay_src0, lay_src1, lay_dst;
    /* Fix round 2 (F2): true when this node was computed on a HOST (CPU) backend. audio.cpp
     * builds a different graph per backend TYPE — pocket_tts's FlowLM is pinned to a host
     * graph plan (uses_host_graph_plan), and conv/cast helpers keep f16 kernels on host while
     * casting to f32 on a device — so a host-pinned subgraph is never asked of a GPU and must
     * not gate one. sk_device_supports_ops skips these unless the target IS a CPU device. */
    bool host = false;
    uint64_t max_bytes = 0;      // largest ggml_nbytes seen among src0/src1/dst for this identity
    bool same_node(const sk_op_desc &o) const {
        return op == o.op && op_params == o.op_params && dst_type == o.dst_type && src_type == o.src_type &&
               ne0_src0 == o.ne0_src0 && ne0_src1 == o.ne0_src1 && ne0_dst == o.ne0_dst &&
               lay_src0.same_layout(o.lay_src0) && lay_src1.same_layout(o.lay_src1) &&
               lay_dst.same_layout(o.lay_dst) && host == o.host;
    }
};

struct sk_op_recording {
    std::string stage, family, engine, source_file;
    /* ggml's device kind the model was loaded on for this recording ("vulkan", "metal",
     * "cpu"). TTS recordings must be taken on a non-host device — see sk_ops.cpp. */
    std::string recorded_on;
    std::vector<std::string> dtypes_in_file;    // ggml_type_name() of every tensor dtype in the GGUF, sorted
    std::vector<sk_op_desc> nodes;
};

/* The packed nb a tensor of this ne/type would have under `perm`. */
std::array<int64_t, 4> sk_layout_dense_nb(const std::array<int32_t, 4> &perm,
                                          const std::array<int64_t, 4> &ne, int32_t type);
/* Read a live tensor's layout (recorder side; also used by the round-trip tests). */
sk_layout sk_layout_of(const struct ggml_tensor *t);

std::string sk_ops_format(const sk_op_recording &r);
bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error);
/* "OP.param[src0,src1,src2,src3,src4]->dst" with ggml_op_name()/ggml_type_name(); "-" for an
 * absent source; WEIGHT sources spelled as `weight_type_name` (nullptr → "WEIGHT"). UNARY/GLU
 * carry their kind after the dot; ROPE its mode; everything else no suffix. */
std::string sk_op_spelling(const sk_op_desc &d, const char *weight_type_name);
/* Insert or merge: an equal identity keeps one entry and takes the element-wise max of the
 * ne maxima and max_bytes. */
void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d);
