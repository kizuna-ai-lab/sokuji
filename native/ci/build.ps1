# Windows twin of build.sh. Usage: native\ci\build.ps1 -Lane vulkan -Plat win_amd64
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
Remove-Item -Recurse -Force "$Build\stage", "$Root\python\sokuji_native\_native" -ErrorAction SilentlyContinue
# Only the sokuji component: the fetched upstreams carry their own install() rules
# (headers, static libs, cmake configs) in the default component, which must not run.
cmake --install $Build --config Release --prefix "$Build\stage" --component sokuji
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Copy-Item -Recurse "$Build\stage" "$Root\python\sokuji_native\_native"
# The binding's own tests, against the SOURCE package (PYTHONPATH) and this stage — not
# against whatever sokuji_native happens to be installed in this interpreter.
& $Python -m pip install -q pytest numpy
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$env:PYTHONPATH = "$Root\python"
$env:SOKUJI_NATIVE_DIR = "$Build\stage"
& $Python -m pytest "$Root\python\tests" "$Root\tests\parity" -q
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Remove-Item Env:PYTHONPATH, Env:SOKUJI_NATIVE_DIR
Push-Location "$Root\python"
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
$env:SOKUJI_NATIVE_PLAT = $Plat
& $Python -m pip wheel . --no-deps -w dist
if ($LASTEXITCODE) { Pop-Location; exit $LASTEXITCODE }
Pop-Location
Get-ChildItem "$Root\python\dist"
& $Python -m pip install -q --force-reinstall (Get-ChildItem "$Root\python\dist\*.whl").FullName
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# The wheel must report the lane that was asked for; a GPU backend that quietly failed to
# build would otherwise ship as a CPU-only wheel under a Vulkan/Metal name.
$WantLane = @{ none = "cpu"; vulkan = "cpu-vulkan"; metal = "metal" }[$Lane]
& $Python -c "import sys, sokuji_native as s; s.init(); ev = s.engine_versions(); lane = ev['lane']; assert lane == sys.argv[1], ('built lane', lane, 'wanted', sys.argv[1]); print(s.version(), ev, [(d.kind, d.description) for d in s.devices()])" $WantLane
if ($LASTEXITCODE) { exit $LASTEXITCODE }
