# ggml-only sidecar — Slice 1: native skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `native/` — a CMake super-project that builds one pristine upstream ggml plus transcribe.cpp, llama.cpp and audio.cpp (six families) into a single `libsokuji_native`, exposes the common part of the `sk_*` C ABI (`sk_init`, `sk_devices`, `sk_version`, …), wraps it in the `sokuji_native` Python package, and ships five platform wheels from a `native-build.yml` workflow. No ASR/translate/TTS calls yet — those are slices 2–4.

**Architecture:** One ggml (shared library + dynamically loaded backend modules) is added to the build exactly once by the super-project; the three engines are patched or configured to reuse the existing `ggml` target and are linked statically into `libsokuji_native`. A force-included `audiocpp_compat.h` supplies the eight symbols audio.cpp's framework references that upstream ggml lacks. The Python side is a pure ctypes binding that checks `contract.json` and calls `sk_init`.

**Tech Stack:** CMake ≥ 3.24 (FetchContent with `GIT_TAG` commit pins), C++17, ggml v0.22.0, transcribe.cpp v0.2.2, llama.cpp v0.3.0, audio.cpp v0.7.0, Python 3.12 + ctypes + setuptools, GitHub Actions (five runners), Vulkan SDK / glslc on Linux + Windows.

**Spec:** `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md` — §4 (native layer) is what this plan implements; §10 slice 1 is its scope.

> **Executed 2026-08-30 (PR #459).** The code under `native/` is the authority; this plan
> is the argument it was built from, and these parts of it were superseded during
> execution (each ruling is in the per-task review in the PR history). Do not re-execute
> the snippets below as written:
> - Platforms: the Linux lanes build on `ubuntu-24.04` / `ubuntu-24.04-arm` and tag
>   `manylinux_2_39_*` (22.04 packages no `glslc`); the spec table says the same.
> - `TRANSCRIBE_GGML_BACKEND_DL` is OFF — transcribe.cpp v0.2.2 refuses DL with a static
>   build. `sk_init` loads the ggml modules for every engine.
> - `AUDIOCPP_MODELS` does not list `silero_vad`: audio.cpp's VAD loaders are always
>   compiled and are not selectable. `sk_audio_families()` reports every compiled family
>   unfiltered (eight at v0.7.0); support is decided by the sidecar catalog, and
>   `contract.json` carries no family list.
> - `sk_audio_families()` reads `ModelRegistry::families()`; there is no `loaders()`.
> - `audiocpp_compat.h` reproduces the fork's im2col graph (`ggml_im2col` in `a->type` →
>   `ggml_mul_mat` → reshape), not `ggml_conv_1d`.
> - `patch_upstream.py` reports "already patched" only when `new` is present AND `old`
>   occurs nowhere outside it (a patch may wrap the original line); `old` surviving
>   elsewhere is an error.
> - The wheel version is read from the staged `contract.json` (`setup.py:
>   native_version()`), never a literal, and a build without a staged payload is refused.
> - `_load()` keeps the `os.add_dll_directory()` handle alive at module scope.
> - `compare_pcm.py` keeps the channel layout and rejects sample-rate mismatches; it
>   never downmixes.

## Global Constraints

- Upstream pins (spec §4.1) — never vendored, always by commit:
  - ggml `v0.22.0` = `34dc0e5589504286cb40e13cbdae4bf2b5b4071b`
  - transcribe.cpp `v0.2.2` = `c6a9257cdf8e9c6918c0f8f876246db048a22103`
  - llama.cpp `v0.3.0` = `c1d0e7a004015f23bc0233470b747b596f29b264` (its in-tree ggml is 0.22.0 — verified)
  - audio.cpp `v0.7.0` = `d2ff37009c69d464bcab6aa4a44a13746e84a914`
- One ggml: the `ggml` CMake target is created once, by the super-project. Engines are patched/configured to reuse it. Backends are dynamic modules (`GGML_BACKEND_DL=ON`).
- audio.cpp family subset (spec §4.2): `moss_tts_nano;qwen3_tts;omnivoice;pocket_tts;supertonic;silero_vad`. No CLI, no server, no WebUI/demo voices.
- C ABI conventions (spec §4.3): opaque handles; every call returns `sk_status` (0 ok, negative error); `sk_last_error()` thread-local UTF-8; callbacks take `void * user` and return `bool` (`false` = cancel); library memory freed with `sk_free`; threads set once in `sk_init`; `SK_ABI_VERSION` integer + `sk_version()` string.
- Naming (spec §1.1 item 7): stage names `asr` / `translate` / `tts` / `vad`, prefix `sk_`; never technology names in public identifiers.
- Platforms (spec §4.6): linux-x64 (`ubuntu-22.04`, Vulkan), linux-arm64 (`ubuntu-22.04-arm`, Vulkan), win-x64 (`windows-2022`, Vulkan), mac-arm64 (`macos-14`, Metal), mac-x64 (`macos-15-intel`, CPU).
- Wheel: `sokuji_native-<ver>-py3-none-<platform>.whl`; `contract.json` = `{abi, version, ggml, transcribe, llama, audiocpp, backends, lane}`.
- Everything persisted in the repo (code, comments, commit messages, docs) is English. Commits are conventional-commit style and confirmed by jiangzhuo before pushing; `native-v*` tags are pushed only on explicit instruction.
- Do not touch `sidecar/requirements.txt` in this slice — the sidecar keeps working on transcribe-cpp 0.2.2 until slice 2.

---

## File structure

```
native/
  CMakeLists.txt                       super-project entry; order: options → ggml → engines → libsokuji_native → tests
  cmake/upstreams.cmake                FetchContent declarations (four commit pins) + patch hooks
  cmake/ggml_options.cmake             SOKUJI_GPU (auto|none|vulkan|metal) → forced GGML_* cache values
  cmake/patch_upstream.py              idempotent exact-string patcher used by PATCH_COMMAND
  cmake/contract.json.in               template rendered at configure time
  include/sokuji_native.h              the public C header (slice 1: common surface only)
  src/version.h.in                     compile-time version strings from CMake
  src/sk_common.cpp                    sk_init / sk_devices / sk_device_free_mem / sk_version / sk_engine_versions / sk_last_error / sk_free
  src/sk_selftest.cpp                  sk_audio_families — proves audio.cpp is linked and built with the six families
  src/audiocpp_compat.h                fork-op → upstream-ggml bridge, force-included into audio.cpp TUs
  tests/CMakeLists.txt                 CTest registration
  tests/test_common.cpp                exercises the slice-1 C surface (plain asserts, no framework)
  tests/parity/compare_pcm.py          max-abs-diff / SNR comparison of two WAVs (scaffold for slice 4)
  tests/parity/test_compare_pcm.py     pytest for the comparator on synthetic signals
  python/pyproject.toml                setuptools metadata
  python/setup.py                      platform-tagged wheel (py3-none-<plat>)
  python/sokuji_native/__init__.py     contract check, library load, sk_init, devices(), version()
  python/sokuji_native/_ffi.py         ctypes declarations for the slice-1 surface
  python/sokuji_native/_native/        (gitignored) installed binaries + contract.json
  python/tests/test_sokuji_native.py   pytest against a built tree (skips when absent) + contract-mismatch test
  ci/build.sh                          the exact build used by CI and by developers (Linux/macOS)
  ci/build.ps1                         same for Windows
  README.md                            how to build, where things go, how to bump a pin
.github/workflows/native-build.yml     five build jobs + release job on native-v* tags
.gitignore                             + native/build/, native/python/sokuji_native/_native/, native/python/dist/
```

---

### Task 1: Super-project skeleton that builds one dynamic-backend ggml

**Files:**
- Create: `native/CMakeLists.txt`
- Create: `native/cmake/upstreams.cmake`
- Create: `native/cmake/ggml_options.cmake`
- Create: `native/cmake/patch_upstream.py`
- Modify: `.gitignore` (append three lines)

**Interfaces:**
- Produces: CMake target `ggml` (shared), backend modules `ggml-cpu*`, optionally `ggml-vulkan` / `ggml-metal`, all output to `${CMAKE_BINARY_DIR}/lib`; CMake cache option `SOKUJI_GPU` = `auto|none|vulkan|metal`; variables `SOKUJI_GGML_SOURCE_DIR`, `SOKUJI_LANE` (`cpu`, `cpu-vulkan`, `metal`).

- [ ] **Step 1: Write the patcher (needed by later tasks; trivial, no test beyond running it)**

`native/cmake/patch_upstream.py`:

```python
"""Idempotent exact-string patch for a fetched upstream file.

usage: patch_upstream.py <file> <old-string> <new-string>
Replaces the single occurrence of <old-string> with <new-string>. Exits 0
without touching the file when <new-string> is already present, so FetchContent
can re-run it on every populate. Fails loudly if <old-string> is not found
exactly once — that means the upstream pin moved and the patch must be revisited.
"""
import sys
from pathlib import Path

path, old, new = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text(encoding="utf-8")
if new in text:
    print(f"patch_upstream: {path.name}: already patched")
    sys.exit(0)
if text.count(old) != 1:
    print(f"patch_upstream: {path.name}: expected exactly one occurrence of {old!r}, found {text.count(old)}")
    sys.exit(1)
path.write_text(text.replace(old, new), encoding="utf-8")
print(f"patch_upstream: {path.name}: patched")
```

- [ ] **Step 2: Write `native/cmake/ggml_options.cmake`**

