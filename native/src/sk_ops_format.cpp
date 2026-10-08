/* The .ops text form (spec A §3.2), and the WEIGHT dtype rule the query and the recorder share.
 * Pure: ggml's name tables are the only thing it touches, so it compiles into the library and,
 * unchanged, straight into the test binaries. */
#include "sk_ops.h"
#include "sokuji_native.h"   // SK_DEVICE_* for sk_ops_device_word
#include "ggml.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <stdexcept>
#include <tuple>

namespace {

int32_t type_from_name(const std::string &s) {
    if (s == "-") return SK_SRC_ABSENT;
    if (s == "WEIGHT") return SK_SRC_WEIGHT;
    for (int t = 0; t < GGML_TYPE_COUNT; ++t) {
        const char *n = ggml_type_name(static_cast<ggml_type>(t));
        if (n && s == n) return t;
    }
    return -100;
}
std::string type_name(int32_t t, const char *weight) {
    if (t == SK_SRC_ABSENT) return "-";
    if (t == SK_SRC_WEIGHT) return weight ? weight : "WEIGHT";
    return ggml_type_name(static_cast<ggml_type>(t));
}
int32_t op_from_name(const std::string &s) {
    for (int o = 0; o < GGML_OP_COUNT; ++o) if (s == ggml_op_name(static_cast<ggml_op>(o))) return o;
    return -1;
}
std::string param_suffix(const sk_op_desc &d) {
    if (d.op == GGML_OP_UNARY) return std::string(".") + ggml_unary_op_name(static_cast<ggml_unary_op>(d.op_params[0]));
    if (d.op == GGML_OP_GLU)   return std::string(".") + ggml_glu_op_name(static_cast<ggml_glu_op>(d.op_params[0]));
    if (d.op == GGML_OP_ROPE)  return ".mode" + std::to_string(d.op_params[2]);
    return "";
}
std::string ne_str(const std::array<int64_t, 4> &a) {
    return "[" + std::to_string(a[0]) + "," + std::to_string(a[1]) + "," + std::to_string(a[2]) + "," + std::to_string(a[3]) + "]";
}
bool parse_ne(const std::string &s, std::array<int64_t, 4> &out) {
    long long a = 0, b = 0, c = 0, e = 0;
    if (std::sscanf(s.c_str(), "[%lld,%lld,%lld,%lld]", &a, &b, &c, &e) != 4) return false;
    out = {a, b, c, e};
    return true;
}
std::string hexparams(const sk_op_desc &d) {
    bool any = false; for (int v : d.op_params) any |= v != 0;
    if (!any) return "-";
    char buf[16]; std::string s;
    for (int v : d.op_params) { std::snprintf(buf, sizeof buf, "%08x", static_cast<uint32_t>(v)); s += buf; }
    return s;
}
/* Hardened against a garbage payload: every caller trusts this bool + error contract, and
 * sk_device_supports_ops parses a shipped .ops file at first use — a bad field must never
 * throw std::invalid_argument/std::out_of_range through it. */
bool parse_params(const std::string &s, std::array<int32_t, 16> &out) {
    out.fill(0);
    if (s == "-") return true;
    if (s.size() != 16 * 8) return false;
    for (int i = 0; i < 16; ++i) {
        const std::string chunk = s.substr(i * 8, 8);
        if (!std::all_of(chunk.begin(), chunk.end(), [](unsigned char c) { return std::isxdigit(c) != 0; })) return false;
        try {
            out[i] = static_cast<int32_t>(std::stoul(chunk, nullptr, 16));
        } catch (const std::exception &) {
            return false;
        }
    }
    return true;
}
void max_into(std::array<int64_t, 4> &a, const std::array<int64_t, 4> &b) { for (int i = 0; i < 4; ++i) a[i] = std::max(a[i], b[i]); }

/* "<p0><p1><p2><p3><d|s>", e.g. "0123d" contiguous, "1023d" transposed, "0213d" a
 * row-contiguous permute, "0123s" a strided view. */
std::string layout_str(const sk_layout &l) {
    std::string s;
    for (int k = 0; k < 4; ++k) s += static_cast<char>('0' + l.perm[k]);
    s += l.dense ? 'd' : 's';
    return s;
}
bool parse_layout(const std::string &s, sk_layout &out) {
    if (s.size() != 5) return false;
    bool seen[4] = {false, false, false, false};
    for (int k = 0; k < 4; ++k) {
        if (s[k] < '0' || s[k] > '3') return false;
        const int a = s[k] - '0';
        if (seen[a]) return false;                    // must be a permutation
        seen[a] = true;
        out.perm[k] = a;
    }
    if (s[4] != 'd' && s[4] != 's') return false;
    out.dense = s[4] == 'd';
    return true;
}

/* ggml_nbytes (ggml.c) of a `type` tensor with this ne and nb, without building one. */
uint64_t nbytes_as_ggml(int32_t type, const std::array<int64_t, 4> &ne, const std::array<int64_t, 4> &nb) {
    for (int64_t n : ne) if (n <= 0) return 0;
    const ggml_type t = static_cast<ggml_type>(type);
    const int64_t blck = static_cast<int64_t>(ggml_blck_size(t));
    int64_t bytes = blck == 1 ? static_cast<int64_t>(ggml_type_size(t)) + (ne[0] - 1) * nb[0] : ne[0] * nb[0] / blck;
    for (int i = 1; i < 4; ++i) bytes += (ne[i] - 1) * nb[i];
    return static_cast<uint64_t>(bytes);
}

/* A node's maxima as an occurrence-shaped value: the shapes a node is rebuilt from by default. */
sk_op_instance maxima_of(const sk_op_desc &d) {
    sk_op_instance m;
    m.ne_src0 = d.max_ne_src0; m.ne_src1 = d.max_ne_src1; m.ne_dst = d.max_ne_dst;
    if (!d.lay_src0.dense) m.nb_src0 = d.lay_src0.nb;
    if (!d.lay_src1.dense) m.nb_src1 = d.lay_src1.nb;
    if (!d.lay_dst.dense)  m.nb_dst = d.lay_dst.nb;
    return m;
}

/* Whether src0, src1 and dst at these shapes, with the node's dtypes and layouts, each hold at
 * most max_bytes: measured by ggml_nbytes, the measure max_bytes was taken with (a dense layout's
 * strides are the packed ones its rebuild gets). An absent source is skipped, and so is a WEIGHT,
 * whose dtype the query picks. */
bool fits(const sk_op_desc &d, const sk_op_instance &in) {
    struct Tensor { int32_t type; const std::array<int64_t, 4> &ne; const sk_layout &lay; const std::array<int64_t, 4> &nb; };
    const Tensor tensors[] = {{d.src_type[0], in.ne_src0, d.lay_src0, in.nb_src0},
                              {d.src_type[1], in.ne_src1, d.lay_src1, in.nb_src1},
                              {d.dst_type, in.ne_dst, d.lay_dst, in.nb_dst}};
    for (const Tensor &t : tensors) {
        if (t.type < 0) continue;                              // SK_SRC_ABSENT or SK_SRC_WEIGHT
        const std::array<int64_t, 4> nb = t.lay.dense ? sk_layout_dense_nb(t.lay.perm, t.ne, t.type) : t.nb;
        if (nbytes_as_ggml(t.type, t.ne, nb) > d.max_bytes) return false;
    }
    return true;
}

/* Between occurrences of equal max_bytes, the one kept is the greater by these shapes, so a
 * merge's result does not depend on the order its occurrences arrive in. */
bool shapes_less(const sk_op_instance &a, const sk_op_instance &b) {
    return std::tie(a.ne_dst, a.ne_src0, a.ne_src1, a.nb_dst, a.nb_src0, a.nb_src1) <
           std::tie(b.ne_dst, b.ne_src0, b.ne_src1, b.nb_dst, b.nb_src0, b.nb_src1);
}

/* The real*= fields of one parsed line, held to what sk_ops_format can have written: all three
 * shapes, a stride set exactly for each strided layout, on the identity's own row lengths,
 * inside the maxima, and only on a line whose maxima exceed maxbytes while the occurrence does
 * not. `seen` has bit 0/1/2 for real0/real1/reald and 3/4/5 for realnb0/realnb1/realnbd. Returns
 * the reason the fields are refused, or "". */
std::string check_largest(const sk_op_desc &d, const sk_op_instance &in, unsigned seen) {
    if ((seen & 7u) != 7u) return "real0, real1 and reald go together";
    struct Tensor {
        const char *suffix; const std::array<int64_t, 4> &ne, &max; int64_t ne0;
        const sk_layout &lay; const std::array<int64_t, 4> &nb; bool has_nb;
    };
    const Tensor tensors[] = {
        {"0", in.ne_src0, d.max_ne_src0, d.ne0_src0, d.lay_src0, in.nb_src0, (seen & 8u) != 0},
        {"1", in.ne_src1, d.max_ne_src1, d.ne0_src1, d.lay_src1, in.nb_src1, (seen & 16u) != 0},
        {"d", in.ne_dst, d.max_ne_dst, d.ne0_dst, d.lay_dst, in.nb_dst, (seen & 32u) != 0},
    };
    for (const Tensor &t : tensors) {
        const std::string real = std::string("real") + t.suffix, realnb = std::string("realnb") + t.suffix;
        if (t.ne[0] != t.ne0) return real + " is not the identity's ne0";
        for (int i = 0; i < 4; ++i)
            if (t.ne[i] < 1 || t.ne[i] > t.max[i]) return real + " is outside max" + t.suffix;
        if (t.lay.dense && t.has_nb) return realnb + " on a dense layout";
        if (!t.lay.dense && !t.has_nb) return "a strided layout needs " + realnb;
        if (t.has_nb)
            for (int i = 0; i < 4; ++i)
                if (t.nb[i] < 0 || t.nb[i] > t.lay.nb[i]) return realnb + " is outside nb" + t.suffix;
    }
    if (fits(d, maxima_of(d))) return "real fields on a node whose maxima fit maxbytes";
    if (!fits(d, in)) return "the real occurrence exceeds maxbytes";
    return "";
}

}  // namespace

