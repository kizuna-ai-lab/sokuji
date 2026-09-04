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

/* Rebuild one recorded node (sk_ops_rebuild_node, beside the text form so the tests can assert
 * on the shapes it produces) and ask the device. Nothing is allocated on the device; nothing
 * runs.
 *
 * Round 1 stretched each tensor along one axis until it reached `max_bytes`, to ask the
 * buffer-range checks at the real size. Round 2 dropped that, because the recorded maxima
 * already are the real size and the stretch is not safe:
 *   - max_ne_src0/src1/dst are ELEMENT-WISE maxima over every occurrence of the identity, so
 *     nbytes of the rebuilt tensor is >= nbytes of any occurrence's. The buffer-range check is
 *     already asked at least as large as anything the graph held.
 *   - stretching each tensor by its own factor breaks the relations the backends check between
 *     them. ggml-vulkan's MUL_MAT requires src0->ne[3] == src1->ne[3] (ggml-vulkan.cpp:18178);
 *     on index_tts2's [64,77,4,1] x [64,1,4,1] matmul the two independent stretches produced
 *     ne[3] = 1 and 77 and the family was refused. Taking the maxima verbatim preserves every
 *     equality and broadcast relation, since an element-wise max of equal values is equal.
 * max_bytes stays in the format as the merge's record of the largest tensor seen; it is simply
 * not a rebuild input. */
bool ask(ggml_backend_dev_t dev, const sk_op_desc &d, int32_t weight_type, std::string &spelling_out) {
    ggml_init_params ip = { 64 * 1024, nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) return false;
    ggml_tensor *node = sk_ops_rebuild_node(ctx, d, weight_type);
    if (!node) { ggml_free(ctx); return false; }
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
    // F2: audio.cpp builds a DIFFERENT graph for a host backend than for a device one, and a
    // recording carries both — a host-pinned subgraph (pocket_tts's FlowLM graph plan) plus the
    // device graph around it. Which side asks which:
    //   * a GPU target skips host-tagged nodes: audio.cpp never sends them to the device, so
    //     refusing the family over them is a false refusal (this is what made pocket_tts's
    //     CONV_TRANSPOSE_1D[f16,f32] and CPY[bf16,f16] — the HOST spellings of casts that are
    //     f32 on a device — refuse the card on every Vulkan box).
    //   * a CPU target asks them, because that is exactly where they run, and the CPU sweep in
    //     test_common.cpp asserts the whole recording is supported there.
    const bool cpu_target = ggml_backend_dev_type(devs[index]) == GGML_BACKEND_DEVICE_TYPE_CPU;
    try {
        for (const sk_op_desc &d : rec->nodes) {
            if (d.host && !cpu_target) continue;
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
    /* An expansion that asked NOTHING must never read as "fully supported": all_supported is
     * initialised to 1, so an empty result would tell the planner the family runs. It can only
     * happen if every node was skipped — a recording of nothing but host-tagged nodes, or a
     * dtype set that every WEIGHT node's block size rejects — and both are broken inputs, not
     * an answer about the device. */
    if (out->n_ops == 0) {
        out->all_supported = 0;
        sk::set_error(std::string("sk_device_supports_ops: no askable node in ") + stage + "/" + family);
        return SK_ERR_INTERNAL;
    }
    return SK_OK;
}

}  // extern "C"
