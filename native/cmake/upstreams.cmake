include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# Pins are commit SHAs, not tag names: a tag can be moved, a commit cannot.
set(_ggml_patch "")
if(SOKUJI_DROP_SME_VARIANTS)
    set(_ggml_patch
        PATCH_COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                      <SOURCE_DIR> ${CMAKE_CURRENT_LIST_DIR}/../patches/ggml-drop-sme.json)
endif()
FetchContent_Declare(ggml
    GIT_REPOSITORY https://github.com/ggml-org/ggml.git
    GIT_TAG        34dc0e5589504286cb40e13cbdae4bf2b5b4071b   # v0.22.0
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    ${_ggml_patch})
set(SOKUJI_GGML_VERSION "0.22.0")

FetchContent_MakeAvailable(ggml)
set(SOKUJI_GGML_SOURCE_DIR "${ggml_SOURCE_DIR}")

# Two patches (native/patches/transcribe.cpp.json): reuse our ggml if already
# present instead of transcribe.cpp building its own copy, and fix transcribe's
# own include path, which breaks when it is nested instead of top-level.
FetchContent_Declare(transcribe
    GIT_REPOSITORY https://github.com/handy-computer/transcribe.cpp.git
    GIT_TAG        c6a9257cdf8e9c6918c0f8f876246db048a22103   # v0.2.2
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    PATCH_COMMAND  ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                   <SOURCE_DIR> ${CMAKE_CURRENT_LIST_DIR}/../patches/transcribe.cpp.json)
set(SOKUJI_TRANSCRIBE_VERSION "0.2.2")

# transcribe.cpp options: static, dynamic ggml backends, nothing but the library.
#
# TRANSCRIBE_GGML_BACKEND_DL stays OFF: it only matters when transcribe.cpp
# builds its own embedded ggml as a shared lib (the add_subdirectory we bypass
# above), and it hard-fails configure when TRANSCRIBE_BUILD_SHARED is OFF.
set(TRANSCRIBE_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_USE_SYSTEM_BLAS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_VULKAN OFF CACHE BOOL "" FORCE)   # backends come from the shared ggml, not from transcribe's own flags
set(TRANSCRIBE_METAL  OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_CUDA   OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(transcribe)

# llama.cpp already guards with `if (NOT TARGET ggml AND NOT LLAMA_USE_SYSTEM_GGML)`,
# so it reuses our ggml target above instead of building its own copy: no patch needed.
FetchContent_Declare(llama
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG        c1d0e7a004015f23bc0233470b747b596f29b264   # v0.3.0 (in-tree ggml 0.22.0)
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE)
set(SOKUJI_LLAMA_VERSION "0.3.0")   # upstream tag is v0.3.0; the string is normalised like the other three

set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF)   # engines are static; ggml above was added while this was ON
FetchContent_MakeAvailable(llama)

# audio.cpp's CMake adds AUDIOCPP_GGML_SOURCE_DIR as a subdirectory unconditionally
# (CMakeLists.txt line 283 at v0.7.0); the JSON patch guards that one line with
# `if(NOT TARGET ggml)` so it reuses our ggml target instead of building its own copy.
# The directory-exists check just above that line stays satisfied because we point
# AUDIOCPP_GGML_SOURCE_DIR at our already-fetched upstream tree below.
FetchContent_Declare(audiocpp
    GIT_REPOSITORY https://github.com/0xShug0/audio.cpp.git
    GIT_TAG        d2ff37009c69d464bcab6aa4a44a13746e84a914   # v0.7.0
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    # audio.cpp declares its CLI/server/converter executables unconditionally; we only
    # ever build the targets sokuji_native links, so the rest is never compiled.
    EXCLUDE_FROM_ALL
    PATCH_COMMAND  ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                   <SOURCE_DIR> ${CMAKE_CURRENT_LIST_DIR}/../patches/audio.cpp.json)
set(SOKUJI_AUDIOCPP_VERSION "0.7.0")

set(AUDIOCPP_GGML_SOURCE_DIR "${SOKUJI_GGML_SOURCE_DIR}" CACHE PATH "" FORCE)
set(AUDIOCPP_MODEL_SET "custom" CACHE STRING "" FORCE)
# "silero_vad" is NOT in this list: audio.cpp keeps silero_vad (and marblenet_vad)
# outside the selectable model composite - they are always compiled in and always
# registered by engine::runtime::make_default_registry() regardless of AUDIOCPP_MODELS
# (see CMakeLists.txt around its "kept outside the selectable composite list for now"
# comment, and src/framework/runtime/registry.cpp). Listing "silero_vad" here would hit
# `message(FATAL_ERROR "Unknown AUDIOCPP_MODELS entry: silero_vad")` since it was never
# registered via audiocpp_add_model(). sk_selftest.cpp filters the registry down to our
# six supported families at run time instead (see its comment for the full story,
# including "moss_tts_nano" sharing its CMake target/loader list with "moss_tts_local").
set(AUDIOCPP_MODELS "moss_tts_nano;qwen3_tts;omnivoice;pocket_tts;supertonic" CACHE STRING "" FORCE)
set(AUDIOCPP_DEPLOYMENT_BUILD ON CACHE BOOL "" FORCE)        # model specs compiled in: no runtime JSON dir to ship
set(AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)  # we own the ggml knobs (ggml_options.cmake)
set(ENGINE_ENABLE_NATIVE_CPU OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_CUDA OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_HIP OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_VULKAN ${GGML_VULKAN} CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_METAL ${GGML_METAL} CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_OPENMP OFF CACHE BOOL "" FORCE)            # matches GGML_OPENMP=OFF: no libgomp anywhere
# audio.cpp force-sets GGML_LLAMAFILE from this; give it the value ggml_options.cmake
# already decided so that force is a no-op and a re-configure changes nothing.
set(ENGINE_ENABLE_LLAMAFILE ${GGML_LLAMAFILE} CACHE BOOL "" FORCE)
set(ENGINE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ENGINE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENGINE_BUILD_WARMBENCH OFF CACHE BOOL "" FORCE)
# EXCLUDE_FROM_ALL rides on the FetchContent_Declare above (CMake 3.28+), so this is a
# plain MakeAvailable rather than the deprecated Populate + add_subdirectory pair.
# audio.cpp force-sets several GGML_* cache entries from here on; every one of them is
# decided in ggml_options.cmake, which runs before ggml is configured on every
# configure — so there is nothing to re-assert afterwards.
FetchContent_MakeAvailable(audiocpp)