std::array<int64_t, 4> sk_layout_dense_nb(const std::array<int32_t, 4> &perm,
                                          const std::array<int64_t, 4> &ne, int32_t type) {
    const ggml_type t = static_cast<ggml_type>(type);
    std::array<int64_t, 4> nb{0, 0, 0, 0};
    int64_t acc = static_cast<int64_t>(ggml_type_size(t));
    for (int k = 0; k < 4; ++k) {
        const int a = perm[k];
        if (a < 0 || a > 3) return {0, 0, 0, 0};
        nb[a] = acc;
        // ggml's own rule: the innermost axis advances by one BLOCK per blck_size elements.
        acc *= (k == 0) ? (ne[a] / static_cast<int64_t>(ggml_blck_size(t))) : ne[a];
    }
    return nb;
}

ggml_tensor *sk_ops_rebuild_node(ggml_context *ctx, const sk_op_desc &d, int32_t weight_type) {
    auto concrete = [&](int32_t t) -> ggml_type { return static_cast<ggml_type>(t == SK_SRC_WEIGHT ? weight_type : t); };
    /* Build the tensor with the RECORDED layout, so ggml_is_contiguous,
     * ggml_is_contiguous_rows, ggml_is_contiguous_1/2, ggml_is_transposed and nb[0] ==
     * type_size all answer as they did on the real graph.
     *
     * Both non-natural branches build their base IN STRIDE ORDER and then ggml_permute back.
     * ggml_permute(a, perm[0..3]) sets result->ne[perm[k]] = a->ne[k] and
     * result->nb[perm[k]] = a->nb[k] (ggml.c:3840-3848), so a base whose axis k is the
     * recorded axis perm[k] lands on exactly the recorded ne and nb.
     *   dense   -> a packed base of ne[perm[0..3]]; its packed strides ARE the recorded ones.
     *   strided -> ggml_view_4d of ne[perm[0..3]] with nb[perm[1..3]] on a base big enough to
     *              cover the last addressed byte.
     * Round 2 got the strided branch wrong by passing the axis-indexed ne/nb straight to
     * ggml_view_4d — which already yields the recorded ne and nb, the permutation being
     * implicit in the strides — and THEN permuting, applying it twice: pocket_tts's
     * CONT `max0=[512,544,1,1] layout=[1023s,…] nb0=[2240,4,1146880,1146880]` came out as
     * ne=[544,512,1,1] nb=[4,4,…], flipping both ggml_is_transposed and
     * ggml_is_contiguous_rows.
     *
     * ggml_view_4d fixes the VIEW's nb[0] at type_size. That is right here because the view is
     * built in stride order, so its axis 0 is the recorded smallest-stride axis — type_size in
     * every shipped row (the recorded nb values are 119x 4, 4x 2 and one 2240, and the 2240 is
     * an outer axis of that same row). After the permute the innermost recorded stride is
     * restored, so the 2240 row rebuilds with nb[0] == 2240. A recording whose SMALLEST stride
     * exceeded one element is not expressible as a ggml view; none occurs. */
    auto mk = [&](int32_t t, const std::array<int64_t, 4> &ne, const sk_layout &lay) -> ggml_tensor * {
        if (t == SK_SRC_ABSENT) return nullptr;
        const ggml_type ct = concrete(t);
        const bool natural = lay.perm[0] == 0 && lay.perm[1] == 1 && lay.perm[2] == 2 && lay.perm[3] == 3;
        if (lay.dense) {
            if (natural) return ggml_new_tensor_4d(ctx, ct, ne[0], ne[1], ne[2], ne[3]);
            ggml_tensor *base = ggml_new_tensor_4d(ctx, ct, ne[lay.perm[0]], ne[lay.perm[1]], ne[lay.perm[2]], ne[lay.perm[3]]);
            return ggml_permute(ctx, base, lay.perm[0], lay.perm[1], lay.perm[2], lay.perm[3]);
        }
        int64_t span = 0;                                       // last addressed byte, from the recorded strides
        for (int a = 0; a < 4; ++a) span += (ne[a] - 1) * lay.nb[a];
        const int64_t ts = static_cast<int64_t>(ggml_type_size(ct));
        const int64_t blk = static_cast<int64_t>(ggml_blck_size(ct));
        int64_t elems = ts > 0 ? ((span + ts) / ts) * blk : 1;
        elems = std::max<int64_t>(elems, blk);
        if (elems % blk != 0) elems += blk - elems % blk;        // ggml_new_tensor asserts on this
        ggml_tensor *base = ggml_new_tensor_1d(ctx, ct, elems);
        ggml_tensor *view = ggml_view_4d(ctx, base,
                                         ne[lay.perm[0]], ne[lay.perm[1]], ne[lay.perm[2]], ne[lay.perm[3]],
                                         static_cast<size_t>(lay.nb[lay.perm[1]]),
                                         static_cast<size_t>(lay.nb[lay.perm[2]]),
                                         static_cast<size_t>(lay.nb[lay.perm[3]]), 0);
        if (natural) return view;
        return ggml_permute(ctx, view, lay.perm[0], lay.perm[1], lay.perm[2], lay.perm[3]);
    };
    /* The maxima, unless they describe a tensor larger than any the graph held: then the largest
     * real occurrence (sk_op_uses_largest). That occurrence ran, so it keeps every relation the
     * maxima are taken verbatim to keep (sk_ops.cpp's ask), and a strided layout takes its own
     * strides, not the merged ones. It is not the least contiguous shape, as the maxima are: an
     * extent-1 axis can make it contiguous where a smaller occurrence is not. test_ops_format
     * fails such a flip outside the ops whose supports_op reads no layout predicate. */
    const sk_op_instance in = sk_op_uses_largest(d) ? *d.largest : maxima_of(d);
    auto strides = [](sk_layout lay, const std::array<int64_t, 4> &nb) { if (!lay.dense) lay.nb = nb; return lay; };
    ggml_tensor *node = mk(d.dst_type, in.ne_dst, strides(d.lay_dst, in.nb_dst));
    if (!node) return nullptr;
    // The dst carries the recorded ne/nb, but it must present as a plain node, not as a view of
    // the scaffolding that gave it that layout: it is about to become the OP itself, and a
    // node with both an op and a view_src is a shape ggml never builds.
    node->view_src = nullptr; node->view_offs = 0;
    node->op = static_cast<ggml_op>(d.op);
    std::memcpy(node->op_params, d.op_params.data(), sizeof node->op_params);
    node->src[0] = mk(d.src_type[0], in.ne_src0, strides(d.lay_src0, in.nb_src0));
    node->src[1] = mk(d.src_type[1], in.ne_src1, strides(d.lay_src1, in.nb_src1));
    for (int i = 2; i < 5; ++i) node->src[i] = mk(d.src_type[i], {d.max_ne_src1[0], 1, 1, 1}, sk_layout{});
    return node;
}

