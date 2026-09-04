# Native device profile: structured capabilities, op coverage, cache generations

**Date:** 2026-09-04
**Branch:** `docs/device-profile-spec` (worktree `.claude/worktrees/device-profile`)
**Status:** design approved in conversation; third draft after three rounds of
adversarial review (findings in
`docs/superpowers/notes/2026-09-04-device-profile-review-findings.md`);
implementation plan follows this spec.
**Series:** A of three. B (recommendation ladder, downloaded-wins, auto-pin, variant
reasons) and C (speed signal: CPU-floor measurement, `resolve_tts` bench, unified RTF
definitions) are separate specs that build on this one. Nothing here changes which
rung is recommended or which device a model runs on, except that a TTS plan the
device cannot execute is no longer offered.

## 1. Goal

Give every machine a **structured device profile** the planner, the renderer and a
pasted bug report can all read — produced once per (hardware, native version, driver),
in-process, with no timing — and use it for the one decision it can settle honestly:
**whether a (quant, tier) deployment can execute on this device at all**.

Three things this buys:

1. **"Unsupported" gets a structural source.** Today the only capability judgement in
   the planner is a case-insensitive substring match on the device description
   (`planner._PARAVIRTUAL_GPU_RE`, ruling R36), added after the paravirtual CI GPU
   aborted the process on `GGML_OP_NORM`. The same class of failure — a backend that
   lacks an op a family's graph needs — is what every Metal patch in
   `native/cmake/ggml_options.cmake` (DIAG_MASK_INF, leading-edge PAD) was for. The
   profile answers it before a download, from `ggml_backend_dev_supports_op`, the one
   query that would have caught each of those before a ruling was needed.
2. **A bench cache that invalidates when it should.** `Machine.fingerprint`
   (`accel.py:152-156`) hashes OS, arch, installed backends, `tc_kinds` and the GPU
   (kind, description, mem_total) tuples — not `sk_version()`, not the engine pins, not
   the driver. A native wheel bump or a driver update leaves every cached `rtf`/`tps`/
   `tts` number in place, so the placement decisions spec C will make from those
   numbers would read a previous engine's speed forever. Every cache key gains a
   **generation** prefix that changes with any of those.
3. **A diagnosable machine.** `hardware_info_result` carries the full profile; the
   renderer forwards it into the `local.native.hardware` realtime event that already
   lands in LogsPanel. "Why is this rung unavailable on my box" becomes answerable
   from a pasted log.

### 1.1 Premises (decided 2026-09-03/04)

1. **Tiers say what CAN run; the planner and the recommendation say what SHOULD.**
   Every family carries `gpu-vulkan`, `gpu-metal` and `cpu` (catalog commit `2f2b28bc`);
   withholding a tier because a family is slow there only pushes that machine onto a
   slower path. This spec adds the honest exception: a tier the device cannot execute
   is withheld, structurally — and only where "cannot execute" is literally true (§3.3:
   audio.cpp runs single-backend and aborts; llama.cpp and transcribe.cpp schedule an
   unsupported op onto the CPU and keep running).
2. **Quant selection is a download-time recommendation** (a rung change is a new GGUF),
   and its objective is throughput — sustained speech must not accumulate lag — with
   quality preferred among rungs that keep up. That logic is spec B's; this spec only
   guarantees the candidates B ranks are ones the device can run.
3. **No per-rung "acceleration path" field, no kernel micro-benchmark.** Both were the
   first draft of this design and both failed review against the pinned ggml
   (v0.22.0) and this fleet:
   - CPU: `ggml_get_type_traits_cpu(type)->vec_dot` is non-NULL for every type Sokuji
     publishes (SIMD vs scalar is an `#ifdef` inside each function), and the symbol
     lives in the dlopen'd CPU module (`GGML_BACKEND_DL=ON`), not in anything
     `libsokuji_native` links. CPU is bandwidth-bound; the existing rule "no GPU →
     smallest quant" (`_tc_pick_quant`) already encodes what matters.
   - Metal: `has_simdgroup_reduction` and `has_bfloat` are true on every Apple Silicon
     GPU we ship to (mac-x64 has no Metal lane). The only Metal device that differs is
     the paravirtual VM, and what actually broke on Metal was op coverage, not speed.
   - Vulkan: the dedicated K-quant `mul_mat_vec_*.comp` shaders are compiled into the
     wheel — every device gets the same set (including `q6_k`, contrary to an earlier
     research note). The device-variable facts are fp16 / bf16 / integer-dot / coopmat /
     coopmat2, but ggml chooses the kernel path **at runtime per (vendor, architecture,
     K, N, type)** (`ggml_vk_should_use_mmvq`): Q8_0's mmvq only on NVIDIA pre-Turing,
     Q6_K's only on Intel, never for n==1 with k≤4096 on NVIDIA. A catalog cannot state
     which path a rung will take, and a fixed-shape probe measures a path the model may
     never use.
   - TTS and ASR graphs are not MUL_MAT-dominated (conv1d/im2col, flash-attention,
     vocoders), and the known bf16-on-Vulkan defect is numerical (moss_tts_nano peak
     1.228 clips), not speed.
   So the profile records **device facts** (features, driver, uma, op coverage) and
   leaves speed to measurement (spec C).
4. **No published RTF prior table.** A table keyed by lane from two fleet boxes would
   be wrong for most devices and cannot be kept current; "unknown until measured" beats
   a confident wrong answer in either direction. (jiangzhuo, 2026-09-04.)
5. **An absent or unknown profile changes nothing.** An older wheel, a fixture
   `Machine`, or a device whose profile could not be read all resolve exactly as today.
   The frozen characterisation suite (`sidecar/tests/test_characterization.py`) must
   not move. The `Machine` field defaults are what make this true (§3.3), not a fixture.
6. **The only capability question a backend answers truthfully is `supports_op`.** No
   public ggml API distinguishes "has a fast kernel" from "runs"; `supports_op` encodes
   each backend's real rule including its build flags and env overrides. Every gate in
   this spec is therefore a `supports_op` answer. The **raw Vulkan feature bits** in
   the profile are diagnostics and never gate anything. The **two Metal bits** are
   `supports_op` answers themselves (§3.1), and exactly one of them —
   `mtl_simdgroup_reduction` — gates, at tier level in `_tier_available`, because
   `NORM` is in every family's graph and its absence is what R36 was written for.

## 2. What exists today

