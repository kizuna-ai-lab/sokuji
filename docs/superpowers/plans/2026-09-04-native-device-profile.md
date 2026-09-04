# Native Device Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every machine gets a structured device profile (driver identity, raw Vulkan feature bits, Metal `supports_op` bits, CPU features), a per-family **op recording** the planner asks `ggml_backend_dev_supports_op` about, a bench cache whose keys carry a **generation** that invalidates on a native/driver change, and a planner gate that stops offering a TTS deployment the device cannot execute — with nothing else about recommendation or placement changing.

**Architecture:** Two new C ABI calls behind ABI 2 (`sk_device_profile_get`, `sk_device_supports_ops`) over ggml's public `supports_op` and a loader-dlopen'd Vulkan enumeration; a build-time-generated table of node descriptors recorded from real forward passes (`native/src/ops/*.ops`); the sidecar's `Machine` gains `devices`/`generation`, every bench key gains the generation prefix on both the write and read side, and `_deployment_available` replaces `_tier_available` at every deployment gate with an injected, precomputed op-coverage callable so the planner stays pure; `hardware_info_result` carries the profile to LogsPanel.

**Tech Stack:** C++17 (`native/`), CMake + FetchContent (Vulkan-Headers), ggml v0.22.0 public API, ctypes binding (`native/python/sokuji_native`), Python 3.12 sidecar with pytest, TypeScript/React renderer with vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-native-device-profile-design.md` (fourth draft, commit `97903372`). Review history: `docs/superpowers/notes/2026-09-04-device-profile-review-findings.md`. This plan was itself reviewed once (46 findings, applied — the sk_* signatures, the ggml interface member orders, the WEIGHT rule and the cache key below are the corrected ones).

## Global Constraints

- `SK_ABI_VERSION` **2** in all three places (`native/include/sokuji_native.h`, `native/python/sokuji_native/_ffi.py`, `native/CMakeLists.txt` `SK_ABI_VERSION_NUM`); native version **1.1.0**; sidecar **0.3.0**; tags `native-v1.1.0` then `sidecar-v0.3.0` in that order (spec §3.5).
- `libsokuji_native.so` must never gain a `libvulkan.so.1` DT_NEEDED or a `vulkan-1.dll` import — the loader is `dlopen`'d at profile time (spec §3.1); `native/ci/check_linux_deps.py` enforces it per file.
- Vulkan headers come from a `FetchContent` of `Vulkan-Headers` pinned at **v1.4.311** (spec §3.1); native compiles with `VK_NO_PROTOTYPES`.
- Feature structs are chained into `vkGetPhysicalDeviceFeatures2` **only** when the device lists the matching extension; all structs zero-initialised (spec §3.1).
- **`WEIGHT` marks only rung-bearing positions**: `src0` of `MUL_MAT`, `MUL_MAT_ID` and `GET_ROWS`. Every other model tensor (norm weights, biases, embeddings used elsewhere) is recorded with its literal dtype. Expanding a norm weight to q8_0 would make every GPU backend refuse it (Vulkan and Metal accept `ADD`/`MUL` only for F32/F16 sources).
- **Node identity excludes the sequence axes**: `(op, op_params, dst type, src types, contiguity, ne[0] of src0/src1/dst)`; `ne[1..3]` are recorded as maxima and `max_bytes` as the largest seen, so one forward pass (prefill + N decode steps) yields tens of nodes, not thousands.
- Premise 5: an absent or unknown profile changes nothing. `Machine` gains `devices: tuple[DeviceProfile, ...] = ()` and `generation: str = ""` with those defaults; `sidecar/tests/test_characterization.py` must not change a single matrix row (spec §1.1(5), §4).
- `bench_load() -> dict` keeps its signature and returns entries only; `bench_read()` is new for writers; `bench_save(entries, *, generation)` (spec §3.3).
- The op-coverage cache key carries the dtype set: `f"{generation}|ops:{index}:{stage}:{family}:{compute_type}:{'+'.join(sorted(dtypes))}"` (spec §3.3), so the pre-download answer over the wide fallback set is replaced once the file's real header set is known.
- `wire_schema.json` lists only **top-level** fields: `hardware_info_result` gains optional `generation` and `devices`; `variants[].unsupportedTiers` is a nested TS-level field only (spec §3.4).
- `variants[].supported` keeps its meaning ("loadable on some tier") and stays `True` for every GGUF card (spec §3.3).
- Only the `tts` stage is gated on op coverage (`_ABORTS_ON_UNSUPPORTED = {"tts"}`); `asr`/`translate` record but never withhold a tier (spec §3.3).
- The op-coverage callable is keyword-only with default `_NO_COVERAGE` (`lambda *a: None`) on every planner function it threads through, so every existing test stays valid (spec §3.3).
- Coverage is computed by the accel resolve wrappers **before** the planner runs, never inside the planner, never on the `_h_models_catalog` path, never when `override == "cpu"`, and only for the first device of a kind (spec §3.3).
- `sk_init` is first-call-wins: the recording device must be registered **before** the first `sk_init` of a recording process (Task 4/6).
- Every user-visible string goes through i18n; the one new key `models.variantRunsOnCpu` is added to all 30 locale files under `src/locales/*/translation.json`.
- English-only code, comments, commit messages. Conventional commits. Commit with explicit pathspecs. Never `git stash`. Run sidecar tests as `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests -q -p no:cacheprovider`; native tests through `native/ci/build.sh <none|vulkan|metal> <plat tag>` (CTest + the Python suite against the fresh stage); renderer tests with `npx vitest run <path>`. Built executables land in `native/build/<lane>/lib/` (`CMAKE_RUNTIME_OUTPUT_DIRECTORY`), beside the backend modules.
- The Bash tool in this repository refuses heredocs and commands whose argument positions begin with a shell variable: write scripts to files and invoke them by path; spell paths out literally.
- Outward acts (push, PR, tag, release) require jiangzhuo's explicit per-act confirmation naming the target (Task 14 says so at each step).

---

## File structure

**native/**
- Modify `include/sokuji_native.h` — ABI 2; `sk_feature` enum; `sk_device_profile`, `sk_op_check`, `sk_op_coverage`, `SK_OP_COVERAGE_MAX`; `sk_translate_options.flash_attn`; declarations of `sk_device_profile_get`, `sk_device_supports_ops`, and the recorder's C entry points (test build).
- Create `src/sk_profile.cpp` — `sk_device_profile_get`.
- Create `src/sk_vk_enum.h`, `src/sk_vk_enum.cpp` — loader `dlopen`, instance creation, physical-device records, the pure `sk_vk_select_like_ggml()`.
- Create `src/sk_ops.h`, `src/sk_ops_format.cpp` — the descriptor model and the `.ops` text format (pure; compiled into the library AND directly into the test binaries).
- Create `src/sk_ops.cpp` — `WEIGHT` expansion, node rebuild + `supports_op`, `sk_device_supports_ops`; `src/sk_ops_data.h` — the baked-blob table's declaration.
- Create `src/ops/<stage>-<family>.ops` — the recordings (data). Nine `tts-*.ops` before release; `asr-whisper.ops`, `asr-moonshine_streaming.ops`, `translate-qwen3.ops`.
- Create `cmake/gen_ops_data.py` — turns `src/ops/*.ops` into `${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp` (blobs + one `static_assert` per recording on the expanded count).
- Create `src/sk_ops_record.cpp` (test build only, `SK_RECORD_OPS`) — the recording device and `sk_recording_graph_compute`, with C entry points; `tests/record_common.h` (the per-stage load-and-run), `tests/record_ops.cpp` (the `--record-ops` driver), `tests/test_ops_coverage.cpp`, `tests/test_ops_format.cpp`, `tests/test_vk_select.cpp`.
- Modify `src/audiocpp_compat.h` — under `SK_RECORD_OPS`, include `ggml-backend.h` then `#define ggml_backend_graph_compute sk_recording_graph_compute`.
- Modify `src/sk_translate.cpp` — honour `sk_translate_options.flash_attn`.
- Modify `CMakeLists.txt` — `SK_ABI_VERSION_NUM 2`, `project(... VERSION 1.1.0)`, the configure-time ABI cross-check (right after `project()`), FetchContent `Vulkan-Headers`, the ops generator custom command, new sources, `src/` on the private include path, the `SOKUJI_RECORD_OPS` option.
- Modify `tests/test_common.cpp`, `tests/CMakeLists.txt`; `python/sokuji_native/_ffi.py`, `python/sokuji_native/__init__.py`, `python/tests/test_sokuji_native.py`; `ci/check_linux_deps.py`; `ci/build.sh` / `ci/build.ps1`; `README.md`.

**sidecar/**
- Modify `sokuji_sidecar/catalog.py` — `graph_family` on `_ModelBase`; `arch=` on `_tc_row` and `_llm_translate_row`; `_tts_gguf_row` sets it; `RUNG_FALLBACK_DTYPES`.
- Create `sokuji_sidecar/gguf_header.py` — minimal GGUF header reader.
- Modify `sokuji_sidecar/native.py`, `sokuji_sidecar/accel.py`, `sokuji_sidecar/planner.py`, `sokuji_sidecar/wire_schema.json`.
- Create `tests/_fixtures.py` (shared `_known_gpu_machine`), `tests/test_gguf_header.py`; modify `tests/test_catalog.py`, `tests/test_accel.py`, `tests/test_planner.py`, `tests/test_characterization.py` (fixture + one assertion only).

**src/ (renderer)**
- Modify `lib/local-inference/native/nativeProtocol.ts`, `services/clients/LocalNativeClient.ts`, `stores/nativeModelStore.ts`, `components/Settings/sections/NativeModelManagementSection.tsx`, `src/locales/*/translation.json` (30 files); tests `stores/nativeModelStore.test.ts`, `components/Settings/sections/NativeModelManagementSection.test.tsx` (`nativeProtocol.consistency.test.ts` must keep passing unchanged).

---

### Task 1: ABI 2 scaffolding, version 1.1.0, `flash_attn` in the translate options, and the configure-time ABI cross-check

**Files:**
- Modify: `native/include/sokuji_native.h:42` (`SK_ABI_VERSION`), `:173` (`sk_translate_options`), after `:95` (new types + declarations)
- Modify: `native/python/sokuji_native/_ffi.py:6`, the `sk_translate_options` Structure, after `:28`, `:66-72`
- Modify: `native/CMakeLists.txt` (`project(...)` version, `SK_ABI_VERSION_NUM`, the new check placed right after `project()`, `src/` on the private include path)
- Modify: `native/src/sk_translate.cpp` (read `opts->flash_attn`)
- Modify: `native/tests/test_common.cpp:24`
- Modify: `native/README.md`, `CLAUDE.md` (the "Current native version" sentences)
- Test: `native/tests/test_common.cpp`, `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Produces: the C types `sk_feature`, `sk_device_profile`, `sk_op_check`, `sk_op_coverage`, `SK_OP_COVERAGE_MAX` (= 512); declarations `sk_device_profile_get(int32_t, sk_device_profile *)` and `sk_device_supports_ops(int32_t, const char *, const char *, const char *const *, int32_t, sk_op_coverage *)`; `sk_translate_options { int32_t n_ctx; int32_t flash_attn; /* 0 engine default, 1 on, 2 off */ }`; ctypes mirrors and `bind()` entries. Tasks 2–5 implement the two functions; until then stubs return `SK_ERR_INTERNAL` so the library links.

- [ ] **Step 1: Configure and build the CPU lane once (one-time cost, ~30 min: four upstreams are fetched and built)**

Run: `cd native && cmake -S . -B build/cpu -DCMAKE_BUILD_TYPE=Release -DSOKUJI_GPU=none && cmake --build build/cpu -j8 2>&1 | tail -3`
Expected: `libsokuji_native.so` and the test binaries under `build/cpu/lib/`.

- [ ] **Step 2: Bump the version sites and write the failing CTest assertions**

In `native/tests/test_common.cpp` change line 24 to:

```cpp
    assert(std::string(sk_version()) == "1.1.0");
```

and after the `assert(saw_cpu);` block (line 75) add:

```cpp
    // ABI 2: the profile call exists and rejects a bad index / NULL out-pointer.
    sk_device_profile prof = {};
    assert(sk_device_profile_get(-1, &prof) == SK_ERR_INVALID_ARGUMENT);
    assert(sk_device_profile_get(0, nullptr) == SK_ERR_INVALID_ARGUMENT);
```

- [ ] **Step 3: Build to see it fail to compile**

Run: `cd native && cmake --build build/cpu --target test_common 2>&1 | grep -m2 "error"`
Expected: `'sk_device_profile' was not declared` (or the equivalent for `sk_device_profile_get`).

- [ ] **Step 4: Add the types and declarations to the header**

Change line 42 to `#define SK_ABI_VERSION 2`. Change the `sk_translate_options` typedef (line 173) to:

```c
typedef struct sk_translate_options {
    int32_t n_ctx;        /* 0 = 4096 */
    int32_t flash_attn;   /* ABI 2: 0 = llama.cpp's own default, 1 = force on, 2 = force off.
                           * The op recorder records both settings (spec A §3.2.2). */
} sk_translate_options;
```

Insert after the `sk_device` typedef (line 95):

```c
/* ---- device profile (ABI 2) -------------------------------------------------------- */
enum sk_feature {
    /* Vulkan: RAW feature bits from the physical device. ggml applies further gates
     * before using any of them (build-time GGML_VULKAN_*_GLSLC_SUPPORT, the
     * GGML_VK_DISABLE_* environment, per-driver deny-lists for coopmat), so a set bit
     * means "the device offers it", not "ggml uses it". Diagnostics only; never a gate. */
    SK_FEAT_VK_SHADER_FLOAT16       = 1u << 0,
    SK_FEAT_VK_SHADER_BFLOAT16      = 1u << 1,
    SK_FEAT_VK_INTEGER_DOT          = 1u << 2,
    SK_FEAT_VK_COOPMAT              = 1u << 3,
    SK_FEAT_VK_COOPMAT2             = 1u << 4,
    /* Metal: supports_op ANSWERS (they equal what ggml will do). SIMDGROUP_REDUCTION is
     * the one profile bit that gates — tier level, in the sidecar's _tier_available,
     * because NORM is in every family's graph (ruling R36). */
    SK_FEAT_MTL_SIMDGROUP_REDUCTION = 1u << 5,   /* supports_op(NORM, contiguous f32 src) */
    SK_FEAT_MTL_BFLOAT              = 1u << 6,   /* supports_op(CONCAT, bf16, bf16): has_bfloat alone */
    /* Both: */
    SK_FEAT_UMA                     = 1u << 7,   /* Vulkan: deviceType == INTEGRATED_GPU (ggml's rule); Metal: always */
};

typedef struct sk_device_profile {
    int32_t  index;               /* same flat index as sk_device.index */
    int32_t  known;               /* 0 = nothing below is meaningful; consumers pass through */
    uint32_t features;            /* sk_feature bits; only meaningful when known */
    char     driver_name[256];    /* Vulkan: VkPhysicalDeviceDriverProperties.driverName; Metal: "Metal"; CPU: "" */
    char     driver_version[256]; /* Vulkan: driverInfo; Metal: sysctl kern.osversion; CPU: "" */
    char     device_uuid[40];     /* Vulkan: deviceUUID as 32 hex chars; else "" */
    char     cpu_features[512];   /* CPU device only: "AVX2=1,FMA=1,..." from ggml_backend_get_features */
} sk_device_profile;

/* SK_ERR_INVALID_ARGUMENT for a bad index or NULL out; SK_ERR_NOT_INITIALISED before
 * sk_init; otherwise SK_OK, with known = 0 when the profile could not be read. Strings
 * longer than their buffer are truncated (the buffers are Vulkan's own maxima). */
SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out);

/* ---- op coverage (ABI 2) ------------------------------------------------------------ */
/* One recorded node, spelled "OP.param[src0,src1,src2,src3,src4]->dst" (ggml_op_name and
 * ggml_type_name, "-" for an absent source), and whether the device's supports_op
 * accepted it rebuilt with its recorded shapes. */
typedef struct sk_op_check { char name[64]; int32_t supported; } sk_op_check;
#define SK_OP_COVERAGE_MAX 512
typedef struct sk_op_coverage {
    int32_t n_ops;            /* entries written */
    int32_t all_supported;    /* 1 iff every entry is supported */
    sk_op_check ops[SK_OP_COVERAGE_MAX];
} sk_op_coverage;

/* stage: "asr" | "translate" | "tts". family: the catalog card's graph_family.
 * weight_dtypes: the ggml type names WEIGHT expands over ("q4_K", "q8_0", "bf16", "f16",
 * "f32", ...). Unknown (stage, family) → SK_ERR_NOT_FOUND; bad index, NULL out,
 * n_weight_dtypes <= 0 or an unknown dtype name → SK_ERR_INVALID_ARGUMENT; more than
 * SK_OP_COVERAGE_MAX expanded entries → SK_ERR_INTERNAL; a backend exception →
 * SK_ERR_BACKEND. Callers treat every error as "unknown", never as "unsupported". */
SK_API sk_status sk_device_supports_ops(int32_t index, const char *stage, const char *family,
                                        const char *const *weight_dtypes, int32_t n_weight_dtypes,
                                        sk_op_coverage *out);
```

- [ ] **Step 5: Stubs so the library links; honour `flash_attn` in the translate loader**

Create `native/src/sk_profile.cpp`:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include <cstring>
#include <mutex>

extern "C" {

SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out) {
    std::lock_guard<std::mutex> lock(sk::mutex());
    if (!out || index < 0) {
        sk::set_error("sk_device_profile_get: bad index or NULL out-pointer");
        return SK_ERR_INVALID_ARGUMENT;
    }
    if (!sk::require_init("sk_device_profile_get")) return SK_ERR_NOT_INITIALISED;
    if (static_cast<size_t>(index) >= sk::devices().size()) {
        sk::set_error("sk_device_profile_get: bad index");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::memset(out, 0, sizeof *out);
    out->index = index;
    sk::set_error("sk_device_profile_get: not implemented yet");   // Task 2 replaces this body
    return SK_ERR_INTERNAL;
}

SK_API sk_status sk_device_supports_ops(int32_t, const char *, const char *, const char *const *, int32_t,
                                        sk_op_coverage *) {
    sk::set_error("sk_device_supports_ops: not implemented yet");   // Task 5 replaces this body
    return SK_ERR_INTERNAL;
}

}  // extern "C"
```

In `native/src/sk_translate.cpp`, where `llama_context_params` is built from `opts` (the block that reads `opts->n_ctx`), add:

```cpp
    if (opts && opts->flash_attn == 1) cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
    if (opts && opts->flash_attn == 2) cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
```

(If the pinned llama.cpp 0.3.0 `llama_context_params` still has the boolean `flash_attn` instead of `flash_attn_type`, set `cparams.flash_attn = (opts->flash_attn == 1)` for 1 and `false` for 2 — check `build/cpu/_deps/llama-src/include/llama.h`.)

In `native/CMakeLists.txt`: `project(sokuji_native VERSION 1.1.0 …)`; add `src/sk_profile.cpp` to `target_sources(sokuji_native ...)`; add `${CMAKE_CURRENT_SOURCE_DIR}/src` to the `PRIVATE` include directories of `sokuji_native` (generated sources include `sk_ops_data.h` from there in Task 5); `set(SK_ABI_VERSION_NUM 2)`.

- [ ] **Step 6: The configure-time ABI cross-check, placed right after `project()`**

Directly after the `project(...)` line:

```cmake
# The ABI number lives in three places nothing used to cross-check: SK_ABI_VERSION_NUM (stamped
# into contract.json, set below), the header (what the library reports), and the binding's
# _ffi.py (what the binding demands). The binding refuses a mismatch at import — after a full
# five-SKU build. Catch the header/CMake drift here, before any upstream is fetched.
set(SK_ABI_VERSION_NUM 2)
file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/include/sokuji_native.h _sk_abi_line
     REGEX "^#define SK_ABI_VERSION [0-9]+")
string(REGEX REPLACE "^#define SK_ABI_VERSION ([0-9]+).*$" "\\1" _sk_abi_header "${_sk_abi_line}")
if(NOT _sk_abi_header STREQUAL "${SK_ABI_VERSION_NUM}")
    message(FATAL_ERROR "SK_ABI_VERSION_NUM (${SK_ABI_VERSION_NUM}) != include/sokuji_native.h SK_ABI_VERSION (${_sk_abi_header})")
endif()
```

and delete the old `set(SK_ABI_VERSION_NUM 1)` at line 120 (the comment above it stays, moved up with the block).

- [ ] **Step 7: Mirror the ABI and the structs in the binding**

`_ffi.py`: line 6 → `SK_ABI_VERSION = 2`; the `sk_translate_options` Structure gains `("flash_attn", c_int32)` after `n_ctx`; after the `sk_device` Structure add:

```python
SK_OP_COVERAGE_MAX = 512


class sk_device_profile(Structure):
    _fields_ = [("index", c_int32), ("known", c_int32), ("features", c_uint32),
                ("driver_name", c_char * 256), ("driver_version", c_char * 256),
                ("device_uuid", c_char * 40), ("cpu_features", c_char * 512)]


class sk_op_check(Structure):
    _fields_ = [("name", c_char * 64), ("supported", c_int32)]


class sk_op_coverage(Structure):
    _fields_ = [("n_ops", c_int32), ("all_supported", c_int32),
                ("ops", sk_op_check * SK_OP_COVERAGE_MAX)]


FEATURE_BITS = {  # sk_feature, lower-case without the SK_FEAT_ prefix (DeviceProfile.features names)
    1 << 0: "vk_shader_float16", 1 << 1: "vk_shader_bfloat16", 1 << 2: "vk_integer_dot",
    1 << 3: "vk_coopmat", 1 << 4: "vk_coopmat2",
    1 << 5: "mtl_simdgroup_reduction", 1 << 6: "mtl_bfloat", 1 << 7: "uma",
}
```

(add `c_uint32` to the ctypes import if absent). In `bind()` after the `sk_device_free_mem` lines:

```python
    lib.sk_device_profile_get.argtypes = [c_int32, POINTER(sk_device_profile)]
    lib.sk_device_profile_get.restype = c_int32
    lib.sk_device_supports_ops.argtypes = [c_int32, c_char_p, c_char_p, POINTER(c_char_p), c_int32,
                                           POINTER(sk_op_coverage)]
    lib.sk_device_supports_ops.restype = c_int32
```

In `__init__.py`, wherever `sk_translate_options` is filled (the `translate_load` wrapper), set `opts.flash_attn = 0` beside `opts.n_ctx`.

- [ ] **Step 8: Update the version sentences**

In `native/README.md` and `CLAUDE.md`, find the sentence that begins `Current native version is` (in the README it is wrapped across two lines) and rewrite the whole sentence as: `Current native version is 1.1.0 (ABI 2: device profile and op coverage — spec docs/superpowers/specs/2026-09-04-native-device-profile-design.md).` In `native/README.md`'s "Bumping a pin" step 4, change "the **two** places" to "the **two** places (plus `SK_ABI_VERSION_NUM` in `CMakeLists.txt` and `_ffi.py` when the ABI changes)".

- [ ] **Step 9: Build, run the CTest, prove the ABI check fires**

Run: `cd native && cmake -S . -B build/cpu && cmake --build build/cpu -j8 && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure 2>&1 | tail -3`
Expected: PASS (the two bad-argument calls return `SK_ERR_INVALID_ARGUMENT`).

Prove the check: edit the header to `#define SK_ABI_VERSION 3`, run `cmake -S native -B native/build/cpu 2>&1 | grep -m1 FATAL`, expect the FATAL_ERROR line, then restore the header (`git checkout -- native/include/sokuji_native.h` from the repo root).

Binding: `cd native/python && SOKUJI_NATIVE_DIR=../build/cpu/stage python -m pytest tests/test_sokuji_native.py -q -k "contract or version" 2>&1 | tail -2` — Expected: the ABI/contract tests pass at 2 (if `build/cpu/stage` does not exist yet, `ci/build.sh none <tag>` produces it).

- [ ] **Step 10: Commit**

```bash
git add native/include/sokuji_native.h native/src/sk_profile.cpp native/src/sk_translate.cpp native/CMakeLists.txt \
        native/tests/test_common.cpp native/python/sokuji_native/_ffi.py native/python/sokuji_native/__init__.py native/README.md CLAUDE.md
git commit -m "native: ABI 2 — device profile and op coverage types, flash_attn in translate options, version 1.1.0, configure-time ABI check"
```

---

### Task 2: `sk_device_profile_get` — CPU features, Metal bits, `known`, plus the binding wrapper

**Files:**
- Modify: `native/src/sk_profile.cpp` (replace the stub body from Task 1)
- Create: `native/src/sk_vk_enum.h`, `native/src/sk_vk_enum.cpp` (stub; Task 3 fills it)
- Modify: `native/tests/test_common.cpp`, `native/python/sokuji_native/__init__.py`, `native/python/tests/test_sokuji_native.py`, `native/CMakeLists.txt` (sources)

**Interfaces:**
- Consumes: Task 1's types; `sk::devices()`, `sk::kind_of()`, `sk::mutex()`, `sk::log_line()` from `sk_internal.h`.
- Produces: `sk_device_profile_get` for CPU and Metal devices (Vulkan devices report `known = 0` until Task 3); `bool sk_vk_fill_profile(ggml_backend_dev_t, const char *description, sk_device_profile *)`; Python `DeviceProfile(index, kind, name, description, mem_total, known, features: frozenset[str], driver_name, driver_version, device_uuid, cpu_features)` and `device_profiles() -> list[DeviceProfile]`.

- [ ] **Step 1: Write the failing CTest assertions**

In `test_common.cpp`, just after the pre-init `sk_device_free_mem` assertions (line 33) add `sk_device_profile pre = {}; assert(sk_device_profile_get(0, &pre) == SK_ERR_NOT_INITIALISED);`. After the device loop (after `assert(saw_cpu);`) add:

