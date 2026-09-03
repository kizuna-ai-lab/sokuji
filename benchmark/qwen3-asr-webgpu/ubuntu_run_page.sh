#!/bin/bash
# Box-side runner for a Linux desktop machine with an NVIDIA GPU (the Ubuntu side of the 4070
# box). Headless Chrome only ever gets a SwiftShader adapter there, whatever Vulkan/ANGLE flags
# are passed, so the page is run in a real Chrome window on the box's logged-in X session
# (found via /tmp/.X11-unix, GDM's Xauthority), which yields the NVIDIA adapter with shader-f16.
# usage: ubuntu_run_page.sh <url> [timeoutSec]   (expects ~/sokuji-webgpu-spike/{venv,run_page.py})
set -u
URL="$1"; TO="${2:-1200}"
cd ~/sokuji-webgpu-spike || exit 1
pkill -f -- '--remote-debugging-port' 2>/dev/null; sleep 1
D=$(ls /tmp/.X11-unix/ 2>/dev/null | head -1 | tr -d X)
[ -z "$D" ] && { echo "fatal: no X display on this box"; exit 3; }
XA=$(ls /run/user/$(id -u)/gdm/Xauthority ~/.Xauthority 2>/dev/null | head -1)
ORIGIN=$(echo "$URL" | sed -E 's#^(https?://[^/]+).*#\1#')
NO_HEADLESS=1 DISPLAY=":$D" XAUTHORITY="$XA" venv/bin/python run_page.py /usr/bin/google-chrome "$URL" "$TO" \
  --enable-features=Vulkan,WebGPU "--unsafely-treat-insecure-origin-as-secure=$ORIGIN"