- **Native.** `sk_device` (`native/include/sokuji_native.h:88-95`) is
  `{index, kind, name[64], description[128], mem_total, mem_free}`. `sk_init`
  (`sk_common.cpp:195-215`) walks `ggml_backend_dev_count()` and keeps CPU/GPU/IGPU
  devices in `g_devices`; `sk_devices()` (`sk_common.cpp:229`) fills the struct from
  `ggml_backend_dev_name/description/memory`. Device kind is inferred from the
  registry name ("Vulkan"/"MTL") — `ggml-vulkan.h` and `ggml-metal.h` are on the
  include path via the `ggml` target but nothing in `native/src` includes them. Every
  backend is a dlopen'd module (`GGML_BACKEND_DL ON`, `ggml_options.cmake:93`), so
  backend-specific symbols are not linkable from `libsokuji_native`; only what a
  registration exposes through `ggml_backend_reg_get_proc_address` is reachable —
  neither the CPU nor the Metal registration exposes `ggml_get_type_traits_cpu` or
  `ggml_backend_metal_supports_family` (the CPU one exposes its threads / threadpool /
  NUMA / `ggml_backend_get_features` hooks; Metal only `ggml_backend_get_features`).
  The three loaders take registry devices, never backend objects: `sk_translate.cpp`
  puts a `ggml_backend_dev_t` into `llama_model_params.devices`, `sk_asr.cpp` hands
  one to transcribe.cpp, and `sk_tts.cpp` gives audio.cpp a `core::BackendType` plus a
  backend-relative index (`backend_relative_index`), after which audio.cpp initialises
  the backend itself. `sk_status` values are `SK_OK`, `SK_ERR_INVALID_ARGUMENT`,
  `SK_ERR_NOT_INITIALISED`, `SK_ERR_BACKEND`, `SK_ERR_NOT_FOUND`, `SK_ERR_CANCELLED`,
  `SK_ERR_INTERNAL` (`sokuji_native.h:46-52`). The ABI number is stamped in three
  places that nothing cross-checks: `#define SK_ABI_VERSION 1` (`sokuji_native.h:42`),
  `SK_ABI_VERSION = 1` (`_ffi.py:6`), `set(SK_ABI_VERSION_NUM 1)`
  (`native/CMakeLists.txt:120`, which `cmake/contract.json.in` stamps into the wheel);
  the binding refuses a `contract.json` or a library whose ABI differs
  (`__init__.py:69-95`). The Vulkan lane's `find_package(Vulkan QUIET)`
  (`ggml_options.cmake:16`) runs only under `SOKUJI_GPU=auto`; CI passes the lane
  explicitly (`native/ci/build.sh:14`), and `sokuji_native` links only `ggml`,
  `transcribe`, `llama`, `engine_runtime` (`CMakeLists.txt:52-81`).
  `native/ci/check_linux_deps.py` applies one global allow-list to every staged shared
  object, and `libvulkan.so.1` is in it — so today a `libvulkan` DT_NEEDED on
  `libsokuji_native.so` would pass.
- **Engines and unsupported ops.** llama.cpp runs every graph through
  `ggml_backend_sched` with the CPU backend in the list, and places weights per tensor
  via `ggml_backend_dev_supports_op` (`llama-model.cpp` `select_buft`); transcribe.cpp
  does the same in every arch (`ggml_backend_sched_new` + `ggml_backend_sched_graph_compute`).
  For both, an op the GPU refuses is scheduled onto the CPU and the plan runs, slower.
  audio.cpp never creates a scheduler — every family calls
  `ggml_backend_graph_compute(backend, graph)` directly — which is where
  `GGML_ABORT("unsupported op")` fires and why the paravirtual Metal box aborted on
  NORM at execution. (Verified against llama.cpp 0.2.0 and transcribe.cpp 0.2.2 trees
  on disk; the design predates the pinned 0.3.0 / 0.2.3.)
- **ggml's Vulkan device list is not the loader's.** `ggml_vk_instance_init`
  (ggml-vulkan.cpp:7494-7548 at v0.22.0) de-duplicates physical devices with the same
  `deviceUUID` (two ICDs exposing one card — RADV and AMDVLK, Mesa and the Intel
  proprietary driver, NVIDIA proprietary and NVK) by a `driverID` priority table, and
  honours `GGML_VK_VISIBLE_DEVICES`. Device `i` in `sk_devices()` is an index into
  that surviving list.
- **Sidecar.** `Machine` (`accel.py:20-45`) carries `tc_kinds` and
  `gpus: tuple[(kind, description, mem_total)]`; `probe()` builds it once per process
  from four detectors (`_native_kinds`, `_native_gpus`, `_apple_silicon`, `_installed`)
  each wrapped by `_safe`, and every test that calls `probe(force=True)` isolates it by
  patching exactly those four. `planner._tier_available(tier, machine, backend=None)`
  (`planner.py:121-142`) is the tier gate every selection path calls
  (`resolve_deployments`' `usable` filter at 160-162, `_llamacpp_variant_row`'s `_row()`
  and `gpu_possible`, `select_variant.candidate()` at 575-586, `_tc_pick_quant`'s
  `gpu_possible`); `_h_models_catalog` calls `_tc_pick_quant` and
  `_llamacpp_variant_row` directly (not through the four entry points), computes
  `tiers[].available` per tier with `_tier_available` and de-duplicates `tiers[]`
  across rungs (`seen_tiers`), and sets `variants[].supported = True` unconditionally
  for GGUF cards because the cpu row is always there; `_engine_identity` ranks devices
  with `_tier_available` and has no model in scope; the `backend` parameter of
  `_tier_available` is accepted and unread. The resolve wrappers receive
  `override=device or "auto"` from the engines, so `override == "cpu"` reaches them.
  Bench entries are keyed by `planner._bench_key(fingerprint, model_id, backend,
  device, compute_type)` (`planner.py:183`) under namespaces `""`, `"tps:"`, `"tts:"`,
  written by `accel._measure` (511-532) and **read** by `planner._resolve_model` and
  `resolve_translate`'s `_tps`, stored as a flat `{key: float}` file in
  `~/.cache/sokuji-sidecar/accel-bench.json` by `bench_load`/`bench_save(cache)`
  (490-509) with a plain `open(path, "w")`. `_h_hardware_info` (731) returns `gpus[]`
  as `{vendor, name, vramMb}` plus the four `_engine_identity` fields;
  `wire_schema.json` pins that message's required and optional fields and
  `wire.validate_outbound` rejects any other top-level field under
  `SOKUJI_WIRE_STRICT=1`, which `conftest.py` sets for the whole suite.
- **Catalog.** `_ModelBase` (`catalog.py:26-41`) has `id, name, languages,
  deployments, recommended, sort_order, size_bytes, download_ignore`; `AsrModel` adds
  nothing (43), `_tc_row(mid, name, langs, repo, base, order, quants, default, ...)`
  stores no architecture (`base` is the filename stem); `TranslateModel.prompt_family`
  (455-461) selects a prompt strategy and is `"qwen"` for qwen2.5, qwen3, qwen3.5 and
  EuroLLM alike — it is not a graph family; only `TtsModel.family` (614-615) names a
  graph (the audio.cpp family). 66 ASR cards, 11 translate cards, 9 TTS families.
  A K-quant `*_M` rung is not one weight dtype: a Q4_K_M file carries Q6_K and Q5_K
  tensors (attention V, some FFN-down, `output.weight`) and often Q8_0/F16
  embeddings; Q5_K_M carries Q6_K.
