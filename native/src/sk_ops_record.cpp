/* Test-build-only recorder (SK_RECORD_OPS). Two capture paths feed one descriptor set:
 *  - a registered RECORDING DEVICE (ggml_backend_register) for llama.cpp / transcribe.cpp,
 *    which take a ggml_backend_dev_t and run through ggml_backend_sched — it accepts every op
 *    and every host buffer type so the scheduler routes every node to it, records, and forwards
 *    to the real CPU backend obtained through the registry;
 *  - a redirected ggml_backend_graph_compute for audio.cpp, which picks its own device by
 *    backend type and computes single-backend (audiocpp_compat.h, under SK_RECORD_OPS). */
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"
#include "sk_ops.h"
#include "ggml.h"
#include "ggml-backend.h"
#include "ggml-backend-impl.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace {
std::mutex g_rec_mutex;
std::set<std::string> g_weight_names;
std::set<int32_t> g_rung_ops;
std::vector<sk_op_desc> g_nodes;
bool g_recording = false;
ggml_backend_t g_cpu = nullptr;

/* WEIGHT = src0 of a rung op whose ROOT (through reshape/view/permute) is a parameter leaf.
 * llama.cpp / transcribe.cpp name every GGUF tensor, so the root's name is in the file's
 * tensor list. audio.cpp creates its weights UNNAMED (backend_weight_store.h
 * make_backend_tensor: ggml_new_tensor + wrap_tensor, no ggml_set_name) inside a buffer
 * tagged GGML_BACKEND_BUFFER_USAGE_WEIGHTS (backend_weight_store.h:158), so the buffer usage
 * is the signal there. A named leaf NOT in the file (a KV slot, a streaming-state tensor)
 * keeps its literal dtype; so does anything computed (op != NONE) or flagged INPUT. */
int32_t src_type_of(const ggml_tensor *node, int i) {
    const ggml_tensor *t = node->src[i];
    if (!t) return SK_SRC_ABSENT;
    if (i == 0 && g_rung_ops.count(node->op)) {
        const ggml_tensor *root = t;
        while (root->view_src) root = root->view_src;
        const bool leaf = root->op == GGML_OP_NONE && !(root->flags & GGML_TENSOR_FLAG_INPUT);
        const char *name = ggml_get_name(root);
        const bool named_in_file = name && *name && g_weight_names.count(name);
        const bool weights_buffer = root->buffer && ggml_backend_buffer_get_usage(root->buffer) == GGML_BACKEND_BUFFER_USAGE_WEIGHTS;
        if (leaf && (named_in_file || weights_buffer)) return SK_SRC_WEIGHT;
    }
    return static_cast<int32_t>(t->type);
}

/* Exactly audio.cpp's own `core::is_host_backend` (src/framework/core/backend.cpp:272-278):
 * the backend's DEVICE type is CPU. Using its definition, not ggml_backend_is_cpu, keeps the
 * `host` tag meaning the same thing as the branch audio.cpp actually took. */
bool is_host_backend(ggml_backend_t backend) {
    if (!backend) return false;
    ggml_backend_dev_t dev = ggml_backend_get_device(backend);
    return dev != nullptr && ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_CPU;
}

void record_node(const ggml_tensor *node, bool host) {
    if (!node || node->op == GGML_OP_NONE || node->op == GGML_OP_VIEW || node->op == GGML_OP_RESHAPE ||
        node->op == GGML_OP_PERMUTE || node->op == GGML_OP_TRANSPOSE) return;   // no-op views: never asked of a backend
    std::lock_guard<std::mutex> l(g_rec_mutex);
    if (!g_recording) return;
    sk_op_desc d{};
    d.op = node->op;
    std::memcpy(d.op_params.data(), node->op_params, sizeof d.op_params);
    d.dst_type = node->type;
    d.host = host;
    for (int i = 0; i < 5 && i < GGML_MAX_SRC; ++i) d.src_type[i] = src_type_of(node, i);
    for (int i = 0; i < 4; ++i) {
        d.max_ne_dst[i] = node->ne[i];
        d.max_ne_src0[i] = node->src[0] ? node->src[0]->ne[i] : 1;
        d.max_ne_src1[i] = node->src[1] ? node->src[1]->ne[i] : 1;
    }
    d.ne0_src0 = d.max_ne_src0[0]; d.ne0_src1 = d.max_ne_src1[0]; d.ne0_dst = d.max_ne_dst[0];
    // F1: the exact layout of each tensor, not one "is it contiguous" bool per source.
    d.lay_dst = sk_layout_of(node);
    if (node->src[0]) d.lay_src0 = sk_layout_of(node->src[0]);
    if (node->src[1]) d.lay_src1 = sk_layout_of(node->src[1]);
    d.max_bytes = ggml_nbytes(node);
    if (node->src[0]) d.max_bytes = std::max<uint64_t>(d.max_bytes, ggml_nbytes(node->src[0]));
    if (node->src[1]) d.max_bytes = std::max<uint64_t>(d.max_bytes, ggml_nbytes(node->src[1]));
    sk_ops_add(g_nodes, d);
}
}  // namespace

