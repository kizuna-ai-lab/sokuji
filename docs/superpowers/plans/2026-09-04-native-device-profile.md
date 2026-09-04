# Native Device Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every machine gets a structured device profile (driver identity, raw Vulkan feature bits, Metal `supports_op` bits, CPU features), a per-family **op recording** the planner asks `ggml_backend_dev_supports_op` about, a bench cache whose keys carry a **generation** that invalidates on a native/driver change, and a planner gate that stops offering a TTS deployment the device cannot execute — with nothing else about recommendation or placement changing.

**Architecture:** Two new C ABI calls behind ABI 2 (`sk_device_profile_get`, `sk_device_supports_ops`) over ggml's public `supports_op` and a loader-dlopen'd Vulkan enumeration; a build-time-generated table of node descriptors recorded from real forward passes (`native/src/ops/*.ops`); the sidecar's `Machine` gains `devices`/`generation`, every bench key gains the generation prefix on both the write and read side, and `_deployment_available` replaces `_tier_available` at every deployment gate with an injected, precomputed op-coverage callable so the planner stays pure; `hardware_info_result` carries the profile to LogsPanel.

**Tech Stack:** C++17 (`native/`), CMake + FetchContent (Vulkan-Headers), ggml v0.22.0 public API, ctypes binding (`native/python/sokuji_native`), Python 3.12 sidecar with pytest, TypeScript/React renderer with vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-native-device-profile-design.md` (fourth draft, commit `97903372`). Review history: `docs/superpowers/notes/2026-09-04-device-profile-review-findings.md`.

## Global Constraints

- `SK_ABI_VERSION` **2** in all three places (`native/include/sokuji_native.h`, `native/python/sokuji_native/_ffi.py`, `native/CMakeLists.txt` `SK_ABI_VERSION_NUM`); native version **1.1.0**; sidecar **0.3.0**; tags `native-v1.1.0` then `sidecar-v0.3.0` in that order (spec §3.5).
- `libsokuji_native.so` must never gain a `libvulkan.so.1` DT_NEEDED or a `vulkan-1.dll` import — the loader is `dlopen`'d at profile time (spec §3.1); `native/ci/check_linux_deps.py` enforces it per file.
- Vulkan headers come from a `FetchContent` of `Vulkan-Headers` pinned at **v1.4.311** (spec §3.1); native compiles with `VK_NO_PROTOTYPES`.
- Feature structs are chained into `vkGetPhysicalDeviceFeatures2` **only** when the device lists the matching extension; all structs zero-initialised (spec §3.1).
- Premise 5: an absent or unknown profile changes nothing. `Machine` gains `devices: tuple[DeviceProfile, ...] = ()` and `generation: str = ""` with those defaults; `sidecar/tests/test_characterization.py` must not change a single matrix row (spec §1.1(5), §4).
- `bench_load() -> dict` keeps its signature and returns entries only; `bench_read()` is new for writers; `bench_save(entries, *, generation)` (spec §3.3).
- `wire_schema.json` lists only **top-level** fields: `hardware_info_result` gains optional `generation` and `devices`; `variants[].unsupportedTiers` is a nested TS-level field only (spec §3.4).
- `variants[].supported` keeps its meaning ("loadable on some tier") and stays `True` for every GGUF card (spec §3.3).
- Only the `tts` stage is gated on op coverage (`_ABORTS_ON_UNSUPPORTED = {"tts"}`); `asr`/`translate` record but never withhold a tier (spec §3.3).
- The op-coverage callable is keyword-only with default `lambda *a: None` on every planner function it threads through, so every existing test stays valid (spec §3.3).
- Coverage is computed by the accel resolve wrappers **before** the planner runs, never inside the planner, never on the `_h_models_catalog` path, never when `override == "cpu"`, and only for the first device of a kind (spec §3.3).
- Every user-visible string goes through i18n; the one new key `models.variantRunsOnCpu` is added to all 30 locale files under `src/locales/*/translation.json`.
- English-only code, comments, commit messages. Conventional commits. Commit with explicit pathspecs. Never `git stash`. Run sidecar tests as `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests -q -p no:cacheprovider`; native tests through `native/ci/build.sh <none|vulkan|metal> <plat tag>` (CTest + the Python suite against the fresh stage); renderer tests with `npx vitest run <path>`.
- Outward acts (push, PR, tag, release) require jiangzhuo's explicit per-act confirmation naming the target (Task 14 says so at each step).

---

## File structure

**native/**
- Modify `include/sokuji_native.h` — ABI 2; `sk_feature` enum; `sk_device_profile`, `sk_op_check`, `sk_op_coverage`, `SK_OP_COVERAGE_MAX`; declarations of `sk_device_profile_get` and `sk_device_supports_ops`.
- Create `src/sk_profile.cpp` — `sk_device_profile_get`: CPU features via proc address, Metal bits via `supports_op` on scratch nodes, UMA, `known`; calls into `sk_vk_enum` for Vulkan.
- Create `src/sk_vk_enum.h`, `src/sk_vk_enum.cpp` — loader `dlopen`, instance creation, physical-device records, and the pure selection helper `sk_vk_select_like_ggml()` that replicates ggml's device list.
- Create `src/sk_ops.h`, `src/sk_ops.cpp` — the node-descriptor model, `.ops` text parsing (shared by the generator and the recorder), `WEIGHT` expansion over a dtype set, node rebuild + `supports_op`, `sk_device_supports_ops`.
- Create `src/ops/<stage>-<family>.ops` — the recordings (data). Nine `tts-*.ops` before release; `asr-*`/`translate-*` as recorded.
- Create `cmake/gen_ops_data.py` — turns `src/ops/*.ops` into `${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp` at build time (a `static const` array per recording, and the `static_assert` on the cap).
- Create `src/sk_ops_record.cpp` (test build only, `SK_RECORD_OPS`) — the recording device (`ggml_backend_register`) and `sk_recording_graph_compute`; `tests/record_ops.cpp` — the `--record-ops` / `--dump` driver.
- Modify `src/audiocpp_compat.h` — under `SK_RECORD_OPS`, include `ggml-backend.h` then `#define ggml_backend_graph_compute sk_recording_graph_compute`.
- Modify `CMakeLists.txt` — `SK_ABI_VERSION_NUM 2`, `project(... VERSION 1.1.0)`, the configure-time ABI cross-check, FetchContent `Vulkan-Headers`, the ops generator custom command, `sk_profile.cpp`/`sk_vk_enum.cpp`/`sk_ops.cpp` sources, `SK_RECORD_OPS` test target.
- Modify `tests/test_common.cpp` — version `"1.1.0"`, profile assertions, `supports_ops` error paths; create `tests/test_vk_select.cpp` (pure selection helper with fake records), `tests/test_ops_coverage.cpp`; modify `tests/CMakeLists.txt`.
- Modify `python/sokuji_native/_ffi.py` — `SK_ABI_VERSION = 2`, the two structs, `bind()` lines; `python/sokuji_native/__init__.py` — `DeviceProfile`, `OpCoverage`, `device_profiles()`, `device_supports_ops()`; `python/tests/test_sokuji_native.py` — round-trips.
- Modify `ci/check_linux_deps.py` — `DENY_BY_FILE`.
- Modify `README.md` — version line, the pin-bump checklist lines for recordings.

**sidecar/**
- Modify `sokuji_sidecar/catalog.py` — `graph_family` on `_ModelBase`; `arch=` on `_tc_row` and `_llm_translate_row`; `_tts_gguf_row` sets it; `RUNG_FALLBACK_DTYPES`.
- Create `sokuji_sidecar/gguf_header.py` — minimal GGUF header reader: `general.architecture` and the tensor-dtype set.
- Modify `sokuji_sidecar/native.py` — `device_profiles()`, `device_supports_ops()`.
- Modify `sokuji_sidecar/accel.py` — `DeviceProfile`, `OpCoverage`, `Machine.devices/generation`, `_native_profiles`, `_native_identity`, `probe()`, `bench_read`/`bench_save`, `_measure` via `_cache_key`, `compute_op_coverage`/`op_coverage_for`/`cached_op_coverage`, `weight_dtypes`, the resolve wrappers, `_h_hardware_info`, `_h_models_catalog`.
- Modify `sokuji_sidecar/planner.py` — `_cache_key`, `_resolve_model`/`_tps` read side, `_STAGE_OF_BACKEND`, `_ABORTS_ON_UNSUPPORTED`, `_device_for_tier`, `_deployment_available`, the nine threaded signatures, the fit-walk restriction, the structured paravirtual rule.
- Modify `sokuji_sidecar/wire_schema.json` — `hardware_info_result.optional` += `generation`, `devices`.
- Modify tests: `tests/test_catalog.py`, `tests/test_accel.py`, `tests/test_planner.py`, `tests/test_characterization.py` (fixture + assertion only); create `tests/test_gguf_header.py`, `tests/test_device_profile.py`.

**src/ (renderer)**
- Modify `lib/local-inference/native/nativeProtocol.ts` — `HardwareInfoResultMsg` fields, `variants[].unsupportedTiers`, `VariantInfo.unsupportedTiers`.
- Modify `services/clients/LocalNativeClient.ts` — forward `generation`/`devices`.
- Modify `stores/nativeModelStore.ts` — `deviceProfiles`, `profileGeneration`, `reportedUnsupportedOps`, the once-per-session warning.
- Modify `components/Settings/sections/NativeModelManagementSection.tsx` — the muted note on enabled options.
- Modify `src/locales/*/translation.json` (30 files) — `models.variantRunsOnCpu`.
- Modify tests: `lib/local-inference/native/nativeProtocol.consistency.test.ts` (no code change expected; it reads the schema), `stores/nativeModelStore.test.ts`, `components/Settings/sections/NativeModelManagementSection.test.tsx`.

---

### Task 1: ABI 2 scaffolding, version 1.1.0, and the configure-time ABI cross-check

**Files:**
- Modify: `native/include/sokuji_native.h:42` (`SK_ABI_VERSION`), after line 95 (new types + declarations)
- Modify: `native/python/sokuji_native/_ffi.py:6, 26-28, 66-72`
- Modify: `native/CMakeLists.txt:1-10` (project version), `:120` (`SK_ABI_VERSION_NUM`), plus the new check
- Modify: `native/tests/test_common.cpp:24`
- Modify: `native/README.md` (the "Current native version is 1.0.2" sentence), `CLAUDE.md` (same sentence in the Native runtime bullet)
- Test: `native/tests/test_common.cpp`, `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Produces: the C types `sk_feature`, `sk_device_profile`, `sk_op_check`, `sk_op_coverage`, `SK_OP_COVERAGE_MAX`; declarations `sk_device_profile_get(int32_t, sk_device_profile *)` and `sk_device_supports_ops(int32_t, const char *, const char *, const char *const *, int32_t, sk_op_coverage *)`; ctypes mirrors `_ffi.sk_device_profile`, `_ffi.sk_op_check`, `_ffi.sk_op_coverage`, `_ffi.SK_OP_COVERAGE_MAX`, and the `bind()` entries. Tasks 2–5 implement the two functions; until then they return `SK_ERR_INTERNAL` from a stub so the library links.

- [ ] **Step 1: Bump the four version/ABI sites and write the failing CTest assertion**

In `native/tests/test_common.cpp` change line 24 to:

```cpp
    assert(std::string(sk_version()) == "1.1.0");
```

and, after the `assert(saw_cpu);` block (line 75), add:

```cpp
    // ABI 2: the profile call exists, rejects a bad index before anything else,
    // and refuses to run before sk_init (checked above the init below in Task 2).
    sk_device_profile prof = {};
    assert(sk_device_profile_get(-1, &prof) == SK_ERR_INVALID_ARGUMENT);
    assert(sk_device_profile_get(0, nullptr) == SK_ERR_INVALID_ARGUMENT);
```

- [ ] **Step 2: Run the CTest to see it fail to compile**

Run: `cd native && cmake --build build/cpu --target test_common 2>&1 | tail -5`
Expected: error: `sk_device_profile` / `sk_device_profile_get` not declared.

- [ ] **Step 3: Add the types and declarations to the header**

In `native/include/sokuji_native.h`, change line 42 to `#define SK_ABI_VERSION 2`, and insert after the `sk_device` typedef (line 95):

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
#define SK_OP_COVERAGE_MAX 128
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

- [ ] **Step 4: Add a stub implementation so the library links**

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

SK_API sk_status sk_device_supports_ops(int32_t index, const char *stage, const char *family,
                                        const char *const *weight_dtypes, int32_t n_weight_dtypes,
                                        sk_op_coverage *out) {
    (void)index; (void)stage; (void)family; (void)weight_dtypes; (void)n_weight_dtypes; (void)out;
    sk::set_error("sk_device_supports_ops: not implemented yet");   // Task 5 replaces this body
    return SK_ERR_INTERNAL;
}

}  // extern "C"
```

Note the argument checks run **before** `require_init` for the NULL/negative cases so the Step 1 assertions hold pre-init too; Task 2 keeps that order.

In `native/CMakeLists.txt` change `target_sources(sokuji_native PRIVATE src/sk_selftest.cpp src/sk_asr.cpp src/sk_translate.cpp src/sk_tts.cpp)` to include `src/sk_profile.cpp`, change `project(sokuji_native VERSION 1.0.2 …)` at the top to `1.1.0`, and change `set(SK_ABI_VERSION_NUM 1)` to `set(SK_ABI_VERSION_NUM 2)`.

- [ ] **Step 5: Add the configure-time ABI cross-check**

In `native/CMakeLists.txt`, directly after `set(SK_ABI_VERSION_NUM 2)`:

```cmake
# The ABI number lives in three places nothing used to cross-check: this variable (stamped
# into contract.json), the header (what the library reports), and the binding's _ffi.py
# (what the binding demands). The binding refuses a mismatch at import — after a full
# five-SKU build. Catch the header/CMake drift here, at configure time.
file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/include/sokuji_native.h _sk_abi_line
     REGEX "^#define SK_ABI_VERSION [0-9]+")
string(REGEX REPLACE "^#define SK_ABI_VERSION ([0-9]+).*$" "\\1" _sk_abi_header "${_sk_abi_line}")
if(NOT _sk_abi_header STREQUAL "${SK_ABI_VERSION_NUM}")
    message(FATAL_ERROR "SK_ABI_VERSION_NUM (${SK_ABI_VERSION_NUM}) != include/sokuji_native.h SK_ABI_VERSION (${_sk_abi_header})")
endif()
```

- [ ] **Step 6: Mirror the ABI and the structs in the binding**

In `native/python/sokuji_native/_ffi.py`: line 6 → `SK_ABI_VERSION = 2`; after the `sk_device` Structure (line 28) add:

```python
SK_OP_COVERAGE_MAX = 128


class sk_device_profile(Structure):
    _fields_ = [("index", c_int32), ("known", c_int32), ("features", c_uint32),
                ("driver_name", c_char * 256), ("driver_version", c_char * 256),
                ("device_uuid", c_char * 40), ("cpu_features", c_char * 512)]


class sk_op_check(Structure):
    _fields_ = [("name", c_char * 64), ("supported", c_int32)]


class sk_op_coverage(Structure):
    _fields_ = [("n_ops", c_int32), ("all_supported", c_int32),
                ("ops", sk_op_check * SK_OP_COVERAGE_MAX)]


FEATURE_BITS = {  # sk_feature, lower-case without the SK_FEAT_ prefix (the DeviceProfile.features names)
    1 << 0: "vk_shader_float16", 1 << 1: "vk_shader_bfloat16", 1 << 2: "vk_integer_dot",
    1 << 3: "vk_coopmat", 1 << 4: "vk_coopmat2",
    1 << 5: "mtl_simdgroup_reduction", 1 << 6: "mtl_bfloat", 1 << 7: "uma",
}
```

(`c_uint32` is already imported beside `c_uint64`; add it to the import line if it is not.) In `bind()` after the `sk_device_free_mem` lines add:

```python
    lib.sk_device_profile_get.argtypes = [c_int32, POINTER(sk_device_profile)]
    lib.sk_device_profile_get.restype = c_int32
    lib.sk_device_supports_ops.argtypes = [c_int32, c_char_p, c_char_p, POINTER(c_char_p), c_int32,
                                           POINTER(sk_op_coverage)]
    lib.sk_device_supports_ops.restype = c_int32
