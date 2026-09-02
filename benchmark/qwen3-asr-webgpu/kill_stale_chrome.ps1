# Kill Chrome instances left behind by interrupted run_page sessions (they carry
# --remote-debugging-port on their command line; the user's own Chrome does not).
$stale = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|headless' -and $_.CommandLine -match 'remote-debugging-port' }
$n = ($stale | Measure-Object).Count
foreach ($p in $stale) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
"stale harness Chrome processes killed: $n"
