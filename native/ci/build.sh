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
# Op recordings (spec A §3.2, README's "Bumping a pin" checklist): re-record every family
# whose SK_TEST_* model is present and diff against the shipped src/ops/*.ops. Always its own
# CPU-only build/record tree (SOKUJI_GPU=none) regardless of this script's own LANE, since the
# recordings were captured on CPU and must match there; test_ops_coverage's SKIP_RETURN_CODE
# 77 turns "no SK_TEST_* var set at all" into a ctest skip rather than a failure, so this is
# harmless on a developer box with no cached models.
RECORD_BUILD="$ROOT/build/record"
cmake -S "$ROOT" -B "$RECORD_BUILD" -DCMAKE_BUILD_TYPE=Release -DSOKUJI_GPU=none -DSOKUJI_RECORD_OPS=ON
cmake --build "$RECORD_BUILD" -j"$JOBS"
ctest --test-dir "$RECORD_BUILD" -R test_ops_coverage --output-on-failure
rm -rf "$BUILD/stage" "$ROOT/python/sokuji_native/_native"
# Only the sokuji component: the fetched upstreams carry their own install() rules
# (headers, static libs, cmake configs) in the default component, which must not run.
cmake --install "$BUILD" --prefix "$BUILD/stage" --component sokuji
if command -v strip >/dev/null && [ "$(uname -s)" != "Darwin" ]; then
    find "$BUILD/stage" -name '*.so*' -exec strip --strip-unneeded {} +
fi
# Linux: the manylinux tag promises a glibc floor and no stray runtime dependencies;
# check both on the staged tree (see the script's docstring for why not auditwheel).
if [ "$(uname -s)" = "Linux" ]; then
    "$PYTHON" "$ROOT/ci/check_linux_deps.py" "$BUILD/stage" "$PLAT"
fi
cp -r "$BUILD/stage" "$ROOT/python/sokuji_native/_native"
# The binding's own tests, against the SOURCE package (PYTHONPATH) and this stage — not
# against whatever sokuji_native happens to be installed in this interpreter.
"$PYTHON" -m pip install -q pytest numpy
export SK_TEST_SAMPLE_WAV="$BUILD/_deps/transcribe-src/samples/jfk.wav"
# -s: keep pytest from capturing stderr — a GGML_ASSERT abort otherwise dies with
# its message trapped in the capture buffer, unrecoverable from the CI log.
# -rs: print the REASON for every skip. Most of this suite's coverage is opt-in on a
# model dir or a device being present, so "N skipped" alone cannot distinguish "this
# runner has no Vulkan device" from "the model cache silently missed" from "the Metal
# lane hit its paravirtual GPU" — all three are expected on some lane, and only the
# reasons say which one actually happened.
PYTHONPATH="$ROOT/python" SOKUJI_NATIVE_DIR="$BUILD/stage" "$PYTHON" -m pytest "$ROOT/python/tests" "$ROOT/tests/parity" -q -s -rs
( cd "$ROOT/python" && rm -rf dist && SOKUJI_NATIVE_PLAT="$PLAT" "$PYTHON" -m pip wheel . --no-deps -w dist )
ls -la "$ROOT/python/dist"
# Import the wheel we just built, from a clean interpreter, and print the device table.
# The wheel must report the lane that was asked for; a GPU backend that quietly failed to
# build would otherwise ship as a CPU-only wheel under a Vulkan/Metal name.
case "$LANE" in
    none)   WANT_LANE=cpu ;;
    vulkan) WANT_LANE=cpu-vulkan ;;
    metal)  WANT_LANE=metal ;;
    *)      echo "unknown lane: $LANE"; exit 1 ;;
esac
"$PYTHON" -m pip install -q --force-reinstall "$ROOT"/python/dist/*.whl
"$PYTHON" -c "import sys, sokuji_native as s; s.init(); ev = s.engine_versions(); lane = ev['lane']; assert lane == sys.argv[1], ('built lane', lane, 'wanted', sys.argv[1]); print(s.version(), ev, [(d.kind, d.description) for d in s.devices()])" "$WANT_LANE"