```

- [ ] **Step 7: Update the version sentences**

`native/README.md`: replace `Current native version is 1.0.2.` with `Current native version is 1.1.0 (ABI 2: device profile and op coverage — see docs/superpowers/specs/2026-09-04-native-device-profile-design.md).` In `CLAUDE.md`'s Native runtime bullet, replace `Current native version is 1.0.2.` the same way. In `native/README.md`'s "Bumping a pin" step 4, change "the **two** places" to "the **three** places" and add `SK_ABI_VERSION_NUM` in `CMakeLists.txt` (only when the ABI changes) to the list.

- [ ] **Step 8: Build and run the CTest; run the binding's contract test**

Run: `cd native && ci/build.sh none linux_aarch64 2>&1 | tail -15` (or the lane/tag for your box)
Expected: configure passes the ABI check; `test_common` passes (its profile calls return `SK_ERR_INVALID_ARGUMENT` for the two bad-argument cases); the Python suite's `contract()` test reports `abi == 2`.

Also run a deliberate mismatch once: `cmake -S native -B /tmp/abi-mismatch -DSOKUJI_GPU=none -DSK_ABI_VERSION_NUM=1 2>&1 | grep FATAL` — expected: the FATAL_ERROR line. Delete `/tmp/abi-mismatch`.

- [ ] **Step 9: Commit**

```bash
git add native/include/sokuji_native.h native/src/sk_profile.cpp native/CMakeLists.txt native/tests/test_common.cpp \
        native/python/sokuji_native/_ffi.py native/README.md CLAUDE.md
git commit -m "native: ABI 2 — device profile and op coverage types, version 1.1.0, configure-time ABI check"
```

---

### Task 2: `sk_device_profile_get` — CPU features, Metal bits, `known`, plus the binding wrapper

**Files:**
- Modify: `native/src/sk_profile.cpp` (replace the stub body from Task 1)
- Modify: `native/tests/test_common.cpp` (profile assertions)
- Modify: `native/python/sokuji_native/__init__.py` (`DeviceProfile`, `device_profiles()`)
- Test: `native/tests/test_common.cpp`, `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Consumes: Task 1's types; `sk::devices()`, `sk::kind_of()`, `sk::mutex()` from `sk_internal.h`.
- Produces: `sk_device_profile_get` for CPU and Metal devices (Vulkan devices report `known = 0` until Task 3 fills them); Python `DeviceProfile(index, kind, name, description, mem_total, known, features: frozenset[str], driver_name, driver_version, device_uuid, cpu_features)` and `device_profiles() -> list[DeviceProfile]` (one per `devices()` entry).

- [ ] **Step 1: Write the failing CTest assertions**

In `native/tests/test_common.cpp`, replace the two Task-1 assertions with (keep the two bad-argument lines, then add):

```cpp
    // Before init: refused. (Placed before sk_init below by moving this block up: the
    // two bad-argument asserts stay where they are; this one must precede sk_init.)
```

Move a single line `assert(sk_device_profile_get(0, &prof) == SK_ERR_NOT_INITIALISED);` to just after the pre-init `sk_device_free_mem` assertions (line 33), with `sk_device_profile prof = {};` declared above it. Then after the device loop (after `assert(saw_cpu);`) add:

```cpp
    for (int i = 0; i < n; ++i) {
        sk_device_profile p = {};
        assert(sk_device_profile_get(i, &p) == SK_OK);
        assert(p.index == i);
        if (devs[i].kind == SK_DEVICE_CPU) {
            assert(p.known == 1);
            assert(p.cpu_features[0] != '\0');                    // ggml_backend_get_features reached
            assert(std::strlen(p.cpu_features) < sizeof p.cpu_features - 1);   // fits, not truncated
            assert(p.driver_name[0] == '\0');
        }
        if (devs[i].kind == SK_DEVICE_METAL) {
            assert(p.known == 1);
            assert(std::strcmp(p.driver_name, "Metal") == 0);
            assert(p.driver_version[0] != '\0');                  // kern.osversion
            assert(p.features & SK_FEAT_UMA);
            const bool paravirtual = std::strstr(devs[i].description, "aravirtual") != nullptr;
            if (paravirtual) {
                assert(!(p.features & SK_FEAT_MTL_SIMDGROUP_REDUCTION));   // the structured R36 signal
            } else {
                assert(p.features & SK_FEAT_MTL_SIMDGROUP_REDUCTION);
                assert(p.features & SK_FEAT_MTL_BFLOAT);
            }
        }
    }
    assert(sk_device_profile_get(n + 5, &prof) == SK_ERR_INVALID_ARGUMENT);
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd native && cmake --build build/cpu --target test_common && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure 2>&1 | tail -5`
Expected: FAIL — `sk_device_profile_get(i, &p) == SK_OK` (the stub returns `SK_ERR_INTERNAL`).

- [ ] **Step 3: Implement the CPU and Metal branches**

Replace `native/src/sk_profile.cpp` with:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"
#include "sk_vk_enum.h"        // Task 3; until then a header with the two declarations below and a stub .cpp

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

/* "NAME=value,NAME=value" from the loaded CPU registration — the one capability hook the
 * CPU and Metal registrations expose through get_proc_address (ggml_get_type_traits_cpu
 * is NOT reachable: it lives in the dlopen'd module). Reports the variant ggml chose. */
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

/* One scratch node, asked of the device's own supports_op. `no_alloc`: nothing is
 * allocated on the device and nothing runs, so this cannot GGML_ABORT. */
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
                out->known = sk_vk_fill_profile(dev, ggml_backend_dev_description(dev), out) ? 1 : 0;   // Task 3
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

Create `native/src/sk_vk_enum.h` (Task 3 fills the implementation; this task ships a stub so the file compiles on every lane):

```cpp
/* Vulkan device profile through the LOADER, never through ggml-vulkan's private structs
 * and never by linking libvulkan: sk_vk_enum.cpp dlopens the loader at call time. */
#pragma once
#include "sokuji_native.h"
#include "ggml-backend.h"

/* Fill driver/uuid/features/uma for the ggml Vulkan device `dev` (whose ggml description is
 * `description`). Returns false — and leaves `out` untouched — when the loader is absent,
 * the enumeration fails, or the device list does not match ggml's (spec §3.1). */
bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out);
```

and a stub `native/src/sk_vk_enum.cpp`:

```cpp
#include "sk_vk_enum.h"
bool sk_vk_fill_profile(ggml_backend_dev_t, const char *, sk_device_profile *) { return false; }   // Task 3
```

Add `src/sk_vk_enum.cpp` to `target_sources(sokuji_native ...)`.

- [ ] **Step 4: Run the CTest to see it pass**

Run: `cd native && cmake --build build/cpu && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure 2>&1 | tail -3`
Expected: PASS (on the CPU lane only the CPU branch is exercised). On a Metal box (`ci/build.sh metal macosx_11_0_arm64` on the M4) the Metal assertions pass; on CI's paravirtual runner the inverse assertion passes.

- [ ] **Step 5: Write the failing binding test**

In `native/python/tests/test_sokuji_native.py`, next to the existing devices test, add:

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

Run: `cd native/python && python -m pytest tests/test_sokuji_native.py -k device_profiles -q` — Expected: FAIL, `AttributeError: device_profiles`.

- [ ] **Step 6: Add the wrapper**

In `native/python/sokuji_native/__init__.py`, after the `Device` dataclass add:

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

Run: `cd native/python && SOKUJI_NATIVE_DIR=../build/cpu/stage python -m pytest tests/test_sokuji_native.py -k device_profiles -q`
Expected: PASS.

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
- Create: `native/tests/test_vk_select.cpp`; Modify: `native/tests/CMakeLists.txt`, `native/tests/test_common.cpp`
- Test: `native/tests/test_vk_select.cpp`, `native/tests/test_common.cpp`

