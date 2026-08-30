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
