#!/usr/bin/env bash
# One build, used by CI and by developers. Usage: native/ci/build.sh <none|vulkan|metal> <wheel-platform-tag>
set -euo pipefail
LANE="${1:?lane: none|vulkan|metal}"
PLAT="${2:?wheel platform tag, e.g. manylinux_2_28_x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
# Lane `none` reuses the pre-existing `build/cpu` tree (the developer default from before
# this script existed) instead of building a fresh `build/none` from scratch — ggml plus
# all three engines takes ~30 minutes. CI lane names stay as-is (build/vulkan, build/metal).
BUILD="$ROOT/build/$( [ "$LANE" = none ] && echo cpu || echo "$LANE" )"
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

cmake -S "$ROOT" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release -DSOKUJI_GPU="$LANE"
cmake --build "$BUILD" -j"$JOBS"
ctest --test-dir "$BUILD" --output-on-failure
rm -rf "$BUILD/stage" "$ROOT/python/sokuji_native/_native"
# Only the sokuji component: the fetched upstreams carry their own install() rules
# (headers, static libs, cmake configs) in the default component, which must not run.
cmake --install "$BUILD" --prefix "$BUILD/stage" --component sokuji
if command -v strip >/dev/null && [ "$(uname -s)" != "Darwin" ]; then
    find "$BUILD/stage" -name '*.so*' -exec strip --strip-unneeded {} +
fi
cp -r "$BUILD/stage" "$ROOT/python/sokuji_native/_native"
( cd "$ROOT/python" && rm -rf dist && SOKUJI_NATIVE_PLAT="$PLAT" "$PYTHON" -m pip wheel . --no-deps -w dist )
ls -la "$ROOT/python/dist"
# Import the wheel we just built, from a clean interpreter, and print the device table.
"$PYTHON" -m pip install -q --force-reinstall "$ROOT"/python/dist/*.whl
"$PYTHON" -c "import sokuji_native as s; s.init(); print(s.version(), s.engine_versions(), [(d.kind, d.description) for d in s.devices()])"