```cpp
    for (int i = 0; i < n; ++i) {
        sk_device_profile p = {};
        assert(sk_device_profile_get(i, &p) == SK_OK);
        assert(p.index == i);
        if (devs[i].kind == SK_DEVICE_CPU) {
            assert(p.known == 1);
            assert(p.cpu_features[0] != '\0');                                // ggml_backend_get_features reached
            assert(std::strlen(p.cpu_features) < sizeof p.cpu_features - 1);  // fits, not truncated
            assert(p.driver_name[0] == '\0');
        }
        if (devs[i].kind == SK_DEVICE_METAL) {
            assert(p.known == 1);
            assert(std::strcmp(p.driver_name, "Metal") == 0);
            assert(p.driver_version[0] != '\0');                              // kern.osversion
            assert(p.features & SK_FEAT_UMA);
            const bool paravirtual = std::strstr(devs[i].description, "aravirtual") != nullptr;
            if (paravirtual) {
                assert(!(p.features & SK_FEAT_MTL_SIMDGROUP_REDUCTION));       // the structured R36 signal
            } else {
                assert(p.features & SK_FEAT_MTL_SIMDGROUP_REDUCTION);
                assert(p.features & SK_FEAT_MTL_BFLOAT);
            }
        }
        if (devs[i].kind == SK_DEVICE_VULKAN && p.known) {                    // Task 3 makes known possible
            assert(std::strlen(p.device_uuid) == 32);
            assert(p.driver_name[0] != '\0');
        }
    }
    assert(sk_device_profile_get(n + 5, &prof) == SK_ERR_INVALID_ARGUMENT);
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd native && cmake --build build/cpu --target test_common && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure 2>&1 | tail -4`
Expected: FAIL at `sk_device_profile_get(i, &p) == SK_OK` (the stub returns `SK_ERR_INTERNAL`).

- [ ] **Step 3: Implement the CPU and Metal branches**

`native/src/sk_vk_enum.h` (declaration only for now):

```cpp
/* Vulkan device profile through the LOADER, never through ggml-vulkan's private structs
 * and never by linking libvulkan: sk_vk_enum.cpp dlopens the loader at call time. */
#pragma once
#include "sokuji_native.h"
#include "ggml-backend.h"

/* Fill driver/uuid/features/uma for the ggml Vulkan device `dev` (ggml description
 * `description`). false — out untouched — when the loader is absent, the enumeration
 * fails, or the selected device list does not match ggml's (spec §3.1). */
bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out);
```

`native/src/sk_vk_enum.cpp` stub: `#include "sk_vk_enum.h"` and `bool sk_vk_fill_profile(ggml_backend_dev_t, const char *, sk_device_profile *) { return false; }`. Add `src/sk_vk_enum.cpp` to `target_sources`.

Replace `native/src/sk_profile.cpp` with:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"
#include "sk_vk_enum.h"

#include "ggml-backend.h"
#include "ggml.h"

#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>

#if defined(__APPLE__)
#  include <sys/sysctl.h>
#endif

namespace {

/* "NAME=value,NAME=value" from the loaded CPU registration — the one capability hook the CPU
 * and Metal registrations expose through get_proc_address (ggml_get_type_traits_cpu is NOT
 * reachable: it lives in the dlopen'd module). Reports the variant ggml actually chose. */
std::string cpu_feature_string(ggml_backend_dev_t dev) {
    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
    if (!reg) return "";
    auto get = reinterpret_cast<ggml_backend_get_features_t>(
        ggml_backend_reg_get_proc_address(reg, "ggml_backend_get_features"));
    if (!get) return "";
    std::string out;
    for (const ggml_backend_feature *f = get(reg); f && f->name; ++f) {
        if (!out.empty()) out += ',';
        out += f->name; out += '='; out += f->value ? f->value : "";
    }
    return out;
}

/* One scratch node, asked of the device's own supports_op. no_alloc: nothing is allocated
 * on the device and nothing runs, so this cannot GGML_ABORT. */
bool ask_supports(ggml_backend_dev_t dev, enum ggml_op op, enum ggml_type t0, enum ggml_type t1) {
    ggml_init_params ip = { /*mem_size*/ 16 * 1024, /*mem_buffer*/ nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) return false;
    bool ok = false;
    ggml_tensor *a = ggml_new_tensor_2d(ctx, t0, 256, 4);
    ggml_tensor *node = nullptr;
    switch (op) {
        case GGML_OP_NORM:   node = ggml_norm(ctx, a, 1e-5f); break;
        case GGML_OP_CONCAT: node = ggml_concat(ctx, a, ggml_new_tensor_2d(ctx, t1, 256, 4), 1); break;
        default: break;
    }
    if (node) ok = ggml_backend_dev_supports_op(dev, node);
    ggml_free(ctx);
    return ok;
}

std::string mac_build() {
#if defined(__APPLE__)
    char buf[64] = {};
    size_t len = sizeof buf;
    if (sysctlbyname("kern.osversion", buf, &len, nullptr, 0) == 0) return buf;
#endif
    return "";
}

void copy_str(char *dst, size_t cap, const std::string &s) { std::snprintf(dst, cap, "%s", s.c_str()); }

}  // namespace

extern "C" {

SK_API sk_status sk_device_profile_get(int32_t index, sk_device_profile *out) {
    std::lock_guard<std::mutex> lock(sk::mutex());
    if (!out || index < 0) {
        sk::set_error("sk_device_profile_get: bad index or NULL out-pointer");
        return SK_ERR_INVALID_ARGUMENT;
    }
    if (!sk::require_init("sk_device_profile_get")) return SK_ERR_NOT_INITIALISED;
    const auto &devs = sk::devices();
    if (static_cast<size_t>(index) >= devs.size()) {
        sk::set_error("sk_device_profile_get: bad index");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::memset(out, 0, sizeof *out);
    out->index = index;
    ggml_backend_dev_t dev = devs[index];
    try {
        switch (sk::kind_of(dev)) {
            case SK_DEVICE_CPU:
                copy_str(out->cpu_features, sizeof out->cpu_features, cpu_feature_string(dev));
                out->known = 1;
                break;
            case SK_DEVICE_METAL:
                copy_str(out->driver_name, sizeof out->driver_name, "Metal");
                copy_str(out->driver_version, sizeof out->driver_version, mac_build());
                out->features |= SK_FEAT_UMA;
                if (ask_supports(dev, GGML_OP_NORM, GGML_TYPE_F32, GGML_TYPE_F32)) out->features |= SK_FEAT_MTL_SIMDGROUP_REDUCTION;
                if (ask_supports(dev, GGML_OP_CONCAT, GGML_TYPE_BF16, GGML_TYPE_BF16)) out->features |= SK_FEAT_MTL_BFLOAT;
                out->known = 1;
                break;
            case SK_DEVICE_VULKAN:
                out->known = sk_vk_fill_profile(dev, ggml_backend_dev_description(dev), out) ? 1 : 0;
                break;
            default:
                break;                                         // OTHER: known stays 0
        }
    } catch (...) {
        std::memset(out, 0, sizeof *out);                      // no C++ exception crosses the C ABI
        out->index = index;
        sk::log_line(2, "sk_device_profile_get: backend threw while profiling; reporting unknown");
    }
    return SK_OK;
}

}  // extern "C"
```

Delete the `sk_device_profile_get` stub from Task 1's file (this file replaces it; keep the `sk_device_supports_ops` stub in `sk_profile.cpp` until Task 5).

- [ ] **Step 4: Run the CTest to see it pass**

Run: `cd native && cmake --build build/cpu -j8 && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure 2>&1 | tail -3`
Expected: PASS on the CPU lane. On the M4 (`ci/build.sh metal macosx_11_0_arm64`) the Metal assertions pass; CI's paravirtual runner takes the inverse assertion.

- [ ] **Step 5: Write the failing binding test**

In `native/python/tests/test_sokuji_native.py`:

```python
@needs_tree
def test_device_profiles_one_per_device():
    sokuji_native.init()
    devs = sokuji_native.devices()
    profs = sokuji_native.device_profiles()
    assert [p.index for p in profs] == [d.index for d in devs]
    assert all(p.name == d.name and p.description == d.description for p, d in zip(profs, devs))
    cpu = next(p for p in profs if p.kind == "cpu")
    assert cpu.known and "=" in cpu.cpu_features and cpu.driver_name == ""
    assert isinstance(cpu.features, frozenset)
    for p in profs:
        assert p.features <= set(sokuji_native._ffi.FEATURE_BITS.values())
```

Run: `cd native/python && SOKUJI_NATIVE_DIR=../build/cpu/stage python -m pytest tests/test_sokuji_native.py -k device_profiles -q` — Expected: FAIL, `AttributeError: device_profiles`.

- [ ] **Step 6: Add the wrapper**

In `__init__.py`, after the `Device` dataclass:

```python
@dataclass(frozen=True)
class DeviceProfile:
    index: int
    kind: str
    name: str
    description: str
    mem_total: int
    known: bool
    features: frozenset[str]
    driver_name: str
    driver_version: str
    device_uuid: str
    cpu_features: str
```

and after `device_free_mem`:

```python
def device_profiles() -> list[DeviceProfile]:
    """One profile per devices() entry (same order, same index). A device whose profile could
    not be read comes back with known=False and every other field empty — never an error."""
    lib = _load()
    out = []
    for d in devices():
        raw = _ffi.sk_device_profile()
        status = lib.sk_device_profile_get(int(d.index), ctypes.byref(raw))
        if status != _ffi.SK_OK:
            _raise(lib, status, "sk_device_profile_get")
        bits = frozenset(name for bit, name in _ffi.FEATURE_BITS.items() if raw.features & bit)
        out.append(DeviceProfile(d.index, d.kind, d.name, d.description, d.mem_total, bool(raw.known),
                                 bits if raw.known else frozenset(),
                                 raw.driver_name.decode("utf-8", "replace"),
                                 raw.driver_version.decode("utf-8", "replace"),
                                 raw.device_uuid.decode("utf-8", "replace"),
                                 raw.cpu_features.decode("utf-8", "replace")))
    return out
```

Add `"DeviceProfile"` and `"device_profiles"` to `__all__`.

- [ ] **Step 7: Run the binding test to see it pass**

Run: `cd native && ci/build.sh none linux_aarch64 2>&1 | tail -5` (rebuilds the stage and runs both suites; use your lane's tag).
Expected: PASS including `test_device_profiles_one_per_device`.

- [ ] **Step 8: Commit**

```bash
git add native/src/sk_profile.cpp native/src/sk_vk_enum.h native/src/sk_vk_enum.cpp native/CMakeLists.txt \
        native/tests/test_common.cpp native/python/sokuji_native/__init__.py native/python/tests/test_sokuji_native.py
git commit -m "native: sk_device_profile_get — CPU features via get_proc_address, Metal bits via supports_op, binding wrapper"
```

---

### Task 3: Vulkan enumeration through the dlopen'd loader, and ggml-faithful device matching

**Files:**
- Modify: `native/src/sk_vk_enum.h`, `native/src/sk_vk_enum.cpp` (replace the stub)
- Modify: `native/CMakeLists.txt` (FetchContent `Vulkan-Headers`, link `Vulkan::Headers` on the vulkan lane)
- Modify: `native/ci/check_linux_deps.py` (`DENY_BY_FILE`)
- Create: `native/tests/test_vk_select.cpp`; Modify: `native/tests/CMakeLists.txt`
- Test: `native/tests/test_vk_select.cpp`, `native/tests/test_common.cpp` (the Vulkan assertions from Task 2 now fire on a Vulkan box)

**Interfaces:**
- Produces:
  ```cpp
  struct sk_vk_record { std::string name, uuid_hex, luid_hex; bool luid_valid; int32_t device_type, driver_id;
                        bool storage16; uint32_t features; std::string driver_name, driver_info; };
  std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env);
  ```
  (raw indices surviving ggml's selection, in ggml's order) and `sk_vk_fill_profile` over it.

- [ ] **Step 1: Write the failing selection-helper tests**

Create `native/tests/test_vk_select.cpp`:

```cpp
// Pure test of the ggml-faithful Vulkan device selection (spec §3.1): no loader, no GPU.
#undef NDEBUG
#include <cassert>
#include <string>
#include <vector>
#include "sk_vk_enum.h"

static sk_vk_record rec(const char *name, const char *uuid, int type, int driver, bool s16 = true) {
    sk_vk_record r; r.name = name; r.uuid_hex = uuid; r.luid_valid = false;
    r.device_type = type; r.driver_id = driver; r.storage16 = s16; r.features = 0; return r;
}
// VkPhysicalDeviceType: OTHER 0, INTEGRATED 1, DISCRETE 2, VIRTUAL 3, CPU 4.
// VkDriverId: AMD_PROPRIETARY 1, AMD_OPEN_SOURCE 2, MESA_RADV 3, NVIDIA_PROPRIETARY 4,
// INTEL_PROPRIETARY_WINDOWS 5, INTEL_OPEN_SOURCE_MESA 6, QUALCOMM_PROPRIETARY 12,
// MESA_LLVMPIPE 13, MOLTENVK 14, MESA_TURNIP 18, MESA_DOZEN 23, MESA_NVK 24.
int main() {
    {   // Dual ICD, one card: RADV (3) beats AMDVLK (2) beats proprietary (1).
        std::vector<sk_vk_record> raw = { rec("RX 7800", "aaaa", 2, 2), rec("RX 7800", "aaaa", 2, 3) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // llvmpipe (type CPU) ahead of a real GPU is dropped; virtual GPUs too.
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("Arc A770", "cccc", 2, 6), rec("virt", "dddd", 3, 6) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // No 16-bit storage → dropped.
        std::vector<sk_vk_record> raw = { rec("old", "eeee", 2, 4, false), rec("new", "ffff", 2, 4) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // GGML_VK_VISIBLE_DEVICES = raw indices, no filtering at all.
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("Arc", "cccc", 2, 6) };
        auto sel = sk_vk_select_like_ggml(raw, "0,1");
        assert(sel.size() == 2 && sel[0] == 0 && sel[1] == 1);
    }
    {   // Nothing survives → the first non-CPU device.
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("virt", "dddd", 3, 6) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // Two MoltenVK entries for one UUID are NOT collapsed.
        std::vector<sk_vk_record> raw = { rec("M4", "1111", 1, 14), rec("M4", "1111", 1, 14) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 2);
    }
    return 0;
}
```

In `native/tests/CMakeLists.txt`:

```cmake
# Spec A: the pure Vulkan-selection helper (no loader, no GPU) — runs on every lane.
add_executable(test_vk_select test_vk_select.cpp ../src/sk_vk_enum.cpp)
target_include_directories(test_vk_select PRIVATE ../src ../include)
target_link_libraries(test_vk_select PRIVATE ggml)
target_compile_definitions(test_vk_select PRIVATE SK_VK_ENUM_NO_LOADER=1)   # selection only; no dlopen path compiled
add_test(NAME test_vk_select COMMAND test_vk_select)
```

- [ ] **Step 2: Build it to see it fail**

Run: `cd native && cmake -S . -B build/cpu && cmake --build build/cpu --target test_vk_select 2>&1 | grep -m1 error`
Expected: `sk_vk_record` not declared.

- [ ] **Step 3: Declare the record and implement the selection**

`native/src/sk_vk_enum.h`:

```cpp
/* Vulkan device profile through the LOADER, never through ggml-vulkan's private structs
 * and never by linking libvulkan: sk_vk_enum.cpp dlopens the loader at call time. */
#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "ggml-backend.h"

struct sk_vk_record {
    std::string name;            // VkPhysicalDeviceProperties.deviceName
    std::string uuid_hex;        // VkPhysicalDeviceIDProperties.deviceUUID, 32 hex chars
    std::string luid_hex;        // deviceLUID, 16 hex chars; meaningful iff luid_valid
    bool        luid_valid = false;
    int32_t     device_type = 0; // VkPhysicalDeviceType
    int32_t     driver_id = 0;   // VkDriverId
    bool        storage16 = false;   // VkPhysicalDeviceVulkan11Features.storageBuffer16BitAccess
    uint32_t    features = 0;    // sk_feature bits (raw)
    std::string driver_name, driver_info;
};

/* ggml_vk_instance_init's device list, replicated (ggml-vulkan.cpp:7441-7581 at v0.22.0):
 *  - GGML_VK_VISIBLE_DEVICES set → those raw indices, no filtering;
 *  - else keep DISCRETE/INTEGRATED devices with 16-bit storage, collapse duplicates by UUID
 *    (or LUID when valid; never when both drivers are MoltenVK) keeping the driver ggml's
 *    priority table prefers; if nothing survives, the first non-CPU device.
 * Returns raw indices in ggml's order. Pure: unit-tested with fake records. */
std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env);

/* Fill driver/uuid/features/uma for ggml Vulkan device `dev`. false (out untouched) when the
 * loader is absent, the enumeration fails, or the selected list does not match ggml's Vulkan
 * device count (a mismatch is logged with both lists). */
bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out);
```

`native/src/sk_vk_enum.cpp` — the selection (the loader part is Step 5):

```cpp
#include "sk_vk_enum.h"
#include "sk_internal.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sstream>

namespace {

// VkPhysicalDeviceType / VkDriverId numeric values (vulkan_core.h); literals so the pure
// selection compiles without the headers on every lane.
constexpr int32_t kTypeIntegrated = 1, kTypeDiscrete = 2, kTypeCpu = 4;
constexpr int32_t kAmdProprietary = 1, kAmdOpenSource = 2, kMesaRadv = 3, kNvidiaProprietary = 4,
                  kIntelProprietaryWindows = 5, kIntelOpenSourceMesa = 6, kQualcommProprietary = 12,
                  kMoltenVk = 14, kMesaTurnip = 18, kMesaDozen = 23, kMesaNvk = 24;

/* PINNED to ggml v0.22.0 ggml-vulkan.cpp ggml_vk_instance_init's driver priorities (~7515-7545):
 * lower is better. Re-check on every ggml pin bump (native/README.md). */
int priority(int32_t driver_id) {
    switch (driver_id) {
        case kMesaRadv:                return 1;
        case kAmdOpenSource:           return 2;
        case kAmdProprietary:          return 3;
        case kIntelOpenSourceMesa:     return 1;
        case kIntelProprietaryWindows: return 2;
        case kNvidiaProprietary:       return 1;
        case kMesaNvk:                 return 2;
        case kQualcommProprietary:     return 1;
        case kMesaTurnip:              return 2;
        case kMesaDozen:               return 100;
        default:                       return 50;
    }
}

}  // namespace

std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env) {
    std::vector<size_t> out;
    if (visible_env && *visible_env) {
        std::stringstream ss(visible_env);
        std::string tok;
        while (std::getline(ss, tok, ',')) {
            char *end = nullptr;
            long v = std::strtol(tok.c_str(), &end, 10);
            if (end != tok.c_str() && v >= 0 && static_cast<size_t>(v) < raw.size()) out.push_back(static_cast<size_t>(v));
        }
        return out;
    }
    std::vector<size_t> eligible;
    for (size_t i = 0; i < raw.size(); ++i) {
        const auto &r = raw[i];
        if ((r.device_type == kTypeDiscrete || r.device_type == kTypeIntegrated) && r.storage16) eligible.push_back(i);
    }
    std::vector<size_t> kept;
    for (size_t i : eligible) {
        bool merged = false;
        for (size_t &k : kept) {
            const auto &a = raw[k], &b = raw[i];
            const bool same = (!a.uuid_hex.empty() && a.uuid_hex == b.uuid_hex) ||
                              (a.luid_valid && b.luid_valid && a.luid_hex == b.luid_hex);
            const bool both_moltenvk = a.driver_id == kMoltenVk && b.driver_id == kMoltenVk;
            if (same && !both_moltenvk) {
                if (priority(b.driver_id) < priority(a.driver_id)) k = i;
                merged = true;
                break;
            }
        }
        if (!merged) kept.push_back(i);
    }
    if (!kept.empty()) return kept;
    for (size_t i = 0; i < raw.size(); ++i) if (raw[i].device_type != kTypeCpu) return {i};
    return {};
}

#if !defined(SK_VK_ENUM_NO_LOADER)
// Step 5 adds the loader path here; until then the stub keeps every lane linking.
bool sk_vk_fill_profile(ggml_backend_dev_t, const char *, sk_device_profile *) { return false; }
#endif
```

- [ ] **Step 4: Run the selection test to see it pass**

Run: `cd native && cmake --build build/cpu --target test_vk_select && ctest --test-dir build/cpu -R test_vk_select --output-on-failure | tail -3`
Expected: PASS.

- [ ] **Step 5: Add the Vulkan headers and the loader-driven enumeration**

In `native/CMakeLists.txt`, after the `sokuji_native` target is defined:

```cmake
# Spec A §3.1: the device profile enumerates Vulkan devices through the LOADER, never by
# linking it, and needs headers new enough for the bfloat16 / NV coopmat2 feature structs
# (Ubuntu 22.04's distro headers are 1.3.204). Headers only; VK_NO_PROTOTYPES.
if(SOKUJI_GPU_RESOLVED STREQUAL "vulkan")
    include(FetchContent)
    FetchContent_Declare(vulkan_headers
        GIT_REPOSITORY https://github.com/KhronosGroup/Vulkan-Headers.git
        GIT_TAG        v1.4.311)
    FetchContent_MakeAvailable(vulkan_headers)
    target_link_libraries(sokuji_native PRIVATE Vulkan::Headers)
    target_compile_definitions(sokuji_native PRIVATE SK_HAVE_VULKAN_HEADERS=1 VK_NO_PROTOTYPES=1)
endif()
```

Replace the `#if !defined(SK_VK_ENUM_NO_LOADER)` block in `sk_vk_enum.cpp` with:

```cpp
#if !defined(SK_VK_ENUM_NO_LOADER) && defined(SK_HAVE_VULKAN_HEADERS)
#include <vulkan/vulkan.h>
#if defined(_WIN32)
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace {

struct Loader {
    void *handle = nullptr;
    PFN_vkGetInstanceProcAddr gipa = nullptr;
    bool open() {
#if defined(_WIN32)
        HMODULE h = LoadLibraryW(L"vulkan-1.dll");
        if (!h) return false;
        handle = h;
        gipa = reinterpret_cast<PFN_vkGetInstanceProcAddr>(GetProcAddress(h, "vkGetInstanceProcAddr"));
#else
        handle = dlopen("libvulkan.so.1", RTLD_NOW | RTLD_LOCAL);
        if (!handle) return false;
        gipa = reinterpret_cast<PFN_vkGetInstanceProcAddr>(dlsym(handle, "vkGetInstanceProcAddr"));
#endif
        return gipa != nullptr;
    }
    template <class F> F get(VkInstance inst, const char *name) { return reinterpret_cast<F>(gipa(inst, name)); }
    ~Loader() {
#if defined(_WIN32)
        if (handle) FreeLibrary(static_cast<HMODULE>(handle));
#else
        if (handle) dlclose(handle);
#endif
    }
};

std::string hex(const uint8_t *p, size_t n) {
    static const char *d = "0123456789abcdef";
    std::string s; s.reserve(n * 2);
    for (size_t i = 0; i < n; ++i) { s += d[p[i] >> 4]; s += d[p[i] & 15]; }
    return s;
}

bool has_ext(const std::vector<VkExtensionProperties> &exts, const char *name) {
    for (const auto &e : exts) if (std::strcmp(e.extensionName, name) == 0) return true;
    return false;
}

/* Enumerate through the loader. Empty vector = loader absent or enumeration failed. */
std::vector<sk_vk_record> enumerate_raw() {
    std::vector<sk_vk_record> out;
    Loader ld;
    if (!ld.open()) return out;
    auto vkCreateInstance = ld.get<PFN_vkCreateInstance>(VK_NULL_HANDLE, "vkCreateInstance");
    if (!vkCreateInstance) return out;
    VkApplicationInfo app = { VK_STRUCTURE_TYPE_APPLICATION_INFO, nullptr, "sokuji_native", 1, nullptr, 0, VK_API_VERSION_1_1 };
    VkInstanceCreateInfo ci = { VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, nullptr, 0, &app, 0, nullptr, 0, nullptr };
    VkInstance inst = VK_NULL_HANDLE;
    if (vkCreateInstance(&ci, nullptr, &inst) != VK_SUCCESS) return out;
    auto vkDestroyInstance = ld.get<PFN_vkDestroyInstance>(inst, "vkDestroyInstance");
    auto vkEnumeratePhysicalDevices = ld.get<PFN_vkEnumeratePhysicalDevices>(inst, "vkEnumeratePhysicalDevices");
    auto vkGetPhysicalDeviceProperties2 = ld.get<PFN_vkGetPhysicalDeviceProperties2>(inst, "vkGetPhysicalDeviceProperties2");
    auto vkGetPhysicalDeviceFeatures2 = ld.get<PFN_vkGetPhysicalDeviceFeatures2>(inst, "vkGetPhysicalDeviceFeatures2");
    auto vkEnumerateDeviceExtensionProperties = ld.get<PFN_vkEnumerateDeviceExtensionProperties>(inst, "vkEnumerateDeviceExtensionProperties");
    if (vkEnumeratePhysicalDevices && vkGetPhysicalDeviceProperties2 && vkGetPhysicalDeviceFeatures2 && vkEnumerateDeviceExtensionProperties) {
        uint32_t n = 0;
        vkEnumeratePhysicalDevices(inst, &n, nullptr);
        std::vector<VkPhysicalDevice> pds(n);
        vkEnumeratePhysicalDevices(inst, &n, pds.data());
        for (VkPhysicalDevice pd : pds) {
            sk_vk_record r;
            uint32_t ne = 0;
            vkEnumerateDeviceExtensionProperties(pd, nullptr, &ne, nullptr);
            std::vector<VkExtensionProperties> exts(ne);
            vkEnumerateDeviceExtensionProperties(pd, nullptr, &ne, exts.data());

            VkPhysicalDeviceDriverProperties drv = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DRIVER_PROPERTIES };
            VkPhysicalDeviceIDProperties idp = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES, &drv };
            VkPhysicalDeviceProperties2 props = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2, &idp };
            vkGetPhysicalDeviceProperties2(pd, &props);
            r.name = props.properties.deviceName;
            r.device_type = static_cast<int32_t>(props.properties.deviceType);
            r.driver_id = static_cast<int32_t>(drv.driverID);
            r.driver_name = drv.driverName;
            r.driver_info = drv.driverInfo;
            r.uuid_hex = hex(idp.deviceUUID, VK_UUID_SIZE);
            r.luid_valid = idp.deviceLUIDValid == VK_TRUE;
            r.luid_hex = hex(idp.deviceLUID, VK_LUID_SIZE);

            // Feature structs: zero-initialised, chained ONLY when the extension is listed.
            VkPhysicalDeviceVulkan11Features v11 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES };
            VkPhysicalDeviceShaderFloat16Int8Features f16i8 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES };
            VkPhysicalDeviceShaderIntegerDotProductFeatures idot = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_INTEGER_DOT_PRODUCT_FEATURES };
            VkPhysicalDeviceCooperativeMatrixFeaturesKHR cm = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_COOPERATIVE_MATRIX_FEATURES_KHR };
            VkPhysicalDeviceShaderBfloat16FeaturesKHR bf16 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_BFLOAT16_FEATURES_KHR };
            VkPhysicalDeviceCooperativeMatrix2FeaturesNV cm2 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_COOPERATIVE_MATRIX_2_FEATURES_NV };
            VkPhysicalDeviceFeatures2 feats = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2, &v11 };
            void **tail = &v11.pNext;
            auto chain = [&](void *s, void **next) { *tail = s; tail = next; };
            if (has_ext(exts, "VK_KHR_shader_float16_int8"))        chain(&f16i8, &f16i8.pNext);
            if (has_ext(exts, "VK_KHR_shader_integer_dot_product")) chain(&idot, &idot.pNext);
            if (has_ext(exts, "VK_KHR_cooperative_matrix"))         chain(&cm, &cm.pNext);
            if (has_ext(exts, "VK_KHR_shader_bfloat16"))            chain(&bf16, &bf16.pNext);
            if (has_ext(exts, "VK_NV_cooperative_matrix2"))         chain(&cm2, &cm2.pNext);
            vkGetPhysicalDeviceFeatures2(pd, &feats);
            r.storage16 = v11.storageBuffer16BitAccess == VK_TRUE;
            if (f16i8.shaderFloat16) r.features |= SK_FEAT_VK_SHADER_FLOAT16;
            if (bf16.shaderBFloat16Type) r.features |= SK_FEAT_VK_SHADER_BFLOAT16;
            if (idot.shaderIntegerDotProduct) r.features |= SK_FEAT_VK_INTEGER_DOT;
            if (cm.cooperativeMatrix) r.features |= SK_FEAT_VK_COOPMAT;
            if (cm2.cooperativeMatrixWorkgroupScope) r.features |= SK_FEAT_VK_COOPMAT2;
            if (props.properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU) r.features |= SK_FEAT_UMA;
            out.push_back(std::move(r));
        }
    }
    if (vkDestroyInstance) vkDestroyInstance(inst, nullptr);
    return out;
}

size_t ggml_vulkan_count() {
    size_t n = 0;
    for (ggml_backend_dev_t d : sk::devices()) if (sk::kind_of(d) == SK_DEVICE_VULKAN) ++n;
    return n;
}
size_t ggml_vulkan_ordinal(ggml_backend_dev_t dev) {   // position of `dev` among ggml's Vulkan devices
    size_t k = 0;
    for (ggml_backend_dev_t d : sk::devices()) { if (d == dev) return k; if (sk::kind_of(d) == SK_DEVICE_VULKAN) ++k; }
    return k;
}

}  // namespace

bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out) {
    static std::vector<sk_vk_record> raw;            // enumerate once per process
    static std::vector<size_t> selected;
    static bool done = false;
    if (!done) {
        raw = enumerate_raw();
        selected = sk_vk_select_like_ggml(raw, std::getenv("GGML_VK_VISIBLE_DEVICES"));
        done = true;
    }
    if (raw.empty()) return false;                   // loader absent / enumeration failed
    if (selected.size() != ggml_vulkan_count()) {
        std::string msg = "sk_device_profile_get: Vulkan device list mismatch — loader selection [";
        for (size_t i : selected) msg += raw[i].name + ";";
        msg += "] vs ggml count " + std::to_string(ggml_vulkan_count()) + "; profiles unknown";
        sk::log_line(2, msg.c_str());
        return false;
    }
    const sk_vk_record &r = raw[selected[ggml_vulkan_ordinal(dev)]];
    if (r.name != description) {                     // positional match must agree by name
        sk::log_line(2, ("sk_device_profile_get: positional match disagrees with ggml description (" + r.name + " vs " + description + ")").c_str());
        return false;
    }
    std::snprintf(out->driver_name, sizeof out->driver_name, "%s", r.driver_name.c_str());
    std::snprintf(out->driver_version, sizeof out->driver_version, "%s", r.driver_info.c_str());
    std::snprintf(out->device_uuid, sizeof out->device_uuid, "%s", r.uuid_hex.c_str());
    out->features = r.features;
    return true;
}
#elif !defined(SK_VK_ENUM_NO_LOADER)
bool sk_vk_fill_profile(ggml_backend_dev_t, const char *, sk_device_profile *) { return false; }
#endif
```

