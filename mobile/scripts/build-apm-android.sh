#!/usr/bin/env bash
# Builds webrtc-audio-processing for Android and installs the static libraries
# and headers into modules/audio-capture/android/libs. Needs git, meson, ninja
# and the NDK. The result is committed; rerun only to change the version.
set -euo pipefail

VERSION=v2.1
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../modules/audio-capture/android/libs"
NDK="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/$(ls "$HOME/Library/Android/sdk/ndk" | tail -1)}"
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet --depth 1 --branch "$VERSION" \
  https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing.git "$WORK/src"
rm -rf "$OUT"
mkdir -p "$OUT"

build() {
  local abi=$1 ini=$2 neon=$3
  sed "s|@TOOLCHAIN@|$TOOLCHAIN|" "$HERE/$ini" > "$WORK/$abi.ini"
  (cd "$WORK/src" && meson setup "build-$abi" --cross-file "$WORK/$abi.ini" \
    --prefix "$WORK/install-$abi" -Ddefault_library=static -Dbuildtype=release "-Dneon=$neon")
  # `auto` builds without NEON and costs twice the CPU: refuse it.
  if [ "$abi" = arm64-v8a ] && ! grep -q WEBRTC_HAS_NEON "$WORK/src/build-$abi/compile_commands.json"; then
    echo "NEON is off for $abi" >&2
    exit 1
  fi
  ninja -C "$WORK/src/build-$abi" install
  mkdir -p "$OUT/$abi"
  cp "$WORK/install-$abi"/lib/libwebrtc-audio-processing-2.a "$OUT/$abi/"
  # Meson leaves abseil as thin archives, which only point at the build tree.
  find "$WORK/src/build-$abi/subprojects" -name 'libabsl_*.a' | while read -r thin; do
    (cd "$(dirname "$thin")" && "$TOOLCHAIN/llvm-ar" t "$thin" | xargs "$TOOLCHAIN/llvm-ar" qcs "$OUT/$abi/$(basename "$thin")")
  done
}

build arm64-v8a android-arm64.ini enabled
build x86_64 android-x86_64.ini disabled

cp -R "$WORK/install-arm64-v8a/include/webrtc-audio-processing-2" "$OUT/include"
cp -R "$WORK"/src/subprojects/abseil-cpp-*/absl "$OUT/include/absl"
find "$OUT/include/absl" -type f ! -name '*.h' ! -name '*.inc' -delete
cp "$WORK/src/COPYING" "$OUT/../NOTICE-webrtc.txt"
cat "$WORK"/src/subprojects/abseil-cpp-*/LICENSE > "$OUT/../NOTICE-abseil.txt"