sk_layout sk_layout_of(const ggml_tensor *t) {
    sk_layout l;
    if (!t) return l;
    std::array<int64_t, 4> ne{t->ne[0], t->ne[1], t->ne[2], t->ne[3]}, nb{
        static_cast<int64_t>(t->nb[0]), static_cast<int64_t>(t->nb[1]),
        static_cast<int64_t>(t->nb[2]), static_cast<int64_t>(t->nb[3])};
    // Axis order by ascending stride. Ties (an axis of extent 1 shares its neighbour's stride)
    // break by axis index, so the natural order wins whenever it can — a tensor ggml itself
    // would call contiguous never records as permuted.
    std::array<int32_t, 4> perm{0, 1, 2, 3};
    std::stable_sort(perm.begin(), perm.end(), [&](int32_t a, int32_t b) { return nb[a] < nb[b]; });
    l.perm = perm;
    l.nb = nb;
    l.dense = sk_layout_dense_nb(perm, ne, t->type) == nb;
    return l;
}

std::string sk_op_spelling(const sk_op_desc &d, const char *weight) {
    std::string s = ggml_op_name(static_cast<ggml_op>(d.op)) + param_suffix(d) + "[";
    for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], weight); }
    return s + "]->" + type_name(d.dst_type, weight);
}

