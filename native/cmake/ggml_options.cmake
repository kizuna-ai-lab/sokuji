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
