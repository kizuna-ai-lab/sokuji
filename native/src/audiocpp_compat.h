/* audiocpp_compat.h — force-included into every audio.cpp translation unit.
 *
 * audio.cpp v0.9.6 (upstream 04a37f2e; re-scanned at the 2026-11-28 pin bump) carries a ggml
 * fork (base 0.12.0) that differs from the pristine upstream ggml 1.1.1 we build on in the ways
 * below. This header covers all of these — (A)/(D)/(E)/(F)/(G) fail to COMPILE or LINK if you
 * get them wrong, (B) fails silently.
 *
 * (A) SEVEN SYMBOLS THE FORK ADDS. audio.cpp's *framework* code references them
 *     unconditionally, but none of the five original TTS families we build (moss_tts_nano,
 *     qwen3_tts, omnivoice, pocket_tts, supertonic) nor silero_vad reaches them at run
 *     time on CPU / Vulkan / Metal — see the spec, §2 and §4.4. The four families added
 *     2026-09-03 (voxcpm1, voxcpm2, irodori_tts, index_tts2) were not re-audited against
 *     this list; they link and synthesize on all three lanes, and their op recordings
 *     (src/ops/tts-*.ops) are the evidence of what they actually execute:
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
 * Symbols declared only in the fork's ggml.h are exactly the seven in (A), so (A) was
 * provably complete for 0.7.1 — see RESCAN below for 0.8.2, where (D)/(E) cover the rest.
 * Of the 372 symbols declared in BOTH, 20 have a differing ggml.c
 * body, and the only one that changes VALUES at a call site audio.cpp reaches is the
 * conv family in (B). The residue is recorded in native/README.md's compat-header
 * section so a future ggml bump can re-run the same pass instead of re-deriving it.
 *
 * RESCAN 2026-09-25 (audio.cpp ac16661d vs ggml 0.25.3): fork-only functions 7 -> 28, of which
 * (D) shims the reachable ones and (E) stubs the link-only ones; differing shared ggml.c
 * bodies 20 -> 22, the two new ones harmless (ggml_nbytes adds bytes only for the fork-only
 * I8_S/I2_S types; ggml_permute is upstream widening int -> int64_t/size_t). (B) unchanged.
 *
 * RESCAN 2026-11-28 (audio.cpp v0.9.6 04a37f2e vs ggml 1.1.1 bb877c0c; the fork still calls
 * itself 0.12.0). Fork-only functions 28 -> 62: the fork's own additions plus everything
 * ggml 1.0 "prune" removed or renamed (ggml_diag_mask_*, ggml_add1, ggml_rope_custom,
 * ggml_upscale_ext, ggml_type_sizef, ggml_*_set_prec, ...), and 22 enum/typedef/struct names
 * plus one renamed enumerator (GGML_PREC_DEFAULT). Only what we COMPILE needs anything: grep of
 * src/framework, include/engine/framework, our nine family directories, silero_vad,
 * marblenet_vad and controlfoley/flow_denoiser.cpp (engine_core lists it), cross-checked by the
 * build. (F) maps or shims what our families reach; (G) stubs what they provably do not; names
 * nothing we compile references (ggml_add1, ggml_rope_custom, ggml_diag_mask_inf_inplace,
 * ggml_diag_mask_zero, ggml_ssm_scan_set_lowering, ...) are deliberately absent.
 * Shared ggml.c bodies that differ fork vs upstream: 22 -> 45. Against the 0.25.3 we shipped,
 * the ones new at 1.1.1 are refactors (flash_attn_ext -> _impl, reshape/new_tensor pass a NULL
 * nb, int -> int64_t in the row converters, ggml_tri accepts F16/BF16, ggml_roll's bound
 * rewritten) plus TWO NEW CONSTRUCTOR CONTRACTS that no compiler sees and that abort at graph
 * build time: ggml_set_input asserts a leaf (op == GGML_OP_NONE), and ggml_view_2d/3d/4d assert
 * that a strided view's source has nb[0] == type size (no strided view of a transposed
 * tensor). The view contract is reached (pocket_tts, Mimi decoder) and is shimmed in (F6); the
 * ggml_set_input one has no evidence yet — all 12 recorded families pass it. ggml_conv_1d also changed
 * upstream: besides the (B) dtype it now lays a batch N > 1 out correctly (reshape to
 * [OL,N,OC], permute, cont). (B) keeps the fork's body: identical for N == 1, and for N > 1 it
 * is the fork's result, which is what audio.cpp is validated against. (B) otherwise unchanged:
 * ggml_im2col / ggml_im2col_3d are still byte-identical, the four conv bodies still differ only
 * in the im2col dtype.
 *
 * If a family ever fails parity on upstream ggml, port THAT op's kernel or constructor
 * here — do not resurrect the fork. */
#pragma once
#include <math.h>        /* INFINITY */
#include <string.h>      /* strcmp */
#include "ggml.h"
#include "ggml-backend.h"
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

/* ===== (D) audio.cpp 0.8.2 fork additions our build reaches ========================
 *
 * The 0.8.2 fork (audio.cpp ac16661d, base still labelled 0.12.0) adds 21 functions and
 * 7 enum types over 0.7.1. Only the ones referenced from engine_core (everything under src/framework,
 * always compiled) or from our nine families are shimmed; the rest live in families we do
 * not build and never reach the linker. Survey and reachability: the 2026-09-25 bump plan,
 * docs/superpowers/plans/2026-09-25-native-ggml-0.25-audiocpp-0.8.2-bump.md, fact 6.
 * Pinned by native/tests/test_audiocpp_compat.cpp.
 *
 * Enum values are the fork's verbatim (external/ggml/include/ggml.h; re-checked at v0.9.6
 * 04a37f2e, which added the three *_METAL_* / *_VULKAN_* values: ggml.h:456-461, 710-716). */