- [ ] **Step 6: The per-file dependency rule**

In `native/ci/check_linux_deps.py`, after `ALLOWED_PREFIXES`:

```python
# Spec A §3.1: the profile enumerates Vulkan through the dlopen'd loader; the host library
# itself must never need it, or a machine without the loader loses the whole wheel instead
# of just its Vulkan devices. The dlopen'd ggml-vulkan module may (it always has).
DENY_BY_FILE = {"libsokuji_native.so": {"libvulkan.so.1"}}
```

and inside `for lib in needed:` before the `if lib in ALLOWED ...` line:

```python
            if lib in DENY_BY_FILE.get(path.name, set()):
                problems.append(f"{path.name}: must not need {lib} (spec A: the loader is dlopen'd at profile time)")
                continue
```

- [ ] **Step 7: Build the Vulkan lane on a Vulkan box and run everything**

On GB10, the Vulkan lane needs the extracted glslc (fleet memory / `native/README.md`): `cd native && env LD_LIBRARY_PATH=/home/jiangzhuo/.claude/jobs/387091ff/tmp/vulkan-tools/lib PATH=/home/jiangzhuo/.claude/jobs/387091ff/tmp/vulkan-tools/bin:/usr/bin:/bin ci/build.sh vulkan manylinux_2_35_aarch64 2>&1 | tail -20`
Expected: `test_common`, `test_vk_select` pass; `check_linux_deps.py` passes; the Python `device_profiles` test reports the GB10 profile `known=True` with a 32-char uuid and `driver_name` "NVIDIA".
Then: `readelf -d native/build/vulkan/stage/libsokuji_native.so | grep -c libvulkan` — Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add native/src/sk_vk_enum.h native/src/sk_vk_enum.cpp native/CMakeLists.txt native/tests/test_vk_select.cpp \
        native/tests/CMakeLists.txt native/ci/check_linux_deps.py
git commit -m "native: Vulkan profile through the dlopen'd loader; device matching replicates ggml's selection"
```

---

### Task 4: The op recorder — node descriptors, the `.ops` format, the recording device and the audio.cpp shim

**Files:**
- Create: `native/src/sk_ops.h` (descriptor model + text format API), `native/src/sk_ops_format.cpp` (pure; compiled into the library AND directly into the test binaries)
- Create: `native/src/sk_ops_record.cpp` (recording device + `sk_recording_graph_compute`; compiled only with `SK_RECORD_OPS`)
- Create: `native/tests/record_common.h` (per-stage load-and-run), `native/tests/record_ops.cpp` (the driver), `native/tests/test_ops_format.cpp`
- Modify: `native/include/sokuji_native.h` (recorder C entry points, declared under `SK_RECORD_OPS`), `native/src/audiocpp_compat.h`, `native/CMakeLists.txt`, `native/tests/CMakeLists.txt`
- Create: `native/src/ops/tts-<family>.ops` ×9, `native/src/ops/asr-whisper.ops`, `native/src/ops/asr-moonshine_streaming.ops`, `native/src/ops/translate-qwen3.ops`

**Interfaces:**
- Produces (pure, `sk_ops.h`):
  ```cpp
  constexpr int32_t SK_SRC_ABSENT = -1, SK_SRC_WEIGHT = -2;
  struct sk_op_desc { int32_t op; std::array<int32_t,16> op_params; int32_t dst_type; std::array<int32_t,5> src_type;
                      int64_t ne0_src0, ne0_src1, ne0_dst;                      // identity
                      std::array<int64_t,4> max_ne_src0, max_ne_src1, max_ne_dst; // maxima, for the rebuild
                      bool contig_src0, contig_src1; uint64_t max_bytes; };
  struct sk_op_recording { std::string stage, family, engine, source_file; std::vector<std::string> dtypes_in_file; std::vector<sk_op_desc> nodes; };
  std::string sk_ops_format(const sk_op_recording &);
  bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error);
  std::string sk_op_spelling(const sk_op_desc &, const char *weight_type_name);   // nullptr → "WEIGHT"
  void sk_ops_add(std::vector<sk_op_desc> &, const sk_op_desc &);                 // dedup on identity; merge maxima
  ```
- Produces (C ABI, `SK_RECORD_OPS` builds only, declared in `sokuji_native.h` under `#if defined(SK_RECORD_OPS)`):
  ```c
  SK_API int32_t   sk_record_register_device(void);               /* MUST precede the first sk_init; 1 = registered */
  SK_API void      sk_record_begin(const char *const *weight_names, int32_t n, const char *const *weight_positions_op_names, int32_t n_ops);
  SK_API sk_status sk_record_end_to_file(const char *path, const char *stage, const char *family, const char *source_file, const char *const *dtypes, int32_t n_dtypes);
  SK_API int32_t   sk_record_node_count(void);
  ```
  (`weight_positions_op_names` is the rung-bearing op list `{"MUL_MAT","MUL_MAT_ID","GET_ROWS"}` — passed in so the rule lives in one place, the driver.)

- [ ] **Step 1: Write the failing format round-trip test**

Create `native/tests/test_ops_format.cpp`:

```cpp
#undef NDEBUG
#include <cassert>
#include <string>
#include "sk_ops.h"
#include "ggml.h"

int main() {
    sk_op_recording r;
    r.stage = "tts"; r.family = "supertonic"; r.engine = "audio.cpp 0.7.1 ; ggml 0.22.0";
    r.source_file = "supertonic-3-f16.gguf"; r.dtypes_in_file = {"f16", "f32"};
    sk_op_desc d{};
    d.op = GGML_OP_MUL_MAT; d.dst_type = GGML_TYPE_F32;
    d.src_type = {SK_SRC_WEIGHT, GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    d.ne0_src0 = 1024; d.ne0_src1 = 1024; d.ne0_dst = 1024;
    d.max_ne_src0 = {1024, 1024, 1, 1}; d.max_ne_src1 = {1024, 7, 1, 1}; d.max_ne_dst = {1024, 7, 1, 1};
    d.contig_src0 = d.contig_src1 = true; d.max_bytes = 4194304;
    r.nodes.push_back(d);
    sk_op_desc u{};
    u.op = GGML_OP_UNARY; u.op_params[0] = GGML_UNARY_OP_GELU; u.dst_type = GGML_TYPE_F32;
    u.src_type = {GGML_TYPE_F32, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    u.ne0_src0 = 4096; u.ne0_dst = 4096; u.max_ne_src0 = {4096, 7, 1, 1}; u.max_ne_dst = {4096, 7, 1, 1};
    u.contig_src0 = true; u.max_bytes = 114688;
    r.nodes.push_back(u);

    std::string text = sk_ops_format(r);
    assert(text.find("# stage: tts ; family: supertonic") != std::string::npos);
    assert(text.find("# dtypes-in-file: f16 f32") != std::string::npos);
    sk_op_recording back; std::string err;
    assert(sk_ops_parse(text, back, err));
    assert(back.nodes.size() == 2 && back.family == "supertonic" && back.dtypes_in_file.size() == 2);
    assert(back.nodes[0].src_type[0] == SK_SRC_WEIGHT && back.nodes[0].max_bytes == 4194304 && back.nodes[0].max_ne_src1[1] == 7);
    assert(back.nodes[1].op_params[0] == GGML_UNARY_OP_GELU);
    assert(sk_op_spelling(back.nodes[0], "q8_0") == "MUL_MAT[q8_0,f32,-,-,-]->f32");
    assert(sk_op_spelling(back.nodes[1], nullptr) == "UNARY.GELU[f32,-,-,-,-]->f32");
    // identity ignores the sequence axes: a second node differing only in max_ne merges
    sk_op_desc d2 = d; d2.max_ne_src1 = {1024, 300, 1, 1}; d2.max_bytes = 9000000;
    std::vector<sk_op_desc> v = {d}; sk_ops_add(v, d2);
    assert(v.size() == 1 && v[0].max_ne_src1[1] == 300 && v[0].max_bytes == 9000000);
    assert(!sk_ops_parse("op=NOPE dst=f32\n", back, err) && !err.empty());
    return 0;
}
```

In `native/tests/CMakeLists.txt`:

```cmake
add_executable(test_ops_format test_ops_format.cpp ../src/sk_ops_format.cpp)
target_include_directories(test_ops_format PRIVATE ../src ../include)
target_link_libraries(test_ops_format PRIVATE ggml)
add_test(NAME test_ops_format COMMAND test_ops_format)
```

- [ ] **Step 2: Build it to see it fail**

Run: `cd native && cmake -S . -B build/cpu && cmake --build build/cpu --target test_ops_format 2>&1 | grep -m1 error`
Expected: `sk_ops.h: No such file`.

- [ ] **Step 3: Write the descriptor model and the text format**

`native/src/sk_ops.h`:

```cpp
/* Op recordings (spec A §3.2): what a family's graph asked of ggml, node by node, captured on
 * one real forward pass and rebuilt for ggml_backend_dev_supports_op. This header is the
 * shared model; sk_ops_format.cpp is the text form (pure — also compiled straight into the
 * test binaries, since the library exports only the sk_* C ABI), sk_ops_record.cpp (test
 * build) captures, cmake/gen_ops_data.py bakes the shipped .ops files into the library, and
 * sk_ops.cpp answers sk_device_supports_ops. */
#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>

constexpr int32_t SK_SRC_ABSENT = -1;
constexpr int32_t SK_SRC_WEIGHT = -2;   // rung-bearing weight (src0 of MUL_MAT / MUL_MAT_ID / GET_ROWS): expanded per dtype at query time

struct sk_op_desc {
    int32_t op = 0;
    std::array<int32_t, 16> op_params{};
    int32_t dst_type = 0;
    std::array<int32_t, 5> src_type{SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    /* Identity includes ne[0] (row length: block sizes, head sizes) but NOT the sequence
     * axes ne[1..3], which vary per decode step; those are kept as maxima for the rebuild. */
    int64_t ne0_src0 = 1, ne0_src1 = 1, ne0_dst = 1;
    std::array<int64_t, 4> max_ne_src0{1, 1, 1, 1}, max_ne_src1{1, 1, 1, 1}, max_ne_dst{1, 1, 1, 1};
    bool contig_src0 = true, contig_src1 = true;
    uint64_t max_bytes = 0;      // largest ggml_nbytes seen among src0/src1/dst for this identity
    bool same_node(const sk_op_desc &o) const {
        return op == o.op && op_params == o.op_params && dst_type == o.dst_type && src_type == o.src_type &&
               ne0_src0 == o.ne0_src0 && ne0_src1 == o.ne0_src1 && ne0_dst == o.ne0_dst &&
               contig_src0 == o.contig_src0 && contig_src1 == o.contig_src1;
    }
};

struct sk_op_recording {
    std::string stage, family, engine, source_file;
    std::vector<std::string> dtypes_in_file;    // ggml_type_name() of every tensor dtype in the GGUF, sorted
    std::vector<sk_op_desc> nodes;
};

std::string sk_ops_format(const sk_op_recording &r);
bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error);
/* "OP.param[src0,src1,src2,src3,src4]->dst" with ggml_op_name()/ggml_type_name(); "-" for an
 * absent source; WEIGHT sources spelled as `weight_type_name` (nullptr → "WEIGHT"). UNARY/GLU
 * carry their kind after the dot; ROPE its mode; everything else no suffix. */
std::string sk_op_spelling(const sk_op_desc &d, const char *weight_type_name);
/* Insert or merge: an equal identity keeps one entry and takes the element-wise max of the
 * ne maxima and max_bytes. */
void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d);
```

`native/src/sk_ops_format.cpp`:

```cpp
#include "sk_ops.h"
#include "ggml.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <sstream>

namespace {

int32_t type_from_name(const std::string &s) {
    if (s == "-") return SK_SRC_ABSENT;
    if (s == "WEIGHT") return SK_SRC_WEIGHT;
    for (int t = 0; t < GGML_TYPE_COUNT; ++t) {
        const char *n = ggml_type_name(static_cast<ggml_type>(t));
        if (n && s == n) return t;
    }
    return -100;
}
std::string type_name(int32_t t, const char *weight) {
    if (t == SK_SRC_ABSENT) return "-";
    if (t == SK_SRC_WEIGHT) return weight ? weight : "WEIGHT";
    return ggml_type_name(static_cast<ggml_type>(t));
}
int32_t op_from_name(const std::string &s) {
    for (int o = 0; o < GGML_OP_COUNT; ++o) if (s == ggml_op_name(static_cast<ggml_op>(o))) return o;
    return -1;
}
std::string param_suffix(const sk_op_desc &d) {
    if (d.op == GGML_OP_UNARY) return std::string(".") + ggml_unary_op_name(static_cast<ggml_unary_op>(d.op_params[0]));
    if (d.op == GGML_OP_GLU)   return std::string(".") + ggml_glu_op_name(static_cast<ggml_glu_op>(d.op_params[0]));
    if (d.op == GGML_OP_ROPE)  return ".mode" + std::to_string(d.op_params[2]);
    return "";
}
std::string ne_str(const std::array<int64_t, 4> &a) {
    return "[" + std::to_string(a[0]) + "," + std::to_string(a[1]) + "," + std::to_string(a[2]) + "," + std::to_string(a[3]) + "]";
}
bool parse_ne(const std::string &s, std::array<int64_t, 4> &out) {
    long long a = 0, b = 0, c = 0, e = 0;
    if (std::sscanf(s.c_str(), "[%lld,%lld,%lld,%lld]", &a, &b, &c, &e) != 4) return false;
    out = {a, b, c, e};
    return true;
}
std::string hexparams(const sk_op_desc &d) {
    bool any = false; for (int v : d.op_params) any |= v != 0;
    if (!any) return "-";
    char buf[16]; std::string s;
    for (int v : d.op_params) { std::snprintf(buf, sizeof buf, "%08x", static_cast<uint32_t>(v)); s += buf; }
    return s;
}
bool parse_params(const std::string &s, std::array<int32_t, 16> &out) {
    out.fill(0);
    if (s == "-") return true;
    if (s.size() != 16 * 8) return false;
    for (int i = 0; i < 16; ++i) out[i] = static_cast<int32_t>(std::stoul(s.substr(i * 8, 8), nullptr, 16));
    return true;
}
void max_into(std::array<int64_t, 4> &a, const std::array<int64_t, 4> &b) { for (int i = 0; i < 4; ++i) a[i] = std::max(a[i], b[i]); }

}  // namespace

std::string sk_op_spelling(const sk_op_desc &d, const char *weight) {
    std::string s = ggml_op_name(static_cast<ggml_op>(d.op)) + param_suffix(d) + "[";
    for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], weight); }
    return s + "]->" + type_name(d.dst_type, weight);
}

void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d) {
    for (auto &n : nodes) {
        if (!n.same_node(d)) continue;
        max_into(n.max_ne_src0, d.max_ne_src0); max_into(n.max_ne_src1, d.max_ne_src1); max_into(n.max_ne_dst, d.max_ne_dst);
        n.max_bytes = std::max(n.max_bytes, d.max_bytes);
        return;
    }
    nodes.push_back(d);
}

std::string sk_ops_format(const sk_op_recording &r) {
    std::string s;
    s += "# stage: " + r.stage + " ; family: " + r.family + "\n";
    s += "# engine: " + r.engine + "\n";
    s += "# source: " + r.source_file + "\n";
    s += "# dtypes-in-file:"; for (const auto &t : r.dtypes_in_file) s += " " + t; s += "\n";
    for (const auto &d : r.nodes) {
        s += "op=" + std::string(ggml_op_name(static_cast<ggml_op>(d.op)));
        s += " params=" + hexparams(d);
        s += " dst=" + type_name(d.dst_type, nullptr);
        s += " src=["; for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], nullptr); } s += "]";
        s += " ne0=[" + std::to_string(d.ne0_src0) + "," + std::to_string(d.ne0_src1) + "," + std::to_string(d.ne0_dst) + "]";
        s += " max0=" + ne_str(d.max_ne_src0) + " max1=" + ne_str(d.max_ne_src1) + " maxd=" + ne_str(d.max_ne_dst);
        s += " contig=[" + std::to_string(d.contig_src0 ? 1 : 0) + "," + std::to_string(d.contig_src1 ? 1 : 0) + "]";
        s += " maxbytes=" + std::to_string(d.max_bytes) + "\n";
    }
    return s;
}

bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error) {
    out = sk_op_recording{};
    std::istringstream in(text);
    std::string line; int lineno = 0;
    auto fail = [&](const std::string &m) { error = "line " + std::to_string(lineno) + ": " + m; return false; };
    while (std::getline(in, line)) {
        ++lineno;
        if (line.empty()) continue;
        if (line[0] == '#') {
            if (line.rfind("# stage: ", 0) == 0) {
                auto semi = line.find(" ; family: ");
                if (semi == std::string::npos) return fail("bad stage/family header");
                out.stage = line.substr(9, semi - 9); out.family = line.substr(semi + 11);
            } else if (line.rfind("# engine: ", 0) == 0) out.engine = line.substr(10);
            else if (line.rfind("# source: ", 0) == 0) out.source_file = line.substr(10);
            else if (line.rfind("# dtypes-in-file:", 0) == 0) {
                std::istringstream ts(line.substr(17)); std::string t;
                while (ts >> t) out.dtypes_in_file.push_back(t);
            }
            continue;
        }
        sk_op_desc d{};
        std::istringstream fs(line); std::string kv; int seen = 0;
        while (fs >> kv) {
            auto eq = kv.find('='); if (eq == std::string::npos) return fail("bad field " + kv);
            std::string k = kv.substr(0, eq), v = kv.substr(eq + 1);
            if (k == "op") { d.op = op_from_name(v); if (d.op < 0) return fail("unknown op " + v); ++seen; }
            else if (k == "params") { if (!parse_params(v, d.op_params)) return fail("bad params"); }
            else if (k == "dst") { d.dst_type = type_from_name(v); if (d.dst_type == -100) return fail("bad dst type " + v); ++seen; }
            else if (k == "src") {
                if (v.size() < 2 || v.front() != '[' || v.back() != ']') return fail("bad src list");
                std::istringstream ss(v.substr(1, v.size() - 2)); std::string t; int i = 0;
                while (std::getline(ss, t, ',') && i < 5) { d.src_type[i] = type_from_name(t); if (d.src_type[i] == -100) return fail("bad src type " + t); ++i; }
            }
            else if (k == "ne0") { long long a = 1, b = 1, c = 1; if (std::sscanf(v.c_str(), "[%lld,%lld,%lld]", &a, &b, &c) != 3) return fail("bad ne0"); d.ne0_src0 = a; d.ne0_src1 = b; d.ne0_dst = c; }
            else if (k == "max0") { if (!parse_ne(v, d.max_ne_src0)) return fail("bad max0"); }
            else if (k == "max1") { if (!parse_ne(v, d.max_ne_src1)) return fail("bad max1"); }
            else if (k == "maxd") { if (!parse_ne(v, d.max_ne_dst)) return fail("bad maxd"); }
            else if (k == "contig") { int a = 1, b = 1; std::sscanf(v.c_str(), "[%d,%d]", &a, &b); d.contig_src0 = a; d.contig_src1 = b; }
            else if (k == "maxbytes") { d.max_bytes = std::stoull(v); }
            else return fail("unknown field " + k);
        }
        if (seen < 2) return fail("op and dst are required");
        sk_ops_add(out.nodes, d);
    }
    return true;
}
```

- [ ] **Step 4: Run the format test to see it pass**

Run: `cd native && cmake --build build/cpu --target test_ops_format && ctest --test-dir build/cpu -R test_ops_format --output-on-failure | tail -3`
Expected: PASS.

- [ ] **Step 5: The recorder — C entry points, the recording device, the audio.cpp shim**

Add to `native/include/sokuji_native.h`, at the end before the closing `extern "C"`:

```c
/* ---- op recorder (test builds only: -DSOKUJI_RECORD_OPS=ON) ------------------------- */
#if defined(SK_RECORD_OPS)
/* Register the recording device with ggml's registry. MUST be called before the first
 * sk_init of the process (sk_init enumerates devices once, first call wins). Returns 1. */
SK_API int32_t   sk_record_register_device(void);
/* Start capturing. `weight_names`: every tensor name in the model file; `rung_ops`: the op
 * names whose src0 is a rung-bearing weight ("MUL_MAT", "MUL_MAT_ID", "GET_ROWS") — a src0
 * of one of those ops whose name is in weight_names is recorded as WEIGHT, every other
 * tensor with its literal dtype. */
SK_API void      sk_record_begin(const char *const *weight_names, int32_t n_names,
                                 const char *const *rung_ops, int32_t n_rung_ops);
/* Stop capturing and write the .ops file. */
SK_API sk_status sk_record_end_to_file(const char *path, const char *stage, const char *family,
                                       const char *source_file, const char *const *dtypes, int32_t n_dtypes);
SK_API int32_t   sk_record_node_count(void);
#endif
```

Create `native/src/sk_ops_record.cpp`:

