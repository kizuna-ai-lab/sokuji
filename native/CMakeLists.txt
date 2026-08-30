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

# Engines are added by Tasks 3–5; libsokuji_native by Task 2.