enum ggml_mul_mat_lowering {
    GGML_MUL_MAT_LOWERING_DEFAULT                    = 0,
    GGML_MUL_MAT_LOWERING_CUDA_NVFP4_F16_ACTIVATION  = 2,
    GGML_MUL_MAT_LOWERING_CUDA_TILE_F16_ACCUM_OUTPUT = 3,
    GGML_MUL_MAT_LOWERING_VULKAN_F32_INPUTS          = 4,
    GGML_MUL_MAT_LOWERING_METAL_F32_INPUTS           = 5,
};
enum ggml_concat_lowering {
    GGML_CONCAT_LOWERING_DEFAULT            = 0,
    GGML_CONCAT_LOWERING_CUDA_CONTIGUOUS_4D = 1,
};
enum ggml_im2col_2d_lowering {
    GGML_IM2COL_2D_LOWERING_DEFAULT           = 0,
    GGML_IM2COL_2D_LOWERING_CUDA_N_K3_PAD1_X8 = 1,
    GGML_IM2COL_2D_LOWERING_CUDA_N_K3_NOPAD_X8 = 2,
    GGML_IM2COL_2D_LOWERING_CUDA_F32_K3_TILED = 3,
    GGML_IM2COL_2D_LOWERING_METAL_TILED       = 4,
};
enum ggml_im2col_3d_lowering {
    GGML_IM2COL_3D_LOWERING_DEFAULT             = 0,
    GGML_IM2COL_3D_LOWERING_CUDA_N1_K3_NOPAD_X8 = 1,
};
enum ggml_rms_norm_channels_lowering {
    GGML_RMS_NORM_CHANNELS_LOWERING_DEFAULT        = 0,
    GGML_RMS_NORM_CHANNELS_LOWERING_CUDA_COALESCED = 1,
};
enum ggml_conv_3d_concat_pad_spatial_gemm_lowering {
    GGML_CONV_3D_CONCAT_PAD_SPATIAL_GEMM_LOWERING_DEFAULT         = 0,
    GGML_CONV_3D_CONCAT_PAD_SPATIAL_GEMM_LOWERING_CUDA_C48        = 1,
    GGML_CONV_3D_CONCAT_PAD_SPATIAL_GEMM_LOWERING_CUDA_TILED_C48  = 2,
};

/* Lowering hints. In the fork each writes one op param that only CUDA kernels read
 * (e.g. ggml_mul_mat_set_lowering: ggml_set_op_params_i32(a, 1, lowering)); upstream kernels
 * have no such param, so the faithful port is to write nothing. Callers gate them on
 * CUDA-only config flags (linear_module.cpp:100, structural_modules.cpp:341), and we build no
 * CUDA lane. Writing it would even be wrong: upstream 1.x keeps ggml_mul_mat_set_hint in that
 * same op_params[1] slot, so a lowering value would be read back as a hint.
 *
 * v0.9.6 adds two mul_mat values that are NOT pure hints: VULKAN_F32_INPUTS / METAL_F32_INPUTS
 * make the fork's Vulkan/Metal kernels keep F32 activations where they would otherwise convert
 * to F16 (fork ggml-vulkan.cpp:6418 and 7894-7899, ggml-metal-device.cpp:804). Upstream has no
 * equivalent on Vulkan — its supports_op REJECTS a MUL_MAT whose src1 prec is F32
 * (ggml-vulkan.cpp:16777), so ggml_prec_set_src is not a port. Writing nothing would silently
 * compute at F16, so those two abort. No family we build sets them: the framework setters are
 * gated on Bf16Autocast (attention_internal.h:439, dit.cpp:118), which only moss_soundeffect
 * selects, and the direct callers are kugelaudio, magenta_realtime_2, xtts_v2, voice_isolator
 * and reuse. GGML_IM2COL_2D_LOWERING_METAL_TILED (reuse only) is a pure kernel choice: no-op. */
static inline void ggml_mul_mat_set_lowering(struct ggml_tensor *a, enum ggml_mul_mat_lowering l) {
    (void)a;
    if (l == GGML_MUL_MAT_LOWERING_VULKAN_F32_INPUTS || l == GGML_MUL_MAT_LOWERING_METAL_F32_INPUTS) {
        GGML_ABORT("ggml_mul_mat_set_lowering: F32-input lowering %d has no upstream ggml port", (int) l);
    }
}
static inline void ggml_concat_set_lowering(struct ggml_tensor *t, enum ggml_concat_lowering l) { (void)t; (void)l; }
static inline void ggml_im2col_2d_set_lowering(struct ggml_tensor *t, enum ggml_im2col_2d_lowering l) { (void)t; (void)l; }
static inline void ggml_im2col_3d_set_lowering(struct ggml_tensor *t, enum ggml_im2col_3d_lowering l) { (void)t; (void)l; }
static inline void ggml_rms_norm_channels_set_lowering(struct ggml_tensor *t, enum ggml_rms_norm_channels_lowering l) { (void)t; (void)l; }
static inline void ggml_conv_3d_concat_pad_spatial_gemm_set_lowering(
        struct ggml_tensor *t, enum ggml_conv_3d_concat_pad_spatial_gemm_lowering l) { (void)t; (void)l; }

/* Fork: acc += a*b written in place into acc's memory (GGML_OP_MUL_MAT_ACC, a view of acc).
 * Reached only on Metal, by conv_modules.cpp's per-tap conv1d fast path when
 * in_channels >= 64 && output_frames > 8; the line after that call site is the fork's own
 * non-fused spelling, which is exactly this. Same F32 sum, one extra node, no aliasing —
 * the caller only ever uses the returned tensor. v0.9.6 adds a second caller, the Metal
 * per-tap Conv2d (conv_modules.cpp:744), behind Conv2dConfig.metal_per_tap, which only
 * latentsync sets. Fork body re-checked at v0.9.6: ggml.c:3586. */
static inline struct ggml_tensor *ggml_mul_mat_acc(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, struct ggml_tensor *acc) {
    return ggml_add(ctx, acc, ggml_mul_mat(ctx, a, b));
}

/* Fork: a fused GGML_UNARY_OP_ROUND_BF16, always F32 out. Its own header comment and its
 * caller (qwen_decoder.cpp:281-283) define it as the f32 -> bf16 -> f32 cast round trip,
 * which is what this builds. Reached by qwen_decoder (policy.fused_round) and by
 * qwen_causal_decode_runtime's non-Metal bf16 readback rounding. */
