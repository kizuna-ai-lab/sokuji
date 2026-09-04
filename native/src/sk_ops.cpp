#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"
#include "sk_ops.h"
#include "sk_ops_data.h"

#include "ggml.h"
#include "ggml-backend.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace {

std::mutex g_ops_mutex;
std::map<std::string, sk_op_recording> g_parsed;   // "stage/family" -> parsed once

const sk_op_recording *recording_for(const std::string &stage, const std::string &family, std::string &err) {
    std::lock_guard<std::mutex> l(g_ops_mutex);
    const std::string key = stage + "/" + family;
    auto it = g_parsed.find(key);
    if (it != g_parsed.end()) return &it->second;
    for (int i = 0; i < sk_ops_blob_count_; ++i) {
        if (stage == sk_ops_blobs[i].stage && family == sk_ops_blobs[i].family) {
            sk_op_recording r;
            if (!sk_ops_parse(sk_ops_blobs[i].text, r, err)) return nullptr;   // a shipped file that fails to parse is SK_ERR_INTERNAL
            return &(g_parsed[key] = std::move(r));
        }
    }
    return nullptr;
}

int32_t type_by_name(const char *name) {
    for (int t = 0; t < GGML_TYPE_COUNT; ++t) {
        const char *n = ggml_type_name(static_cast<ggml_type>(t));
        if (n && std::strcmp(n, name) == 0) return t;
    }
    return -1;
}

/* Rebuild one recorded node with a concrete weight type at the recorded ne[0] (block sizes
 * stay valid) and the recorded maxima on the other axes, grown so nbytes reaches max_bytes
 * (buffer-range checks are asked at the real size), and ask the device. Nothing is allocated
 * on the device; nothing runs. */
bool ask(ggml_backend_dev_t dev, const sk_op_desc &d, int32_t weight_type, std::string &spelling_out) {
    ggml_init_params ip = { 64 * 1024, nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) return false;
    auto concrete = [&](int32_t t) -> ggml_type { return static_cast<ggml_type>(t == SK_SRC_WEIGHT ? weight_type : t); };
    auto grow = [&](std::array<int64_t, 4> ne, ggml_type t) {
        const int64_t row_bytes = ggml_row_size(t, ne[0]);
        if (row_bytes > 0) {
            const int64_t have = row_bytes * ne[1] * ne[2] * ne[3];
            if (have < static_cast<int64_t>(d.max_bytes)) ne[1] = (static_cast<int64_t>(d.max_bytes) + row_bytes * ne[2] * ne[3] - 1) / (row_bytes * ne[2] * ne[3]);
        }
        return ne;
    };
    auto mk = [&](int32_t t, const std::array<int64_t, 4> &ne0, bool contig) -> ggml_tensor * {
        if (t == SK_SRC_ABSENT) return nullptr;
        const ggml_type ct = concrete(t);
        std::array<int64_t, 4> ne = grow(ne0, ct);
        if (contig) return ggml_new_tensor_4d(ctx, ct, ne[0], ne[1], ne[2], ne[3]);
        // The recorder stores the ne the NODE saw (sk_ops_record.cpp: src[i]->ne[k], after any
        // view), so a non-contiguous source must be rebuilt with that same ne. ggml_transpose
        // swaps ne[0] and ne[1], so the base tensor is allocated with them already swapped and
        // the view then carries the recorded shape. Transposing a base built at the recorded ne
        // (as this did before) asks the backend about a DIFFERENT tensor: index_tts2's masked
        // FLASH_ATTN_EXT records K as non-contiguous [64,1518,20,3], and the swapped rebuild
        // handed ggml-vulkan HSK = 1518, failing its `HSK % 8 == 0` gate — a false refusal of
        // the whole family on every Vulkan device. Only src0/src1 carry a recorded contiguity
        // flag, and no WEIGHT source is ever non-contiguous, so the swapped allocation never
        // meets a blocked dtype's row-length constraint.
        return ggml_transpose(ctx, ggml_new_tensor_4d(ctx, ct, ne[1], ne[0], ne[2], ne[3]));
    };
    ggml_tensor *node = ggml_new_tensor_4d(ctx, concrete(d.dst_type), d.max_ne_dst[0], d.max_ne_dst[1], d.max_ne_dst[2], d.max_ne_dst[3]);
    node->op = static_cast<ggml_op>(d.op);
    std::memcpy(node->op_params, d.op_params.data(), sizeof node->op_params);
    node->src[0] = mk(d.src_type[0], d.max_ne_src0, d.contig_src0);
    node->src[1] = mk(d.src_type[1], d.max_ne_src1, d.contig_src1);
    for (int i = 2; i < 5; ++i) node->src[i] = mk(d.src_type[i], {d.max_ne_src1[0], 1, 1, 1}, true);
    bool ok = ggml_backend_dev_supports_op(dev, node);
    spelling_out = sk_op_spelling(d, weight_type >= 0 ? ggml_type_name(static_cast<ggml_type>(weight_type)) : nullptr);
    ggml_free(ctx);
    return ok;
}

}  // namespace