/* audio.cpp path: every graph_compute AND every graph_plan_create in every audio.cpp TU lands
 * here (compat header). pocket_tts's FlowLM goes through create_backend_graph_plan_if_host →
 * ggml_backend_graph_plan_create + plan_compute on a host backend (audio.cpp
 * src/models/pocket_tts/flow_lm.cpp:431,688 → src/framework/core/backend.cpp:455-459), and
 * plan_compute carries no graph, so the plan-create hook is where those nodes are seen. This
 * TU is compiled WITHOUT the redirect, so the calls below are the real functions. */
extern "C" enum ggml_status sk_recording_graph_compute(ggml_backend_t backend, struct ggml_cgraph *cgraph) {
    // F2: audio.cpp branches its graph construction on host-vs-device (uses_host_graph_plan /
    // is_host_backend), so the node has to carry which side it came from. This path may be
    // either — the model runs on the device backend, while helper subgraphs can be computed on
    // a host one.
    const bool host = is_host_backend(backend);
    for (int i = 0; i < ggml_graph_n_nodes(cgraph); ++i) record_node(ggml_graph_node(cgraph, i), host);
    return ggml_backend_graph_compute(backend, cgraph);
}
extern "C" ggml_backend_graph_plan_t sk_recording_graph_plan_create(ggml_backend_t backend, struct ggml_cgraph *cgraph) {
    // Host by construction: audio.cpp only reaches graph_plan_create through
    // create_backend_graph_plan_if_host (pocket_tts's FlowLM). Tagged from the backend anyway,
    // so a future non-host plan user records truthfully.
    const bool host = is_host_backend(backend);
    for (int i = 0; i < ggml_graph_n_nodes(cgraph); ++i) record_node(ggml_graph_node(cgraph, i), host);
    return ggml_backend_graph_plan_create(backend, cgraph);
}

/* llama.cpp / transcribe.cpp path: a device that accepts everything and forwards to CPU.
 * Member orders below are ggml v0.22.0's ggml-backend-impl.h (GGML_BACKEND_API_VERSION 2):
 *   ggml_backend_i (16): get_name, free, set_tensor_async, get_tensor_async, set_tensor_2d_async,
 *     get_tensor_2d_async, cpy_tensor_async, synchronize, graph_plan_create, graph_plan_free,
 *     graph_plan_update, graph_plan_compute, graph_compute, event_record, event_wait, graph_optimize
 *   ggml_backend_device_i (15): get_name, get_description, get_memory, get_type, get_props,
 *     init_backend, get_buffer_type, get_host_buffer_type, buffer_from_host_ptr, supports_op,
 *     supports_buft, offload_op, event_new, event_free, event_synchronize
 *   ggml_backend_dev_caps (5): async, host_buffer, buffer_from_host_ptr, events, mmap_support
 *   ggml_backend_dev_props (7, set by name below): name, description, memory_free, memory_total,
 *     type, device_id, caps */