- **Renderer.** `HardwareInfoResultMsg` (`nativeProtocol.ts:50-60`);
  `nativeProtocol.consistency.test.ts` diffs every `ServerMsg` member against
  `wire_schema.json` field-for-field; `LocalNativeClient` forwards
  `os/arch/cpuCores/gpus/backendsInstalled/accelAvailable` into the
  `local.native.hardware` event (`LocalNativeClient.ts:91-94`); `nativeModelStore`
  keeps the engine identity from the ready-transition `hardware_info` call as
  `engineInfo`, which `nativeModelStore.test.ts:456` compares with `toEqual`.
  `variants[].supported` is read as "cannot load at all": `NativeModelManagementSection.tsx`
  disables the option and ignores the click, and `nativeModelStore.deriveVariantRepos`
  deletes a persisted pin whose variant is `supported === false`.
- **Tests.** `test_planner.py:191-275` pins `_tier_available` (nine cases including the
  two paravirtual ones); `test_accel.py:917-920` defines
  `_FakeDev(index, kind, desc, total, free)` and `_fake_native_module(monkeypatch,
  devs, *, version="1.0.1", engine_versions=None)` at 929; `test_bench_cache_roundtrip`
  (393-398), `test_bench_key_is_stable_and_distinct` (407-410) and
  `test_measure_rtf_runs_and_caches` (413-428) build cache keys with `_bench_key`
  directly; `test_characterization.py` builds its four `Machine`s directly with
  keyword arguments at import (lines 55-80), never through `probe()`, and pins only
  `_downloaded_quants` and `bench_load`. Fixture deployments use backends such as
  `"be"` and `"ctranslate2"`. Cached test models: `~/.cache/sokuji-native-tests/`
  holds whisper-tiny, moonshine-streaming-tiny and Qwen3-0.6B (all Q8_0) and, under
  `tts/` and `tts-bf16/`, **all nine** audio.cpp families.

## 3. Design

### 3.1 Native: `sk_device_profile`

A new struct and accessor; `sk_device` itself is unchanged so every existing caller
keeps its layout. `SK_ABI_VERSION` goes to **2**.

```c
enum sk_feature {
    /* Vulkan: RAW feature bits from the physical device. ggml applies further gates
     * before using any of them (build-time GGML_VULKAN_*_GLSLC_SUPPORT, the
     * GGML_VK_DISABLE_* environment, per-driver deny-lists for coopmat), so a set bit
     * means "the device offers it", not "ggml uses it". Diagnostics only; never a gate. */
    SK_FEAT_VK_SHADER_FLOAT16     = 1u << 0,  /* VkPhysicalDeviceShaderFloat16Int8Features.shaderFloat16 */
    SK_FEAT_VK_SHADER_BFLOAT16    = 1u << 1,  /* VkPhysicalDeviceShaderBfloat16FeaturesKHR.shaderBFloat16Type */
    SK_FEAT_VK_INTEGER_DOT        = 1u << 2,  /* VkPhysicalDeviceShaderIntegerDotProductFeatures.shaderIntegerDotProduct */
    SK_FEAT_VK_COOPMAT            = 1u << 3,  /* VkPhysicalDeviceCooperativeMatrixFeaturesKHR.cooperativeMatrix */
    SK_FEAT_VK_COOPMAT2           = 1u << 4,  /* VkPhysicalDeviceCooperativeMatrix2FeaturesNV.cooperativeMatrixWorkgroupScope */
    /* Metal: supports_op ANSWERS, so they equal what ggml will do (has_simdgroup_reduction /
     * has_bfloat, including GGML_METAL_BF16_DISABLE and the Metal4 dummy-compile fallback).
     * SIMDGROUP_REDUCTION is the one profile bit that gates (tier level, §3.3, R36). */
    SK_FEAT_MTL_SIMDGROUP_REDUCTION = 1u << 5, /* supports_op(NORM[f32,-]) on the Metal device */
    SK_FEAT_MTL_BFLOAT              = 1u << 6, /* supports_op(MUL_MAT[bf16,f32]) on the Metal device; diagnostics only */
    /* Both: */
    SK_FEAT_UMA                   = 1u << 7,  /* Vulkan: VkPhysicalDeviceProperties.deviceType == INTEGRATED_GPU
                                                 (ggml's own rule, ggml-vulkan.cpp `device->uma`); Metal: always */
};

typedef struct sk_device_profile {
    int32_t  index;               /* same flat index as sk_device.index */
    int32_t  known;               /* 0 = nothing below is meaningful (query failed, loader absent); consumers pass through */
    uint32_t features;            /* sk_feature bits; only meaningful when known */
    char     driver_name[64];     /* Vulkan: VkPhysicalDeviceDriverProperties.driverName; Metal: "Metal"; CPU: "" */
    char     driver_version[256]; /* Vulkan: driverInfo (VK_MAX_DRIVER_INFO_SIZE); Metal: sysctlbyname("kern.osversion"); CPU: "" */
    char     device_uuid[40];     /* Vulkan: VkPhysicalDeviceIDProperties.deviceUUID as 32 hex chars; else "" */
    char     cpu_features[512];   /* CPU device only: "AVX2=1,FMA=1,..." from ggml_backend_get_features; else "" */
} sk_device_profile;

/* SK_ERR_INVALID_ARGUMENT for a bad index or NULL out; SK_ERR_NOT_INITIALISED before
 * sk_init; otherwise SK_OK, with known = 0 when the profile could not be read. Strings
 * that exceed their buffer are truncated (the sizes above cover every value ggml or
 * Vulkan defines; the CTest asserts the CPU feature string fits). */
SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out);
```

Sources, per device kind:

