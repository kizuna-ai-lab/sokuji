#!/bin/bash
# Build sokuji-audio-host for macOS and refresh the vendored copy.
#
# The committed binary under resources/bin is what the app loads; out/ is only
# the compiler's scratch output. Copying is part of the build, not a step to
# remember - the Windows helper lost a debugging round trip to exactly that gap.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p out

# Build both slices from whichever Mac is doing the build: Sokuji ships an
# unnotarised app that users run on both architectures, and cross-compiling here
# is free, whereas keeping an Intel machine around to produce the other half is
# not. macOS 14.2 is the floor for Core Audio process taps.
build_slice() {
  local target="$1" dest="$2"
  swiftc -O -target "$target" main.swift -o "out/sokuji-audio-host-$dest"
  # Ad-hoc sign so the binary runs; the real TCC grant is attributed to
  # Sokuji.app, which spawns this helper.
  codesign --force -s - "out/sokuji-audio-host-$dest"
  mkdir -p "../../../resources/bin/$dest"
  cp -f "out/sokuji-audio-host-$dest" "../../../resources/bin/$dest/sokuji-audio-host"
  echo "  updated resources/bin/$dest/sokuji-audio-host"
}

build_slice arm64-apple-macosx14.2  darwin-arm64
build_slice x86_64-apple-macosx14.2 darwin-x64
echo "BUILD OK"