```cpp
/* Test-build-only recorder (SK_RECORD_OPS). Two capture paths feed one descriptor set:
 *  - a registered RECORDING DEVICE (ggml_backend_register) for llama.cpp / transcribe.cpp,
 *    which take a ggml_backend_dev_t and run through ggml_backend_sched — it accepts every op
 *    and every host buffer type so the scheduler routes every node to it, records, and forwards
 *    to the real CPU backend obtained through the registry;
 *  - a redirected ggml_backend_graph_compute for audio.cpp, which picks its own device by
 *    backend type and computes single-backend (audiocpp_compat.h, under SK_RECORD_OPS). */
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
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

int32_t src_type_of(const ggml_tensor *node, int i) {
    const ggml_tensor *t = node->src[i];
    if (!t) return SK_SRC_ABSENT;
    const char *name = ggml_get_name(t);
    if (i == 0 && g_rung_ops.count(node->op) && name && *name && g_weight_names.count(name)) return SK_SRC_WEIGHT;
    return static_cast<int32_t>(t->type);
}

void record_node(const ggml_tensor *node) {
    if (!node || node->op == GGML_OP_NONE || node->op == GGML_OP_VIEW || node->op == GGML_OP_RESHAPE ||
        node->op == GGML_OP_PERMUTE || node->op == GGML_OP_TRANSPOSE) return;   // no-op views: never asked of a backend
    std::lock_guard<std::mutex> l(g_rec_mutex);
    if (!g_recording) return;
    sk_op_desc d{};
    d.op = node->op;
    std::memcpy(d.op_params.data(), node->op_params, sizeof d.op_params);
    d.dst_type = node->type;
    for (int i = 0; i < 5 && i < GGML_MAX_SRC; ++i) d.src_type[i] = src_type_of(node, i);
    for (int i = 0; i < 4; ++i) {
        d.max_ne_dst[i] = node->ne[i];
        d.max_ne_src0[i] = node->src[0] ? node->src[0]->ne[i] : 1;
        d.max_ne_src1[i] = node->src[1] ? node->src[1]->ne[i] : 1;
    }
    d.ne0_src0 = d.max_ne_src0[0]; d.ne0_src1 = d.max_ne_src1[0]; d.ne0_dst = d.max_ne_dst[0];
    d.contig_src0 = !node->src[0] || ggml_is_contiguous(node->src[0]);
    d.contig_src1 = !node->src[1] || ggml_is_contiguous(node->src[1]);
    d.max_bytes = ggml_nbytes(node);
    if (node->src[0]) d.max_bytes = std::max<uint64_t>(d.max_bytes, ggml_nbytes(node->src[0]));
    if (node->src[1]) d.max_bytes = std::max<uint64_t>(d.max_bytes, ggml_nbytes(node->src[1]));
    sk_ops_add(g_nodes, d);
}
}  // namespace

/* audio.cpp path: every graph_compute in every audio.cpp TU lands here (compat header). This
 * TU is compiled WITHOUT the redirect, so the call below is the real function. */
extern "C" enum ggml_status sk_recording_graph_compute(ggml_backend_t backend, struct ggml_cgraph *cgraph) {
    for (int i = 0; i < ggml_graph_n_nodes(cgraph); ++i) record_node(ggml_graph_node(cgraph, i));
    return ggml_backend_graph_compute(backend, cgraph);
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
 *   ggml_backend_dev_props: name, description, device_id, memory_free, memory_total, type, caps */
namespace {
const char *rec_name(ggml_backend_t) { return "SKREC"; }
void rec_free(ggml_backend_t b) { delete b; }
enum ggml_status rec_compute(ggml_backend_t, struct ggml_cgraph *g) {
    for (int i = 0; i < ggml_graph_n_nodes(g); ++i) record_node(ggml_graph_node(g, i));
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
                                       const char *source_file, const char *const *dtypes, int32_t n_dtypes) {
    sk_op_recording r;
    {
        std::lock_guard<std::mutex> l(g_rec_mutex);
        g_recording = false;
        r.nodes = g_nodes; g_nodes.clear();
    }
    r.stage = stage; r.family = family; r.engine = sk_engine_versions(); r.source_file = source_file;
    for (int32_t i = 0; i < n_dtypes; ++i) r.dtypes_in_file.push_back(dtypes[i]);
    std::sort(r.dtypes_in_file.begin(), r.dtypes_in_file.end());
    std::ofstream f(path);
    if (!f) return SK_ERR_INTERNAL;
    f << sk_ops_format(r);
    return SK_OK;
}

}  // extern "C"
```

`native/src/audiocpp_compat.h` — append:

```cpp
#if defined(SK_RECORD_OPS)
/* Test build only: audio.cpp computes single-backend through ggml_backend_graph_compute, so the
 * op recorder intercepts that call. ggml-backend.h is included FIRST so the real prototype is
 * declared before the macro renames later uses; sk_ops_record.cpp is compiled without this
 * header and forwards to the real function. */
#include "ggml-backend.h"
extern "C" enum ggml_status sk_recording_graph_compute(ggml_backend_t backend, struct ggml_cgraph *cgraph);
#define ggml_backend_graph_compute sk_recording_graph_compute
#endif
```

- [ ] **Step 6: The test-build variant, the shared load-and-run, the driver**

`native/CMakeLists.txt`, after the `sokuji_native` target is fully defined (and after `src/sk_ops_format.cpp` has been added to its sources unconditionally):

```cmake
option(SOKUJI_RECORD_OPS "Build the op-recording variant of the library (tests only)" OFF)
if(SOKUJI_RECORD_OPS)
    # Same sources + the recorder; every audio.cpp TU of THIS configure sees SK_RECORD_OPS, so
    # this must be a separate build directory (build/record), never the shipping one.
    target_compile_definitions(sokuji_native PUBLIC SK_RECORD_OPS=1)
    target_sources(sokuji_native PRIVATE src/sk_ops_record.cpp)
    foreach(_t IN LISTS _audiocpp_engine_targets)
        target_compile_definitions(${_t} PRIVATE SK_RECORD_OPS=1)
    endforeach()
    # The recorder's own TU must not see the redirect (it forwards to the real function).
    set_source_files_properties(src/sk_ops_record.cpp PROPERTIES COMPILE_OPTIONS
        "$<IF:$<CXX_COMPILER_ID:MSVC>,/USK_RECORD_OPS,-USK_RECORD_OPS>")
endif()
```

Create `native/tests/record_common.h` — the per-stage load-and-run, shared by the driver and Task 6's coverage test. It assumes `sk_record_register_device()` and `sk_init` have already run (the callers do that once):

```cpp
/* One forward pass of one family with the recorder armed. Requires: sk_record_register_device()
 * called BEFORE sk_init, sk_init done, `devs`/`n` from sk_devices(). Writes the .ops file. */
#pragma once
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <set>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "gguf.h"
#include "ggml.h"

static const char *const RUNG_OPS[] = {"MUL_MAT", "MUL_MAT_ID", "GET_ROWS"};

static std::string find_gguf(const std::string &path) {     // a directory → its single .gguf; a file → itself
    if (path.size() > 5 && path.compare(path.size() - 5, 5, ".gguf") == 0) return path;
    for (const auto &e : std::filesystem::directory_iterator(path))
        if (e.path().extension() == ".gguf") return e.path().string();
    return "";
}

static bool ignore_text(const char *, void *) { return true; }
static bool ignore_audio(const float *, size_t, int32_t, int32_t, void *) { return true; }
struct Clip { std::vector<float> pcm; int32_t rate = 0; };
static bool grab_audio(const float *pcm, size_t n, int32_t rate, int32_t, void *user) {
    auto *c = static_cast<Clip *>(user); c->pcm.insert(c->pcm.end(), pcm, pcm + n); c->rate = rate; return true;
}

/* A real speech clip for the clone-only families: supertonic preset M1 on the CPU device, made
 * BEFORE recording starts so its nodes never leak into the other family's file. */
static Clip reference_clip(const sk_device *cpu, const std::string &supertonic_dir) {
    Clip c;
    sk_tts_options o{"supertonic", nullptr};
    sk_tts *m = nullptr;
    if (sk_tts_load(supertonic_dir.c_str(), cpu, &o, &m) != SK_OK) return c;
    sk_tts_set_preset(m, "M1");
    sk_tts_synth(m, "The quick brown fox jumps over the lazy dog.", "en", 1.0f, grab_audio, &c);
    sk_tts_unload(m);
    return c;
}

/* Returns the node count written (0 = nothing recorded — treat as a failure). */
static int record_family(const std::string &stage, const std::string &family, const std::string &model,
                         const sk_device *dev, const std::string &out_path, int32_t flash_attn,
                         const std::string &supertonic_dir) {
    const std::string gguf = find_gguf(model);
    std::vector<std::string> names, dtypes_v; std::set<std::string> dtypes;
    {
        gguf_init_params ip = { /*no_alloc*/ true, /*ctx*/ nullptr };
        gguf_context *g = gguf_init_from_file(gguf.c_str(), ip);
        if (!g) { std::fprintf(stderr, "record_family: cannot read %s\n", gguf.c_str()); return 0; }
        for (int64_t i = 0; i < gguf_get_n_tensors(g); ++i) {
            names.push_back(gguf_get_tensor_name(g, i));
            dtypes.insert(ggml_type_name(gguf_get_tensor_type(g, i)));
        }
        gguf_free(g);
    }
    dtypes_v.assign(dtypes.begin(), dtypes.end());
    std::vector<const char *> name_ptrs; for (auto &s : names) name_ptrs.push_back(s.c_str());
    std::vector<const char *> dtype_ptrs; for (auto &s : dtypes_v) dtype_ptrs.push_back(s.c_str());

    Clip ref;
    const bool needs_voice = family == "qwen3_tts" || family == "omnivoice" || family == "index_tts2";
    if (needs_voice) ref = reference_clip(dev, supertonic_dir);

    sk_record_begin(name_ptrs.data(), (int32_t)name_ptrs.size(), RUNG_OPS, 3);
    if (stage == "tts") {
        sk_tts_options o{family.c_str(), family == "pocket_tts" ? "english" : nullptr};
        sk_tts *m = nullptr;
        if (sk_tts_load(model.c_str(), dev, &o, &m) != SK_OK) { std::fprintf(stderr, "tts load: %s\n", sk_last_error()); return 0; }
        if (needs_voice && !ref.pcm.empty()) sk_tts_set_voice(m, ref.pcm.data(), ref.pcm.size(), ref.rate, "The quick brown fox jumps over the lazy dog.");
        if (family == "pocket_tts") sk_tts_set_preset(m, "alba");
        if (sk_tts_synth(m, "The quick brown fox jumps over the lazy dog.", "en", 1.0f, ignore_audio, nullptr) != SK_OK)
            std::fprintf(stderr, "tts synth: %s\n", sk_last_error());
        sk_tts_unload(m);
    } else if (stage == "asr") {
        sk_asr_model *m = nullptr;
        if (sk_asr_load(gguf.c_str(), dev, &m) != SK_OK) { std::fprintf(stderr, "asr load: %s\n", sk_last_error()); return 0; }
        std::vector<float> audio(16000 * 3);
        for (size_t i = 0; i < audio.size(); ++i) audio[i] = 0.1f * std::sin(2 * 3.14159f * 440 * i / 16000.f);
        sk_asr_run(m, audio.data(), audio.size(), "en", ignore_text, nullptr);
        sk_asr_unload(m);
    } else {
        sk_translate_options to{0, flash_attn};
        sk_translate *m = nullptr;
        if (sk_translate_load(gguf.c_str(), dev, &to, &m) != SK_OK) { std::fprintf(stderr, "translate load: %s\n", sk_last_error()); return 0; }
        sk_gen_options gen{16, nullptr};
        sk_translate_complete(m, "Translate to French: Hello, world.", &gen, ignore_text, nullptr);
        sk_translate_unload(m);
    }
    const int count = sk_record_node_count();
    sk_record_end_to_file(out_path.c_str(), stage.c_str(), family.c_str(),
                          std::filesystem::path(gguf).filename().string().c_str(), dtype_ptrs.data(), (int32_t)dtype_ptrs.size());
    return count;
}
```

Create `native/tests/record_ops.cpp`:

```cpp
/* record_ops <module_dir> <stage> <family> <model-dir-or-gguf> <out.ops> <supertonic-dir> [flash_attn 0|1|2]
 * asr/translate run on the recording device (registered before sk_init); tts runs on the CPU
 * device with the audio.cpp shim. Records ONE forward pass and writes the .ops file. */
#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include "record_common.h"

int main(int argc, char **argv) {
    if (argc < 7) { std::fprintf(stderr, "usage: record_ops <module_dir> <stage> <family> <model> <out.ops> <supertonic-dir> [flash_attn]\n"); return 2; }
    const std::string stage = argv[2], family = argv[3], model = argv[4], out = argv[5], supertonic = argv[6];
    const int32_t fa = argc > 7 ? std::atoi(argv[7]) : 0;
    sk_record_register_device();                                   // BEFORE sk_init: first call wins
    sk_init_options opts = {}; opts.abi_version = SK_ABI_VERSION; opts.n_threads = 4; opts.module_dir = argv[1];
    assert(sk_init(&opts) == SK_OK);
    sk_device devs[16]; const int n = sk_devices(devs, 16);
    const sk_device *cpu = nullptr, *rec = nullptr;
    for (int i = 0; i < n; ++i) {
        if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i];
        if (std::strcmp(devs[i].name, "SKREC0") == 0) rec = &devs[i];
    }
    assert(cpu && rec);
    const int count = record_family(stage, family, model, stage == "tts" ? cpu : rec, out, fa, supertonic);
    std::printf("record_ops: %d nodes -> %s\n", count, out.c_str());
    return count > 0 ? 0 : 1;
}
```

`native/tests/CMakeLists.txt`:

```cmake
if(SOKUJI_RECORD_OPS)
    add_executable(record_ops record_ops.cpp ../src/sk_ops_format.cpp)
    target_link_libraries(record_ops PRIVATE sokuji_native ggml)
    target_include_directories(record_ops PRIVATE ../src)
endif()
```

A note the implementer must act on: the recording device is `SK_DEVICE_OTHER` in `sk::kind_of`, so `sk_asr.cpp` passes it as `TRANSCRIBE_BACKEND_AUTO` + `lp.device`. If the ASR recording comes back with 0 nodes, transcribe.cpp ignored the explicit device under AUTO; then, under `SK_RECORD_OPS` only, make `kind_of` map registry name `"SKREC"` to `SK_DEVICE_VULKAN` (`sk_common.cpp:120-127`) so `backend_for` requests an explicit backend, and re-record.

- [ ] **Step 7: Build the recording variant and record the shipped `.ops` files**

Configure and build (CPU lane, separate build dir): `cd native && cmake -S . -B build/record -DCMAKE_BUILD_TYPE=Release -DSOKUJI_GPU=none -DSOKUJI_RECORD_OPS=ON && cmake --build build/record -j8 2>&1 | tail -3`

Then, from `native/` (`mkdir -p src/ops` first), run these twelve literal lines one per Bash call (no shell variables in argument positions; `build/record/lib/record_ops` is where `CMAKE_RUNTIME_OUTPUT_DIRECTORY` puts it):

```
build/record/lib/record_ops build/record/lib tts moss_tts_nano /home/jiangzhuo/.cache/sokuji-native-tests/tts/moss-tts-nano src/ops/tts-moss_tts_nano.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts qwen3_tts /home/jiangzhuo/.cache/sokuji-native-tests/tts/qwen3-tts-0.6b src/ops/tts-qwen3_tts.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts omnivoice /home/jiangzhuo/.cache/sokuji-native-tests/tts/omnivoice-0.6b src/ops/tts-omnivoice.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts pocket_tts /home/jiangzhuo/.cache/sokuji-native-tests/tts/pocket-tts-en src/ops/tts-pocket_tts.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts supertonic /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3 src/ops/tts-supertonic.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts voxcpm1 /home/jiangzhuo/.cache/sokuji-native-tests/tts/voxcpm1-0.5b src/ops/tts-voxcpm1.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts voxcpm2 /home/jiangzhuo/.cache/sokuji-native-tests/tts/voxcpm2 src/ops/tts-voxcpm2.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts irodori_tts /home/jiangzhuo/.cache/sokuji-native-tests/tts/irodori-tts-v4-small src/ops/tts-irodori_tts.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib tts index_tts2 /home/jiangzhuo/.cache/sokuji-native-tests/tts/index-tts2.5 src/ops/tts-index_tts2.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib asr whisper /home/jiangzhuo/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf src/ops/asr-whisper.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib asr moonshine_streaming /home/jiangzhuo/.cache/sokuji-native-tests/moonshine-streaming-tiny-Q8_0.gguf src/ops/asr-moonshine_streaming.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3
build/record/lib/record_ops build/record/lib translate qwen3 /home/jiangzhuo/.cache/sokuji-native-tests/Qwen3-0.6B-Q8_0.gguf src/ops/translate-qwen3.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3 1
build/record/lib/record_ops build/record/lib translate qwen3 /home/jiangzhuo/.cache/sokuji-native-tests/Qwen3-0.6B-Q8_0.gguf /home/jiangzhuo/.claude/jobs/387091ff/tmp/qwen3-fa-off.ops /home/jiangzhuo/.cache/sokuji-native-tests/tts/supertonic-3 2
```

Merge the flash-attention-off translate recording into the shipped file: `grep '^op=' /home/jiangzhuo/.claude/jobs/387091ff/tmp/qwen3-fa-off.ops >> src/ops/translate-qwen3.ops` (Task 5's parser de-duplicates through `sk_ops_add`; the header line stays the FA-on run's). Every invocation must print a non-zero node count and exit 0. Inspect one: `head -6 src/ops/tts-voxcpm2.ops` — four header lines, then `op=` lines with `WEIGHT` only on `MUL_MAT`/`GET_ROWS` src0 and `bf16` present in `dtypes-in-file`; `grep -c '^op=' src/ops/tts-voxcpm2.ops` should be in the tens, not thousands (identity excludes sequence axes).

- [ ] **Step 8: Commit**

```bash
git add native/include/sokuji_native.h native/src/sk_ops.h native/src/sk_ops_format.cpp native/src/sk_ops_record.cpp native/src/audiocpp_compat.h \
        native/tests/record_common.h native/tests/record_ops.cpp native/tests/test_ops_format.cpp native/tests/CMakeLists.txt native/CMakeLists.txt native/src/ops/
git commit -m "native: op recorder — node descriptors, the .ops format, a recording device for llama/transcribe and a graph_compute shim for audio.cpp; twelve recordings"
```

---

### Task 5: `sk_device_supports_ops` — bake the recordings into the library, rebuild nodes, ask `supports_op`

**Files:**
- Create: `native/cmake/gen_ops_data.py`, `native/src/sk_ops.cpp`, `native/src/sk_ops_data.h`
- Modify: `native/CMakeLists.txt` (custom command + sources), `native/src/sk_profile.cpp` (drop the stub), `native/tests/test_common.cpp`
- Modify: `native/python/sokuji_native/__init__.py` (`OpCoverage`, `device_supports_ops()`), `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Consumes: Task 4's `sk_op_recording`, `sk_ops_parse`, `sk_op_spelling`; the `.ops` files.
- Produces: `sk_device_supports_ops` (§3.2 contract); the C accessors `sk_ops_blob_count()` / `sk_ops_blob_at(i, &stage, &family, &text)` (exported, so tests can read the baked recordings); Python `OpCoverage(all_supported: bool, unsupported: tuple[str, ...], checked: tuple[str, ...])` and `device_supports_ops(index, stage, family, weight_dtypes) -> OpCoverage` raising `NativeError` (whose `.status` is the sk_status) on error.

- [ ] **Step 1: Write the failing CTest assertions**

In `test_common.cpp` after the profile loop:

```cpp
    // Op coverage: every shipped recording, expanded over its own dtypes-in-file set, is fully
    // supported on the CPU device; error paths are the documented statuses.
    {
        const char *f16[] = {"f16", "f32"};
        sk_op_coverage cov = {};
        assert(sk_device_supports_ops(-1, "tts", "supertonic", f16, 2, &cov) == SK_ERR_INVALID_ARGUMENT);
        assert(sk_device_supports_ops(0, "tts", "no-such-family", f16, 2, &cov) == SK_ERR_NOT_FOUND);
        assert(sk_device_supports_ops(0, "tts", "supertonic", f16, 0, &cov) == SK_ERR_INVALID_ARGUMENT);
        const char *bad[] = {"q9_9"};
        assert(sk_device_supports_ops(0, "tts", "supertonic", bad, 1, &cov) == SK_ERR_INVALID_ARGUMENT);
        int cpu_index = -1;
        for (int i = 0; i < n; ++i) if (devs[i].kind == SK_DEVICE_CPU) cpu_index = i;
        int n_tts = 0;
        for (int b = 0; b < sk_ops_blob_count(); ++b) {
            const char *stage = nullptr, *family = nullptr, *text = nullptr;
            sk_ops_blob_at(b, &stage, &family, &text);
            // the dtypes-in-file line: "# dtypes-in-file: a b c"
            std::string t(text);
            auto pos = t.find("# dtypes-in-file:");
            assert(pos != std::string::npos);
            std::string line = t.substr(pos + 17, t.find('\n', pos) - pos - 17);
            std::vector<std::string> dts; std::string tok; std::istringstream ss(line);
            while (ss >> tok) dts.push_back(tok);
            std::vector<const char *> ptrs; for (auto &s : dts) ptrs.push_back(s.c_str());
            sk_op_coverage c = {};
            assert(sk_device_supports_ops(cpu_index, stage, family, ptrs.data(), (int32_t)ptrs.size(), &c) == SK_OK);
            assert(c.n_ops > 0 && c.n_ops <= SK_OP_COVERAGE_MAX);
            for (int i = 0; i < c.n_ops; ++i) if (!c.ops[i].supported) std::fprintf(stderr, "%s/%s unsupported on cpu: %s\n", stage, family, c.ops[i].name);
            assert(c.all_supported == 1);
            if (std::string(stage) == "tts") ++n_tts;
        }
        assert(n_tts == 9);
    }
```

(add `#include <sstream>` and `#include <vector>` to the test's includes).

- [ ] **Step 2: Run it to see it fail**

Run: `cd native && cmake --build build/cpu --target test_common 2>&1 | grep -m1 error`
Expected: `sk_ops_blob_count` not declared.

- [ ] **Step 3: The generator, the data header, the accessors**

`native/src/sk_ops_data.h`:

```cpp
#pragma once
#include "sokuji_native.h"
struct sk_ops_blob { const char *stage; const char *family; const char *text; };
extern const sk_ops_blob sk_ops_blobs[];
extern const int sk_ops_blob_count_;
```

Add to `sokuji_native.h` (public, exported — tests read the baked recordings through them):

```c
/* The op recordings baked into this library (spec A §3.2): count, and the i-th recording's
 * stage, family and .ops text (pointers owned by the library, valid for its lifetime). */
SK_API int32_t   sk_ops_blob_count(void);
SK_API sk_status sk_ops_blob_at(int32_t i, const char **stage, const char **family, const char **text);
```

`native/cmake/gen_ops_data.py`:

```python
"""Bake native/src/ops/*.ops into one C++ translation unit (parsed at first use by
sk_ops_parse, so the text format stays the single source of truth) and emit one static_assert
per recording that its expansion over the widest fallback set fits SK_OP_COVERAGE_MAX.
usage: gen_ops_data.py <ops-dir> <out.cpp> <sk_ops_data.h path>"""
import pathlib
import sys

WIDEST_FALLBACK = 7   # len(RUNG_FALLBACK_DTYPES["q4_k_m"]) in sidecar/sokuji_sidecar/catalog.py — keep in sync

ops_dir, out, header = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
files = sorted(ops_dir.glob("*.ops"))
lines = ['// GENERATED by cmake/gen_ops_data.py from src/ops/*.ops — do not edit.',
         f'#include "{header}"', '']
for f in files:
    body = [l for l in f.read_text(encoding="utf-8").splitlines() if l.startswith("op=")]
    weight = sum(1 for l in body if "WEIGHT" in l)
    expanded = weight * WIDEST_FALLBACK + (len(body) - weight)
    lines.append(f'static_assert({expanded} <= SK_OP_COVERAGE_MAX, "{f.name}: {expanded} expanded entries exceed SK_OP_COVERAGE_MAX");')
lines += ['', 'const sk_ops_blob sk_ops_blobs[] = {']
for f in files:
    stage, family = f.stem.split("-", 1)
    text = f.read_text(encoding="utf-8").replace("\\", "\\\\").replace('"', '\\"')
    body = "".join(f'    "{line}\\n"\n' for line in text.splitlines())
    lines.append(f'    {{ "{stage}", "{family}",\n{body}    }},')
lines += ['};', f'const int sk_ops_blob_count_ = {len(files)};', '']
out.write_text("\n".join(lines), encoding="utf-8")
print(f"gen_ops_data: {len(files)} recordings -> {out}")
```

`native/CMakeLists.txt`, before `target_sources(sokuji_native ...)` (a `find_package(Python3 COMPONENTS Interpreter REQUIRED)` already exists for `patch_upstream.py`; if not, add it there):

```cmake
# Op recordings (spec A §3.2) are data under src/ops/*.ops, baked into the library at build
# time so the query needs no files at runtime. Any .ops change re-runs the generator.
file(GLOB _sk_ops_files ${CMAKE_CURRENT_SOURCE_DIR}/src/ops/*.ops)
add_custom_command(
    OUTPUT ${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp
    COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_ops_data.py
            ${CMAKE_CURRENT_SOURCE_DIR}/src/ops ${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp
            ${CMAKE_CURRENT_SOURCE_DIR}/src/sk_ops_data.h
    DEPENDS ${_sk_ops_files} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_ops_data.py
    COMMENT "sokuji-native: baking op recordings")
target_sources(sokuji_native PRIVATE src/sk_ops.cpp ${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp)
```

- [ ] **Step 4: Implement the query**

`native/src/sk_ops.cpp`:

```cpp
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

/* Rebuild one recorded node with a concrete weight type at the recorded ne[0] (block sizes
 * stay valid) and the recorded maxima on the other axes, grown so nbytes reaches max_bytes
 * (buffer-range checks are asked at the real size), and ask the device. Nothing is allocated
 * on the device; nothing runs. */
bool ask(ggml_backend_dev_t dev, const sk_op_desc &d, int32_t weight_type, std::string &spelling_out) {
    ggml_init_params ip = { 64 * 1024, nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) return false;
    auto concrete = [&](int32_t t) -> ggml_type { return static_cast<ggml_type>(t == SK_SRC_WEIGHT ? weight_type : t); };
    auto grow = [&](std::array<int64_t, 4> ne, ggml_type t) {
        const int64_t row_bytes = ggml_row_size(t, ne[0]);
        if (row_bytes > 0) {
            const int64_t have = row_bytes * ne[1] * ne[2] * ne[3];
            if (have < static_cast<int64_t>(d.max_bytes)) ne[1] = (static_cast<int64_t>(d.max_bytes) + row_bytes * ne[2] * ne[3] - 1) / (row_bytes * ne[2] * ne[3]);
        }
        return ne;
    };
    auto mk = [&](int32_t t, const std::array<int64_t, 4> &ne0, bool contig) -> ggml_tensor * {
        if (t == SK_SRC_ABSENT) return nullptr;
        std::array<int64_t, 4> ne = grow(ne0, concrete(t));
        ggml_tensor *x = ggml_new_tensor_4d(ctx, concrete(t), ne[0], ne[1], ne[2], ne[3]);
        return contig ? x : ggml_transpose(ctx, x);   // a non-contiguous view, as recorded
    };
    ggml_tensor *node = ggml_new_tensor_4d(ctx, concrete(d.dst_type), d.max_ne_dst[0], d.max_ne_dst[1], d.max_ne_dst[2], d.max_ne_dst[3]);
    node->op = static_cast<ggml_op>(d.op);
    std::memcpy(node->op_params, d.op_params.data(), sizeof node->op_params);
    node->src[0] = mk(d.src_type[0], d.max_ne_src0, d.contig_src0);
    node->src[1] = mk(d.src_type[1], d.max_ne_src1, d.contig_src1);
    for (int i = 2; i < 5; ++i) node->src[i] = mk(d.src_type[i], {d.max_ne_src1[0], 1, 1, 1}, true);
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
        wtypes.push_back(t);
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
    try {
        for (const sk_op_desc &d : rec->nodes) {
            const bool has_weight = std::find(d.src_type.begin(), d.src_type.end(), SK_SRC_WEIGHT) != d.src_type.end();
            const std::vector<int32_t> expand = has_weight ? wtypes : std::vector<int32_t>{-1};
            for (int32_t wt : expand) {
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
    return SK_OK;
}

}  // extern "C"
```