namespace {

/* audio.cpp families (the pinned 54aa279) that build a device weight without the weight store's
 * BF16 → F16 conversion, so a bf16 in their file can stay bf16 on Vulkan or Metal. Found by
 * reading every loader under src/models and src/community_models for the three ways around it:
 * the file's own type handed to make_tensor, a derived tensor stored at the file's dtype, a
 * non-Native default storage. Families not compiled in today are listed too. Kept sorted. */
const char *const kRawTypedWeightFamilies[] = {
    // community_models/audio8_tts/ar.cpp:384-392 (wqkv) and 408-421 (gate/up), codec.cpp:787-809
    // (codec wqkv split into q/k/v): require_tensor at the session storage, make_tensor(.type).
    "audio8_tts",
    // models/breeze_tts/speech_decoder.cpp:194-208 (conv1x1 output_proj as a linear) and
    // generator.cpp:251-275 (packed projections): make_tensor(data.type / packed_type).
    "breeze_tts",
    // models/dramabox/dit.cpp:54-90 through framework/modules/packed_linear_weights.cpp:51-82:
    // PackedLinearWeightsBuilder::build packs require_tensor rows into make_tensor(packed_type).
    "dramabox",
    // models/fish_audio/ar.cpp:353-368 (packed qkv) and 378-391 (packed gate/up): make_tensor(.type).
    "fish_audio",
    // models/higgs_audio_tts/ar.cpp:168-192 (packed qkv) and 212-232 (packed gate/up).
    "higgs_audio_tts",
    // models/index_tts2/gpt.cpp:363-374 (transposed conv1d linear stored at the file's dtype
    // through make_from_f32) and vocoder.cpp:54-65 (BigVGAN storage set to the file's dtype).
    "index_tts2",
    // models/kugelaudio/ar.cpp:72-80: the four lm_head speech rows, make_tensor(head.type).
    "kugelaudio",
    // community_models/moss_voicegen: weight storage defaults to BF16 (include/engine/
    // community_models/moss_voicegen/session.h:56), a non-Native storage the store never converts.
    "moss_voicegen",
    // models/qwen3_tts/tokenizer_speech_decoder.cpp:317-334 (load_conv1x1_as_linear, used for
    // the speech decoder's output_proj at 382-395): make_tensor(data.type) at Native storage.
    "qwen3_tts",
    // community_models/vieneu_v3_turbo/tokenizer_speech_decoder.cpp:309-326: qwen3_tts's loader.
    "vieneu_v3_turbo",
    // Not listed, though their sources hold such a path that never runs on Vulkan or Metal:
    // irodori_tts packs q/k/v/gate at the file's dtype (models/irodori_tts/rf_dit.cpp:164-194)
    // on CUDA only (:256-259); miotts loads its MioCodec at F32 storage (include/engine/models/
    // miocodec/weights.h:157, models/miotts/session.cpp:612-616), so the codec's Native q/k/v
    // packing (models/miocodec/weights.cpp:191-215) never runs for it. miocodec on its own is a
    // VoiceConversion/SpeechToSpeech family (models/miocodec/loader.cpp:14-16), never a tts one.
};

}  // namespace

