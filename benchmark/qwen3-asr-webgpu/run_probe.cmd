@echo off
rem usage: run_probe.cmd <url> <timeoutSec>
node --version
set PROFILE_DIR=%TEMP%\spike-chrome-profile
node "%~dp0run_page.mjs" "C:\Program Files\Google\Chrome\Application\chrome.exe" %1 %2 --unsafely-treat-insecure-origin-as-secure=http://192.168.1.19:8765
