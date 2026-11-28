// Pins the audio.cpp compat shims (audiocpp_compat.h sections (D)-(G)) against the fork's own
// documented equivalents, on the ggml we actually build. (D) runs on the CPU backend; the
// ggml_diag_mask_inf rebuild (F2) runs on EVERY CPU/GPU device the lane loads, so the Vulkan
// and Metal lanes check their own FILL/TRI/CONCAT/PAD/ADD kernels, not just the CPU's.
#undef NDEBUG   // every native test does this: the lanes build Release, and assert() is the test
#include "audiocpp_compat.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

static ggml_backend_t g_cpu;

// Builds `out` in a fresh no_alloc context via `build`, uploads `inputs`, computes on `backend`
// and returns the F32 result.
template <typename Build>
static std::vector<float> run_on(ggml_backend_t backend, Build build,
                                 std::vector<std::pair<int, std::vector<float>>> inputs) {
    ggml_init_params p = {64 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, true};
    ggml_context *ctx = ggml_init(p);
    std::vector<ggml_tensor *> ins;
    ggml_tensor *out = build(ctx, ins);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, backend);
    assert(buf);
    for (auto &[i, data] : inputs) ggml_backend_tensor_set(ins[i], data.data(), 0, data.size() * sizeof(float));
    for (int n = 0; n < ggml_graph_n_nodes(gf); ++n) assert(ggml_backend_supports_op(backend, ggml_graph_node(gf, n)));
    assert(ggml_backend_graph_compute(backend, gf) == GGML_STATUS_SUCCESS);
    std::vector<float> r(ggml_nelements(out));
    ggml_backend_tensor_get(out, r.data(), 0, r.size() * sizeof(float));
    ggml_backend_buffer_free(buf);
    ggml_free(ctx);
    return r;
}

