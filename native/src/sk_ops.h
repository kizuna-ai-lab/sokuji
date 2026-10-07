/* Op recordings (spec A §3.2): what a family's graph asked of ggml, node by node, captured on
 * one real forward pass and rebuilt for ggml_backend_dev_supports_op. This header is the
 * shared model; sk_ops_format.cpp is the text form (pure — also compiled straight into the
 * test binaries, since the library exports only the sk_* C ABI), sk_ops_record.cpp (test
 * build) captures, cmake/gen_ops_data.py bakes the shipped .ops files into the library, and
 * sk_ops.cpp answers sk_device_supports_ops. */
#pragma once
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

constexpr int32_t SK_SRC_ABSENT = -1;
/* Rung-bearing weight (src0 of MUL_MAT / MUL_MAT_ID / GET_ROWS): expanded per dtype at query
 * time. The expansion set is the dtypes of the model GGUFs' matrix tensors; the recorder refuses
 * a WEIGHT whose dtype is outside that set (owner's ruling 2026-10-06, op-coverage precision). */
constexpr int32_t SK_SRC_WEIGHT = -2;

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

/* One occurrence's shapes: the ne of src0, src1 and dst, and the nb of each one whose layout is
 * strided (zero where dense, since perm + ne imply it). */
struct sk_op_instance {
    std::array<int64_t, 4> ne_src0{1, 1, 1, 1}, ne_src1{1, 1, 1, 1}, ne_dst{1, 1, 1, 1};
    std::array<int64_t, 4> nb_src0{0, 0, 0, 0}, nb_src1{0, 0, 0, 0}, nb_dst{0, 0, 0, 0};
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
    /* The largest real occurrence of this identity: the one whose max(nbytes(src0), nbytes(src1),
     * nbytes(dst)) is max_bytes; between equal ones, the greater shapes, so the choice does not
     * depend on the order occurrences arrive in. Not identity.
     *
     * Why: the maxima above are per axis, so one identity seen in two orientations merges into a
     * tensor that never existed. Echo-TTS's codec holds REPEAT [1,1024]->[1280,1024] and
     * [1,1,1024]->[1280,1,1024], 5.2 MB each, which merge to [1280,1024,1024,1], 5.37 GB, and
     * ggml-vulkan refuses a tensor past its buffer limit. Where the maxima rebuild such a tensor
     * (sk_op_uses_largest), the node is written with this occurrence and rebuilt from it (ruling
     * 2026-10-07, op-coverage precision).
     *
     * sk_ops_add sets it on every node it stores: from the descriptor's own when it carries one,
     * otherwise from its maxima (the recorder hands over one occurrence at a time, whose maxima
     * ARE that occurrence). sk_ops_parse reads it from a line's real*= fields; a line without
     * them gets its own maxima, which sk_op_uses_largest never prefers to themselves, so such a
     * line is rebuilt from its maxima as before. A descriptor that never went through sk_ops_add
     * has none. */
    std::optional<sk_op_instance> largest;
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
    std::vector<std::string> dtypes_in_file;    // ggml_type_name() of the matrix-tensor (ggml_n_dims >= 2) dtypes of the main GGUF and its companions, sorted
    std::vector<sk_op_desc> nodes;
};

/* The packed nb a tensor of this ne/type would have under `perm`. */
std::array<int64_t, 4> sk_layout_dense_nb(const std::array<int32_t, 4> &perm,
                                          const std::array<int64_t, 4> &ne, int32_t type);
/* Read a live tensor's layout (recorder side; also used by the round-trip tests). */
sk_layout sk_layout_of(const struct ggml_tensor *t);
/* True when a node is written with, and rebuilt from, its `largest` occurrence instead of its
 * maxima: the maxima rebuild a src0, src1 or dst whose ggml_nbytes exceeds max_bytes, a tensor
 * larger than any the graph held, and `largest` does not. A WEIGHT source is not compared, since
 * its dtype is the query's choice. Every other node is written, parsed and rebuilt from its
 * maxima, exactly as before the rule (ruling 2026-10-07, op-coverage precision).
 *
 * What the occurrence can miss that the maxima asked: an upper bound on one of ne[1..3] reached
 * only by a smaller occurrence, which no pinned backend's supports_op has, and non-contiguity,
 * since an extent-1 axis can make the occurrence contiguous where a smaller one is not (the
 * maxima are the identity's least contiguous shape). test_ops_format fails a shipped node whose
 * rebuild flips a layout predicate, outside the ops whose supports_op reads none. */