**Interfaces:**
- Consumes: Task 2's `sk_vk_fill_profile` declaration.
- Produces: the pure selection helper
  ```cpp
  struct sk_vk_record { std::string name; std::string uuid_hex; std::string luid_hex; bool luid_valid;
                        int32_t device_type; int32_t driver_id; bool storage16; uint32_t features;
                        std::string driver_name, driver_info; };
  std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env);
  ```
  returning the raw indices that survive ggml's selection, in ggml's order; and `sk_vk_fill_profile` implemented over it.

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
// INTEL_PROPRIETARY_WINDOWS 5, INTEL_OPEN_SOURCE_MESA 6, MESA_LLVMPIPE 13, MOLTENVK 14,
// MESA_TURNIP 18, QUALCOMM_PROPRIETARY 12, MESA_NVK 24, MESA_DOZEN 23.
int main() {
    // Dual ICD, one card: RADV (3) beats AMDVLK (2) beats proprietary (1).
    {
        std::vector<sk_vk_record> raw = { rec("RX 7800", "aaaa", 2, 2), rec("RX 7800", "aaaa", 2, 3) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    // llvmpipe (type CPU) ahead of a real GPU is dropped; virtual GPUs too.
    {
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("Arc A770", "cccc", 2, 6), rec("virt", "dddd", 3, 6) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    // No 16-bit storage → dropped.
    {
        std::vector<sk_vk_record> raw = { rec("old", "eeee", 2, 4, /*s16*/ false), rec("new", "ffff", 2, 4) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    // GGML_VK_VISIBLE_DEVICES = raw indices, no filtering at all.
    {
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("Arc", "cccc", 2, 6) };
        auto sel = sk_vk_select_like_ggml(raw, "0,1");
        assert(sel.size() == 2 && sel[0] == 0 && sel[1] == 1);
    }
    // Nothing survives → the first non-CPU device.
    {
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("virt", "dddd", 3, 6) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    // Two MoltenVK entries for one UUID are NOT collapsed.
    {
        std::vector<sk_vk_record> raw = { rec("M4", "1111", 1, 14), rec("M4", "1111", 1, 14) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 2);
    }
    return 0;
}
```

Register it in `native/tests/CMakeLists.txt`:

```cmake
# Spec A: the pure Vulkan-selection helper (no loader, no GPU) — runs on every lane.
add_executable(test_vk_select test_vk_select.cpp ../src/sk_vk_enum.cpp)
target_include_directories(test_vk_select PRIVATE ../src ../include)
target_link_libraries(test_vk_select PRIVATE ggml)
target_compile_definitions(test_vk_select PRIVATE SK_VK_ENUM_NO_LOADER=1)   # selection only; no dlopen path compiled
add_test(NAME test_vk_select COMMAND test_vk_select)
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd native && cmake -S . -B build/cpu -DSOKUJI_GPU=none && cmake --build build/cpu --target test_vk_select 2>&1 | tail -3`
Expected: error — `sk_vk_record` / `sk_vk_select_like_ggml` not declared.

- [ ] **Step 3: Declare the record and helper; implement the selection**

`native/src/sk_vk_enum.h` becomes:

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
 *  - else keep DISCRETE/INTEGRATED devices with 16-bit storage, collapse duplicates by
 *    UUID (or LUID when valid; never when both drivers are MoltenVK) keeping the driver
 *    ggml's priority table prefers; if nothing survives, the first non-CPU device.
 * Returns raw indices in ggml's order. Pure: unit-tested with fake records. */
std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env);

/* Fill driver/uuid/features/uma for ggml Vulkan device `dev`. false (out untouched) when
 * the loader is absent, the enumeration fails, or the selected list does not match
 * ggml's Vulkan device count (a mismatch is logged with both lists). */
bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out);
```

`native/src/sk_vk_enum.cpp`, the selection part (the loader part comes in Step 5):

```cpp
#include "sk_vk_enum.h"
#include "sk_internal.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <map>
#include <sstream>

namespace {

// VkPhysicalDeviceType / VkDriverId numeric values (vulkan_core.h); kept as literals so
// the pure selection compiles without the headers on every lane.
constexpr int32_t kTypeIntegrated = 1, kTypeDiscrete = 2, kTypeCpu = 4;
constexpr int32_t kAmdProprietary = 1, kAmdOpenSource = 2, kMesaRadv = 3, kNvidiaProprietary = 4,
                  kIntelProprietaryWindows = 5, kIntelOpenSourceMesa = 6, kQualcommProprietary = 12,
                  kMoltenVk = 14, kMesaTurnip = 18, kMesaDozen = 23, kMesaNvk = 24;

/* PINNED to ggml v0.22.0 ggml-vulkan.cpp ggml_vk_instance_init's driver_priorities (lines
 * ~7515-7545): lower is better. Re-check on every ggml pin bump (native/README.md). */
int priority(int32_t driver_id) {
    switch (driver_id) {
        case kMesaRadv:               return 1;
        case kAmdOpenSource:          return 2;
        case kAmdProprietary:         return 3;
        case kIntelOpenSourceMesa:    return 1;
        case kIntelProprietaryWindows: return 2;
        case kNvidiaProprietary:      return 1;
        case kMesaNvk:                return 2;
        case kQualcommProprietary:    return 1;
        case kMesaTurnip:             return 2;
        case kMesaDozen:              return 100;
        default:                      return 50;
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
    // Collapse duplicates: same UUID, or same LUID when valid; never when both are MoltenVK.
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
// Step 5 adds the loader path here.
#endif
```

- [ ] **Step 4: Run the selection test to see it pass**

Run: `cd native && cmake --build build/cpu --target test_vk_select && ctest --test-dir build/cpu -R test_vk_select --output-on-failure | tail -3`
Expected: PASS.

- [ ] **Step 5: Add the Vulkan headers and the loader-driven enumeration**

In `native/CMakeLists.txt`, after `include(cmake/upstreams.cmake)`:

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

(place it after the `add_library(sokuji_native ...)` block, since it links the target). Then replace the `#if !defined(SK_VK_ENUM_NO_LOADER)` block in `sk_vk_enum.cpp` with:

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

/* ggml's own Vulkan device count: the devices whose registry is "Vulkan" among sk::devices(). */
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
    if (r.name != description) {                     // belt and braces: positional match must agree by name
        sk::log_line(2, ("sk_device_profile_get: positional match disagrees with ggml description (" + r.name + " vs " + description + ")").c_str());
        return false;
    }
    std::snprintf(out->driver_name, sizeof out->driver_name, "%s", r.driver_name.c_str());
    std::snprintf(out->driver_version, sizeof out->driver_version, "%s", r.driver_info.c_str());
    std::snprintf(out->device_uuid, sizeof out->device_uuid, "%s", r.uuid_hex.c_str());
    out->features = r.features;
    return true;
}
#else
bool sk_vk_fill_profile(ggml_backend_dev_t, const char *, sk_device_profile *) { return false; }
#endif
```

- [ ] **Step 6: Add the real-device assertions to `test_common.cpp` and the per-file dependency rule**

In the profile loop of `test_common.cpp` (Task 2, Step 1) add:

```cpp
        if (devs[i].kind == SK_DEVICE_VULKAN && p.known) {
            assert(std::strlen(p.device_uuid) == 32);
            assert(p.driver_name[0] != '\0');
        }
```

(`known` may legitimately be 0 on a Vulkan box without a loader on PATH — CI's Vulkan lanes have one, and the Python suite in Step 7 asserts `known` there.)

In `native/ci/check_linux_deps.py`, after `ALLOWED_PREFIXES` add:

```python
# Spec A §3.1: the profile enumerates Vulkan through the dlopen'd loader; the host library
# itself must never need it, or a machine without the loader loses the whole wheel instead
# of just its Vulkan devices. The dlopen'd ggml-vulkan module may (it always has).
DENY_BY_FILE = {"libsokuji_native.so": {"libvulkan.so.1"}}
```

and inside the `for lib in needed:` loop, before the `if lib in ALLOWED ...` line:

```python
            if lib in DENY_BY_FILE.get(path.name, set()):
                problems.append(f"{path.name}: must not need {lib} (spec A: the loader is dlopen'd at profile time)")
                continue
```

- [ ] **Step 7: Build the Vulkan lane on a Vulkan box and run everything**

On GB10: `cd native && LD_LIBRARY_PATH=/home/jiangzhuo/.claude/jobs/387091ff/tmp/vulkan-tools/lib:$LD_LIBRARY_PATH PATH=/home/jiangzhuo/.claude/jobs/387091ff/tmp/vulkan-tools/bin:$PATH ci/build.sh vulkan manylinux_2_35_aarch64 2>&1 | tail -20` (the glslc note in `native/README.md` / the fleet memory applies).
Expected: `test_common`, `test_vk_select` pass; `check_linux_deps.py` passes with `libsokuji_native.so` free of `libvulkan.so.1`; the Python `device_profiles` test shows the GB10 profile `known=True`, a 32-char uuid, `driver_name` "NVIDIA".

Then verify the deny rule bites: `readelf -d build/vulkan/stage/libsokuji_native.so | grep -c libvulkan` — Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add native/src/sk_vk_enum.h native/src/sk_vk_enum.cpp native/CMakeLists.txt native/tests/test_vk_select.cpp \
        native/tests/CMakeLists.txt native/tests/test_common.cpp native/ci/check_linux_deps.py
git commit -m "native: Vulkan profile through the dlopen'd loader; device matching replicates ggml's selection"
```

---

### Task 4: The op recorder — node descriptors, the `.ops` format, the recording device and the audio.cpp shim

**Files:**
- Create: `native/src/sk_ops.h` (descriptor model + text format, shared by recorder, generator and query)
- Create: `native/src/sk_ops_format.cpp` (format/parse; no ggml backend calls)
- Create: `native/src/sk_ops_record.cpp` (recording device + `sk_recording_graph_compute`; compiled only with `SK_RECORD_OPS`)
- Create: `native/tests/record_ops.cpp` (the `--record-ops` driver)
- Modify: `native/src/audiocpp_compat.h` (the `SK_RECORD_OPS` shim), `native/CMakeLists.txt`, `native/tests/CMakeLists.txt`
- Create: `native/src/ops/tts-<family>.ops` ×9, `native/src/ops/asr-whisper.ops`, `native/src/ops/asr-moonshine.ops`, `native/src/ops/translate-qwen3.ops` (recorded data)
- Test: `native/tests/test_ops_format.cpp` (round-trip of the text format)

**Interfaces:**
- Produces:
  ```cpp
  struct sk_op_desc {                       // one recorded node
      int32_t op;                           // ggml_op
      std::array<int32_t, 16> op_params;    // raw, as ggml stores them (GGML_MAX_OP_PARAMS / sizeof(int32_t))
      int32_t dst_type;                     // ggml_type
      std::array<int32_t, 5> src_type;      // ggml_type per source; -1 = absent; -2 = WEIGHT
      std::array<int64_t, 4> ne_src0, ne_src1, ne_dst;
      bool contig_src0, contig_src1;
      uint64_t max_bytes;                   // largest ggml_nbytes seen among src0/src1/dst
  };
  struct sk_op_recording { std::string stage, family, engine, source_file; std::vector<std::string> dtypes_in_file; std::vector<sk_op_desc> nodes; };
  std::string sk_ops_format(const sk_op_recording &);          // the .ops text
  bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error);
  std::string sk_op_spelling(const sk_op_desc &, const char *weight_type_name /* or nullptr */);   // "OP.param[src0,...]->dst"
  ```
  and, under `SK_RECORD_OPS`: `void sk_record_begin(const std::set<std::string> &weight_names); void sk_record_node(const ggml_tensor *); sk_op_recording sk_record_end();` plus `ggml_backend_dev_t sk_register_recording_device();` and `enum ggml_status sk_recording_graph_compute(ggml_backend_t, ggml_cgraph *);`.

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
    r.source_file = "supertonic-3-f16.gguf"; r.dtypes_in_file = {"F16", "F32"};
    sk_op_desc d{};
    d.op = GGML_OP_MUL_MAT; d.dst_type = GGML_TYPE_F32;
    d.src_type = {-2, GGML_TYPE_F32, -1, -1, -1};
    d.ne_src0 = {1024, 1024, 1, 1}; d.ne_src1 = {1024, 1, 1, 1}; d.ne_dst = {1024, 1, 1, 1};
    d.contig_src0 = d.contig_src1 = true; d.max_bytes = 4194304;
    r.nodes.push_back(d);
    sk_op_desc u{};
    u.op = GGML_OP_UNARY; u.op_params[0] = GGML_UNARY_OP_GELU; u.dst_type = GGML_TYPE_F32;
    u.src_type = {GGML_TYPE_F32, -1, -1, -1, -1};
    u.ne_src0 = {4096, 1, 1, 1}; u.ne_dst = {4096, 1, 1, 1}; u.contig_src0 = true; u.max_bytes = 16384;
    r.nodes.push_back(u);

    std::string text = sk_ops_format(r);
    assert(text.find("# stage: tts ; family: supertonic") != std::string::npos);
    assert(text.find("# dtypes-in-file: F16 F32") != std::string::npos);
    sk_op_recording back; std::string err;
    assert(sk_ops_parse(text, back, err));
    assert(back.nodes.size() == 2 && back.family == "supertonic" && back.dtypes_in_file.size() == 2);
    assert(back.nodes[0].src_type[0] == -2 && back.nodes[0].max_bytes == 4194304);
    assert(back.nodes[1].op_params[0] == GGML_UNARY_OP_GELU);
    assert(sk_op_spelling(back.nodes[0], "q8_0") == "MUL_MAT[q8_0,f32,-,-,-]->f32");
    assert(sk_op_spelling(back.nodes[1], nullptr) == "UNARY.GELU[f32,-,-,-,-]->f32");
    assert(!sk_ops_parse("op=NOPE dst=f32\n", back, err) && !err.empty());
    return 0;
}
```

Register in `native/tests/CMakeLists.txt`:

```cmake
add_executable(test_ops_format test_ops_format.cpp ../src/sk_ops_format.cpp)
target_include_directories(test_ops_format PRIVATE ../src ../include)
target_link_libraries(test_ops_format PRIVATE ggml)
add_test(NAME test_ops_format COMMAND test_ops_format)
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd native && cmake -S . -B build/cpu -DSOKUJI_GPU=none && cmake --build build/cpu --target test_ops_format 2>&1 | tail -3`
Expected: error — `sk_ops.h` not found.

- [ ] **Step 3: Write the descriptor model and the text format**

`native/src/sk_ops.h`:

```cpp
/* Op recordings (spec A §3.2): what a family's graph asked of ggml, node by node, captured
 * on one real forward pass and rebuilt for ggml_backend_dev_supports_op. This header is
 * the shared model; sk_ops_format.cpp is the text form, sk_ops_record.cpp (test build)
 * captures, cmake/gen_ops_data.py bakes the shipped .ops files into the library, and
 * sk_ops.cpp answers sk_device_supports_ops. */
#pragma once
#include <array>
#include <cstdint>
#include <set>
#include <string>
#include <vector>

constexpr int32_t SK_SRC_ABSENT = -1;
constexpr int32_t SK_SRC_WEIGHT = -2;   // dtype comes from the model file: expanded per rung at query time

struct sk_op_desc {
    int32_t op = 0;
    std::array<int32_t, 16> op_params{};
    int32_t dst_type = 0;
    std::array<int32_t, 5> src_type{SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT, SK_SRC_ABSENT};
    std::array<int64_t, 4> ne_src0{1, 1, 1, 1}, ne_src1{1, 1, 1, 1}, ne_dst{1, 1, 1, 1};
    bool contig_src0 = true, contig_src1 = true;
    uint64_t max_bytes = 0;
    /* Identity for de-duplication: everything except max_bytes (which is max'ed). */
    bool same_node(const sk_op_desc &o) const {
        return op == o.op && op_params == o.op_params && dst_type == o.dst_type && src_type == o.src_type &&
               ne_src0 == o.ne_src0 && ne_src1 == o.ne_src1 && ne_dst == o.ne_dst &&
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
/* "OP.param[src0,src1,src2,src3,src4]->dst" with ggml_op_name()/ggml_type_name(); "-" for
 * an absent source; WEIGHT sources spelled as `weight_type_name` (nullptr → "WEIGHT").
 * UNARY/GLU carry their kind after the dot; ROPE its mode; everything else no suffix. */
std::string sk_op_spelling(const sk_op_desc &d, const char *weight_type_name);
/* The parsed, de-duplicated descriptor with max_bytes merged into an existing equal node. */
void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d);
```

`native/src/sk_ops_format.cpp`:

```cpp
#include "sk_ops.h"
#include "ggml.h"

#include <cstdio>
#include <cstring>
#include <sstream>

namespace {

int32_t type_from_name(const std::string &s) {
    if (s == "-") return SK_SRC_ABSENT;
    if (s == "WEIGHT") return SK_SRC_WEIGHT;
    for (int t = 0; t < GGML_TYPE_COUNT; ++t)
        if (ggml_type_name(static_cast<ggml_type>(t)) && s == ggml_type_name(static_cast<ggml_type>(t))) return t;
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
std::string ne(const std::array<int64_t, 4> &a) {
    return "[" + std::to_string(a[0]) + "," + std::to_string(a[1]) + "," + std::to_string(a[2]) + "," + std::to_string(a[3]) + "]";
}
bool parse_ne(const std::string &s, std::array<int64_t, 4> &out) {
    return std::sscanf(s.c_str(), "[%lld,%lld,%lld,%lld]", (long long *)&out[0], (long long *)&out[1], (long long *)&out[2], (long long *)&out[3]) == 4;
}
std::string hexparams(const sk_op_desc &d) {
    bool any = false; for (int v : d.op_params) any |= v != 0;
    if (!any) return "-";
    char buf[16 * 9]; std::string s;
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

}  // namespace

std::string sk_op_spelling(const sk_op_desc &d, const char *weight) {
    std::string s = ggml_op_name(static_cast<ggml_op>(d.op)) + param_suffix(d) + "[";
    for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], weight); }
    return s + "]->" + type_name(d.dst_type, weight);
}

void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d) {
    for (auto &n : nodes) if (n.same_node(d)) { if (d.max_bytes > n.max_bytes) n.max_bytes = d.max_bytes; return; }
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
        s += " ne0=" + ne(d.ne_src0) + " ne1=" + ne(d.ne_src1) + " ned=" + ne(d.ne_dst);
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
            else if (k == "dst") { d.dst_type = type_from_name(v); if (d.dst_type < 0) return fail("bad dst type " + v); ++seen; }
            else if (k == "src") {
                if (v.size() < 2 || v.front() != '[' || v.back() != ']') return fail("bad src list");
                std::istringstream ss(v.substr(1, v.size() - 2)); std::string t; int i = 0;
                while (std::getline(ss, t, ',') && i < 5) { d.src_type[i] = type_from_name(t); if (d.src_type[i] == -100) return fail("bad src type " + t); ++i; }
            }
            else if (k == "ne0") { if (!parse_ne(v, d.ne_src0)) return fail("bad ne0"); }
            else if (k == "ne1") { if (!parse_ne(v, d.ne_src1)) return fail("bad ne1"); }
            else if (k == "ned") { if (!parse_ne(v, d.ne_dst)) return fail("bad ned"); }
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

- [ ] **Step 5: Write the recorder — capture, the recording device, and the audio.cpp shim**

`native/src/sk_ops_record.cpp` (compiled only into the test-build library; see Step 6):

```cpp
/* Test-build-only recorder (SK_RECORD_OPS). Two capture paths feed one descriptor set:
 *  - a registered RECORDING DEVICE (ggml_backend_register) for llama.cpp / transcribe.cpp,
 *    which take a ggml_backend_dev_t and run through ggml_backend_sched — it accepts every
 *    op and every buffer type so the scheduler routes every node to it, records, and forwards
 *    to a real CPU backend;
 *  - a redirected ggml_backend_graph_compute for audio.cpp, which picks its own device by
 *    backend type and computes single-backend (audiocpp_compat.h, under SK_RECORD_OPS). */
#include "sk_ops.h"
#include "ggml.h"
#include "ggml-backend.h"
#include "ggml-backend-impl.h"
#include "ggml-cpu.h"

#include <cstring>
#include <mutex>
#include <set>

namespace {
std::mutex g_rec_mutex;
std::set<std::string> g_weight_names;
std::vector<sk_op_desc> g_nodes;
bool g_recording = false;
ggml_backend_t g_cpu = nullptr;

int32_t src_type_of(const ggml_tensor *t) {
    if (!t) return SK_SRC_ABSENT;
    const char *name = ggml_get_name(t);
    if (name && *name && g_weight_names.count(name)) return SK_SRC_WEIGHT;
    return static_cast<int32_t>(t->type);
}
}  // namespace

void sk_record_begin(const std::set<std::string> &weight_names) {
    std::lock_guard<std::mutex> l(g_rec_mutex);
    g_weight_names = weight_names; g_nodes.clear(); g_recording = true;
}

void sk_record_node(const ggml_tensor *node) {
    if (!node || node->op == GGML_OP_NONE || node->op == GGML_OP_VIEW || node->op == GGML_OP_RESHAPE ||
        node->op == GGML_OP_PERMUTE || node->op == GGML_OP_TRANSPOSE) return;   // no-op views: never asked of a backend
    std::lock_guard<std::mutex> l(g_rec_mutex);
    if (!g_recording) return;
    sk_op_desc d{};
    d.op = node->op;
    std::memcpy(d.op_params.data(), node->op_params, sizeof d.op_params);
    d.dst_type = node->type;
    for (int i = 0; i < 5 && i < GGML_MAX_SRC; ++i) d.src_type[i] = src_type_of(node->src[i]);
    for (int i = 0; i < 4; ++i) {
        d.ne_dst[i] = node->ne[i];
        d.ne_src0[i] = node->src[0] ? node->src[0]->ne[i] : 1;
        d.ne_src1[i] = node->src[1] ? node->src[1]->ne[i] : 1;
    }
    d.contig_src0 = !node->src[0] || ggml_is_contiguous(node->src[0]);
    d.contig_src1 = !node->src[1] || ggml_is_contiguous(node->src[1]);
    d.max_bytes = ggml_nbytes(node);
    if (node->src[0]) d.max_bytes = std::max<uint64_t>(d.max_bytes, ggml_nbytes(node->src[0]));
    if (node->src[1]) d.max_bytes = std::max<uint64_t>(d.max_bytes, ggml_nbytes(node->src[1]));
    sk_ops_add(g_nodes, d);
}

sk_op_recording sk_record_end() {
    std::lock_guard<std::mutex> l(g_rec_mutex);
    g_recording = false;
    sk_op_recording r; r.nodes = g_nodes; g_nodes.clear();
    return r;
}

/* audio.cpp path: every graph_compute in every audio.cpp TU lands here (compat header). */
extern "C" enum ggml_status sk_recording_graph_compute(ggml_backend_t backend, struct ggml_cgraph *cgraph) {
    for (int i = 0; i < ggml_graph_n_nodes(cgraph); ++i) sk_record_node(ggml_graph_node(cgraph, i));
    return ggml_backend_graph_compute(backend, cgraph);
}

/* llama.cpp / transcribe.cpp path: a device that accepts everything and forwards to CPU. */
namespace {
const char *rec_name(ggml_backend_t) { return "SKREC"; }
void rec_free(ggml_backend_t b) { delete b; }
enum ggml_status rec_compute(ggml_backend_t, struct ggml_cgraph *g) {
    for (int i = 0; i < ggml_graph_n_nodes(g); ++i) sk_record_node(ggml_graph_node(g, i));
    return ggml_backend_graph_compute(g_cpu, g);
}
ggml_backend_i rec_iface = {
    /* get_name */ rec_name, /* free */ rec_free,
    /* set_tensor_async */ nullptr, /* get_tensor_async */ nullptr, /* cpy_tensor_async */ nullptr,
    /* synchronize */ nullptr, /* graph_plan_create */ nullptr, /* graph_plan_free */ nullptr,
    /* graph_plan_update */ nullptr, /* graph_plan_compute */ nullptr,
    /* graph_compute */ rec_compute, /* event_record */ nullptr, /* event_wait */ nullptr,
    /* graph_optimize */ nullptr,
};
ggml_guid_t rec_guid() { static ggml_guid g = {0x53,0x4b,0x52,0x45,0x43,0,0,0,0,0,0,0,0,0,0,1}; return &g; }

const char *dev_name(ggml_backend_dev_t) { return "SKREC0"; }
const char *dev_desc(ggml_backend_dev_t) { return "sokuji op recorder"; }
void dev_memory(ggml_backend_dev_t, size_t *f, size_t *t) { *f = *t = size_t(64) << 30; }
enum ggml_backend_dev_type dev_type(ggml_backend_dev_t) { return GGML_BACKEND_DEVICE_TYPE_GPU; }
void dev_props(ggml_backend_dev_t d, ggml_backend_dev_props *p) {
    p->name = dev_name(d); p->description = dev_desc(d); dev_memory(d, &p->memory_free, &p->memory_total);
    p->type = dev_type(d); p->caps = {false, true, false, false};
}
ggml_backend_t dev_init(ggml_backend_dev_t d, const char *) {
    if (!g_cpu) g_cpu = ggml_backend_cpu_init();
    return new ggml_backend{rec_guid(), rec_iface, d, nullptr};
}
ggml_backend_buffer_type_t dev_buft(ggml_backend_dev_t) { return ggml_backend_cpu_buffer_type(); }
bool dev_supports_op(ggml_backend_dev_t, const ggml_tensor *) { return true; }      // everything routes here
bool dev_supports_buft(ggml_backend_dev_t, ggml_backend_buffer_type_t buft) { return ggml_backend_buft_is_host(buft); }
ggml_backend_device_i dev_iface = {
    dev_name, dev_desc, dev_memory, dev_type, dev_props, /* get_backend_reg */ nullptr, dev_init, dev_buft,
    /* get_host_buffer_type */ nullptr, /* buffer_from_host_ptr */ nullptr, dev_supports_op, dev_supports_buft,
    /* offload_op */ nullptr, /* event_new */ nullptr, /* event_free */ nullptr, /* event_synchronize */ nullptr,
};
const char *reg_name(ggml_backend_reg_t) { return "SKREC"; }
size_t reg_count(ggml_backend_reg_t) { return 1; }
ggml_backend_dev_t reg_get(ggml_backend_reg_t r, size_t) { static ggml_backend_device dev{dev_iface, r, nullptr}; return &dev; }
ggml_backend_reg_i reg_iface = { reg_name, reg_count, reg_get, /* get_proc_address */ nullptr };
}  // namespace

ggml_backend_dev_t sk_register_recording_device() {
    static ggml_backend_reg reg{GGML_BACKEND_API_VERSION, reg_iface, nullptr};
    static bool done = false;
    if (!done) { ggml_backend_register(&reg); done = true; }
    return reg_get(&reg, 0);
}
```

(The struct field orders above follow `ggml-backend-impl.h` at v0.22.0; the implementer confirms each initializer against that header — a mismatch is a compile error, not a silent one, because the aggregates are positional.)

`native/src/audiocpp_compat.h` — append at the end:

```cpp
#if defined(SK_RECORD_OPS)
/* Test build only: audio.cpp computes single-backend through ggml_backend_graph_compute, so
 * the op recorder intercepts that call here. ggml-backend.h is included FIRST so the real
 * prototype is declared before the macro renames later uses; the recorder's own TU is
 * compiled without this header and forwards to the real function. */
#include "ggml-backend.h"
extern "C" enum ggml_status sk_recording_graph_compute(ggml_backend_t backend, struct ggml_cgraph *cgraph);
#define ggml_backend_graph_compute sk_recording_graph_compute
#endif
```

- [ ] **Step 6: The test-build library variant and the record driver**

In `native/CMakeLists.txt`, after the `sokuji_native` target is fully defined, add an option and a second library that shares every source but adds the recorder:

```cmake
option(SOKUJI_RECORD_OPS "Build the op-recording variant of the library (tests only)" OFF)
if(SOKUJI_RECORD_OPS)
    # Same sources + the recorder; the compat header sees SK_RECORD_OPS in every audio.cpp TU
    # of THIS configure, so this must be a separate build directory (build/record), never the
    # shipping one — the shipped library must not carry the redirect.
    target_compile_definitions(sokuji_native PRIVATE SK_RECORD_OPS=1)
    target_sources(sokuji_native PRIVATE src/sk_ops_record.cpp)
    foreach(_t IN LISTS _audiocpp_engine_targets)
        target_compile_definitions(${_t} PRIVATE SK_RECORD_OPS=1)
    endforeach()
    # sk_ops_record.cpp must not see the redirect (it forwards to the real function).
    set_source_files_properties(src/sk_ops_record.cpp PROPERTIES COMPILE_OPTIONS "-USK_RECORD_OPS")
endif()
```

(On MSVC use `/USK_RECORD_OPS`; the `set_source_files_properties` line becomes a generator expression `$<IF:$<CXX_COMPILER_ID:MSVC>,/USK_RECORD_OPS,-USK_RECORD_OPS>`.) Also add `src/sk_ops_format.cpp` to `target_sources(sokuji_native ...)` unconditionally (Task 5 needs it in the shipping library too).

`native/tests/record_ops.cpp` — the driver, built only when `SOKUJI_RECORD_OPS`:

```cpp
/* record_ops <module_dir> <stage> <family> <model-dir-or-gguf> <out.ops> [--fa on|off]
 * Loads the model through the sk_* API on the recording device (asr/translate) or on the
 * CPU device with the audio.cpp shim (tts), runs one forward pass, writes the .ops file. */
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <set>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "sk_ops.h"
#include "gguf.h"
#include "ggml.h"

void sk_record_begin(const std::set<std::string> &);
sk_op_recording sk_record_end();
ggml_backend_dev_t sk_register_recording_device();

static std::string find_gguf(const std::string &path) {   // a directory → its single .gguf; a file → itself
    if (path.size() > 5 && path.substr(path.size() - 5) == ".gguf") return path;
    // audio.cpp model dirs hold exactly one .gguf (plus sidecar files); pick it.
    std::string cmd = "ls " + path + "/*.gguf";
    FILE *p = popen(cmd.c_str(), "r"); char buf[1024] = {}; std::string out;
    if (p && fgets(buf, sizeof buf, p)) out = buf; if (p) pclose(p);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
    return out;
}

int main(int argc, char **argv) {
    if (argc < 6) { std::fprintf(stderr, "usage: record_ops <module_dir> <stage> <family> <model> <out.ops> [--fa on|off]\n"); return 2; }
    std::string module_dir = argv[1], stage = argv[2], family = argv[3], model = argv[4], out_path = argv[5];
    std::string gguf_path = find_gguf(model);

    // Weight names + dtype set from the GGUF header (public gguf API).
    std::set<std::string> weights; std::set<std::string> dtypes;
    {
        gguf_init_params ip = { /*no_alloc*/ true, /*ctx*/ nullptr };
        gguf_context *g = gguf_init_from_file(gguf_path.c_str(), ip);
        assert(g && "gguf_init_from_file");
        for (int64_t i = 0; i < gguf_get_n_tensors(g); ++i) {
            weights.insert(gguf_get_tensor_name(g, i));
            dtypes.insert(ggml_type_name(gguf_get_tensor_type(g, i)));
        }
        gguf_free(g);
    }

    ggml_backend_dev_t recdev = (stage == "tts") ? nullptr : sk_register_recording_device();   // BEFORE sk_init
    sk_init_options opts = {}; opts.abi_version = SK_ABI_VERSION; opts.n_threads = 4; opts.module_dir = module_dir.c_str();
    assert(sk_init(&opts) == SK_OK);
    sk_device devs[16]; int n = sk_devices(devs, 16);
    int cpu = -1, rec = -1;
    for (int i = 0; i < n; ++i) {
        if (devs[i].kind == SK_DEVICE_CPU) cpu = i;
        if (std::strcmp(devs[i].name, "SKREC0") == 0) rec = i;
    }
    assert(cpu >= 0);
    (void)recdev;

    sk_record_begin(weights);
    if (stage == "tts") {
        sk_tts_model *m = nullptr;
        assert(sk_tts_load(model.c_str(), family.c_str(), &devs[cpu], &m) == SK_OK);
        float *pcm = nullptr; int32_t n_samples = 0, rate = 0;
        // Families that require a reference voice get a synthetic one, as the Python tests do.
        sk_tts_caps caps = {}; sk_tts_capabilities(m, &caps);
        if (caps.clones && caps.transcript_required) {
            std::vector<float> ref(24000); for (int i = 0; i < 24000; ++i) ref[i] = 0.5f * std::sin(2 * 3.14159f * 440 * i / 24000.f);
            sk_tts_set_voice(m, ref.data(), 24000, 24000, "test");
        }
        assert(sk_tts_synth(m, "The quick brown fox jumps over the lazy dog.", nullptr, &pcm, &n_samples, &rate) == SK_OK);
        sk_free(pcm); sk_tts_unload(m);
    } else if (stage == "asr") {
        assert(rec >= 0);
        sk_asr_model *m = nullptr;
        assert(sk_asr_load(gguf_path.c_str(), &devs[rec], &m) == SK_OK);
        std::vector<float> audio(16000 * 3, 0.0f); for (size_t i = 0; i < audio.size(); ++i) audio[i] = 0.1f * std::sin(2 * 3.14159f * 440 * i / 16000.f);
        char *text = nullptr;
        assert(sk_asr_transcribe(m, audio.data(), (int32_t)audio.size(), 16000, "en", &text) == SK_OK);
        sk_free(text); sk_asr_unload(m);
    } else {
        assert(rec >= 0);
        sk_translate_model *m = nullptr;
        bool fa = !(argc >= 8 && std::strcmp(argv[6], "--fa") == 0 && std::strcmp(argv[7], "off") == 0);
        sk_translate_options to = {}; to.flash_attn = fa ? 1 : 0;
        assert(sk_translate_load(gguf_path.c_str(), &devs[rec], &to, &m) == SK_OK);
        char *out = nullptr;
        assert(sk_translate_run(m, "Hello, world.", "en", "fr", nullptr, nullptr, &out) == SK_OK);
        sk_free(out); sk_translate_unload(m);
    }
    sk_op_recording r = sk_record_end();
    r.stage = stage; r.family = family; r.engine = sk_engine_versions();
    r.source_file = gguf_path.substr(gguf_path.find_last_of("/\\") + 1);
    r.dtypes_in_file.assign(dtypes.begin(), dtypes.end());
    std::ofstream(out_path) << sk_ops_format(r);
    std::printf("record_ops: %zu nodes -> %s\n", r.nodes.size(), out_path.c_str());
    return 0;
}
```

The exact `sk_tts_load` / `sk_asr_load` / `sk_translate_load` / `sk_translate_run` signatures are the ones in `native/include/sokuji_native.h` today; the implementer copies them verbatim (the names above match the header; the options struct for translate is whatever the header calls it — if it has no `flash_attn` field, record once and note that in the `.ops` engine line). Register the driver in `native/tests/CMakeLists.txt` under `if(SOKUJI_RECORD_OPS)`:

```cmake
if(SOKUJI_RECORD_OPS)
    add_executable(record_ops record_ops.cpp)
    target_link_libraries(record_ops PRIVATE sokuji_native ggml)
    target_include_directories(record_ops PRIVATE ../src)
endif()
```

- [ ] **Step 7: Build the recording variant and record the shipped `.ops` files**

Run (CPU lane, separate build dir):

```bash
cd native && cmake -S . -B build/record -DSOKUJI_GPU=none -DSOKUJI_RECORD_OPS=ON && cmake --build build/record -j
M=~/.cache/sokuji-native-tests
mkdir -p src/ops
for f in moss_tts_nano:moss-tts-nano qwen3_tts:qwen3-tts-0.6b omnivoice:omnivoice-0.6b pocket_tts:pocket-tts-en supertonic:supertonic-3 \
         voxcpm1:voxcpm1-0.5b voxcpm2:voxcpm2 irodori_tts:irodori-tts-v4-small index_tts2:index-tts2.5; do
  build/record/tests/record_ops build/record/lib tts "${f%%:*}" "$M/tts/${f#*:}" "src/ops/tts-${f%%:*}.ops"
done
build/record/tests/record_ops build/record/lib asr whisper "$M/whisper-tiny-Q8_0.gguf" src/ops/asr-whisper.ops
build/record/tests/record_ops build/record/lib asr moonshine "$M/moonshine-streaming-tiny-Q8_0.gguf" src/ops/asr-moonshine.ops
build/record/tests/record_ops build/record/lib translate qwen3 "$M/Qwen3-0.6B-Q8_0.gguf" src/ops/translate-qwen3.ops --fa on
build/record/tests/record_ops build/record/lib translate qwen3 "$M/Qwen3-0.6B-Q8_0.gguf" /tmp/qwen3-fa-off.ops --fa off
```

Then merge the two translate recordings (both flash-attention settings) into one file: `python3 - <<'EOF'` is not available under the worktree guard — use `cat /tmp/qwen3-fa-off.ops | grep '^op=' >> src/ops/translate-qwen3.ops` and let Task 5's generator de-duplicate (it calls `sk_ops_add`). Inspect one file: `head -6 src/ops/tts-voxcpm2.ops` — expected: four header lines, then `op=` lines with `WEIGHT` sources on the MUL_MATs and `BF16` in `dtypes-in-file`.

- [ ] **Step 8: Commit**

```bash
git add native/src/sk_ops.h native/src/sk_ops_format.cpp native/src/sk_ops_record.cpp native/src/audiocpp_compat.h \
        native/tests/record_ops.cpp native/tests/test_ops_format.cpp native/tests/CMakeLists.txt native/CMakeLists.txt native/src/ops/
git commit -m "native: op recorder — node descriptors, the .ops format, a recording device for llama/transcribe and a graph_compute shim for audio.cpp; nine TTS recordings"
```

---

### Task 5: `sk_device_supports_ops` — bake the recordings into the library, rebuild nodes, ask `supports_op`

**Files:**
- Create: `native/cmake/gen_ops_data.py`, `native/src/sk_ops.cpp`
- Modify: `native/CMakeLists.txt` (custom command + sources), `native/src/sk_profile.cpp` (drop the stub), `native/tests/test_common.cpp`
- Modify: `native/python/sokuji_native/__init__.py` (`OpCoverage`, `device_supports_ops()`), `native/python/tests/test_sokuji_native.py`
- Test: `native/tests/test_common.cpp`, `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Consumes: Task 4's `sk_op_recording`, `sk_ops_parse`, `sk_op_spelling`; the `.ops` files.
- Produces: `sk_device_supports_ops` (§3.2 contract); Python `OpCoverage(all_supported: bool, unsupported: tuple[str, ...], checked: tuple[str, ...])` and `device_supports_ops(index, stage, family, weight_dtypes: Iterable[str]) -> OpCoverage` raising `NativeError` with the status on error.

- [ ] **Step 1: Write the failing CTest assertions**

In `native/tests/test_common.cpp`, after the profile loop, add:

```cpp
    // Op coverage: every shipped recording, expanded over its own dtype set, is fully
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
        int n_recordings = 0;
        for (const char *fam : {"supertonic", "moss_tts_nano", "voxcpm1", "voxcpm2", "irodori_tts", "index_tts2", "qwen3_tts", "omnivoice", "pocket_tts"}) {
            const char *dts[] = {"q8_0", "bf16", "f16", "f32"};
            sk_op_coverage c = {};
            sk_status st = sk_device_supports_ops(cpu_index, "tts", fam, dts, 4, &c);
            assert(st == SK_OK);
            assert(c.n_ops > 0 && c.n_ops <= SK_OP_COVERAGE_MAX);
            assert(c.all_supported == 1);
            ++n_recordings;
        }
        assert(n_recordings == 9);
    }
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd native && cmake --build build/cpu --target test_common && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure | tail -4`
Expected: FAIL — the stub returns `SK_ERR_INTERNAL` for the first `SK_ERR_INVALID_ARGUMENT` assertion.

- [ ] **Step 3: The build-time generator**

Create `native/cmake/gen_ops_data.py`:

```python
"""Bake native/src/ops/*.ops into one C++ translation unit: a string literal per recording
(parsed at first use by sk_ops_parse, so the text format stays the single source of
truth) and a static_assert-able count. usage: gen_ops_data.py <ops-dir> <out.cpp>"""
import pathlib
import sys

ops_dir, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
files = sorted(ops_dir.glob("*.ops"))
lines = ['// GENERATED by cmake/gen_ops_data.py from src/ops/*.ops — do not edit.',
         '#include "sk_ops_data.h"', '',
         'const sk_ops_blob sk_ops_blobs[] = {']
for f in files:
    stage, family = f.stem.split("-", 1)
    text = f.read_text(encoding="utf-8")
    body = "".join(f'    "{line}\\n"\n' for line in text.replace("\\", "\\\\").replace('"', '\\"').splitlines())
    lines.append(f'    {{ "{stage}", "{family}",\n{body}    }},')
lines += ['};', f'const int sk_ops_blob_count = {len(files)};', '']
out.write_text("\n".join(lines), encoding="utf-8")
print(f"gen_ops_data: {len(files)} recordings -> {out}")
```

Create `native/src/sk_ops_data.h`:

```cpp
#pragma once
struct sk_ops_blob { const char *stage; const char *family; const char *text; };
extern const sk_ops_blob sk_ops_blobs[];
extern const int sk_ops_blob_count;
```

In `native/CMakeLists.txt`, before `target_sources(sokuji_native ...)`:

```cmake
# Op recordings (spec A §3.2) are data under src/ops/*.ops, baked into the library at build
# time so the query needs no files at runtime. Any .ops change re-runs the generator.
file(GLOB _sk_ops_files ${CMAKE_CURRENT_SOURCE_DIR}/src/ops/*.ops)
add_custom_command(
    OUTPUT ${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp
    COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_ops_data.py
            ${CMAKE_CURRENT_SOURCE_DIR}/src/ops ${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp
    DEPENDS ${_sk_ops_files} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gen_ops_data.py
    COMMENT "sokuji-native: baking op recordings")
target_sources(sokuji_native PRIVATE src/sk_ops.cpp src/sk_ops_format.cpp ${CMAKE_BINARY_DIR}/generated/sk_ops_data.cpp)
```

(`find_package(Python3 COMPONENTS Interpreter REQUIRED)` already exists for `patch_upstream.py`; if it does not, add it beside that one.)

- [ ] **Step 4: Implement the query**

Create `native/src/sk_ops.cpp`:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"
#include "sk_ops.h"
#include "sk_ops_data.h"

#include "ggml.h"
#include "ggml-backend.h"

#include <algorithm>
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
    for (int i = 0; i < sk_ops_blob_count; ++i) {
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

/* Rebuild one recorded node with a concrete weight type, at shapes that reproduce the
 * recorded max_bytes (ne[1] scaled; ne[0] as recorded so block sizes stay valid), and ask
 * the device. Nothing is allocated on the device; nothing runs. */
bool ask(ggml_backend_dev_t dev, const sk_op_desc &d, int32_t weight_type, std::string &spelling_out) {
    ggml_init_params ip = { 64 * 1024, nullptr, /*no_alloc*/ true };
    ggml_context *ctx = ggml_init(ip);
    if (!ctx) return false;
    auto concrete = [&](int32_t t) -> ggml_type { return static_cast<ggml_type>(t == SK_SRC_WEIGHT ? weight_type : t); };
    auto grow = [&](std::array<int64_t, 4> ne, ggml_type t) {   // rows so that nbytes >= max_bytes
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
    ggml_tensor *node = ggml_new_tensor_4d(ctx, concrete(d.dst_type), d.ne_dst[0], d.ne_dst[1], d.ne_dst[2], d.ne_dst[3]);
    node->op = static_cast<ggml_op>(d.op);
    std::memcpy(node->op_params, d.op_params.data(), sizeof node->op_params);
    node->src[0] = mk(d.src_type[0], d.ne_src0, d.contig_src0);
    node->src[1] = mk(d.src_type[1], d.ne_src1, d.contig_src1);
    for (int i = 2; i < 5; ++i) node->src[i] = mk(d.src_type[i], {d.ne_src1[0], 1, 1, 1}, true);
    bool ok = ggml_backend_dev_supports_op(dev, node);
    spelling_out = sk_op_spelling(d, weight_type >= 0 ? ggml_type_name(static_cast<ggml_type>(weight_type)) : nullptr);
    ggml_free(ctx);
    return ok;
}

}  // namespace

extern "C" {

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
            const bool has_weight = std::find(d.src_type.begin(), d.src_type.end(), SK_SRC_WEIGHT) != d.src_type.end() || d.dst_type == SK_SRC_WEIGHT;
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

Run: `cd native && cmake --build build/cpu -j && ctest --test-dir build/cpu -R '^test_common$' --output-on-failure | tail -3`
Expected: PASS. If a recorded node is refused on CPU, the failing spelling is what the assertion loop should print — add `std::fprintf(stderr, "%s: %s\n", fam, c.ops[i].name)` for unsupported entries before asserting, so the output names it.

- [ ] **Step 6: Binding wrapper and its test**

Add to `native/python/tests/test_sokuji_native.py`:

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

In `__init__.py` add after `DeviceProfile`:

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
    """Ask the device's own supports_op about the family's recorded graph nodes, WEIGHT
    sources expanded over `weight_dtypes` (ggml type names). NativeError with the status on
    every documented error (NOT_FOUND = no recording, INVALID_ARGUMENT, INTERNAL, BACKEND)."""
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

(`NativeError` already carries `.status` — check its constructor at the top of the file; if the attribute is named differently, use that name in the test.) Add both names to `__all__`.

- [ ] **Step 7: Run the binding test**

Run: `cd native/python && SOKUJI_NATIVE_DIR=../build/cpu/stage python -m pytest tests/test_sokuji_native.py -k supports_ops -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add native/cmake/gen_ops_data.py native/src/sk_ops.cpp native/src/sk_ops_data.h native/src/sk_profile.cpp native/CMakeLists.txt \
        native/tests/test_common.cpp native/python/sokuji_native/__init__.py native/python/tests/test_sokuji_native.py
git commit -m "native: sk_device_supports_ops — recordings baked at build time, nodes rebuilt with recorded shapes, WEIGHT expanded over the caller's dtype set"
```

---

### Task 6: `test_ops_coverage` — re-record and diff; the pin-bump checklist

**Files:**
- Create: `native/tests/test_ops_coverage.cpp`; Modify: `native/tests/CMakeLists.txt`, `native/README.md`, `native/ci/build.sh` (and `.ps1`) to configure the record variant when models are present
- Test: `native/tests/test_ops_coverage.cpp`

**Interfaces:**
- Consumes: Task 4's driver logic (shared through `record_ops`'s functions — factor the per-stage load-and-run into `native/tests/record_common.h` so both binaries use it), Task 5's baked blobs.

- [ ] **Step 1: Factor the recording run out of the driver**

Move the body of `record_ops.cpp`'s per-stage block into `native/tests/record_common.h` as
`sk_op_recording record_family(const std::string &module_dir, const std::string &stage, const std::string &family, const std::string &model, bool fa_on);`
(returning the recording with `dtypes_in_file` and `source_file` filled). `record_ops.cpp` becomes a thin `main` around it.

- [ ] **Step 2: Write the coverage test**

Create `native/tests/test_ops_coverage.cpp`:

```cpp
/* The shipped op recordings equal what the engines do TODAY: re-record every family whose
 * model is cached and diff. rc 77 only when no model at all is present; otherwise each
 * present family is asserted and each absent one prints SKIPPED. Runs against the
 * SK_RECORD_OPS build (build/record), never the shipping one. */
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <set>
#include <string>
#include "record_common.h"
#include "sk_ops.h"
#include "sk_ops_data.h"

struct Case { const char *stage, *family, *env; };
static const Case CASES[] = {
    {"tts", "moss_tts_nano", "SK_TEST_TTS_MOSS_DIR"},     {"tts", "supertonic", "SK_TEST_TTS_SUPERTONIC_DIR"},
    {"tts", "qwen3_tts", "SK_TEST_TTS_QWEN3_DIR"},        {"tts", "omnivoice", "SK_TEST_TTS_OMNIVOICE_DIR"},
    {"tts", "pocket_tts", "SK_TEST_TTS_POCKET_DIR"},      {"tts", "voxcpm1", "SK_TEST_TTS_VOXCPM1_DIR"},
    {"tts", "voxcpm2", "SK_TEST_TTS_VOXCPM2_DIR"},        {"tts", "irodori_tts", "SK_TEST_TTS_IRODORI_DIR"},
    {"tts", "index_tts2", "SK_TEST_TTS_INDEX_DIR"},
    {"asr", "whisper", "SK_TEST_ASR_GGUF"},               {"asr", "moonshine", "SK_TEST_ASR_STREAM_GGUF"},
    {"translate", "qwen3", "SK_TEST_TRANSLATE_GGUF"},
};

static std::set<std::string> spellings(const sk_op_recording &r) {
    std::set<std::string> s;
    for (const auto &d : r.nodes) s.insert(sk_op_spelling(d, nullptr) + " ne0=" + std::to_string(d.ne_src0[0]));
    return s;
}

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    int present = 0, failures = 0;
    for (const Case &c : CASES) {
        const char *model = std::getenv(c.env);
        if (!model || !*model) { std::printf("SKIPPED: %s/%s (%s unset)\n", c.stage, c.family, c.env); continue; }
        ++present;
        const sk_ops_blob *blob = nullptr;
        for (int i = 0; i < sk_ops_blob_count; ++i)
            if (std::string(sk_ops_blobs[i].stage) == c.stage && std::string(sk_ops_blobs[i].family) == c.family) blob = &sk_ops_blobs[i];
        if (!blob) { std::printf("FAIL: %s/%s has a model but no shipped recording\n", c.stage, c.family); ++failures; continue; }
        sk_op_recording shipped; std::string err;
        assert(sk_ops_parse(blob->text, shipped, err));
        sk_op_recording live = record_family(module_dir, c.stage, c.family, model, /*fa_on*/ true);
        if (std::string(c.stage) == "translate") {
            sk_op_recording off = record_family(module_dir, c.stage, c.family, model, false);
            for (const auto &d : off.nodes) sk_ops_add(live.nodes, d);
        }
        const auto a = spellings(shipped), b = spellings(live);
        for (const auto &s : b) if (!a.count(s)) { std::printf("FAIL %s/%s: engine now uses %s (not in shipped recording)\n", c.stage, c.family, s.c_str()); ++failures; }
        for (const auto &s : a) if (!b.count(s)) { std::printf("FAIL %s/%s: shipped recording lists %s (engine no longer uses it)\n", c.stage, c.family, s.c_str()); ++failures; }
        if (shipped.dtypes_in_file != live.dtypes_in_file) { std::printf("FAIL %s/%s: dtypes-in-file changed (upstream re-quantised?)\n", c.stage, c.family); ++failures; }
        std::printf("%s/%s: %zu nodes, %s\n", c.stage, c.family, live.nodes.size(), failures ? "DIFF" : "ok");
    }
    if (present == 0) { std::printf("test_ops_coverage: no models present, skipping\n"); return 77; }
    return failures ? 1 : 0;
}
```

Register it (record variant only):

```cmake
if(SOKUJI_RECORD_OPS)
    add_executable(test_ops_coverage test_ops_coverage.cpp)
    target_link_libraries(test_ops_coverage PRIVATE sokuji_native ggml)
    target_include_directories(test_ops_coverage PRIVATE ../src)
    add_test(NAME test_ops_coverage COMMAND test_ops_coverage ${CMAKE_BINARY_DIR}/lib)
    set_tests_properties(test_ops_coverage PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib" SKIP_RETURN_CODE 77)
endif()
```

- [ ] **Step 3: Run it against the recordings from Task 4**

Run (with the same `SK_TEST_*` variables `native/ci/build.sh` exports, plus the four new-family ones from the TTS branch: `SK_TEST_TTS_VOXCPM1_DIR` etc.):
`cd native && cmake --build build/record -j && ctest --test-dir build/record -R test_ops_coverage --output-on-failure | tail -15`
Expected: every present family prints `ok`; PASS. A `DIFF` here right after recording means the recording is not deterministic across runs — investigate before committing (a sampled TTS family such as `moss_tts_nano` can take a different number of decode steps; the node SET is what is compared, and the set is stable).

- [ ] **Step 4: Wire the record build into `ci/build.sh` and document the checklist**

In `native/ci/build.sh` (and `.ps1`), after the shipping build's CTest, add a second configure+build+ctest of `build/record` with `-DSOKUJI_RECORD_OPS=ON` that runs only `test_ops_coverage`; it inherits the same `SK_TEST_*` environment, so CI (which downloads whisper-tiny, moonshine, Qwen3-0.6B, supertonic-3, moss-tts-nano) asserts those five recordings on every lane and skips the rest.

In `native/README.md`'s "Bumping a pin" list add:

```
5. Op recordings (`src/ops/*.ops`, spec A §3.2): rebuild `build/record` (`-DSOKUJI_RECORD_OPS=ON`)
   and run `test_ops_coverage` with every cached model present — a DIFF means the engine's
   graph changed; re-record that family with `build/record/tests/record_ops` and commit the
   new .ops file with the bump. Families without a cached model must be re-recorded at least
   once per bump on a box that has the model (all nine TTS families are cached under
   ~/.cache/sokuji-native-tests/tts/; asr/translate families are recorded as their models
   become available — a missing recording is a pass-through in the sidecar, never a gate).
```

- [ ] **Step 5: Commit**

```bash
git add native/tests/test_ops_coverage.cpp native/tests/record_common.h native/tests/record_ops.cpp native/tests/CMakeLists.txt \
        native/ci/build.sh native/ci/build.ps1 native/README.md
git commit -m "native: test_ops_coverage re-records every cached family and diffs against the shipped recordings; pin-bump checklist"
```

---

### Task 7: Catalog — `graph_family` on every card, a GGUF header reader, the rung fallback dtype sets

**Files:**
- Create: `sidecar/sokuji_sidecar/gguf_header.py`, `sidecar/tests/test_gguf_header.py`
- Modify: `sidecar/sokuji_sidecar/catalog.py` (`_ModelBase`, `_tc_row`, `_llm_translate_row`, `_tts_gguf_row`, every `_tc_row(...)`/`_llm_translate_row(...)` call, `RUNG_FALLBACK_DTYPES`)
- Modify: `sidecar/tests/test_catalog.py`
- Test: `sidecar/tests/test_gguf_header.py`, `sidecar/tests/test_catalog.py`

**Interfaces:**
- Produces: `_ModelBase.graph_family: str`; `catalog.RUNG_FALLBACK_DTYPES: dict[str, frozenset[str]]` (ggml type names); `gguf_header.read_header(path) -> GgufHeader(architecture: str, tensor_types: frozenset[str], n_tensors: int)` (type names spelled as `ggml_type_name()` spells them: `q8_0`, `q4_K`, `bf16`, `f16`, `f32`, `i32`, `i64`).

- [ ] **Step 1: Write the failing header-reader test**

Create `sidecar/tests/test_gguf_header.py`:

```python
"""A minimal GGUF v3 header reader: architecture + the tensor dtype set. Tested on a file
written here (no model download) and, when present, on the cached whisper-tiny GGUF."""
import os
import struct

import pytest

from sokuji_sidecar import gguf_header

GGUF_MAGIC = b"GGUF"


def _write_gguf(path, arch: str, tensors: list[tuple[str, int]]):
    """tensors: (name, ggml_type id). Writes header + tensor infos, no data."""
    def s(x: str) -> bytes:
        b = x.encode(); return struct.pack("<Q", len(b)) + b
    out = bytearray(GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", len(tensors)) + struct.pack("<Q", 1))
    # one KV: general.architecture (type 8 = string)
    out += s("general.architecture") + struct.pack("<I", 8) + s(arch)
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
    p = tmp_path / "x.bin"; p.write_bytes(b"NOPE" + b"\0" * 64)
    with pytest.raises(gguf_header.GgufError):
        gguf_header.read_header(str(p))


@pytest.mark.skipif(not os.path.exists(os.path.expanduser("~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf")), reason="cached model absent")
def test_real_whisper_tiny():
    h = gguf_header.read_header(os.path.expanduser("~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf"))
    assert h.architecture == "whisper"
    assert "q8_0" in h.tensor_types and "f32" in h.tensor_types
```

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_gguf_header.py -q -p no:cacheprovider` — Expected: FAIL, `ModuleNotFoundError: gguf_header`.

- [ ] **Step 2: Write the reader**

Create `sidecar/sokuji_sidecar/gguf_header.py`:

```python
"""Minimal GGUF header reader (spec A §3.3): `general.architecture` and the set of tensor
dtypes, without loading anything. Header-only: reads a few KiB. GGUF v2/v3 little-endian."""
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

    def u32(self): return struct.unpack("<I", self.f.read(4))[0]
    def u64(self): return struct.unpack("<Q", self.f.read(8))[0]
    def s(self): n = self.u64(); return self.f.read(n).decode("utf-8", "replace")

    def skip_value(self, ty: int):
        if ty == 8: self.u64() and None; self.f.seek(-8, 1); self.s(); return
        if ty == 9:                                    # array: elem type, count, then elems
            et, n = self.u32(), self.u64()
            for _ in range(n): self.skip_value(et)
            return
        if ty in _KV_SIZES: self.f.seek(_KV_SIZES[ty], 1); return
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
            key = r.s(); ty = r.u32()
            if key == "general.architecture" and ty == 8:
                arch = r.s()
            else:
                r.skip_value(ty)
        types = set()
        for _ in range(n_tensors):
            r.s()                                      # name
            nd = r.u32()
            for _ in range(nd): r.u64()                # dims
            types.add(GGML_TYPE_NAMES.get(r.u32(), "unknown"))
            r.u64()                                    # offset
        return GgufHeader(arch, frozenset(types), n_tensors)
```

(`skip_value` for strings reads the length then the bytes — the odd-looking first line is a length read followed by the seek-back; simplify to `if ty == 8: self.s(); return` — do that.)

Run the test again — Expected: PASS (3 tests, the real-file one skipped or passing).

- [ ] **Step 3: Write the failing catalog tests**

Add to `sidecar/tests/test_catalog.py`:

```python
def test_every_card_has_a_graph_family():
    for m in catalog.asr_models() + catalog.translate_models() + catalog.tts_models():
        assert m.graph_family, m.id


def test_translate_prompt_family_unchanged_by_graph_family():
    fams = {m.id: m.prompt_family for m in catalog.translate_models()}
    assert fams["qwen3.5-4b"] == "qwen" and fams["eurollm-1.7b"] == "qwen" and fams["hy-mt2-7b"] == "hunyuan"
    graph = {m.id: m.graph_family for m in catalog.translate_models()}
    assert graph["eurollm-1.7b"] == "llama" and graph["qwen3.5-4b"] == "qwen35" and graph["translategemma-4b"] == "gemma3"


def test_tts_graph_family_is_the_audiocpp_family():
    for m in catalog.tts_models():
        assert m.graph_family == m.family


def test_rung_fallback_sets_cover_cached_ggufs():
    """Premise 7: a rung is a dtype SET. Every cached GGUF's header set must be within its
    rung's fallback set, or the pre-download answer would refuse a file it later accepts."""
    import glob, os
    from sokuji_sidecar import gguf_header
    cache = os.path.expanduser("~/.cache/sokuji-native-tests")
    checked = 0
    for path in glob.glob(f"{cache}/**/*.gguf", recursive=True):
        name = os.path.basename(path).lower()
        rung = next((r for r in ("q4_k_m", "q5_k_m", "q6_k", "q8_0", "bf16", "f16") if r in name.replace("-", "_")), None)
        if rung is None:
            continue
        h = gguf_header.read_header(path)
        assert h.tensor_types <= catalog.RUNG_FALLBACK_DTYPES[rung], (path, sorted(h.tensor_types - catalog.RUNG_FALLBACK_DTYPES[rung]))
        checked += 1
    if not os.path.isdir(cache):
        pytest.skip("no cached models")
    assert checked > 0
```

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_catalog.py -k "graph_family or fallback" -q -p no:cacheprovider` — Expected: FAIL, `AttributeError: graph_family`.

- [ ] **Step 4: Add the field, the parameters and the table**

In `sidecar/sokuji_sidecar/catalog.py`, `_ModelBase` gains (after `download_ignore`):

```python
    # The GRAPH this card runs — the key of its op recording (spec A §3.2): transcribe.cpp's
    # architecture for ASR, llama.cpp's general.architecture for translate, audio.cpp's
    # family for TTS. Not a prompt strategy (that is TranslateModel.prompt_family).
    graph_family: str = ""
```

`_tc_row` gains a keyword `arch=""` and passes `graph_family=arch` to `AsrModel(...)`; `_llm_translate_row` gains `arch=""` and passes `graph_family=arch`; `_tts_gguf_row` passes `graph_family=family`. Then every call site gets its value:

- translate: `qwen2.5-0.5b → arch="qwen2"`, `qwen3-0.6b → "qwen3"`, `qwen3.5-0.8b/2b/4b → "qwen35"`, `translategemma-4b → "gemma3"`, `eurollm-1.7b → "llama"`, `hy-mt2-1.8b/7b, hy-mt15-1.8b/7b → "hunyuan-dense"`. These are llama.cpp's `general.architecture` strings; confirm each against the downloaded default rung with `PYTHONPATH=. .venv/bin/python -c "from sokuji_sidecar.gguf_header import read_header; print(read_header('<path>').architecture)"` where the file is cached (Qwen3-0.6B is), and fix the literal if it differs — the test in Step 6 pins the cached ones.
- ASR: the transcribe.cpp architecture, which is the `src/arch/<name>` directory in the pinned transcribe.cpp source (list it with `ls native/build/cpu/_deps/transcribe-src/src/arch/`). Map by id family: `whisper-*` and `breeze-asr-25` → `whisper`; `moonshine-*` → `moonshine`; `parakeet-*`, `multitalker-parakeet-*` → `parakeet`; `canary-*` (not `canary-qwen`) → `canary`; `canary-qwen-2.5b` → `canary_qwen`; `gigaam-*` → `gigaam`; `granite-*` → `granite`; `sense-voice` → `sensevoice`; `cohere-transcribe-03-2026` → `cohere`; `moss-transcribe-diarize` → `moss`; `qwen3-asr-*` → `qwen3_asr`; `voxtral-*` → `voxtral`; `fun-asr-*` → `fun_asr`; `nemotron-*` → `nemotron`. Where the directory listing spells a name differently, use the directory's spelling — that is the string `sk_asr_caps.arch` reports, which Task 8's test pins for the cached whisper/moonshine files.

Add near `_tc_row`:

```python
# Premise 7 (spec A): a rung is not one dtype. The dtype set a pre-download query expands
# WEIGHT over, when the file is not on disk yet; deliberately wide (a *_M file mixes K-quants,
# the q8_0 TTS files carry BF16 weights, everything carries F32). Once the file exists its
# header's real set replaces this (accel.weight_dtypes). Spellings are ggml_type_name()'s.
RUNG_FALLBACK_DTYPES: dict[str, frozenset[str]] = {
    "q4_k_m": frozenset({"q4_K", "q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q5_k_m": frozenset({"q5_K", "q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q6_k":   frozenset({"q6_K", "q8_0", "bf16", "f16", "f32"}),
    "q8_0":   frozenset({"q8_0", "bf16", "f16", "f32"}),
    "f16":    frozenset({"f16", "f32"}),
    "bf16":   frozenset({"bf16", "f16", "f32"}),
}
```

If Step 3's fallback test reports a cached file with `i32`/`i64` (omnivoice, index, voxcpm2 carry index tensors), add those names to every set — they are never weights a backend refuses, and the test is the authority.

- [ ] **Step 5: Run the catalog tests**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_catalog.py -q -p no:cacheprovider 2>&1 | tail -2`
Expected: all pass (the existing card-shape tests are unaffected: `graph_family` is keyword-only with a default).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/gguf_header.py sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_gguf_header.py sidecar/tests/test_catalog.py
git commit -m "catalog: graph_family on every card, a header-only GGUF reader, and the per-rung fallback dtype sets"
```

---

### Task 8: `DeviceProfile` and `generation` on `Machine`; the two new detectors; `native.py` wrappers

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`Machine`, new dataclasses, detectors, `probe()`), `sidecar/sokuji_sidecar/native.py`
- Modify: `sidecar/tests/test_accel.py` (the `_isolate_probe` fixture applied to every `probe(force=True)` test; `_FakeDev` keyword fields; `_fake_native_module` growth; new tests)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: Task 2/5's binding (`sokuji_native.device_profiles()`, `device_supports_ops()`).
- Produces:
  ```python
  @dataclass(frozen=True) class DeviceProfile: index, kind, name, description, mem_total, known, features: frozenset[str], driver_name, driver_version, device_uuid, cpu_features
  @dataclass(frozen=True) class OpCoverage: all_supported: bool; unsupported: tuple[str, ...]
  Machine.devices: tuple[DeviceProfile, ...] = ();  Machine.generation: str = ""
  accel._native_profiles() -> tuple[DeviceProfile, ...];  accel._native_identity() -> tuple[str, dict] | None
  accel.compute_generation(identity, devices) -> str          # pure; used by probe()
  native.device_profiles() -> list;  native.device_supports_ops(index, stage, family, dtypes)
  ```

- [ ] **Step 1: Write the failing tests**

In `sidecar/tests/test_accel.py`, extend `_FakeDev` and `_fake_native_module`:

```python
class _FakeDev:
    def __init__(self, index, kind, desc, total, free, *, known=True, features=(), driver_name="", driver_version="", device_uuid="", cpu_features=""):
        self.index, self.kind, self.name = index, kind, f"{kind}{index}"
        self.description, self.mem_total, self.mem_free = desc, total, free
        self.known, self.features = known, frozenset(features)
        self.driver_name, self.driver_version, self.device_uuid, self.cpu_features = driver_name, driver_version, device_uuid, cpu_features


def _fake_native_module(monkeypatch, devs, *, version="1.0.1", engine_versions=None, profiles=True, supports=None):
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

Add a fixture used by every existing `probe(force=True)` test (add `_isolate_probe` to each such test's parameters, or make it `autouse=True` in a `probe` marker; simplest: `autouse=True` for the module, since every test in this file that probes already patches the four detectors — the two new ones default to "nothing"):

```python
@pytest.fixture(autouse=True)
def _isolate_probe(monkeypatch):
    """The two spec-A detectors default to 'nothing' for every test in this module; tests that
    want profiles patch them (or install a fake native module) explicitly."""
    monkeypatch.setattr(accel, "_native_profiles", lambda: ())
    monkeypatch.setattr(accel, "_native_identity", lambda: None)
```

and the new tests:

```python
def test_probe_fills_devices_and_generation(monkeypatch):
    monkeypatch.undo()   # this test wants the real detectors over the fake module
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
            if k.startswith("GGML_"): monkeypatch.delenv(k)
        for k, v in (env or {}).items(): monkeypatch.setenv(k, v)
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
    def boom(): raise RuntimeError("no")
    monkeypatch.setattr(accel, "_native_profiles", boom)
    m = accel.probe(force=True)
    assert m.devices == () and m.generation != ""            # profiles failed, identity still keyed
    monkeypatch.setattr(accel, "_native_identity", boom)
    m = accel.probe(force=True)
    assert m.generation == ""


def test_old_wheel_without_profiles_degrades(monkeypatch):
    monkeypatch.undo()
    _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "GB10", 96 << 30, 90 << 30)], version="1.0.2", profiles=False)
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_tts"}))
    m = accel.probe(force=True)
    assert m.devices == () and m.generation != ""
