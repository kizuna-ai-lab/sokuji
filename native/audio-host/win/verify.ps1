# Acceptance test for sokuji-audio-host.exe (issue #335).
#
# Proves the three properties the whole feature rests on:
#   1. Isolation - capturing app A yields silence while app B plays.
#   2. Continuity - the stream keeps flowing at the right rate while the
#      target is silent, which is why nothing downstream fills gaps.
#   3. Target stability - the pid `--list` reports outlives playback, so the
#      tap does not die when a multi-process app recycles its audio child.
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

# --- Target stability across a multi-process application.
#
# A browser does not render audio from the process the user recognises: Chrome
# plays through a `--type=utility` audio service child, and that child is
# short-lived - Chrome recycles it whenever playback stops. A tap pointed at it
# dies with it ("target_gone"), and Sokuji answers a dead helper by falling back
# to whole-system capture while the picker still shows the application, so the
# user's whole desktop starts being translated with nothing on screen saying so.
# Measured on Chrome (Aug 2026): --list reported a utility child, killing it
# ended the capture, and the replacement child came back under a different pid.
#
# The shape is reproduced here without a browser: cmd.exe launches a parent
# powershell.exe, which launches a child powershell.exe that plays the tone -
# same image for parent and child, a different one above them, exactly a
# browser's tree. The reported pid must be the parent, and a tap on it must
# survive the child's death.
$encChild = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(
    "`$p = New-Object System.Media.SoundPlayer '$tone'; `$p.PlayLooping(); Start-Sleep -Seconds 60"))
$encParent = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(
    "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','$encChild'; Start-Sleep -Seconds 60"))
$launcher = Start-Process cmd -PassThru -WindowStyle Hidden -ArgumentList '/c', "powershell -NoProfile -EncodedCommand $encParent"
Start-Sleep -Seconds 3

$rootPid = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($launcher.Id) AND Name='powershell.exe'" |
    Select-Object -First 1).ProcessId
$childPid = $null
if ($rootPid) {
    $childPid = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$rootPid AND Name='powershell.exe'" |
        Select-Object -First 1).ProcessId
}
Write-Output ("TREE: root(parent)={0} audio-child={1}" -f $rootPid, $childPid)

$listedIds = @()
try { $listedIds = @((& $exe --list | ConvertFrom-Json) | ForEach-Object { $_.id }) } catch {}
Write-Output ("  --list ids: " + ($listedIds -join ', '))

$treeOut = Join-Path $env:TEMP 'sokuji_TREE.pcm'
$treeErr = Join-Path $env:TEMP 'sokuji_TREE.log'
$treeAlive = $false
$treePeak = 0
if ($rootPid -and $childPid) {
    $helper = Start-Process $exe -PassThru -NoNewWindow `
        -RedirectStandardOutput $treeOut -RedirectStandardError $treeErr `
        -ArgumentList '--target', ("pid:{0}" -f $rootPid)
    Start-Sleep -Seconds 2
    # Stand in for Chrome recycling its audio service mid-session.
    Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $treeAlive = -not $helper.HasExited
    Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    $treePeak = Get-Peak $treeOut
    Write-Output ("  tree capture: peak={0} alive-after-child-exit={1}" -f $treePeak, $treeAlive)
    Write-Output ("  stderr: " + ((Get-Content $treeErr -Raw -ErrorAction SilentlyContinue) -replace "`r`n", ' ').Trim())
}

foreach ($p in @($childPid, $rootPid, $launcher.Id)) {
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
}
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

Check 'lists-application-root' ($listedIds -contains ("pid:{0}" -f $rootPid)) `
    ("expected the parent pid {0} in --list; a browser's audio child is recycled and its pid dies with it" -f $rootPid)
Check 'hides-audio-child' (-not ($listedIds -contains ("pid:{0}" -f $childPid))) `
    ("the audio-holding child {0} must not be offered as a target" -f $childPid)
Check 'tree-capture-reaches-child' ($treePeak -gt 8000) `
    ("peak={0} capturing the parent while only the child played, expected >8000" -f $treePeak)
Check 'survives-audio-child-exit' ($treeAlive) `
    'the helper must outlive the audio child, or Sokuji silently widens to whole-system capture'

if ($ok) { Write-Output 'VERIFY OK'; exit 0 } else { Write-Output 'VERIFY FAILED'; exit 1 }
