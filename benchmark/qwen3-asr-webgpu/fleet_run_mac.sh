#!/bin/bash
# Full run on the Mac mini M4. usage: fleet_run_mac.sh <label> <query-string>
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
label="$1"; qs="$2"
GB10=http://192.168.1.19:8765
URL="$GB10/index.html?$qs"
scp -q -o BatchMode=yes run_page.py jiangzhuo@192.168.1.15:sokuji-webgpu-spike/
# An interrupted run_page.py leaves its Chrome (and the model in its GPU process) behind;
# kill those first or they contaminate memory measurements. Only harness Chromes carry
# --remote-debugging-port, the user's own Chrome does not.
ssh -o BatchMode=yes jiangzhuo@192.168.1.15 "pkill -f -- '--remote-debugging-port' 2>/dev/null; true"
ssh -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 jiangzhuo@192.168.1.15 "cd ~/sokuji-webgpu-spike && venv/bin/python run_page.py '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' '$URL' 1200 --unsafely-treat-insecure-origin-as-secure=$GB10" > "page-mac-$label.log" 2>&1
grep -v '^STATUS' "page-mac-$label.log" | grep -v '^FINAL' | cut -c1-700
