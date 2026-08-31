#!/usr/bin/env bash
# Builds the OFFICIAL, UNPATCHED audio.cpp CLI (audiocpp_cli) — the reference side of the TTS
# parity gate (spec §9.2). Our own libsokuji_native links audio.cpp against OUR pristine
# upstream ggml, via a patch (native/patches/audio.cpp.json) that makes audio.cpp's CMake
# reuse an already-configured `ggml` target instead of building its own copy. This script
# builds the SAME vendored audio.cpp source (same pinned commit) completely unpatched, so it
# pulls in and builds audio.cpp's OWN fork of ggml (external/ggml inside its own tree) — the
# only intentional difference between the two binaries under test.
#
# Idempotent: exits immediately if the cached binary already exists (delete it, or point
# SOKUJI_NATIVE_TEST_CACHE elsewhere, to force a rebuild). First run: a git clone plus a CPU-only
# build of ggml + engine_runtime + audiocpp_cli (no server/webui/model-manager targets, so no
# OpenSSL/libyaml/cpp-httplib dependency) — about 15 minutes on a 20-core box.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
UPSTREAMS_CMAKE="$ROOT/native/cmake/upstreams.cmake"

CACHE_DIR="${SOKUJI_NATIVE_TEST_CACHE:-$HOME/.cache/sokuji-native-tests}"
SRC_DIR="$CACHE_DIR/audiocpp-official-src"
BUILD_DIR="$CACHE_DIR/audiocpp-official-build"
OUT_DIR="$CACHE_DIR/audiocpp-official"
OUT_BIN="$OUT_DIR/audiocpp_cli"

if [[ -x "$OUT_BIN" ]]; then
    echo "build_reference_cli.sh: $OUT_BIN already exists — skipping (delete it, or set SOKUJI_NATIVE_TEST_CACHE, to force a rebuild)"
    exit 0
fi

# The repo URL and pinned commit are read out of upstreams.cmake, not hardcoded here, so a
# future pin bump (native/README.md's "Bumping a pin" step 3: "run the parity suite — a bump
# that fails parity is not shipped") is picked up by this script automatically.
BLOCK="$(awk '/^FetchContent_Declare\(audiocpp$/{f=1} f{print} f&&/\)$/{exit}' "$UPSTREAMS_CMAKE")"
REPO_URL="$(printf '%s\n' "$BLOCK" | sed -n -E 's/^[[:space:]]*GIT_REPOSITORY[[:space:]]+([^[:space:]]+)[[:space:]]*$/\1/p')"
GIT_SHA="$(printf '%s\n' "$BLOCK" | sed -n -E 's/^[[:space:]]*GIT_TAG[[:space:]]+([0-9a-f]{40}).*/\1/p')"
if [[ -z "$REPO_URL" || -z "$GIT_SHA" ]]; then
    echo "build_reference_cli.sh: could not find the audiocpp FetchContent_Declare(...) block in $UPSTREAMS_CMAKE" >&2
    exit 1
fi
echo "build_reference_cli.sh: pristine audio.cpp @ $GIT_SHA from $REPO_URL"

if [[ ! -d "$SRC_DIR/.git" ]]; then
    rm -rf "$SRC_DIR"
    mkdir -p "$SRC_DIR"
    git -C "$SRC_DIR" init -q
    git -C "$SRC_DIR" remote add origin "$REPO_URL"
    # GitHub serves an arbitrary reachable commit SHA directly (no tag/branch needed), so
    # this is a real shallow clone (--depth 1), not a full-history clone plus checkout.
    git -C "$SRC_DIR" fetch --depth 1 origin "$GIT_SHA"
    git -C "$SRC_DIR" checkout -q FETCH_HEAD
fi
ACTUAL_SHA="$(git -C "$SRC_DIR" rev-parse HEAD)"
if [[ "$ACTUAL_SHA" != "$GIT_SHA" ]]; then
    echo "build_reference_cli.sh: $SRC_DIR is at $ACTUAL_SHA, expected the pin $GIT_SHA — delete it and re-run" >&2
    exit 1
fi

# Sanity: this must be the PRISTINE tree — unconditional ggml add_subdirectory (our patch
# guards it with `if(NOT TARGET ggml)`), own fork ggml vendored at external/ggml. A silent
# false pass here (e.g. this script accidentally pointed at an already-patched checkout) would
# quietly turn the "reference" side into another build of OUR ggml, defeating the whole gate.
if ! grep -qF 'add_subdirectory("${AUDIOCPP_GGML_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/ggml")' "$SRC_DIR/CMakeLists.txt"; then
    echo "build_reference_cli.sh: $SRC_DIR/CMakeLists.txt does not look like pristine audio.cpp (the unconditional ggml add_subdirectory line is missing — looks patched). Refusing to build." >&2
    exit 1
fi
if [[ ! -d "$SRC_DIR/external/ggml" ]]; then
    echo "build_reference_cli.sh: $SRC_DIR/external/ggml (audio.cpp's own fork ggml) is missing" >&2
    exit 1
fi

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

