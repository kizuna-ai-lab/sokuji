# Acceptance test for sokuji-audio-host.exe (issue #335).
#
# Proves the two properties the whole feature rests on:
#   1. Isolation - capturing app A yields silence while app B plays.
#   2. Continuity - the stream keeps flowing at the right rate while the
#      target is silent, which is why nothing downstream fills gaps.
#
# Run on the Windows box; it needs no interactive desktop.
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$exe = Join-Path $PSScriptRoot 'out\sokuji-audio-host.exe'
if (-not (Test-Path $exe)) { throw "not built: $exe" }

$tone = Join-Path $env:TEMP 'sokuji_tone.wav'

# 440 Hz at amplitude 12000, 44.1 kHz mono - deliberately NOT the 24 kHz capture
# rate, so a pass also proves AUTOCONVERTPCM resampling works.
$rate = 44100; $secs = 8; $n = $rate * $secs
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([char[]]'RIFF'); $bw.Write([int](36 + $n * 2)); $bw.Write([char[]]'WAVE')
$bw.Write([char[]]'fmt '); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]1)
$bw.Write([int]$rate); $bw.Write([int]($rate * 2)); $bw.Write([int16]2); $bw.Write([int16]16)
$bw.Write([char[]]'data'); $bw.Write([int]($n * 2))
for ($i = 0; $i -lt $n; $i++) { $bw.Write([int16]([math]::Sin(2 * [math]::PI * 440 * $i / $rate) * 12000)) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($tone, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

function Get-Peak([string]$path) {
    $b = [System.IO.File]::ReadAllBytes($path)
    $p = 0
    for ($i = 0; $i + 1 -lt $b.Length; $i += 2) {
        $v = [BitConverter]::ToInt16($b, $i)
        $a = [math]::Abs([int]$v)
        if ($a -gt $p) { $p = $a }
    }
    return $p
}

$noisy = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-Command', "(New-Object System.Media.SoundPlayer '$tone').PlaySync()")
$quiet = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-Command', 'Start-Sleep -Seconds 20')
Start-Sleep -Milliseconds 800

$results = @{}
foreach ($case in @(@{n = 'NOISY'; p = $noisy.Id }, @{n = 'QUIET'; p = $quiet.Id })) {
    $out = Join-Path $env:TEMP ("sokuji_{0}.pcm" -f $case.n)
    $err = Join-Path $env:TEMP ("sokuji_{0}.log" -f $case.n)
    $proc = Start-Process $exe -PassThru -NoNewWindow `
        -RedirectStandardOutput $out -RedirectStandardError $err `
        -ArgumentList '--target', ("pid:{0}" -f $case.p)
    Start-Sleep -Seconds 3
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400

    $len = (Get-Item $out).Length
    $peak = Get-Peak $out
    $results[$case.n] = @{ bytes = $len; peak = $peak }
    Write-Output ("{0}: bytes={1} peak={2}" -f $case.n, $len, $peak)
    Write-Output ("  stderr: " + ((Get-Content $err -Raw) -replace "`r`n", ' ').Trim())
}

foreach ($x in @($noisy, $quiet)) { Stop-Process -Id $x.Id -Force -ErrorAction SilentlyContinue }
Remove-Item $tone, "$env:TEMP\sokuji_*.pcm", "$env:TEMP\sokuji_*.log" -Force -ErrorAction SilentlyContinue

# 3 s of 24 kHz mono s16 = 144000 bytes. Allow for startup latency only.
$expected = 144000
$ok = $true
function Check([string]$name, [bool]$cond, [string]$detail) {
    if ($cond) { Write-Output "PASS $name - $detail" }
    else { Write-Output "FAIL $name - $detail"; $script:ok = $false }
}

Check 'noisy-captures-audio' ($results['NOISY'].peak -gt 8000) `
    ("peak={0}, expected >8000 (tone amplitude 12000)" -f $results['NOISY'].peak)
Check 'isolation' ($results['QUIET'].peak -le 2) `
    ("quiet-target peak={0}, expected <=2 while the other app played" -f $results['QUIET'].peak)
Check 'continuity-noisy' ([math]::Abs($results['NOISY'].bytes - $expected) -lt 6000) `
    ("bytes={0}, expected ~{1}" -f $results['NOISY'].bytes, $expected)
Check 'continuity-quiet' ([math]::Abs($results['QUIET'].bytes - $expected) -lt 6000) `
    ("bytes={0}, expected ~{1} even though the target was silent" -f $results['QUIET'].bytes, $expected)

if ($ok) { Write-Output 'VERIFY OK'; exit 0 } else { Write-Output 'VERIFY FAILED'; exit 1 }
