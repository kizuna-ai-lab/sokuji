cmake_minimum_required(VERSION 3.24)
project(sokuji_native VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)   # Windows DLLs land beside the .so/.dylib equivalents
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()
find_package(Python3 COMPONENTS Interpreter REQUIRED)         # for patch_upstream.py

include(cmake/ggml_options.cmake)
include(cmake/upstreams.cmake)

set(SOKUJI_AUDIOCPP_VERSION "")      # filled by Task 5
configure_file(src/version.h.in ${CMAKE_BINARY_DIR}/generated/version.h @ONLY)

set(BUILD_SHARED_LIBS OFF)           # everything after ggml is static — engines fold into libsokuji_native
add_library(sokuji_native SHARED
    src/sk_common.cpp)
target_include_directories(sokuji_native
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_BINARY_DIR}/generated)
target_compile_definitions(sokuji_native PRIVATE SOKUJI_NATIVE_BUILD=1)
target_link_libraries(sokuji_native PRIVATE ggml)
target_link_libraries(sokuji_native PRIVATE transcribe)
target_include_directories(sokuji_native PRIVATE ${transcribe_SOURCE_DIR}/include)
target_link_libraries(sokuji_native PRIVATE llama)
target_include_directories(sokuji_native PRIVATE ${llama_SOURCE_DIR}/include)
set_target_properties(sokuji_native PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    BUILD_RPATH "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")
if(APPLE)
    set_target_properties(sokuji_native PROPERTIES BUILD_RPATH "@loader_path" INSTALL_RPATH "@loader_path")
endif()
if(NOT WIN32)
    target_link_libraries(sokuji_native PRIVATE ${CMAKE_DL_LIBS})
endif()

enable_testing()
add_subdirectory(tests)
