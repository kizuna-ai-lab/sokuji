cmake_minimum_required(VERSION 3.22)
project(aec3)

set(LIBS "${CMAKE_CURRENT_SOURCE_DIR}/../../../libs")
file(GLOB ARCHIVES "${LIBS}/${ANDROID_ABI}/*.a")

add_library(aec3 SHARED apm_jni.cc)
target_include_directories(aec3 PRIVATE "${LIBS}/include")
target_compile_definitions(aec3 PRIVATE WEBRTC_LIBRARY_IMPL WEBRTC_POSIX WEBRTC_ANDROID)
target_link_libraries(aec3 PRIVATE -Wl,--start-group ${ARCHIVES} -Wl,--end-group log)
target_link_options(aec3 PRIVATE -Wl,-z,max-page-size=16384)
