@echo off
REM Build sokuji-audio-host.exe. Requires VS Build Tools with the C++ workload.
REM Deliberately a single cl invocation: no CMake, no NuGet, no WIL.
setlocal

REM Locate the compiler. Three cases, in order:
REM   1. cl is already on PATH - a developer's VS prompt, or CI after
REM      ilammy/msvc-dev-cmd. Nothing to set up.
REM   2. vswhere finds an installation - any edition, any year. The runners
REM      carry VS 2022 Enterprise, not the 2019 Build Tools this used to pin,
REM      so a hardcoded path builds on one machine and fails on the other.
REM   3. Neither - fail loudly rather than half-build.
where cl >nul 2>&1
if not errorlevel 1 goto :compile

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo ERROR: no cl on PATH and vswhere not found; install VS Build Tools with the C++ workload
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH (
  echo ERROR: vswhere found no installation with the C++ toolset
  exit /b 1
)
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo ERROR: vcvars64.bat failed
  exit /b 1
)

:compile
cd /d "%~dp0"
if not exist out mkdir out

REM /utf-8 pins the source charset. Without it MSVC decodes the file with the
REM machine's ANSI code page (932 on the Japanese-locale test box) and warns
REM C4819, which would silently mangle any non-ASCII literal added later.
cl /nologo /EHsc /std:c++17 /O2 /W3 /utf-8 main.cpp /Fo:out\ ^
   /link ole32.lib user32.lib mmdevapi.lib /out:out\sokuji-audio-host.exe

if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

REM Copy into resources\bin, which is what the app loads and what both packagers
REM ship wholesale. The binary is not committed - this build produces it, both
REM locally and in CI before packaging.
set DEST=%~dp0..\..\..\resources\bin\win32-x64
if not exist "%DEST%" mkdir "%DEST%"
copy /Y out\sokuji-audio-host.exe "%DEST%\sokuji-audio-host.exe" >nul
if errorlevel 1 (
  echo BUILD OK but FAILED to update %DEST%
  exit /b 1
)
echo BUILD OK - updated %DEST%\sokuji-audio-host.exe
exit /b 0