```

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -k "generation or profiles or old_wheel or degrades_per" -q -p no:cacheprovider` — Expected: FAIL (`_native_profiles` missing; `Machine` has no `devices`).

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

Two detectors beside `_native_gpus`:

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

- [ ] **Step 3: Run the accel suite**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -q -p no:cacheprovider 2>&1 | tail -2`
Expected: all pass, including every pre-existing `probe(force=True)` test (the autouse fixture defaults the new detectors to nothing).

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/native.py sidecar/tests/test_accel.py
git commit -m "accel: DeviceProfile and generation on Machine; _native_profiles/_native_identity detectors; native.py wrappers"
```

---

### Task 9: Cache generations — `_cache_key` on both sides, `bench_read`, `bench_save` with rotation and atomic write

**Files:**
- Modify: `sidecar/sokuji_sidecar/planner.py` (`_cache_key`; `_resolve_model` and `resolve_translate._tps` read side), `sidecar/sokuji_sidecar/accel.py` (`_measure`, `bench_read`, `bench_save`)
- Modify: `sidecar/tests/test_planner.py:395, 408, 512, 848`, `sidecar/tests/test_accel.py:393-398, 407-410, 427`
- Test: both files

**Interfaces:**
- Produces: `planner._cache_key(machine, ns, model_id, backend, device, compute_type) -> str`; `accel.bench_read() -> tuple[dict, list[str]]`; `accel.bench_save(entries: dict, *, generation: str) -> None`. `bench_load() -> dict` unchanged (entries only, `_generations` stripped).

