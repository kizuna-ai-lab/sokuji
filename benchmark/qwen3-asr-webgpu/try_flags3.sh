#!/bin/bash
# Third round on GB10: vulkan-surface workarounds.
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
PW=$(ls -d /home/jiangzhuo/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1)
URL="http://127.0.0.1:8765/probe.html"
run() { local label="$1"; shift; echo "== $label"; SHOW_GPU_LOG=1 node run_page.mjs "$@" 2>&1 | grep -E '^RESULT|TIMEOUT|no CDP|ERROR|vulkan' | cut -c1-260 | head -6; }
run "disable-vulkan-surface" "$PW" "$URL" 40 --disable-vulkan-surface
run "angle vulkan + use-gl=angle + ozone headless" "$PW" "$URL" 40 --use-gl=angle --ozone-platform=headless --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan --disable-vulkan-surface
run "use-vulkan=native" "$PW" "$URL" 40 --use-vulkan=native --disable-vulkan-surface --enable-features=Vulkan,WebGPU
run "no vulkan feature, dawn only" "$PW" "$URL" 40 --disable-features=Vulkan --use-gl=egl
run "webgpu-adapter default + dawn backend vulkan" "$PW" "$URL" 40 --use-webgpu-adapter=default --enable-dawn-backend-validation=disabled --disable-vulkan-surface