- **Vulkan.** The library enumerates physical devices itself, **without linking the
  loader**: it compiles against `Vulkan-Headers` only (`VK_NO_PROTOTYPES`), and at
  profile time `dlopen("libvulkan.so.1")` / `LoadLibraryW(L"vulkan-1.dll")`, resolves
  `vkGetInstanceProcAddr`, creates a minimal `VkInstance`, and reads
  `vkGetPhysicalDeviceProperties2` (driver, ID, device type) and
  `vkGetPhysicalDeviceFeatures2` (float16-int8, bfloat16, integer-dot-product,
  cooperative-matrix, cooperative-matrix-2) with those structures chained. If the
  loader is absent the profile is `known = 0` and nothing else changes — a machine
  without the loader already lists no Vulkan device in `sk_devices()`.
  `libsokuji_native` must not gain a `libvulkan` DT_NEEDED or import;
  `check_linux_deps.py` gains a per-file deny rule
  (`DENY_BY_FILE = {"libsokuji_native.so": {"libvulkan.so.1"}}`) beside its global
  allow-list. CMake: when `SOKUJI_GPU_RESOLVED` is `vulkan`, `find_package(Vulkan
  QUIET)` runs in native's own scope (it does not today when the lane is passed
  explicitly) and `sokuji_native` links `Vulkan::Headers` only.
  **Matching ggml's device `i` to a physical device replicates ggml's own selection**
  (§2): group the loader's physical devices by `deviceUUID`, keep one per group by the
  same `driverID` priority table (RADV > AMDVLK > AMD proprietary; Mesa Intel > Intel
  proprietary; NVIDIA proprietary > NVK; Dozen last — pinned per ggml bump with a
  comment naming `ggml-vulkan.cpp`'s lines, the way `native/patches/*.json` pin
  text), apply `GGML_VK_VISIBLE_DEVICES`, then match positionally; fall back to
  description matching only when the counts differ, and record which path was taken
  in the log. This is what makes a RADV↔AMDVLK switch change `driver_name` and
  therefore the generation (§3.3) — the motivating case in §1(2). It never touches
  ggml-vulkan's private `vk_device`.
- **Metal.** The two bits are read through `ggml_backend_dev_supports_op` on the Metal
  device with one scratch tensor each — `NORM[f32,-]` for simdgroup reduction,
  `MUL_MAT[bf16,f32]` for bfloat — because that predicate is ggml's own expression of
  `has_simdgroup_reduction` (Apple7 **or** Metal3) and `has_bfloat` (Apple6 / Metal3,
  minus `GGML_METAL_BF16_DISABLE` and the Metal4 fallback), and
  `ggml_backend_metal_supports_family` is not reachable from the host library (§2).
  `driver_name` is `"Metal"`, `driver_version` is `sysctlbyname("kern.osversion")`
  (in-process; the string `sw_vers -buildVersion` prints). `SK_FEAT_UMA` is always set.
- **CPU.** `ggml_backend_reg_get_proc_address(reg, "ggml_backend_get_features")` on
  the loaded CPU registration, joined as `NAME=value` pairs. This reports the variant
  ggml actually chose at load (`ggml_backend_score`), which is otherwise unobservable.
- Any failure zeroes the struct and sets `known = 0`; `sk_device_profile_get` returns
  `SK_OK` in that case. Every ggml and Vulkan call is wrapped so a C++ exception never
  crosses the C ABI.

Cost: one Vulkan enumeration through the loader (tens of milliseconds, once per
process), two Metal `supports_op` predicates, one proc-address call. Nothing executes
on the device and no Vulkan device is initialised by this call.

### 3.2 Native: `sk_device_supports_ops`

```c
/* Spelling, used identically by the tables, the dumps, the cache and the wire:
 *   OP[src0,src1]   — ggml_op_name() and ggml_type_name(); "-" for an absent source.
 *   Only src0 and src1 are recorded: src2+ (attention masks, rope positions) carry
 *   fixed dtypes that never vary by rung and never decide support. */
typedef struct sk_op_check { char name[48]; int32_t supported; } sk_op_check;
#define SK_OP_COVERAGE_MAX 96          /* static_assert in sk_ops.cpp: every expanded table fits */
typedef struct sk_op_coverage {
    int32_t n_ops;            /* entries written */
    int32_t all_supported;    /* 1 iff every entry is supported */
    sk_op_check ops[SK_OP_COVERAGE_MAX];
} sk_op_coverage;

/* stage: "asr" | "translate" | "tts". family: the card's graph_family (§3.3).
 * compute_type: the rung ("q4_k_m" | "q5_k_m" | "q6_k" | "q8_0" | "f16" | "bf16").
 * Unknown (stage, family) → SK_ERR_NOT_FOUND; unknown compute_type, bad index or NULL
 * out → SK_ERR_INVALID_ARGUMENT; an expanded table longer than SK_OP_COVERAGE_MAX →
 * SK_ERR_INTERNAL; a backend exception → SK_ERR_BACKEND. The caller treats every
 * error as "unknown", never as "unsupported". */
SK_API sk_status sk_device_supports_ops(int32_t index, const char *stage, const char *family,
                                        const char *compute_type, sk_op_coverage *out);
```

Each entry is answered by `ggml_backend_dev_supports_op` on a scratch `ggml_context`
(`no_alloc`) holding one representative tensor per entry, so the answer is the
backend's own `supports_op` predicate — the check ggml's scheduler makes per node and
the check llama.cpp makes per weight tensor when it places buffers.

**Rungs are dtype sets, not dtypes.** Table entries whose weight dtype depends on the
rung use the placeholder `WEIGHT`; the call expands each such entry into one check
per dtype in the rung's set, from one table in `sk_ops.cpp`:

| rung | weight dtypes checked |
|---|---|
| `q4_k_m` | Q4_K, Q5_K, Q6_K, Q8_0, F16 |
| `q5_k_m` | Q5_K, Q6_K, Q8_0, F16 |
| `q6_k` | Q6_K, Q8_0, F16 |
| `q8_0` | Q8_0, F16 |
| `f16` | F16 |
| `bf16` | BF16, F16 |

So one family table serves every rung, a device that refuses one dtype loses only the
rungs that contain it, and the mixed tensors of a `*_M` file (§2) are covered.
`test_ops_coverage` asserts, for every cached GGUF, that its actual tensor-dtype set is
⊆ the set for its rung.

**Cost and hazard, stated plainly.** On Vulkan, `ggml_backend_vk_device_supports_op`
begins with `ggml_vk_get_device`, which on first call creates the `VkDevice` and runs
`ggml_vk_load_shaders` — the full pipeline set, seconds on a cold driver cache — and
can throw `std::runtime_error` ("Unsupported device", "Device not found"). Nothing in
the sidecar triggers that today before the first model load. So: the call is wrapped
(`SK_ERR_BACKEND` on exception), and the sidecar calls it only when a GPU deployment
is actually being considered for a load (§3.3) — never on the sidecar-ready path,
never for an explicit CPU load, never inside the pure planner. On Metal and CPU the
predicate is cheap. On no backend does the query execute a graph, so it cannot
`GGML_ABORT`.