std::vector<std::string> sk_ops_loaded_weight_dtypes(const std::string &stage, const std::string &family,
                                                     const std::string &device, const std::string &dtype) {
    // backend_weight_store.h:281-284 (audio.cpp): Vulkan or Metal, and a Native BF16 source.
    const bool converts = stage == "tts" && (device == "vulkan" || device == "metal") &&
                          dtype == ggml_type_name(GGML_TYPE_BF16);
    if (!converts) return {dtype};
    const std::string f16 = ggml_type_name(GGML_TYPE_F16);
    for (const char *raw : kRawTypedWeightFamilies)
        if (family == raw) return {dtype, f16};
    return {f16};
}

std::vector<std::string> sk_ops_asked_weight_dtypes(const std::string &stage, const std::string &family,
                                                    const std::string &device, const std::vector<std::string> &dtypes) {
    std::vector<std::string> out;
    auto add = [&out](const std::string &held) {
        if (std::find(out.begin(), out.end(), held) == out.end()) out.push_back(held);
    };
    for (const std::string &dtype : dtypes)
        for (const std::string &held : sk_ops_loaded_weight_dtypes(stage, family, device, dtype)) add(held);
    // audio.cpp builds some tts weights as F32 whatever the file holds, on every backend:
    // make_f32, and a tensor derived at Native storage (type_for_derived_storage),
    // include/engine/framework/core/backend_weight_store.h:133-142 and 246-251.
    if (stage == "tts") add(ggml_type_name(GGML_TYPE_F32));
    return out;
}

