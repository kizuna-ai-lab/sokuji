/* audiocpp_compat.h — force-included into every audio.cpp translation unit.
 *
 * audio.cpp v0.7.0 carries a ggml fork (base 0.12.0) that differs from the pristine
 * upstream ggml 0.22.0 we build on in TWO ways. This header covers both, and the
 * distinction matters: (A) fails to LINK if you get it wrong, (B) fails silently.
 *
 * (A) SEVEN SYMBOLS THE FORK ADDS. audio.cpp's *framework* code references them
 *     unconditionally, but none of the six families we build (moss_tts_nano, qwen3_tts,
 *     omnivoice, pocket_tts, supertonic, silero_vad) reaches them at run time on
 *     CPU / Vulkan / Metal — see the spec, §2 and §4.4:
 *   - col2im_1d is upstream since 0.20.2 (identical signature): nothing to do.
 *     Re-verified 2026-09-01 — the two bodies derive the same output shape from the
 *     same formula; upstream only adds contiguity/dtype/padding asserts the fork
 *     lacked, so a graph the fork silently accepted can now abort loudly. That is a
 *     robustness change, not a numeric one.
 *   - the fast im2col conv and the bias+mask flash attention reproduce the fork's
 *     *graph* out of upstream ops, node for node, following the fork's own bodies
 *     (external/ggml/src/ggml.c at v0.7.0: lines 4579-4596 and 5597-5660). They are
 *     not shorthand for a nearby upstream call: upstream ggml_conv_1d materialises
 *     im2col in F16 where the fork uses the kernel's dtype (that is (B) below), and
 *     upstream ggml_flash_attn_ext has no bias argument at all.
 *   - pack4 matmul maps to plain ggml_mul_mat (the fork only takes it on CUDA).
 *   - graph_set_n_nodes is the 3-line setter the fork adds to ggml.c.
 *   - SageAttention2 / ConvRot (MiniMax-H3 only, CUDA-only kernels) abort: the
 *     family is not compiled, so reaching them is a bug, not a fallback.
 *
 * (B) FOUR SHARED SYMBOLS WHOSE BEHAVIOUR UPSTREAM CHANGED — ruling R11. The conv
 *     constructors keep the same name and signature on both ggml versions, so nothing
 *     fails to link and no compiler warns; they simply build a different graph. See
 *     the "conv family" block below for what that cost and how it was found.
 *
 * SCAN STATUS (2026-09-01, ruling R11). The public API surface was diffed both ways.
 * Symbols declared only in the fork's ggml.h are exactly the seven in (A), so (A) is
 * provably complete. Of the 372 symbols declared in BOTH, 20 have a differing ggml.c
 * body, and the only one that changes VALUES at a call site audio.cpp reaches is the
 * conv family in (B). The residue is recorded in native/README.md's compat-header
 * section so a future ggml bump can re-run the same pass instead of re-deriving it.
 *
 * If a family ever fails parity on upstream ggml, port THAT op's kernel or constructor
 * here — do not resurrect the fork. */
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

/* ===== (B) conv family — upstream's im2col dtype default, ruling R11 ==============
 *
 * Unlike everything else in this header, these four are NOT fork-private: they exist on
 * both ggml versions with the same name and the same signature. Only the im2col buffer's
 * dtype differs, and only inside the body:
 *
 *     fork      ggml_im2col(..., a->type)
 *     upstream  ggml_im2col(..., a->type == GGML_TYPE_BF16 ? GGML_TYPE_F32 : GGML_TYPE_F16)
 *
 * For the F32 kernels every family here carries, upstream therefore rounds the conv's
 * ACTIVATIONS to half precision before the matmul: ~1.2e-4 RMS relative error where an
 * F32 path gives ~1e-7. Nothing links wrong, nothing warns, and audio still comes out —
 * which is exactly why this survived two parity rounds as an "unexplained residual".
 * What caught it: supertonic's duration predictor is a regression whose output is
 * truncated to a sample count (runtime.cpp: trim = duration_seconds * sample_rate), so
 * the fp16 im2col moved its prediction by 1.77e-4 relative and the WAV by 14 samples
 * (82653 -> 82639). With these shims that case is sample-exact against the official CLI.
 *
 * Bodies are the fork's verbatim (external/ggml/src/ggml.c at the pinned audio.cpp
 * commit: lines 4560, 4611, 4681, 4758). Each was diffed against upstream's definition
 * line by line: the dtype argument is the ONLY difference, and ggml_im2col /
 * ggml_im2col_3d themselves are byte-identical across the two versions.
 *
 * Reachability, so the set is neither larger nor smaller than it needs to be:
 *   - conv_1d     modules::Conv1dModule, hift/campplus encoders -> supertonic (proven)
 *   - conv_1d_dw  qwen3_tts/tokenizer_speech_decoder.cpp:546 -> qwen3_tts, a family with
 *                 no model downloaded yet; it lands on this the day one is
 *   - conv_2d     modules::Conv2dModule, campplus encoder
 *   - conv_3d     modules::Conv3dModule
 * ggml_conv_2d_dw is deliberately NOT shimmed: there the fork hard-codes F16 and it is
 * UPSTREAM that widens (for BF16 kernels only), so upstream is equal-or-better.
 *
 * The #defines below are safe because this header is force-included into audio.cpp's
 * targets only (native/CMakeLists.txt), never into ggml's own translation units — so
 * ggml.c's internal callers (ggml_conv_1d_ph, ggml_conv_1d_dw_ph, ggml_conv_2d_sk_p0,
 * ggml_conv_2d_s1_ph) keep resolving to upstream's F16 bodies. audio.cpp calls none of
 * those four convenience wrappers today; if it ever starts, that call silently regains
 * the F16 im2col and needs its own shim here. */