```cmake
# GPU lane selection and the ggml knobs the whole super-project depends on.
# Every GGML_* value is FORCEd into the cache: audio.cpp's CMake force-sets
# several of them itself, and a stale cache from a previous configure must
# never win over this file.
set(SOKUJI_GPU "auto" CACHE STRING "GPU lane: auto | none | vulkan | metal")
set_property(CACHE SOKUJI_GPU PROPERTY STRINGS auto none vulkan metal)

if(SOKUJI_GPU STREQUAL "auto")
    if(APPLE AND CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
        set(SOKUJI_GPU_RESOLVED metal)
    elseif(NOT APPLE)
        find_package(Vulkan QUIET)
        if(Vulkan_FOUND AND Vulkan_GLSLC_EXECUTABLE)
            set(SOKUJI_GPU_RESOLVED vulkan)
        else()
            set(SOKUJI_GPU_RESOLVED none)
        endif()
    else()
        set(SOKUJI_GPU_RESOLVED none)      # Intel macOS: ggml Metal is Apple-Silicon only
    endif()
else()
    set(SOKUJI_GPU_RESOLVED ${SOKUJI_GPU})
endif()
message(STATUS "sokuji-native GPU lane: ${SOKUJI_GPU_RESOLVED}")

set(BUILD_SHARED_LIBS ON)                                   # ggml itself is shared …
set(GGML_BACKEND_DL ON  CACHE BOOL "" FORCE)                # … and its backends are modules
set(GGML_NATIVE OFF     CACHE BOOL "" FORCE)                # portable wheels, never -march=native
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)           # one module per ISA tier (x86 and arm64)
set(GGML_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_TESTS OFF    CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_HIP  OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_METAL  OFF CACHE BOOL "" FORCE)
if(SOKUJI_GPU_RESOLVED STREQUAL "vulkan")
    set(GGML_VULKAN ON CACHE BOOL "" FORCE)
    set(SOKUJI_LANE "cpu-vulkan")
elseif(SOKUJI_GPU_RESOLVED STREQUAL "metal")
    set(GGML_METAL ON CACHE BOOL "" FORCE)
    set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)    # no .metallib file to ship
    set(SOKUJI_LANE "metal")
else()
    set(SOKUJI_LANE "cpu")
endif()
```

- [ ] **Step 3: Write `native/cmake/upstreams.cmake` (ggml only for now; the other three are added in Tasks 3–5)**

```cmake
include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# Pins are commit SHAs, not tag names: a tag can be moved, a commit cannot.
FetchContent_Declare(ggml
    GIT_REPOSITORY https://github.com/ggml-org/ggml.git
    GIT_TAG        34dc0e5589504286cb40e13cbdae4bf2b5b4071b   # v0.22.0
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE)
set(SOKUJI_GGML_VERSION "0.22.0")

FetchContent_MakeAvailable(ggml)
set(SOKUJI_GGML_SOURCE_DIR "${ggml_SOURCE_DIR}")
```

- [ ] **Step 4: Write `native/CMakeLists.txt`**

```cmake
cmake_minimum_required(VERSION 3.24)
project(sokuji_native VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)   # Windows DLLs land beside the .so/.dylib equivalents
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()
find_package(Python3 COMPONENTS Interpreter REQUIRED)         # for patch_upstream.py

include(cmake/ggml_options.cmake)
include(cmake/upstreams.cmake)

# Engines are added by Tasks 3–5; libsokuji_native by Task 2.
```

- [ ] **Step 5: Append to `.gitignore`**

```
# native super-project build outputs
native/build/
native/python/sokuji_native/_native/
native/python/dist/
```

- [ ] **Step 6: Configure and build (CPU lane on the GB10 dev box, which has no Vulkan SDK)**

Run:
```bash
cmake -S native -B native/build/cpu -DSOKUJI_GPU=none
cmake --build native/build/cpu -j"$(nproc)"
ls native/build/cpu/lib
```
Expected: `libggml-base.so`, `libggml.so`, and several `libggml-cpu-<variant>.so` (armv8.x/armv9.x on the GB10; on x86 haswell/skylakex/…); no `libggml-cpu.so` singleton (that would mean `GGML_CPU_ALL_VARIANTS` was lost).

- [ ] **Step 7: Commit**

```bash
git add native/CMakeLists.txt native/cmake .gitignore
git commit -m "build(native): super-project skeleton building one dynamic-backend ggml"
```

---

### Task 2: The common C ABI — `sk_init`, `sk_devices`, `sk_version`, errors, memory

**Files:**
- Create: `native/include/sokuji_native.h`
- Create: `native/src/version.h.in`
- Create: `native/src/sk_common.cpp`
- Create: `native/tests/CMakeLists.txt`
- Create: `native/tests/test_common.cpp`
- Modify: `native/CMakeLists.txt` (add library + tests)

**Interfaces:**
- Produces (C, `native/include/sokuji_native.h`):
  - `#define SK_ABI_VERSION 1`
  - `typedef int32_t sk_status;` `SK_OK = 0`, `SK_ERR_INVALID_ARGUMENT = -1`, `SK_ERR_NOT_INITIALISED = -2`, `SK_ERR_BACKEND = -3`, `SK_ERR_NOT_FOUND = -4`, `SK_ERR_CANCELLED = -5`, `SK_ERR_INTERNAL = -6`
  - `typedef bool (*sk_log_cb)(int level, const char *message, void *user);`
  - `struct sk_init_options { int32_t abi_version; int32_t n_threads; const char *module_dir; sk_log_cb log; void *log_user; }`
  - `enum sk_device_kind { SK_DEVICE_CPU = 0, SK_DEVICE_VULKAN = 1, SK_DEVICE_METAL = 2, SK_DEVICE_OTHER = 99 }`
  - `struct sk_device { int32_t index; int32_t kind; char name[64]; char description[128]; uint64_t mem_total; uint64_t mem_free; }`
  - `sk_status sk_init(const sk_init_options *)`, `int32_t sk_devices(sk_device *out, int32_t cap)`, `sk_status sk_device_free_mem(int32_t index, uint64_t *bytes)`, `const char *sk_version(void)`, `int32_t sk_abi_version(void)`, `const char *sk_engine_versions(void)`, `const char *sk_last_error(void)`, `void sk_free(void *)`
- Consumed by every later task; `sk_engine_versions()` gains one `key=value` segment per engine in Tasks 3–5.

- [ ] **Step 1: Write the failing test**

`native/tests/test_common.cpp`:

```cpp
// Slice-1 surface test. Plain asserts on purpose: no test framework to fetch.
#include "sokuji_native.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>

static int g_log_calls = 0;
static bool log_sink(int, const char *, void *) { ++g_log_calls; return true; }

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";

    assert(sk_abi_version() == SK_ABI_VERSION);
    assert(std::string(sk_version()).rfind("0.", 0) == 0);          // "0.1.0"
    assert(std::strstr(sk_engine_versions(), "ggml=0.22.0") != nullptr);
    assert(std::string(sk_last_error()).empty());

    sk_device before[8];
    assert(sk_devices(before, 8) == 0);                              // nothing before init
    assert(sk_device_free_mem(0, nullptr) == SK_ERR_INVALID_ARGUMENT);

    sk_init_options wrong = {};
    wrong.abi_version = SK_ABI_VERSION + 1;
    assert(sk_init(&wrong) == SK_ERR_INVALID_ARGUMENT);
    assert(std::strstr(sk_last_error(), "ABI") != nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = 4;
    opts.module_dir = module_dir;
    opts.log = log_sink;
    assert(sk_init(&opts) == SK_OK);
    assert(sk_init(&opts) == SK_OK);                                 // idempotent

    sk_device devs[8];
    int n = sk_devices(devs, 8);
    assert(n >= 1);
    bool saw_cpu = false;
    for (int i = 0; i < n; ++i) {
        assert(devs[i].index == i);
        assert(devs[i].name[0] != '\0');
        if (devs[i].kind == SK_DEVICE_CPU) saw_cpu = true;
        uint64_t free_bytes = 0;
        assert(sk_device_free_mem(i, &free_bytes) == SK_OK);
        assert(free_bytes > 0);
    }
    assert(saw_cpu);
    assert(sk_device_free_mem(n + 5, nullptr) == SK_ERR_INVALID_ARGUMENT);

    char *buf = static_cast<char *>(std::malloc(4));
    sk_free(buf);                                                     // must accept malloc'd memory
    sk_free(nullptr);                                                 // and null
    std::printf("test_common: %d devices, %d log lines\n", n, g_log_calls);
    return 0;
}
```

`native/tests/CMakeLists.txt`:

```cmake
add_executable(test_common test_common.cpp)
target_link_libraries(test_common PRIVATE sokuji_native)
# The module dir is where ggml's backend .so/.dll/.dylib files were written.
add_test(NAME test_common COMMAND test_common ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_common PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j"$(nproc)"`
Expected: configure error `add_subdirectory given source "tests" which is not an existing directory` or link error `sokuji_native not found` — either proves the target does not exist yet.

- [ ] **Step 3: Write the header**

`native/include/sokuji_native.h`:

```c
/* sokuji-native — the one C ABI the sidecar talks to.
 * Conventions: opaque handles; every call returns sk_status (0 ok, negative error) and
 * sk_last_error() carries a thread-local UTF-8 message; callbacks take a void *user and
 * return bool — false cancels; memory the library hands out is released with sk_free();
 * threads are configured once in sk_init(). Prefixes name the stage (sk_asr_, sk_vad_,
 * sk_translate_, sk_tts_), never the engine behind it. */
#ifndef SOKUJI_NATIVE_H
#define SOKUJI_NATIVE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#  if defined(SOKUJI_NATIVE_BUILD)
#    define SK_API __declspec(dllexport)
#  else
#    define SK_API __declspec(dllimport)
#  endif
#else
#  define SK_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SK_ABI_VERSION 1

typedef int32_t sk_status;
enum {
    SK_OK                   =  0,
    SK_ERR_INVALID_ARGUMENT = -1,
    SK_ERR_NOT_INITIALISED  = -2,
    SK_ERR_BACKEND          = -3,
    SK_ERR_NOT_FOUND        = -4,
    SK_ERR_CANCELLED        = -5,
    SK_ERR_INTERNAL         = -6,
};

/* level: 0 debug, 1 info, 2 warn, 3 error. Return value is ignored for logs but kept
 * so every callback in this ABI has the same shape. */
typedef bool (*sk_log_cb)(int32_t level, const char *message, void *user);

typedef struct sk_init_options {
    int32_t     abi_version;   /* must equal SK_ABI_VERSION */
    int32_t     n_threads;     /* 0 = hardware concurrency */
    const char *module_dir;    /* directory holding the ggml backend modules; NULL = next to this library */
    sk_log_cb   log;           /* optional */
    void       *log_user;
} sk_init_options;

enum sk_device_kind { SK_DEVICE_CPU = 0, SK_DEVICE_VULKAN = 1, SK_DEVICE_METAL = 2, SK_DEVICE_OTHER = 99 };

typedef struct sk_device {
    int32_t  index;            /* stable for the life of the process */
    int32_t  kind;             /* sk_device_kind */
    char     name[64];         /* e.g. "Vulkan0", "CPU" */
    char     description[128]; /* e.g. "NVIDIA GB10" */
    uint64_t mem_total;
    uint64_t mem_free;         /* snapshot at enumeration time; use sk_device_free_mem for fresh values */
} sk_device;

SK_API sk_status   sk_init(const sk_init_options *options);
SK_API int32_t     sk_devices(sk_device *out, int32_t capacity);        /* returns count written; 0 before sk_init */
SK_API sk_status   sk_device_free_mem(int32_t index, uint64_t *bytes);
SK_API int32_t     sk_abi_version(void);
SK_API const char *sk_version(void);                                    /* "0.1.0" */
SK_API const char *sk_engine_versions(void);                            /* "ggml=0.22.0;transcribe=0.2.2;..." */
SK_API const char *sk_last_error(void);                                 /* thread-local, "" when none */
SK_API void        sk_free(void *p);

#ifdef __cplusplus
}
#endif
#endif /* SOKUJI_NATIVE_H */
```

