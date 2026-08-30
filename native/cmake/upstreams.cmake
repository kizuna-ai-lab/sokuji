include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# Pins are commit SHAs, not tag names: a tag can be moved, a commit cannot.
set(_ggml_patch "")
if(SOKUJI_DROP_SME_VARIANTS)
    set(_ggml_patch
        PATCH_COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                      <SOURCE_DIR>/src/CMakeLists.txt
                      "ggml_add_cpu_backend_variant(armv9.2_1    DOTPROD FP16_VECTOR_ARITHMETIC SVE MATMUL_INT8 SME)"
                      "# armv9.2_1 dropped by sokuji-native: compiler lacks +sme"
              COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                      <SOURCE_DIR>/src/CMakeLists.txt
                      "ggml_add_cpu_backend_variant(armv9.2_2    DOTPROD FP16_VECTOR_ARITHMETIC SVE MATMUL_INT8 SVE2 SME)"
                      "# armv9.2_2 dropped by sokuji-native: compiler lacks +sme")
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

FetchContent_Declare(transcribe
    GIT_REPOSITORY https://github.com/handy-computer/transcribe.cpp.git
    GIT_TAG        c6a9257cdf8e9c6918c0f8f876246db048a22103   # v0.2.2
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    # "add_subdirectory(ggml)" as literal text also appears in two comments (lines
    # ~290 and ~301) explaining *why* things are ordered around the real call at
    # line 430 — patch_upstream.py requires its old-string to match exactly once,
    # so the two comments are neutralised (a harmless added space) before the real
    # call is wrapped in the ggml-guard.
    PATCH_COMMAND  ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                   <SOURCE_DIR>/CMakeLists.txt
                   "before add_subdirectory(ggml) so every target"
                   "before add_subdirectory (ggml) so every target"
            COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                    <SOURCE_DIR>/CMakeLists.txt
                    "add_subdirectory(ggml) so ggml's own option()"
                    "add_subdirectory (ggml) so ggml's own option()"
            COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                    <SOURCE_DIR>/CMakeLists.txt
                    "add_subdirectory(ggml)"
                    "if(NOT TARGET ggml)\\\\n    add_subdirectory(ggml)\\\\nendif()"
            # src/CMakeLists.txt assumes it is always the top-level project:
            # CMAKE_SOURCE_DIR is the outermost project's root (ours, when
            # transcribe is nested via FetchContent), not transcribe's own root,
            # so the public transcribe.h header goes missing from its own
            # include path. PROJECT_SOURCE_DIR tracks transcribe's own
            # project(transcribe ...) call instead and is correct either way.
            COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                    <SOURCE_DIR>/src/CMakeLists.txt
                    "$<BUILD_INTERFACE:\\\${CMAKE_SOURCE_DIR}/include>"
                    "$<BUILD_INTERFACE:\\\${PROJECT_SOURCE_DIR}/include>")
set(SOKUJI_TRANSCRIBE_VERSION "0.2.2")

# transcribe.cpp options: static, dynamic ggml backends, nothing but the library.
#
# TRANSCRIBE_GGML_BACKEND_DL stays OFF here even though we want dynamic backend
# modules: at v0.2.2 that option's own CMakeLists.txt hard-fails configure with
# TRANSCRIBE_GGML_BACKEND_DL requires TRANSCRIBE_BUILD_SHARED=ON unless
# TRANSCRIBE_BUILD_SHARED is also ON — it only matters when transcribe.cpp
# builds its OWN embedded ggml as a shared lib. We bypass that add_subdirectory
# entirely (ggml-guard patch above) and reuse the one shared ggml this
# super-project already built with GGML_BACKEND_DL=ON (ggml_options.cmake), so
# dynamic backend modules are already the outcome without setting this option.
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