The op tables live in `native/src/sk_ops.cpp`, keyed by `(stage, family)`, and hold
every `(op, src0 type, src1 type)` the family's graph uses at the pinned engine
versions, with `WEIGHT` where the rung decides. They are the "manifest" side of the
design: a per-family statement of what the graph requires, compared against the
device. The families to cover are the catalog's graph families (§3.3): the nine
audio.cpp families for `tts`; for `translate` the llama.cpp architectures behind the
eleven cards (`qwen2`, `qwen3`, `qwen35`, `gemma3`, `llama` for EuroLLM, `hunyuan`
for the four Hunyuan cards — the exact `general.architecture` strings are read from
the GGUFs by the implementation plan and become the table keys); for `asr` the
transcribe.cpp architectures behind the 66 cards, which `sk_asr_caps.arch` already
reports after a load. Tables land incrementally (§3.3 says what a missing table
means); the TTS tables are complete before the first release, because that is the
stage the gate fires for. Three things keep the tables honest:

- **A CTest that diffs them against the real graph** (`test_ops_coverage`), with two
  recording mechanisms because the engines take devices, not backends (§2):
  - **llama.cpp and transcribe.cpp**: the test registers a **recording device** before
    `sk_init` — a `ggml_backend_reg` (via `ggml_backend_register`) exposing one
    `ggml_backend_dev_i` of type GPU whose `supports_op` returns true for every op,
    whose buffer type is the CPU one, and whose `init_backend` returns a backend that
    records `(op, src[0]->type, src[1]->type)` in `graph_compute` and forwards to a
    real `ggml_backend_cpu_init()`. It appears in `sk_devices()` as an ordinary flat
    index, so the existing `sk_asr_load` / `sk_translate_load` paths run unchanged
    on it; accepting every op means the scheduler routes every node to it and
    nothing hides on the real CPU backend. llama.cpp is recorded with flash
    attention both on and off, since its graph differs by device.
  - **audio.cpp** selects its device by backend type and initialises it itself, so a
    registered device is not reachable; it calls `ggml_backend_graph_compute`
    directly (§2), so the test build wraps that call instead: under
    `SK_RECORD_OPS`, `audiocpp_compat.h` (which every audio.cpp translation unit
    already includes) redirects `ggml_backend_graph_compute` to
    `sk_recording_graph_compute`, which walks `cgraph->nodes[i]`, records, and
    forwards. `ggml-backend-impl.h` is reachable for both mechanisms (it sits beside
    `ggml-impl.h`, which the compat header already includes).
  The recorded set must be ⊆ the expanded table; a pin bump that adds an op turns the
  test red naming the entry — the same discipline as the exact-text patches in
  `native/patches/`. **All nine TTS families are recorded live on every run** (their
  models are cached, §2). Skip rule: return code 77 only when no family's model is
  present; otherwise the present families are asserted and each absent one prints
  `SKIPPED: <stage>/<family>`. The pin-bump checklist in `native/README.md` gains
  "run `test_ops_coverage` with every family's model present at least once per bump".