- [ ] **Step 4: Write `native/src/version.h.in`**

```c
#pragma once
#define SK_VERSION_STRING     "@PROJECT_VERSION@"
#define SK_GGML_VERSION       "@SOKUJI_GGML_VERSION@"
#define SK_TRANSCRIBE_VERSION "@SOKUJI_TRANSCRIBE_VERSION@"
#define SK_LLAMA_VERSION      "@SOKUJI_LLAMA_VERSION@"
#define SK_AUDIOCPP_VERSION   "@SOKUJI_AUDIOCPP_VERSION@"
#define SK_LANE               "@SOKUJI_LANE@"
```

- [ ] **Step 5: Write `native/src/sk_common.cpp`**

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "version.h"

#include "ggml-backend.h"
#include "ggml.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace {

thread_local std::string t_last_error;
std::mutex g_mutex;
bool g_initialised = false;
int  g_threads = 0;
sk_log_cb g_log = nullptr;
void *g_log_user = nullptr;
std::vector<ggml_backend_dev_t> g_devices;
std::string g_engine_versions;

void set_error(const std::string &msg) { t_last_error = msg; }

void log_line(int32_t level, const char *msg) {
    if (g_log) g_log(level, msg, g_log_user);
}

void ggml_log_bridge(enum ggml_log_level level, const char *text, void *) {
    int32_t mapped = level >= GGML_LOG_LEVEL_ERROR ? 3 : level == GGML_LOG_LEVEL_WARN ? 2 : level == GGML_LOG_LEVEL_INFO ? 1 : 0;
    std::string line(text ? text : "");
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (!line.empty()) log_line(mapped, line.c_str());
}

std::string own_directory() {
#if defined(_WIN32)
    HMODULE mod = nullptr;
    GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCSTR>(&own_directory), &mod);
    char path[MAX_PATH] = {};
    GetModuleFileNameA(mod, path, MAX_PATH);
    std::string p(path);
    return p.substr(0, p.find_last_of("\\/"));
#else
    Dl_info info{};
    dladdr(reinterpret_cast<void *>(&own_directory), &info);
    std::string p(info.dli_fname ? info.dli_fname : ".");
    auto slash = p.find_last_of('/');
    return slash == std::string::npos ? "." : p.substr(0, slash);
#endif
}

int32_t kind_of(ggml_backend_dev_t dev) {
    if (ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_CPU) return SK_DEVICE_CPU;
    ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
    std::string reg_name = reg ? ggml_backend_reg_name(reg) : "";
    if (reg_name == "Vulkan") return SK_DEVICE_VULKAN;
    if (reg_name == "Metal")  return SK_DEVICE_METAL;
    return SK_DEVICE_OTHER;
}

}  // namespace

extern "C" {

SK_API int32_t sk_abi_version(void) { return SK_ABI_VERSION; }
SK_API const char *sk_version(void) { return SK_VERSION_STRING; }
SK_API const char *sk_last_error(void) { return t_last_error.c_str(); }
SK_API void sk_free(void *p) { std::free(p); }

SK_API const char *sk_engine_versions(void) {
    static const std::string s = std::string("ggml=") + SK_GGML_VERSION + ";lane=" + SK_LANE;
    return s.c_str();
}

SK_API sk_status sk_init(const sk_init_options *options) {
    if (!options) { set_error("sk_init: options is NULL"); return SK_ERR_INVALID_ARGUMENT; }
    if (options->abi_version != SK_ABI_VERSION) {
        set_error("sk_init: ABI mismatch: caller " + std::to_string(options->abi_version) +
                  ", library " + std::to_string(SK_ABI_VERSION));
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_initialised) return SK_OK;

    g_log = options->log;
    g_log_user = options->log_user;
    g_threads = options->n_threads > 0 ? options->n_threads : static_cast<int>(std::thread::hardware_concurrency());
    ggml_log_set(ggml_log_bridge, nullptr);

    std::string dir = options->module_dir && options->module_dir[0] ? options->module_dir : own_directory();
    ggml_backend_load_all_from_path(dir.c_str());

    g_devices.clear();
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) g_devices.push_back(ggml_backend_dev_get(i));
    if (g_devices.empty()) {
        set_error("sk_init: no ggml backend modules found in " + dir);
        return SK_ERR_BACKEND;
    }
    log_line(1, ("sk_init: " + std::to_string(g_devices.size()) + " device(s), modules from " + dir +
                 ", " + std::to_string(g_threads) + " threads").c_str());
    g_initialised = true;
    t_last_error.clear();
    return SK_OK;
}

SK_API int32_t sk_devices(sk_device *out, int32_t capacity) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_initialised || !out || capacity <= 0) return 0;
    int32_t n = 0;
    for (size_t i = 0; i < g_devices.size() && n < capacity; ++i, ++n) {
        sk_device &d = out[n];
        std::memset(&d, 0, sizeof d);
        d.index = static_cast<int32_t>(i);
        d.kind = kind_of(g_devices[i]);
        std::snprintf(d.name, sizeof d.name, "%s", ggml_backend_dev_name(g_devices[i]));
        std::snprintf(d.description, sizeof d.description, "%s", ggml_backend_dev_description(g_devices[i]));
        size_t free_b = 0, total_b = 0;
        ggml_backend_dev_memory(g_devices[i], &free_b, &total_b);
        d.mem_total = total_b;
        d.mem_free = free_b;
    }
    return n;
}

SK_API sk_status sk_device_free_mem(int32_t index, uint64_t *bytes) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!bytes || index < 0 || static_cast<size_t>(index) >= g_devices.size()) {
        set_error("sk_device_free_mem: bad index or NULL out-pointer");
        return SK_ERR_INVALID_ARGUMENT;
    }
    size_t free_b = 0, total_b = 0;
    ggml_backend_dev_memory(g_devices[index], &free_b, &total_b);
    *bytes = free_b;
    return SK_OK;
}

}  // extern "C"
```

`sk_threads()` is intentionally not public yet; `g_threads` is consumed by the engine wrappers in slices 2–4 through an internal header added then.

- [ ] **Step 6: Add the library and tests to `native/CMakeLists.txt`** (append after the `include(cmake/upstreams.cmake)` line)

```cmake
set(SOKUJI_TRANSCRIBE_VERSION "" )   # filled by Task 3
set(SOKUJI_LLAMA_VERSION "")         # filled by Task 4
set(SOKUJI_AUDIOCPP_VERSION "")      # filled by Task 5
configure_file(src/version.h.in ${CMAKE_BINARY_DIR}/generated/version.h @ONLY)

set(BUILD_SHARED_LIBS OFF)           # everything after ggml is static — engines fold into libsokuji_native
add_library(sokuji_native SHARED
    src/sk_common.cpp)
target_include_directories(sokuji_native
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_BINARY_DIR}/generated)
target_compile_definitions(sokuji_native PRIVATE SOKUJI_NATIVE_BUILD=1)
target_link_libraries(sokuji_native PRIVATE ggml)
set_target_properties(sokuji_native PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    BUILD_RPATH "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")
if(APPLE)
    set_target_properties(sokuji_native PROPERTIES BUILD_RPATH "@loader_path" INSTALL_RPATH "@loader_path")
endif()
if(NOT WIN32)
    target_link_libraries(sokuji_native PRIVATE ${CMAKE_DL_LIBS})
endif()

enable_testing()
add_subdirectory(tests)
```

- [ ] **Step 7: Build and run the test**

Run:
```bash
cmake -S native -B native/build/cpu -DSOKUJI_GPU=none
cmake --build native/build/cpu -j"$(nproc)"
ctest --test-dir native/build/cpu --output-on-failure
```
Expected: `test_common ... Passed`, output line like `test_common: 1 devices, N log lines` (CPU only on a box without Vulkan SDK; `2 devices` where Vulkan is built).

- [ ] **Step 8: Commit**

```bash
git add native/include native/src native/tests native/CMakeLists.txt
git commit -m "feat(native): common C ABI — sk_init, sk_devices, versions, errors"
```

---

### Task 3: Link transcribe.cpp against the shared ggml

**Files:**
- Modify: `native/cmake/upstreams.cmake` (add transcribe.cpp with patch hook)
- Modify: `native/CMakeLists.txt` (link, version)
- Modify: `native/src/sk_common.cpp` (`sk_engine_versions` adds `transcribe=`)
- Modify: `native/tests/test_common.cpp` (assert the segment)

**Interfaces:**
- Consumes: `ggml` target from Task 1.
- Produces: static target `transcribe` linked into `sokuji_native`; `sk_engine_versions()` contains `transcribe=0.2.2`; CMake variable `SOKUJI_TRANSCRIBE_VERSION`.

- [ ] **Step 1: Extend the test**

In `native/tests/test_common.cpp`, after the `ggml=0.22.0` assert add:

```cpp
    assert(std::strstr(sk_engine_versions(), "transcribe=0.2.2") != nullptr);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cmake --build native/build/cpu -j"$(nproc)" && ctest --test-dir native/build/cpu --output-on-failure`
Expected: `test_common` FAILS on the new assert.

- [ ] **Step 3: Declare transcribe.cpp with the ggml-guard patch** (append to `native/cmake/upstreams.cmake`)

transcribe.cpp's top-level CMake runs `add_subdirectory(ggml)` unconditionally (line 430 at v0.2.2). The patch wraps that single line in `if(NOT TARGET ggml)` so it reuses ours.

```cmake
FetchContent_Declare(transcribe
    GIT_REPOSITORY https://github.com/handy-computer/transcribe.cpp.git
    GIT_TAG        c6a9257cdf8e9c6918c0f8f876246db048a22103   # v0.2.2
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    PATCH_COMMAND  ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                   <SOURCE_DIR>/CMakeLists.txt
                   "add_subdirectory(ggml)"
                   "if(NOT TARGET ggml)\n    add_subdirectory(ggml)\nendif()")
