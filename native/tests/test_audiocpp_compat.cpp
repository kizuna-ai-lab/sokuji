// Pins the audio.cpp 0.8.2 compat shims (audiocpp_compat.h sections (D), (E), (F) and (G)) against the
// fork's own documented equivalents, on the CPU backend of the ggml we actually build.
#undef NDEBUG   // every native test does this: the lanes build Release, and assert() is the test
#include "audiocpp_compat.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

// audio.cpp 54aa279's fork adds GGML_MUL_MAT_LOWERING_VULKAN_F32_INPUTS = 4
// (external/ggml/include/ggml.h:459); the shim must carry the fork's value.
static_assert(GGML_MUL_MAT_LOWERING_VULKAN_F32_INPUTS == 4,
              "audiocpp_compat.h must mirror the fork's ggml_mul_mat_lowering values");

static ggml_backend_t g_cpu;

// Builds `out` in a fresh no_alloc context via `build`, uploads `inputs`, computes on CPU and
// returns the F32 result.
template <typename Build>
static std::vector<float> run(Build build, std::vector<std::pair<int, std::vector<float>>> inputs) {
    ggml_init_params p = {64 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, true};
    ggml_context *ctx = ggml_init(p);
    std::vector<ggml_tensor *> ins;
    ggml_tensor *out = build(ctx, ins);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, g_cpu);
    for (auto &[i, data] : inputs) ggml_backend_tensor_set(ins[i], data.data(), 0, data.size() * sizeof(float));
    assert(ggml_backend_graph_compute(g_cpu, gf) == GGML_STATUS_SUCCESS);
    std::vector<float> r(ggml_nelements(out));
    ggml_backend_tensor_get(out, r.data(), 0, r.size() * sizeof(float));
    ggml_backend_buffer_free(buf);
    ggml_free(ctx);
    return r;
}

static std::vector<float> ramp(size_t n, float scale) {
    std::vector<float> v(n);
    for (size_t i = 0; i < n; ++i) v[i] = std::sin(0.37f * (float)i) * scale;
    return v;
}

// The nodes ggml_round_bf16 builds over one input of `type`, in graph order, and the type of its result.
struct RoundGraph {
    std::vector<ggml_op> ops;
    std::vector<ggml_type> src0, dst;
    ggml_type result;
};

static RoundGraph round_bf16_graph(ggml_type type) {
    ggml_init_params p = {16 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, true};
    ggml_context *ctx = ggml_init(p);
    ggml_tensor *out = ggml_round_bf16(ctx, ggml_new_tensor_1d(ctx, type, 4));
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    RoundGraph g;
    g.result = out->type;
    for (int i = 0; i < ggml_graph_n_nodes(gf); ++i) {
        const ggml_tensor *n = ggml_graph_node(gf, i);
        g.ops.push_back(n->op);
        g.src0.push_back(n->src[0]->type);
        g.dst.push_back(n->type);
    }
    ggml_free(ctx);
    return g;
}

// ggml_round_bf16 over `n` elements of `type` holding `data`, computed on the CPU backend.
static std::vector<float> round_bf16_of(ggml_type type, const void *data, size_t n) {
    ggml_init_params p = {16 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, true};
    ggml_context *ctx = ggml_init(p);
    ggml_tensor *in = ggml_new_tensor_1d(ctx, type, (int64_t)n);
    ggml_tensor *out = ggml_round_bf16(ctx, in);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, g_cpu);
    ggml_backend_tensor_set(in, data, 0, ggml_nbytes(in));
    assert(ggml_backend_graph_compute(g_cpu, gf) == GGML_STATUS_SUCCESS);
    assert(out->type == GGML_TYPE_F32);
    std::vector<float> r(n);
    ggml_backend_tensor_get(out, r.data(), 0, r.size() * sizeof(float));
    ggml_backend_buffer_free(buf);
    ggml_free(ctx);
    return r;
}