bool sk_op_uses_largest(const sk_op_desc &d);
/* Rebuild one recorded node and its sources in `ctx` (which must be no_alloc): each tensor
 * carries the recorded ne AND the recorded layout, so every predicate a backend's supports_op
 * reads answers as it did on the real graph. The ne (and a strided layout's nb) are the maxima,
 * or the largest real occurrence where sk_op_uses_largest says so. `weight_type` is the
 * concrete ggml type the WEIGHT sentinel stands for (-1 when the node has none). Returns the
 * node, or nullptr when the descriptor has no dst type. Lives here, beside the text form,
 * rather than in sk_ops.cpp: it touches only ggml's tensor constructors, so the tests can link
 * it directly and assert on the rebuilt shapes — sk_ops.cpp itself is the library's C ABI and
 * drags the whole runtime. */
struct ggml_tensor *sk_ops_rebuild_node(struct ggml_context *ctx, const sk_op_desc &d, int32_t weight_type);

/* The dtypes a WEIGHT whose file holds `dtype` (a ggml_type_name spelling) may be held in, and
 * so the dtypes a device is asked about, for `family` of `stage` on a device of kind `device` in
 * the `# recorded-on` vocabulary ("vulkan", "metal", "cpu", "gpu").
 *
 * The rule: audio.cpp's BackendWeightStore loads a tensor with Native storage whose file dtype
 * is BF16 as F16 when its backend is Vulkan or Metal (backend_weight_store.h:273-286,
 * backend_safe_loaded_storage_type), and keeps the file's dtype on a CPU. Sokuji passes no
 * weight_type option except moss_tts_local's, set to "native", so every family loads at its own
 * default storage, Native wherever a family does not choose another. llama.cpp and
 * transcribe.cpp load the file's dtype as is. So for stage "tts" on "vulkan" or "metal", "bf16"
 * is asked as "f16"; every other dtype, stage and target is unchanged.
 *
 * The exception: a family that builds some device weight without that store's conversion — the
 * file's own type handed to make_tensor, a derived tensor stored at the file's dtype, or a
 * non-Native default storage — can hold a bf16 WEIGHT on Vulkan or Metal, so for those a "bf16"
 * is asked both as "bf16" and as "f16" (the list, each entry with its source line, is in
 * sk_ops_format.cpp). That restores the pre-mapping question exactly where the rule does not
 * hold.
 *
 * Both sides use this one helper (ruling 2026-10-07, op-coverage precision):
 * sk_device_supports_ops maps each WEIGHT dtype through it before expanding, and
 * sk_record_end_to_file maps `# dtypes-in-file` through it, for the device that ran each live
 * WEIGHT (a host WEIGHT ran on the CPU), before checking it. The guard sees such a path only when
 * the recorded file holds bf16 there (qwen3_tts is recorded from a file whose output_proj is
 * f32), so the list comes from reading audio.cpp's loaders, not from the recordings. The header
 * itself keeps the files' own dtypes. */
std::vector<std::string> sk_ops_loaded_weight_dtypes(const std::string &stage, const std::string &family,
                                                     const std::string &device, const std::string &dtype);
/* The `# recorded-on` word for an SK_DEVICE_* kind: "vulkan", "metal", "cpu", else "gpu". The one
 * spelling sk_device_supports_ops and the recorder (record_common.h) both use. */
const char *sk_ops_device_word(int32_t kind);

std::string sk_ops_format(const sk_op_recording &r);
bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error);
/* "OP.param[src0,src1,src2,src3,src4]->dst" with ggml_op_name()/ggml_type_name(); "-" for an
 * absent source; WEIGHT sources spelled as `weight_type_name` (nullptr → "WEIGHT"). UNARY/GLU
 * carry their kind after the dot; ROPE its mode; everything else no suffix. */
std::string sk_op_spelling(const sk_op_desc &d, const char *weight_type_name);
/* Insert or merge: an equal identity keeps one entry and takes the element-wise max of the
 * ne maxima, of a strided layout's nb, and max_bytes, and keeps the larger `largest`. */
void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d);
