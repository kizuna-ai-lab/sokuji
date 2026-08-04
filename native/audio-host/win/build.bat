@echo off
REM Build sokuji-audio-host.exe. Requires VS Build Tools with the C++ workload.
REM Deliberately a single cl invocation: no CMake, no NuGet, no WIL.
setlocal

set VCVARS="C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist %VCVARS% (
  echo ERROR: VS 2019 Build Tools not found at %VCVARS%
  exit /b 1
)

call %VCVARS% >nul
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
echo BUILD OK
exit /b 0
