cmake_minimum_required(VERSION 3.28)   # FetchContent_Declare(EXCLUDE_FROM_ALL)
# The macOS wheels are tagged macosx_11_0_*; pin the deployment target to match, before
# project() reads it. CMAKE_HOST_APPLE is one of the few variables CMake defines that
# early (we never cross-compile to macOS, so host == target here).
if(CMAKE_HOST_APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version" FORCE)
endif()
project(sokuji_native VERSION 1.1.0 LANGUAGES C CXX)

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

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)   # Windows DLLs land beside the .so/.dylib equivalents
# Multi-config generators (Visual Studio) ignore the single-config vars above and would
# otherwise scatter output into lib/Release, lib/Debug, ...; pin every configuration to
# the same flat lib/ directory so the MSVC build matches the Ninja/Makefiles layout.
foreach(_cfg Debug Release RelWithDebInfo MinSizeRel)
    string(TOUPPER ${_cfg} _CFG)
    set(CMAKE_LIBRARY_OUTPUT_DIRECTORY_${_CFG} ${CMAKE_BINARY_DIR}/lib)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${_CFG} ${CMAKE_BINARY_DIR}/lib)
endforeach()
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()
find_package(Python3 COMPONENTS Interpreter REQUIRED)         # for patch_upstream.py

# Every shared object ships in one flat directory and finds its siblings there, so the
# rpath is $ORIGIN / @loader_path for every target this project builds — including the
# upstream ggml libraries and backend modules, and already at build time
# (CMAKE_BUILD_WITH_INSTALL_RPATH): the modules reach the stage by file copy, so an
# install-time rewrite would never touch them and a build-tree path would ship instead.
set(CMAKE_BUILD_WITH_INSTALL_RPATH ON)
if(APPLE)
    set(CMAKE_INSTALL_RPATH "@loader_path")
else()
    set(CMAKE_INSTALL_RPATH "$ORIGIN")
endif()

include(cmake/ggml_options.cmake)
include(cmake/upstreams.cmake)

configure_file(src/version.h.in ${CMAKE_BINARY_DIR}/generated/version.h @ONLY)

set(BUILD_SHARED_LIBS OFF)           # everything after ggml is static — engines fold into libsokuji_native
add_library(sokuji_native SHARED
    src/sk_common.cpp)
target_include_directories(sokuji_native
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_BINARY_DIR}/generated ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(sokuji_native PRIVATE SOKUJI_NATIVE_BUILD=1)
target_link_libraries(sokuji_native PRIVATE ggml)
target_link_libraries(sokuji_native PRIVATE transcribe)
target_include_directories(sokuji_native PRIVATE ${transcribe_SOURCE_DIR}/include)
target_link_libraries(sokuji_native PRIVATE llama)
target_include_directories(sokuji_native PRIVATE ${llama_SOURCE_DIR}/include)

# audio.cpp: link the runtime and inject the compatibility header into every engine object
# target. The header needs ggml-impl.h from the ggml *source* tree. audio.cpp declares one
# OBJECT target per *build target*, not per family (e.g. the `moss` target carries both
# moss_tts_nano and moss_tts_local), so enumerate the targets it created instead of guessing
# names from the family list. Extra engine_model_* targets are EXCLUDE_FROM_ALL and only
# compile when engine_runtime links them.
set(_audiocpp_engine_targets engine_core engine_runtime)
get_property(_audiocpp_dir_targets DIRECTORY ${audiocpp_SOURCE_DIR} PROPERTY BUILDSYSTEM_TARGETS)
foreach(_t IN LISTS _audiocpp_dir_targets)
    if(_t MATCHES "^engine_model_")
        list(APPEND _audiocpp_engine_targets ${_t})
    endif()
endforeach()
message(STATUS "sokuji-native: compat header injected into: ${_audiocpp_engine_targets}")
foreach(_t IN LISTS _audiocpp_engine_targets)
    target_include_directories(${_t} PRIVATE ${SOKUJI_GGML_SOURCE_DIR}/src)
    if(MSVC)
        target_compile_options(${_t} PRIVATE /FI${CMAKE_CURRENT_SOURCE_DIR}/src/audiocpp_compat.h)
    else()
        target_compile_options(${_t} PRIVATE -include ${CMAKE_CURRENT_SOURCE_DIR}/src/audiocpp_compat.h)
    endif()
endforeach()
target_sources(sokuji_native PRIVATE src/sk_selftest.cpp src/sk_asr.cpp src/sk_translate.cpp src/sk_tts.cpp
                                     src/sk_profile.cpp src/sk_vk_enum.cpp)
target_link_libraries(sokuji_native PRIVATE engine_runtime)
target_include_directories(sokuji_native PRIVATE ${audiocpp_SOURCE_DIR}/include)

set_target_properties(sokuji_native PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON)   # rpath: the project-wide CMAKE_INSTALL_RPATH above
if(NOT WIN32)
    target_link_libraries(sokuji_native PRIVATE ${CMAKE_DL_LIBS})
endif()