Remove the `sk_device_supports_ops` stub from `sk_profile.cpp`.

- [ ] **Step 5: Run the CTest to see it pass**

Run: `cd native && cmake -S . -B build/cpu && cmake --build build/cpu -j8 && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure 2>&1 | tail -3`
Expected: PASS. An `unsupported on cpu:` line names any node the CPU backend refuses — that is a recording defect (a WEIGHT mark on a non-rung tensor), fixed in the recorder, not by editing the `.ops` file.

- [ ] **Step 6: Binding wrapper and its test**

`native/python/tests/test_sokuji_native.py`:

```python
@needs_tree
def test_device_supports_ops_cpu_all_supported_and_errors():
    sokuji_native.init()
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    cov = sokuji_native.device_supports_ops(cpu.index, "tts", "supertonic", ["f16", "f32"])
    assert cov.all_supported and cov.unsupported == () and len(cov.checked) > 0
    assert any(c.startswith("MUL_MAT[") and c.endswith("->f32") for c in cov.checked)
    with pytest.raises(sokuji_native.NativeError) as e:
        sokuji_native.device_supports_ops(cpu.index, "tts", "no-such-family", ["f16"])
    assert e.value.status == sokuji_native._ffi.SK_ERR_NOT_FOUND
    with pytest.raises(sokuji_native.NativeError):
        sokuji_native.device_supports_ops(cpu.index, "tts", "supertonic", [])
```

(`NativeError` is constructed as `NativeError(status, message)` — check its class near the top of `__init__.py` for the attribute name; if it is not `status`, use the name it has.) In `__init__.py` after `DeviceProfile`:

```python
@dataclass(frozen=True)
class OpCoverage:
    all_supported: bool
    unsupported: tuple[str, ...]
    checked: tuple[str, ...]
```

and after `device_profiles`:

```python
def device_supports_ops(index: int, stage: str, family: str, weight_dtypes) -> OpCoverage:
    """Ask the device's own supports_op about the family's recorded graph nodes, WEIGHT sources
    expanded over `weight_dtypes` (ggml type names). NativeError with the status on every
    documented error (NOT_FOUND = no recording, INVALID_ARGUMENT, INTERNAL, BACKEND)."""
    lib = _load()
    names = [str(t).encode() for t in weight_dtypes]
    arr = (ctypes.c_char_p * max(1, len(names)))(*names)
    raw = _ffi.sk_op_coverage()
    status = lib.sk_device_supports_ops(int(index), stage.encode(), family.encode(), arr, len(names), ctypes.byref(raw))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_device_supports_ops")
    checks = [(raw.ops[i].name.decode("utf-8", "replace"), bool(raw.ops[i].supported)) for i in range(raw.n_ops)]
    return OpCoverage(bool(raw.all_supported), tuple(n for n, ok in checks if not ok), tuple(n for n, _ in checks))
```

Add both names to `__all__`; add `lib.sk_ops_blob_count`/`sk_ops_blob_at` prototypes to `_ffi.bind()` (`restype c_int32` / `[c_int32, POINTER(c_char_p), POINTER(c_char_p), POINTER(c_char_p)]`).

- [ ] **Step 7: Run the binding test**

Run: `cd native && ci/build.sh none linux_aarch64 2>&1 | tail -5` — Expected: PASS including `test_device_supports_ops_cpu_all_supported_and_errors`.

- [ ] **Step 8: Commit**

```bash
git add native/cmake/gen_ops_data.py native/src/sk_ops.cpp native/src/sk_ops_data.h native/src/sk_profile.cpp native/include/sokuji_native.h native/CMakeLists.txt \
        native/tests/test_common.cpp native/python/sokuji_native/__init__.py native/python/sokuji_native/_ffi.py native/python/tests/test_sokuji_native.py
git commit -m "native: sk_device_supports_ops — recordings baked at build time with a per-file static_assert, nodes rebuilt with recorded shapes, WEIGHT expanded over the caller's dtype set"
```

---

### Task 6: `test_ops_coverage` — re-record and diff; the pin-bump checklist

**Files:**
- Create: `native/tests/test_ops_coverage.cpp`; Modify: `native/tests/CMakeLists.txt`, `native/README.md`, `native/ci/build.sh`, `native/ci/build.ps1`

- [ ] **Step 1: Write the coverage test**

Create `native/tests/test_ops_coverage.cpp`:

```cpp
/* The shipped op recordings equal what the engines do TODAY: re-record every family whose
 * model is present and diff. rc 77 only when no model at all is present; otherwise each
 * present family is asserted and each absent one prints SKIPPED. Runs against the
 * SK_RECORD_OPS build (build/record), never the shipping one. The recording device is
 * registered ONCE before the single sk_init (first call wins). */
#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include <set>
#include <sstream>
#include <string>
#include "record_common.h"
#include "sk_ops.h"

struct Case { const char *stage, *family, *env; };
static const Case CASES[] = {
    {"tts", "moss_tts_nano", "SK_TEST_TTS_MOSS_DIR"},     {"tts", "supertonic", "SK_TEST_TTS_SUPERTONIC_DIR"},
    {"tts", "qwen3_tts", "SK_TEST_TTS_QWEN3_DIR"},        {"tts", "omnivoice", "SK_TEST_TTS_OMNIVOICE_DIR"},
    {"tts", "pocket_tts", "SK_TEST_TTS_POCKET_DIR"},      {"tts", "voxcpm1", "SK_TEST_TTS_VOXCPM1_DIR"},
    {"tts", "voxcpm2", "SK_TEST_TTS_VOXCPM2_DIR"},        {"tts", "irodori_tts", "SK_TEST_TTS_IRODORI_DIR"},
    {"tts", "index_tts2", "SK_TEST_TTS_INDEX_DIR"},
    {"asr", "whisper", "SK_TEST_ASR_GGUF"},               {"asr", "moonshine_streaming", "SK_TEST_ASR_STREAM_GGUF"},
    {"translate", "qwen3", "SK_TEST_TRANSLATE_GGUF"},
};

static std::set<std::string> spellings(const sk_op_recording &r) {
    std::set<std::string> s;
    for (const auto &d : r.nodes) s.insert(sk_op_spelling(d, nullptr) + " ne0=" + std::to_string(d.ne0_src0));
    return s;
}
static bool read_file(const std::string &p, std::string &out) {
    std::ifstream f(p); if (!f) return false; std::stringstream ss; ss << f.rdbuf(); out = ss.str(); return true;
}

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    const char *supertonic = std::getenv("SK_TEST_TTS_SUPERTONIC_DIR");
    int present = 0, failures = 0;
    for (const Case &c : CASES) if (std::getenv(c.env) && *std::getenv(c.env)) ++present;
    if (present == 0) { std::printf("test_ops_coverage: no models present, skipping\n"); return 77; }
    if (!supertonic) { std::printf("test_ops_coverage: SK_TEST_TTS_SUPERTONIC_DIR is required (reference clip)\n"); return 1; }

    sk_record_register_device();
    sk_init_options opts = {}; opts.abi_version = SK_ABI_VERSION; opts.n_threads = 4; opts.module_dir = module_dir;
    assert(sk_init(&opts) == SK_OK);
    sk_device devs[16]; const int n = sk_devices(devs, 16);
    const sk_device *cpu = nullptr, *rec = nullptr;
    for (int i = 0; i < n; ++i) { if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i]; if (std::strcmp(devs[i].name, "SKREC0") == 0) rec = &devs[i]; }
    assert(cpu && rec);

    for (const Case &c : CASES) {
        const char *model = std::getenv(c.env);
        if (!model || !*model) { std::printf("SKIPPED: %s/%s (%s unset)\n", c.stage, c.family, c.env); continue; }
        const char *stage = nullptr, *family = nullptr, *text = nullptr; bool found = false;
        for (int b = 0; b < sk_ops_blob_count(); ++b) {
            sk_ops_blob_at(b, &stage, &family, &text);
            if (std::string(stage) == c.stage && std::string(family) == c.family) { found = true; break; }
        }
        if (!found) { std::printf("FAIL: %s/%s has a model but no shipped recording\n", c.stage, c.family); ++failures; continue; }
        sk_op_recording shipped; std::string err;
        assert(sk_ops_parse(text, shipped, err));
        const std::string tmp = std::string("/tmp/sk-live-") + c.stage + "-" + c.family + ".ops";
        const sk_device *dev = std::string(c.stage) == "tts" ? cpu : rec;
        int count = record_family(c.stage, c.family, model, dev, tmp, 1, supertonic);
        if (std::string(c.stage) == "translate") {
            const std::string tmp2 = tmp + ".off";
            record_family(c.stage, c.family, model, dev, tmp2, 2, supertonic);
            std::string a, b; read_file(tmp, a); read_file(tmp2, b);
            for (const auto &line : {b}) { std::istringstream ls(line); std::string l; while (std::getline(ls, l)) if (l.rfind("op=", 0) == 0) a += l + "\n"; }
            std::ofstream(tmp) << a;
        }
        if (count <= 0) { std::printf("FAIL %s/%s: recorded nothing\n", c.stage, c.family); ++failures; continue; }
        std::string live_text; read_file(tmp, live_text);
        sk_op_recording live; assert(sk_ops_parse(live_text, live, err));
        const auto a = spellings(shipped), bset = spellings(live);
        int before = failures;
        for (const auto &s : bset) if (!a.count(s)) { std::printf("FAIL %s/%s: engine now uses %s (not in shipped recording)\n", c.stage, c.family, s.c_str()); ++failures; }
        for (const auto &s : a) if (!bset.count(s)) { std::printf("FAIL %s/%s: shipped recording lists %s (engine no longer uses it)\n", c.stage, c.family, s.c_str()); ++failures; }
        if (shipped.dtypes_in_file != live.dtypes_in_file) { std::printf("FAIL %s/%s: dtypes-in-file changed (upstream re-quantised?)\n", c.stage, c.family); ++failures; }
        std::printf("%s/%s: %zu nodes, %s\n", c.stage, c.family, live.nodes.size(), failures == before ? "ok" : "DIFF");
    }
    return failures ? 1 : 0;
}
```

Register it (record variant only):

```cmake
if(SOKUJI_RECORD_OPS)
    add_executable(test_ops_coverage test_ops_coverage.cpp ../src/sk_ops_format.cpp)
    target_link_libraries(test_ops_coverage PRIVATE sokuji_native ggml)
    target_include_directories(test_ops_coverage PRIVATE ../src)
    add_test(NAME test_ops_coverage COMMAND test_ops_coverage ${CMAKE_BINARY_DIR}/lib)
    set_tests_properties(test_ops_coverage PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib" SKIP_RETURN_CODE 77)
endif()
```

- [ ] **Step 2: Run it against the recordings from Task 4**

Write the twelve variables into a runner script (`native/ci/ops-env.sh`, committed; the values are this box's cache):

```bash
#!/usr/bin/env bash
# The models test_ops_coverage re-records from (native/README.md's cache layout).
C=/home/jiangzhuo/.cache/sokuji-native-tests
export SK_TEST_ASR_GGUF=$C/whisper-tiny-Q8_0.gguf
export SK_TEST_ASR_STREAM_GGUF=$C/moonshine-streaming-tiny-Q8_0.gguf
export SK_TEST_TRANSLATE_GGUF=$C/Qwen3-0.6B-Q8_0.gguf
export SK_TEST_TTS_MOSS_DIR=$C/tts/moss-tts-nano
export SK_TEST_TTS_SUPERTONIC_DIR=$C/tts/supertonic-3
export SK_TEST_TTS_QWEN3_DIR=$C/tts/qwen3-tts-0.6b
export SK_TEST_TTS_OMNIVOICE_DIR=$C/tts/omnivoice-0.6b
export SK_TEST_TTS_POCKET_DIR=$C/tts/pocket-tts-en
export SK_TEST_TTS_VOXCPM1_DIR=$C/tts/voxcpm1-0.5b
export SK_TEST_TTS_VOXCPM2_DIR=$C/tts/voxcpm2
export SK_TEST_TTS_IRODORI_DIR=$C/tts/irodori-tts-v4-small
export SK_TEST_TTS_INDEX_DIR=$C/tts/index-tts2.5
exec "$@"
```

Run: `cd native && cmake --build build/record -j8 && bash ci/ops-env.sh ctest --test-dir build/record -R test_ops_coverage --output-on-failure 2>&1 | tail -15`
Expected: every present family prints `ok`; PASS. A `DIFF` right after recording means the recording is not deterministic across runs — the identity excludes sequence axes precisely so a sampled family (moss) with a different step count still yields the same set; investigate before committing.

- [ ] **Step 3: Wire the record build into `ci/build.sh` / `.ps1` and document the checklist**

After the shipping build's CTest in `native/ci/build.sh`, add a second configure+build of `build/record` with `-DSOKUJI_RECORD_OPS=ON` and `ctest -R test_ops_coverage`; it inherits the workflow's `SK_TEST_*` variables (`.github/workflows/native-build.yml:19-23` exports five of them: whisper-tiny, moonshine, Qwen3-0.6B, supertonic-3, moss), so CI asserts those five recordings on every lane and skips the rest. Same in `build.ps1`.

In `native/README.md`'s "Bumping a pin" list add:

```
5. Op recordings (`src/ops/*.ops`, spec A §3.2): configure `build/record` with
   `-DSOKUJI_RECORD_OPS=ON`, run `bash ci/ops-env.sh ctest --test-dir build/record -R test_ops_coverage`
   with every cached model present — a DIFF means the engine's graph changed; re-record that
   family with `build/record/lib/record_ops` (see tests/record_ops.cpp for the argument order)
   and commit the new .ops file with the bump. All nine TTS families are cached under
   ~/.cache/sokuji-native-tests/tts/ and MUST be re-recorded on every bump (the gate fires
   only for tts); asr/translate families are recorded as their models become available — a
   missing recording is a pass-through in the sidecar, never a gate.
```

- [ ] **Step 4: Commit**

```bash
git add native/tests/test_ops_coverage.cpp native/tests/CMakeLists.txt native/ci/ops-env.sh native/ci/build.sh native/ci/build.ps1 native/README.md
git commit -m "native: test_ops_coverage re-records every cached family and diffs against the shipped recordings; pin-bump checklist"
```

---

### Task 7: Catalog — `graph_family` on every card, a GGUF header reader, the rung fallback dtype sets, the three equality tests

**Files:**
- Create: `sidecar/sokuji_sidecar/gguf_header.py`, `sidecar/tests/test_gguf_header.py`
- Modify: `sidecar/sokuji_sidecar/catalog.py` (`_ModelBase`, `_tc_row` at :68, `_llm_translate_row` at :516, `_tts_gguf_row` at :989, every `_tc_row(...)`/`_llm_translate_row(...)` call, new `RUNG_FALLBACK_DTYPES`)
- Modify: `sidecar/tests/test_catalog.py`
- Test: `sidecar/tests/test_gguf_header.py`, `sidecar/tests/test_catalog.py`

**Interfaces:**
- Produces: `_ModelBase.graph_family: str`; `catalog.RUNG_FALLBACK_DTYPES: dict[str, frozenset[str]]` (ggml type names); `gguf_header.read_header(path) -> GgufHeader(architecture: str, tensor_types: frozenset[str], n_tensors: int)` (type names spelled as `ggml_type_name()` spells them: `q8_0`, `q4_K`, `bf16`, `f16`, `f32`, `i32`, `i64`); `gguf_header.GgufError`.

- [ ] **Step 1: Write the failing header-reader test**

Create `sidecar/tests/test_gguf_header.py`:

```python
"""A minimal GGUF v2/v3 header reader: architecture + the tensor dtype set. Tested on a file
written here (no model download) and, when present, on the cached whisper-tiny GGUF."""
import os
import struct

import pytest

from sokuji_sidecar import gguf_header

GGUF_MAGIC = b"GGUF"


def _write_gguf(path, arch: str, tensors: list[tuple[str, int]]):
    """tensors: (name, ggml_type id). Writes header + tensor infos, no data."""
    def s(x: str) -> bytes:
        b = x.encode()
        return struct.pack("<Q", len(b)) + b
    out = bytearray(GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", len(tensors)) + struct.pack("<Q", 2))
    out += s("general.architecture") + struct.pack("<I", 8) + s(arch)          # type 8 = string
    out += s("tokenizer.ggml.tokens") + struct.pack("<I", 9) + struct.pack("<I", 8) + struct.pack("<Q", 2) + s("a") + s("b")   # array of strings: must be skipped
    for name, ty in tensors:
        out += s(name) + struct.pack("<I", 2) + struct.pack("<QQ", 4, 4) + struct.pack("<I", ty) + struct.pack("<Q", 0)
    path.write_bytes(bytes(out))


def test_reads_architecture_and_dtype_set(tmp_path):
    p = tmp_path / "toy.gguf"
    _write_gguf(p, "qwen3", [("token_embd.weight", 8), ("blk.0.attn_q.weight", 12), ("blk.0.norm.weight", 0), ("output.weight", 30)])
    h = gguf_header.read_header(str(p))
    assert h.architecture == "qwen3"
    assert h.n_tensors == 4
    assert h.tensor_types == frozenset({"q8_0", "q4_K", "f32", "bf16"})   # ids 8, 12, 0, 30 as ggml names them


def test_rejects_non_gguf(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"NOPE" + b"\0" * 64)
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(p))


_WHISPER = os.path.expanduser("~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf")


@pytest.mark.skipif(not os.path.exists(_WHISPER), reason="cached model absent")
def test_real_whisper_tiny():
    h = gguf_header.read_header(_WHISPER)
    assert h.architecture == "whisper"
    assert "q8_0" in h.tensor_types and "f32" in h.tensor_types
```

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_gguf_header.py -q -p no:cacheprovider` — Expected: FAIL, `ModuleNotFoundError: gguf_header`.

- [ ] **Step 2: Write the reader**

Create `sidecar/sokuji_sidecar/gguf_header.py`:

```python
"""Minimal GGUF header reader (spec A §3.3): `general.architecture` and the set of tensor
dtypes, without loading anything. Header-only: reads a few hundred KiB at most (the tokenizer
KVs are skipped, not decoded). GGUF v2/v3 little-endian."""
from __future__ import annotations

import struct
from dataclasses import dataclass

# ggml_type ids -> ggml_type_name() spellings (ggml.h v0.22.0). Only what a reader may meet.
GGML_TYPE_NAMES = {
    0: "f32", 1: "f16", 2: "q4_0", 3: "q4_1", 6: "q5_0", 7: "q5_1", 8: "q8_0", 9: "q8_1",
    10: "q2_K", 11: "q3_K", 12: "q4_K", 13: "q5_K", 14: "q6_K", 15: "q8_K",
    16: "iq2_xxs", 17: "iq2_xs", 18: "iq3_xxs", 19: "iq1_s", 20: "iq4_nl", 21: "iq3_s", 22: "iq2_s",
    23: "iq4_xs", 24: "i8", 25: "i16", 26: "i32", 27: "i64", 28: "f64", 29: "iq1_m", 30: "bf16",
    34: "tq1_0", 35: "tq2_0", 39: "mxfp4",
}


class GgufError(ValueError):
    pass


@dataclass(frozen=True)
class GgufHeader:
    architecture: str
    tensor_types: frozenset[str]
    n_tensors: int


_KV_SIZES = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}   # fixed-size KV value types


class _R:
    def __init__(self, f):
        self.f = f

    def u32(self):
        return struct.unpack("<I", self.f.read(4))[0]

    def u64(self):
        return struct.unpack("<Q", self.f.read(8))[0]

    def s(self):
        n = self.u64()
        return self.f.read(n).decode("utf-8", "replace")

    def skip_value(self, ty: int):
        if ty == 8:
            self.s()
            return
        if ty == 9:                                    # array: elem type, count, then elems
            et, n = self.u32(), self.u64()
            if et in _KV_SIZES:
                self.f.seek(_KV_SIZES[et] * n, 1)
            else:
                for _ in range(n):
                    self.skip_value(et)
            return
        if ty in _KV_SIZES:
            self.f.seek(_KV_SIZES[ty], 1)
            return
        raise GgufError(f"unknown KV value type {ty}")


def read_header(path: str) -> GgufHeader:
    with open(path, "rb") as f:
        if f.read(4) != b"GGUF":
            raise GgufError(f"{path}: not a GGUF file")
        r = _R(f)
        version = r.u32()
        if version not in (2, 3):
            raise GgufError(f"{path}: unsupported GGUF version {version}")
        n_tensors, n_kv = r.u64(), r.u64()
        arch = ""
        for _ in range(n_kv):
            key = r.s()
            ty = r.u32()
            if key == "general.architecture" and ty == 8:
                arch = r.s()
            else:
                r.skip_value(ty)
        types = set()
        for _ in range(n_tensors):
            r.s()                                      # name
            nd = r.u32()
            for _ in range(nd):
                r.u64()                                # dims
            types.add(GGML_TYPE_NAMES.get(r.u32(), "unknown"))
            r.u64()                                    # offset
        return GgufHeader(arch, frozenset(types), n_tensors)
```

Run the test again — Expected: PASS (3 tests, the real-file one skipped or passing).

- [ ] **Step 3: Write the failing catalog tests**

Add to `sidecar/tests/test_catalog.py` (it already imports `pytest` and `catalog`; add `import os`, `import glob` and `import pathlib`):

```python
_CACHE = os.path.expanduser("~/.cache/sokuji-native-tests")
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_every_card_has_a_graph_family():
    for m in catalog.asr_models() + catalog.translate_models() + catalog.tts_models():
        assert m.graph_family, m.id


def test_translate_prompt_family_unchanged_by_graph_family():
    fams = {m.id: m.prompt_family for m in catalog.translate_models()}
    assert fams["qwen3.5-4b"] == "qwen" and fams["eurollm-1.7b"] == "qwen" and fams["hy-mt2-7b"] == "hunyuan"
    graph = {m.id: m.graph_family for m in catalog.translate_models()}
    assert graph["eurollm-1.7b"] == "llama" and graph["qwen3-0.6b"] == "qwen3" and graph["translategemma-4b"] == "gemma3"
    assert graph["qwen3.5-4b"] != "qwen"                      # a llama.cpp architecture, never the prompt family


def test_tts_graph_family_is_the_audiocpp_family():
    for m in catalog.tts_models():
        assert m.graph_family == m.family


def test_every_tts_family_has_an_op_recording():
    """Spec A §3.3: the tts gate has teeth only where a recording exists; every shipped TTS
    card must have one (native/src/ops/tts-<family>.ops)."""
    for m in catalog.tts_models():
        assert (_REPO_ROOT / "native" / "src" / "ops" / f"tts-{m.graph_family}.ops").is_file(), m.id


@pytest.mark.skipif(not os.path.exists(f"{_CACHE}/Qwen3-0.6B-Q8_0.gguf"), reason="cached model absent")
def test_translate_graph_family_matches_gguf_header():
    from sokuji_sidecar import gguf_header
    assert gguf_header.read_header(f"{_CACHE}/Qwen3-0.6B-Q8_0.gguf").architecture == catalog.translate_model("qwen3-0.6b").graph_family


@pytest.mark.parametrize("gguf,card_id", [("whisper-tiny-Q8_0.gguf", "whisper-tiny"),
                                          ("moonshine-streaming-tiny-Q8_0.gguf", "moonshine-streaming-tiny")])
def test_asr_graph_family_matches_native_arch(gguf, card_id):
    """sk_asr_caps.arch for the cached file equals the card's graph_family — the string the
    recording is keyed by. Needs the wheel and the cached model."""
    path = f"{_CACHE}/{gguf}"
    if not os.path.exists(path):
        pytest.skip("cached model absent")
    sokuji_native = pytest.importorskip("sokuji_native")
    from sokuji_sidecar import native
    sokuji_native.init()
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    m = sokuji_native.asr_load(path, cpu)
    try:
        assert m.capabilities.arch == catalog.asr_model(card_id).graph_family
    finally:
        m.unload()


def test_rung_fallback_sets_cover_cached_ggufs():
    """Premise 7: a rung is a dtype SET. Every cached GGUF's header set must be within its
    rung's fallback set, or the pre-download answer would refuse a file it later accepts."""
    from sokuji_sidecar import gguf_header
    if not os.path.isdir(_CACHE):
        pytest.skip("no cached models")
    checked = 0
    for path in glob.glob(f"{_CACHE}/**/*.gguf", recursive=True):
        name = os.path.basename(path).lower().replace("-", "_")
        rung = next((r for r in ("q4_k_m", "q5_k_m", "q6_k", "q8_0", "bf16", "f16") if r in name), None)
        if rung is None:
            continue
        h = gguf_header.read_header(path)
        assert h.tensor_types <= catalog.RUNG_FALLBACK_DTYPES[rung], (path, sorted(h.tensor_types - catalog.RUNG_FALLBACK_DTYPES[rung]))
        checked += 1
    assert checked > 0
```

(`sokuji_native.asr_load(path, device)`, `AsrModel.capabilities.arch` and `AsrModel.unload()` are the binding's existing names — `native/python/sokuji_native/__init__.py:199-204, 317-335`.)

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_catalog.py -k "graph_family or fallback or recording" -q -p no:cacheprovider` — Expected: FAIL, `AttributeError: graph_family`.

- [ ] **Step 4: Add the field, the parameters and the table**

In `sidecar/sokuji_sidecar/catalog.py`, `_ModelBase` gains (after `download_ignore`):

```python
    # The GRAPH this card runs — the key of its op recording (spec A §3.2): transcribe.cpp's
    # architecture for ASR (what sk_asr_caps.arch reports), llama.cpp's general.architecture
    # for translate, audio.cpp's family for TTS. Not a prompt strategy (that is
    # TranslateModel.prompt_family).
    graph_family: str = ""
```

`_tc_row` gains a keyword `arch=""` and passes `graph_family=arch` to `AsrModel(...)`; `_llm_translate_row` gains `arch=""` and passes `graph_family=arch`; `_tts_gguf_row` passes `graph_family=family`. Then every call site gets its value:

- translate — llama.cpp's `general.architecture` string: `qwen2.5-0.5b → arch="qwen2"`, `qwen3-0.6b → "qwen3"`, `qwen3.5-0.8b/2b/4b → "qwen35"`, `translategemma-4b → "gemma3"`, `eurollm-1.7b → "llama"`, `hy-mt2-1.8b/7b, hy-mt15-1.8b/7b → "hunyuan-dense"`. Only Qwen3-0.6B is cached, so only that one is pinned by a test; for the others confirm against the pinned llama.cpp source once `build/cpu` is configured: `grep -n '"qwen35"\|"gemma3"\|"hunyuan-dense"\|"hunyuan"' native/build/cpu/_deps/llama-src/src/llama-arch.cpp` — use the spelling that file has (the spec's §3.2.1 wrote `hunyuan`; the arch table decides, and the recording file, when one is made, is named after it).
- ASR — the transcribe.cpp architecture, i.e. the `src/arch/<name>` directory in the pinned transcribe.cpp source (`ls native/build/cpu/_deps/transcribe-src/src/arch/`; at the 0.2.3 pin the names are `canary canary_qwen cohere funasr_nano gigaam granite granite_nar medasr moonshine moonshine_streaming moss parakeet qwen3_asr sensevoice voxtral voxtral_realtime whisper`). Map by card id:
  - `whisper-*` and `breeze-asr-25` → `whisper`
  - `moonshine-tiny`, `moonshine-base`, `moonshine-base-*` → `moonshine`; `moonshine-streaming-*` → `moonshine_streaming`
  - `parakeet-*` and `multitalker-parakeet-streaming-0.6b-v1` → `parakeet`
  - `canary-180m-flash`, `canary-1b-flash`, `canary-1b-v2` → `canary`; `canary-qwen-2.5b` → `canary_qwen`
  - `gigaam-*` → `gigaam`
  - `granite-speech-4.1-2b`, `granite-speech-4.1-2b-plus`, `granite-4.0-1b-speech` → `granite`; `granite-speech-4.1-2b-nar` → `granite_nar`
  - `sense-voice` → `sensevoice`; `cohere-transcribe-03-2026` → `cohere`; `moss-transcribe-diarize` → `moss`; `qwen3-asr-*` → `qwen3_asr`
  - `voxtral-mini-3b`, `voxtral-small-24b` → `voxtral`; `voxtral-mini-4b-realtime` → `voxtral_realtime`
  - `fun-asr-nano`, `fun-asr-mlt-nano` → `funasr_nano`
  - `nemotron-3.5-asr-streaming`, `nemotron-speech-streaming-en` → there is no `nemotron` directory; find which arch transcribe.cpp registers those repos under with `grep -rn -i "nemotron" native/build/cpu/_deps/transcribe-src/src --include=*.cpp --include=*.h | head` and use that directory's name (expected: `parakeet`, the cache-aware FastConformer family). `arch=""` is not acceptable — `test_every_card_has_a_graph_family` refuses it.

  Where the directory listing spells a name differently from the list above, the directory wins — that is the string `sk_asr_caps.arch` reports, which `test_asr_graph_family_matches_native_arch` pins for the cached whisper and moonshine-streaming files.

