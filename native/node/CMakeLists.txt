# sokuji_native_node.node — the Node-API addon over libsokuji_native, shipped beside it.
# NAPI_VERSION 8: one build per platform loads in Node >= 18 and in Electron (Node-API 10).
# The Node-API and node-addon-api headers are vendored (third_party/), so the build needs
# neither node-gyp nor a Node.js header download. The file name is sokuji_native_node, not
# sokuji_native, so it never shares a base name with sokuji_native.dll on Windows.
add_library(sokuji_native_node MODULE
    src/addon.cpp
    src/errors.cpp
    src/common.cpp
    src/worker.cpp
    src/asr.cpp
    src/translate.cpp
    src/tts.cpp
    src/resample.cpp
    third_party/speexdsp/resample.c)
set_target_properties(sokuji_native_node PROPERTIES
    OUTPUT_NAME sokuji_native_node
    PREFIX ""
    SUFFIX ".node"
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON)   # rpath: the project-wide CMAKE_INSTALL_RPATH
target_include_directories(sokuji_native_node SYSTEM PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/node-api-headers/include
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/node-addon-api)
target_compile_definitions(sokuji_native_node PRIVATE
    NAPI_VERSION=8
    NODE_ADDON_API_DISABLE_DEPRECATED
    NAPI_CPP_EXCEPTIONS)
# speexdsp's resampler (BSD-3, third_party/speexdsp): float build, standalone (no config.h),
# every public symbol prefixed with sokuji_ so it never meets another copy in the process.
# (src/resample.cpp includes the same header, so it gets the same definitions.)
set_source_files_properties(third_party/speexdsp/resample.c src/resample.cpp PROPERTIES
    COMPILE_DEFINITIONS "FLOATING_POINT;OUTSIDE_SPEEX;RANDOM_PREFIX=sokuji")

# One std::thread per loaded model (src/worker.cpp).
find_package(Threads REQUIRED)
target_link_libraries(sokuji_native_node PRIVATE sokuji_native Threads::Threads)

if(WIN32)
    # The Node-API lives in the host executable. Link an import library that names it
    # node.exe and delay-load it; node-gyp's hook then hands the loader whichever executable
    # actually loaded the addon (electron.exe, the renamed app), as node-gyp builds do.
    set(_node_def ${CMAKE_CURRENT_SOURCE_DIR}/third_party/node-api-headers/def/node_api.def)
    set(_node_lib ${CMAKE_CURRENT_BINARY_DIR}/node.lib)
    add_custom_command(
        OUTPUT ${_node_lib}
        COMMAND ${CMAKE_AR} /nologo /def:${_node_def} /out:${_node_lib} /name:node.exe /machine:x64
        DEPENDS ${_node_def}
        COMMENT "sokuji-native: node.exe import library from node_api.def")
    add_custom_target(sokuji_native_node_implib DEPENDS ${_node_lib})
    add_dependencies(sokuji_native_node sokuji_native_node_implib)
    target_sources(sokuji_native_node PRIVATE third_party/win_delay_load_hook.cc)
    target_compile_definitions(sokuji_native_node PRIVATE HOST_BINARY="node.exe")
    target_compile_options(sokuji_native_node PRIVATE /EHsc)
    target_link_libraries(sokuji_native_node PRIVATE ${_node_lib} delayimp)
    target_link_options(sokuji_native_node PRIVATE /DELAYLOAD:node.exe)
elseif(APPLE)
    # napi_* resolve against the host process at load time.
    target_link_options(sokuji_native_node PRIVATE LINKER:-undefined,dynamic_lookup)
else()
    # Same C++ runtime floor as libsokuji_native (native/ci/check_linux_deps.py). The static
    # runtime's symbols stay local, so the addon never binds to (or overrides) the copy the
    # host process already has loaded. napi_* stay undefined: the host process exports them.
    # The version script exports only the module entry points.
    target_link_options(sokuji_native_node PRIVATE
        -static-libstdc++ -static-libgcc
        -Wl,--exclude-libs,ALL
        -Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/src/sokuji_native_node.map)
    set_target_properties(sokuji_native_node PROPERTIES
                          LINK_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/sokuji_native_node.map)
endif()

# init() and contract() read contract.json from the module directory. The stage gets it from
# the top-level install rule; the build tree's lib/, which the addon tests use as their module
# directory, gets the same file here.
add_custom_command(
    OUTPUT ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/contract.json
    COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_BINARY_DIR}/contract.json ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/contract.json
    DEPENDS ${CMAKE_BINARY_DIR}/contract.json)
add_custom_target(sokuji_native_node_contract DEPENDS ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/contract.json)
add_dependencies(sokuji_native_node sokuji_native_node_contract)

# Its own component, so the wheel's `cmake --install ... --component sokuji` is unchanged.
# A MODULE library is a LIBRARY artifact on every platform; RUNTIME is listed for symmetry.
install(TARGETS sokuji_native_node
        LIBRARY DESTINATION . COMPONENT sokuji_node
        RUNTIME DESTINATION . COMPONENT sokuji_node)