# Spec A §3.1: the device profile enumerates Vulkan devices through the LOADER, never by
# linking it, and needs headers new enough for the bfloat16 / NV coopmat2 feature structs
# (Ubuntu 22.04's distro headers are 1.3.204). Headers only; VK_NO_PROTOTYPES.
# Pinned by commit SHA, not tag name, for the reason cmake/upstreams.cmake states.
#
# SOURCE_SUBDIR deliberately names a directory the tree does not have, so
# FetchContent_MakeAvailable populates the sources and skips add_subdirectory(): the
# Vulkan-Headers project unconditionally declares `add_library(Vulkan::Headers ALIAS
# Vulkan-Headers)`, which collides with the IMPORTED target FindVulkan.cmake has already
# created whenever ggml_options.cmake's `find_package(Vulkan QUIET)` ran — i.e. on the
# default SOKUJI_GPU=auto path, on every non-Apple box with a usable Vulkan SDK. Adding the
# include directory by hand is all this needs, and it keeps the pinned headers ahead of any
# system copy (an `if(NOT TARGET Vulkan::Headers)` guard would silently compile against the
# system's older headers instead, defeating the point of the pin). src/sk_vk_enum.cpp
# static_asserts VK_HEADER_VERSION so a wrong include path fails the build, not a device.
if(SOKUJI_GPU_RESOLVED STREQUAL "vulkan")
    include(FetchContent)
    FetchContent_Declare(vulkan_headers
        GIT_REPOSITORY https://github.com/KhronosGroup/Vulkan-Headers.git
        GIT_TAG        71176a07dc482d0ddaf0b28555e734adc0533238   # v1.4.311
        GIT_SHALLOW    TRUE
        SOURCE_SUBDIR  headers-only-no-cmake-entry-point)
    FetchContent_MakeAvailable(vulkan_headers)
    target_include_directories(sokuji_native PRIVATE ${vulkan_headers_SOURCE_DIR}/include)
    target_compile_definitions(sokuji_native PRIVATE SK_HAVE_VULKAN_HEADERS=1 VK_NO_PROTOTYPES=1)
endif()

# Exported surface: sk_* and nothing else. The three engines are static archives compiled
# with default visibility, so without this their symbols (transcribe_*, llama_*, engine::*)
# would be exported from our .so and could shadow another copy loaded by the host process.
# Windows needs nothing: only __declspec(dllexport) is exported there.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    # Also the glibc/libstdc++ floor: the wheels must run on distributions older than the
    # build runner, and --no-undefined turns a missing symbol into a link error here
    # instead of a dlopen failure on a user's machine.
    target_link_options(sokuji_native PRIVATE
        -static-libstdc++ -static-libgcc
        -Wl,--no-undefined
        -Wl,--exclude-libs,ALL
        -Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/src/sokuji_native.map)
    set_property(TARGET sokuji_native APPEND PROPERTY
                 LINK_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/sokuji_native.map)
elseif(APPLE)
    target_link_options(sokuji_native PRIVATE
        -Wl,-exported_symbols_list,${CMAKE_CURRENT_SOURCE_DIR}/src/sokuji_native.exports)
    set_property(TARGET sokuji_native APPEND PROPERTY
                 LINK_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/sokuji_native.exports)
endif()

enable_testing()
add_subdirectory(tests)

# ---- install: one flat directory, exactly what the wheel ships -------------------------
# Everything here is COMPONENT sokuji. The fetched upstreams carry their own install()
# rules (headers, static libs, cmake configs) in the default component; installing with
# `cmake --install <build> --prefix <dir> --component sokuji` runs only ours.
# Deliberately keyed on SOKUJI_GPU_RESOLVED (a plain variable, set once in
# ggml_options.cmake and never touched again), NOT on the GGML_VULKAN/GGML_METAL cache
# variables. Both of the fetched upstreams re-FORCE those two shared cache entries from
# their own flags after ggml_options.cmake has already set them correctly:
# transcribe.cpp's CMakeLists.txt does `set(GGML_VULKAN ${TRANSCRIBE_VULKAN} CACHE BOOL ""
# FORCE)` (TRANSCRIBE_VULKAN is deliberately forced OFF in upstreams.cmake — "backends
# come from the shared ggml, not from transcribe's own flags" — but the force clobbers the
# shared variable instead of respecting it), and audio.cpp's CMakeLists.txt does the same
# from its own ENGINE_ENABLE_VULKAN/ENGINE_ENABLE_METAL. Both happen during
# FetchContent_MakeAvailable() calls in upstreams.cmake, i.e. AFTER ggml's own
# CMakeLists.txt already read the correct value and configured its real backend targets,
# so the actual build is unaffected — only a value read afterwards (like this one used to
# be) sees the clobbered cache. SOKUJI_LANE, right below, was already keyed off the same
# SOKUJI_GPU_RESOLVED variable for exactly this reason and has always been correct.
if(SOKUJI_GPU_RESOLVED STREQUAL "vulkan")
    set(SOKUJI_BACKENDS_JSON "[\"cpu\", \"vulkan\"]")
elseif(SOKUJI_GPU_RESOLVED STREQUAL "metal")
    set(SOKUJI_BACKENDS_JSON "[\"cpu\", \"metal\"]")
else()
    set(SOKUJI_BACKENDS_JSON "[\"cpu\"]")
endif()
configure_file(cmake/contract.json.in ${CMAKE_BINARY_DIR}/contract.json @ONLY)

install(TARGETS sokuji_native
        LIBRARY DESTINATION . COMPONENT sokuji
        RUNTIME DESTINATION . COMPONENT sokuji
        ARCHIVE DESTINATION lib COMPONENT sokuji_dev)
# ggml, ggml-base and the backend modules all land in ${CMAKE_BINARY_DIR}/lib; copy them by
# name (symlink chains preserved) rather than installing targets owned by other directories.
install(DIRECTORY ${CMAKE_BINARY_DIR}/lib/
        DESTINATION .
        COMPONENT sokuji
        FILES_MATCHING
            PATTERN "libggml*" PATTERN "ggml*.dll" PATTERN "libggml*.dylib"
            PATTERN "*.a" EXCLUDE PATTERN "*.lib" EXCLUDE PATTERN "test_*" EXCLUDE)
install(FILES ${CMAKE_BINARY_DIR}/contract.json DESTINATION . COMPONENT sokuji)
