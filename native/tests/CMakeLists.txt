add_executable(test_common test_common.cpp)
target_link_libraries(test_common PRIVATE sokuji_native)
# The module dir is where ggml's backend .so/.dll/.dylib files were written.
add_test(NAME test_common COMMAND test_common ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_common PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")

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

# Slice 2: VAD surface over audio.cpp's bundled silero_vad. Weights ship in the source
# tree, so no env var / skip logic is needed here.
add_executable(test_vad test_vad.cpp)
target_link_libraries(test_vad PRIVATE sokuji_native)
target_include_directories(test_vad PRIVATE ${transcribe_SOURCE_DIR}/examples/common)
target_compile_definitions(test_vad PRIVATE
    SK_TEST_SAMPLE_WAV="${transcribe_SOURCE_DIR}/samples/jfk.wav"
    SK_TEST_VAD_WEIGHTS="${audiocpp_SOURCE_DIR}/assets/framework/models/silero_vad/silero_vad_16k.safetensors")
add_test(NAME test_vad COMMAND test_vad ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_vad PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")
