#!/bin/bash
# Full run on the Ubuntu side of the RTX 4070 SUPER box (jiangzhuo@192.168.1.13 — the same
# hardware as the Windows box, only one OS is up at a time). usage: fleet_run_ubuntu.sh <label> <query-string>
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
label="$1"; qs="$2"
B=$(cd "$(dirname "$0")" && pwd)
GB10=http://192.168.1.19:8765
URL="$GB10/index.html?$qs"
scp -q -o BatchMode=yes run_page.py "$B/ubuntu_run_page.sh" jiangzhuo@192.168.1.13:sokuji-webgpu-spike/
ssh -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 jiangzhuo@192.168.1.13 "bash sokuji-webgpu-spike/ubuntu_run_page.sh '$URL' 1200" > "page-ubuntu-$label.log" 2>&1
grep -v '^STATUS' "page-ubuntu-$label.log" | grep -v '^FINAL' | cut -c1-700
