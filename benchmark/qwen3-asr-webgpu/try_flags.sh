#!/bin/bash
# Probe which Chromium binary + flag set yields a hardware WebGPU adapter on this box.
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
PW=$(ls -d /home/jiangzhuo/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1)
URL="http://127.0.0.1:8765/probe.html"
run() {
  local label="$1"; shift
  echo "== $label"
  node run_page.mjs "$@" 2>&1 | grep -E '^RESULT|TIMEOUT|no CDP' | cut -c1-400
}
run "pw default flags" "$PW" "$URL" 40
run "pw +angle features" "$PW" "$URL" 40 --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,SkiaGraphite
run "pw egl" "$PW" "$URL" 40 --use-gl=egl --use-angle=default
run "pw swiftshader" "$PW" "$URL" 40 --enable-unsafe-swiftshader --use-angle=swiftshader
run "snap default" /snap/bin/chromium "$URL" 40
run "snap +angle features" /snap/bin/chromium "$URL" 40 --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE
echo "== vulkaninfo"; (vulkaninfo --summary 2>/dev/null | grep -E 'GPU id|deviceName|driverName|apiVersion' | head -8) || echo "no vulkaninfo"
ls /usr/share/vulkan/icd.d/ 2>/dev/null; file "$PW" | cut -c1-120
