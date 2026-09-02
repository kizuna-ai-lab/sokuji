#!/usr/bin/env bash
# Builds a self-contained, arch-native Vulkan BUILD-TIME toolchain from pinned
# Khronos/Google source releases into <prefix>: Vulkan headers, SPIRV-Headers
# (with the CMake package config ggml-vulkan's
# find_package(SPIRV-Headers CONFIG REQUIRED) needs), and a standalone glslc
# binary built from shaderc. Used by native-build.yml's Linux+Vulkan lanes
# (R38 — replaces an earlier LunarG-apt recipe that a review caught two real
# breaks in: LunarG's jammy apt repo has no arm64 index at all, so it cannot
# work on ubuntu-22.04-arm; and its libvulkan-dev package ships no headers, so
# vulkan/vulkan.h would vanish and find_package(Vulkan COMPONENTS glslc
# REQUIRED) would fail at configure even on x64). This script has no apt/distro
# dependency beyond a C++17 compiler, cmake, git and python3 — same recipe on
# x86_64 and aarch64, no glibc-era package-availability games.
#
# Usage: native/ci/vulkan-toolchain.sh <prefix>
#
# Output layout, all under <prefix>:
#   include/vulkan/*.h, include/vk_video/*.h   (Vulkan-Headers, header-only)
#   share/cmake/SPIRV-Headers/...              (SPIRV-Headers CMake config)
#   bin/glslc                                  (shaderc's glslc_exe, statically built)
#
# Point CMake at it with:
#   VULKAN_SDK=<prefix>        — CMake's own FindVulkan.cmake module reads this
#                                 env var as a HINT (searched before the system's
#                                 default include/lib/PATH dirs) for
#                                 Vulkan_INCLUDE_DIR, Vulkan_LIBRARY and
#                                 Vulkan_GLSLC_EXECUTABLE alike — see
#                                 /usr/share/cmake-*/Modules/FindVulkan.cmake's
#                                 "Hints" section. This is what makes the
#                                 prefix's fresher headers win over the
#                                 distro's older libvulkan-dev headers, and
#                                 what points find_program at our built glslc.
#   CMAKE_PREFIX_PATH=<prefix> — for the SPIRV-Headers CONFIG lookup (ggml's own
#                                 ggml-vulkan/CMakeLists.txt also appends
#                                 $VULKAN_SDK to CMAKE_PREFIX_PATH itself right
#                                 after finding Vulkan, so VULKAN_SDK alone
#                                 would already cover this — both are set by the
#                                 caller for defense in depth).
#
# Deliberately does NOT build or install libvulkan.so itself: the loader comes
# from the distro's own libvulkan-dev/libvulkan1 (apt), so the built wheel
# keeps linking the exact system loader every target machine already has.
# Building against newer Vulkan headers than the runtime loader is fine — ggml
# resolves entry points dynamically at load time. See
# .superpowers/linux-x64-vulkan-validation.md §5.
#
# Pinned versions (Vulkan-Headers and SPIRV-Headers are both from the Vulkan
# SDK 1.4.313 release train; shaderc v2025.2 is the version LunarG's own jammy
# apt build used, per .superpowers/linux-x64-vulkan-validation.md §1 — its
# DEPS file is what pins the SPIRV-Headers commit below). Each is cloned by
# tag and then checked against the commit recorded here (a tag can be moved;
# a commit cannot — same discipline native/cmake/upstreams.cmake uses for the
# main upstreams), so a moved tag fails loudly instead of silently building a
# different tree:
#   Vulkan-Headers  v1.4.313               -> 409c16be502e39fe70dd6fe2d9ad4842ef2c9a53
#   SPIRV-Headers   vulkan-sdk-1.4.313.0   -> aa6cef192b8e693916eb713e7a9ccadf06062ceb
#   shaderc         v2025.2                -> 3362e24c42ab5bf7ad32c0fec64b0a0ddeb2fda1
#
# (v1.4.313 and v2025.2 are annotated tags: the SHA that names the tag object
# itself differs from the commit it points at — `git clone --branch <tag>`
# checks out the latter, so that is what is pinned here. Verify with
# `git ls-remote <repo> refs/tags/<tag>^{}`, not a plain --tags listing, which
# prints the tag OBJECT's own sha for an annotated tag.)
#
# Idempotent-ish: re-running against an already-populated <prefix> skips the
# (several-minutes, mostly shaderc/glslang/SPIRV-Tools) build entirely. CI
# wraps the whole prefix in actions/cache keyed on (runner sku, these three pins).
set -euo pipefail

VULKAN_HEADERS_TAG="v1.4.313"
VULKAN_HEADERS_SHA="409c16be502e39fe70dd6fe2d9ad4842ef2c9a53"
SPIRV_HEADERS_TAG="vulkan-sdk-1.4.313.0"
SPIRV_HEADERS_SHA="aa6cef192b8e693916eb713e7a9ccadf06062ceb"
SHADERC_TAG="v2025.2"
SHADERC_SHA="3362e24c42ab5bf7ad32c0fec64b0a0ddeb2fda1"

