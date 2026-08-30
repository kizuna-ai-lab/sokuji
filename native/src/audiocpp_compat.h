/* audiocpp_compat.h — force-included into every audio.cpp translation unit.
 *
 * audio.cpp v0.7.0 carries a ggml fork with six private ops. Its *framework* code
 * references them unconditionally, but none of the six families we build
 * (moss_tts_nano, qwen3_tts, omnivoice, pocket_tts, supertonic, silero_vad) reaches
 * them at run time on CPU / Vulkan / Metal — see the spec, §2 and §4.4. We therefore
 * build audio.cpp on pristine upstream ggml and provide these symbols here:
 *   - col2im_1d is upstream since 0.20.2 (identical signature): nothing to do.
 *   - the fast im2col conv and pack4 matmul map to their plain upstream ops.
 *   - the bias+mask flash-attention wrapper folds the dense bias into the mask.
 *   - graph_set_n_nodes is the 3-line setter the fork adds to ggml.c.
 *   - SageAttention2 / ConvRot (MiniMax-H3 only, CUDA-only kernels) abort: the
 *     family is not compiled, so reaching them is a bug, not a fallback.
 * If a family ever fails parity on upstream ggml, port THAT op's kernel here —
 * do not resurrect the fork. */
#pragma once
#include "ggml.h"
#include "ggml-impl.h"   /* struct ggml_cgraph — audio.cpp is built from ggml sources, so this is available */

#ifdef __cplusplus
extern "C" {
#endif

static inline struct ggml_tensor *ggml_conv_1d_fast_1d_im2col(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, int s0, int p0, int d0) {
    return ggml_conv_1d(ctx, a, b, s0, p0, d0);
}

static inline struct ggml_tensor *ggml_mul_mat_pack4(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b) {
    return ggml_mul_mat(ctx, a, b);
}

/* Upstream flash attention takes one additive mask. The fork's wrapper takes a dense
 * additive bias plus an optional mask; folding them is exact because both are added
 * to the scores before softmax. Upstream requires the mask to be F16. */
static inline struct ggml_tensor *ggml_flash_attn_ext_with_bias_mask(
        struct ggml_context *ctx, struct ggml_tensor *q, struct ggml_tensor *k, struct ggml_tensor *v,
        struct ggml_tensor *bias, struct ggml_tensor *mask, float scale, float max_bias, float logit_softcap) {
    struct ggml_tensor *m = mask;
    if (bias != NULL) {
        struct ggml_tensor *b16 = bias->type == GGML_TYPE_F16 ? bias : ggml_cast(ctx, bias, GGML_TYPE_F16);
        m = mask != NULL ? ggml_add(ctx, b16, mask) : b16;
    }
    return ggml_flash_attn_ext(ctx, q, k, v, m, scale, max_bias, logit_softcap);
}

static inline void ggml_graph_set_n_nodes(struct ggml_cgraph *cgraph, int n_nodes) {
    GGML_ASSERT(n_nodes >= 0);
    GGML_ASSERT(n_nodes <= cgraph->size);
    cgraph->n_nodes = n_nodes;
}

static inline struct ggml_tensor *ggml_sage_attn2(
        struct ggml_context *ctx, struct ggml_tensor *q, struct ggml_tensor *k, struct ggml_tensor *v,
        float scale, bool causal) {
    (void)ctx; (void)q; (void)k; (void)v; (void)scale; (void)causal;
    GGML_ABORT("ggml_sage_attn2: MiniMax-H3 op, not built in sokuji-native");
}

static inline struct ggml_tensor *ggml_sage_attn2_i8(
        struct ggml_context *ctx, struct ggml_tensor *q_i8, struct ggml_tensor *k_i8, struct ggml_tensor *v,
        struct ggml_tensor *q_scale, struct ggml_tensor *k_scale, float scale, bool causal) {
    (void)ctx; (void)q_i8; (void)k_i8; (void)v; (void)q_scale; (void)k_scale; (void)scale; (void)causal;
    GGML_ABORT("ggml_sage_attn2_i8: MiniMax-H3 op, not built in sokuji-native");
}

static inline struct ggml_tensor *ggml_convrot_linear(
        struct ggml_context *ctx, struct ggml_tensor *weight_i8, struct ggml_tensor *input,
        struct ggml_tensor *weight_scale, struct ggml_tensor *bias, int group_size) {
    (void)ctx; (void)weight_i8; (void)input; (void)weight_scale; (void)bias; (void)group_size;
    GGML_ABORT("ggml_convrot_linear: MiniMax-H3 op, not built in sokuji-native");
}

#ifdef __cplusplus
}
#endif