- [ ] **Step 1: Write the failing tests**

`sidecar/tests/test_accel.py`:

```python
def test_bench_save_rotates_generations_and_drops_legacy_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    # legacy flat file from before generations
    (tmp_path / "accel-bench.json").write_text('{"fp|whisper-base|native_asr|cpu|q8_0": 0.5}')
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
    def broken_dump(*a, **k): raise OSError("disk full")
    monkeypatch.setattr(accel.json, "dump", broken_dump)
    accel.bench_save({"G1|k": 2.0}, generation="G1")       # never raises
    monkeypatch.undo()
    assert accel.bench_read()[0] == {"G1|k": 1.0}          # the old file survived intact


def test_measure_keys_by_generation(monkeypatch, tmp_path):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m1 = accel.Machine(os="Linux", arch="x86_64", cpu_cores=4, apple_silicon=False, installed=frozenset(), fingerprint="fp", generation="G1")
    m2 = dataclasses.replace(m1, generation="G2")
    plan = accel.Plan("native_asr", "cpu", "cpu", "q8_0", "r/f.gguf", 2.0, None)
    calls = []
    run = lambda backend: (calls.append(1), 0.42)[1]
    assert accel._measure(None, plan, "whisper-base", m1, ns="", run=run) == 0.42
    assert accel._measure(None, plan, "whisper-base", m1, ns="", run=run) == 0.42 and len(calls) == 1   # hit
    assert accel._measure(None, plan, "whisper-base", m2, ns="", run=run) == 0.42 and len(calls) == 2   # miss across generations
    assert accel.planner._cache_key(m1, "", "whisper-base", "native_asr", "cpu", "q8_0") in accel.bench_load()
```