int main(int argc, char **argv) {
    ggml_backend_load_all_from_path(argc > 1 ? argv[1] : nullptr);
    g_cpu = ggml_backend_init_by_type(GGML_BACKEND_DEVICE_TYPE_CPU, nullptr);
    assert(g_cpu);
    const int K = 96, M = 7, N = 12;   // a:[K,M] b:[K,N] acc:[M,N], in_channels>=64 like the Metal path

    // (D1) mul_mat_acc == acc + mul_mat(a, b), bit for bit: the fork's own fallback chain.
    auto a = ramp(K * M, 0.5f), b = ramp(K * N, 1.5f), acc = ramp(M * N, 3.0f);
    auto shim = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
        in = {ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N),
              ggml_new_tensor_2d(c, GGML_TYPE_F32, M, N)};
        return ggml_mul_mat_acc(c, in[0], in[1], in[2]);
    }, {{0, a}, {1, b}, {2, acc}});
    auto ref = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
        in = {ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N),
              ggml_new_tensor_2d(c, GGML_TYPE_F32, M, N)};
        return ggml_add(c, in[2], ggml_mul_mat(c, in[0], in[1]));
    }, {{0, a}, {1, b}, {2, acc}});
    assert(shim.size() == (size_t)(M * N));
    assert(std::memcmp(shim.data(), ref.data(), shim.size() * sizeof(float)) == 0);

    // (D2) round_bf16 == f32 -> bf16 -> f32, and it really rounds (1 + 2^-10 is not a bf16).
    std::vector<float> x = {1.0f + 1.0f / 1024.0f, -3.14159265f, 65504.0f, 1e-30f};
    auto rounded = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
        in = {ggml_new_tensor_1d(c, GGML_TYPE_F32, 4)};
        return ggml_round_bf16(c, in[0]);
    }, {{0, x}});
    for (size_t i = 0; i < x.size(); ++i) {
        const float want = ggml_bf16_to_fp32(ggml_fp32_to_bf16(x[i]));
        assert(std::memcmp(&rounded[i], &want, sizeof(float)) == 0);
    }
    assert(rounded[0] == 1.0f);

    // (D2b) An F32 input builds exactly the two casts it always has, so qwen3_tts's recording does not move.
    {
        const RoundGraph g = round_bf16_graph(GGML_TYPE_F32);
        assert(g.result == GGML_TYPE_F32);
        assert((g.ops == std::vector<ggml_op>{GGML_OP_CPY, GGML_OP_CPY}));
        assert((g.src0 == std::vector<ggml_type>{GGML_TYPE_F32, GGML_TYPE_BF16}));
        assert((g.dst == std::vector<ggml_type>{GGML_TYPE_BF16, GGML_TYPE_F32}));
    }

    // (D2c) An F16 input (breeze_tts's KV cache) is widened to F32 first: ggml-vulkan has no CPY f16 -> bf16
    // (ggml-vulkan.cpp:6170-6171), and F16 -> F32 is exact, so the values are the fork's fused kernel's.
    {
        const RoundGraph g = round_bf16_graph(GGML_TYPE_F16);
        assert(g.result == GGML_TYPE_F32);
        int f16_to_bf16_copies = 0;
        for (size_t i = 0; i < g.ops.size(); ++i)
            f16_to_bf16_copies += g.ops[i] == GGML_OP_CPY && g.src0[i] == GGML_TYPE_F16 && g.dst[i] == GGML_TYPE_BF16;
        assert(f16_to_bf16_copies == 0);
        assert((g.ops == std::vector<ggml_op>{GGML_OP_CPY, GGML_OP_CPY, GGML_OP_CPY}));
        assert((g.src0 == std::vector<ggml_type>{GGML_TYPE_F16, GGML_TYPE_F32, GGML_TYPE_BF16}));
        assert((g.dst == std::vector<ggml_type>{GGML_TYPE_F32, GGML_TYPE_BF16, GGML_TYPE_F32}));

        // Values F16 holds exactly that bf16 does not: 1 + 2^-10 and 1 + 2^-8 (a tie) round down to 1,
        // 1 + 3 * 2^-9 rounds up, 65504 rounds up across an exponent to 2^16; the smallest normal and
        // subnormal F16 and -0 widen untouched.
        const float xs[] = {1.0f + 1.0f / 1024.0f, 1.0f + 1.0f / 256.0f, 1.0f + 3.0f / 512.0f, -3.140625f,
                            65504.0f, 6.103515625e-05f, 5.9604644775390625e-08f, -0.0f};
        const size_t n = sizeof xs / sizeof xs[0];
        std::vector<ggml_fp16_t> h(n);
        for (size_t i = 0; i < n; ++i) h[i] = ggml_fp32_to_fp16(xs[i]);
        const auto got = round_bf16_of(GGML_TYPE_F16, h.data(), n);
        for (size_t i = 0; i < n; ++i) {
            const float want = ggml_bf16_to_fp32(ggml_fp32_to_bf16(ggml_fp16_to_fp32(h[i])));
            assert(std::memcmp(&got[i], &want, sizeof(float)) == 0);
        }
        assert(got[0] == 1.0f && got[1] == 1.0f && got[2] == 1.0f + 1.0f / 128.0f && got[4] == 65536.0f);
    }

    // (D2d) A BF16 input is the same rule: widened, then the round trip changes nothing.
    {
        const float xs[] = {1.0f, -3.140625f, 65536.0f, 1e-30f};
        const size_t n = sizeof xs / sizeof xs[0];
        std::vector<ggml_bf16_t> b(n);
        for (size_t i = 0; i < n; ++i) b[i] = ggml_fp32_to_bf16(xs[i]);
        const auto got = round_bf16_of(GGML_TYPE_BF16, b.data(), n);
        for (size_t i = 0; i < n; ++i) {
            const float want = ggml_bf16_to_fp32(b[i]);
            assert(std::memcmp(&got[i], &want, sizeof(float)) == 0);
        }
    }

    // (D3) two representative lowering hints (mul_mat, concat) are no-ops on this build:
    // op and op_params untouched.
    {
        ggml_init_params p = {16 * ggml_tensor_overhead(), nullptr, true};
        ggml_context *c = ggml_init(p);
        ggml_tensor *mm = ggml_mul_mat(c, ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N));
        ggml_tensor *cat = ggml_concat(c, ggml_new_tensor_2d(c, GGML_TYPE_F32, 4, 4), ggml_new_tensor_2d(c, GGML_TYPE_F32, 4, 4), 0);
        int32_t before_mm[GGML_MAX_OP_PARAMS / 4], before_cat[GGML_MAX_OP_PARAMS / 4];
        std::memcpy(before_mm, mm->op_params, sizeof before_mm);
        std::memcpy(before_cat, cat->op_params, sizeof before_cat);
        ggml_mul_mat_set_lowering(mm, GGML_MUL_MAT_LOWERING_CUDA_NVFP4_F16_ACTIVATION);
        ggml_concat_set_lowering(cat, GGML_CONCAT_LOWERING_CUDA_CONTIGUOUS_4D);
        assert(mm->op == GGML_OP_MUL_MAT && std::memcmp(before_mm, mm->op_params, sizeof before_mm) == 0);
        assert(cat->op == GGML_OP_CONCAT && std::memcmp(before_cat, cat->op_params, sizeof before_cat) == 0);
        ggml_free(c);
    }

    // (F) snake_1d == a + sin(a * alpha)^2 / alpha, alpha [C,1] broadcast over the frames of a [C,T]:
    // bit for bit against the explicit mul/sin/mul/div/add chain (the fork's own fallback,
    // audio8_tts/codec.cpp:519-522), and close to the closed form.
    {
        const int C = 8, T = 5;
        auto xs = ramp(C * T, 2.0f);
        std::vector<float> alpha(C);
        for (int ch = 0; ch < C; ++ch) alpha[ch] = 0.25f + 0.2f * (float)ch;
        auto snake = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
            in = {ggml_new_tensor_2d(c, GGML_TYPE_F32, C, T), ggml_new_tensor_2d(c, GGML_TYPE_F32, C, 1)};
            return ggml_snake_1d(c, in[0], in[1]);
        }, {{0, xs}, {1, alpha}});
        auto chain = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
            in = {ggml_new_tensor_2d(c, GGML_TYPE_F32, C, T), ggml_new_tensor_2d(c, GGML_TYPE_F32, C, 1)};
            ggml_tensor *s = ggml_sin(c, ggml_mul(c, in[0], in[1]));
            return ggml_add(c, in[0], ggml_div(c, ggml_mul(c, s, s), in[1]));
        }, {{0, xs}, {1, alpha}});
        assert(snake.size() == (size_t)(C * T));
        assert(std::memcmp(snake.data(), chain.data(), snake.size() * sizeof(float)) == 0);
        for (int t = 0; t < T; ++t)
            for (int ch = 0; ch < C; ++ch) {
                const float x = xs[t * C + ch], s = std::sin(x * alpha[ch]);
                assert(std::fabs(snake[t * C + ch] - (x + s * s / alpha[ch])) < 1e-4f);
            }
    }

    // (G) pins that the fork's 8-argument ggml_ssm_scan forwards its arguments to upstream's with
    // a trailing K = 1: the two forms give the same result bit for bit, and its size is y followed
    // by one state per sequence. It does NOT check the scan's numerics against a reference or
    // against the fork; that K = 1 means the fork's single-state scan is read off the two sources
    // (audiocpp_compat.h (G)) and is what a ggml pin bump must re-verify. The inputs are a real
    // scan (3 tokens, 2 sequences reading states 1 and 0 of a 2-state buffer, Mamba-2 A of
    // [1, n_head]) so the result is not degenerate.
    {
        const int d_state = 6, head_dim = 8, n_head = 4, n_group = 2, T = 3, n_seqs = 2;
        const size_t n_x = (size_t)head_dim * n_head * T * n_seqs;
        const size_t n_state = (size_t)d_state * head_dim * n_head;
        auto s0 = ramp(n_state * 2, 0.5f);                       // two states: ne[3] = 2
        auto x = ramp(n_x, 1.0f);
        auto dt = ramp((size_t)n_head * T * n_seqs, 1.0f);
        std::vector<float> A(n_head);
        for (int h = 0; h < n_head; ++h) A[h] = -(0.1f + 0.05f * (float)h);
        auto B = ramp((size_t)d_state * n_group * T * n_seqs, 0.7f);
        auto C = ramp((size_t)d_state * n_group * T * n_seqs, 0.9f);
        const int32_t id_values[n_seqs] = {1, 0};
        std::vector<float> ids(n_seqs);                           // run() uploads float vectors: carry the int32 bits
        std::memcpy(ids.data(), id_values, sizeof id_values);
        auto make_inputs = [&](ggml_context *c, std::vector<ggml_tensor *> &in) {
            in = {ggml_new_tensor_4d(c, GGML_TYPE_F32, d_state, head_dim, n_head, 2),
                  ggml_new_tensor_4d(c, GGML_TYPE_F32, head_dim, n_head, T, n_seqs),
                  ggml_new_tensor_3d(c, GGML_TYPE_F32, n_head, T, n_seqs),
                  ggml_new_tensor_2d(c, GGML_TYPE_F32, 1, n_head),
                  ggml_new_tensor_4d(c, GGML_TYPE_F32, d_state, n_group, T, n_seqs),
                  ggml_new_tensor_4d(c, GGML_TYPE_F32, d_state, n_group, T, n_seqs),
                  ggml_new_tensor_1d(c, GGML_TYPE_I32, n_seqs)};
        };
        const std::vector<std::pair<int, std::vector<float>>> feed = {
            {0, s0}, {1, x}, {2, dt}, {3, A}, {4, B}, {5, C}, {6, ids}};
        auto fork_form = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
            make_inputs(c, in);
            return ggml_ssm_scan(c, in[0], in[1], in[2], in[3], in[4], in[5], in[6]);
        }, feed);
        auto upstream_k1 = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
            make_inputs(c, in);
            return ggml_ssm_scan(c, in[0], in[1], in[2], in[3], in[4], in[5], in[6], 1);
        }, feed);
        assert(fork_form.size() == n_x + n_state * n_seqs);       // y ++ one state per sequence
        assert(std::memcmp(fork_form.data(), upstream_k1.data(), fork_form.size() * sizeof(float)) == 0);
        // The scan did something: the state tail is neither zero nor the state it started from.
        bool tail_moved = false;
        for (size_t i = 0; i < n_state; ++i) tail_moved |= fork_form[n_x + i] != s0[n_state + i];
        assert(tail_moved);
        for (float v : fork_form) assert(std::isfinite(v));
    }

    ggml_backend_free(g_cpu);
    std::puts("test_audiocpp_compat: OK");
    return 0;
}
