#!/bin/bash
# Full int4 run on the Windows RTX 4070 SUPER box. usage: fleet_run_win.sh <label> <query-string>
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
label="$1"; qs="$2"
URL="http://192.168.1.19:8765/index.html?$qs"
scp -q -o BatchMode=yes run_page.mjs run_probe.cmd jiang@192.168.1.13:sokuji-vulkan-probe/
ssh -o BatchMode=yes jiang@192.168.1.13 "sokuji-vulkan-probe\\run_probe.cmd \"$URL\" 1200" > "page-win-$label.log" 2>&1
grep -v '^STATUS' "page-win-$label.log" | grep -v '^FINAL' | cut -c1-700