`sidecar/tests/test_planner.py` — update the four cache-building sites (395, 408, 512, 848) from `_bench_key(m.fingerprint, ...)` to `_cache_key(m, "", ...)` / `_cache_key(m, "tps:", ...)`, and add:

```python
def test_bench_entries_are_read_only_within_their_generation():
    m = _machine_gpu(generation="G1")          # whichever helper the file uses; add generation=
    key = planner._cache_key(m, "", "whisper-base", "native_asr", "vulkan", "q8_0")
    cpu_key = planner._cache_key(m, "", "whisper-base", "native_asr", "cpu", "q8_0")
    cache = {key: 2.0, cpu_key: 1.0}                                 # GPU slower than CPU → demoted
    plans = planner.resolve("whisper-base", machine=m, platform="linux", cache=cache, downloaded=set())
    assert plans[0].device == "cpu"
    m2 = dataclasses.replace(m, generation="G2")
    plans = planner.resolve("whisper-base", machine=m2, platform="linux", cache=cache, downloaded=set())
    assert plans[0].device == "vulkan"                               # G1 numbers are invisible under G2
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


def bench_read() -> tuple[dict, list]:
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
    try:
        _old, gens = bench_read()
        if generation and generation not in gens:
            gens.append(generation)
        gens = gens[-_KEEP_GENERATIONS:]
        keep = set(gens)
        kept = {k: v for k, v in entries.items() if k.split("|", 1)[0] in keep}
        path = _bench_cache_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({_GENERATIONS_KEY: gens, **kept}, f)
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(path + ".tmp")
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

### Task 10: Op coverage in accel — `weight_dtypes`, `compute_op_coverage`, `op_coverage_for`, `cached_op_coverage`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: Task 7's `RUNG_FALLBACK_DTYPES`, `gguf_header.read_header`; Task 8's `OpCoverage`, `native.device_supports_ops`; Task 9's `bench_read`/`bench_save`.
- Produces:
  ```python
  accel.weight_dtypes(model, compute_type) -> tuple[str, ...]
  accel.compute_op_coverage(machine, device_index, stage, family, compute_type, weight_dtypes) -> OpCoverage | None
  accel.op_coverage_for(machine, model, override) -> Callable[[int, str, str, str], OpCoverage | None]   # precomputed dict .get
  accel.cached_op_coverage(machine) -> Callable[[int, str, str, str], OpCoverage | None]              # read-only
  accel._ops_key(machine, index, stage, family, compute_type) -> str
  ```

- [ ] **Step 1: Write the failing tests**

```python
def _known_gpu_machine(kind="vulkan"):
    dev = accel.DeviceProfile(0, kind, f"{kind}0", "GB10", 96 << 30, True, frozenset(), "NVIDIA", "580", "ab" * 16, "")
    cpu = accel.DeviceProfile(1, "cpu", "CPU", "CPU", 120 << 30, True, frozenset(), "", "", "", "NEON=1")
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                         installed=frozenset({"native_tts", "native_translate", "native_asr"}), fingerprint="fp",
                         tc_kinds=(kind, "cpu"), gpus=((kind, "GB10", 96 << 30),), devices=(dev, cpu), generation="G1")