extern "C" {

SK_API int32_t sk_ops_blob_count(void) { return sk_ops_blob_count_; }

SK_API sk_status sk_ops_blob_at(int32_t i, const char **stage, const char **family, const char **text) {
    if (i < 0 || i >= sk_ops_blob_count_ || !stage || !family || !text) return SK_ERR_INVALID_ARGUMENT;
    *stage = sk_ops_blobs[i].stage; *family = sk_ops_blobs[i].family; *text = sk_ops_blobs[i].text;
    return SK_OK;
}

SK_API sk_status sk_device_supports_ops(int32_t index, const char *stage, const char *family,
                                        const char *const *weight_dtypes, int32_t n_weight_dtypes,
                                        sk_op_coverage *out) {
    std::lock_guard<std::mutex> lock(sk::mutex());
    if (!out || !stage || !family || !weight_dtypes || n_weight_dtypes <= 0 || index < 0) {
        sk::set_error("sk_device_supports_ops: bad argument");
        return SK_ERR_INVALID_ARGUMENT;
    }
    if (!sk::require_init("sk_device_supports_ops")) return SK_ERR_NOT_INITIALISED;
    const auto &devs = sk::devices();
    if (static_cast<size_t>(index) >= devs.size()) { sk::set_error("sk_device_supports_ops: bad index"); return SK_ERR_INVALID_ARGUMENT; }
    std::vector<int32_t> wtypes;
    for (int32_t i = 0; i < n_weight_dtypes; ++i) {
        int32_t t = weight_dtypes[i] ? type_by_name(weight_dtypes[i]) : -1;
        if (t < 0) { sk::set_error(std::string("sk_device_supports_ops: unknown dtype ") + (weight_dtypes[i] ? weight_dtypes[i] : "NULL")); return SK_ERR_INVALID_ARGUMENT; }
        if (std::find(wtypes.begin(), wtypes.end(), t) == wtypes.end()) wtypes.push_back(t);   // dedupe, first-seen order
    }
    std::string err;
    const sk_op_recording *rec = recording_for(stage, family, err);
    if (!rec) {
        if (!err.empty()) { sk::set_error("sk_device_supports_ops: shipped recording unparseable: " + err); return SK_ERR_INTERNAL; }
        sk::set_error(std::string("sk_device_supports_ops: no recording for ") + stage + "/" + family);
        return SK_ERR_NOT_FOUND;
    }
    std::memset(out, 0, sizeof *out);
    out->all_supported = 1;
    try {
        for (const sk_op_desc &d : rec->nodes) {
            const bool has_weight = std::find(d.src_type.begin(), d.src_type.end(), SK_SRC_WEIGHT) != d.src_type.end();
            const std::vector<int32_t> expand = has_weight ? wtypes : std::vector<int32_t>{-1};
            for (int32_t wt : expand) {
                // A GGUF quantizer keeps a block-misaligned row length in f16/f32, never in a
                // blocked dtype (ggml_new_tensor's GGML_ASSERT(ne % blck_size == 0), compiled
                // out in Release, aborts in Debug): no GGUF can hold this WEIGHT tensor in a
                // dtype whose block size does not divide its recorded ne[0], so that dtype is
                // not a real possibility for this node and must not be asked — skip it, not the
                // node. f32/f16 (block size 1) are in every rung's fallback set, so the node is
                // still asked in the dtype the real file would actually use. WEIGHT is always
                // src0 by the recorder's rule (see SK_SRC_WEIGHT's doc in sk_ops.h), so only
                // ne0_src0 needs the check.
                if (has_weight && d.ne0_src0 % ggml_blck_size(static_cast<ggml_type>(wt)) != 0) continue;
                // Same shape, second rule: a WEIGHT node is the src0 of a MUL_MAT/MUL_MAT_ID/
                // GET_ROWS, so it can only ever hold a type a graph computes in — a float or a
                // quantized type. The integer types a GGUF header also lists (i32/i64) belong to
                // index/position tables, never to a rung weight, and asking a backend to MUL_MAT
                // an i64 is a question no real graph poses: ggml's Vulkan backend answers `false`
                // (no integer case in supports_op for MUL_MAT/MUL_MAT_ID; GET_ROWS takes I32 but
                // not I64), which would refuse every TTS family on every Vulkan device. Skip such
                // a dtype, not the node — the callers filter too (accel.weight_dtypes), but the
                // raw `# dtypes-in-file` sets stay the recordings' truth and any future caller
                // must be safe passing one straight through.
                if (has_weight) {
                    const ggml_type t = static_cast<ggml_type>(wt);
                    if (t != GGML_TYPE_F32 && t != GGML_TYPE_F16 && t != GGML_TYPE_BF16 && !ggml_is_quantized(t)) continue;
                }
                if (out->n_ops >= SK_OP_COVERAGE_MAX) { sk::set_error("sk_device_supports_ops: recording exceeds SK_OP_COVERAGE_MAX"); return SK_ERR_INTERNAL; }
                std::string spelling;
                const bool ok = ask(devs[index], d, wt, spelling);
                sk_op_check &c = out->ops[out->n_ops++];
                std::snprintf(c.name, sizeof c.name, "%s", spelling.c_str());
                c.supported = ok ? 1 : 0;
                if (!ok) out->all_supported = 0;
            }
        }
    } catch (...) {
        sk::set_error("sk_device_supports_ops: backend threw during supports_op (Vulkan device init?)");
        return SK_ERR_BACKEND;
    }
    return SK_OK;
}

}  // extern "C"
