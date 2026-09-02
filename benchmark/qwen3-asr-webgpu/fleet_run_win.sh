#!/bin/bash
# Full int4 run on the Windows RTX 4070 SUPER box. usage: fleet_run_win.sh <label> <query-string>
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
label="$1"; qs="$2"
URL="http://192.168.1.19:8765/index.html?$qs"
scp -q -o BatchMode=yes run_page.mjs run_probe.cmd kill_stale_chrome.ps1 jiang@192.168.1.13:sokuji-vulkan-probe/ || exit 1
# An interrupted run_page leaves its Chrome (and the model in its GPU process) behind; kill
# those first or they contaminate memory measurements (see kill_stale_chrome.ps1).
ssh -o BatchMode=yes jiang@192.168.1.13 "powershell -NoProfile -ExecutionPolicy Bypass -File sokuji-vulkan-probe\\kill_stale_chrome.ps1"
# Chrome 152 + NVIDIA 610.88 on this box: requestAdapter() intermittently returns null (about
# every other headless launch — probe.html alternates nvidia / null), which surfaces as
# "WebGPU adapter unavailable" or ORT's "Failed to get GPU adapter". Retry only that failure;
# any other failure (SSH, run_probe.cmd) ends the run with its own status, and three adapter
# failures in a row end it with status 1.
status=1
for attempt in 1 2 3; do
  ssh -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 jiang@192.168.1.13 "sokuji-vulkan-probe\\run_probe.cmd \"$URL\" 1200" > "page-win-$label.log" 2>&1
  status=$?
  if ! grep -qE 'adapter unavailable|Failed to get GPU adapter' "page-win-$label.log"; then
    break
  fi
  status=1
  [ "$attempt" -lt 3 ] || break
  echo "attempt $attempt: no WebGPU adapter, retrying in 8 s"; sleep 8
done
grep -v '^STATUS' "page-win-$label.log" | grep -v '^FINAL' | cut -c1-700
exit "$status"