static inline struct ggml_tensor *ggml_round_bf16(struct ggml_context *ctx, struct ggml_tensor *a) {
    return ggml_cast(ctx, ggml_cast(ctx, a, GGML_TYPE_BF16), GGML_TYPE_F32);
}

/* ===== (E) fork ops referenced by engine_core but reachable only from families we do not
 * build: they must link, and reaching one is a bug, not a fallback (same rule as the
 * MiniMax-H3 stubs above). */
static inline struct ggml_tensor *ggml_rope_interleaved_pairs(
        struct ggml_context *ctx, struct ggml_tensor *even, struct ggml_tensor *odd,
        struct ggml_tensor *cos, struct ggml_tensor *sin) {
    (void)ctx; (void)even; (void)odd; (void)cos; (void)sin;
    GGML_ABORT("ggml_rope_interleaved_pairs: LiveAvatar op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_rms_norm_channels(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels: Wan video VAE op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_rms_norm_channels_silu(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels_silu: Wan video VAE op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_rms_norm_channels_add_bias_silu(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *bias, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)bias; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels_add_bias_silu: Wan video VAE op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_conv_3d_concat_pad_spatial_gemm_ex(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, struct ggml_tensor *w,
        int lp0, int rp0, int lp1, int rp1, int lp2, int rp2, enum ggml_type dst_type) {
    (void)ctx; (void)a; (void)b; (void)w; (void)lp0; (void)rp0; (void)lp1; (void)rp1; (void)lp2; (void)rp2; (void)dst_type;
    GGML_ABORT("ggml_conv_3d_concat_pad_spatial_gemm_ex: Wan video VAE op, not built in sokuji-native");
}

/* ===== (C) ggml_sub — upstream requires a row-contiguous src0, ruling R13 ==========
 *
 * Like the conv family in (B), ggml_sub exists on both ggml versions with the same
 * name, signature and *constructor* body (fork ggml.c:2200-2221 vs upstream
 * ggml.c:2226-2247 are identical). Only the CPU kernel's contract differs:
 *
 *     fork      GGML_ASSERT(nb00 % sizeof(src0_t) == 0)   binary-ops.cpp:80
 *     upstream  GGML_ASSERT(nb00 == sizeof(src0_t))       binary-ops.cpp:59
 *
 * OmniVoice's audio tokenizer walks straight into that. Its residual-vector-quantizer
 * loop (models/omnivoice/audio_tokenizer.cpp:1924-1928) subtracts in BCT layout:
 *
 *     residual_bct = transpose_btc_to_bct(ctx, embeddings_btc);   // a PERMUTE view
 *     for (q = 0; q < num_codebooks; ++q) { ...
 *         residual_bct = ggml_sub(ctx, residual_bct.tensor, quantized_bct.tensor); }
 *
 * On q == 0 that src0 is the bare permuted view — ne=[T,1024], nb=[4096,4] — so
 * nb00 = 4096 != 4 and upstream aborts the whole process (SIGABRT, not a catchable
 * NativeError) the moment a real speech clip is cloned. q >= 1 is fine: the SUB output
 * is a freshly allocated contiguous tensor.
 *
 * src1 needs the same clause, but the need is visible only on Metal — R13 had no Apple
 * GPU to see it. Upstream's CPU kernel strides src1 through nb10 in
 * vec_binary_op_non_contiguous, so CPU (and Vulkan) accept a permuted src1; ggml's Metal
 * backend does not. Its ADD/SUB/MUL/DIV/ADD_ID case requires ggml_is_contiguous_rows()
 * of BOTH operands (ggml-metal-device.m), so a permuted src1 falls through supports_op
 * and ggml_metal_op_encode_impl aborts the process with "unsupported op 'SUB'". In this
 * same RVQ loop `quantized_bct` is a freshly permuted view on EVERY codebook iteration
 * (audio_tokenizer.cpp:1926), so it is non-row-contiguous every time — measured on an
 * Apple M4: with this clause omnivoice synthesises on Metal, without it the process dies
 * during clone setup.
 *
 * Restoring the FORK's behaviour here would be a bug, not a fix. Measured on this exact
 * node (60x1024, both operands transposed), the fork does not abort but computes the
 * WRONG VALUES: with is_src0_full_shape true it falls into vec_binary_op_non_contiguous,
 * which indexes src0 as `x[i]` — a contiguous walk across a tensor whose first-dim
 * stride is 4096 bytes. 60416 of 61440 elements come out wrong (max abs err 5.9e4).
 * So the fork silently corrupts every codebook after the first; upstream's stricter
 * assert exposed a latent audio.cpp defect rather than introducing one. ggml_cont()
 * gives the mathematically correct residual, which is a deliberate, documented
 * divergence from the official CLI's output for omnivoice cloning, not a parity break
 * to chase: our clone transcribes cleanly where the official CLI's drifts.
 *
 * Scope, measured rather than assumed: with a diagnostic wrapper on all four binary
 * builders, a full five-family TTS->ASR loopback run (moss_tts_nano, supertonic,
 * qwen3_tts, omnivoice, pocket_tts) fired the guard exactly ONCE — this ggml_sub, this
 * node. ggml_add / ggml_mul / ggml_div never see a non-row-contiguous src0, so they are
 * left alone; should one ever start, upstream aborts loudly the same way, which is a
 * discoverable failure rather than a silent one.
 *
 * What the src1 clause costs the non-Metal lanes, stated exactly: it is NOT a no-op there.
 * `quantized_bct` is a fresh permute view on every codebook iteration, so the clause fires
 * on CPU and Vulkan too and adds one ggml_cont node per iteration — a graph the CPU lane
 * did not build before this change. It is an exact copy, so the VALUES cannot move, and
 * that was measured rather than assumed: on an Apple M4, all five families on the CPU
 * device, this build against the same build with only this clause removed, output is
 * bit-identical (max abs diff 0.000e+00, sample counts equal). The GB10 parity gate agrees
 * from the other side — supertonic still compares sample-exact (max_abs == 0) against the
 * official CLI. Only for operands that are already row-contiguous is the guard truly
 * inert: it returns them untouched and adds nothing. */
static inline struct ggml_tensor *sokuji_ggml_sub(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b) {
    if (a->nb[0] != ggml_type_size(a->type)) {
        a = ggml_cont(ctx, a);
    }
    if (b->nb[0] != ggml_type_size(b->type)) {
        b = ggml_cont(ctx, b);
    }
    return ggml_sub(ctx, a, b);
}

/* Object-like, and placed after the definition so the body above still spells the real
 * ggml_sub. Same force-include scoping as the conv family: engine targets only, so
 * ggml's own translation units keep the unwrapped builder. */
#define ggml_sub sokuji_ggml_sub

/* ===== (F) audio.cpp 0.9.6 on ggml 1.1.1: names our families reach =====================
 *
 * Fork line numbers below are external/ggml at v0.9.6 (04a37f2e); upstream ones are ggml
 * v1.1.1 (bb877c0c). Pinned by native/tests/test_audiocpp_compat.cpp (F1-F4). */

/* (F1) Accumulator precision: a rename, not a behaviour change. ggml 1.x renamed the fork's
 * GGML_PREC_DEFAULT (= 0) to GGML_PREC_UNDEFINED (= 0) and replaced the two per-op setters
 * with ggml_prec_set_acc [TAG_GGML_PREC]. Same values (fork ggml.h:445-448, upstream
 * ggml.h:273-280) and the same op_params slots: the fork writes slot 0 for MUL_MAT
 * (ggml.c:3664) and slot 3 for FLASH_ATTN_EXT (ggml.c:6319); ggml_prec_set_acc writes exactly
 * those (ggml.c:3296-3318). audio.cpp only ever passes DEFAULT or F32, and upstream reads F32 the
 * way the fork's backends did: Vulkan drops F16 accumulation in matmul and flash attention
 * (ggml-vulkan.cpp:6841, 9078), CPU always accumulates in F32 (ops.cpp:9725 accepts
 * UNDEFINED/F32), Metal ignores it — as the fork's own CPU/Metal did. The fork also accepts a
 * MUL_MAT_PACK4 node; ours never exists (ggml_mul_mat_pack4 above is a MUL_MAT). Reached
 * everywhere: 68 GGML_PREC_DEFAULT uses (every LinearConfig default), set_prec in
 * framework attention/linear and in omnivoice, voxcpm1, voxcpm2, index_tts2. */
#define GGML_PREC_DEFAULT GGML_PREC_UNDEFINED

static inline void ggml_mul_mat_set_prec(struct ggml_tensor *a, enum ggml_prec prec) {
    GGML_ASSERT(a->op == GGML_OP_MUL_MAT);
    const bool ok = ggml_prec_set_acc(a, prec);
    GGML_ASSERT(ok);
}

static inline void ggml_flash_attn_ext_set_prec(struct ggml_tensor *a, enum ggml_prec prec) {
    GGML_ASSERT(a->op == GGML_OP_FLASH_ATTN_EXT);
    const bool ok = ggml_prec_set_acc(a, prec);
    GGML_ASSERT(ok);
}

/* (F2) ggml_diag_mask_inf — pruned upstream in ggml 1.0, and reached: the framework's
 * self_attention.cpp:133/274/297, scaled_dot_product_attention.cpp:86/156 and decoder.cpp:145,
 * plus voxcpm1/voxcpm2 minicpm_blocks.h:124 and index_tts2 gpt.cpp:621. The op recordings show
 * DIAG_MASK_INF for moss_tts_nano, qwen3_tts, voxcpm1, voxcpm2 and index_tts2.
 *
 * Fork semantics (constructor ggml.c:4362-4383, CPU kernel ggml-cpu/ops.cpp:5346-5394):
 *     dst[k][i1][i0] = (i0 > n_past + i1) ? -INFINITY : a[k][i1][i0]
 * for every row k past dim 1, F32 only, n_past >= 0, src contiguous. No upstream op does this,
 * so it is rebuilt as a + M with an additive mask M[i1][i0] in {0, -inf} that broadcasts over
 * dims 2/3. Only columns i0 >= n_past can be masked; with w = ne0 - n_past of them and
 * c = i0 - n_past, M[i1][n_past + c] = (c > i1) ? -inf : 0, and the n_past columns to the left
 * are all zero. With s = min(w, ne1):
 *     T  = ggml_tri(ggml_fill([s,s], -inf), UPPER)       c > i1 for c, i1 < s   (ops.cpp:2273)
 *     w > s (fewer rows than maskable columns): append w-s columns of -inf — every c >= s is
 *            > i1 for every row i1 < s = ne1. A concat, NOT a w x w triangle cut to ne1 rows:
 *            that would cost w^2 floats where the scores themselves are ne0 x ne1.
 *     ne1 > s (more rows than maskable columns): rows i1 >= w see c <= w-1 < i1, all zero, so
 *            pad zero rows at the bottom; and pad n_past zero columns on the left.
 * w <= 1 masks nothing (c <= 0 <= i1), so the result is a plain copy — a distinct node, as the
 * fork's is, so a caller's later in-place op or ggml_set_name never lands on `a`.
 * Backends: FILL, TRI, CONCAT, PAD (lp0/rp1) and a broadcasting ADD exist on CPU, Vulkan and
 * Metal (ggml-vulkan.cpp:17051/17103/17109, ggml-metal-device.m:1574/1664/1692/1736; Metal's
 * leading pad is kernels/misc.metal:311), so this also retires the Metal DIAG_MASK_INF patch.
 * One deliberate difference: the fork SETS -inf, this ADDS it, so a masked +inf or NaN input
 * gives NaN instead of -inf. The masked values are finite attention scores (the next op is a
 * softmax), so the outputs agree exactly — the test pins it against a reference loop. The fresh
 * [s,s] / [w-s,s] leaves follow framework precedent (mamba_modules.cpp:92 fills a new tensor);
 * audio.cpp's GraphWorkspace allocates them through ggml_gallocr like any scratch tensor. */
static inline struct ggml_tensor *ggml_diag_mask_inf(struct ggml_context *ctx, struct ggml_tensor *a, int n_past) {
    GGML_ASSERT(n_past >= 0);
    GGML_ASSERT(a->type == GGML_TYPE_F32);
    const int64_t ne1 = a->ne[1];
    const int64_t w   = a->ne[0] - n_past;
    if (w <= 1 || ne1 == 0) {
        return ggml_cont(ctx, a);
    }
    const int64_t s = w < ne1 ? w : ne1;
    struct ggml_tensor *mask = ggml_tri(ctx,
            ggml_fill(ctx, ggml_new_tensor_2d(ctx, GGML_TYPE_F32, s, s), -INFINITY), GGML_TRI_TYPE_UPPER);
    if (w > s) {
        mask = ggml_concat(ctx, mask, ggml_fill(ctx, ggml_new_tensor_2d(ctx, GGML_TYPE_F32, w - s, s), -INFINITY), 0);
    }
    if (n_past > 0 || ne1 > s) {
        mask = ggml_pad_ext(ctx, mask, n_past, 0, 0, (int) (ne1 - s), 0, 0, 0, 0);
    }
    return ggml_add(ctx, a, mask);
}

/* (F3) Backend implementation selection. Reached on every device backend audio.cpp creates:
 * core/backend.cpp:221 init_device_backend() calls it with BackendConfig.impl, empty by
 * default. Fork body verbatim (ggml-backend.cpp:614-627; typedef ggml-backend.h:207): an empty
 * or "default" impl is plain ggml_backend_dev_init; anything else is resolved through the
 * registry's proc address, which only the fork's CUDA backend exports — upstream's CPU,
 * Vulkan and Metal return NULL, so a non-default impl is refused exactly as the fork refuses it
 * on those backends (logged, NULL, which audio.cpp turns into an exception). */
typedef ggml_backend_t (*ggml_backend_dev_init_with_impl_t)(
        ggml_backend_dev_t device, const char *impl, const char *params);

static inline ggml_backend_t ggml_backend_dev_init_with_impl(
        ggml_backend_dev_t device, const char *impl, const char *params) {
    GGML_ASSERT(device);
    if (!impl || !impl[0] || strcmp(impl, "default") == 0) {
        return ggml_backend_dev_init(device, params);
    }
    ggml_backend_dev_init_with_impl_t fn = (ggml_backend_dev_init_with_impl_t) ggml_backend_reg_get_proc_address(
            ggml_backend_dev_backend_reg(device), "ggml_backend_dev_init_with_impl");
    if (!fn) {
        GGML_LOG_ERROR("%s: implementation '%s' is not supported\n", ggml_backend_dev_name(device), impl);
        return NULL;
    }
    return fn(device, impl, params);
}

/* (F4) Per-graph pointwise fusion hook: types only. sampling/device_denoiser_runtime.cpp:241
 * looks the function up by name through ggml_backend_reg_get_proc_address and calls it only
 * when found; no upstream backend exports "ggml_backend_set_graph_fusions", so the pointer
 * stays NULL and the graph keeps its ordinary ops — which is what the fork does on every
 * backend that does not implement the hook. Verbatim from fork ggml-backend.h:228-234. */
enum ggml_backend_graph_fusion {
    GGML_BACKEND_GRAPH_FUSION_NORM_AFFINE     = 1u << 0,
    GGML_BACKEND_GRAPH_FUSION_BIAS_ACTIVATION = 1u << 1,
    GGML_BACKEND_GRAPH_FUSION_GATED_RESIDUAL  = 1u << 2,
};
typedef uint32_t (*ggml_backend_set_graph_fusions_t)(
        ggml_backend_t backend, struct ggml_cgraph *graph, uint32_t mask);

/* (F5) Tensor storage types and unary ops the fork adds, as "no such id" sentinels.
 *
 * GGML_TYPE_TQ2_1 is 44 in the fork (ggml.h:440, after its I8_S/I2_S at 42/43). Upstream 1.1.1
 * gives 42 and 43 to Q2_0 and F8_E4M3 and has GGML_TYPE_COUNT == 44, so the fork's raw number
 * would alias a real type the day upstream adds one. tensor_source.cpp:144/170/1601 only maps
 * the "tq2_1" storage name to it (a user-chosen weight storage type, which we never request);
 * GGML_TYPE_COUNT is never a valid id, and ggml_new_tensor_impl GGML_ASSERTs on it (ggml.c:1791).
 *
 * GGML_UNARY_OP_RSQRT (fork ggml.h:657, CPU kernel ops.cpp:10308) is used by exactly one call,
 * norm_modules.cpp:216 in build_vectorized_rms_norm, reached only with RMSNormLowering::
 * Vectorized — which nothing in the tree selects (every use is the Default). It maps to
 * GGML_UNARY_OP_COUNT, and the ggml_unary redirect below aborts on it at graph-build time:
 * left to the backends, CPU would abort at compute (ops.cpp:10607), but Vulkan's graph builder
 * returns false for an unknown unary op and skips the node (ggml-vulkan.cpp:13775), and
 * ggml_op_desc() would index past its name table (ggml.c:1388) — silent, not loud. */
#define GGML_TYPE_TQ2_1     GGML_TYPE_COUNT
#define GGML_UNARY_OP_RSQRT GGML_UNARY_OP_COUNT

static inline struct ggml_tensor *sokuji_ggml_unary(
        struct ggml_context *ctx, struct ggml_tensor *a, enum ggml_unary_op op) {
    if ((int) op < 0 || op >= GGML_UNARY_OP_COUNT) {
        GGML_ABORT("ggml_unary: fork-only unary op (GGML_UNARY_OP_RSQRT), not built in sokuji-native");
    }
    return ggml_unary(ctx, a, op);
}
/* Object-like and after the definition, like ggml_sub above. */
#define ggml_unary sokuji_ggml_unary

/* (F6) Strided views of a source whose dim 0 is not contiguous — the first of the two 1.1.1
 * constructor contracts the RESCAN note predicted, and it is reached: pocket_tts aborted at graph
 * build on the Vulkan recording lane (ggml.c:3825, GGML_ASSERT(nb == NULL || a->nb[0] ==
 * ggml_type_size(a->type)) in ggml_view_impl, via ggml_view_3d).
 *
 * The call: MimiLatentDecoder's transformer stage returns TransposeModule({0,2,1,3}), a bare
 * ggml_permute (mimi_latent_decoder_runtime.cpp:253; structural_modules.cpp:267, no cont). The
 * first StreamingConv1d (input_projection) left-pads through zeros_like_prefix ->
 * SliceModule({2,0,1}) (streaming_conv_modules.cpp:64), whose make_view_with_shape
 * (structural_modules.cpp:179) is ggml_view_3d(input, dims, input->nb[1], input->nb[2], offset).
 * Measured with gdb at that call on the GB10: source ne=[544,512,1,1] nb=[2048,4,1114112,
 * 1114112] — genuinely transposed (frames strided, channels contiguous); requested view
 * ne=[1,512,1] nb1=4 nb2=1114112 offset=0. ne0 == 1, so the view's own nb[0] never takes part in
 * addressing and the fork's result is the logically correct frame-0 column: the slice is a
 * legitimate use the new assert forbids, not a latent bug like (C)'s.
 *
 * The fork (== ggml 0.25.3 here: ggml.c view_impl/view_3d) addresses the source's bytes directly:
 * data = a->data + offset, nb = {type_size, nb1, nb2, nb3}. Reproduced exactly by viewing a
 * contiguous 1-D alias of a — ggml_view_1d passes nb == NULL, so it skips the stride assert —
 * and taking the requested view of that:
 *   - same address: ggml_new_tensor_impl folds every view onto its base (view_offs +=
 *     view_src->view_offs, ggml.c:1795-1798), so the alias starts at a's own view_offs (also
 *     when a is itself an offset view), and the result's view_offs is a->view_offs + offset —
 *     the fork's. Strides are the same {ts, nb1, nb2, nb3} the upstream view_Nd fills in
 *     (view_2d's nb2 = nb3 = nb1*ne1, view_3d's nb3 = nb2*ne2, as in the fork).
 *   - bounds: 1.1.1 now asserts a view's strided span + offset fits its base (ggml.c:1871-1872).
 *     The alias is sized by ggml_nbytes(a), a's own strided span (ggml.c:1319), which was
 *     already checked against the base when a was created — NOT by ggml_nelements(a), which
 *     exceeds the span for a broadcast (nb == 0) source. The final view is checked against
 *     the base, not the alias, exactly as an upstream view of a contiguous source is.
 *   - quantized sources (block size > 1) are left to upstream and its assert: a dim-0
 *     permutation splits quantization blocks, so there is no fork addressing to preserve.
 * The graph gains one VIEW node (no compute on any backend; sk_ops_record skips VIEW). Every
 * other path that takes explicit strides is unaffected: ggml_view_1d, reshape and
 * ggml_view_tensor (permute/transpose) pass none through ggml_view_impl (ggml.c:2001, 3845),
 * and ggml_set_*d / ggml_acc / ggml_cpy keep strides in op params, not in a view. */
static inline struct ggml_tensor *sokuji_ggml_view_source(struct ggml_context *ctx, struct ggml_tensor *a) {
    const size_t ts = ggml_type_size(a->type);
    if (a->nb[0] == ts || ggml_blck_size(a->type) != 1) {
        return a;
    }
    struct ggml_tensor *alias = ggml_view_1d(ctx, a, (int64_t) (ggml_nbytes(a) / ts), 0);
    ggml_format_name(alias, "%s (alias)", a->name);
    return alias;
}

static inline struct ggml_tensor *sokuji_ggml_view_2d(
        struct ggml_context *ctx, struct ggml_tensor *a, int64_t ne0, int64_t ne1, size_t nb1, size_t offset) {
    struct ggml_tensor *src = sokuji_ggml_view_source(ctx, a);
    struct ggml_tensor *result = ggml_view_2d(ctx, src, ne0, ne1, nb1, offset);
    if (src != a) ggml_format_name(result, "%s (view)", a->name);
    return result;
}

static inline struct ggml_tensor *sokuji_ggml_view_3d(
        struct ggml_context *ctx, struct ggml_tensor *a, int64_t ne0, int64_t ne1, int64_t ne2,
        size_t nb1, size_t nb2, size_t offset) {
    struct ggml_tensor *src = sokuji_ggml_view_source(ctx, a);
    struct ggml_tensor *result = ggml_view_3d(ctx, src, ne0, ne1, ne2, nb1, nb2, offset);
    if (src != a) ggml_format_name(result, "%s (view)", a->name);
    return result;
}

static inline struct ggml_tensor *sokuji_ggml_view_4d(
        struct ggml_context *ctx, struct ggml_tensor *a, int64_t ne0, int64_t ne1, int64_t ne2, int64_t ne3,
        size_t nb1, size_t nb2, size_t nb3, size_t offset) {
    struct ggml_tensor *src = sokuji_ggml_view_source(ctx, a);
    struct ggml_tensor *result = ggml_view_4d(ctx, src, ne0, ne1, ne2, ne3, nb1, nb2, nb3, offset);
    if (src != a) ggml_format_name(result, "%s (view)", a->name);
    return result;
}

/* Object-like and after the definitions, like ggml_sub above. */
#define ggml_view_2d sokuji_ggml_view_2d
#define ggml_view_3d sokuji_ggml_view_3d
#define ggml_view_4d sokuji_ggml_view_4d

/* ===== (G) fork names engine_core references that our families provably never reach ======
 *
 * Same rule as (E): they must compile and link, and reaching one is a bug, not a fallback.
 * Each entry says why it is unreachable; most sit behind an explicit caller-side throw on any
 * backend but CUDA, which we never build. Pure kernel-choice setters whose op computes the
 * same values without them stay no-ops, per the lowering-hint rule in (D). */

/* Graph regions — fork ggml-backend.h:344-353 verbatim, ggml_backend_sched_set_regions
 * ggml-backend.cpp:2045, ggml_graph_slice ggml.c:8105. PreparedGraph only slices a graph or
 * registers scheduler regions when a module has registered a region executor
 * (prepared_graph.cpp:403/484/497 test entry.regions.empty()), and the only registrant is the
 * RMVPE pitch extractor (rmvpe_pitch_extractor.cpp:777), used by rvc, seed_vc, rosvot and
 * soulx_singer. The struct must be complete: prepared_graph.cpp:405 builds a vector of them. */
typedef enum ggml_status (*ggml_backend_region_callback)(ggml_backend_t backend, struct ggml_cgraph *region, void *user_data);
struct ggml_backend_graph_region {
    struct ggml_tensor *const *nodes;
    size_t n_nodes;
    struct ggml_tensor *const *outputs;
    size_t n_outputs;
    struct ggml_tensor *const *deferred_eval;
    size_t n_deferred_eval;
    ggml_backend_region_callback compute;
    void *user_data;
};

static inline bool ggml_backend_sched_set_regions(
        ggml_backend_sched_t sched, const struct ggml_backend_graph_region *regions, size_t count) {
    (void)sched; (void)regions; (void)count;
    GGML_ABORT("ggml_backend_sched_set_regions: graph regions are RMVPE-only, not built in sokuji-native");
}

static inline struct ggml_cgraph *ggml_graph_slice(struct ggml_context *ctx, struct ggml_cgraph *graph, int begin, int end) {
    (void)ctx; (void)graph; (void)begin; (void)end;
    GGML_ABORT("ggml_graph_slice: graph regions are RMVPE-only, not built in sokuji-native");
}

/* CUDA-only paths behind a caller-side throw on every other backend. */
static inline struct ggml_tensor *ggml_mul_mat_f16(               /* fork ggml.c:3656; linear_module.cpp:84-88 throws */
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b) {
    (void)ctx; (void)a; (void)b;
    GGML_ABORT("ggml_mul_mat_f16: CUDA-only op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_flash_attn_f16_head40(     /* fork ggml.c:5926; scaled_dot_product_attention.cpp:269 throws */
        struct ggml_context *ctx, struct ggml_tensor *q, struct ggml_tensor *k, struct ggml_tensor *v, float scale) {
    (void)ctx; (void)q; (void)k; (void)v; (void)scale;
    GGML_ABORT("ggml_flash_attn_f16_head40: CUDA-only op, not built in sokuji-native");
}
/* The two norm setters change the op (F16 output; fused affine operands in src[1]/src[2]), so
 * they are not hints even though only CUDA reads them. */
static inline void ggml_norm_set_cuda_f16(struct ggml_tensor *tensor) {  /* fork ggml.c:3336; norm_modules.cpp:234-235 throws */
    (void)tensor;
    GGML_ABORT("ggml_norm_set_cuda_f16: CUDA-only F16 LayerNorm, not built in sokuji-native");
}
static inline void ggml_group_norm_set_cuda_affine_f16(                 /* fork ggml.c:3507; norm_modules.cpp:442-444 throws */
        struct ggml_tensor *tensor, struct ggml_tensor *scale, struct ggml_tensor *bias) {
    (void)tensor; (void)scale; (void)bias;
    GGML_ABORT("ggml_group_norm_set_cuda_affine_f16: CUDA-only F16 GroupNorm, not built in sokuji-native");
}
/* cuDNN conv: Conv2dConfig/Conv3dConfig.cuda_cudnn, set only by soulx_flashhead, latentsync and
 * the LTX video VAE; conv_modules.cpp:759 (2D) and :920 (3D) throw off CUDA. The bias setters
 * fuse the bias into the op, which the caller then does not add itself, so a no-op would drop
 * it. */
static inline void ggml_conv_2d_direct_set_cudnn(struct ggml_tensor *tensor) {  /* fork ggml.c:5949 */
    (void)tensor;
    GGML_ABORT("ggml_conv_2d_direct_set_cudnn: cuDNN lowering, not built in sokuji-native");
}
static inline void ggml_conv_2d_direct_set_cudnn_bias(struct ggml_tensor *tensor, struct ggml_tensor *bias) {  /* fork ggml.c:5964 */
    (void)tensor; (void)bias;
    GGML_ABORT("ggml_conv_2d_direct_set_cudnn_bias: cuDNN lowering, not built in sokuji-native");
}
/* Same signature as upstream ggml_conv_3d_direct: conv_modules.cpp:957 picks between the two
 * through a ternary on their addresses. */
static inline struct ggml_tensor *ggml_conv_3d_direct_f16(  /* fork ggml.c:5401 */
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b,
        int s0, int s1, int s2, int p0, int p1, int p2, int d0, int d1, int d2,
        int n_channels, int n_batch, int n_channels_out) {
    (void)ctx; (void)a; (void)b; (void)s0; (void)s1; (void)s2; (void)p0; (void)p1; (void)p2;
    (void)d0; (void)d1; (void)d2; (void)n_channels; (void)n_batch; (void)n_channels_out;
    GGML_ABORT("ggml_conv_3d_direct_f16: cuDNN op, not built in sokuji-native");
}
/* Fork declares C++ default arguments for the last four (ggml.h:2425); the one caller,
 * conv_modules.cpp:991, passes all five. */
static inline void ggml_conv_3d_direct_set_cudnn(  /* fork ggml.c:5313 */
        struct ggml_tensor *tensor, struct ggml_tensor *bias, bool round_bf16, bool prepacked_weights,
        int replicate_depth_left) {
    (void)tensor; (void)bias; (void)round_bf16; (void)prepacked_weights; (void)replicate_depth_left;
    GGML_ABORT("ggml_conv_3d_direct_set_cudnn: cuDNN lowering, not built in sokuji-native");
}
/* Metal implicit-GEMM Conv2d (fork ggml.c:5954): adds permuted copies of W/X as extra sources
 * and flags a Metal kernel; the fork's own comment keeps W/X "for a correct CPU fallback", so the
 * op's value does not depend on it — a kernel choice, no-op. Only realtime_reuse sets
 * Conv2dConfig.implicit_gemm (conv_modules.cpp:708). */
static inline void ggml_conv_2d_direct_set_metal_implicit(struct ggml_context *ctx, struct ggml_tensor *tensor) {
    (void)ctx; (void)tensor;
}

/* CPU-only vectorised erf GELU (fork ggml.c:2965, its own comment: "can differ ... in the last
 * bits", a different kernel, not a graph). Selected only by GeluApproximation::ApproxErf,
 * which only voice_isolator uses (network.cpp:537/560). */
static inline struct ggml_tensor *ggml_gelu_erf_approx(struct ggml_context *ctx, struct ggml_tensor *a) {
    (void)ctx; (void)a;
    GGML_ABORT("ggml_gelu_erf_approx: voice_isolator op, not built in sokuji-native");
}

/* Wan video VAE, like the rest of (E). wan_video_vae_runtime.cpp:796 (fork ggml.c:3413). */
static inline struct ggml_tensor *ggml_rms_norm_channels_silu_f16(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels_silu_f16: Wan video VAE op, not built in sokuji-native");
}

/* Mamba-1 fusions: framework/modules/mamba_modules.cpp:78-115, used only by voice_isolator.
 * The fusion setters change what the op computes (causal pad, fused gate), so they abort too.
 * Enums verbatim from fork ggml.h:723-736; bodies ggml.c:6453/6525/6541/6554. */
enum ggml_ssm_scan_fusion {
    GGML_SSM_SCAN_FUSION_NONE = 0,
    GGML_SSM_SCAN_FUSION_GATE = 1,
};
enum ggml_ssm_conv_fusion {
    GGML_SSM_CONV_FUSION_NONE       = 0,
    GGML_SSM_CONV_FUSION_CAUSAL_PAD = 1,
};
static inline struct ggml_tensor *ggml_ssm_conv_causal_silu(
        struct ggml_context *ctx, struct ggml_tensor *x, struct ggml_tensor *w, struct ggml_tensor *bias) {
    (void)ctx; (void)x; (void)w; (void)bias;
    GGML_ABORT("ggml_ssm_conv_causal_silu: Mamba-1 op, not built in sokuji-native");
}
static inline void ggml_ssm_conv_set_fusion(struct ggml_tensor *tensor, enum ggml_ssm_conv_fusion fusion) {
    (void)tensor; (void)fusion;
    GGML_ABORT("ggml_ssm_conv_set_fusion: Mamba-1 op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_ssm_scan_mamba1(
        struct ggml_context *ctx, struct ggml_tensor *state, struct ggml_tensor *x, struct ggml_tensor *projected,
        struct ggml_tensor *A, struct ggml_tensor *ids, struct ggml_tensor *dt_w, struct ggml_tensor *dt_bias,
        struct ggml_tensor *D, struct ggml_tensor *gate) {
    (void)ctx; (void)state; (void)x; (void)projected; (void)A; (void)ids; (void)dt_w; (void)dt_bias; (void)D; (void)gate;
    GGML_ABORT("ggml_ssm_scan_mamba1: Mamba-1 op, not built in sokuji-native");
}
static inline void ggml_ssm_scan_set_fusion(struct ggml_tensor *tensor, enum ggml_ssm_scan_fusion fusion) {
    (void)tensor; (void)fusion;
    GGML_ABORT("ggml_ssm_scan_set_fusion: Mamba-1 op, not built in sokuji-native");
}

#ifdef __cplusplus
}
#endif

#ifdef __cplusplus
/* (G, C++ only) ggml_gated_delta_net: a SHARED name whose signature changed. The fork's takes six
 * tensors with state as (S_v*S_v*H, K, n_seqs) and writes K trailing per-token snapshots
 * (fork ggml.h:2999-3010, ggml.c:7189-7238); upstream 1.1.1 deprecated that name in favour of
 * ggml_gated_delta_net_ext, gave it an extra int64_t K, takes state as [S_v,S_v,H_v,n_seqs] and
 * orders snapshots most-recent first (ggml.h:2428-2474) — a different contract, not a
 * re-spelling. The one caller, gated_delta_net_module.cpp:127, is reached only through the
 * Qwen3.5 decoder (firered_audio, index_echo, fish_drama3, minimax_h3, zonos3). Overload
 * resolution picks this on the fork's six-tensor arity; upstream's own declaration is untouched. */
static inline struct ggml_tensor *ggml_gated_delta_net(
        struct ggml_context *ctx, struct ggml_tensor *q, struct ggml_tensor *k, struct ggml_tensor *v,
        struct ggml_tensor *g, struct ggml_tensor *beta, struct ggml_tensor *state) {
    (void)ctx; (void)q; (void)k; (void)v; (void)g; (void)beta; (void)state;
    GGML_ABORT("ggml_gated_delta_net (fork signature): Qwen3.5 decoder op, not built in sokuji-native");
}

/* (G, C++ only) ggml_ssm_scan: likewise a shared name that gained a trailing int64_t K (state
 * snapshot slots) upstream (ggml.h:2318-2327; fork ggml.h:2851-2859 has seven tensors). The
 * only caller we compile is the legacy Mamba-1 branch, mamba_modules.cpp:112 — voice_isolator,
 * like the rest of the Mamba block above. */
static inline struct ggml_tensor *ggml_ssm_scan(
        struct ggml_context *ctx, struct ggml_tensor *s, struct ggml_tensor *x, struct ggml_tensor *dt,
        struct ggml_tensor *A, struct ggml_tensor *B, struct ggml_tensor *C, struct ggml_tensor *ids) {
    (void)ctx; (void)s; (void)x; (void)dt; (void)A; (void)B; (void)C; (void)ids;
    GGML_ABORT("ggml_ssm_scan (fork signature): Mamba-1 op, not built in sokuji-native");
}
#endif

#if defined(SK_RECORD_OPS)
/* Test build only: audio.cpp computes single-backend through ggml_backend_graph_compute, so the
 * op recorder intercepts that call. ggml-backend.h is included FIRST so the real prototype is
 * declared before the macro renames later uses; sk_ops_record.cpp is compiled without this
 * header and forwards to the real function. */
#include "ggml-backend.h"
extern "C" enum ggml_status sk_recording_graph_compute(ggml_backend_t backend, struct ggml_cgraph *cgraph);
extern "C" ggml_backend_graph_plan_t sk_recording_graph_plan_create(ggml_backend_t backend, struct ggml_cgraph *cgraph);
#define ggml_backend_graph_compute      sk_recording_graph_compute
#define ggml_backend_graph_plan_create  sk_recording_graph_plan_create   /* pocket_tts FlowLM on a host backend */
#endif
