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

# ggml 0.22.0 hard-codes two armv9.2 (+sme) CPU variants on Linux/aarch64. GCC 11/13
# reject `+sme`; when the compiler cannot build them we comment those two lines out of
# ggml's src/CMakeLists.txt at fetch time (see upstreams.cmake). SME kernels only matter
# with KleidiAI, which this project does not enable, and the GB10 dev box loads the
# armv8.6_2 module in practice.
set(SOKUJI_DROP_SME_VARIANTS OFF)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
    include(CheckCXXCompilerFlag)
    check_cxx_compiler_flag("-march=armv9.2-a+sme" SOKUJI_CXX_HAS_SME)
    if(NOT SOKUJI_CXX_HAS_SME)
        set(SOKUJI_DROP_SME_VARIANTS ON)
        message(STATUS "sokuji-native: compiler lacks +sme; dropping ggml armv9.2 CPU variants")
    endif()
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
