add_executable(test_common test_common.cpp)
target_link_libraries(test_common PRIVATE sokuji_native)
# The module dir is where ggml's backend .so/.dll/.dylib files were written.
add_test(NAME test_common COMMAND test_common ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_common PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")

# Slice 2: ASR surface. Needs SK_TEST_ASR_GGUF (and, from Task 3, SK_TEST_ASR_STREAM_GGUF);
# exit code 77 = skipped, so a developer without the models still gets a green ctest.
add_executable(test_asr test_asr.cpp)
target_link_libraries(test_asr PRIVATE sokuji_native)
add_test(NAME test_asr COMMAND test_asr ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_asr PROPERTIES
    ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib"
    SKIP_RETURN_CODE 77)