template <typename Build>
static std::vector<float> run(Build build, std::vector<std::pair<int, std::vector<float>>> inputs) {
    return run_on(g_cpu, build, std::move(inputs));
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

    // (F1) the precision rename: the fork's values and op_params slots, written through
    // ggml_prec_set_acc. MUL_MAT keeps it in slot 0, FLASH_ATTN_EXT in slot 3 after its three
    // float params, which must survive untouched.
    {
        static_assert(GGML_PREC_DEFAULT == 0 && GGML_PREC_F32 == 10, "fork ggml.h:446-447 values");
        ggml_init_params p = {16 * ggml_tensor_overhead(), nullptr, true};
        ggml_context *c = ggml_init(p);
        ggml_tensor *mm = ggml_mul_mat(c, ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N));
        assert(ggml_get_op_params_i32(mm, 0) == GGML_PREC_DEFAULT);
        ggml_mul_mat_set_prec(mm, GGML_PREC_F32);
        assert(ggml_get_op_params_i32(mm, 0) == 10 && ggml_prec_get_acc(mm) == GGML_PREC_F32);
        ggml_mul_mat_set_prec(mm, GGML_PREC_DEFAULT);
        assert(ggml_get_op_params_i32(mm, 0) == 0);

        ggml_tensor *q = ggml_new_tensor_3d(c, GGML_TYPE_F32, 64, 5, 4);
        ggml_tensor *k = ggml_new_tensor_3d(c, GGML_TYPE_F16, 64, 9, 4);
        ggml_tensor *v = ggml_new_tensor_3d(c, GGML_TYPE_F16, 64, 9, 4);
        ggml_tensor *fa = ggml_flash_attn_ext(c, q, k, v, nullptr, 0.125f, 0.0f, 0.0f);
        int32_t before[3];
        std::memcpy(before, fa->op_params, sizeof before);
        ggml_flash_attn_ext_set_prec(fa, GGML_PREC_F32);
        assert(ggml_get_op_params_i32(fa, 3) == 10 && ggml_prec_get_acc(fa) == GGML_PREC_F32);
        assert(std::memcmp(before, fa->op_params, sizeof before) == 0);
        ggml_free(c);
    }

    // (F2) ggml_diag_mask_inf against the fork's CPU kernel (ops.cpp:5385-5393) written as a
    // loop: dst = (i0 > n_past + i1) ? -inf : a, every row past dim 1. Unmasked values must be
    // bit-identical (a + 0.0f), masked ones exactly -inf. The shapes walk every branch of the
    // rebuild: square, fewer rows than maskable columns (concat), more (bottom pad), equal, the
    // n_past left pad, the w <= 1 copy, ne2/ne3 broadcast, and voxcpm2's recorded [11,11,16].
    {
        struct Case { int64_t ne0, ne1, ne2, ne3; int n_past; };
        const Case cases[] = {
            {7, 7, 3, 1, 0},     {9, 4, 2, 1, 0},     {10, 4, 1, 1, 3},  {10, 12, 2, 1, 3},
            {8, 5, 2, 1, 3},     {6, 6, 2, 1, 5},     {5, 3, 1, 1, 7},   {6, 6, 2, 2, 1},
            {67, 33, 4, 1, 17},  {40, 64, 3, 1, 10},  {11, 11, 16, 1, 0}, {1, 1, 1, 1, 0},
        };
        int n_devices = 0;
        for (size_t d = 0; d < ggml_backend_dev_count(); ++d) {
            ggml_backend_dev_t dev = ggml_backend_dev_get(d);
            const enum ggml_backend_dev_type type = ggml_backend_dev_type(dev);
            if (type != GGML_BACKEND_DEVICE_TYPE_CPU && type != GGML_BACKEND_DEVICE_TYPE_GPU &&
                type != GGML_BACKEND_DEVICE_TYPE_IGPU) {
                continue;
            }
            ggml_backend_t be = ggml_backend_dev_init(dev, nullptr);
            assert(be);
            for (const Case &t : cases) {
                const size_t n = (size_t)(t.ne0 * t.ne1 * t.ne2 * t.ne3);
                const auto a = ramp(n, 2.0f);
                ggml_tensor *in_seen = nullptr, *out_seen = nullptr;
                const auto got = run_on(be, [&](ggml_context *c, std::vector<ggml_tensor *> &in) {
                    in = {ggml_new_tensor_4d(c, GGML_TYPE_F32, t.ne0, t.ne1, t.ne2, t.ne3)};
                    out_seen = ggml_diag_mask_inf(c, in[0], t.n_past);
                    in_seen = in[0];
                    return out_seen;
                }, {{0, a}});
                assert(out_seen != in_seen);   // a distinct node, as the fork's is
                assert(got.size() == n);
                for (int64_t k = 0; k < t.ne2 * t.ne3; ++k) {
                    for (int64_t i1 = 0; i1 < t.ne1; ++i1) {
                        for (int64_t i0 = 0; i0 < t.ne0; ++i0) {
                            const size_t idx = (size_t)(i0 + t.ne0 * (i1 + t.ne1 * k));
                            if (i0 > t.n_past + i1) {
                                assert(std::isinf(got[idx]) && got[idx] < 0);
                            } else {
                                assert(std::memcmp(&got[idx], &a[idx], sizeof(float)) == 0);
                            }
                        }
                    }
                }
            }
            std::printf("test_audiocpp_compat: diag_mask_inf OK on %s\n", ggml_backend_dev_name(dev));
            ggml_backend_free(be);
            ++n_devices;
        }
        assert(n_devices >= 1);
    }

    // (F3) backend implementation selection: empty and "default" are ordinary initialisation;
    // anything else is refused, since no upstream backend exports the fork's hook.
    {
        ggml_backend_dev_t cpu = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU);
        assert(cpu);
        for (const char *impl : {(const char *) nullptr, "", "default"}) {
            ggml_backend_t be = ggml_backend_dev_init_with_impl(cpu, impl, nullptr);
            assert(be && ggml_backend_get_device(be) == cpu);
            ggml_backend_free(be);
        }
        assert(ggml_backend_dev_init_with_impl(cpu, "cudnn", nullptr) == nullptr);
    }

    // (F4/F5) the fork's enumerators: verbatim values where they must match the fork, and
    // never-valid ids where they must not alias an upstream one.
    static_assert(GGML_BACKEND_GRAPH_FUSION_NORM_AFFINE == 1 && GGML_BACKEND_GRAPH_FUSION_BIAS_ACTIVATION == 2 &&
                  GGML_BACKEND_GRAPH_FUSION_GATED_RESIDUAL == 4, "fork ggml-backend.h:228-232");
    static_assert(GGML_MUL_MAT_LOWERING_VULKAN_F32_INPUTS == 4 && GGML_MUL_MAT_LOWERING_METAL_F32_INPUTS == 5 &&
                  GGML_IM2COL_2D_LOWERING_METAL_TILED == 4, "fork ggml.h:460-461, 715");
    static_assert((int) GGML_TYPE_TQ2_1 == (int) GGML_TYPE_COUNT, "TQ2_1 must not alias an upstream type");
    static_assert((int) GGML_UNARY_OP_RSQRT == (int) GGML_UNARY_OP_COUNT, "RSQRT must not alias an upstream op");

    // (F6) strided views of a dim-0-permuted source: the fork's addressing, byte for byte. The
    // reference is the fork's rule done by hand on the uploaded host data —
    //   element(i0..i3) = base[(a->view_offs + offset + i0*ts + i1*nb1 + i2*nb2 + i3*nb3) / ts]
    // — and the shim's result is materialised with ggml_cont on the CPU backend. Sources: a
    // transposed leaf (pocket_tts's case), and a transposed OFFSET view (a->view_offs != 0).
    {
        const int64_t C = 5, T = 7, B = 2;                  // base: ne=[C,T,B], channels contiguous
        const auto base = ramp((size_t)(C * T * B), 1.0f);
        struct View { int rank; int64_t ne[4]; size_t nb_el[3]; size_t off_el; };   // strides in elements
        // Requested against a transposed source with ne=[T,C,B] (or [T-1,C,B]), nb_el=[C,1,C*T]:
        const View views[] = {
            {3, {1, C, B, 1}, {1, (size_t)(C * T), 0}, 0},                 // SliceModule({2,0,1}): frame 0
            {3, {1, C, B, 1}, {1, (size_t)(C * T), 0}, (size_t)(3 * C)},   // frame 3 (offset = 3*nb[0])
            {2, {3, 4, 1, 1}, {2, 0, 0}, 1},                               // raw-memory 2-D, ne0 > 1
            {4, {2, 2, 2, 1}, {3, 11, 13}, 4},                             // raw-memory 4-D
        };
        for (int offset_source = 0; offset_source < 2; ++offset_source) {
            for (const View &v : views) {
                // What the structure checks need, copied out while the context is alive: run() frees it
                // before returning, and on Apple ggml_free unmaps the pages (vm_deallocate).
                size_t src_offs = 0, view_offs = 0, view_nb[4] = {};
                bool on_leaf = false;
                std::string src_name, view_name;
                const auto got = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
                    in = {ggml_new_tensor_3d(c, GGML_TYPE_F32, C, T, B)};
                    ggml_tensor *const leaf = in[0];
                    ggml_tensor *x = in[0];
                    if (offset_source) {   // skip the first frame: a contiguous view at view_offs = C*4
                        x = ggml_view_3d(c, x, C, T - 1, B, x->nb[1], x->nb[2], x->nb[1]);
                    }
                    ggml_tensor *a = ggml_permute(c, x, 1, 0, 2, 3);         // ne=[T',C,B] nb=[C*4,4,C*T*4]
                    assert(a->nb[0] != ggml_type_size(a->type));
                    src_offs = a->view_offs;
                    src_name = a->name;
                    const size_t ts = sizeof(float);
                    ggml_tensor *view_seen = nullptr;
                    switch (v.rank) {
                        case 2: view_seen = ggml_view_2d(c, a, v.ne[0], v.ne[1], v.nb_el[0] * ts, v.off_el * ts); break;
                        case 3: view_seen = ggml_view_3d(c, a, v.ne[0], v.ne[1], v.ne[2], v.nb_el[0] * ts,
                                                         v.nb_el[1] * ts, v.off_el * ts); break;
                        default: view_seen = ggml_view_4d(c, a, v.ne[0], v.ne[1], v.ne[2], v.ne[3], v.nb_el[0] * ts,
                                                          v.nb_el[1] * ts, v.nb_el[2] * ts, v.off_el * ts); break;
                    }
                    on_leaf = view_seen->view_src == leaf;
                    view_offs = view_seen->view_offs;
                    for (int d = 0; d < 4; ++d) view_nb[d] = view_seen->nb[d];
                    view_name = view_seen->name;
                    return ggml_cont(c, view_seen);
                }, {{0, base}});
                // Structure: the fork's base, offset and strides (dim 0 forced to the element size).
                assert(on_leaf);
                assert(view_offs == src_offs + v.off_el * sizeof(float));
                assert(src_offs == (offset_source ? (size_t)C * sizeof(float) : 0));
                assert(view_nb[0] == sizeof(float) && view_nb[1] == v.nb_el[0] * sizeof(float));
                if (v.rank >= 3) assert(view_nb[2] == v.nb_el[1] * sizeof(float));
                if (v.rank == 4) assert(view_nb[3] == v.nb_el[2] * sizeof(float));
                assert(view_name == src_name + " (view)");
                // Values: the same addressing done by hand.
                const size_t nb_el[4] = {1, v.nb_el[0], v.rank >= 3 ? v.nb_el[1] : v.nb_el[0] * v.ne[1],
                                         v.rank == 4 ? v.nb_el[2] : (v.rank == 3 ? v.nb_el[1] * v.ne[2] : v.nb_el[0] * v.ne[1])};
                size_t k = 0;
                for (int64_t i3 = 0; i3 < v.ne[3]; ++i3)
                    for (int64_t i2 = 0; i2 < v.ne[2]; ++i2)
                        for (int64_t i1 = 0; i1 < v.ne[1]; ++i1)
                            for (int64_t i0 = 0; i0 < v.ne[0]; ++i0, ++k) {
                                const size_t e = src_offs / sizeof(float) + v.off_el +
                                                 i0 * nb_el[0] + i1 * nb_el[1] + i2 * nb_el[2] + i3 * nb_el[3];
                                assert(e < base.size());
                                assert(std::memcmp(&got[k], &base[e], sizeof(float)) == 0);
                            }
                assert(k == got.size());
            }
        }
        // The pocket_tts slice is also the LOGICAL frame: frame t of channel c is base[t*C + c].
        const auto frame3 = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
            in = {ggml_new_tensor_3d(c, GGML_TYPE_F32, C, T, B)};
            ggml_tensor *a = ggml_permute(c, in[0], 1, 0, 2, 3);
            return ggml_cont(c, ggml_view_3d(c, a, 1, C, B, a->nb[1], a->nb[2], 3 * a->nb[0]));
        }, {{0, base}});
        for (int64_t b = 0; b < B; ++b)
            for (int64_t ch = 0; ch < C; ++ch)
                assert(frame3[(size_t)(ch + C * b)] == base[(size_t)(3 * C + ch + C * T * b)]);
    }

    ggml_backend_free(g_cpu);
    std::puts("test_audiocpp_compat: OK");
    return 0;
}
