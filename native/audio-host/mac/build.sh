#!/bin/bash
# Build sokuji-audio-host for macOS and refresh the vendored copy.
#
# The committed binary under resources/bin is what the app loads; out/ is only
# the compiler's scratch output. Copying is part of the build, not a step to
# remember - the Windows helper lost a debugging round trip to exactly that gap.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p out
swiftc -O main.swift -o out/sokuji-audio-host

# Ad-hoc sign so the binary has a stable-enough identity to run; the real TCC
# grant is attributed to Sokuji.app, which spawns this helper.
codesign --force -s - out/sokuji-audio-host

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) DEST_DIR="../../../resources/bin/darwin-arm64" ;;
  x86_64) DEST_DIR="../../../resources/bin/darwin-x64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

mkdir -p "$DEST_DIR"
cp -f out/sokuji-audio-host "$DEST_DIR/sokuji-audio-host"
echo "BUILD OK - updated $DEST_DIR/sokuji-audio-host"