Add near `_tc_row`:

```python
# Premise 7 (spec A): a rung is not one dtype. The dtype set a pre-download query expands
# WEIGHT over, when the file is not on disk yet; deliberately wide (a *_M file mixes K-quants,
# the q8_0 TTS files carry BF16 weights, everything carries F32). Once the file exists its
# header's real set replaces this (accel.weight_dtypes). Spellings are ggml_type_name()'s.
# gen_ops_data.py's WIDEST_FALLBACK is len() of the q4_k_m set — keep them in step.
RUNG_FALLBACK_DTYPES: dict[str, frozenset[str]] = {
    "q4_k_m": frozenset({"q4_K", "q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q5_k_m": frozenset({"q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q6_k":   frozenset({"q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q8_0":   frozenset({"q8_0", "bf16", "f16", "f32"}),
    "f16":    frozenset({"f16", "f32"}),
    "bf16":   frozenset({"bf16", "f16", "f32"}),
}
```

If `test_rung_fallback_sets_cover_cached_ggufs` reports a cached file with `i32`/`i64` (omnivoice, index, voxcpm2 carry index tensors), add those names to every set — they are never weights a backend refuses, and the test is the authority. If it then reports a larger K-quant in a smaller rung's file, widen that rung's set the same way and bump `WIDEST_FALLBACK` in `native/cmake/gen_ops_data.py` if `q4_k_m` grew.

- [ ] **Step 5: Run the catalog tests**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_catalog.py -q -p no:cacheprovider 2>&1 | tail -2`
Expected: all pass (the existing card-shape tests are unaffected: `graph_family` is keyword-only with a default; `test_every_tts_family_has_an_op_recording` passes because Task 4 committed the nine files).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/gguf_header.py sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_gguf_header.py sidecar/tests/test_catalog.py
git commit -m "catalog: graph_family on every card (pinned to sk_asr_caps.arch and the GGUF header), a header-only GGUF reader, the per-rung fallback dtype sets"
```

---

### Task 8: `DeviceProfile` and `generation` on `Machine`; the two new detectors; `native.py` wrappers; the shared test fixture

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`Machine`, new dataclasses, detectors, `probe()` at :142), `sidecar/sokuji_sidecar/native.py`
- Modify: `sidecar/tests/test_accel.py` (`_FakeDev` :917, `_fake_native_module` :929, an autouse fixture, new tests; `import dataclasses`)
- Create: `sidecar/tests/_fixtures.py` (`_known_gpu_machine`, imported by `test_accel.py` and `test_planner.py`; `tests/` has no `__init__.py`, so pytest's default prepend import mode puts `tests/` on `sys.path` and `from _fixtures import ...` resolves)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: Task 2/5's binding (`sokuji_native.device_profiles()`, `device_supports_ops()`).
- Produces:
  ```python
  @dataclass(frozen=True) class DeviceProfile: index, kind, name, description, mem_total, known, features: frozenset, driver_name, driver_version, device_uuid, cpu_features
  @dataclass(frozen=True) class OpCoverage: all_supported: bool; unsupported: tuple
  Machine.devices: tuple = ();  Machine.generation: str = ""
  accel._native_profiles() -> tuple;  accel._native_identity() -> tuple[str, dict] | None
  accel.compute_generation(identity, devices) -> str          # pure; used by probe()
  native.device_profiles() -> list;  native.device_supports_ops(index, stage, family, dtypes)
  tests/_fixtures.py: _known_gpu_machine(kind="vulkan") -> Machine   # two known devices, generation "G1"
  ```

- [ ] **Step 1: Write the failing tests**

Create `sidecar/tests/_fixtures.py`:

```python
"""Machines with a known device profile (spec A). Shared by test_accel.py and test_planner.py."""
from sokuji_sidecar import accel


def _known_gpu_machine(kind="vulkan"):
    dev = accel.DeviceProfile(0, kind, f"{kind}0", "GB10", 96 << 30, True, frozenset(), "NVIDIA", "580", "ab" * 16, "")
    cpu = accel.DeviceProfile(1, "cpu", "CPU", "CPU", 120 << 30, True, frozenset(), "", "", "", "NEON=1")
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                         installed=frozenset({"native_tts", "native_translate", "native_asr"}), fingerprint="fp",
                         tc_kinds=(kind, "cpu"), gpus=((kind, "GB10", 96 << 30),), devices=(dev, cpu), generation="G1")
```

In `sidecar/tests/test_accel.py` add `import dataclasses` and `from _fixtures import _known_gpu_machine` to the imports, then replace `_FakeDev` and `_fake_native_module` (lines 917-942) with:

```python
class _FakeDev:
    def __init__(self, index, kind, desc, total, free, *, known=True, features=(), driver_name="", driver_version="", device_uuid="", cpu_features=""):
        self.index, self.kind, self.name = index, kind, f"{kind}{index}"
        self.description, self.mem_total, self.mem_free = desc, total, free
        self.known, self.features = known, frozenset(features)
        self.driver_name, self.driver_version, self.device_uuid, self.cpu_features = driver_name, driver_version, device_uuid, cpu_features


_DEFAULT_FAKE_ENGINE_VERSIONS = {
    "ggml": "0.22.0", "transcribe": "0.2.3", "llama": "0.3.0",
    "audiocpp": "0.7.1", "lane": "cpu-vulkan",
}


def _fake_native_module(monkeypatch, devs, *, version="1.0.2", engine_versions=None, profiles=True, supports=None):
    """`profiles=False` mimics a 1.0.x wheel (no device_profiles / device_supports_ops at all).
    `supports(index, stage, family, dtypes)` returns an object with .all_supported/.unsupported/.checked."""
    import sys, types
    from sokuji_sidecar import native
    mod = types.ModuleType("sokuji_native")
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: list(devs)
    mod.device_free_mem = lambda i: next(d.mem_free for d in devs if d.index == i)
    mod.version = lambda: version
    mod.engine_versions = lambda: dict(engine_versions or _DEFAULT_FAKE_ENGINE_VERSIONS)
    if profiles:
        mod.device_profiles = lambda: list(devs)          # _FakeDev carries the profile fields too
        mod.device_supports_ops = supports or (lambda i, s, f, dts: types.SimpleNamespace(all_supported=True, unsupported=(), checked=("NORM[f32,-,-,-,-]->f32",)))
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return mod
```

(If the existing `version="1.0.1"` / `"0.2.2"` / `"0.7.0"` defaults are asserted by name anywhere in the file, keep those tests' expectations by passing the old values explicitly at those call sites.)

Add one module-level autouse fixture right after `_fake_native_module`:

```python
@pytest.fixture(autouse=True)
def _isolate_profiles(monkeypatch):
    """The two spec-A detectors default to 'nothing' for every test in this module, so the
    pre-existing probe(force=True) tests keep their machines. A test that wants the real
    detectors calls monkeypatch.undo() first — the same MonkeyPatch instance serves the
    fixture and the test, so undo() drops exactly these two patches."""
    monkeypatch.setattr(accel, "_native_profiles", lambda: ())
    monkeypatch.setattr(accel, "_native_identity", lambda: None)
```

and the new tests:

```python
def test_probe_fills_devices_and_generation(monkeypatch):
    monkeypatch.undo()   # real detectors over the fake module
    _fake_native_module(monkeypatch, [
        _FakeDev(0, "vulkan", "NVIDIA GB10", 96 << 30, 90 << 30, features={"vk_integer_dot", "vk_coopmat"},
                 driver_name="NVIDIA", driver_version="580.65.06", device_uuid="ab" * 16),
        _FakeDev(1, "cpu", "CPU", 120 << 30, 100 << 30, cpu_features="NEON=1,DOTPROD=1"),
    ], version="1.1.0")
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_tts"}))
    m = accel.probe(force=True)
    assert [d.kind for d in m.devices] == ["vulkan", "cpu"]
    assert m.devices[0].known and "vk_coopmat" in m.devices[0].features and m.devices[0].device_uuid == "ab" * 16
    assert m.devices[1].cpu_features.startswith("NEON=1")
    assert m.generation and len(m.generation) == 12
    assert m.gpus == (("vulkan", "NVIDIA GB10", 96 << 30),)     # derived tuple unchanged


def test_generation_moves_with_version_pin_driver_and_env_but_not_free_memory(monkeypatch):
    monkeypatch.undo()
    def gen(version="1.1.0", pins=None, driver="580", free=90 << 30, env=None):
        for k in list(os.environ):
            if k.startswith("GGML_"):
                monkeypatch.delenv(k)
        for k, v in (env or {}).items():
            monkeypatch.setenv(k, v)
        _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "GB10", 96 << 30, free, driver_name="NVIDIA", driver_version=driver, device_uuid="ab" * 16)],
                            version=version, engine_versions=pins)
        monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
        monkeypatch.setattr(accel, "_installed", lambda: frozenset())
        return accel.probe(force=True).generation
    base = gen()
    assert gen() == base
    assert gen(free=1 << 30) == base
    assert gen(version="1.1.1") != base
    assert gen(pins={**_DEFAULT_FAKE_ENGINE_VERSIONS, "audiocpp": "0.7.2"}) != base
    assert gen(driver="581") != base
    assert gen(env={"GGML_VK_DISABLE_COOPMAT": "1"}) != base
    assert gen(env={"GGML_METAL_BF16_DISABLE": "1"}) != base


def test_probe_degrades_per_detector(monkeypatch):
    monkeypatch.undo()
    _fake_native_module(monkeypatch, [_FakeDev(0, "cpu", "CPU", 8 << 30, 7 << 30)], version="1.1.0")
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset())
    def boom():
        raise RuntimeError("no")
    monkeypatch.setattr(accel, "_native_profiles", boom)
    m = accel.probe(force=True)
    assert m.devices == () and m.generation != ""            # profiles failed, identity still keyed
    monkeypatch.setattr(accel, "_native_identity", boom)
    m = accel.probe(force=True)
    assert m.generation == ""


def test_old_wheel_without_profiles_degrades_to_todays_plans(monkeypatch):
    """Spec A §4: a 1.0.x wheel (no device_profiles / device_supports_ops) yields devices=(),
    a version-keyed generation, and EXACTLY the plans a profile-less machine gets."""
    monkeypatch.undo()
    _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "GB10", 96 << 30, 90 << 30)], version="1.0.2", profiles=False)
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_tts"}))
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    monkeypatch.setattr(accel, "bench_load", lambda: {})
    m = accel.probe(force=True)
    assert m.devices == () and m.generation != ""
    bare = dataclasses.replace(m, devices=(), generation="")
    assert accel.resolve_tts("voxcpm2", machine=m) == accel.resolve_tts("voxcpm2", machine=bare)
```

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -k "generation or profiles or old_wheel or degrades_per" -q -p no:cacheprovider` — Expected: FAIL (`_native_profiles` missing; `Machine` has no `devices`; `_fixtures` imports `accel.DeviceProfile`).

- [ ] **Step 2: Implement**

In `sidecar/sokuji_sidecar/native.py` add:

```python
def device_profiles() -> list:
    """sokuji_native.device_profiles(); AttributeError on a wheel older than ABI 2 (the caller,
    accel.probe, degrades through _safe)."""
    return list(module().device_profiles())


def device_supports_ops(index: int, stage: str, family: str, weight_dtypes):
    return module().device_supports_ops(index, stage, family, list(weight_dtypes))
```

In `sidecar/sokuji_sidecar/accel.py`, before `class Machine`:

```python
@dataclass(frozen=True)
class DeviceProfile:
    """One sk_device_profile (spec A §3.1) as the planner reads it. `known=False` means every
    consumer passes through (premise 5)."""
    index: int
    kind: str
    name: str
    description: str
    mem_total: int
    known: bool
    features: frozenset
    driver_name: str
    driver_version: str
    device_uuid: str
    cpu_features: str


@dataclass(frozen=True)
class OpCoverage:
    all_supported: bool
    unsupported: tuple
```

and two fields at the end of `Machine`:

```python
    # Spec A: structured per-device profiles, () when the wheel is absent or predates
    # sk_device_profile_get; and the CACHE GENERATION — every bench key is prefixed with
    # it, so a native/engine/driver change invalidates measured numbers. "" only when the
    # identity detector failed (wheel absent).
    devices: tuple = ()
    generation: str = ""
```

Two detectors beside `_native_gpus` (:69):

```python
def _native_profiles() -> tuple:
    from . import native
    return tuple(DeviceProfile(p.index, p.kind, p.name, p.description, int(p.mem_total), bool(p.known),
                               frozenset(p.features), p.driver_name, p.driver_version, p.device_uuid, p.cpu_features)
                 for p in native.device_profiles())


def _native_identity():
    """(sk_version, engine_versions) or a raise (the wheel is absent)."""
    from . import native
    mod = native.module()
    return mod.version(), dict(mod.engine_versions())


def compute_generation(identity, devices: tuple) -> str:
    """Pure. blake2s over sk_version | engine pins | per-device driver identity | GGML_* env
    (spec A §3.3). `devices=()` hashes as an empty list, so a wheel without profiles still
    gets a version-keyed generation."""
    if identity is None:
        return ""
    version, pins = identity
    dev_part = [(d.kind, d.device_uuid, d.driver_name, d.driver_version) for d in sorted(devices, key=lambda d: d.index)]
    env_part = sorted((k, v) for k, v in os.environ.items() if k.startswith("GGML_"))
    src = f"{version}|{sorted(pins.items())}|{dev_part}|{env_part}"
    return hashlib.blake2s(src.encode(), digest_size=6).hexdigest()
```

and in `probe()`:

```python
    devices = _safe(_native_profiles, ())
    identity = _safe(_native_identity, None)
    ...
    _MACHINE = Machine(
        os=platform.system(), arch=platform.machine(), cpu_cores=os.cpu_count() or 1,
        apple_silicon=apple, installed=installed,
        fingerprint=fp, tc_kinds=tc_kinds, gpus=tc_gpus,
        devices=devices, generation=compute_generation(identity, devices))
```

(`_safe(fn, default)` is `probe()`'s existing per-detector guard; if it is spelled differently in the file, use that name.)

- [ ] **Step 3: Run the accel suite**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -q -p no:cacheprovider 2>&1 | tail -2`
Expected: all pass, including every pre-existing `probe(force=True)` test (the autouse fixture defaults the new detectors to nothing).

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/native.py sidecar/tests/test_accel.py sidecar/tests/_fixtures.py
git commit -m "accel: DeviceProfile and generation on Machine; _native_profiles/_native_identity detectors; native.py wrappers; shared known-GPU fixture"
```

---

### Task 9: Cache generations — `_cache_key` on both sides, `bench_read`, `bench_save` with rotation and atomic write

**Files:**
- Modify: `sidecar/sokuji_sidecar/planner.py` (`_cache_key` after `_bench_key` :183; `_resolve_model` :187 and `resolve_translate._tps` :353 read side), `sidecar/sokuji_sidecar/accel.py` (`_measure` :511, `bench_load` :490, `bench_save` :500)
- Modify: `sidecar/tests/test_planner.py` (`import dataclasses`; the four cache-building sites at :393-396, :405-408, :509-514, :846-849), `sidecar/tests/test_accel.py`
- Test: both files

**Interfaces:**
- Produces: `planner._cache_key(machine, ns, model_id, backend, device, compute_type) -> str`; `accel.bench_read() -> tuple[dict, list[str]]`; `accel.bench_save(entries: dict, *, generation: str) -> None`. `bench_load() -> dict` unchanged (entries only, `_generations` stripped).

- [ ] **Step 1: Write the failing tests**

`sidecar/tests/test_accel.py`:

```python
def test_bench_save_rotates_generations_and_drops_legacy_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    (tmp_path / "accel-bench.json").write_text('{"fp|whisper-base|native_asr|cpu|q8_0": 0.5}')   # legacy flat file
    entries, gens = accel.bench_read()
    assert entries == {"fp|whisper-base|native_asr|cpu|q8_0": 0.5} and gens == []
    accel.bench_save({**entries, "G1|fp|m|b|d|c": 1.0}, generation="G1")
    entries, gens = accel.bench_read()
    assert gens == ["G1"] and entries == {"G1|fp|m|b|d|c": 1.0}          # legacy key gone
    for g in ("G2", "G3", "G4"):
        accel.bench_save({**accel.bench_read()[0], f"{g}|fp|m|b|d|c": 1.0}, generation=g)
    entries, gens = accel.bench_read()
    assert gens == ["G2", "G3", "G4"]
    assert set(entries) == {"G2|fp|m|b|d|c", "G3|fp|m|b|d|c", "G4|fp|m|b|d|c"}
    assert accel.bench_load() == entries                                 # dict shape, no _generations key


def test_bench_save_is_atomic(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    accel.bench_save({"G1|k": 1.0}, generation="G1")
    def broken_dump(*a, **k):
        raise OSError("disk full")
    with monkeypatch.context() as mp:                      # scope ONLY the json.dump patch; the env stays
        mp.setattr(accel.json, "dump", broken_dump)
        accel.bench_save({"G1|k": 2.0}, generation="G1")   # never raises
    assert accel.bench_read()[0] == {"G1|k": 1.0}          # the old file survived intact
    assert not (tmp_path / "accel-bench.json.tmp").exists()


def test_measure_keys_by_generation(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m1 = accel.Machine(os="Linux", arch="x86_64", cpu_cores=4, apple_silicon=False, installed=frozenset(), fingerprint="fp", generation="G1")
    m2 = dataclasses.replace(m1, generation="G2")
    plan = accel.Plan("native_asr", "cpu", "cpu", "q8_0", "r/f.gguf", 2.0, None)
    calls = []
    def run(backend):
        calls.append(1)
        return 0.42
    assert accel._measure(None, plan, "whisper-base", m1, ns="", run=run) == 0.42
    assert accel._measure(None, plan, "whisper-base", m1, ns="", run=run) == 0.42 and len(calls) == 1   # hit
    assert accel._measure(None, plan, "whisper-base", m2, ns="", run=run) == 0.42 and len(calls) == 2   # miss across generations
    assert accel.planner._cache_key(m1, "", "whisper-base", "native_asr", "cpu", "q8_0") in accel.bench_load()
```

(`accel.Plan` and `_measure`'s `run=` seam are the existing names at `accel.py:511`; if `Plan` is only importable from `planner`, use `accel.planner.Plan`.)

`sidecar/tests/test_planner.py` — add `import dataclasses`; update the four cache-building sites from `planner._bench_key(m.fingerprint, ...)` to `planner._cache_key(m, "", ...)` (:393-396, :405-408, :509-514) and from `"tps:" + planner._bench_key(m.fingerprint, ...)` to `planner._cache_key(m, "tps:", ...)` (:846-849) — those machines have `generation=""`, so the keys read `|fp|...` and the tests keep passing; then add:

```python
def test_bench_entries_are_read_only_within_their_generation():
    m = dataclasses.replace(_nv_machine(24576), generation="G1")
    key = planner._cache_key(m, "", "whisper-base", "native_asr", "vulkan", "q8_0")
    cpu_key = planner._cache_key(m, "", "whisper-base", "native_asr", "cpu", "q8_0")
    cache = {key: 0.8, cpu_key: 0.3}                                 # GPU slower than CPU → demoted
    plans = planner.resolve("whisper-base", machine=m, platform="linux", cache=cache, downloaded=set())
    assert plans[0].device == "cpu"
    m2 = dataclasses.replace(m, generation="G2")
    plans = planner.resolve("whisper-base", machine=m2, platform="linux", cache=cache, downloaded=set())
    assert plans[0].device == "vulkan"                               # G1 numbers are invisible under G2


def test_translate_tps_entries_are_read_only_within_their_generation():
    m = dataclasses.replace(_nv_machine(12282, installed=frozenset({"native_translate"})), generation="G1")
    cache = {
        planner._cache_key(m, "tps:", "translategemma-4b", "native_translate", "vulkan", "q8_0"): 5.0,
        planner._cache_key(m, "tps:", "translategemma-4b", "native_translate", "cpu", "q8_0"): 12.0,
    }
    kw = dict(platform="linux", cache=cache, downloaded=set(), est_bytes=lambda d: d.est_bytes, format_ready=lambda ct: True)
    assert planner.resolve_translate("translategemma-4b", "auto", machine=m, **kw)[0].device == "cpu"          # E6 swap under G1
    m2 = dataclasses.replace(m, generation="G2")
    assert planner.resolve_translate("translategemma-4b", "auto", machine=m2, **kw)[0].device == "vulkan"     # invisible under G2
```

Run both files — Expected: FAIL (`bench_read`, `_cache_key`, `generation=` kwargs missing).

- [ ] **Step 2: Implement**

`planner.py`, after `_bench_key`:

```python
def _cache_key(machine: Machine, ns: str, model_id: str, backend: str, device: str, compute_type: str) -> str:
    """Every bench entry, read AND written: the generation identifies the software that
    produced the number, the fingerprint inside _bench_key identifies the hardware."""
    return f"{machine.generation}|{ns}{_bench_key(machine.fingerprint, model_id, backend, device, compute_type)}"
```

In `_resolve_model` replace `key = _bench_key(machine.fingerprint, model_id, d.backend, device, d.compute_type)` with `key = _cache_key(machine, "", model_id, d.backend, device, d.compute_type)`; in `resolve_translate._tps` replace `cache.get("tps:" + _bench_key(machine.fingerprint, model_id, p.backend, p.device, p.compute_type))` with `cache.get(_cache_key(machine, "tps:", model_id, p.backend, p.device, p.compute_type))`.

`accel.py`: import `_cache_key` in the `from .planner import (...)` block; `_measure`'s key line becomes `key = _cache_key(machine, ns, model_id, plan.backend, plan.device, plan.compute_type)` and its save becomes `bench_save(cache, generation=machine.generation)`. Replace `bench_load`/`bench_save` with:

```python
_GENERATIONS_KEY = "_generations"
_KEEP_GENERATIONS = 3


def bench_read() -> tuple:
    """(entries, generations). Missing/corrupt file → ({}, []). A legacy flat file (no
    _generations) reads as generation-less: its keys can never match a prefixed read."""
    try:
        with open(_bench_cache_path()) as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}, []
        gens = data.pop(_GENERATIONS_KEY, [])
        return data, list(gens) if isinstance(gens, list) else []
    except Exception:
        return {}, []


def bench_load() -> dict:
    """Best-effort read of the bench cache — entries only (the planner receives this)."""
    return bench_read()[0]


def bench_save(entries: dict, *, generation: str) -> None:
    """Best-effort write. Rotates the generation list (last 3 kept), keeps a key iff its first
    `|` segment is in the post-rotation list (legacy and rotated-out keys are dropped), and
    writes through a temp file + os.replace so a crash never leaves a torn file. Never raises."""
    path = _bench_cache_path()
    tmp = path + ".tmp"
    try:
        _old, gens = bench_read()
        if generation and generation not in gens:
            gens.append(generation)
        gens = gens[-_KEEP_GENERATIONS:]
        keep = set(gens)
        kept = {k: v for k, v in entries.items() if k.split("|", 1)[0] in keep}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w") as f:
            json.dump({_GENERATIONS_KEY: gens, **kept}, f)
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except Exception:
            pass
```

- [ ] **Step 3: Run both suites**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py tests/test_planner.py tests/test_characterization.py -q -p no:cacheprovider 2>&1 | tail -2`
Expected: all pass; the characterisation matrices are untouched (its `bench_load` pin returns `{}`, a dict, as before).

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/planner.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py sidecar/tests/test_planner.py
git commit -m "accel/planner: bench keys carry the cache generation on both sides; bench_save rotates three generations and writes atomically"
```

---

### Task 10: Op coverage in accel — `weight_dtypes`, the dtype-keyed `_ops_key`, `compute_op_coverage`, `op_coverage_for`, `cached_op_coverage`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (imports; new functions after `_downloaded_quants`), `sidecar/sokuji_sidecar/planner.py` (`_STAGE_OF_BACKEND`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: Task 7's `RUNG_FALLBACK_DTYPES`, `gguf_header.read_header`; Task 8's `OpCoverage`, `native.device_supports_ops`; Task 9's `bench_load`/`bench_save`.
- Produces:
  ```python
  accel.weight_dtypes(model, compute_type) -> tuple[str, ...]                       # sorted
  accel._ops_key(machine, index, stage, family, compute_type, weight_dtypes) -> str  # gen|ops:idx:stage:family:ct:dt1+dt2+...
  accel.compute_op_coverage(machine, device_index, stage, family, compute_type, weight_dtypes) -> OpCoverage | None
  accel.op_coverage_for(machine, model, override) -> Callable[[int, str, str, str], OpCoverage | None]   # precomputed dict .get
  accel.cached_op_coverage(machine, models) -> Callable[[int, str, str, str], OpCoverage | None]        # read-only, over the given cards
  planner._STAGE_OF_BACKEND: dict[str, str]
  ```
  The callable signature is `(device_index, stage, family, compute_type)` everywhere; the dtype set is folded into the key by these two factories and never crosses into the planner.

- [ ] **Step 1: Write the failing tests**

```python
def test_weight_dtypes_prefers_the_file_header_over_the_fallback(monkeypatch, tmp_path):
    card = catalog.tts_model("voxcpm2")
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: None)                 # not on disk
    assert set(accel.weight_dtypes(card, "q8_0")) == catalog.RUNG_FALLBACK_DTYPES["q8_0"]
    hdr = accel.gguf_header.GgufHeader("voxcpm2", frozenset({"q8_0", "bf16", "f32"}), 3)
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: str(tmp_path / "x.gguf"))
    monkeypatch.setattr(accel.gguf_header, "read_header", lambda p: hdr)
    assert accel.weight_dtypes(card, "q8_0") == ("bf16", "f32", "q8_0")                   # sorted


def test_ops_key_carries_the_dtype_set():
    m = _known_gpu_machine()
    a = accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0", "bf16", "f32"))
    b = accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0", "bf16", "f16", "f32"))
    assert a == "G1|ops:0:tts:voxcpm2:q8_0:bf16+f32+q8_0" and a != b                   # pre- and post-download differ


def test_compute_op_coverage_caches_ok_and_not_errors(monkeypatch, tmp_path):
    import types
    from sokuji_sidecar import native
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _known_gpu_machine()
    calls = []
    def supports(i, s, f, dts):
        calls.append((i, s, f, tuple(dts)))
        return types.SimpleNamespace(all_supported=False, unsupported=("NORM[f32,-,-,-,-]->f32",), checked=("NORM[f32,-,-,-,-]->f32",))
    monkeypatch.setattr(native, "device_supports_ops", supports)
    cov = accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("f32", "q8_0"))
    assert cov == accel.OpCoverage(False, ("NORM[f32,-,-,-,-]->f32",))
    assert accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("f32", "q8_0")) == cov and len(calls) == 1
    key = accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0", ("f32", "q8_0"))
    assert accel.bench_load()[key] == {"allSupported": False, "unsupported": ["NORM[f32,-,-,-,-]->f32"]}
    # a different dtype set is a different question
    accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("bf16", "f32", "q8_0"))
    assert len(calls) == 2
    # errors are None and never cached
    class E(Exception):
        def __init__(self, status):
            self.status = status
    def not_found(i, s, f, dts):
        raise E(-4)      # SK_ERR_NOT_FOUND
    monkeypatch.setattr(native, "device_supports_ops", not_found)
    assert accel.compute_op_coverage(m, 0, "asr", "whisper", "q8_0", ("q8_0",)) is None
    assert accel._ops_key(m, 0, "asr", "whisper", "q8_0", ("q8_0",)) not in accel.bench_load()
    def backend(i, s, f, dts):
        raise E(-3)      # SK_ERR_BACKEND
    monkeypatch.setattr(native, "device_supports_ops", backend)
    assert accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "bf16", ("bf16",)) is None
    def invalid(i, s, f, dts):
        raise E(-1)      # SK_ERR_INVALID_ARGUMENT: a programming error
    monkeypatch.setattr(native, "device_supports_ops", invalid)
    with pytest.raises(E):                                                 # conftest sets SOKUJI_WIRE_STRICT=1
        accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0",))
    monkeypatch.setenv("SOKUJI_WIRE_STRICT", "0")
    assert accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0",)) is None   # production: degrade


