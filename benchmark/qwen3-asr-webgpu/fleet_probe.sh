#!/bin/bash
# Which browsers / runtimes do the fleet boxes have? (read-only probe)
echo "== windows 192.168.1.13"
ssh -o BatchMode=yes -o ConnectTimeout=6 jiang@192.168.1.13 'powershell -NoProfile -Command "Test-Path \"C:\Program Files\Google\Chrome\Application\chrome.exe\"; Test-Path \"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe\"; (Get-Command node -ErrorAction SilentlyContinue).Source; (Get-Command python -ErrorAction SilentlyContinue).Source; (Get-CimInstance Win32_VideoController).Name; (Get-Item \"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe\" -ErrorAction SilentlyContinue).VersionInfo.ProductVersion"' 2>&1 | head -10
echo "== mac 192.168.1.15"
ssh -o BatchMode=yes -o ConnectTimeout=6 jiangzhuo@192.168.1.15 'ls /Applications | grep -i -E "chrome|edge|chromium|brave"; export PATH=/opt/homebrew/bin:$PATH; which node npx python3; ls ~/Library/Caches/ms-playwright 2>/dev/null | head -3; sw_vers -productVersion; "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version 2>/dev/null' 2>&1 | head -10
