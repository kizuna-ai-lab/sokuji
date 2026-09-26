// Pins the audio.cpp 0.8.2 compat shims (audiocpp_compat.h sections (D) and (E)) against the
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

    ggml_backend_free(g_cpu);
    std::puts("test_audiocpp_compat: OK");
    return 0;
}