const char *sk_ops_device_word(int32_t kind) {
    switch (kind) {
        case SK_DEVICE_VULKAN: return "vulkan";
        case SK_DEVICE_METAL:  return "metal";
        case SK_DEVICE_CPU:    return "cpu";
        default:               return "gpu";
    }
}

bool sk_op_uses_largest(const sk_op_desc &d) {
    return d.largest && !fits(d, maxima_of(d)) && fits(d, *d.largest);
}

void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d) {
    // A descriptor without an occurrence of its own is one occurrence: its maxima are its shapes.
    const sk_op_instance mine = d.largest ? *d.largest : maxima_of(d);
    for (auto &n : nodes) {
        if (!n.same_node(d)) continue;
        const sk_op_instance kept = n.largest ? *n.largest : maxima_of(n);
        const bool larger = d.max_bytes > n.max_bytes || (d.max_bytes == n.max_bytes && shapes_less(kept, mine));
        n.largest = larger ? mine : kept;
        max_into(n.max_ne_src0, d.max_ne_src0); max_into(n.max_ne_src1, d.max_ne_src1); max_into(n.max_ne_dst, d.max_ne_dst);
        max_into(n.lay_src0.nb, d.lay_src0.nb); max_into(n.lay_src1.nb, d.lay_src1.nb); max_into(n.lay_dst.nb, d.lay_dst.nb);
        n.max_bytes = std::max(n.max_bytes, d.max_bytes);
        return;
    }
    nodes.push_back(d);
    nodes.back().largest = mine;
}