- **Recorded dumps for asr/translate architectures without a cached model.** The same
  recording device, run through a `--dump-ops <stage> <family> <model-dir>` flag on
  the test binary, writes `native/src/ops/<stage>-<family>.ops` (one `OP[src0,src1]`
  per line, the engine pin on line 1, the GGUF's tensor-dtype set on line 2). A table
  is checked against its dump by a plain CTest; the checklist line covers
  regenerating dumps on a bump.
- **The tables are data, not code.** One `static const` array per family; a
  `static_assert` that every expanded table fits `SK_OP_COVERAGE_MAX`.

### 3.3 Sidecar: graph families, `DeviceProfile`, cache generations, the gate

**Graph family on every card.** `_ModelBase` gains `graph_family: str = ""`.
`_tc_row` gains a keyword `arch=` (the transcribe.cpp architecture string —
`sk_asr_caps.arch` reports it after a load, and a test asserts equality for every
cached test model); `_llm_translate_row` gains `arch=` (the llama.cpp
`general.architecture`); `_tts_gguf_row` sets `graph_family = family`.
`TranslateModel.prompt_family` is untouched — it is a prompt strategy, not a graph. A
catalog invariant test asserts `graph_family` is non-empty on every card, and that
every TTS card's `("tts", graph_family)` has a table.

**Profiles on `Machine`.**

```python
@dataclass(frozen=True)
class DeviceProfile:
    index: int
    kind: str                         # "cpu" | "vulkan" | "metal"
    name: str                         # sk_device.name ("Vulkan0", "CPU")
    description: str
    mem_total: int
    known: bool                       # False → every consumer passes through
    features: frozenset[str]          # the sk_feature names, lower-case without the SK_FEAT_ prefix
    driver_name: str
    driver_version: str
    device_uuid: str
    cpu_features: str

@dataclass(frozen=True)
class OpCoverage:
    all_supported: bool
    unsupported: tuple[str, ...]      # "OP[src0,src1]" spellings (§3.2)

@dataclass(frozen=True)
class Machine:
    ...                               # every existing field unchanged, gpus included
    devices: tuple[DeviceProfile, ...] = ()   # () when the wheel is absent or predates sk_device_profile_get
    generation: str = ""                      # "" only when the identity detector fails (wheel absent)
```

The defaults are load-bearing: `test_characterization.py`, `test_planner.py`,
`test_accel.py`, `test_catalog.py:483` and `test_platform_filter.py:11` all construct
`Machine(...)` directly and must stay valid unchanged. `gpus` stays the derived
`(kind, description, mem_total)` tuple.

Two new detectors, module-level like the existing four so tests can patch them, each
wrapped by `_safe` in `probe()`: `_native_profiles() -> tuple[DeviceProfile, ...]`
(one `sk_device_profile_get` per `sk_devices()` entry, through a new
`native.device_profiles()` wrapper; a raise yields `()`) and
`_native_identity() -> tuple[str, dict]` (`sk_version`, `engine_versions`; a raise
yields `None`). `probe()` then computes the generation itself from the two results
(below), so the detectors never call each other and a profiles-only failure still
yields a version-keyed generation. A sidecar running against a 1.0.x wheel therefore
**loads it and degrades**: `native.device_profiles()` fails on the missing symbol,
`_safe` returns `()`, the identity still resolves, and every resolve is unchanged
(premise 5).

**Generation.** Computed in `probe()`:

```python
generation = "" if identity is None else blake2s(
    f"{sk_version}|{sorted(engine_versions.items())}|"
    f"{[(d.kind, d.device_uuid, d.driver_name, d.driver_version) for d in sorted(devices, key=index)]}|"   # () hashes as []
    f"{sorted((k, v) for k, v in os.environ.items() if k.startswith('GGML_'))}"
).hexdigest()[:12]
```

`GGML_*` rather than `GGML_VK_*` because `GGML_METAL_BF16_DISABLE` and
`GGML_METAL_DEVICES` change Metal's paths the same way. One helper,
`planner._cache_key(machine, ns, model_id, backend, device, compute_type) ->
f"{machine.generation}|{ns}{_bench_key(...)}"`, is used by **both** sides —
`accel._measure` on write, `planner._resolve_model` and `resolve_translate._tps` on
read — so `_apply_bench` demotion and the E6 tps swap keep firing within a generation
and never across one.

**Cache file.** `bench_load()` returns `(entries, generations)`; `bench_save(entries,
*, generation)` writes `{"_generations": [...oldest→newest], **entries}` through a
temp file plus `os.replace`. On save it appends `generation` to the list if new,
keeps the last three, and prunes every key whose `|`-prefix is a *known* generation
not among them; keys with no generation prefix are dropped only when a
`_generations` list already exists (a legacy flat file — no list — is
generation-less: its keys can never match the prefixed reads, and it is dropped at
the first save). `_measure` and the planner read `entries` only.

**Op coverage.** Three named pieces:

- `accel.compute_op_coverage(machine, device_index, stage, family, compute_type)
  -> OpCoverage | None`: calls `native.device_supports_ops` and caches the result
  under `f"{machine.generation}|ops:{device_index}:{stage}:{family}:{compute_type}"`
  as `{"allSupported": bool, "unsupported": [...]}`. `SK_ERR_BACKEND` (the Vulkan
  first-init exception) and `SK_ERR_NOT_FOUND` (no table yet — the common case for
  asr/translate at first release) both return `None` and are **not cached**;
  `SK_ERR_INVALID_ARGUMENT` is a programming error: raise under `SOKUJI_WIRE_STRICT`,
  `None` plus one `logging.warning` otherwise.
- `accel.op_coverage_for(machine, override) -> Callable[[int, str, str, str],
  OpCoverage | None]`: what the `accel.resolve` / `resolve_translate` / `resolve_tts`
  wrappers build **before** calling the planner. It **precomputes** a dict, and the
  callable is `results.get` — the planner never triggers native or disk. It computes
  for: each GPU tier whose `_tier_available` passes, **the first device of that kind
  only** (the one `native.device_for` would load on — multi-GPU placement is
  unchanged, §5), the resolved card's `graph_family`, and each `compute_type` the
  card lists (≤5 checks; after the one-time device init each is cheap). It computes
  **nothing** when `override == "cpu"`, when `devices == ()`, or when no device of
  the tier is `known` — so an explicit CPU load never pays Vulkan's device init. A
  model whose budget will force the cpu row in `auto` mode still pays it once; that
  is the honest cost of asking before the planner decides, and it is paid in the
  process that would pay it at the next GPU load anyway (§6).
- `accel.cached_op_coverage(machine) -> same callable`: read-only, `entries.get` over
  the cache; what `_h_models_catalog` and `_h_list_variants` pass, so the catalog
  never computes coverage on the sidecar-ready path — a tier stays available until
  the first resolve of that family fills the cache (premise 5; §6).

The callable is threaded, keyword-only and defaulting to `lambda *a: None` so every
existing test stays valid, through the **six** planner functions that gate a
deployment: `resolve`, `resolve_translate`, `resolve_tts`, `select_variant`, and —
because `_h_models_catalog` calls them directly — `_llamacpp_variant_row` and
`_tc_pick_quant` (and the `accel._llamacpp_variant_row` wrapper).

**The gate.**

```python
_STAGE_OF_BACKEND = {"native_asr": "asr", "native_asr_stream": "asr",
                     "native_translate": "translate", "native_tts": "tts"}
_ABORTS_ON_UNSUPPORTED = {"tts"}     # audio.cpp runs single-backend (§2); llama.cpp and transcribe.cpp schedule onto CPU

def _device_for_tier(machine: Machine, tier: str) -> DeviceProfile | None:
    kind = TIER_DEVICE[tier]
    return next((d for d in machine.devices if d.kind == kind), None)   # first of the kind, as native.device_for

def _deployment_available(model, d: Deployment, machine: Machine, *, op_coverage) -> bool:
    if not _tier_available(d.tier, machine, d.backend):
        return False
    if d.tier == "cpu":
        return True
    dev = _device_for_tier(machine, d.tier)
    if dev is None or not dev.known:
        return True                                   # premise 5
    stage = _STAGE_OF_BACKEND.get(d.backend)
    if stage is None:
        return True                                   # fixture backends ("be", "ctranslate2"): pass-through
    cov = op_coverage(dev.index, stage, model.graph_family, d.compute_type)
    if cov is None:
        return True                                   # not computed, no table yet, or backend exception
    if stage in _ABORTS_ON_UNSUPPORTED:
        return cov.all_supported                      # the only stage where "unsupported" means "aborts"
    return True                                       # asr/translate: runs with CPU fallback; recorded for diagnostics
```

It replaces the direct `_tier_available` check at every deployment gate: the
`usable` comprehension in `resolve_deployments`, `_row()` and `gpu_possible` in
`_llamacpp_variant_row`, `select_variant.candidate()`, `gpu_possible` in
`_tc_pick_quant`, and `_h_models_catalog`. `_engine_identity` is not in the list — it
has no model or deployment in scope and is touched only by the `_tier_available`
change below; `_h_list_variants` is affected only through `select_variant`.

Consequences: a **pinned** TTS rung the device cannot execute, a **downloaded** one,
and one under `override="gpu"` **with that rung pinned** (or a single-rung card such
as supertonic-3; an unpinned `override="gpu"` leads with the other rung's GPU row,
which is today's ranking and stays spec B's business) all resolve to the rung's cpu
row instead of aborting the process. There is deliberately no feature-bit rule:
Vulkan accepts `MUL_MAT[bf16,f32]` unconditionally (the extension only selects a
faster kernel), so a bit-based bf16 gate would refuse rungs ggml runs — the table's
`MUL_MAT[WEIGHT,f32]` entry is the answer.

**On the wire (catalog).** `variants[].supported` keeps its meaning — "loadable on
some tier" — and stays `True` for every GGUF card (the cpu row always passes; the
renderer disables the option and drops the user's pin otherwise). The per-rung GPU
refusal rides a new optional field `variants[].unsupportedTiers: string[]` (the gpu
tiers `_deployment_available` refused for that rung), and `tiers[].available` is
defined as "true if any listed rung can execute on that tier". Both are computed with
`cached_op_coverage`, so a cache miss leaves the wire exactly as today.

**Paravirtual (R36).** `_tier_available`'s Metal branch becomes: if the Metal device's
profile is known, refuse when `mtl_simdgroup_reduction` is absent; otherwise keep the
description match. This is the single profile bit that gates (premise 6), tier-level
because `NORM` is in every family's graph. Both existing paravirtual tests stay green;
two new ones cover the structured signal (known profile without the bit → refused;
known profile with the bit and a description containing "paravirtual" → still refused,
because the string rule is kept until every shipped wheel carries profiles).

### 3.4 Wire and renderer

`hardware_info_result` gains two **optional** fields, and `models_catalog_result`'s
variants gain `unsupportedTiers`, all added to `wire_schema.json` in the same commit
as the handlers and the TS interfaces (the strict outbound validator and
`nativeProtocol.consistency.test.ts` both fail otherwise):

```ts
// hardware_info_result
generation?: string | null;
devices?: {
  index: number; kind: string; name: string; description: string; memTotalMb: number;
  known: boolean; features: string[]; driverName: string; driverVersion: string; deviceUuid: string;
  cpuFeatures: string;
  opCoverage: Record<string, { allSupported: boolean; unsupported: string[] }>;   // key "stage/family/compute_type", cached entries only
}[] | null;
// models_catalog_result.models[].variants[]
unsupportedTiers?: string[];
```

`_h_hardware_info` builds `devices[]` from `machine.devices` and the `"ops:"` entries
already in the cache (read-only). `LocalNativeClient` forwards `generation` and
`devices` in `local.native.hardware`; `nativeModelStore` stores them as two new
fields, `deviceProfiles` and `profileGeneration`, **beside** `engineInfo` (whose
`toEqual` test stays as is). The variant dropdown renders `unsupportedTiers` as a
muted note on an **enabled** option ("runs on CPU here"); pins stay allowed. When a
stored profile lists unsupported ops for a `"tts/…"` key not seen before this
session, the store reports once — `reportWarning('NativeModelStore', …,
{ dedupeKey: 'native.ops.unsupported' })` guarded by a
`reportedUnsupportedOps: Set<string>` on the store (`dedupeKey` alone only throttles
bursts) — so the op names reach LogsPanel. One new locale key for the muted note
(`models.variantRunsOnCpu`), in all 30 locales. No re-probe control: a profile is
recomputed on every sidecar start and keyed by (hardware, native version, driver).

### 3.5 Rollout

- Native: ABI **2**, version **1.1.0**. The exact sites: `sokuji_native.h`
  `#define SK_ABI_VERSION 2`; `_ffi.py` `SK_ABI_VERSION = 2`; `CMakeLists.txt`
  `set(SK_ABI_VERSION_NUM 2)` and `project(sokuji_native VERSION 1.1.0 …)`;
  `tests/test_common.cpp` `sk_version() == "1.1.0"`; the "current native version"
  lines in `native/README.md` and `CLAUDE.md`. A configure-time check in
  `CMakeLists.txt` reads `#define SK_ABI_VERSION` from the header and
  `message(FATAL_ERROR)`s on a mismatch with `SK_ABI_VERSION_NUM`, so the three ABI
  literals can no longer drift (today nothing checks the CMake one until a
  five-SKU build fails at `_load()`). Tag `native-v1.1.0` → five wheels (prerelease).
- Sidecar: `requirements.txt` and `test_runtime_gate.py` to 1.1.0, `sidecarVersion`
  **0.3.0**, tag `sidecar-v0.3.0` — the order `native/README.md` sets out.
- Compatibility: a sidecar against a 1.0.x wheel loads and degrades as described in
  §3.3 (`devices=()`, generation still computed, every resolve unchanged). A bundle
  pins its own wheel, so this only ever happens in development.

## 4. Testing

- **native (CTest).** `test_common.cpp`: `sk_device_profile_get` returns `SK_OK` on
  every device; the CPU profile has non-empty `cpu_features` that fit the buffer; on
  a Vulkan build with a device, `known == 1`, `device_uuid` is 32 hex chars,
  `driver_name` non-empty; on a Metal device whose description does **not** match
  `paravirtual`, `SK_FEAT_MTL_SIMDGROUP_REDUCTION | SK_FEAT_MTL_BFLOAT | SK_FEAT_UMA`
  are set, and on one that does (CI's only macOS runner) `known == 1` with
  `SK_FEAT_MTL_SIMDGROUP_REDUCTION` clear — the structured R36 signal, exercised
  where it exists; bad index or NULL → `SK_ERR_INVALID_ARGUMENT`; before `sk_init` →
  `SK_ERR_NOT_INITIALISED`. The Vulkan selection helper, fed two fake
  `(deviceUUID, driverID)` pairs for one card, keeps the one ggml's priority table
  keeps. `sk_device_supports_ops` for every `(stage, family)` in the tables and every
  rung returns `all_supported == 1` on the CPU device; `SK_ERR_NOT_FOUND` for an
  unknown pair; `SK_ERR_INVALID_ARGUMENT` for an unknown compute_type; every expanded
  table fits `SK_OP_COVERAGE_MAX` (`static_assert`). `test_ops_coverage` (both
  recording mechanisms, all nine TTS families live, the cached ASR/translate models,
  the GGUF dtype-set ⊆ rung-set assertion) and the dump checks as in §3.2. The
  configure-time ABI check fails a deliberately mismatched configure (a CMake script
  test). `check_linux_deps.py` fails a staged `libsokuji_native.so` with a
  `libvulkan.so.1` DT_NEEDED and still passes the ggml-vulkan module with one.
- **native (pytest).** Round-trips for `device_profiles()` and
  `device_supports_ops()`; `Device` unchanged; `contract.json` ABI 2; `sk_version()`
  `"1.1.0"`.
- **sidecar catalog.** Every card has a non-empty `graph_family`; `prompt_family`
  unchanged on every translate card; every TTS card's `("tts", graph_family)` has a
  table; for each cached test model, `sk_asr_caps.arch` equals the card's
  `graph_family`.
- **sidecar planner.** `_deployment_available`: unknown profile → identical to
  `_tier_available`; unknown backend → True; known profile, `tts`, an unsupported op
  → False on gpu tiers, True on cpu; known profile, `translate` or `asr`, an
  unsupported op → True; coverage `None` → True; the same TTS rung reaches the cpu
  row under `pin`, under `downloaded={that rung}`, and under `override="gpu"` with
  `pin=` (three tests, one per bypass path); a bf16 rung whose `MUL_MAT[bf16,f32]` is
  unsupported is refused while its `q8_0` sibling is kept; a `q4_k_m` rung is
  refused when only `MUL_MAT[q6_K,f32]` is unsupported (dtype sets). Structured
  paravirtual cases as in §3.3. Bench keys: an entry written under generation G is
  read back by `resolve` / `resolve_translate` under G and ignored under G′; the
  cache-building tests at `test_planner.py:395, 408, 512, 848` move to `_cache_key`.
  Existing `_tier_available` tests unchanged; the callable's default keeps every
  existing planner test valid.
- **sidecar accel.** `probe()` fills `devices` from a `_fake_native_module` that grows
  `device_profiles` / `device_supports_ops`; `_FakeDev` gains keyword-only profile
  fields with defaults so every positional call site stays valid; every existing
  `probe(force=True)` test patches `_native_profiles` and `_native_identity` too (a
  shared `_isolate_probe` fixture); `_native_profiles` raising → `devices=()` with a
  non-empty generation; `_native_identity` raising → `generation=""`; a fake module
  **without** the two new functions → `devices == ()`, `generation != ""`, and
  `resolve_tts` output identical to the no-profile machine; `generation` changes when
  `version`, an engine pin, a driver string or a `GGML_*` variable changes and not
  when only `mem_free` does; `_measure` misses on a generation change and hits within
  one (`test_accel.py:393-398, 407-410, 427` move to `_cache_key` / the new
  `bench_load` shape); `bench_save` is atomic and keeps exactly the last three
  generations (`_generations == [G2, G3, G4]` after saves under G1..G4); a legacy
  flat file is dropped on first save; `compute_op_coverage` calls
  `native.device_supports_ops` once per key across two resolves, caches neither
  `SK_ERR_BACKEND` nor `SK_ERR_NOT_FOUND`, and raises on `SK_ERR_INVALID_ARGUMENT`
  under strict; `op_coverage_for` never touches native when `override == "cpu"`,
  `devices == ()` or `known == False`, and queries only the first device of a kind on
  a two-GPU fixture; `_h_hardware_info` emits `devices[]` and never computes
  coverage; `_h_models_catalog` marks `gpu-vulkan` `available: False` and lists it in
  the rung's `unsupportedTiers` for a TTS card whose cached coverage is unsupported,
  keeps `supported: True`, and leaves everything untouched on a cache miss.
- **characterisation.** The `Machine` defaults keep every matrix row unchanged; an
  autouse fixture in that file monkeypatches `accel.compute_op_coverage` and
  `native.module` to `pytest.fail("native reached with devices=()")`, and one
  assertion checks `all(m.devices == () and m.generation == "" for m in _ALL_MACHINES)`.
- **renderer.** `nativeProtocol.consistency.test.ts` pins the three optional fields
  against `wire_schema.json`; `local.native.hardware` carries `devices` /
  `generation`; the store exposes `deviceProfiles` / `profileGeneration` and
  `engineInfo` is unchanged; a variant with `unsupportedTiers` renders enabled with
  the note and keeps its pin; the warning is reported once per `"tts/…"` key with the
  op names.

## 5. Out of scope

- Which rung is recommended, downloaded-wins, auto-pin on download, per-variant
  reason codes beyond `unsupportedTiers`, the "exactly one `recommended`" guarantee,
  the smallest-rung renderer fallback, the ranking of an unpinned `override="gpu"` —
  **spec B**.
- Measured speed: `resolve_tts` reading the bench cache, the one-time CPU-floor
  measurement, the card-level "will not keep up" state, `formatRtf`'s warning class,
  the unified definitions of the three stages' RTF — **spec C**.
- A user-triggered re-probe, and any use of the raw *Vulkan* feature bits beyond
  diagnostics.
- Multi-GPU placement (`native.device_for` returns the first device of a kind;
  `_quant_budget_bytes` uses the largest) — unchanged; the profile carries the index
  so a later spec can make them agree.
- Any timing in the native layer.

## 6. Known limitations and risks

- **The catalog lags the first resolve.** Coverage is computed by the resolve wrappers,
  so until a family has been resolved once on a machine the catalog advertises its GPU
  tier (premise 5). The first session on a fresh machine may therefore show a TTS card
  as GPU-available and then load it on the cpu row; the profile explains why.
- **Vulkan's first coverage query costs seconds** (device creation + pipeline
  compile), paid in the resolve wrapper of the first GPU-considered load of a
  process. A model that then lands on the cpu row in `auto` mode has paid it without
  a GPU load following; explicit CPU loads never pay it.
- **Dual-ICD and identical GPUs.** The selection helper replicates ggml's UUID /
  driverID rule; if a ggml bump changes that rule the helper's pinned table must move
  with it (the checklist covers it). Two physically distinct identical cards under one
  driver are indistinguishable and interchangeable by construction.
- **Op tables drift with pins.** Mitigated by `test_ops_coverage` (live for all nine
  TTS families and the cached ASR/translate models) and by the dump checks plus the
  pin-bump checklist for the rest; a stale table fails closed on a *new* op only if
  the test runs — the checklist is a procedural gate, not an automatic one.
- **Missing tables are silent.** Until an asr/translate architecture has a table,
  `SK_ERR_NOT_FOUND` → `None` → pass-through; only TTS tables are required before
  release (catalog test).
- **Raw Vulkan bits can over-promise.** A build whose `glslc` lacked an extension, or
  a `GGML_VK_DISABLE_*` variable, means ggml does not use a feature the profile
  reports; the bits are labelled raw for that reason and gate nothing.
- **`GGML_*` in the generation** means a developer toggling `GGML_VK_DISABLE_COOPMAT`
  invalidates their bench cache; intended — those variables change ggml's paths.

## 7. Decisions log

- 2026-09-03 — tiers describe what can run; planner/recommendation decide what should
  (jiangzhuo). Applied in `2f2b28bc`.
- 2026-09-03 — objective is sustained throughput (no accumulating lag), quality
  preferred among rungs that keep up; mechanism is measure-then-adapt, not
  predict-first; quant is a download-time decision (jiangzhuo).
- 2026-09-04 — probe capability, not throughput; probe everything once per device and
  compare with per-model requirements (jiangzhuo).
- 2026-09-04 — per-rung acceleration paths and kernel micro-benchmarks dropped after
  adversarial review; the manifest side becomes per-family op tables, the device side
  becomes structured features + `supports_op` (Claude, agreed by jiangzhuo).
- 2026-09-04 — no RTF prior table (jiangzhuo).
- 2026-09-04 — split into A (this), B, C; order A → B → C (jiangzhuo).
- 2026-09-04 — second draft after review: no feature-bit gate (Vulkan runs bf16
  without the extension); the gate is per rung and per stage (only audio.cpp aborts);
  Metal bits derived through `supports_op`; the Vulkan loader dlopen'd, never linked;
  coverage computed in the resolve wrappers, never on the ready path; `graph_family`
  on every card; the re-probe action dropped (Claude).
- 2026-09-04 — third draft after re-check: `variants[].supported` untouched and a
  new `unsupportedTiers` field instead; rungs expand to dtype sets (`*_M` mixes); two
  recording mechanisms (registered recording device for llama.cpp/transcribe.cpp, a
  `graph_compute` shim for audio.cpp); coverage precomputed by the wrappers and
  skipped for `override="cpu"` and non-first devices; Vulkan device matching
  replicates ggml's UUID/driverID selection; `_native_identity` detector and the
  generation computed in `probe()`; `bench_save` takes the generation; premise 6
  states which single bit gates (Claude).