def test_weight_dtypes_prefers_the_file_header_over_the_fallback(monkeypatch, tmp_path):
    from sokuji_sidecar import catalog
    card = catalog.tts_model("voxcpm2")
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: None)                 # not on disk
    assert set(accel.weight_dtypes(card, "q8_0")) == catalog.RUNG_FALLBACK_DTYPES["q8_0"]
    hdr = accel.gguf_header.GgufHeader("voxcpm2", frozenset({"q8_0", "bf16", "f32"}), 3)
    monkeypatch.setattr(accel, "_artifact_path", lambda model, ct: str(tmp_path / "x.gguf"))
    monkeypatch.setattr(accel.gguf_header, "read_header", lambda p: hdr)
    assert set(accel.weight_dtypes(card, "q8_0")) == {"q8_0", "bf16", "f32"}


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
    cov = accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0", "f32"))
    assert cov == accel.OpCoverage(False, ("NORM[f32,-,-,-,-]->f32",))
    assert accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0", "f32")) == cov and len(calls) == 1
    key = accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0")
    assert accel.bench_load()[key] == {"allSupported": False, "unsupported": ["NORM[f32,-,-,-,-]->f32"]}
    # errors are None and never cached
    class E(Exception):
        def __init__(self, status): self.status = status
    def not_found(i, s, f, dts): raise E(-4)      # SK_ERR_NOT_FOUND
    monkeypatch.setattr(native, "device_supports_ops", not_found)
    assert accel.compute_op_coverage(m, 0, "asr", "whisper", "q8_0", ("q8_0",)) is None
    assert accel._ops_key(m, 0, "asr", "whisper", "q8_0") not in accel.bench_load()
    def backend(i, s, f, dts): raise E(-3)        # SK_ERR_BACKEND
    monkeypatch.setattr(native, "device_supports_ops", backend)
    assert accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "bf16", ("bf16",)) is None
    def invalid(i, s, f, dts): raise E(-1)        # SK_ERR_INVALID_ARGUMENT: a programming error
    monkeypatch.setattr(native, "device_supports_ops", invalid)
    monkeypatch.setenv("SOKUJI_WIRE_STRICT", "1")
    with pytest.raises(Exception):
        accel.compute_op_coverage(m, 0, "tts", "voxcpm2", "q8_0", ("q8_0",))


def test_op_coverage_for_precomputes_only_what_the_planner_may_gate(monkeypatch, tmp_path):
    import types
    from sokuji_sidecar import catalog, native
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    calls = []
    monkeypatch.setattr(native, "device_supports_ops",
                        lambda i, s, f, dts: (calls.append((i, f, s)), types.SimpleNamespace(all_supported=True, unsupported=(), checked=()))[1])
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
    accel.op_coverage_for(m2, card, "auto"); assert calls == []
    m3 = dataclasses.replace(m, devices=(dataclasses.replace(m.devices[0], known=False), m.devices[1]))
    accel.op_coverage_for(m3, card, "auto"); assert calls == []
    # two GPUs of one kind: only the first is queried
    second = dataclasses.replace(m.devices[0], index=2, name="vulkan2", description="other")
    m4 = dataclasses.replace(m, devices=(m.devices[0], second, m.devices[1]))
    accel.op_coverage_for(m4, card, "auto")
    assert {c[0] for c in calls} == {0}


def test_cached_op_coverage_reads_only(monkeypatch, tmp_path):
    from sokuji_sidecar import native
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _known_gpu_machine()
    monkeypatch.setattr(native, "device_supports_ops", lambda *a: pytest.fail("read-only callable reached native"))
    cb = accel.cached_op_coverage(m)
    assert cb(0, "tts", "voxcpm2", "q8_0") is None
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0"): {"allSupported": False, "unsupported": ["X"]}}, generation="G1")
    assert accel.cached_op_coverage(m)(0, "tts", "voxcpm2", "q8_0") == accel.OpCoverage(False, ("X",))
```

Run — Expected: FAIL (names missing).

- [ ] **Step 2: Implement**

In `accel.py` (after `_downloaded_quants`):

```python
from . import gguf_header  # noqa: E402  (top of file with the other intra-package imports)


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
    the rung is on disk, else the rung's deliberately wide fallback set."""
    from . import catalog as _cat
    path = _artifact_path(model, compute_type)
    if path:
        try:
            return tuple(sorted(gguf_header.read_header(path).tensor_types))
        except Exception:
            pass
    return tuple(sorted(_cat.RUNG_FALLBACK_DTYPES.get(compute_type, frozenset({"f32"}))))


def _ops_key(machine: Machine, device_index: int, stage: str, family: str, compute_type: str) -> str:
    return f"{machine.generation}|ops:{device_index}:{stage}:{family}:{compute_type}"


def _stage_of_model(model) -> str:
    return planner._STAGE_OF_BACKEND.get(model.deployments[0].backend, "")


def compute_op_coverage(machine: Machine, device_index: int, stage: str, family: str,
                        compute_type: str, weight_dtypes_: tuple):
    """native.device_supports_ops once per key, cached in the bench file. NOT_FOUND (no
    recording yet) and BACKEND (the Vulkan first-init exception) return None uncached;
    INVALID_ARGUMENT / INTERNAL are programming errors: raise under SOKUJI_WIRE_STRICT."""
    from . import native
    key = _ops_key(machine, device_index, stage, family, compute_type)
    entries = bench_load()
    if key in entries:
        v = entries[key]
        return OpCoverage(bool(v.get("allSupported")), tuple(v.get("unsupported", ())))
    try:
        cov = native.device_supports_ops(device_index, stage, family, weight_dtypes_)
    except Exception as e:                       # NativeError carries .status
        status = getattr(e, "status", None)
        if status in (-4, -3):                   # SK_ERR_NOT_FOUND, SK_ERR_BACKEND
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


def op_coverage_for(machine: Machine, model, override: str):
    """What the resolve wrappers hand the planner: a dict.get over results PRECOMPUTED here —
    for each GPU tier _tier_available accepts, the FIRST device of that kind, this card's
    graph_family, and every rung the card lists. Nothing is computed for an explicit CPU
    load, without profiles, or when the device is not known (spec A §3.3)."""
    results = {}
    if override == "cpu" or not machine.devices or model is None:
        return results.get
    stage = _stage_of_model(model)
    seen_kinds = set()
    for d in model.deployments:
        if d.tier == "cpu" or not _tier_available(d.tier, machine, d.backend):
            continue
        kind = TIER_DEVICE[d.tier]
        if kind in seen_kinds:
            continue
        dev = _first_device_of_kind(machine, kind)
        if dev is None or not dev.known:
            continue
        seen_kinds.add(kind)
        for ct in sorted({x.compute_type for x in model.deployments}):
            results[(dev.index, stage, model.graph_family, ct)] = compute_op_coverage(
                machine, dev.index, stage, model.graph_family, ct, weight_dtypes(model, ct))
    return lambda index, stage_, family, ct: results.get((index, stage_, family, ct))


def cached_op_coverage(machine: Machine):
    """Read-only: what _h_models_catalog / _h_list_variants pass. A miss is None."""
    entries = bench_load()
    def get(index, stage, family, ct):
        v = entries.get(_ops_key(machine, index, stage, family, ct))
        return OpCoverage(bool(v.get("allSupported")), tuple(v.get("unsupported", ()))) if isinstance(v, dict) else None
    return get
```

`planner._STAGE_OF_BACKEND` is defined in Task 11; for this task's tests it must exist — add it to `planner.py` now (Task 11 uses it):

```python
_STAGE_OF_BACKEND = {"native_asr": "asr", "native_asr_stream": "asr", "native_translate": "translate", "native_tts": "tts"}
```

Wire the resolve wrappers (`resolve`, `resolve_translate`, `resolve_tts`, `resolve_deployments`) to pass `op_coverage=op_coverage_for(m, model, override)` — the planner signatures accept it after Task 11; until then add the keyword to the wrappers only when Task 11 lands (do Tasks 10 and 11 on one branch and run the suite after both).

- [ ] **Step 3: Run**

Run: `cd sidecar && PYTHONPATH=. .venv/bin/python -m pytest tests/test_accel.py -k "coverage or weight_dtypes" -q -p no:cacheprovider` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/planner.py sidecar/tests/test_accel.py
git commit -m "accel: op coverage — weight dtypes from the GGUF header, compute/precomputed/read-only callables over the generation-keyed cache"
```

---

### Task 11: The planner gate — `_deployment_available`, threading through nine functions, the fit walk sees only runnable rungs, structured R36

**Files:**
- Modify: `sidecar/sokuji_sidecar/planner.py` (`_tier_available` Metal branch; new helpers; signatures of `resolve`, `resolve_translate`, `resolve_tts`, `select_variant`, `resolve_deployments`, `_resolve_model`, `_llamacpp_variant_row`, `_tc_pick_quant`), `sidecar/sokuji_sidecar/accel.py` (the wrappers `resolve_deployments`, `_llamacpp_variant_row`, and passing `op_coverage=` from the four resolve wrappers)
- Test: `sidecar/tests/test_planner.py`, `sidecar/tests/test_characterization.py` (guard fixture only)

**Interfaces:**
- Produces: `planner._ABORTS_ON_UNSUPPORTED`, `_device_for_tier(machine, tier)`, `_deployment_available(model, d, machine, *, op_coverage)`; every listed function gains `*, op_coverage=_NO_COVERAGE` where `_NO_COVERAGE = lambda *a: None`.

- [ ] **Step 1: Write the failing planner tests**

```python
_NONE = lambda *a: None
def _cov(all_supported, unsupported=()):
    from sokuji_sidecar.accel import OpCoverage
    return lambda i, s, f, ct: OpCoverage(all_supported, tuple(unsupported))
def _cov_for(mapping):   # {(stage, family, ct): OpCoverage}
    return lambda i, s, f, ct: mapping.get((s, f, ct))


def test_deployment_available_unknown_profile_is_tier_available():
    m = _machine_gpu()                                            # devices=() by default
    for card in (catalog.tts_model("voxcpm2"), catalog.translate_model("qwen3-0.6b"), catalog.asr_model("whisper-base")):
        for d in card.deployments:
            assert planner._deployment_available(card, d, m, op_coverage=_NONE) == planner._tier_available(d.tier, m, d.backend)


def test_deployment_available_tts_refuses_gpu_on_unsupported_node_only():
    m = _known_gpu_machine()                                      # reuse from test_accel or define here
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
    class Card: graph_family = "x"; deployments = (d,)
    assert planner._deployment_available(Card, d, m, op_coverage=_cov(False)) is True


def test_refused_tts_rung_lands_on_cpu_row_under_pin_downloaded_and_gpu_override_with_pin():
    m = _known_gpu_machine()
    cov = _cov_for({("tts", "voxcpm2", "bf16"): OpCoverage(False, ("MUL_MAT[bf16,f32,-,-,-]->f32",)),
                    ("tts", "voxcpm2", "q8_0"): OpCoverage(True, ())})
    # pin
    plans = planner.resolve_tts("voxcpm2", machine=m, platform="linux", cache={}, pin="bf16", op_coverage=cov)
    assert plans[0].device == "cpu" and plans[0].compute_type == "bf16"
    # downloaded
    plans = planner.resolve_tts("voxcpm2", machine=m, platform="linux", cache={}, downloaded=frozenset({"bf16"}), op_coverage=cov)
    assert plans[0].device == "cpu" and plans[0].compute_type == "bf16"
    # override gpu with the rung pinned
    plans = planner.resolve_tts("voxcpm2", "gpu", machine=m, platform="linux", cache={}, pin="bf16", op_coverage=cov)
    assert plans[0].device == "cpu" and plans[0].compute_type == "bf16"


def test_fit_walk_sees_only_runnable_rungs():
    m = _known_gpu_machine()                                      # 96 GiB: bf16 fits
    cov = _cov_for({("tts", "voxcpm2", "bf16"): OpCoverage(False, ("X",)), ("tts", "voxcpm2", "q8_0"): OpCoverage(True, ())})
    plans = planner.resolve_tts("voxcpm2", machine=m, platform="linux", cache={}, op_coverage=cov)
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

(`_known_gpu_machine` from Task 10's tests: move it to a shared `sidecar/tests/_fixtures.py` or duplicate it here.) Run — Expected: FAIL.

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

Then thread `*, op_coverage=_NO_COVERAGE` through and use it:
- `resolve_deployments(model, machine, override="auto", bench=None, *, platform, op_coverage=_NO_COVERAGE)`: the `usable` comprehension uses `_deployment_available(model, d, machine, op_coverage=op_coverage)` instead of `_tier_available(...)`.
- `_resolve_model(..., *, cache, platform, op_coverage=_NO_COVERAGE)` passes it to `resolve_deployments`.
- `_tc_pick_quant(model, machine, pin, budget, downloaded=None, *, op_coverage=_NO_COVERAGE)`: `gpu_possible = any(_deployment_available(model, d, machine, op_coverage=op_coverage) and d.tier != "cpu" for d in model.deployments)`, and **before** the fit walk: `sizes = {q: s for q, s in sizes.items() if any(d.compute_type == q and d.tier != "cpu" and _deployment_available(model, d, machine, op_coverage=op_coverage) for d in model.deployments)} or sizes` — only when `gpu_possible` (the `or sizes` keeps the walk non-empty if nothing has a GPU row, which then falls to the existing default logic).
- `_llamacpp_variant_row(..., *, est_bytes, op_coverage=_NO_COVERAGE)`: `_row()` uses `_deployment_available(model, d, machine, op_coverage=op_coverage)`; `gpu_possible` likewise; and before `_fit_walk`: restrict `quants` to rungs with at least one available GPU row (same shape as above, `or quants`).
- `select_variant(..., *, est_bytes, format_ready, op_coverage=_NO_COVERAGE)`: pass through to `_llamacpp_variant_row`; `candidate()` uses `_deployment_available`.
- `resolve`, `resolve_translate`, `resolve_tts`: accept and pass `op_coverage` to `_tc_pick_quant` / `select_variant` / `_llamacpp_variant_row` / `_resolve_model`.

In `accel.py`: `resolve_deployments(..., *, platform=None, op_coverage=None)` passes `op_coverage=op_coverage or planner._NO_COVERAGE`; `_llamacpp_variant_row(...)` wrapper gains `op_coverage=None` and passes it; the four resolve wrappers compute `cov = op_coverage_for(m, model, override)` and pass `op_coverage=cov`.

- [ ] **Step 3: The characterisation guard**

In `sidecar/tests/test_characterization.py`, extend the autouse fixture:

```python
    monkeypatch.setattr(accel, "compute_op_coverage", lambda *a, **k: pytest.fail("native reached with devices=()"))
    monkeypatch.setattr(accel.native, "module", lambda: pytest.fail("native reached with devices=()"))
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
git commit -m "planner: _deployment_available at every gate (tts refuses on op coverage; asr/translate record), fit walk over runnable rungs, structured R36"
```

---

### Task 12: Wire producers — `hardware_info_result.generation/devices`, `tiers[].available`, `variants[].unsupportedTiers`, the schema

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_h_hardware_info`, `_h_models_catalog`), `sidecar/sokuji_sidecar/wire_schema.json`
- Test: `sidecar/tests/test_accel.py`

- [ ] **Step 1: Write the failing tests**

