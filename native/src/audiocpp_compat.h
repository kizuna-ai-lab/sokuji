/* audiocpp_compat.h — force-included into every audio.cpp translation unit.
 *
 * audio.cpp v0.7.0 carries a ggml fork with six private ops. Its *framework* code
 * references them unconditionally, but none of the six families we build
 * (moss_tts_nano, qwen3_tts, omnivoice, pocket_tts, supertonic, silero_vad) reaches
 * them at run time on CPU / Vulkan / Metal — see the spec, §2 and §4.4. We therefore
 * build audio.cpp on pristine upstream ggml and provide these symbols here:
 *   - col2im_1d is upstream since 0.20.2 (identical signature): nothing to do.
 *   - the fast im2col conv and the bias+mask flash attention reproduce the fork's
 *     *graph* out of upstream ops, node for node, following the fork's own bodies
 *     (external/ggml/src/ggml.c at v0.7.0: lines 4579-4596 and 5597-5660). They are
 *     not shorthand for a nearby upstream call: upstream ggml_conv_1d materialises
 *     im2col in F16 where the fork uses the kernel's dtype, and upstream
 *     ggml_flash_attn_ext has no bias argument at all.
 *   - pack4 matmul maps to plain ggml_mul_mat (the fork only takes it on CUDA).
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

/* Fork ggml.c:4579-4596. The fork's own op is ggml_im2col with the result's op tag
 * rewritten to a private IM2COL_FAST_1D kernel, so the graph is upstream's im2col +
 * mul_mat + reshape — with one difference that matters: the fork asks im2col for the
 * KERNEL's dtype (a->type), where upstream ggml_conv_1d hard-codes F16 (F32 for BF16
 * kernels). Calling ggml_conv_1d here would silently round an F32 conv through F16, so
 * the body is spelled out instead. */
static inline struct ggml_tensor *ggml_conv_1d_fast_1d_im2col(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, int s0, int p0, int d0) {
    struct ggml_tensor *im2col = ggml_im2col(ctx, a, b, s0, 0, p0, 0, d0, 0, false, a->type);  /* [N, OL, IC*K] */

    struct ggml_tensor *result =
        ggml_mul_mat(ctx,
                ggml_reshape_2d(ctx, im2col, im2col->ne[0], (im2col->ne[2] * im2col->ne[1])),  /* [N*OL, IC*K] */
                ggml_reshape_2d(ctx, a, (a->ne[0] * a->ne[1]), a->ne[2]));                     /* [OC, IC*K]  */

    return ggml_reshape_3d(ctx, result, im2col->ne[1], a->ne[2], im2col->ne[2]);               /* [N, OC, OL] */
}

static inline struct ggml_tensor *ggml_mul_mat_pack4(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b) {
    return ggml_mul_mat(ctx, a, b);
}

/* Fork ggml.c:5597-5660. Upstream flash attention takes one additive F16 mask and no
 * bias. The fork builds that mask out of the dense relative-position bias plus the
 * optional attention mask, and the order is load-bearing: flash attention scales QK
 * only, while the reference path adds the bias BEFORE the scale — so the bias is
 * pre-scaled here (ggml_scale by `scale`) and the mask, which the reference adds after
 * the scale, is not. The fork's own asserts (bias present, q/k/bias shapes) are left to
 * ggml's; the NULL-bias branch below is ours, and degenerates to plain upstream. */
static inline struct ggml_tensor *ggml_flash_attn_ext_with_bias_mask(
        struct ggml_context *ctx, struct ggml_tensor *q, struct ggml_tensor *k, struct ggml_tensor *v,
        struct ggml_tensor *bias, struct ggml_tensor *mask, float scale, float max_bias, float logit_softcap) {
    if (bias == NULL) {
        return ggml_flash_attn_ext(ctx, q, k, v, mask, scale, max_bias, logit_softcap);
    }
    if (!ggml_is_contiguous(bias)) {
        bias = ggml_cont(ctx, bias);
    }
    struct ggml_tensor *effective_mask = ggml_scale(ctx, bias, scale);   /* F32, [n_kv, n_q, ...] */
    if (mask != NULL) {
        /* The fork adds an F16-or-F32 mask straight onto the F32 bias; upstream's add
         * has no (F32, F16) kernel, so promote first — same values, one extra node. */
        if (mask->type != GGML_TYPE_F32) {
            if (!ggml_is_contiguous(mask)) {
                mask = ggml_cont(ctx, mask);
            }
            mask = ggml_cast(ctx, mask, GGML_TYPE_F32);
        }
        if (!ggml_are_same_shape(mask, effective_mask)) {
            mask = ggml_repeat(ctx, mask, effective_mask);       /* broadcast over heads/batch */
        }
        effective_mask = ggml_add(ctx, effective_mask, mask);
    }
    /* ggml_flash_attn_ext wants a contiguous F16 mask. */
    if (!ggml_is_contiguous(effective_mask)) {
        effective_mask = ggml_cont(ctx, effective_mask);
    }
    if (effective_mask->type != GGML_TYPE_F16) {
        effective_mask = ggml_cast(ctx, effective_mask, GGML_TYPE_F16);
    }
    if (!ggml_is_contiguous(effective_mask)) {
        effective_mask = ggml_cont(ctx, effective_mask);
    }
    return ggml_flash_attn_ext(ctx, q, k, v, effective_mask, scale, max_bias, logit_softcap);
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