set(SOKUJI_TRANSCRIBE_VERSION "0.2.2")

# transcribe.cpp options: static, dynamic ggml backends, nothing but the library.
set(TRANSCRIBE_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_USE_SYSTEM_BLAS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_VULKAN OFF CACHE BOOL "" FORCE)   # backends come from the shared ggml, not from transcribe's own flags
set(TRANSCRIBE_METAL  OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_CUDA   OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(transcribe)
```

- [ ] **Step 4: Link and record the version** — in `native/CMakeLists.txt` replace `set(SOKUJI_TRANSCRIBE_VERSION "" )` with nothing (it is now set in upstreams.cmake) and add after the `target_link_libraries(sokuji_native PRIVATE ggml)` line:

```cmake
target_link_libraries(sokuji_native PRIVATE transcribe)
target_include_directories(sokuji_native PRIVATE ${transcribe_SOURCE_DIR}/include)
```

- [ ] **Step 5: Reference the engine so the static archive is really linked** — in `native/src/sk_common.cpp` add `#include "transcribe.h"` and change `sk_engine_versions` to:

```cpp
SK_API const char *sk_engine_versions(void) {
    static const std::string s = std::string("ggml=") + SK_GGML_VERSION +
                                 ";transcribe=" + transcribe_version() +
                                 ";lane=" + SK_LANE;
    return s.c_str();
}
```

(`transcribe_version()` is declared in transcribe.cpp's `include/transcribe.h`; using it pulls the archive in and proves the link.)

- [ ] **Step 6: Build and run**

Run: `cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j"$(nproc)" && ctest --test-dir native/build/cpu --output-on-failure`
Expected: configure log shows `patch_upstream: CMakeLists.txt: patched` once (then `already patched` on re-runs); `test_common` passes.

- [ ] **Step 7: Commit**

```bash
git add native/cmake/upstreams.cmake native/CMakeLists.txt native/src/sk_common.cpp native/tests/test_common.cpp
git commit -m "build(native): link transcribe.cpp v0.2.2 against the shared ggml"
```

---

### Task 4: Link llama.cpp against the shared ggml

**Files:**
- Modify: `native/cmake/upstreams.cmake`
- Modify: `native/CMakeLists.txt`
- Modify: `native/src/sk_common.cpp`
- Modify: `native/tests/test_common.cpp`

**Interfaces:**
- Produces: static target `llama` linked into `sokuji_native`; `sk_engine_versions()` contains `llama=v0.3.0`; `SOKUJI_LLAMA_VERSION`.

- [ ] **Step 1: Extend the test**

```cpp
    assert(std::strstr(sk_engine_versions(), "llama=") != nullptr);
```

- [ ] **Step 2: Run to verify it fails** — `cmake --build native/build/cpu -j"$(nproc)" && ctest --test-dir native/build/cpu --output-on-failure` → FAIL on the new assert.

- [ ] **Step 3: Declare llama.cpp** (append to `native/cmake/upstreams.cmake`). llama.cpp already guards with `if (NOT TARGET ggml AND NOT LLAMA_USE_SYSTEM_GGML)`, so no patch is needed.

```cmake
FetchContent_Declare(llama
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG        c1d0e7a004015f23bc0233470b747b596f29b264   # v0.3.0 (in-tree ggml 0.22.0)
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE)
set(SOKUJI_LLAMA_VERSION "v0.3.0")

set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(llama)
```

- [ ] **Step 4: Link** — in `native/CMakeLists.txt` add:

```cmake
target_link_libraries(sokuji_native PRIVATE llama)
target_include_directories(sokuji_native PRIVATE ${llama_SOURCE_DIR}/include)
```

and remove the `set(SOKUJI_LLAMA_VERSION "")` placeholder line.

- [ ] **Step 5: Reference the engine** — in `sk_common.cpp` add `#include "llama.h"` and extend the string:

```cpp
    static const std::string s = std::string("ggml=") + SK_GGML_VERSION +
                                 ";transcribe=" + transcribe_version() +
                                 ";llama=" + SK_LLAMA_VERSION + "(" + std::to_string(llama_max_devices()) + " max devices)" +
                                 ";lane=" + SK_LANE;
```

(`llama_max_devices()` is a cheap symbol from `llama.h` that forces the archive to link.)

- [ ] **Step 6: Build and run** → `test_common` passes.

- [ ] **Step 7: Commit**

```bash
git add native/cmake/upstreams.cmake native/CMakeLists.txt native/src/sk_common.cpp native/tests/test_common.cpp
git commit -m "build(native): link llama.cpp v0.3.0 against the shared ggml"
```

---

### Task 5: Link audio.cpp (six families) with the compatibility header

**Files:**
- Create: `native/src/audiocpp_compat.h`
- Create: `native/src/sk_selftest.cpp`
- Modify: `native/cmake/upstreams.cmake`
- Modify: `native/CMakeLists.txt`
- Modify: `native/include/sokuji_native.h` (add `sk_audio_families`)
- Modify: `native/src/sk_common.cpp` (`audiocpp=` segment)
- Modify: `native/tests/test_common.cpp`

**Interfaces:**
- Produces: `int32_t sk_audio_families(const char **out, int32_t cap)` — names of the audio.cpp families compiled in (exactly the six); `SOKUJI_AUDIOCPP_VERSION`; `sk_engine_versions()` contains `audiocpp=0.7.0`.

- [ ] **Step 1: Extend the test**

```cpp
    assert(std::strstr(sk_engine_versions(), "audiocpp=0.7.0") != nullptr);
    const char *fams[16];
    int nf = sk_audio_families(fams, 16);
    assert(nf == 6);
    const char *want[] = {"moss_tts_nano", "omnivoice", "pocket_tts", "qwen3_tts", "silero_vad", "supertonic"};
    for (const char *w : want) {
        bool found = false;
        for (int i = 0; i < nf; ++i) if (std::strcmp(fams[i], w) == 0) found = true;
        assert(found);
    }
```

- [ ] **Step 2: Run to verify it fails** — build error: `sk_audio_families` undeclared.

- [ ] **Step 3: Write the compatibility header** `native/src/audiocpp_compat.h`

```c
/* audiocpp_compat.h — force-included into every audio.cpp translation unit.
 *
 * audio.cpp v0.7.0 carries a ggml fork with six private ops. Its *framework* code
 * references them unconditionally, but none of the six families we build
 * (moss_tts_nano, qwen3_tts, omnivoice, pocket_tts, supertonic, silero_vad) reaches
 * them at run time on CPU / Vulkan / Metal — see the spec, §2 and §4.4. We therefore
 * build audio.cpp on pristine upstream ggml and provide these symbols here:
 *   - col2im_1d is upstream since 0.20.2 (identical signature): nothing to do.
 *   - the fast im2col conv and pack4 matmul map to their plain upstream ops.
 *   - the bias+mask flash-attention wrapper folds the dense bias into the mask.
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

static inline struct ggml_tensor *ggml_conv_1d_fast_1d_im2col(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, int s0, int p0, int d0) {
    return ggml_conv_1d(ctx, a, b, s0, p0, d0);
}

static inline struct ggml_tensor *ggml_mul_mat_pack4(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b) {
    return ggml_mul_mat(ctx, a, b);
}

/* Upstream flash attention takes one additive mask. The fork's wrapper takes a dense
 * additive bias plus an optional mask; folding them is exact because both are added
 * to the scores before softmax. Upstream requires the mask to be F16. */
static inline struct ggml_tensor *ggml_flash_attn_ext_with_bias_mask(
        struct ggml_context *ctx, struct ggml_tensor *q, struct ggml_tensor *k, struct ggml_tensor *v,
        struct ggml_tensor *bias, struct ggml_tensor *mask, float scale, float max_bias, float logit_softcap) {
    struct ggml_tensor *m = mask;
    if (bias != NULL) {
        struct ggml_tensor *b16 = bias->type == GGML_TYPE_F16 ? bias : ggml_cast(ctx, bias, GGML_TYPE_F16);
        m = mask != NULL ? ggml_add(ctx, b16, mask) : b16;
    }
    return ggml_flash_attn_ext(ctx, q, k, v, m, scale, max_bias, logit_softcap);
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
```

If audio.cpp also references the enum members `GGML_OP_IM2COL_FAST_1D` etc. directly (e.g. in `ggml-backend-meta` hooks that the framework compiles), the build in Step 7 reports them; add `#define GGML_OP_IM2COL_FAST_1D GGML_OP_IM2COL` style aliases at the top of this header for each reported name and note them in the header comment. At v0.7.0 the framework references only the functions listed above.

- [ ] **Step 4: Declare audio.cpp with its ggml-guard patch** (append to `native/cmake/upstreams.cmake`)

audio.cpp's CMake adds `AUDIOCPP_GGML_SOURCE_DIR` as a subdirectory unconditionally (line 283 at v0.7.0). The patch guards that one line; the directory check just above it stays satisfied because we point it at the fetched upstream tree.

```cmake
FetchContent_Declare(audiocpp
    GIT_REPOSITORY https://github.com/0xShug0/audio.cpp.git
    GIT_TAG        d2ff37009c69d464bcab6aa4a44a13746e84a914   # v0.7.0
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    PATCH_COMMAND  ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                   <SOURCE_DIR>/CMakeLists.txt
                   "add_subdirectory(\"\${AUDIOCPP_GGML_SOURCE_DIR}\" \"\${CMAKE_CURRENT_BINARY_DIR}/ggml\")"
                   "if(NOT TARGET ggml)\n    add_subdirectory(\"\${AUDIOCPP_GGML_SOURCE_DIR}\" \"\${CMAKE_CURRENT_BINARY_DIR}/ggml\")\nendif()")
set(SOKUJI_AUDIOCPP_VERSION "0.7.0")

set(AUDIOCPP_GGML_SOURCE_DIR "${SOKUJI_GGML_SOURCE_DIR}" CACHE PATH "" FORCE)
set(AUDIOCPP_MODEL_SET "custom" CACHE STRING "" FORCE)
set(AUDIOCPP_MODELS "moss_tts_nano;qwen3_tts;omnivoice;pocket_tts;supertonic;silero_vad" CACHE STRING "" FORCE)
set(AUDIOCPP_DEPLOYMENT_BUILD ON CACHE BOOL "" FORCE)        # model specs compiled in: no runtime JSON dir to ship
set(AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)  # we own the ggml knobs (ggml_options.cmake)
set(ENGINE_ENABLE_NATIVE_CPU OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_CUDA OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_HIP OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_VULKAN ${GGML_VULKAN} CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_METAL ${GGML_METAL} CACHE BOOL "" FORCE)
if(APPLE)
    set(ENGINE_ENABLE_OPENMP OFF CACHE BOOL "" FORCE)         # Apple clang ships no OpenMP
else()
    set(ENGINE_ENABLE_OPENMP ON CACHE BOOL "" FORCE)
endif()
set(ENGINE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ENGINE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENGINE_BUILD_WARMBENCH OFF CACHE BOOL "" FORCE)
FetchContent_GetProperties(audiocpp)
if(NOT audiocpp_POPULATED)
    FetchContent_Populate(audiocpp)
    # EXCLUDE_FROM_ALL: audio.cpp declares its CLI/server/converter executables unconditionally;
    # we only ever build the targets sokuji_native links, so the rest is never compiled.
    add_subdirectory(${audiocpp_SOURCE_DIR} ${audiocpp_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()

# Re-assert ggml knobs audio.cpp force-set behind our back (they only affect a *future*
# configure of ggml, but we keep the cache honest so re-configures stay deterministic).
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
```

- [ ] **Step 5: Force-include the compat header into audio.cpp's engine targets and link** (append to `native/CMakeLists.txt`)

```cmake
# audio.cpp: link the runtime (six families) and inject the compatibility header into every
# engine object target. The header needs ggml-impl.h from the ggml *source* tree.
set(_audiocpp_engine_targets engine_core engine_runtime)
foreach(_fam moss_tts_nano qwen3_tts omnivoice pocket_tts supertonic silero_vad)
    if(TARGET engine_model_${_fam})
        list(APPEND _audiocpp_engine_targets engine_model_${_fam})
    endif()
endforeach()
foreach(_t IN LISTS _audiocpp_engine_targets)
    target_include_directories(${_t} PRIVATE ${SOKUJI_GGML_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/src)
    if(MSVC)
        target_compile_options(${_t} PRIVATE /FI${CMAKE_CURRENT_SOURCE_DIR}/src/audiocpp_compat.h)
    else()
        target_compile_options(${_t} PRIVATE -include ${CMAKE_CURRENT_SOURCE_DIR}/src/audiocpp_compat.h)
    endif()
endforeach()
target_sources(sokuji_native PRIVATE src/sk_selftest.cpp)
target_link_libraries(sokuji_native PRIVATE engine_runtime)
target_include_directories(sokuji_native PRIVATE ${audiocpp_SOURCE_DIR}/include)
```

Remove the `set(SOKUJI_AUDIOCPP_VERSION "")` placeholder line.

- [ ] **Step 6: Add `sk_audio_families` to the header and implement it**

Header (`native/include/sokuji_native.h`, before the closing `extern "C"`):

```c
/* Names of the audio.cpp model families compiled into this library, sorted. Diagnostic
 * only: the sidecar's catalog is the source of truth for what a user can pick. */
SK_API int32_t sk_audio_families(const char **out, int32_t capacity);
```

`native/src/sk_selftest.cpp`:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"

#include "engine/framework/runtime/registry.h"

#include <algorithm>
#include <string>
#include <vector>

extern "C" SK_API int32_t sk_audio_families(const char **out, int32_t capacity) {
    static const std::vector<std::string> names = [] {
        std::vector<std::string> v;
        auto registry = engine::runtime::make_default_registry();
        for (const auto &loader : registry->loaders()) v.push_back(loader->family());
        std::sort(v.begin(), v.end());
        return v;
    }();
    if (!out || capacity <= 0) return static_cast<int32_t>(names.size());
    int32_t n = 0;
    for (; n < capacity && static_cast<size_t>(n) < names.size(); ++n) out[n] = names[n].c_str();
    return n;
}
```

The registry accessor name (`loaders()`) is taken from `include/engine/framework/runtime/registry.h`; if the accessor at v0.7.0 is spelled differently (e.g. `families()` / `list_loaders()`), use that name — the intent is "enumerate registered loader families".

- [ ] **Step 7: Extend `sk_engine_versions`** in `sk_common.cpp`:

```cpp
                                 ";audiocpp=" + SK_AUDIOCPP_VERSION +
```

- [ ] **Step 8: Build and run**

Run: `cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j"$(nproc)" && ctest --test-dir native/build/cpu --output-on-failure`
Expected: audio.cpp's configure prints `audio.cpp model composite: custom selected [moss_tts_nano;…] linked […]`; the link of `libsokuji_native.so` succeeds with no undefined `ggml_*` symbols; `test_common` passes with six families. First build is ~15 minutes on 20 cores.

- [ ] **Step 9: Commit**

```bash
git add native/cmake/upstreams.cmake native/CMakeLists.txt native/src/audiocpp_compat.h native/src/sk_selftest.cpp native/src/sk_common.cpp native/include/sokuji_native.h native/tests/test_common.cpp
git commit -m "build(native): link audio.cpp v0.7.0 (six families) on upstream ggml via a compat header"
```

---

### Task 6: Install layout and `contract.json`

**Files:**
- Create: `native/cmake/contract.json.in`
- Modify: `native/CMakeLists.txt` (install rules)

**Interfaces:**
- Produces: `cmake --install <build> --prefix <dir>` yields a flat directory: `libsokuji_native.*`, `libggml*.*`, every backend module, `contract.json`. This directory is what the wheel embeds as `sokuji_native/_native/`.

- [ ] **Step 1: Write the template** `native/cmake/contract.json.in`

```json
{
  "abi": @SK_ABI_VERSION_NUM@,
  "version": "@PROJECT_VERSION@",
  "ggml": "@SOKUJI_GGML_VERSION@",
  "transcribe": "@SOKUJI_TRANSCRIBE_VERSION@",
  "llama": "@SOKUJI_LLAMA_VERSION@",
  "audiocpp": "@SOKUJI_AUDIOCPP_VERSION@",
  "backends": @SOKUJI_BACKENDS_JSON@,
  "lane": "@SOKUJI_LANE@",
  "families": ["moss_tts_nano", "omnivoice", "pocket_tts", "qwen3_tts", "silero_vad", "supertonic"]
}
```

- [ ] **Step 2: Add install rules** (append to `native/CMakeLists.txt`)

```cmake
# ---- install: one flat directory, exactly what the wheel ships -------------------------
set(SK_ABI_VERSION_NUM 1)
if(GGML_VULKAN)
    set(SOKUJI_BACKENDS_JSON "[\"vulkan\", \"cpu\"]")
elseif(GGML_METAL)
    set(SOKUJI_BACKENDS_JSON "[\"metal\", \"cpu\"]")
else()
    set(SOKUJI_BACKENDS_JSON "[\"cpu\"]")
endif()
configure_file(cmake/contract.json.in ${CMAKE_BINARY_DIR}/contract.json @ONLY)

install(TARGETS sokuji_native ggml ggml-base
        LIBRARY DESTINATION . RUNTIME DESTINATION . ARCHIVE DESTINATION . EXCLUDE_FROM_ALL)
# Backend modules are MODULE libraries created inside ggml's own CMake; install them by glob
# from the build output so we do not depend on their target names.
install(DIRECTORY ${CMAKE_BINARY_DIR}/lib/
        DESTINATION .
        FILES_MATCHING PATTERN "*ggml-cpu*" PATTERN "*ggml-vulkan*" PATTERN "*ggml-metal*" PATTERN "*ggml-blas*"
        PATTERN "*.a" EXCLUDE PATTERN "*.lib" EXCLUDE)
install(FILES ${CMAKE_BINARY_DIR}/contract.json DESTINATION .)
```

`SK_ABI_VERSION_NUM` must equal `SK_ABI_VERSION` in the header; Task 7's Python test checks they agree at run time.

- [ ] **Step 3: Verify the install tree**

Run:
```bash
cmake --build native/build/cpu -j"$(nproc)"
cmake --install native/build/cpu --prefix native/build/cpu/stage
ls -la native/build/cpu/stage && cat native/build/cpu/stage/contract.json
```
Expected: `libsokuji_native.so`, `libggml.so*`, `libggml-base.so*`, `libggml-cpu-*.so`, `contract.json` (with `"lane": "cpu"`, `"backends": ["cpu"]`); no `.a` files, no executables, no headers.

- [ ] **Step 4: Commit**

```bash
git add native/cmake/contract.json.in native/CMakeLists.txt
git commit -m "build(native): flat install layout with contract.json"
```

---

### Task 7: The `sokuji_native` Python package

**Files:**
- Create: `native/python/pyproject.toml`
- Create: `native/python/setup.py`
- Create: `native/python/sokuji_native/__init__.py`
- Create: `native/python/sokuji_native/_ffi.py`
- Create: `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Produces (Python): `sokuji_native.version() -> str`, `sokuji_native.engine_versions() -> dict[str, str]`, `sokuji_native.contract() -> dict`, `sokuji_native.init(n_threads: int = 0, log=None) -> None` (idempotent), `sokuji_native.devices() -> list[Device]` with `Device(index, kind, name, description, mem_total, mem_free)` and `kind in {"cpu","vulkan","metal","other"}`, `sokuji_native.device_free_mem(index) -> int`, `sokuji_native.audio_families() -> list[str]`, exception `sokuji_native.NativeError(status, message)`, env override `SOKUJI_NATIVE_DIR` (dev tree instead of the packaged `_native/`).
- Consumed by: slice 2's `sokuji_sidecar/native.py`.

- [ ] **Step 1: Write the failing tests** `native/python/tests/test_sokuji_native.py`

```python
"""Runs against a built tree: set SOKUJI_NATIVE_DIR to the install/stage dir from Task 6
(or install the wheel). Without either, the load tests skip and only the pure-Python
contract logic is exercised."""
import json
import os
import pathlib

import pytest

import sokuji_native
from sokuji_native import _ffi

HAVE_TREE = bool(os.environ.get("SOKUJI_NATIVE_DIR")) or (pathlib.Path(sokuji_native.__file__).parent / "_native" / "contract.json").exists()
needs_tree = pytest.mark.skipif(not HAVE_TREE, reason="no built native tree")


def test_contract_abi_must_match(tmp_path, monkeypatch):
    bad = tmp_path / "contract.json"
    bad.write_text(json.dumps({"abi": _ffi.SK_ABI_VERSION + 1, "version": "9.9.9"}))
    with pytest.raises(sokuji_native.NativeError) as e:
        sokuji_native._check_contract(bad)
    assert "ABI" in str(e.value)


def test_contract_ok(tmp_path):
    good = tmp_path / "contract.json"
    good.write_text(json.dumps({"abi": _ffi.SK_ABI_VERSION, "version": "0.1.0", "lane": "cpu"}))
    assert sokuji_native._check_contract(good)["lane"] == "cpu"


@needs_tree
def test_version_and_engines():
    assert sokuji_native.version().startswith("0.")
    ev = sokuji_native.engine_versions()
    assert ev["ggml"] == "0.22.0"
    assert ev["transcribe"] == "0.2.2"
    assert ev["audiocpp"] == "0.7.0"
    assert "llama" in ev


@needs_tree
def test_init_and_devices():
    lines = []
    sokuji_native.init(n_threads=2, log=lambda level, msg: lines.append((level, msg)))
    sokuji_native.init()                       # idempotent
    devs = sokuji_native.devices()
    assert devs and any(d.kind == "cpu" for d in devs)
    for d in devs:
        assert d.name and d.mem_total > 0
        assert sokuji_native.device_free_mem(d.index) > 0
    assert lines, "sk_init logs at least one line"


@needs_tree
def test_audio_families():
    assert sokuji_native.audio_families() == ["moss_tts_nano", "omnivoice", "pocket_tts", "qwen3_tts", "silero_vad", "supertonic"]


@needs_tree
def test_bad_device_index_raises():
    sokuji_native.init()
    with pytest.raises(sokuji_native.NativeError):
        sokuji_native.device_free_mem(999)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd native/python && python -m pytest tests -q`
Expected: `ModuleNotFoundError: No module named 'sokuji_native'`.

- [ ] **Step 3: Write `pyproject.toml` and `setup.py`**

`native/python/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=69", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "sokuji-native"
version = "0.1.0"
description = "One native library for the Sokuji sidecar: transcribe.cpp, llama.cpp and audio.cpp on one ggml, behind one C ABI"
readme = "README.md"
requires-python = ">=3.10"
license = { text = "Apache-2.0" }

[tool.setuptools]
packages = ["sokuji_native"]
include-package-data = true

[tool.setuptools.package-data]
sokuji_native = ["_native/*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`native/python/setup.py`:

```python
"""Platform-tagged pure-Python wheel: py3-none-<platform>. The platform tag comes from
SOKUJI_NATIVE_PLAT (set by CI, e.g. manylinux_2_28_x86_64, win_amd64,
macosx_11_0_arm64); locally it falls back to the running interpreter's platform."""
import os
import sysconfig

from setuptools import setup
from setuptools.command.bdist_wheel import bdist_wheel as _bdist_wheel


class bdist_wheel(_bdist_wheel):
    def finalize_options(self):
        super().finalize_options()
        self.root_is_pure = False

    def get_tag(self):
        plat = os.environ.get("SOKUJI_NATIVE_PLAT") or sysconfig.get_platform().replace("-", "_").replace(".", "_")
        return "py3", "none", plat


setup(cmdclass={"bdist_wheel": bdist_wheel})
```

Also copy `native/README.md` (written in Task 10) into `native/python/README.md` at wheel-build time; until Task 10 exists, create `native/python/README.md` with the single line `# sokuji-native` so the build does not fail.

- [ ] **Step 4: Write `_ffi.py`**

```python
"""ctypes declarations for the slice-1 surface of sokuji_native.h. Keep in lock-step with
the header; SK_ABI_VERSION here is compared against contract.json and sk_abi_version()."""
import ctypes
from ctypes import POINTER, c_bool, c_char, c_char_p, c_int32, c_uint64, c_void_p

SK_ABI_VERSION = 1

SK_OK = 0
SK_ERR_INVALID_ARGUMENT = -1
SK_ERR_NOT_INITIALISED = -2
SK_ERR_BACKEND = -3
SK_ERR_NOT_FOUND = -4
SK_ERR_CANCELLED = -5
SK_ERR_INTERNAL = -6

DEVICE_KIND = {0: "cpu", 1: "vulkan", 2: "metal", 99: "other"}

LOG_CB = ctypes.CFUNCTYPE(c_bool, c_int32, c_char_p, c_void_p)


class sk_init_options(ctypes.Structure):
    _fields_ = [("abi_version", c_int32), ("n_threads", c_int32), ("module_dir", c_char_p),
                ("log", LOG_CB), ("log_user", c_void_p)]


class sk_device(ctypes.Structure):
    _fields_ = [("index", c_int32), ("kind", c_int32), ("name", c_char * 64), ("description", c_char * 128),
                ("mem_total", c_uint64), ("mem_free", c_uint64)]


def bind(lib: ctypes.CDLL) -> ctypes.CDLL:
    lib.sk_init.argtypes = [POINTER(sk_init_options)];           lib.sk_init.restype = c_int32
    lib.sk_devices.argtypes = [POINTER(sk_device), c_int32];      lib.sk_devices.restype = c_int32
    lib.sk_device_free_mem.argtypes = [c_int32, POINTER(c_uint64)]; lib.sk_device_free_mem.restype = c_int32
    lib.sk_abi_version.argtypes = [];                             lib.sk_abi_version.restype = c_int32
    lib.sk_version.argtypes = [];                                 lib.sk_version.restype = c_char_p
    lib.sk_engine_versions.argtypes = [];                         lib.sk_engine_versions.restype = c_char_p
    lib.sk_last_error.argtypes = [];                              lib.sk_last_error.restype = c_char_p
    lib.sk_free.argtypes = [c_void_p];                            lib.sk_free.restype = None
    lib.sk_audio_families.argtypes = [POINTER(c_char_p), c_int32]; lib.sk_audio_families.restype = c_int32
    return lib
```

- [ ] **Step 5: Write `__init__.py`**

```python
"""sokuji_native — the sidecar's one native dependency.

Loads libsokuji_native from the packaged _native/ directory (or SOKUJI_NATIVE_DIR for a
development tree), refuses a contract.json whose ABI differs from _ffi.SK_ABI_VERSION,
and exposes the C surface as plain Python. Slices 2–4 add asr / vad / translate / tts."""
from __future__ import annotations

import ctypes
import json
import os
import pathlib
import platform
import threading
from dataclasses import dataclass

from . import _ffi

__all__ = ["NativeError", "Device", "init", "devices", "device_free_mem", "version",
           "engine_versions", "contract", "audio_families", "native_dir"]


class NativeError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"{message} (status {status})")
        self.status = status


@dataclass(frozen=True)
class Device:
    index: int
    kind: str
    name: str
    description: str
    mem_total: int
    mem_free: int


_lock = threading.Lock()
_lib: ctypes.CDLL | None = None
_contract: dict | None = None
_log_ref = None          # keeps the ctypes callback alive for the life of the process


def native_dir() -> pathlib.Path:
    override = os.environ.get("SOKUJI_NATIVE_DIR")
    return pathlib.Path(override) if override else pathlib.Path(__file__).parent / "_native"


def _check_contract(path: pathlib.Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("abi") != _ffi.SK_ABI_VERSION:
        raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT,
                          f"contract.json ABI {data.get('abi')} != binding ABI {_ffi.SK_ABI_VERSION}")
    return data


def _library_name() -> str:
    system = platform.system()
    if system == "Windows":
        return "sokuji_native.dll"
    if system == "Darwin":
        return "libsokuji_native.dylib"
    return "libsokuji_native.so"


def _load() -> ctypes.CDLL:
    global _lib, _contract
    with _lock:
        if _lib is not None:
            return _lib
        d = native_dir()
        _contract = _check_contract(d / "contract.json")
        if platform.system() == "Windows":
            os.add_dll_directory(str(d))
        lib = _ffi.bind(ctypes.CDLL(str(d / _library_name())))
        if lib.sk_abi_version() != _ffi.SK_ABI_VERSION:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT,
                              f"library ABI {lib.sk_abi_version()} != binding ABI {_ffi.SK_ABI_VERSION}")
        _lib = lib
        return lib


def _raise(lib: ctypes.CDLL, status: int, what: str) -> None:
    msg = (lib.sk_last_error() or b"").decode("utf-8", "replace")
    raise NativeError(status, f"{what}: {msg or 'unknown error'}")


def contract() -> dict:
    _load()
    return dict(_contract or {})


def version() -> str:
    return _load().sk_version().decode()


def engine_versions() -> dict[str, str]:
    raw = _load().sk_engine_versions().decode()
    out: dict[str, str] = {}
    for seg in raw.split(";"):
        key, _, val = seg.partition("=")
        if key:
            out[key] = val.split("(")[0]      # "v0.3.0(2 max devices)" -> "v0.3.0"
    return out


def init(n_threads: int = 0, log=None) -> None:
    """Idempotent. `log(level, message)` receives ggml and sokuji-native log lines."""
    global _log_ref
    lib = _load()
    opts = _ffi.sk_init_options()
    opts.abi_version = _ffi.SK_ABI_VERSION
    opts.n_threads = int(n_threads)
    opts.module_dir = str(native_dir()).encode()
    if log is not None:
        def _cb(level, msg, _user):
            try:
                log(int(level), (msg or b"").decode("utf-8", "replace"))
            except Exception:
                pass
            return True
        _log_ref = _ffi.LOG_CB(_cb)
        opts.log = _log_ref
    status = lib.sk_init(ctypes.byref(opts))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_init")


def devices() -> list[Device]:
    lib = _load()
    buf = (_ffi.sk_device * 32)()
    n = lib.sk_devices(buf, 32)
    return [Device(d.index, _ffi.DEVICE_KIND.get(d.kind, "other"), d.name.decode(), d.description.decode(),
                   int(d.mem_total), int(d.mem_free)) for d in buf[:n]]


def device_free_mem(index: int) -> int:
    lib = _load()
    out = ctypes.c_uint64()
    status = lib.sk_device_free_mem(int(index), ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_device_free_mem")
    return int(out.value)


def audio_families() -> list[str]:
    lib = _load()
    buf = (ctypes.c_char_p * 64)()
    n = lib.sk_audio_families(buf, 64)
    return [buf[i].decode() for i in range(n)]
```

- [ ] **Step 6: Run the tests against the staged tree**

Run:
```bash
cd native/python && python -m pip install -e . --no-deps -q
SOKUJI_NATIVE_DIR=$PWD/../build/cpu/stage python -m pytest tests -q
```
Expected: 6 passed. Then `python -m pytest tests -q` with the variable unset: 2 passed, 4 skipped.

- [ ] **Step 7: Build a wheel locally and import it**

```bash
cd native/python && rm -rf sokuji_native/_native && cp -r ../build/cpu/stage sokuji_native/_native
python -m pip install build -q && python -m build --wheel --outdir dist
ls dist/                                   # sokuji_native-0.1.0-py3-none-linux_aarch64.whl (name varies per host)
python -m pip install --force-reinstall dist/*.whl
python -c "import sokuji_native as s; s.init(); print(s.version(), s.engine_versions(), [d.kind for d in s.devices()])"
```
Expected: `0.1.0 {'ggml': '0.22.0', 'transcribe': '0.2.2', 'llama': 'v0.3.0', 'audiocpp': '0.7.0', 'lane': 'cpu'} ['cpu']`.

- [ ] **Step 8: Commit**

```bash
git add native/python
git commit -m "feat(native): sokuji_native Python package — contract check, load, init, devices"
```

---

### Task 8: Parity scaffold — the PCM comparator

**Files:**
- Create: `native/tests/parity/compare_pcm.py`
- Create: `native/tests/parity/test_compare_pcm.py`

**Interfaces:**
- Produces: `compare_pcm.compare(a: np.ndarray, b: np.ndarray) -> Result(max_abs, snr_db, n)`, CLI `python compare_pcm.py ref.wav got.wav [--exact | --min-snr 60]` exiting 1 on failure. Slice 4 feeds it audio.cpp-official vs sokuji-native outputs.

- [ ] **Step 1: Write the failing test** `native/tests/parity/test_compare_pcm.py`

```python
import numpy as np
import pytest

from compare_pcm import compare, verdict


def test_identical_is_exact():
    x = np.sin(np.linspace(0, 100, 16000)).astype(np.float32)
    r = compare(x, x.copy())
    assert r.max_abs == 0.0 and r.snr_db == float("inf")
    assert verdict(r, exact=True) is True


def test_small_noise_has_finite_snr():
    rng = np.random.default_rng(0)
    x = np.sin(np.linspace(0, 100, 16000)).astype(np.float32)
    y = x + rng.normal(0, 1e-4, x.shape).astype(np.float32)
    r = compare(x, y)
    assert 0 < r.max_abs < 1e-3
    assert 60 < r.snr_db < 90
    assert verdict(r, exact=True) is False
    assert verdict(r, min_snr=60) is True
    assert verdict(r, min_snr=95) is False


def test_length_mismatch_fails():
    x = np.zeros(100, np.float32)
    with pytest.raises(ValueError):
        compare(x, np.zeros(101, np.float32))
```

- [ ] **Step 2: Run to verify it fails** — `cd native/tests/parity && python -m pytest -q` → `ModuleNotFoundError: compare_pcm`.

- [ ] **Step 3: Write `compare_pcm.py`**

```python
"""Compare two PCM signals: max absolute difference and SNR (dB) of b against a.

Used by the audio.cpp parity gate (spec §9.2): CPU runs must be sample-exact, Vulkan runs
must reach SNR >= 60 dB. Standalone CLI:
    python compare_pcm.py ref.wav got.wav --exact
    python compare_pcm.py ref.wav got.wav --min-snr 60
"""
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Result:
    max_abs: float
    snr_db: float
    n: int


def compare(a: np.ndarray, b: np.ndarray) -> Result:
    a = np.asarray(a, dtype=np.float64).reshape(-1)
    b = np.asarray(b, dtype=np.float64).reshape(-1)
    if a.shape != b.shape:
        raise ValueError(f"length mismatch: {a.shape[0]} vs {b.shape[0]}")
    diff = a - b
    max_abs = float(np.max(np.abs(diff))) if a.size else 0.0
    noise = float(np.sum(diff * diff))
    signal = float(np.sum(a * a))
    snr = math.inf if noise == 0.0 else (10.0 * math.log10(signal / noise) if signal > 0 else -math.inf)
    return Result(max_abs=max_abs, snr_db=snr, n=int(a.size))


def verdict(r: Result, exact: bool = False, min_snr: float | None = None) -> bool:
    if exact:
        return r.max_abs == 0.0
    if min_snr is not None:
        return r.snr_db >= min_snr
    raise ValueError("choose exact=True or min_snr=<dB>")


def _read_wav(path: str) -> np.ndarray:
    import soundfile as sf
    data, _sr = sf.read(path, dtype="float32", always_2d=False)
    return data if data.ndim == 1 else data.mean(axis=1)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("ref"); p.add_argument("got")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--exact", action="store_true")
    g.add_argument("--min-snr", type=float)
    args = p.parse_args(argv)
    r = compare(_read_wav(args.ref), _read_wav(args.got))
    ok = verdict(r, exact=args.exact, min_snr=args.min_snr)
    print(f"n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB -> {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests** — `cd native/tests/parity && python -m pytest -q` → 3 passed (the sidecar venv has numpy and soundfile).

- [ ] **Step 5: Commit**

```bash
git add native/tests/parity
git commit -m "test(native): PCM parity comparator scaffold (exact / SNR)"
```

---

### Task 9: Build scripts and the `native-build.yml` workflow

**Files:**
- Create: `native/ci/build.sh`
- Create: `native/ci/build.ps1`
- Create: `.github/workflows/native-build.yml`

**Interfaces:**
- Consumes: everything above.
- Produces: `native/ci/build.sh <lane> <plat-tag>` and `build.ps1 -Lane vulkan -Plat win_amd64` — configure, build, ctest, install to stage, build wheel into `native/python/dist/`; workflow artifacts `sokuji_native-<ver>-py3-none-<plat>.whl` per job; on `native-v*` tags a prerelease with the five wheels.

- [ ] **Step 1: Write `native/ci/build.sh`**

```bash
#!/usr/bin/env bash
# One build, used by CI and by developers. Usage: native/ci/build.sh <none|vulkan|metal> <wheel-platform-tag>
set -euo pipefail
LANE="${1:?lane: none|vulkan|metal}"
PLAT="${2:?wheel platform tag, e.g. manylinux_2_28_x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/$LANE"
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

cmake -S "$ROOT" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release -DSOKUJI_GPU="$LANE"
cmake --build "$BUILD" -j"$JOBS"
ctest --test-dir "$BUILD" --output-on-failure
rm -rf "$BUILD/stage" "$ROOT/python/sokuji_native/_native"
cmake --install "$BUILD" --prefix "$BUILD/stage"
if command -v strip >/dev/null && [ "$(uname -s)" != "Darwin" ]; then
    find "$BUILD/stage" -name '*.so*' -exec strip --strip-unneeded {} +
fi
cp -r "$BUILD/stage" "$ROOT/python/sokuji_native/_native"
cp "$ROOT/README.md" "$ROOT/python/README.md"
python -m pip install -q build
( cd "$ROOT/python" && rm -rf dist && SOKUJI_NATIVE_PLAT="$PLAT" python -m build --wheel --outdir dist )
ls -la "$ROOT/python/dist"
# Import the wheel we just built, from a clean interpreter, and print the device table.
python -m pip install -q --force-reinstall "$ROOT"/python/dist/*.whl
python -c "import sokuji_native as s; s.init(); print(s.version(), s.engine_versions(), [(d.kind, d.description) for d in s.devices()])"
```

- [ ] **Step 2: Write `native/ci/build.ps1`**

```powershell
# Windows twin of build.sh. Usage: native\ci\build.ps1 -Lane vulkan -Plat win_amd64
param([Parameter(Mandatory)][string]$Lane, [Parameter(Mandatory)][string]$Plat)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Build = Join-Path $Root "build\$Lane"

cmake -S $Root -B $Build -G "Visual Studio 17 2022" -A x64 -DSOKUJI_GPU=$Lane
if ($LASTEXITCODE) { exit $LASTEXITCODE }
cmake --build $Build --config Release --parallel
if ($LASTEXITCODE) { exit $LASTEXITCODE }
ctest --test-dir $Build -C Release --output-on-failure
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Remove-Item -Recurse -Force "$Build\stage", "$Root\python\sokuji_native\_native" -ErrorAction SilentlyContinue
cmake --install $Build --config Release --prefix "$Build\stage"
Copy-Item -Recurse "$Build\stage" "$Root\python\sokuji_native\_native"
Copy-Item "$Root\README.md" "$Root\python\README.md"
python -m pip install -q build
Push-Location "$Root\python"
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
$env:SOKUJI_NATIVE_PLAT = $Plat
python -m build --wheel --outdir dist
Pop-Location
Get-ChildItem "$Root\python\dist"
python -m pip install -q --force-reinstall (Get-ChildItem "$Root\python\dist\*.whl").FullName
python -c "import sokuji_native as s; s.init(); print(s.version(), s.engine_versions(), [(d.kind, d.description) for d in s.devices()])"
```

With the Visual Studio generator the build output lands in `lib/Release/`; add to `native/CMakeLists.txt` right after the output-directory lines so the single-config layout is kept on MSVC too:

```cmake
foreach(_cfg Debug Release RelWithDebInfo MinSizeRel)
    string(TOUPPER ${_cfg} _CFG)
    set(CMAKE_LIBRARY_OUTPUT_DIRECTORY_${_CFG} ${CMAKE_BINARY_DIR}/lib)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${_CFG} ${CMAKE_BINARY_DIR}/lib)
endforeach()
```

- [ ] **Step 3: Write `.github/workflows/native-build.yml`**

```yaml
# .github/workflows/native-build.yml
# Build the sokuji-native wheels (spec §4.6): one ggml + transcribe.cpp + llama.cpp +
# audio.cpp behind the sk_* C ABI, per platform. Two lanes, mirroring sidecar-bundles.yml:
#   - workflow_dispatch: dry run — artifacts only.
#   - native-vX.Y.Z tag push: build all five and publish a PRERELEASE GitHub Release
#     (prerelease so electron-updater's "latest release" lookup never lands on it).
name: native-build

permissions:
  contents: read

on:
  workflow_dispatch:
  push:
    tags: ['native-v*']

env:
  VULKAN_SDK_VERSION: 1.4.321.1

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { sku: linux-x64,   runner: ubuntu-22.04,     lane: vulkan, plat: manylinux_2_28_x86_64 }
          - { sku: linux-arm64, runner: ubuntu-22.04-arm, lane: vulkan, plat: manylinux_2_28_aarch64 }
          - { sku: win-x64,     runner: windows-2022,     lane: vulkan, plat: win_amd64 }
          - { sku: mac-arm64,   runner: macos-14,         lane: metal,  plat: macosx_11_0_arm64 }
          - { sku: mac-x64,     runner: macos-15-intel,   lane: none,   plat: macosx_11_0_x86_64 }
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - name: Verify tag matches native/CMakeLists.txt project version
        if: startsWith(github.ref, 'refs/tags/native-v')
        shell: bash
        run: |
          WANT="${GITHUB_REF_NAME#native-v}"
          HAVE="$(sed -nE 's/^project\(sokuji_native VERSION ([0-9.]+).*/\1/p' native/CMakeLists.txt)"
          [ "$WANT" = "$HAVE" ] || { echo "tag $WANT != CMake project version $HAVE"; exit 1; }
      - uses: actions/setup-python@v6
        with: { python-version: '3.12' }
      - name: Vulkan SDK (Linux)
        if: runner.os == 'Linux' && matrix.lane == 'vulkan'
        run: |
          sudo apt-get update
          sudo apt-get install -y libvulkan-dev glslc ninja-build
      - name: Vulkan SDK (Windows)
        if: runner.os == 'Windows' && matrix.lane == 'vulkan'
        shell: pwsh
        run: |
          $url = "https://sdk.lunarg.com/sdk/download/$env:VULKAN_SDK_VERSION/windows/VulkanSDK-$env:VULKAN_SDK_VERSION-Installer.exe"
          Invoke-WebRequest -Uri $url -OutFile VulkanSDK.exe
          Start-Process -Wait -FilePath .\VulkanSDK.exe -ArgumentList '--accept-licenses','--default-answer','--confirm-command','install'
          "VULKAN_SDK=C:\VulkanSDK\$env:VULKAN_SDK_VERSION" | Out-File -FilePath $env:GITHUB_ENV -Append
          "C:\VulkanSDK\$env:VULKAN_SDK_VERSION\Bin" | Out-File -FilePath $env:GITHUB_PATH -Append
      - name: Build, test, wheel (POSIX)
        if: runner.os != 'Windows'
        run: native/ci/build.sh ${{ matrix.lane }} ${{ matrix.plat }}
      - name: Build, test, wheel (Windows)
        if: runner.os == 'Windows'
        shell: pwsh
        run: native\ci\build.ps1 -Lane ${{ matrix.lane }} -Plat ${{ matrix.plat }}
      - name: Wheel size
        shell: bash
        run: ls -la native/python/dist/ | tee -a "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v6
        with:
          name: sokuji-native-${{ matrix.sku }}
          path: native/python/dist/*.whl
          if-no-files-found: error

  release:
    if: startsWith(github.ref, 'refs/tags/native-v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v7
        with:
          path: wheels
          merge-multiple: true
      - run: ls -la wheels
      - uses: softprops/action-gh-release@v3
        with:
          prerelease: true
          name: ${{ github.ref_name }}
          files: wheels/*.whl
          body: |
            sokuji-native ${{ github.ref_name }} — one ggml + transcribe.cpp + llama.cpp + audio.cpp behind the sk_* C ABI.
            Pins: see native/cmake/upstreams.cmake at this tag. Wheels are py3-none-<platform>; install with pip.
```

- [ ] **Step 4: Validate locally**

```bash
python -c "import yaml, sys; yaml.safe_load(open('.github/workflows/native-build.yml')); print('yaml ok')"
chmod +x native/ci/build.sh
native/ci/build.sh none linux_aarch64        # CPU lane on the GB10 (no Vulkan SDK locally)
```
Expected: the script ends by printing `0.1.0 {...} [('cpu', 'CPU')]` from the freshly installed wheel. (If `libvulkan-dev glslc` are installed locally, `native/ci/build.sh vulkan linux_aarch64` should print a `('vulkan', 'NVIDIA GB10')` entry as well.)

- [ ] **Step 5: Commit**

```bash
git add native/ci .github/workflows/native-build.yml native/CMakeLists.txt
git commit -m "ci(native): build scripts and native-build workflow for five platforms"
```

---

### Task 10: README, dry-run in CI, first release

**Files:**
- Create: `native/README.md`
- Modify: `CLAUDE.md` (one paragraph under "Architecture Overview" pointing at `native/`)

**Interfaces:**
- Produces: `native-v0.1.0` release with five wheels (after jiangzhuo's go-ahead), and the smoke result on the GB10 recorded in the PR description.

- [ ] **Step 1: Write `native/README.md`**

```markdown
# sokuji-native

One native library for the Sokuji sidecar: **transcribe.cpp** (ASR), **llama.cpp**
(translation) and **audio.cpp** (TTS + VAD, six families) linked into `libsokuji_native`
behind the `sk_*` C ABI in `include/sokuji_native.h`, on top of one pristine upstream ggml
with dynamically loaded backends (CPU per-ISA modules, Vulkan on Linux/Windows, Metal on
Apple Silicon). Design: `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md`.

## Build

    native/ci/build.sh vulkan manylinux_2_28_x86_64     # Linux/macOS: <none|vulkan|metal> <wheel plat tag>
    native\ci\build.ps1 -Lane vulkan -Plat win_amd64    # Windows

Requires CMake ≥ 3.24, a C++17 compiler, Python 3.10+, and for the Vulkan lane
`libvulkan-dev` + `glslc` (Ubuntu) or the LunarG SDK (Windows). Output: a wheel in
`native/python/dist/`; the staged binaries in `native/build/<lane>/stage/`.

Developer loop without a wheel:

    cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j
    cmake --install native/build/cpu --prefix native/build/cpu/stage
    SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage python -c "import sokuji_native as s; s.init(); print(s.devices())"

## Layout

- `cmake/upstreams.cmake` — the four commit pins and the two three-line CMake patches
  (transcribe.cpp and audio.cpp both add their own ggml unconditionally; the patch makes
  them reuse ours).
- `src/audiocpp_compat.h` — the eight symbols audio.cpp's fork adds to ggml, provided on
  upstream ggml. See the header comment before touching it.
- `python/` — the `sokuji_native` package; `_ffi.py` mirrors the header.
- `tests/` — CTest smoke and the parity comparator.

## Bumping a pin

1. Change the commit SHA (and the version string beside it) in `cmake/upstreams.cmake`.
2. Rebuild; if `patch_upstream.py` fails, the patched line moved — fix the patch.
3. Run the parity suite (slice 4 onward) — a bump that fails parity is not shipped.
4. Bump `project(sokuji_native VERSION …)` and `python/pyproject.toml`, tag `native-vX.Y.Z`.
```

- [ ] **Step 2: Add the CLAUDE.md pointer** — under "### Key Architectural Components", after item 5, insert:

```markdown
6. **Native runtime (`native/`)**
   - One CMake super-project builds transcribe.cpp, llama.cpp and audio.cpp on a single upstream ggml into `libsokuji_native` (C ABI `sk_*`, Python package `sokuji_native`)
   - Design: `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md`; build: `native/README.md`
```

- [ ] **Step 3: Commit**

```bash
git add native/README.md CLAUDE.md
git commit -m "docs(native): README and CLAUDE.md pointer for the native super-project"
```

- [ ] **Step 4: CI dry run** — push the branch (after jiangzhuo confirms) and trigger `native-build` via `workflow_dispatch` on `refactor/sidecar-ggml-only`. All five jobs must be green and each job summary must show one wheel. Fix platform fallout in follow-up commits on the same branch; typical suspects: MSVC needing `/bigobj` on audio.cpp objects (add `target_compile_options(${_t} PRIVATE /bigobj)` in the Task 5 loop), Apple clang OpenMP (already OFF), `glslc` missing on the arm runner (fallback: self-hosted GB10 runner label).

- [ ] **Step 5: Release gate** — with the dry run green, ask jiangzhuo to (a) merge or keep the branch, and (b) push the tag: `git tag -a native-v0.1.0 -m "sokuji-native 0.1.0: skeleton" && git push origin native-v0.1.0`. Record in the PR: the five wheel names and sizes, and the GB10 output of `python -c "import sokuji_native as s; s.init(); print(s.devices())"` from the published linux-arm64 wheel.

---

## Self-review

**Spec coverage (§4 + §10 slice 1):** repository layout (Task 1, 2, 5, 7, 8, 9) ✓; upstream pins by commit, not vendored (Task 1, 3, 4, 5) ✓; build knobs incl. BACKEND_DL, all-variants, per-platform GPU (Task 1, 6) ✓; C ABI conventions and the common surface (Task 2; `sk_free`, thread-local error, callback shape) ✓; compat header with all eight symbols and the "port the op, not the fork" rule (Task 5) ✓; Python package with contract check (Task 7) ✓; five platforms + CI + wheel naming + release (Task 9, 10) ✓; parity scaffold (Task 8) ✓; `native-v0.1.0` gate and GB10 `sk_devices` check (Task 10) ✓. Not in this slice by design: the Vulkan AMD dot4 patch (§4.4 last paragraph) — it needs a ggml patch mechanism that slice 2 introduces alongside the first Vulkan-specific test; noted here so it is not lost.

**Placeholders:** none of "TBD/TODO/fill in"; every code step has its code. The two "if the upstream spells X differently" notes (Task 5 Steps 3 and 6) name the exact alternative action.

**Type consistency:** `sk_init_options` / `sk_device` field order matches between the header (Task 2) and `_ffi.py` (Task 7); `sk_audio_families` signature matches between header, `sk_selftest.cpp` and `_ffi.py`; `SOKUJI_LANE` values (`cpu`, `cpu-vulkan`, `metal`) are produced in Task 1 and consumed by `version.h.in` (Task 2) and `contract.json.in` (Task 6); `SK_ABI_VERSION_NUM` (Task 6) equals `SK_ABI_VERSION` (Task 2) and `_ffi.SK_ABI_VERSION` (Task 7), and Task 7's test verifies the runtime agreement.
