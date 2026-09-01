#!/bin/bash
# Fourth round on GB10: GPU-process sandbox / in-process variants, headless.
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
PW=$(ls -d /home/jiangzhuo/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1)
URL="http://127.0.0.1:8765/probe.html"
run() { local label="$1"; shift; echo "== $label"; SHOW_GPU_LOG=1 node run_page.mjs "$@" 2>&1 | grep -E '^RESULT|ERROR|FATAL' | cut -c1-230 | head -4; }
run "native vulkan + disable-gpu-sandbox" "$PW" "$URL" 40 --use-vulkan=native --disable-vulkan-surface --disable-gpu-sandbox
run "native vulkan + in-process-gpu" "$PW" "$URL" 40 --use-vulkan=native --disable-vulkan-surface --in-process-gpu
run "native vulkan + gl=angle" "$PW" "$URL" 40 --use-vulkan=native --disable-vulkan-surface --use-gl=angle --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,WebGPU
run "native vulkan + no dev-shm flag + swiftshader off" "$PW" "$URL" 40 --use-vulkan=native --disable-vulkan-surface --disable-software-rasterizer
mkdir -p /home/jiangzhuo/tmp-spike-chrome
run "snap + native vulkan" /snap/bin/chromium "$URL" 60 --use-vulkan=native --disable-vulkan-surface
