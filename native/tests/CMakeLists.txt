add_executable(test_common test_common.cpp)
target_link_libraries(test_common PRIVATE sokuji_native)
# The module dir is where ggml's backend .so/.dll/.dylib files were written.
add_test(NAME test_common COMMAND test_common ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_common PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")