```python
async def _call(handler, msg):
    out, _ = await handler(None, msg, None)
    return out


def test_hardware_info_carries_profiles_and_cached_coverage(monkeypatch, tmp_path):
    import asyncio
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _known_gpu_machine()
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    monkeypatch.setattr(accel, "_engine_identity", lambda m: ("1.1.0", {"ggml": "0.22.0"}, "cpu-vulkan", {"kind": "vulkan", "name": "vulkan0", "description": "GB10"}))
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0"): {"allSupported": False, "unsupported": ["NORM[f32,-,-,-,-]->f32"]}}, generation="G1")
    monkeypatch.setattr(accel, "compute_op_coverage", lambda *a, **k: pytest.fail("hardware_info must not compute coverage"))
    out = asyncio.run(_call(accel._h_hardware_info, {"type": "hardware_info", "id": 7}))
    assert out["generation"] == "G1"
    dev = out["devices"][0]
    assert dev["kind"] == "vulkan" and dev["known"] and dev["deviceUuid"] == "ab" * 16 and dev["driverName"] == "NVIDIA"
    assert dev["opCoverage"] == {"tts/voxcpm2/q8_0": {"allSupported": False, "unsupported": ["NORM[f32,-,-,-,-]->f32"]}}
    assert out["devices"][1]["cpuFeatures"] == "NEON=1"
    from sokuji_sidecar import wire
    wire.validate_outbound(out)                                       # schema lists the two new optional fields


def test_models_catalog_marks_unsupported_tiers_but_keeps_supported_true(monkeypatch, tmp_path):
    import asyncio
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))
    m = _known_gpu_machine()
    monkeypatch.setattr(accel, "probe", lambda force=False: m)
    accel.bench_save({accel._ops_key(m, 0, "tts", "voxcpm2", "bf16"): {"allSupported": False, "unsupported": ["X"]},
                      accel._ops_key(m, 0, "tts", "voxcpm2", "q8_0"): {"allSupported": True, "unsupported": []}}, generation="G1")
    out = asyncio.run(_call(accel._h_models_catalog, {"type": "models_catalog", "id": 1, "kind": "tts", "models": ["voxcpm2"]}))
    card = out["models"][0]
    vulkan = next(t for t in card["tiers"] if t["tier"] == "gpu-vulkan")
    assert vulkan["available"] is True                                # q8_0 can execute there
    by_id = {v["id"]: v for v in card["variants"]}
    assert by_id["bf16"]["supported"] is True and by_id["bf16"]["unsupportedTiers"] == ["gpu-vulkan"]
    assert by_id["q8_0"]["supported"] is True and "unsupportedTiers" not in by_id["q8_0"]
    # cache miss → exactly today's wire
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path / "empty"))
    out2 = asyncio.run(_call(accel._h_models_catalog, {"type": "models_catalog", "id": 2, "kind": "tts", "models": ["voxcpm2"]}))
    assert all("unsupportedTiers" not in v for v in out2["models"][0]["variants"])
    assert next(t for t in out2["models"][0]["tiers"] if t["tier"] == "gpu-vulkan")["available"] is True
```

(If the handlers require a `conn`, pass `None` as they already tolerate.) Run — Expected: FAIL.

- [ ] **Step 2: Implement**

`wire_schema.json` line 4 becomes:

```json
  "hardware_info_result": {"required": ["id", "os", "arch", "cpuCores", "gpus", "backendsInstalled", "accelAvailable"], "optional": ["nativeVersion", "engineVersions", "lane", "preferredDevice", "generation", "devices"]},
```

`_h_hardware_info` — add after `"preferredDevice": preferred_device`:

```python
            "generation": m.generation or None,
            "devices": _devices_wire(m) or None}, None
```

with:

```python
def _devices_wire(m: Machine) -> list:
    """Spec A §3.4: the profile plus whatever op coverage is already cached — read-only."""
    if not m.devices:
        return []
    entries = bench_load()
    prefix = f"{m.generation}|ops:"
    out = []
    for d in m.devices:
        cov = {}
        for k, v in entries.items():
            if not (k.startswith(prefix) and isinstance(v, dict)):
                continue
            _, _, idx, stage, family, ct = k.split("|", 1)[1].split(":", 5)[0:1] + k.split(":", 5)[1:6] if False else (None, None, *k.split(":", 4)[1:5])
            if int(idx) == d.index:
                cov[f"{stage}/{family}/{ct}"] = {"allSupported": bool(v.get("allSupported")), "unsupported": list(v.get("unsupported", ()))}
        out.append({"index": d.index, "kind": d.kind, "name": d.name, "description": d.description,
                    "memTotalMb": d.mem_total >> 20, "known": d.known, "features": sorted(d.features),
                    "driverName": d.driver_name, "driverVersion": d.driver_version, "deviceUuid": d.device_uuid,
                    "cpuFeatures": d.cpu_features, "opCoverage": cov})
    return out
```

(Write the key split plainly: `_, idx, stage, family, ct = k.split("|", 1)[1].split(":", 4)` — the key is `gen|ops:idx:stage:family:ct`, so after removing `gen|` the parts are `ops`, `idx`, `stage`, `family`, `ct`. Replace the obfuscated line above with that.)

`_h_models_catalog`: replace the `tiers` loop and the variants loop so both use `_deployment_available` with the read-only callable:

```python
    cov = cached_op_coverage(m)
    for mdl in models:
        tiers = []
        seen_tiers = set()
        for d in mdl.deployments:
            if not _platform_ok(d, m, platform_tag):
                continue
            if d.tier in seen_tiers:
                continue
            seen_tiers.add(d.tier)
            any_rung = any(x.tier == d.tier and x.backend in m.installed and planner._deployment_available(mdl, x, m, op_coverage=cov)
                           for x in mdl.deployments if _platform_ok(x, m, platform_tag))
            tiers.append({"tier": d.tier, "backend": d.backend, "available": any_rung})
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

and pass `op_coverage=cov` to the two direct planner calls (`_llamacpp_variant_row(mdl, m, None, 0, budget, op_coverage=cov)`, `_tc_pick_quant(mdl, m, None, budget, op_coverage=cov)`). `_h_list_variants` passes `op_coverage=cov` to `select_variant`.

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
- Modify: `src/lib/local-inference/native/nativeProtocol.ts:41-43, 50-60, 71-78`
- Modify: `src/services/clients/LocalNativeClient.ts:89-96`
- Modify: `src/stores/nativeModelStore.ts` (`NativeEngineInfo` untouched; new fields `deviceProfiles`, `profileGeneration`, `reportedUnsupportedOps`; the ready transition)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx:105-150, 523-550`
- Modify: `src/locales/*/translation.json` (30 files): `models.variantRunsOnCpu`
- Test: `src/stores/nativeModelStore.test.ts`, `src/components/Settings/sections/NativeModelManagementSection.test.tsx`, `src/lib/local-inference/native/nativeProtocol.consistency.test.ts` (existing; must keep passing)

**Interfaces:**
- Consumes: Task 12's wire fields.
- Produces: `HardwareInfoResultMsg.generation?: string | null`, `.devices?: NativeDeviceProfile[] | null`; `NativeModelInfo.variants[number].unsupportedTiers?: string[]`; `VariantInfo.unsupportedTiers?: string[]`; store fields `deviceProfiles: NativeDeviceProfile[] | null`, `profileGeneration: string | null`.

- [ ] **Step 1: Write the failing tests**

`src/stores/nativeModelStore.test.ts` — beside the existing ready-transition test (the one at line ~456 that `toEqual`s `engineInfo`), add:

```ts
it('keeps device profiles and the generation beside engineInfo, and reports an unsupported tts node once', async () => {
  const hw = {
    type: 'hardware_info_result', id: 1, os: 'Linux', arch: 'aarch64', cpuCores: 20, gpus: [], backendsInstalled: [], accelAvailable: true,
    nativeVersion: '1.1.0', engineVersions: { ggml: '0.22.0' }, lane: 'cpu-vulkan', preferredDevice: null,
    generation: 'G1',
    devices: [{ index: 0, kind: 'vulkan', name: 'Vulkan0', description: 'GB10', memTotalMb: 98304, known: true, features: ['vk_coopmat'],
                driverName: 'NVIDIA', driverVersion: '580', deviceUuid: 'ab'.repeat(16), cpuFeatures: '',
                opCoverage: { 'tts/voxcpm2/q8_0': { allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'] } } }],
  };
  const client = fakeClient({ hardwareInfo: async () => hw });        // whatever helper this file already uses for the ready path
  const warn = vi.spyOn(report, 'reportWarning');
  await useNativeModelStore.getState().refreshCatalog(client);
  const s = useNativeModelStore.getState();
  expect(s.engineInfo).toEqual({ nativeVersion: '1.1.0', engineVersions: { ggml: '0.22.0' }, lane: 'cpu-vulkan', preferredDevice: null });
  expect(s.profileGeneration).toBe('G1');
  expect(s.deviceProfiles?.[0].deviceUuid).toBe('ab'.repeat(16));
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][1]).toContain('NORM[f32,-,-,-,-]->f32');
  await useNativeModelStore.getState().refreshCatalog(client);      // same session, same key → no second report
  expect(warn).toHaveBeenCalledTimes(1);
});

it('a variant with unsupportedTiers stays pickable and keeps its pin', () => {
  const info = M('voxcpm2', { variants: [
    { id: 'q8_0', sizeBytes: 1, supported: true, recommended: true },
    { id: 'bf16', sizeBytes: 2, supported: true, recommended: false, unsupportedTiers: ['gpu-vulkan'] },
  ] });
  useNativeModelStore.setState({ catalog: { voxcpm2: info }, pins: { voxcpm2: 'bf16' } });
  expect(deriveVariantRepos({ voxcpm2: info }, { voxcpm2: 'bf16' })['voxcpm2']).toBe(info.variants![1].repo ?? info.repo);
});
```

(`M(...)` is this file's existing catalog-fixture builder; adapt the pin/derive call to the store's real names — `deriveVariantRepos` and the persisted-pin field are at `nativeModelStore.ts:216-228`.)

`NativeModelManagementSection.test.tsx`:

```tsx
it('renders "runs on CPU here" on an enabled option when the sidecar refused its GPU tier', () => {
  renderWithCatalog({ voxcpm2: M('voxcpm2', { variants: [
    { id: 'q8_0', sizeBytes: 1e9, supported: true, recommended: true },
    { id: 'bf16', sizeBytes: 2e9, supported: true, recommended: false, unsupportedTiers: ['gpu-vulkan'] },
  ] }) });
  const opt = screen.getByTestId('variant-row-bf16') as HTMLOptionElement;
  expect(opt.disabled).toBe(false);
  expect(opt.textContent).toContain('Runs on CPU on this machine');
});
```

Run: `npx vitest run src/stores/nativeModelStore.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx` — Expected: FAIL (fields missing).

- [ ] **Step 2: Types**

`nativeProtocol.ts`: in `NativeModelInfo.variants` add `unsupportedTiers?: string[];` after `recommended: boolean;` with the comment `// gpu tiers the sidecar's op coverage refused for this rung (spec A); the rung still runs on cpu`. Add:

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

and in `HardwareInfoResultMsg` after `preferredDevice`: `generation?: string | null; devices?: NativeDeviceProfile[] | null;`. In `VariantInfo` add `unsupportedTiers?: string[];`. Run `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts` — Expected: PASS (the schema from Task 12 lists both).

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
            `${key} cannot run on ${dev.description}: ${cov.unsupported.join(', ')} unsupported — it will load on CPU`,
            { dedupeKey: 'native.ops.unsupported' });
        }
      }
```

Reset the three fields wherever `engineInfo` is reset to `null` (the idle/unavailable transitions).

- [ ] **Step 4: The muted note**

`NativeModelManagementSection.tsx` `variantData` (line ~541): carry `unsupportedTiers: v.unsupportedTiers` into the `VariantInfo`. In `VariantDropdown`'s option (line ~135), after the `!v.supported` reason span add:

```tsx
              {v.supported && v.unsupportedTiers && v.unsupportedTiers.length > 0 && (
                <span className="model-card__variant-reason">{t('models.variantRunsOnCpu', 'Runs on CPU on this machine')}</span>
              )}
```

Add `"variantRunsOnCpu": "Runs on CPU on this machine"` to `models` in `src/locales/en/translation.json` and a translation in each of the other 29 locale files (same key, translated string — follow the pattern of `models.variantNoGpuFits` in each file).

- [ ] **Step 5: Run the renderer suites and tsc**

Run: `npx vitest run src/stores src/components/Settings src/lib/local-inference && npx tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: all pass; the `error TS` count is unchanged from `main` (312 today).

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
- Modify: `sidecar/requirements.txt` (five wheel URLs), `sidecar/tests/test_runtime_gate.py`, `package.json` (`sidecarVersion`), `CLAUDE.md` / `native/README.md` version sentences (if not already at 1.1.0 from Task 1)

Every outward act below (push, PR, tag) is done only after jiangzhuo confirms that specific act, naming the target (`kizuna-ai-lab/sokuji`, the branch, the tag).

- [ ] **Step 1: Dry run the wheels** — ask to run `native-build.yml` via `workflow_dispatch` on the feature branch; expect five green lanes (`test_common` with the profile assertions passes on the paravirtual Metal runner through the inverse assertion; `test_ops_coverage` runs for the five CI-downloaded models on every lane).
- [ ] **Step 2: PR into `main`** — ask to push the branch and open the PR (title: `native+sidecar: device profile, op recordings, cache generations (spec A)`); after review, ask to merge with a merge commit.
- [ ] **Step 3: Tag `native-v1.1.0` on `main`** — ask; verify first that `main` has `VERSION 1.1.0`, `SK_ABI_VERSION 2` in all three places, and the nine `tts-*.ops` files; push the tag; wait for the five wheels (prerelease).
- [ ] **Step 4: Pin the sidecar** — on a `chore/sidecar-v0.3.0` branch: `sed -i 's|native-v1\.0\.2/sokuji_native-1\.0\.2-|native-v1.1.0/sokuji_native-1.1.0-|g' sidecar/requirements.txt`, the same in `sidecar/tests/test_runtime_gate.py`, `"sidecarVersion": "0.3.0"` in `package.json`; run the sidecar suite (734+ pass); ask to push + PR + merge.
- [ ] **Step 5: Tag `sidecar-v0.3.0` on the merge commit** — verify `git show <sha>:sidecar/requirements.txt | grep -c 1.1.0` prints 5 and `sidecarVersion` is 0.3.0; ask; push the tag; wait for `sidecar-bundles.yml` (five bundles + `manifest.json`).
- [ ] **Step 6: Fleet smoke** — the smoke script from the 0.2.1 release (`smoke.sh <sku> <device> <workdir>`) plus one `hardware_info` assertion: `devices[]` present with `known: true` on GB10 (Vulkan), the Ubuntu 4070 (Vulkan, glibc 2.35) and the M4 (Metal, `mtl_simdgroup_reduction` set).

---

## Self-review (run after writing; findings fixed inline)

**Spec coverage.** §3.1 profile → Tasks 1–3 (CPU/Metal in 2, Vulkan + matcher + `DENY_BY_FILE` + headers in 3). §3.2 recordings, `WEIGHT` dtype sets, cost/hazard, families, two recording mechanisms, `test_ops_coverage`, checklist → Tasks 4–6. §3.3 `graph_family`/`arch=`, fallback sets, `DeviceProfile`/`OpCoverage`/`Machine` fields, detectors, generation, `_cache_key` both sides, `bench_read`/`bench_save`, `weight_dtypes`, the three coverage callables, nine threaded functions, the gate, fit-walk restriction, structured R36, wire semantics → Tasks 7–12. §3.4 wire + renderer → Tasks 12–13. §3.5 rollout → Task 14. §4 tests: each bullet maps to a test in the task that implements the behaviour; the characterisation guard is Task 11 Step 3; `check_linux_deps` per-file rule is Task 3; the configure-time ABI check is Task 1 Step 8.

**Placeholders.** None: every code step carries the code. Two data-gathering steps are procedural by nature and say exactly what to run and what verifies the result — the ASR/translate `arch=` values (Task 7 Step 4, pinned for cached models by Task 7's tests and `sk_asr_caps.arch`) and the `ggml_backend_i`/`ggml_backend_device_i` initializer orders (Task 4 Step 5, a compile error if wrong).

**Type consistency.** `OpCoverage` is `(all_supported, unsupported)` in the sidecar (Tasks 8, 10, 11, 12) and `(all_supported, unsupported, checked)` in the binding (Task 5) — the sidecar's `compute_op_coverage` reads only the first two, as written. The callable signature is `(index, stage, family, compute_type)` everywhere (Tasks 10, 11, 12). `_ops_key` spelling `gen|ops:idx:stage:family:ct` matches `_devices_wire`'s split (Task 12). `DeviceProfile` field order is identical in `accel.py` (Task 8) and the binding (Task 2). Feature-bit names in `_ffi.FEATURE_BITS` (Task 1) match the strings the planner tests (`mtl_simdgroup_reduction`, Task 11) and the C enum comment.
