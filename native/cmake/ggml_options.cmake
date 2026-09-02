# GPU lane selection and the ggml knobs the whole super-project depends on.
# Every GGML_* value is FORCEd into the cache: audio.cpp's CMake force-sets
# several of them itself, and a stale cache from a previous configure must
# never win over this file.
set(SOKUJI_GPU "auto" CACHE STRING "GPU lane: auto | none | vulkan | metal")
set_property(CACHE SOKUJI_GPU PROPERTY STRINGS auto none vulkan metal)
if(NOT SOKUJI_GPU MATCHES "^(auto|none|vulkan|metal)$")
    # A typo (or an unexpanded shell variable) must not fall through to a CPU-only build.
    message(FATAL_ERROR "SOKUJI_GPU must be one of auto|none|vulkan|metal, got '${SOKUJI_GPU}'")
endif()

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

# ggml 0.22.0 hard-codes SME CPU variants on arm64: two armv9.2 ones on Linux and
# apple_m4 on macOS. GCC 11/13 reject `+sme` outright, and Apple clang (Xcode 15 and 16)
# accepts the flag but then rejects the SVE intrinsics ggml's SME paths use under
# `+nosve`. When a variant cannot be built we comment its line out of ggml's
# src/CMakeLists.txt at fetch time (see upstreams.cmake; specs in native/patches/).
# SME kernels only matter with KleidiAI, which this project does not enable: an M4 then
# loads the apple_m2_m3 module and the GB10 dev box loads armv8.6_2, losing nothing we use.
set(SOKUJI_GGML_PATCH_SPEC)          # a LIST of spec filenames under native/patches/
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
    if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
        include(CheckCXXCompilerFlag)
        check_cxx_compiler_flag("-march=armv9.2-a+sme" SOKUJI_CXX_HAS_SME)
        if(NOT SOKUJI_CXX_HAS_SME)
            set(SOKUJI_GGML_PATCH_SPEC "ggml-drop-sme.json")
            message(STATUS "sokuji-native: compiler lacks +sme; dropping ggml armv9.2 CPU variants")
        endif()
    elseif(APPLE)
        set(SOKUJI_GGML_PATCH_SPEC "ggml-drop-sme-apple.json")
        message(STATUS "sokuji-native: dropping ggml apple_m4 CPU variant (SME unsupported by Apple clang)")
    endif()
endif()

# Every lane, every model: ggml 0.22.0's GGUF reader fills an array KV one element at a
# time (`gguf_reader::read(std::vector<T>&, n)` loops `read(dst[i])`, and each of those is
# a read_raw through the reader callback — one locked fread() per element). audio.cpp
# stores a model's sidecar files as ONE `audiocpp.embedded_files.data` UINT8 array KV, and
# it reopens the model GGUF 14 times per load, so the cost is 14 * (array bytes) freads:
# 800M of them for supertonic-3, which is 13.7s of its 14.0s load on the GB10 dev box
# (measured: 106% CPU, 0 major faults, 12/14 poor-man's-profiler samples inside
# _IO_acquire_lock_fct under gguf_read_emplace_helper<unsigned char>). The patch reads the
# whole array in one call for fixed-size element types; strings and vector<bool> keep the
# loop. Byte-identical output — it is a read-shape change only.
list(APPEND SOKUJI_GGML_PATCH_SPEC "ggml-gguf-bulk-array-read.json")

# ggml 0.22.0's Metal backend implements no GGML_OP_DIAG_MASK_INF at all - no supports_op
# case, no kernel - while ggml-cpu, ggml-vulkan and ggml-cuda all do. Every audio.cpp
# attention block reached without an explicit mask builds that op (16 call sites across 13
# files under audio.cpp 0.7.0's src/, external/ excluded; on our five families the live
# ones are moss_tts_nano and qwen3_tts), and audio.cpp never uses
# ggml_backend_sched, so there is no per-node CPU fallback: the single missing kernel
# aborts the process. The patch re-adds the kernel ggml's own Metal backend carried until
# llama.cpp moved to masked soft_max_ext, so it restores an op every other backend has
# rather than inventing one. Metal lane only: it touches src/ggml-metal/, which no other
# lane compiles.
#
# The second Metal gap on the same families: ggml 0.22.0's Metal GGML_OP_PAD pads only at
# the END of an axis (its supports_op rejects any non-zero leading pad), while ggml-cpu and
# ggml-vulkan both implement the full lp/rp form ggml_pad_ext builds. qwen3_tts's speech
# tokenizer decoder pads causally - left_pad = kernel_extent - stride, in
# tokenizer_speech_decoder.cpp's causal_conv1d - so every one of its depthwise convs is a
# leading pad. The patch teaches kernel_pad_impl the leading pads with exactly ggml-cpu's
# non-circular semantics; circular padding stays unimplemented, as upstream leaves it.
if(SOKUJI_GPU_RESOLVED STREQUAL "metal")
    list(APPEND SOKUJI_GGML_PATCH_SPEC "ggml-metal-diag-mask-inf.json")
    list(APPEND SOKUJI_GGML_PATCH_SPEC "ggml-metal-pad-leading.json")
endif()

set(BUILD_SHARED_LIBS ON)                                   # ggml itself is shared …
set(GGML_BACKEND_DL ON  CACHE BOOL "" FORCE)                # … and its backends are modules
set(GGML_NATIVE OFF     CACHE BOOL "" FORCE)                # portable wheels, never -march=native
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)           # one module per ISA tier (x86 and arm64)
set(GGML_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GGML_BUILD_TESTS OFF    CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_HIP  OFF CACHE BOOL "" FORCE)
# The four knobs below exist here only because audio.cpp's CMake FORCEs them into the
# cache when it is added (its CMakeLists.txt lines 263-269 at v0.7.0) — long after ggml
# has been configured. Left to audio.cpp, configure #1 would build ggml with ggml's own
# defaults and configure #2 with audio.cpp's leftovers: two different sets of CPU
# kernels from the same source tree. Deciding them here, before ggml, makes a
# re-configure a no-op.
if(MSVC)
    set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)              # llama.cpp's own default on MSVC
else()
    set(GGML_LLAMAFILE ON CACHE BOOL "" FORCE)               # llama.cpp's own default elsewhere
endif()
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)                     # no libgomp runtime dependency in the wheel
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)
set(GGML_ALL_WARNINGS OFF CACHE BOOL "" FORCE)
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
