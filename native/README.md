# sokuji-native

One native library for the Sokuji sidecar: **transcribe.cpp** (ASR), **llama.cpp**
(translation) and **audio.cpp** (TTS + VAD, six families) linked into `libsokuji_native`
behind the `sk_*` C ABI in `include/sokuji_native.h`, on top of one pristine upstream ggml
with dynamically loaded backends (CPU per-ISA modules, Vulkan on Linux/Windows, Metal on
Apple Silicon). Design: `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md`.

## Build

    native/ci/build.sh vulkan manylinux_2_39_x86_64     # Linux/macOS: <none|vulkan|metal> <wheel plat tag>
    native\ci\build.ps1 -Lane vulkan -Plat win_amd64    # Windows

Requires CMake ≥ 3.28, a C++17 compiler, Python 3.10+, and for the Vulkan lane
`libvulkan-dev` + `glslc` (Ubuntu) or the LunarG SDK (Windows). Output: a wheel in
`native/python/dist/`; the staged binaries in `native/build/<lane>/stage/`
(`native/build/cpu/stage/` for `none`).

Developer loop without a wheel:

    cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j
    cmake --install native/build/cpu --prefix native/build/cpu/stage --component sokuji
    SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage python -c "import sokuji_native as s; s.init(); print(s.devices())"

The `--component sokuji` flag is mandatory: without it the upstreams' own install rules dump headers and static libs into the stage.

## Layout

- `cmake/upstreams.cmake` — the four commit pins and the JSON patch specs in `native/patches/`:
  - `ggml-drop-sme.json` — drops the Linux armv9.2 +sme CPU variants when the compiler cannot build them
  - `ggml-drop-sme-apple.json` — drops the apple_m4 (+sme) CPU variant; Apple clang cannot build it
  - `transcribe.cpp.json` — makes transcribe.cpp reuse our ggml target instead of building its own copy
  - `audio.cpp.json` — makes audio.cpp reuse our ggml target instead of building its own copy, and
    keeps its trace-log formatter off `std::to_chars(double)` (macOS 13.3+; the wheels target 11.0)
- `src/audiocpp_compat.h` — the eight symbols audio.cpp's fork adds to ggml, provided on
  upstream ggml. Two of them reproduce the fork's graph node for node rather than
  aliasing a nearby upstream call; read the header comment before touching it.
- `src/sokuji_native.map` / `src/sokuji_native.exports` — the exported-symbol lists
  (Linux / macOS) that keep everything but `sk_*` inside the library.
- `ci/check_linux_deps.py` — run by `build.sh` on Linux before the wheel is built: every
  staged shared object may depend only on glibc/libstdc++/libgcc, the system Vulkan loader
  and its siblings, and may reference no glibc symbol newer than the wheel tag's floor.
  (The Vulkan loader is external by design, which is why `auditwheel` is not the gate.)
- `src/sk_selftest.cpp` — `sk_audio_families()`, reporting every family compiled in (companions such as `marblenet_vad` / `moss_tts_local` ride along with the selected ones; the sidecar catalog decides what is supported).
- `python/` — the `sokuji_native` package; `_ffi.py` mirrors the header.
- `tests/` — CTest smoke and the parity comparator.

## Bumping a pin

1. Change the commit SHA (and the version string beside it) in `cmake/upstreams.cmake`.
2. Rebuild; if `patch_upstream.py` fails, the anchored text in `native/patches/<upstream>.json` moved — fix the spec.
3. Run the parity suite (slice 4 onward) — a bump that fails parity is not shipped.
4. Bump `project(sokuji_native VERSION …)` in `CMakeLists.txt` — the only place a version
   is written; the wheel's comes from the staged `contract.json` — and tag `native-vX.Y.Z`.