PREFIX="${1:?usage: vulkan-toolchain.sh <prefix>}"
mkdir -p "$PREFIX"
PREFIX="$(cd "$PREFIX" && pwd)"

if [ -x "$PREFIX/bin/glslc" ] && [ -f "$PREFIX/include/vulkan/vulkan.h" ] \
   && [ -d "$PREFIX/share/cmake/SPIRV-Headers" ]; then
    echo "[vulkan-toolchain] $PREFIX already populated, skipping build"
    "$PREFIX/bin/glslc" --version
    exit 0
fi

# Ninja is much faster for the glslang/SPIRV-Tools/shaderc tree, but is not
# guaranteed to be on PATH everywhere this script runs (CI installs
# ninja-build explicitly; a developer's box may not have it) — fall back to
# the platform default generator (Unix Makefiles on Linux/macOS) rather than
# failing outright.
GENERATOR="Unix Makefiles"
if command -v ninja >/dev/null 2>&1; then
    GENERATOR="Ninja"
else
    echo "[vulkan-toolchain] ninja not found on PATH; falling back to Unix Makefiles (slower)" >&2
fi
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

verify_pin() {
    # $1 = repo dir, $2 = expected commit SHA, $3 = human label
    local got
    got="$(git -C "$1" rev-parse HEAD)"
    if [ "$got" != "$2" ]; then
        echo "[vulkan-toolchain] $3: expected commit $2, got $got (tag moved upstream?)" >&2
        exit 1
    fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[vulkan-toolchain] Vulkan-Headers $VULKAN_HEADERS_TAG (header-only)"
git clone --quiet --depth 1 --branch "$VULKAN_HEADERS_TAG" \
    https://github.com/KhronosGroup/Vulkan-Headers.git "$WORK/Vulkan-Headers"
verify_pin "$WORK/Vulkan-Headers" "$VULKAN_HEADERS_SHA" "Vulkan-Headers"
cmake -S "$WORK/Vulkan-Headers" -B "$WORK/Vulkan-Headers/build" -G "$GENERATOR" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DVULKAN_HEADERS_ENABLE_TESTS=OFF -DVULKAN_HEADERS_ENABLE_INSTALL=ON \
    -DVULKAN_HEADERS_ENABLE_MODULE=OFF
cmake --install "$WORK/Vulkan-Headers/build"

echo "[vulkan-toolchain] SPIRV-Headers $SPIRV_HEADERS_TAG (header-only, provides the CMake config)"
git clone --quiet --depth 1 --branch "$SPIRV_HEADERS_TAG" \
    https://github.com/KhronosGroup/SPIRV-Headers.git "$WORK/SPIRV-Headers"
verify_pin "$WORK/SPIRV-Headers" "$SPIRV_HEADERS_SHA" "SPIRV-Headers"
cmake -S "$WORK/SPIRV-Headers" -B "$WORK/SPIRV-Headers/build" -G "$GENERATOR" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DSPIRV_HEADERS_ENABLE_TESTS=OFF -DSPIRV_HEADERS_ENABLE_INSTALL=ON
cmake --install "$WORK/SPIRV-Headers/build"

echo "[vulkan-toolchain] shaderc $SHADERC_TAG (building glslc_exe only; several minutes uncached)"
git clone --quiet --depth 1 --branch "$SHADERC_TAG" \
    https://github.com/google/shaderc.git "$WORK/shaderc"
verify_pin "$WORK/shaderc" "$SHADERC_SHA" "shaderc"
( cd "$WORK/shaderc" && python3 utils/git-sync-deps )
cmake -S "$WORK/shaderc" -B "$WORK/shaderc/build" -G "$GENERATOR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DSHADERC_SKIP_TESTS=ON -DSHADERC_SKIP_EXAMPLES=ON -DSHADERC_SKIP_COPYRIGHT_CHECK=ON
cmake --build "$WORK/shaderc/build" --target glslc_exe -j"$JOBS"

GLSLC_BIN="$(find "$WORK/shaderc/build" -type f -name glslc -perm -u+x | head -1)"
if [ -z "$GLSLC_BIN" ]; then
    echo "[vulkan-toolchain] built tree has no glslc executable; build failed silently?" >&2
    exit 1
fi
mkdir -p "$PREFIX/bin"
install -m 0755 "$GLSLC_BIN" "$PREFIX/bin/glslc"

echo "[vulkan-toolchain] done:"
"$PREFIX/bin/glslc" --version
test -f "$PREFIX/include/vulkan/vulkan.h"
test -d "$PREFIX/share/cmake/SPIRV-Headers"
echo "[vulkan-toolchain] $PREFIX ready"
