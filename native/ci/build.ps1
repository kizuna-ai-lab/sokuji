# Windows twin of build.sh. Usage: native\ci\build.ps1 -Lane vulkan -Plat win_amd64
# -Plat is kept for symmetry with build.sh (whose tag names the Linux floor); nothing here reads it.
param([Parameter(Mandatory)][string]$Lane, [Parameter(Mandatory)][string]$Plat)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }
# Lane `none` reuses the pre-existing `build\cpu` tree (the developer default from before
# this script existed) instead of building a fresh `build\none` from scratch — ggml plus
# all three engines takes ~30 minutes. CI lane names stay as-is (build\vulkan, build\metal).
$BuildDirName = if ($Lane -eq "none") { "cpu" } else { $Lane }
$Build = Join-Path $Root "build\$BuildDirName"

# Quoted on purpose: PowerShell hands a bare `-DSOKUJI_GPU=$Lane` token to native commands
# verbatim, without expanding $Lane (dry run 3 configured with the literal string "$Lane").
cmake -S $Root -B $Build -G "Visual Studio 17 2022" -A x64 "-DSOKUJI_GPU=$Lane"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
cmake --build $Build --config Release --parallel
if ($LASTEXITCODE) { exit $LASTEXITCODE }
ctest --test-dir $Build -C Release --output-on-failure
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# Op recordings (spec A §3.2, README's "Bumping a pin" checklist): re-record every family
# whose SK_TEST_* model is present and diff against the shipped src\ops\*.ops. Always its own
# CPU-only build\record tree (SOKUJI_GPU=none) regardless of this script's own Lane: the
# asr/translate recordings are backend-agnostic and gate here; the TTS recordings were taken
# on a real GPU (tests\test_ops_coverage.cpp's F2 note, spec A §3.2's host=1 rule — audio.cpp
# builds a different graph on a host backend) and are checked on the fleet via a
# build\record-vk tree, so this tree prints SKIPPED for them.
#
# This is a SECOND full configure+build of ggml and all three engines, so it only runs when it
# can actually check something: test_ops_coverage hard-requires SK_TEST_TTS_SUPERTONIC_DIR
# once any model is present (rc 1, not a skip — the clone-only families' reference clip comes
# from it), and the variable doubles as the "is the test cache populated at all" probe, so an
# unset one means the whole tree would be built to prove nothing.
# SOKUJI_BUILD_RECORD=0 forces it off even when the models are present.
$RecordBuild = Join-Path $Root "build\record"
if (-not $env:SK_TEST_TTS_SUPERTONIC_DIR) {
    Write-Host "ci/build.ps1: skipping the op-recording drift gate - SK_TEST_TTS_SUPERTONIC_DIR is not set (no cached TTS models)."
} elseif ($env:SOKUJI_BUILD_RECORD -eq "0") {
    Write-Host "ci/build.ps1: skipping the op-recording drift gate - SOKUJI_BUILD_RECORD=0."
} else {
    cmake -S $Root -B $RecordBuild -G "Visual Studio 17 2022" -A x64 "-DSOKUJI_GPU=none" "-DSOKUJI_RECORD_OPS=ON"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    cmake --build $RecordBuild --config Release --parallel
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    ctest --test-dir $RecordBuild -C Release -R test_ops_coverage --output-on-failure
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
# A fresh stage per run; the wheel's former inputs (python\sokuji_native\_native, python\build,
# python\dist; no wheel is made since native-v1.4.0) are cleared too, so nothing reads a stale copy.
Remove-Item -Recurse -Force "$Build\stage", "$Root\python\sokuji_native\_native" -ErrorAction SilentlyContinue
foreach ($d in "$Root\python\build", "$Root\python\dist") { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
# Only the sokuji component: the fetched upstreams carry their own install() rules
# (headers, static libs, cmake configs) in the default component, which must not run.
cmake --install $Build --config Release --prefix "$Build\stage" --component sokuji
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# The stage must report the lane that was asked for (build.sh has the reason).
$WantLane = @{ none = "cpu"; vulkan = "cpu-vulkan"; metal = "metal" }[$Lane]
$env:PYTHONPATH = "$Root\python"
$env:SOKUJI_NATIVE_DIR = "$Build\stage"
& $Python -c "import sys, sokuji_native as s; s.init(); ev = s.engine_versions(); lane = ev['lane']; assert lane == sys.argv[1], ('built lane', lane, 'wanted', sys.argv[1]); print(s.version(), ev, [(d.kind, d.description) for d in s.devices()])" $WantLane
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Remove-Item Env:PYTHONPATH, Env:SOKUJI_NATIVE_DIR
# The binding's own tests, against the SOURCE package (PYTHONPATH) and this stage — not
# against whatever sokuji_native happens to be installed in this interpreter.
# zstandard: make_app_archive.py and its test (tests\test_make_app_archive.py).
& $Python -m pip install -q pytest numpy soundfile zstandard
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$env:PYTHONPATH = "$Root\python"
$env:SOKUJI_NATIVE_DIR = "$Build\stage"
$env:SK_TEST_SAMPLE_WAV = "$Build\_deps\transcribe-src\samples\jfk.wav"
# -s mirrors build.sh: keep native abort messages out of pytest's capture buffer.
# -rs likewise: print every skip's reason, so an opt-in test that vanished because a model
# dir or a device is missing says so instead of hiding in a bare "N skipped".
& $Python -m pytest "$Root\python\tests" "$Root\tests\parity" "$Root\tests\test_make_app_archive.py" "$Root\tests\test_vendored_tree.py" -q -s -rs
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Remove-Item Env:PYTHONPATH, Env:SOKUJI_NATIVE_DIR, Env:SK_TEST_SAMPLE_WAV
# The app archive: the same stage plus the Node addon and NOTICES.txt, packed as
# sokuji-native-<sku>-v<version>.tar.zst for the app to unpack (make_app_archive.py's docstring
# has the layout). Only when SOKUJI_SKU names the platform (CI sets it from the matrix), so a
# developer's build.ps1 run makes no archive unless asked. Its own stage: the test stage stays as is.
# The addon itself was already tested by ctest (test_node_addon) against the build tree; the
# workflow loads the unpacked archive under Electron.
if ($env:SOKUJI_SKU) {
    $AppStage = "$Build\app-stage"
    $ArchiveDir = "$Root\build\archive"
    $VersionLine = Select-String -Path "$Root\CMakeLists.txt" -Pattern '^project\(sokuji_native VERSION ([0-9.]+)' | Select-Object -First 1
    if (-not $VersionLine) { Write-Host "ci/build.ps1: cannot read the project version from CMakeLists.txt"; exit 1 }
    $AppVersion = $VersionLine.Matches[0].Groups[1].Value
    Remove-Item -Recurse -Force $AppStage -ErrorAction SilentlyContinue
    cmake --install $Build --config Release --prefix $AppStage --component sokuji
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    cmake --install $Build --config Release --prefix $AppStage --component sokuji_node
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & $Python "$Root\ci\make_app_archive.py" $AppStage $env:SOKUJI_SKU $AppVersion $ArchiveDir
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    Get-ChildItem $ArchiveDir
}