std::string sk_ops_format(const sk_op_recording &r) {
    std::string s;
    s += "# stage: " + r.stage + " ; family: " + r.family + "\n";
    s += "# engine: " + r.engine + "\n";
    s += "# source: " + r.source_file + "\n";
    s += "# recorded-on: " + (r.recorded_on.empty() ? std::string("cpu") : r.recorded_on) + "\n";
    s += "# dtypes-in-file:"; for (const auto &t : r.dtypes_in_file) s += " " + t; s += "\n";
    for (const auto &d : r.nodes) {
        s += "op=" + std::string(ggml_op_name(static_cast<ggml_op>(d.op)));
        s += " params=" + hexparams(d);
        s += " dst=" + type_name(d.dst_type, nullptr);
        s += " src=["; for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], nullptr); } s += "]";
        s += " ne0=[" + std::to_string(d.ne0_src0) + "," + std::to_string(d.ne0_src1) + "," + std::to_string(d.ne0_dst) + "]";
        s += " max0=" + ne_str(d.max_ne_src0) + " max1=" + ne_str(d.max_ne_src1) + " maxd=" + ne_str(d.max_ne_dst);
        s += " layout=[" + layout_str(d.lay_src0) + "," + layout_str(d.lay_src1) + "," + layout_str(d.lay_dst) + "]";
        // Strides only where they are not implied by perm + ne.
        if (!d.lay_src0.dense) s += " nb0=" + ne_str(d.lay_src0.nb);
        if (!d.lay_src1.dense) s += " nb1=" + ne_str(d.lay_src1.nb);
        if (!d.lay_dst.dense)  s += " nbd=" + ne_str(d.lay_dst.nb);
        s += " host=" + std::to_string(d.host ? 1 : 0);
        s += " maxbytes=" + std::to_string(d.max_bytes);
        // Only where the maxima describe a tensor larger than any the graph held: the largest
        // real occurrence, appended, so every other line reads exactly as before the rule.
        if (sk_op_uses_largest(d)) {
            const sk_op_instance &l = *d.largest;
            s += " real0=" + ne_str(l.ne_src0) + " real1=" + ne_str(l.ne_src1) + " reald=" + ne_str(l.ne_dst);
            if (!d.lay_src0.dense) s += " realnb0=" + ne_str(l.nb_src0);
            if (!d.lay_src1.dense) s += " realnb1=" + ne_str(l.nb_src1);
            if (!d.lay_dst.dense)  s += " realnbd=" + ne_str(l.nb_dst);
        }
        s += "\n";
    }
    return s;
}

bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error) {
    out = sk_op_recording{};
    std::istringstream in(text);
    std::string line; int lineno = 0;
    auto fail = [&](const std::string &m) { error = "line " + std::to_string(lineno) + ": " + m; return false; };
    while (std::getline(in, line)) {
        ++lineno;
        if (line.empty()) continue;
        if (line[0] == '#') {
            if (line.rfind("# stage: ", 0) == 0) {
                auto semi = line.find(" ; family: ");
                if (semi == std::string::npos) return fail("bad stage/family header");
                out.stage = line.substr(9, semi - 9); out.family = line.substr(semi + 11);
            } else if (line.rfind("# engine: ", 0) == 0) out.engine = line.substr(10);
            else if (line.rfind("# source: ", 0) == 0) out.source_file = line.substr(10);
            else if (line.rfind("# recorded-on: ", 0) == 0) out.recorded_on = line.substr(15);
            else if (line.rfind("# dtypes-in-file:", 0) == 0) {
                std::istringstream ts(line.substr(17)); std::string t;
                while (ts >> t) out.dtypes_in_file.push_back(t);
            }
            continue;
        }
        sk_op_desc d{};
        sk_op_instance real; unsigned real_seen = 0;   // check_largest's bits
        std::istringstream fs(line); std::string kv; int seen = 0;
        while (fs >> kv) {
            auto eq = kv.find('='); if (eq == std::string::npos) return fail("bad field " + kv);
            std::string k = kv.substr(0, eq), v = kv.substr(eq + 1);
            if (k == "op") { d.op = op_from_name(v); if (d.op < 0) return fail("unknown op " + v); ++seen; }
            else if (k == "params") { if (!parse_params(v, d.op_params)) return fail("bad params"); }
            else if (k == "dst") { d.dst_type = type_from_name(v); if (d.dst_type == -100) return fail("bad dst type " + v); ++seen; }
            else if (k == "src") {
                if (v.size() < 2 || v.front() != '[' || v.back() != ']') return fail("bad src list");
                std::istringstream ss(v.substr(1, v.size() - 2)); std::string t; int i = 0;
                while (std::getline(ss, t, ',') && i < 5) { d.src_type[i] = type_from_name(t); if (d.src_type[i] == -100) return fail("bad src type " + t); ++i; }
            }
            else if (k == "ne0") { long long a = 1, b = 1, c = 1; if (std::sscanf(v.c_str(), "[%lld,%lld,%lld]", &a, &b, &c) != 3) return fail("bad ne0"); d.ne0_src0 = a; d.ne0_src1 = b; d.ne0_dst = c; }
            else if (k == "max0") { if (!parse_ne(v, d.max_ne_src0)) return fail("bad max0"); }
            else if (k == "max1") { if (!parse_ne(v, d.max_ne_src1)) return fail("bad max1"); }
            else if (k == "maxd") { if (!parse_ne(v, d.max_ne_dst)) return fail("bad maxd"); }
            /* `contig=` (the round-1 field) is deliberately NOT accepted: it falls through to
             * the unknown-field branch below, so a stale .ops file fails loudly instead of
             * being read with default layouts. */
            else if (k == "layout") {
                if (v.size() != 1 + 5 + 1 + 5 + 1 + 5 + 1 || v.front() != '[' || v.back() != ']') return fail("bad layout list");
                if (!parse_layout(v.substr(1, 5), d.lay_src0)) return fail("bad layout src0");
                if (v[6] != ',' || v[12] != ',') return fail("bad layout list");
                if (!parse_layout(v.substr(7, 5), d.lay_src1)) return fail("bad layout src1");
                if (!parse_layout(v.substr(13, 5), d.lay_dst)) return fail("bad layout dst");
            }
            else if (k == "nb0") { if (!parse_ne(v, d.lay_src0.nb)) return fail("bad nb0"); }
            else if (k == "nb1") { if (!parse_ne(v, d.lay_src1.nb)) return fail("bad nb1"); }
            else if (k == "nbd") { if (!parse_ne(v, d.lay_dst.nb)) return fail("bad nbd"); }
            else if (k == "host") {
                if (v != "0" && v != "1") return fail("bad host");
                d.host = v == "1";
            }
            else if (k == "maxbytes") {
                if (v.empty() || !std::all_of(v.begin(), v.end(), [](unsigned char c) { return std::isdigit(c) != 0; })) return fail("bad maxbytes");
                try {
                    d.max_bytes = std::stoull(v);
                } catch (const std::exception &) {
                    return fail("bad maxbytes");
                }
            }
            else if (k == "real0")   { if (!parse_ne(v, real.ne_src0)) return fail("bad real0");   real_seen |= 1u; }
            else if (k == "real1")   { if (!parse_ne(v, real.ne_src1)) return fail("bad real1");   real_seen |= 2u; }
            else if (k == "reald")   { if (!parse_ne(v, real.ne_dst))  return fail("bad reald");   real_seen |= 4u; }
            else if (k == "realnb0") { if (!parse_ne(v, real.nb_src0)) return fail("bad realnb0"); real_seen |= 8u; }
            else if (k == "realnb1") { if (!parse_ne(v, real.nb_src1)) return fail("bad realnb1"); real_seen |= 16u; }
            else if (k == "realnbd") { if (!parse_ne(v, real.nb_dst))  return fail("bad realnbd"); real_seen |= 32u; }
            else return fail("unknown field " + k);
        }
        if (seen < 2) return fail("op and dst are required");
        if (real_seen) {
            const std::string why = check_largest(d, real, real_seen);
            if (!why.empty()) return fail(why);
            d.largest = real;
        }
        sk_ops_add(out.nodes, d);
    }
    return true;
}
