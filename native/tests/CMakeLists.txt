add_executable(test_common test_common.cpp)
target_link_libraries(test_common PRIVATE sokuji_native)
# ggml.h for ggml_blck_size()/GGML_TYPE_* (fix round 1: the op-coverage block-size check).
target_link_libraries(test_common PRIVATE ggml)
# The module dir is where ggml's backend .so/.dll/.dylib files were written. Second arg is
# the requested n_threads: "3" (test_common) exercises "an explicit value is always honored
# verbatim"; "0" (test_common_threads_policy, same binary) exercises R32's
# min(hardware_concurrency, knee) policy — see test_common.cpp and sk_common.cpp's
# kThreadKnee, and vulkan-perf-investigation.md §Q2 for the spin-barrier oversubscription
# this guards against.
add_test(NAME test_common COMMAND test_common ${CMAKE_BINARY_DIR}/lib 3)
set_tests_properties(test_common PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")
add_test(NAME test_common_threads_policy COMMAND test_common ${CMAKE_BINARY_DIR}/lib 0)
set_tests_properties(test_common_threads_policy PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")

# Slice 2: ASR surface. Needs SK_TEST_ASR_GGUF (and, from Task 3, SK_TEST_ASR_STREAM_GGUF);
# exit code 77 = skipped, so a developer without the models still gets a green ctest.
add_executable(test_asr test_asr.cpp)
target_link_libraries(test_asr PRIVATE sokuji_native)
target_include_directories(test_asr PRIVATE ${transcribe_SOURCE_DIR}/examples/common)   # dr_wav.h
target_compile_definitions(test_asr PRIVATE SK_TEST_SAMPLE_WAV="${transcribe_SOURCE_DIR}/samples/jfk.wav")
add_test(NAME test_asr COMMAND test_asr ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_asr PROPERTIES
    ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib"
    SKIP_RETURN_CODE 77)

# Slice 3: translation surface. Needs SK_TEST_TRANSLATE_GGUF (Qwen3-0.6B Q8_0);
# exit code 77 = skipped, so a developer without the model still gets a green ctest.
add_executable(test_translate test_translate.cpp)
target_link_libraries(test_translate PRIVATE sokuji_native)
add_test(NAME test_translate COMMAND test_translate ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_translate PROPERTIES
    ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib"
    SKIP_RETURN_CODE 77)

# Slice 4: TTS surface. Needs SK_TEST_TTS_SUPERTONIC_DIR and SK_TEST_TTS_MOSS_DIR (each a
# directory holding one .gguf; audio.cpp materializes the family's config/voice-style
# sidecars from the GGUF's own embedded metadata); exit code 77 = skipped, so a developer
# without the models still gets a green ctest.
add_executable(test_tts test_tts.cpp)
target_link_libraries(test_tts PRIVATE sokuji_native)
add_test(NAME test_tts COMMAND test_tts ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_tts PROPERTIES
    ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib"
    SKIP_RETURN_CODE 77)

# Spec A §3.2: the pure .ops text format (no backend, no model) — runs on every lane.
# sk_ops_format.cpp is compiled straight in: it has C++ linkage, so the shared library
# (which exports only the sk_* C ABI) cannot hand it to a test binary.
add_executable(test_ops_format test_ops_format.cpp ../src/sk_ops_format.cpp)
target_include_directories(test_ops_format PRIVATE ../src ../include)
target_link_libraries(test_ops_format PRIVATE ggml)
add_test(NAME test_ops_format COMMAND test_ops_format)

# Spec A §3.2: the op-recording driver. Only the SOKUJI_RECORD_OPS configure builds it —
# that variant rewires ggml_backend_graph_compute inside audio.cpp and never ships.
# Not an add_test: it is run by hand, once per family, to regenerate src/ops/*.ops.
if(SOKUJI_RECORD_OPS)
    add_executable(record_ops record_ops.cpp ../src/sk_ops_format.cpp)
    target_link_libraries(record_ops PRIVATE sokuji_native ggml)
    target_include_directories(record_ops PRIVATE ../src)
endif()

# Spec A: the pure Vulkan-selection helper (no loader, no GPU) — runs on every lane.
add_executable(test_vk_select test_vk_select.cpp ../src/sk_vk_enum.cpp)
target_include_directories(test_vk_select PRIVATE ../src ../include)
target_link_libraries(test_vk_select PRIVATE ggml)
target_compile_definitions(test_vk_select PRIVATE SK_VK_ENUM_NO_LOADER=1)   # selection only; no dlopen path compiled
add_test(NAME test_vk_select COMMAND test_vk_select)
