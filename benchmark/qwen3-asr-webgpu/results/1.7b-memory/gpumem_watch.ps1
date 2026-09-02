# Sample per-process dedicated GPU memory (the counter Task Manager shows) every 0.5 s for
# <seconds>. Writes one line per sample to gpumem_series.csv (epoch-ms, sum over chrome
# processes MB, largest chrome process MB) and prints the peaks at the end.
# usage: powershell -File gpumem_watch.ps1 <seconds> [csv path]
param([int]$Seconds = 120, [string]$Csv = "$PSScriptRoot\gpumem_series.csv")
$peakSum = 0; $peakOne = 0; $peakOneName = ''; $n = 0; $errors = 0; $lastError = ''
't_ms,sum_mb,largest_mb' | Set-Content -Path $Csv
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  try {
    $s = (Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples
    $chrome = @()
    foreach ($c in $s) {
      if ($c.InstanceName -match '^pid_(\d+)_') {
        $p = Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -match 'chrome|headless') { $chrome += $c }
      }
    }
    $sum = ($chrome | Measure-Object CookedValue -Sum).Sum
    $one = 0
    foreach ($c in $chrome) { if ($c.CookedValue -gt $one) { $one = $c.CookedValue }; if ($c.CookedValue -gt $peakOne) { $peakOne = $c.CookedValue; $peakOneName = $c.InstanceName } }
    if ($sum -gt $peakSum) { $peakSum = $sum }
    $t = [int64]((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
    ('{0},{1:F0},{2:F0}' -f $t, ($sum/1MB), ($one/1MB)) | Add-Content -Path $Csv
    $n++
  } catch {
    # A failed counter read or CSV append is a lost sample, not a measurement of 0 MB.
    $lastError = $_.Exception.Message
    $errors++
  }
  Start-Sleep -Milliseconds 500
}
if ($errors -gt 0) { Write-Warning ('{0} samples failed; last error: {1}' -f $errors, $lastError) }
if ($n -eq 0) { Write-Error 'no sample succeeded'; exit 1 }
'{0} samples; peak chrome dedicated GPU memory: sum {1:N0} MB, largest process {2:N0} MB ({3})' -f $n, ($peakSum/1MB), ($peakOne/1MB), $peakOneName
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
