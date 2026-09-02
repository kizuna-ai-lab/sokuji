#!/bin/bash
# Copy the runners to the fleet boxes and probe WebGPU in headless Chrome there.
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp || exit 1
GB10=http://192.168.1.19:8765
echo "== windows: copy + probe"
scp -q -o BatchMode=yes run_page.mjs run_probe.cmd jiang@192.168.1.13:sokuji-vulkan-probe/ && echo copied
ssh -o BatchMode=yes jiang@192.168.1.13 "sokuji-vulkan-probe\\run_probe.cmd $GB10/probe.html 60" 2>&1 | grep -E 'RESULT|TIMEOUT|no CDP|^v[0-9]' | cut -c1-400
echo "== mac: copy + venv + probe"
ssh -o BatchMode=yes jiangzhuo@192.168.1.15 'mkdir -p ~/sokuji-webgpu-spike' && scp -q -o BatchMode=yes run_page.py jiangzhuo@192.168.1.15:sokuji-webgpu-spike/ && echo copied
ssh -o BatchMode=yes jiangzhuo@192.168.1.15 'export PATH=/opt/homebrew/bin:$PATH; cd ~/sokuji-webgpu-spike && ( [ -x venv/bin/python ] || python3 -m venv venv ) && venv/bin/pip install -q websocket-client && venv/bin/python run_page.py "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" '"$GB10"'/probe.html 60' 2>&1 | grep -E 'RESULT|TIMEOUT|no CDP|Error' | cut -c1-400