namespace {
const char *rec_name(ggml_backend_t) { return "SKREC"; }
void rec_free(ggml_backend_t b) { delete b; }
enum ggml_status rec_compute(ggml_backend_t, struct ggml_cgraph *g) {
    // This device advertises itself as a GPU (dev_type below) precisely so llama.cpp /
    // transcribe.cpp route every node to it and build their DEVICE graph; that it forwards the
    // computation to CPU is an implementation detail. host = false.
    for (int i = 0; i < ggml_graph_n_nodes(g); ++i) record_node(ggml_graph_node(g, i), false);
    return ggml_backend_graph_compute(g_cpu, g);
}
ggml_backend_i rec_iface = {
    rec_name, rec_free,
    nullptr, nullptr, nullptr, nullptr,            // set/get_tensor_async, set/get_tensor_2d_async
    nullptr, nullptr,                              // cpy_tensor_async, synchronize
    nullptr, nullptr, nullptr, nullptr,            // graph_plan_create/free/update/compute
    rec_compute,
    nullptr, nullptr, nullptr,                     // event_record, event_wait, graph_optimize
};
ggml_guid_t rec_guid() { static ggml_guid g = {0x53,0x4b,0x52,0x45,0x43,0,0,0,0,0,0,0,0,0,0,1}; return &g; }

const char *dev_name(ggml_backend_dev_t) { return "SKREC0"; }
const char *dev_desc(ggml_backend_dev_t) { return "sokuji op recorder"; }
void dev_memory(ggml_backend_dev_t, size_t *f, size_t *t) { *f = *t = size_t(64) << 30; }
enum ggml_backend_dev_type dev_type(ggml_backend_dev_t) { return GGML_BACKEND_DEVICE_TYPE_GPU; }
void dev_props(ggml_backend_dev_t d, ggml_backend_dev_props *p) {
    p->name = dev_name(d); p->description = dev_desc(d); p->device_id = nullptr;
    dev_memory(d, &p->memory_free, &p->memory_total);
    p->type = dev_type(d); p->caps = {false, false, false, false, false};
}
ggml_backend_t dev_init(ggml_backend_dev_t d, const char *) {
    if (!g_cpu) g_cpu = ggml_backend_init_by_type(GGML_BACKEND_DEVICE_TYPE_CPU, nullptr);   // registry-resolved: the dlopen'd CPU module
    return new ggml_backend{rec_guid(), rec_iface, d, nullptr};
}
ggml_backend_buffer_type_t dev_buft(ggml_backend_dev_t) { return ggml_backend_cpu_buffer_type(); }
bool dev_supports_op(ggml_backend_dev_t, const ggml_tensor *) { return true; }      // everything routes here
bool dev_supports_buft(ggml_backend_dev_t, ggml_backend_buffer_type_t buft) { return ggml_backend_buft_is_host(buft); }
ggml_backend_device_i dev_iface = {
    dev_name, dev_desc, dev_memory, dev_type, dev_props,
    dev_init, dev_buft,
    nullptr, nullptr,                              // get_host_buffer_type, buffer_from_host_ptr
    dev_supports_op, dev_supports_buft,
    nullptr, nullptr, nullptr, nullptr,            // offload_op, event_new, event_free, event_synchronize
};
const char *reg_name(ggml_backend_reg_t) { return "SKREC"; }
size_t reg_count(ggml_backend_reg_t) { return 1; }
ggml_backend_dev_t reg_get(ggml_backend_reg_t r, size_t) { static ggml_backend_device dev{dev_iface, r, nullptr}; return &dev; }
ggml_backend_reg_i reg_iface = { reg_name, reg_count, reg_get, nullptr };
}  // namespace

extern "C" {

SK_API int32_t sk_record_register_device(void) {
    static ggml_backend_reg reg{GGML_BACKEND_API_VERSION, reg_iface, nullptr};
    static bool done = false;
    if (!done) { ggml_backend_register(&reg); done = true; }
    return 1;
}

SK_API void sk_record_begin(const char *const *names, int32_t n, const char *const *rung_ops, int32_t n_ops) {
    std::lock_guard<std::mutex> l(g_rec_mutex);
    g_weight_names.clear(); g_rung_ops.clear(); g_nodes.clear();
    for (int32_t i = 0; i < n; ++i) if (names[i]) g_weight_names.insert(names[i]);
    for (int32_t i = 0; i < n_ops; ++i)
        for (int o = 0; o < GGML_OP_COUNT; ++o)
            if (rung_ops[i] && std::strcmp(rung_ops[i], ggml_op_name(static_cast<ggml_op>(o))) == 0) g_rung_ops.insert(o);
    g_recording = true;
}

SK_API int32_t sk_record_node_count(void) { std::lock_guard<std::mutex> l(g_rec_mutex); return static_cast<int32_t>(g_nodes.size()); }

SK_API sk_status sk_record_end_to_file(const char *path, const char *stage, const char *family,
                                       const char *source_file, const char *recorded_on,
                                       const char *const *dtypes, int32_t n_dtypes) {
    sk_op_recording r;
    {
        std::lock_guard<std::mutex> l(g_rec_mutex);
        g_recording = false;
        r.nodes = g_nodes;   // COPIED, not moved: a recording costs minutes of model loading and
    }                        // synthesis, so a failed write must leave it retryable in memory.
    r.stage = stage; r.family = family; r.engine = sk_engine_versions(); r.source_file = source_file;
    r.recorded_on = recorded_on ? recorded_on : "cpu";
    for (int32_t i = 0; i < n_dtypes; ++i) r.dtypes_in_file.push_back(dtypes[i]);
    std::sort(r.dtypes_in_file.begin(), r.dtypes_in_file.end());
    std::ofstream f(path);
    if (!f) {
        sk::set_error(std::string("sk_record_end_to_file: cannot open ") + path + " for writing");
        return SK_ERR_INTERNAL;
    }
    f << sk_ops_format(r);
    f.close();   // a short write or ENOSPC only surfaces on flush; the insertion above cannot see it
    if (!f.good()) {
        sk::set_error(std::string("sk_record_end_to_file: failed to write ") + path);
        return SK_ERR_INTERNAL;
    }
    std::lock_guard<std::mutex> l(g_rec_mutex);
    g_nodes.clear();
    return SK_OK;
}

}  // extern "C"