# ggml 0.22.0 hard-codes two armv9.2+sme CPU-kernel variants on arm64/Linux. GCC (11 and 13,
# at least) rejects `+sme` outright — native/cmake/ggml_options.cmake documents the same wall
# for OUR separately-fetched ggml copy and works around it by applying
# native/patches/ggml-drop-sme.json via native/cmake/patch_upstream.py. This is a pure
# compiler/toolchain limitation inside ggml itself, unrelated to the ggml-reuse patch this
# script is deliberately not applying — audio.cpp's OWN bundled ggml fork (external/ggml, just
# cloned above) hits the identical wall on this box, so it needs the identical, purely
# mechanical drop to build at all here. It changes nothing this comparison exercises: even in
# our own correctly-configured build, the CPU tier actually selected at runtime on this box is
# armv8.6_2 (ggml_options.cmake's comment), never the dropped SME ones. Reusing
# patch_upstream.py itself (rather than a bespoke sed) keeps this exactly as surgical as our
# own patch: an exact-substring replace, idempotent, and it fails loudly instead of silently
# no-op'ing if the anchored text ever moves.
if ! printf 'int main(){return 0;}\n' | "${CXX:-c++}" -march=armv9.2-a+sme -x c++ - -o /dev/null >/dev/null 2>&1; then
    echo "build_reference_cli.sh: compiler lacks +sme — dropping ggml's armv9.2 CPU variants in audio.cpp's own ggml copy (same fix as native/patches/ggml-drop-sme.json)"
    "${PYTHON3:-python3}" "$ROOT/native/cmake/patch_upstream.py" "$SRC_DIR/external/ggml" "$ROOT/native/patches/ggml-drop-sme.json"
fi

# Flags mirror native/cmake/upstreams.cmake's audio.cpp block as closely as a standalone
# configure allows, so the only deliberate difference from our own build is the ggml source:
#   - AUDIOCPP_MODEL_SET/MODELS: the same five families sokuji_native links.
#   - CPU only, deployment build, no native model manager: matches upstreams.cmake verbatim.
#   - ENGINE_ENABLE_CPU_ALL_VARIANTS=ON (audio.cpp's own default is OFF): our build gets this
#     behavior for free because native/cmake/ggml_options.cmake configures ggml itself, before
#     audio.cpp's patched CMakeLists.txt skips its own `add_subdirectory(ggml)` entirely — with
#     GGML_NATIVE=OFF, GGML_CPU_ALL_VARIANTS=ON, GGML_BACKEND_DL=ON (one shared module per ISA
#     tier, picked at runtime; never `-march=native`). A standalone configure has no such
#     pre-existing ggml target, so it takes audio.cpp's own CMakeLists.txt branch at line
#     ~244-259 instead — and that branch's `else()` arm sets GGML_NATIVE=ON by default. Passing
#     ENGINE_ENABLE_CPU_ALL_VARIANTS=ON here forces the SAME `if()` branch our build gets for
#     free, so both binaries pick their CPU kernels from the same non-native, per-ISA-tier
#     dynamic-dispatch scheme instead of a `-march=native` single-target compile — the single
#     biggest source of spurious (compiler/ISA, not model) non-determinism this script can
#     control for.
#   - ENGINE_ENABLE_OPENMP=OFF, ENGINE_ENABLE_LLAMAFILE=ON: verbatim from upstreams.cmake (the
#     non-MSVC default llama.cpp SGEMM path; OFF for OpenMP so host-code reductions aren't
#     reordered by a thread count neither side otherwise controls).
cmake -S "$SRC_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DAUDIOCPP_MODEL_SET=custom \
    -DAUDIOCPP_MODELS="moss_tts_nano;qwen3_tts;omnivoice;pocket_tts;supertonic" \
    -DAUDIOCPP_DEPLOYMENT_BUILD=ON \
    -DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=OFF \
    -DENGINE_ENABLE_CPU_ALL_VARIANTS=ON \
    -DENGINE_ENABLE_NATIVE_CPU=OFF \
    -DENGINE_ENABLE_CUDA=OFF \
    -DENGINE_ENABLE_HIP=OFF \
    -DENGINE_ENABLE_VULKAN=OFF \
    -DENGINE_ENABLE_METAL=OFF \
    -DENGINE_ENABLE_OPENMP=OFF \
    -DENGINE_ENABLE_LLAMAFILE=ON \
    -DENGINE_BUILD_EXAMPLES=OFF \
    -DENGINE_BUILD_TESTS=OFF \
    -DENGINE_BUILD_WARMBENCH=OFF
cmake --build "$BUILD_DIR" --target audiocpp_cli -j"$JOBS"

mkdir -p "$OUT_DIR"
# GGML_BACKEND_DL=ON builds the CPU backend(s) as shared modules next to audiocpp_cli
# (CMAKE_LIBRARY_OUTPUT_DIRECTORY == CMAKE_RUNTIME_OUTPUT_DIRECTORY == $BUILD_DIR/bin, set by
# audio.cpp's own top-level CMakeLists.txt) — copy the whole directory, not just the one
# binary, so the modules ggml_backend_load_all() looks for next to the executable ship with it.
cp -r "$BUILD_DIR/bin/." "$OUT_DIR/"
chmod +x "$OUT_BIN"
if ! "$OUT_BIN" --list-devices >/dev/null 2>&1; then
    echo "build_reference_cli.sh: built binary at $OUT_BIN failed to run --list-devices" >&2
    exit 1
fi
echo "build_reference_cli.sh: built $OUT_BIN"