def test_op_coverage_for_precomputes_only_what_the_planner_may_gate(monkeypatch, tmp_path):
    import types
    from sokuji_sidecar import native
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    calls = []
    def supports(i, s, f, dts):
        calls.append((i, f, s))
        return types.SimpleNamespace(all_supported=True, unsupported=(), checked=())
    monkeypatch.setattr(native, "device_supports_ops", supports)
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: None)
    card = catalog.tts_model("voxcpm2")                    # two rungs: q8_0, bf16
    m = _known_gpu_machine()
    cb = accel.op_coverage_for(m, card, "auto")
    assert len(calls) == 2 and all(c == (0, "voxcpm2", "tts") for c in calls)      # first vulkan device only, both rungs
    assert cb(0, "tts", "voxcpm2", "q8_0").all_supported is True
    assert cb(0, "tts", "voxcpm2", "f16") is None                                   # never asked → None
    calls.clear()
    accel.op_coverage_for(m, card, "cpu")
    assert calls == []                                                              # explicit CPU: nothing computed
    m2 = dataclasses.replace(m, devices=())
    accel.op_coverage_for(m2, card, "auto")
    assert calls == []
    m3 = dataclasses.replace(m, devices=(dataclasses.replace(m.devices[0], known=False), m.devices[1]))
    accel.op_coverage_for(m3, card, "auto")
    assert calls == []
    second = dataclasses.replace(m.devices[0], index=2, name="vulkan2", description="other")
    m4 = dataclasses.replace(m, devices=(m.devices[0], second, m.devices[1]))
    accel.op_coverage_for(m4, card, "auto")
    assert {c[0] for c in calls} == {0}                                             # two GPUs of one kind: only the first


def test_cached_op_coverage_reads_only(monkeypatch, tmp_path):
    from sokuji_sidecar import native
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: None)
    m = _known_gpu_machine()
    card = catalog.tts_model("voxcpm2")
    monkeypatch.setattr(native, "device_supports_ops", lambda *a: pytest.fail("read-only callable reached native"))
    assert accel.cached_op_coverage(m, [card])(0, "tts", "voxcpm2", "q8_0") is None
    dts = accel.weight_dtypes(card, "q8_0")                                         # the fallback set: what the miss was keyed by
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0", dts): {"allSupported": False, "unsupported": ["X"]}}, generation="G1")
    assert accel.cached_op_coverage(m, [card])(0, "tts", "voxcpm2", "q8_0") == accel.OpCoverage(False, ("X",))
```

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -k "coverage or weight_dtypes or ops_key" -q -p no:cacheprovider` — Expected: FAIL (names missing).

- [ ] **Step 2: Implement**

At the top of `accel.py` add `import logging` to the stdlib imports and `from . import gguf_header` beside the other intra-package imports. In `planner.py` (used by both this task and Task 11):

```python
_STAGE_OF_BACKEND = {"native_asr": "asr", "native_asr_stream": "asr", "native_translate": "translate", "native_tts": "tts"}
```

In `accel.py` after `_downloaded_quants`:

```python
def _artifact_path(model, compute_type: str):
    """Local path of the rung's GGUF if it is in the HF cache, else None."""
    from . import catalog as _cat
    from huggingface_hub import hf_hub_download
    for d in model.deployments:
        if d.compute_type != compute_type:
            continue
        repo, fname = _cat.split_artifact(d.artifact)
        if not fname:
            return None
        try:
            return hf_hub_download(repo, fname, local_files_only=True)
        except Exception:
            return None
    return None


def weight_dtypes(model, compute_type: str) -> tuple:
    """The dtype set WEIGHT expands over (spec A premise 7): the file's real header set when
    the rung is on disk, else the rung's deliberately wide fallback set. Sorted, so it keys."""
    from . import catalog as _cat
    path = _artifact_path(model, compute_type)
    if path:
        try:
            return tuple(sorted(gguf_header.read_header(path).tensor_types))
        except Exception:
            pass
    return tuple(sorted(_cat.RUNG_FALLBACK_DTYPES.get(compute_type, frozenset({"f32"}))))


def _ops_key(machine: Machine, device_index: int, stage: str, family: str, compute_type: str, weight_dtypes_) -> str:
    """gen|ops:idx:stage:family:ct:dt1+dt2 — the dtype set is part of the question, so the
    pre-download (fallback-set) answer and the post-download (header-set) answer coexist."""
    return f"{machine.generation}|ops:{device_index}:{stage}:{family}:{compute_type}:{'+'.join(sorted(weight_dtypes_))}"


def _stage_of_model(model) -> str:
    return planner._STAGE_OF_BACKEND.get(model.deployments[0].backend, "")


_OK_TO_MISS = (-4, -3)          # SK_ERR_NOT_FOUND (no recording), SK_ERR_BACKEND (Vulkan first-init threw)


def compute_op_coverage(machine: Machine, device_index: int, stage: str, family: str,
                        compute_type: str, weight_dtypes_):
    """native.device_supports_ops once per key, cached in the bench file. NOT_FOUND and
    BACKEND return None uncached; every other error is a programming error — raise under
    SOKUJI_WIRE_STRICT (the test suite), log and degrade in production."""
    from . import native
    key = _ops_key(machine, device_index, stage, family, compute_type, weight_dtypes_)
    entries = bench_load()
    if key in entries:
        v = entries[key]
        return OpCoverage(bool(v.get("allSupported")), tuple(v.get("unsupported", ())))
    try:
        cov = native.device_supports_ops(device_index, stage, family, weight_dtypes_)
    except Exception as e:                       # NativeError carries .status
        if getattr(e, "status", None) in _OK_TO_MISS:
            return None
        if os.environ.get("SOKUJI_WIRE_STRICT") == "1":
            raise
        logging.getLogger("sokuji_sidecar.accel").warning("device_supports_ops failed: %s", e)
        return None
    out = OpCoverage(bool(cov.all_supported), tuple(cov.unsupported))
    entries[key] = {"allSupported": out.all_supported, "unsupported": list(out.unsupported)}
    bench_save(entries, generation=machine.generation)
    return out


def _first_device_of_kind(machine: Machine, kind: str):
    return next((d for d in machine.devices if d.kind == kind), None)


def _gpu_targets(machine: Machine, model):
    """(device, tier) for each GPU tier the card lists that _tier_available accepts — the FIRST
    known device of that kind (native.device_for picks the first too). Empty without profiles."""
    out, seen = [], set()
    for d in model.deployments:
        if d.tier == "cpu" or not _tier_available(d.tier, machine, d.backend):
            continue
        kind = TIER_DEVICE[d.tier]
        if kind in seen:
            continue
        seen.add(kind)
        dev = _first_device_of_kind(machine, kind)
        if dev is not None and dev.known:
            out.append((dev, d.tier))
    return out


def op_coverage_for(machine: Machine, model, override: str):
    """What the resolve wrappers hand the planner: a dict.get over results PRECOMPUTED here —
    per accepted GPU tier, this card's graph_family, every rung the card lists, each keyed by
    that rung's current dtype set. Nothing is computed for an explicit CPU load, without
    profiles, or when the device is not known (spec A §3.3)."""
    results = {}
    if override == "cpu" or not machine.devices or model is None:
        return results.get
    stage = _stage_of_model(model)
    for dev, _tier in _gpu_targets(machine, model):
        for ct in sorted({x.compute_type for x in model.deployments}):
            results[(dev.index, stage, model.graph_family, ct)] = compute_op_coverage(
                machine, dev.index, stage, model.graph_family, ct, weight_dtypes(model, ct))
    return lambda index, stage_, family, ct: results.get((index, stage_, family, ct))


def cached_op_coverage(machine: Machine, models):
    """Read-only twin of op_coverage_for for the wire producers (_h_models_catalog,
    _h_list_variants): the same keys, looked up in the bench file, never computed. A miss is
    None. `models` is the list of cards the reply covers."""
    entries = bench_load()
    results = {}
    if machine.devices:
        for model in models:
            stage = _stage_of_model(model)
            for dev, _tier in _gpu_targets(machine, model):
                for ct in sorted({x.compute_type for x in model.deployments}):
                    v = entries.get(_ops_key(machine, dev.index, stage, model.graph_family, ct, weight_dtypes(model, ct)))
                    if isinstance(v, dict):
                        results[(dev.index, stage, model.graph_family, ct)] = OpCoverage(bool(v.get("allSupported")), tuple(v.get("unsupported", ())))
    return lambda index, stage_, family, ct: results.get((index, stage_, family, ct))
```

(`_tier_available` and `TIER_DEVICE` are already imported from `planner` in `accel.py`'s `from .planner import (...)` block; add them if not.) The four resolve wrappers and `select_variant` gain `op_coverage=` in Task 11 — this task's tests exercise the factories directly.

- [ ] **Step 3: Run**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -k "coverage or weight_dtypes or ops_key" -q -p no:cacheprovider` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/planner.py sidecar/tests/test_accel.py
git commit -m "accel: op coverage — weight dtypes from the GGUF header, dtype-keyed cache entries, precomputed and read-only callables over the generation-keyed cache"
```

---

### Task 11: The planner gate — `_deployment_available`, threading through ten functions, the fit walk sees only runnable rungs, structured R36

**Files:**
- Modify: `sidecar/sokuji_sidecar/planner.py` (`_tier_available` :121 Metal branch; new helpers; signatures of `resolve_deployments` :155, `_resolve_model` :187, `_tc_pick_quant` :243, `resolve` :286, `resolve_translate` :304, `resolve_tts` :369, `_llamacpp_variant_row` :474, `select_variant` :552)
- Modify: `sidecar/sokuji_sidecar/accel.py` (the wrappers `resolve_deployments` :225, `resolve` :231, `resolve_translate` :241, `resolve_tts` :253, `select_variant` :269, `_llamacpp_variant_row` :274)
- Modify: `sidecar/tests/test_planner.py` (`import dataclasses`, `from _fixtures import _known_gpu_machine`, `from sokuji_sidecar.accel import OpCoverage`), `sidecar/tests/test_characterization.py` (guard fixture + one test)
- Test: `sidecar/tests/test_planner.py`, `sidecar/tests/test_characterization.py`

**Interfaces:**
- Produces: `planner._ABORTS_ON_UNSUPPORTED`, `planner._NO_COVERAGE`, `_device_for_tier(machine, tier)`, `_deployment_available(model, d, machine, *, op_coverage)`; every listed planner function gains `*, op_coverage=_NO_COVERAGE`; every listed accel wrapper gains `op_coverage=None` and forwards `op_coverage or planner._NO_COVERAGE` — except the four resolve wrappers, which compute `op_coverage_for(m, model, override)` themselves.

- [ ] **Step 1: Write the failing planner tests**

```python
_NONE = planner._NO_COVERAGE if hasattr(planner, "_NO_COVERAGE") else (lambda *a: None)


def _cov(all_supported, unsupported=()):
    return lambda i, s, f, ct: OpCoverage(all_supported, tuple(unsupported))


def _cov_for(mapping):   # {(stage, family, ct): OpCoverage}
    return lambda i, s, f, ct: mapping.get((s, f, ct))


def test_deployment_available_unknown_profile_is_tier_available():
    m = _nv_machine(24576)                                        # devices=() by default
    for card in (catalog.tts_model("voxcpm2"), catalog.translate_model("qwen3-0.6b"), catalog.asr_model("whisper-base")):
        for d in card.deployments:
            assert planner._deployment_available(card, d, m, op_coverage=_NONE) == planner._tier_available(d.tier, m, d.backend)


def test_deployment_available_tts_refuses_gpu_on_unsupported_node_only():
    m = _known_gpu_machine()
    card = catalog.tts_model("voxcpm2")
    gpu = next(d for d in card.deployments if d.tier == "gpu-vulkan" and d.compute_type == "q8_0")
    cpu = next(d for d in card.deployments if d.tier == "cpu" and d.compute_type == "q8_0")
    assert planner._deployment_available(card, gpu, m, op_coverage=_cov(False, ["NORM[f32,-,-,-,-]->f32"])) is False
    assert planner._deployment_available(card, cpu, m, op_coverage=_cov(False)) is True
    assert planner._deployment_available(card, gpu, m, op_coverage=_cov(True)) is True
    assert planner._deployment_available(card, gpu, m, op_coverage=_NONE) is True        # not computed → pass


def test_deployment_available_asr_translate_never_refuse():
    m = _known_gpu_machine()
    for card in (catalog.translate_model("qwen3-0.6b"), catalog.asr_model("whisper-base")):
        gpu = next(d for d in card.deployments if d.tier == "gpu-vulkan")
        assert planner._deployment_available(card, gpu, m, op_coverage=_cov(False, ["X"])) is True


def test_deployment_available_unknown_backend_passes():
    m = _known_gpu_machine()
    d = catalog.Deployment("ctranslate2", "gpu-vulkan", "int8", "r", 1.0, est_bytes=1)
    class Card:
        graph_family = "x"
        deployments = (d,)
    assert planner._deployment_available(Card, d, m, op_coverage=_cov(False)) is True


def test_refused_tts_rung_lands_on_cpu_row_under_pin_downloaded_and_gpu_override_with_pin():
    m = _known_gpu_machine()
    cov = _cov_for({("tts", "voxcpm2", "bf16"): OpCoverage(False, ("MUL_MAT[bf16,f32,-,-,-]->f32",)),
                    ("tts", "voxcpm2", "q8_0"): OpCoverage(True, ())})
    kw = dict(machine=m, platform="linux", cache={}, est_bytes=lambda d: d.est_bytes, op_coverage=cov)
    plans = planner.resolve_tts("voxcpm2", pin="bf16", downloaded=set(), **kw)                         # pin
    assert plans[0].device == "cpu" and plans[0].compute_type == "bf16"
    plans = planner.resolve_tts("voxcpm2", downloaded=frozenset({"bf16"}), **kw)                        # downloaded
    assert plans[0].device == "cpu" and plans[0].compute_type == "bf16"
    plans = planner.resolve_tts("voxcpm2", "gpu", pin="bf16", downloaded=set(), **kw)                   # override gpu + pin
    assert plans[0].device == "cpu" and plans[0].compute_type == "bf16"


def test_fit_walk_sees_only_runnable_rungs():
    m = _known_gpu_machine()                                      # 96 GiB: bf16 fits
    cov = _cov_for({("tts", "voxcpm2", "bf16"): OpCoverage(False, ("X",)), ("tts", "voxcpm2", "q8_0"): OpCoverage(True, ())})
    plans = planner.resolve_tts("voxcpm2", machine=m, platform="linux", cache={}, downloaded=set(),
                                est_bytes=lambda d: d.est_bytes, op_coverage=cov)
    assert plans[0].device == "vulkan" and plans[0].compute_type == "q8_0"       # not bf16-on-cpu


def test_tier_available_metal_uses_the_structured_bit_when_known():
    dev_ok = accel.DeviceProfile(0, "metal", "MTL0", "Apple M4", 16 << 30, True, frozenset({"mtl_simdgroup_reduction", "uma"}), "Metal", "25A", "", "")
    dev_vm = dataclasses.replace(dev_ok, description="Apple Paravirtual device", features=frozenset({"uma"}))
    base = accel.Machine(os="Darwin", arch="arm64", cpu_cores=10, apple_silicon=True, installed=frozenset({"native_tts"}), fingerprint="fp",
                         tc_kinds=("metal", "cpu"), gpus=(("metal", "Apple M4", 16 << 30),))
    assert planner._tier_available("gpu-metal", dataclasses.replace(base, devices=(dev_ok,))) is True
    assert planner._tier_available("gpu-metal", dataclasses.replace(base, devices=(dev_vm,))) is False              # bit absent
    vm_named = dataclasses.replace(base, gpus=(("metal", "Apple Paravirtual device", 8 << 30),), devices=(dataclasses.replace(dev_ok, description="Apple Paravirtual device"),))
    assert planner._tier_available("gpu-metal", vm_named) is False                                                   # string rule kept
```

(`resolve_tts`'s real keyword set is at `planner.py:369` — `cache`, `downloaded`, `pin`, `est_bytes`; pass exactly those.) Run — Expected: FAIL (`_deployment_available` missing; `op_coverage` unexpected keyword).

- [ ] **Step 2: Implement the gate and thread it**

In `planner.py`, after `_tier_available`:

```python
_ABORTS_ON_UNSUPPORTED = {"tts"}     # audio.cpp computes single-backend and aborts; llama.cpp/transcribe.cpp schedule onto CPU
_NO_COVERAGE = lambda *a: None       # noqa: E731 — the default: nothing computed, everything passes (premise 5)


def _device_for_tier(machine: Machine, tier: str):
    kind = TIER_DEVICE.get(tier)
    return next((d for d in machine.devices if d.kind == kind), None)   # first of the kind, as native.device_for


def _deployment_available(model, d, machine: Machine, *, op_coverage=_NO_COVERAGE) -> bool:
    """Spec A §3.3: _tier_available, then — for a GPU tier on a device with a known profile — the
    family's op coverage for THIS rung. Only the tts stage refuses; asr/translate run with
    CPU fallback and are recorded for diagnostics. Anything unknown passes through."""
    if not _tier_available(d.tier, machine, d.backend):
        return False
    if d.tier == "cpu":
        return True
    dev = _device_for_tier(machine, d.tier)
    if dev is None or not dev.known:
        return True
    stage = _STAGE_OF_BACKEND.get(d.backend)
    if stage is None:
        return True
    cov = op_coverage(dev.index, stage, getattr(model, "graph_family", ""), d.compute_type)
    if cov is None:
        return True
    if stage in _ABORTS_ON_UNSUPPORTED:
        return bool(cov.all_supported)
    return True
```

`_tier_available`'s Metal branch becomes:

```python
    if tier == "gpu-metal":
        if _paravirtual_metal_only(machine):
            return False
        dev = _device_for_tier(machine, "gpu-metal")
        if dev is not None and dev.known and "mtl_simdgroup_reduction" not in dev.features:
            return False                      # the structured R36 signal (spec A premise 6)
        return machine.apple_silicon or "metal" in machine.tc_kinds
```

(`_paravirtual_metal_only` is the existing string rule's helper; keep whatever the branch calls today and add the two `dev` lines after it.) Then thread `*, op_coverage=_NO_COVERAGE` through and use it:

- `resolve_deployments(model, machine, override="auto", bench=None, *, platform, op_coverage=_NO_COVERAGE)`: the `usable` comprehension uses `_deployment_available(model, d, machine, op_coverage=op_coverage)` instead of `_tier_available(...)`.
- `_resolve_model(..., *, cache, platform, op_coverage=_NO_COVERAGE)` passes it to `resolve_deployments`.
- `_tc_pick_quant(model, machine, pin, budget, downloaded=None, *, op_coverage=_NO_COVERAGE)`: `gpu_possible = any(d.tier != "cpu" and _deployment_available(model, d, machine, op_coverage=op_coverage) for d in model.deployments)`, and **before** the fit walk, only when `gpu_possible`: `sizes = {q: s for q, s in sizes.items() if any(d.compute_type == q and d.tier != "cpu" and _deployment_available(model, d, machine, op_coverage=op_coverage) for d in model.deployments)} or sizes` (the `or sizes` keeps the walk non-empty if nothing has a GPU row, which then falls to the existing default logic).
- `_llamacpp_variant_row(..., *, est_bytes, op_coverage=_NO_COVERAGE)`: `_row()` uses `_deployment_available(model, d, machine, op_coverage=op_coverage)`; `gpu_possible` likewise; and before `_fit_walk`: restrict `quants` to rungs with at least one available GPU row (same shape as above, `or quants`).
- `select_variant(..., *, est_bytes, format_ready, op_coverage=_NO_COVERAGE)`: pass through to `_llamacpp_variant_row`; `candidate()` uses `_deployment_available`.
- `resolve`, `resolve_translate`, `resolve_tts`: accept `op_coverage=_NO_COVERAGE` and pass it to `_tc_pick_quant` / `select_variant` / `_llamacpp_variant_row` / `_resolve_model`.

In `accel.py` — six wrappers:

```python
def resolve_deployments(model, machine, override="auto", bench=None, *, platform=None, op_coverage=None):
    return planner.resolve_deployments(
        model, machine, override, bench,
        platform=platform if platform is not None else current_platform(),
        op_coverage=op_coverage or planner._NO_COVERAGE)


def select_variant(model, machine, reserved_bytes, pin=None, budget_bytes=None, downloaded=None, op_coverage=None):
    return planner.select_variant(model, machine, reserved_bytes, pin, budget_bytes, downloaded,
                                  est_bytes=_est_bytes, format_ready=_format_ready,
                                  op_coverage=op_coverage or planner._NO_COVERAGE)


def _llamacpp_variant_row(model, machine, pin, reserved_bytes=0, budget_bytes=None, downloaded=None, op_coverage=None):
    return planner._llamacpp_variant_row(model, machine, pin, reserved_bytes, budget_bytes,
                                         downloaded=downloaded, est_bytes=_est_bytes,
                                         op_coverage=op_coverage or planner._NO_COVERAGE)
```

and in `resolve`, `resolve_translate`, `resolve_tts` (:231-266) add `op_coverage=op_coverage_for(m, model, override)` to the `planner.resolve_*` call — computed AFTER `model` is looked up and `m` probed, so a missing card yields `op_coverage_for(m, None, ...)` (returns the empty `.get`) and the planner raises its usual `ValueError`.

- [ ] **Step 3: The characterisation guard**

In `sidecar/tests/test_characterization.py` add `from sokuji_sidecar import native` to the imports and extend the autouse fixture `_nothing_downloaded` (:89):

```python
    monkeypatch.setattr(accel, "compute_op_coverage", lambda *a, **k: pytest.fail("native reached with devices=()"))
    monkeypatch.setattr(native, "module", lambda: pytest.fail("native reached with devices=()"))
```

and add one test:

```python
def test_machines_carry_no_profile():
    assert all(m.devices == () and m.generation == "" for m in _ALL_MACHINES)
```

- [ ] **Step 4: Run the three suites**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_planner.py tests/test_accel.py tests/test_characterization.py -q -p no:cacheprovider 2>&1 | tail -2`
Expected: all pass; every matrix row unchanged.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/planner.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_planner.py sidecar/tests/test_characterization.py
git commit -m "planner: _deployment_available at every gate (tts refuses on op coverage; asr/translate record), fit walk over runnable rungs, structured R36; wrappers thread op_coverage"
```

---

### Task 12: Wire producers — `hardware_info_result.generation/devices`, `tiers[].available`, `variants[].unsupportedTiers`, the schema

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_h_list_variants` :619, `_h_hardware_info` :731, `_h_models_catalog` :748), `sidecar/sokuji_sidecar/wire_schema.json:4`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces on the wire: `hardware_info_result.generation: str | null`, `.devices: [{index, kind, name, description, memTotalMb, known, features[], driverName, driverVersion, deviceUuid, cpuFeatures, opCoverage: {"stage/family/ct": {allSupported, unsupported[]}}}] | null`; `models_catalog_result.models[].variants[].unsupportedTiers?: [tier]`; `tiers[].available` now means "some rung can execute there".

- [ ] **Step 1: Write the failing tests**

```python
async def _call(handler, msg):
    out, _ = await handler(None, msg, None)
    return out


def test_hardware_info_carries_profiles_and_cached_coverage(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _known_gpu_machine()
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    monkeypatch.setattr(accel, "_engine_identity", lambda m: ("1.1.0", {"ggml": "0.22.0"}, "cpu-vulkan", {"kind": "vulkan", "name": "vulkan0", "description": "GB10"}))
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0", ("bf16", "f32", "q8_0")): {"allSupported": False, "unsupported": ["NORM[f32,-,-,-,-]->f32"]}}, generation="G1")
    monkeypatch.setattr(accel, "compute_op_coverage", lambda *a, **k: pytest.fail("hardware_info must not compute coverage"))
    out = asyncio.run(_call(accel._h_hardware_info, {"type": "hardware_info", "id": 7}))
    assert out["generation"] == "G1"
    dev = out["devices"][0]
    assert dev["kind"] == "vulkan" and dev["known"] and dev["deviceUuid"] == "ab" * 16 and dev["driverName"] == "NVIDIA"
    assert dev["opCoverage"] == {"tts/voxcpm2/q8_0": {"allSupported": False, "unsupported": ["NORM[f32,-,-,-,-]->f32"]}}
    assert out["devices"][1]["cpuFeatures"] == "NEON=1" and out["devices"][1]["opCoverage"] == {}
    from sokuji_sidecar import wire
    wire.validate_outbound(out)                                       # schema lists the two new optional fields


def test_hardware_info_without_profiles_is_todays_wire_plus_nulls(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = dataclasses.replace(_known_gpu_machine(), devices=(), generation="")
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    monkeypatch.setattr(accel, "_engine_identity", lambda m: (None, None, None, None))
    out = asyncio.run(_call(accel._h_hardware_info, {"type": "hardware_info", "id": 8}))
    assert out["generation"] is None and out["devices"] is None


def test_models_catalog_marks_unsupported_tiers_but_keeps_supported_true(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: None)          # both rungs keyed by their fallback sets
    m = _known_gpu_machine()
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    card = catalog.tts_model("voxcpm2")
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", "bf16", accel.weight_dtypes(card, "bf16")): {"allSupported": False, "unsupported": ["X"]},
                      accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0", accel.weight_dtypes(card, "q8_0")): {"allSupported": True, "unsupported": []}}, generation="G1")
    out = asyncio.run(_call(accel._h_models_catalog, {"type": "models_catalog", "id": 1, "kind": "tts", "models": ["voxcpm2"]}))
    card_out = out["models"][0]
    vulkan = next(t for t in card_out["tiers"] if t["tier"] == "gpu-vulkan")
    assert vulkan["available"] is True                                # q8_0 can execute there
    by_id = {v["id"]: v for v in card_out["variants"]}
    assert by_id["bf16"]["supported"] is True and by_id["bf16"]["unsupportedTiers"] == ["gpu-vulkan"]
    assert by_id["q8_0"]["supported"] is True and "unsupportedTiers" not in by_id["q8_0"]
    from sokuji_sidecar import wire
    wire.validate_outbound(out)
    # cache miss → exactly today's wire
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path / "empty"))
    out2 = asyncio.run(_call(accel._h_models_catalog, {"type": "models_catalog", "id": 2, "kind": "tts", "models": ["voxcpm2"]}))
    assert all("unsupportedTiers" not in v for v in out2["models"][0]["variants"])
    assert next(t for t in out2["models"][0]["tiers"] if t["tier"] == "gpu-vulkan")["available"] is True


def test_models_catalog_tier_unavailable_when_every_rung_is_refused(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: None)
    m = _known_gpu_machine()
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    card = catalog.tts_model("voxcpm2")
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", ct, accel.weight_dtypes(card, ct)): {"allSupported": False, "unsupported": ["X"]}
                      for ct in {d.compute_type for d in card.deployments}}, generation="G1")
    out = asyncio.run(_call(accel._h_models_catalog, {"type": "models_catalog", "id": 3, "kind": "tts", "models": ["voxcpm2"]}))
    assert next(t for t in out["models"][0]["tiers"] if t["tier"] == "gpu-vulkan")["available"] is False
    assert next(t for t in out["models"][0]["tiers"] if t["tier"] == "cpu")["available"] is True
```

(`asyncio` and `dataclasses` are imported at the top of `test_accel.py` after Task 8; the handlers take `(state, msg, _b, conn=None)` and tolerate `None` for all but `msg`.) Run — Expected: FAIL (`generation` missing from the reply; `unsupportedTiers` missing; `wire.validate_outbound` raises on the unknown key under `SOKUJI_WIRE_STRICT=1`).

- [ ] **Step 2: Implement**

`wire_schema.json` line 4 becomes:

```json
  "hardware_info_result": {"required": ["id", "os", "arch", "cpuCores", "gpus", "backendsInstalled", "accelAvailable"], "optional": ["nativeVersion", "engineVersions", "lane", "preferredDevice", "generation", "devices"]},
```

(and, if the `models_catalog_result` row enumerates variant fields, add `unsupportedTiers` to its optional list the same way — check with `grep -n unsupported sidecar/sokuji_sidecar/wire_schema.json`; if the schema does not descend into variants, nothing else changes.)

`_h_hardware_info` — the reply dict gains, after `"preferredDevice": preferred_device`:

```python
            "generation": m.generation or None,
            "devices": _devices_wire(m) or None}, None