static inline struct ggml_tensor *sokuji_ggml_conv_1d(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, int s0, int p0, int d0) {
    struct ggml_tensor *im2col = ggml_im2col(ctx, a, b, s0, 0, p0, 0, d0, 0, false, a->type);  /* [N, OL, IC*K] */

    struct ggml_tensor *result =
        ggml_mul_mat(ctx,
                ggml_reshape_2d(ctx, im2col, im2col->ne[0], (im2col->ne[2] * im2col->ne[1])),  /* [N*OL, IC*K] */
                ggml_reshape_2d(ctx, a, (a->ne[0] * a->ne[1]), a->ne[2]));                     /* [OC, IC*K]  */

    return ggml_reshape_3d(ctx, result, im2col->ne[1], a->ne[2], im2col->ne[2]);               /* [N, OC, OL] */
}

static inline struct ggml_tensor *sokuji_ggml_conv_1d_dw(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, int s0, int p0, int d0) {
    struct ggml_tensor *new_b  = ggml_reshape_4d(ctx, b, b->ne[0], 1, b->ne[1], b->ne[2]);
    struct ggml_tensor *im2col = ggml_im2col(ctx, a, new_b, s0, 0, p0, 0, d0, 0, false, a->type);
    struct ggml_tensor *result = ggml_mul_mat(ctx, im2col, a);

    return ggml_reshape_3d(ctx, result, result->ne[0], result->ne[2], 1);
}

static inline struct ggml_tensor *sokuji_ggml_conv_2d(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b,
        int s0, int s1, int p0, int p1, int d0, int d1) {
    struct ggml_tensor *im2col = ggml_im2col(ctx, a, b, s0, s1, p0, p1, d0, d1, true, a->type);  /* [N, OH, OW, IC*KH*KW] */

    struct ggml_tensor *result =
        ggml_mul_mat(ctx,
                ggml_reshape_2d(ctx, im2col, im2col->ne[0], im2col->ne[3] * im2col->ne[2] * im2col->ne[1]),
                ggml_reshape_2d(ctx, a, (a->ne[0] * a->ne[1] * a->ne[2]), a->ne[3]));            /* [OC, IC*KH*KW] */

    result = ggml_reshape_4d(ctx, result, im2col->ne[1], im2col->ne[2], im2col->ne[3], a->ne[3]);
    return ggml_cont(ctx, ggml_permute(ctx, result, 0, 1, 3, 2));                                /* [N, OC, OH, OW] */
}

static inline struct ggml_tensor *sokuji_ggml_conv_3d(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, int64_t IC,
        int s0, int s1, int s2, int p0, int p1, int p2, int d0, int d1, int d2) {
    struct ggml_tensor *im2col =
        ggml_im2col_3d(ctx, a, b, IC, s0, s1, s2, p0, p1, p2, d0, d1, d2, a->type);              /* [N*OD, OH, OW, IC*KD*KH*KW] */

    const int64_t OC = a->ne[3] / IC;
    const int64_t N  = b->ne[3] / IC;
    struct ggml_tensor *result =
        ggml_mul_mat(ctx,
                ggml_reshape_2d(ctx, im2col, im2col->ne[0], im2col->ne[3] * im2col->ne[2] * im2col->ne[1]),
                ggml_reshape_2d(ctx, a, (a->ne[0] * a->ne[1] * a->ne[2] * IC), OC));

    const int64_t OD = im2col->ne[3] / N;
    result = ggml_reshape_4d(ctx, result, im2col->ne[1] * im2col->ne[2], OD, N, OC);
    result = ggml_cont(ctx, ggml_permute(ctx, result, 0, 1, 3, 2));
    return ggml_reshape_4d(ctx, result, im2col->ne[1], im2col->ne[2], OD, OC * N);                /* [N*OC, OD, OH, OW] */
}

/* Object-like, so `&ggml_conv_1d` redirects too. Placed after all four definitions so
 * none of them can rewrite a name it is itself spelling. */
#define ggml_conv_1d    sokuji_ggml_conv_1d
#define ggml_conv_1d_dw sokuji_ggml_conv_1d_dw
#define ggml_conv_2d    sokuji_ggml_conv_2d
#define ggml_conv_3d    sokuji_ggml_conv_3d

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
