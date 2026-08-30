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