```

with, above it:

```python
def _devices_wire(m: Machine) -> list:
    """Spec A §3.4: the profile plus whatever op coverage is already cached — read-only. The
    wire key drops the dtype segment; when both a pre-download and a post-download entry
    exist for one rung, the later-written one wins (JSON preserves write order)."""
    if not m.devices:
        return []
    entries = bench_load()
    prefix = f"{m.generation}|ops:"
    per_device = {d.index: {} for d in m.devices}
    for k, v in entries.items():
        if not (k.startswith(prefix) and isinstance(v, dict)):
            continue
        _ops, idx, stage, family, ct, _dtypes = k.split("|", 1)[1].split(":", 5)
        if int(idx) in per_device:
            per_device[int(idx)][f"{stage}/{family}/{ct}"] = {"allSupported": bool(v.get("allSupported")), "unsupported": list(v.get("unsupported", ()))}
    return [{"index": d.index, "kind": d.kind, "name": d.name, "description": d.description,
             "memTotalMb": d.mem_total >> 20, "known": d.known, "features": sorted(d.features),
             "driverName": d.driver_name, "driverVersion": d.driver_version, "deviceUuid": d.device_uuid,
             "cpuFeatures": d.cpu_features, "opCoverage": per_device[d.index]}
            for d in m.devices]
```

`_h_models_catalog`: compute `cov = cached_op_coverage(m, models)` right after `models` is filtered, then make both the `tiers` loop and the variants loop use `_deployment_available` with it:

```python
    cov = cached_op_coverage(m, models)
    for mdl in models:
        tiers = []
        seen_tiers = set()
        for d in mdl.deployments:
            if not _platform_ok(d, m, platform_tag):
                continue
            if d.tier in seen_tiers:
                continue
            seen_tiers.add(d.tier)
            any_rung = any(x.backend in m.installed and planner._deployment_available(mdl, x, m, op_coverage=cov)
                           for x in mdl.deployments if x.tier == d.tier and _platform_ok(x, m, platform_tag))
            tiers.append({"tier": d.tier, "backend": d.backend, "available": any_rung})
        ...
            if is_llama:
                chosen = _llamacpp_variant_row(mdl, m, None, 0, budget, op_coverage=cov)
                rec = chosen.compute_type if chosen is not None else None
            else:
                rec = _tc_pick_quant(mdl, m, None, budget, op_coverage=cov)
        ...
            for ct, size in sorted(sizes_by_ct.items(), key=lambda kv: -kv[1]):
                ...
                entry_v = {"id": ct, "sizeBytes": size, "needBytes": need, "repo": artifact_by_ct.get(ct),
                           "supported": supported, "recommended": ct == rec}
                refused = sorted({x.tier for x in mdl.deployments
                                  if x.compute_type == ct and x.tier != "cpu" and _platform_ok(x, m, platform_tag)
                                  and _tier_available(x.tier, m, x.backend)
                                  and not planner._deployment_available(mdl, x, m, op_coverage=cov)})
                if refused:
                    entry_v["unsupportedTiers"] = refused
                variants.append(entry_v)
```

`_h_list_variants`: `cov = cached_op_coverage(m, [model])` after `model` is found, and `select_variant(model, m, reserve, pin=msg.get("pin"), budget_bytes=_quant_budget_bytes(m), op_coverage=cov)`.

- [ ] **Step 3: Run the suite**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests -q -p no:cacheprovider 2>&1 | tail -2` — Expected: all pass (`conftest.py`'s strict outbound validation accepts the two new optional fields).

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/wire_schema.json sidecar/tests/test_accel.py
git commit -m "wire: hardware_info_result carries the device profiles and cached op coverage; models_catalog marks unsupportedTiers without touching supported"
```

---

### Task 13: Renderer — wire types, forwarding into LogsPanel, store fields, the once-per-session warning, the enabled "runs on CPU here" note

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts:41-43` (variants), `:58-68` (`HardwareInfoResultMsg`), `:72-79` (`VariantInfo`)
- Modify: `src/services/clients/LocalNativeClient.ts:89-96`
- Modify: `src/stores/nativeModelStore.ts` (`NativeEngineInfo` untouched; new fields `deviceProfiles`, `profileGeneration`, `reportedUnsupportedOps`; the ready transition at ~455)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx:105-150, 523-550`
- Modify: `src/locales/*/translation.json` (30 files): `models.variantRunsOnCpu`
- Test: `src/stores/nativeModelStore.test.ts`, `src/components/Settings/sections/NativeModelManagementSection.test.tsx`, `src/lib/local-inference/native/nativeProtocol.consistency.test.ts` (existing; must keep passing)

**Interfaces:**
- Consumes: Task 12's wire fields (`hardware_info_result.generation`, `.devices[]` with `opCoverage` keyed `"stage/family/compute_type"`; `variants[].unsupportedTiers`).
- Produces: `HardwareInfoResultMsg.generation?: string | null`, `.devices?: NativeDeviceProfile[] | null`; `NativeModelInfo.variants[number].unsupportedTiers?: string[]`; `VariantInfo.unsupportedTiers?: string[]`; store fields `deviceProfiles: NativeDeviceProfile[] | null`, `profileGeneration: string | null`.

- [ ] **Step 1: Write the failing store tests**

`src/stores/nativeModelStore.test.ts` drives the ready path through `mockModelsCatalogResolve()` + `mockHardwareInfoResolve(overrides)` (the `FakeWS` reply table) and `ensureCatalog()`; the engineInfo test near line 452 is the template. Diagnostics are asserted through `settleReports` and `useLogStore`, the way the file's existing report assertions do. Add beside that engineInfo test:

```ts
it('keeps device profiles and the generation beside engineInfo, and reports an unsupported tts node once per session', async () => {
  mockModelsCatalogResolve();
  const devices = [{
    index: 0, kind: 'vulkan', name: 'Vulkan0', description: 'GB10', memTotalMb: 98304, known: true, features: ['vk_coopmat'],
    driverName: 'NVIDIA', driverVersion: '580', deviceUuid: 'ab'.repeat(16), cpuFeatures: '',
    opCoverage: { 'tts/voxcpm2/q8_0': { allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'] } },
  }];
  mockHardwareInfoResolve({ generation: 'G1', devices });
  useLogStore.getState().clearLogs();
  await useNativeModelStore.getState().ensureCatalog();
  const s = useNativeModelStore.getState();
  expect(s.engineInfo).toEqual({ nativeVersion: '1.0.2', engineVersions: { ggml: '0.22.0' }, lane: 'cpu-vulkan', preferredDevice: null });  // whatever the file's existing engineInfo expectation is — copy it verbatim
  expect(s.profileGeneration).toBe('G1');
  expect(s.deviceProfiles?.[0].deviceUuid).toBe('ab'.repeat(16));
  await settleReports();
  const warnings = useLogStore.getState().logs.filter((l) => l.level === 'warning' && l.message.includes('NORM[f32,-,-,-,-]->f32'));
  expect(warnings).toHaveLength(1);
  expect(warnings[0].message).toContain('GB10');
  // a second hardware_info in the same session with the same key: no second line
  useNativeModelStore.setState({ sidecarStatus: 'idle' });   // the field/value the file uses to force ensureCatalog to re-probe — copy from the retry test in this file
  await useNativeModelStore.getState().ensureCatalog();
  await settleReports();
  expect(useLogStore.getState().logs.filter((l) => l.level === 'warning' && l.message.includes('NORM[f32,-,-,-,-]->f32'))).toHaveLength(1);
});

it('a variant with unsupportedTiers stays pickable and keeps its pin', () => {
  const card: NativeModelInfo = {
    ...CARD,                                         // the literal near line 286
    id: 'voxcpm2', kind: 'tts', repo: 'r/voxcpm2',
    variants: [
      { id: 'q8_0', sizeBytes: 1, needBytes: 1, repo: 'r/voxcpm2', supported: true, recommended: true },
      { id: 'bf16', sizeBytes: 2, needBytes: 2, repo: 'r/voxcpm2-bf16', supported: true, recommended: false, unsupportedTiers: ['gpu-vulkan'] },
    ],
  };
  expect(deriveVariantRepos([card], { voxcpm2: 'bf16' })['voxcpm2']).toBe('r/voxcpm2-bf16');
});
```

(`useLogStore` is imported from `'./logStore'` and `settleReports` from `'../lib/diagnostics/report'` — both are already imported in this file if any existing test asserts a report; add them if not. `CARD` and `deriveVariantRepos` are the file's own literal and the store's export at `nativeModelStore.ts:215`.)

`NativeModelManagementSection.test.tsx` fixtures its catalog through the hoisted `mockCatalog` record consumed by `vi.mock`, and every test renders `<NativeModelManagementSection />` then reaches rows through `within(screen.getByTestId('model-card-<id>')).getByTestId('variant-row-<id>')` (line ~492 is the template). The `qwen3-tts-1.7b` entry lists variants `bf16`, `fp32`, `int8`. Give its `bf16` variant `unsupportedTiers: ['gpu-vulkan']` in `mockCatalog` and add:

```tsx
it('renders "runs on CPU here" on an enabled option when the sidecar refused its GPU tier', () => {
  render(<NativeModelManagementSection />);
  const opt = within(screen.getByTestId('model-card-qwen3-tts-1.7b')).getByTestId('variant-row-bf16') as HTMLOptionElement;
  expect(opt.disabled).toBe(false);
  expect(opt.textContent).toContain('Runs on CPU on this machine');
  const other = within(screen.getByTestId('model-card-qwen3-tts-1.7b')).getByTestId('variant-row-int8');
  expect(other.textContent).not.toContain('Runs on CPU');
});
```

If an existing test in that file asserts the exact `textContent` of `variant-row-bf16` for `qwen3-tts-1.7b`, give the `unsupportedTiers` to a variant no existing test pins instead, and point both assertions at that one.

Run: `npx vitest run src/stores/nativeModelStore.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx` — Expected: FAIL (fields missing; the tsc-in-vitest step rejects `unsupportedTiers` on the literal).

- [ ] **Step 2: Types**

`nativeProtocol.ts`: in `NativeModelInfo.variants` (line ~41) add `unsupportedTiers?: string[];` after `recommended: boolean;` with the comment `// gpu tiers the sidecar's op coverage refused for this rung (spec A); the rung still runs on cpu`. Add:

```ts
/** One device's profile as hardware_info reports it (spec A §3.4). `known=false` means the
 *  sidecar could not read it; every field but index/kind/name/description is then empty. */
export interface NativeDeviceProfile {
  index: number; kind: string; name: string; description: string; memTotalMb: number;
  known: boolean; features: string[]; driverName: string; driverVersion: string; deviceUuid: string;
  cpuFeatures: string;
  opCoverage: Record<string, { allSupported: boolean; unsupported: string[] }>;   // "stage/family/compute_type"
}
```

and in `HardwareInfoResultMsg` (lines 58-68) after `preferredDevice`: `generation?: string | null; devices?: NativeDeviceProfile[] | null;`. In `VariantInfo` (72-79) add `unsupportedTiers?: string[];`. Run `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts` — Expected: PASS (the schema from Task 12 lists both as optional).

- [ ] **Step 3: Client forwarding and store**

`LocalNativeClient.ts:91-94` — add `generation: hw.generation ?? null, devices: hw.devices ?? null,` to the emitted payload (LogsPanel already renders the event's payload).

`nativeModelStore.ts`: state gains

```ts
  /** Spec A: per-device profiles + the bench-cache generation from the same hardware_info call
   *  that fills engineInfo. Kept BESIDE engineInfo (whose shape is pinned by tests). */
  deviceProfiles: NativeDeviceProfile[] | null;
  profileGeneration: string | null;
  /** "stage/family/compute_type" keys already reported this session (once per key; dedupeKey only throttles bursts). */
  reportedUnsupportedOps: Set<string>;
```

with initial values `null`, `null`, `new Set()`; in the ready transition (line ~455) capture `hw.devices ?? null` and `hw.generation ?? null` into locals, include them in the `set(...)`, and after `set` run:

```ts
      for (const dev of deviceProfiles ?? []) {
        for (const [key, cov] of Object.entries(dev.opCoverage ?? {})) {
          if (cov.allSupported || !key.startsWith('tts/')) continue;
          if (get().reportedUnsupportedOps.has(key)) continue;
          get().reportedUnsupportedOps.add(key);
          reportWarning('NativeModelStore',
            `${key} cannot run on ${dev.description}: ${cov.unsupported.join(', ')} unsupported; it will load on CPU`,
            { dedupeKey: 'native.ops.unsupported' });
        }
      }
```

`reportWarning` comes from `'../lib/diagnostics/report'` (the store already imports `reportError` from there; extend that import). Reset `deviceProfiles`/`profileGeneration` to `null` wherever `engineInfo` is reset to `null` (the idle/unavailable transitions); `reportedUnsupportedOps` is NOT reset there — it is per session by design.

- [ ] **Step 4: The muted note**

`NativeModelManagementSection.tsx` `variantData` (line ~541): carry `unsupportedTiers: v.unsupportedTiers` into the `VariantInfo`. In `VariantDropdown`'s option (line ~135), after the `!v.supported` reason span add:

```tsx
              {v.supported && v.unsupportedTiers && v.unsupportedTiers.length > 0 && (
                <span className="model-card__variant-reason">{t('models.variantRunsOnCpu', 'Runs on CPU on this machine')}</span>
              )}
```

Add `"variantRunsOnCpu": "Runs on CPU on this machine"` to `models` in `src/locales/en/translation.json` and a translation in each of the other 29 locale files (same key, translated string, placed right after `variantNoGpuFits` in each file so the diff is reviewable).

- [ ] **Step 5: Run the renderer suites and tsc**

Run: `npx vitest run src/stores src/components/Settings src/lib/local-inference && npx tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: all pass; the `error TS` count equals the count on `main` (measure it first with `git stash`-free means: run the same grep on a clean `main` worktree, or record the number before Step 2 — it must not grow).

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/services/clients/LocalNativeClient.ts src/stores/nativeModelStore.ts \
        src/stores/nativeModelStore.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx \
        src/components/Settings/sections/NativeModelManagementSection.test.tsx src/locales
git commit -m "renderer: device profiles and generation from hardware_info into the store and LogsPanel; unsupportedTiers renders as an enabled 'runs on CPU' note"
```

---

### Task 14: Release — `native-v1.1.0`, the sidecar pins, `sidecar-v0.3.0`

**Files:**
- Modify: `sidecar/requirements.txt` (five wheel URLs), `sidecar/tests/test_runtime_gate.py` (URL prefix at lines 4, 57, 80), `package.json` (`sidecarVersion`)

Every outward act below (push, PR, merge, tag, `workflow_dispatch`) is done only after jiangzhuo confirms that specific act, naming the target (`kizuna-ai-lab/sokuji`, the branch, the tag). Approval of the work is not approval of the act.

- [ ] **Step 1: Dry run the wheels** — ask to run `native-build.yml` via `workflow_dispatch` on the feature branch; expect five green lanes (`test_common` with the profile assertions passes on the paravirtual Metal runner through the inverse assertion; `test_ops_coverage` runs for the five CI-downloaded models on every lane and skips the rest).
- [ ] **Step 2: PR into `main`** — ask to push the branch and open the PR (title: `native+sidecar: device profile, op recordings, cache generations (spec A)`); after review, ask to merge with a merge commit.
- [ ] **Step 3: Tag `native-v1.1.0` on `main`** — verify first: `grep -n 'VERSION 1.1.0' native/CMakeLists.txt`, `grep -c 'SK_ABI_VERSION 2\|sk_version.*1.1.0' native/include/sokuji_native.h native/tests/test_common.cpp`, `ls native/src/ops/tts-*.ops | wc -l` prints 9; ask; push the tag; wait for the five wheels (prerelease).
- [ ] **Step 4: Pin the sidecar** — on a `chore/sidecar-v0.3.0` branch. The pins in the tree are `native-v1.0.2/sokuji_native-1.0.2-` (five lines in `requirements.txt`, the prefix in `test_runtime_gate.py`); confirm before editing: `grep -c 'native-v1\.0\.2/sokuji_native-1\.0\.2-' sidecar/requirements.txt` prints 5. Then `sed -i -E 's|native-v1\.0\.[0-9]+/sokuji_native-1\.0\.[0-9]+-|native-v1.1.0/sokuji_native-1.1.0-|g' sidecar/requirements.txt sidecar/tests/test_runtime_gate.py`, update the `native-v1.0.2` prose in `test_runtime_gate.py`'s docstring, set `"sidecarVersion": "0.3.0"` in `package.json`; `grep -c 'native-v1.1.0' sidecar/requirements.txt` must print 5; run the sidecar suite (`cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests -q -p no:cacheprovider`, all pass); ask to push + PR + merge.
- [ ] **Step 5: Tag `sidecar-v0.3.0` on the merge commit** — verify `git show <sha>:sidecar/requirements.txt | grep -c native-v1.1.0` prints 5 and `git show <sha>:package.json | grep sidecarVersion` prints 0.3.0; ask; push the tag; wait for `sidecar-bundles.yml` (five bundles + `manifest.json`).
- [ ] **Step 6: Fleet smoke** — the smoke harness from the 0.2.1 release (`/home/jiangzhuo/.claude/jobs/387091ff/tmp/esl-b2/smoke/smoke.sh <sku> <device> <workdir>`, with `wire_check.py`'s `nativeVersion` assertion bumped to `1.1.0`) plus one `hardware_info` assertion: `devices[]` present with `known: true` on GB10 (Vulkan), the Ubuntu 4070 (Vulkan, glibc 2.35) and the M4 (Metal, `mtl_simdgroup_reduction` in `features`), and `generation` a 12-hex string.

---

## Self-review (run after writing; findings fixed inline)

**Spec coverage.** §3.1 profile → Tasks 1–3 (CPU/Metal in 2, Vulkan + matcher + `DENY_BY_FILE` + headers in 3). §3.2 recordings, `WEIGHT` only on rung-bearing src0, identity without sequence axes, dtype sets, the static_assert against `SK_OP_COVERAGE_MAX`, the two recording mechanisms, flash attention on and off, `test_ops_coverage`, the checklist → Tasks 4–6. §3.3 `graph_family`/`arch=`, the three catalog equality tests, fallback sets, `DeviceProfile`/`OpCoverage`/`Machine` fields, detectors, generation, `_cache_key` both sides, `bench_read`/`bench_save`, `weight_dtypes`, the dtype-keyed `_ops_key`, the three coverage callables, ten threaded functions, the gate, fit-walk restriction, structured R36, wire semantics → Tasks 7–12. §3.4 wire + renderer → Tasks 12–13. §3.5 rollout → Task 14. §4 tests: each bullet maps to a test in the task that implements the behaviour (CPU coverage with dtypes-in-file: Task 5; old-wheel `resolve_tts` equality: Task 8; generation under `resolve` AND `resolve_translate`: Task 9; characterisation guard: Task 11 Step 3; `check_linux_deps` per-file rule: Task 3; the configure-time ABI check: Task 1).

**Placeholders.** None: every code step carries the code. Two data-gathering steps are procedural by nature and say exactly what to run and what verifies the result — the ASR/translate `arch=` values (Task 7 Step 4, pinned for the cached whisper/moonshine-streaming/Qwen3 files by Task 7's three equality tests) and the recording invocations (Task 4 Step 7, twelve literal lines whose node counts must be non-zero). The two renderer lines marked "copy from this file" name the exact test they are copied from.

**Type consistency.** `OpCoverage` is `(all_supported, unsupported)` in the sidecar (Tasks 8, 10, 11, 12) and `(all_supported, unsupported, checked)` in the binding (Task 5) — the sidecar's `compute_op_coverage` reads only the first two. The callable signature is `(index, stage, family, compute_type)` everywhere (Tasks 10, 11, 12); the dtype set is folded into the key by `op_coverage_for` / `cached_op_coverage`, never passed through the planner. `_ops_key` spelling `gen|ops:idx:stage:family:ct:dt1+dt2` matches `_devices_wire`'s `split(':', 5)` (Task 12). `DeviceProfile` field order is identical in `accel.py` (Task 8) and the binding (Task 2). Feature-bit names in `_ffi.FEATURE_BITS` (Task 1) match the strings the planner tests (`mtl_simdgroup_reduction`, Task 11) and the C enum comment. `sk_translate_options{n_ctx, flash_attn}` (Task 1) is what `record_common.h` initialises (Task 4). `sk_record_register_device` / `sk_record_begin` / `sk_record_end_to_file` / `sk_record_node_count` / `sk_ops_blob_count` / `sk_ops_blob_at` are the only recorder symbols crossing the library boundary (Tasks 4–6), all C linkage.
