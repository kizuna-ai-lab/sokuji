# sokuji-native

One native library for the Sokuji sidecar: **transcribe.cpp** (ASR), **llama.cpp**
(translation) and **audio.cpp** (TTS, six families) linked into `libsokuji_native`
behind the `sk_*` C ABI in `include/sokuji_native.h`, on top of one pristine upstream ggml
with dynamically loaded backends (CPU per-ISA modules, Vulkan on Linux/Windows, Metal on
Apple Silicon). Design: `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md`.
VAD lives in the renderer (a Web Worker running Silero VAD over ONNX Runtime), not here —
see Amendment A1 in the client-VAD-unification spec.

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
    SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage python -m pytest native/python/tests native/tests/parity -q

The package tests import `sokuji_native` from `native/python` (pytest `pythonpath`), never
from an installed wheel; `build.sh` / `build.ps1` run both suites against the fresh stage.

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
- `src/sk_internal.h` — internal-only helpers shared by the `sk_*.cpp` files (locking, the
  device table, `own_directory()`, the log sink); never installed.
- `src/sk_asr.cpp` — `sk_asr_load/capabilities/run/stream_open/stream_feed/stream_finalize/stream_close/unload`
  over transcribe.cpp.
- `src/sk_translate.cpp` — `sk_translate_load/chat/complete/unload` over llama.cpp.
- `python/` — the `sokuji_native` package; `_ffi.py` mirrors the header.
- `tests/` — CTest smoke and the parity comparator; `tests/wav.h` is the shared 16 kHz mono
  WAV reader (over transcribe.cpp's vendored `dr_wav.h`) used by `test_asr.cpp`.

## ASR (slice 2)

**ASR** — eight entry points, one model per (GGUF, device): `sk_asr_load` opens a GGUF and
returns capabilities (`languages`, `supports_streaming`, `arch`); `sk_asr_run` transcribes a
whole PCM buffer, polling `sk_text_cb(NULL, …)` between decode steps so the caller can cancel;
`sk_asr_stream_open/feed/finalize/close` is the incremental path — `stream_feed` returns the
committed/tentative text after each chunk, `stream_finalize` delivers the final full text and
ends streaming mode, returning the session to idle (the model itself stays loaded and can
open a new stream); `sk_asr_stream_close` still must be called to free the stream handle —
it also abandons an unfinalized stream early; a model has at most one open stream and
must outlive it. Python: `sokuji_native.asr_load()` returns an `AsrModel`
(`.run()`, `.open_stream()` → `AsrStream` with `.feed()`/`.finalize()`/`.close()`, `.unload()`).
The sidecar never imports `sokuji_native` directly — `sokuji_sidecar/native.py` is the one
door in, and `asr_backend.py`'s `NativeAsrBackend` / `NativeAsrStreamBackend` (registered as
`native_asr` / `native_asr_stream`) are what the catalog and `asr_engine.py` talk to.

CTest needs real models for `test_asr` (skips with exit code 77 when absent):

    curl -L -o ~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf https://huggingface.co/handy-computer/whisper-tiny-gguf/resolve/main/whisper-tiny-Q8_0.gguf
    curl -L -o ~/.cache/sokuji-native-tests/moonshine-streaming-tiny-Q8_0.gguf https://huggingface.co/handy-computer/moonshine-streaming-tiny-gguf/resolve/main/moonshine-streaming-tiny-Q8_0.gguf

    SK_TEST_ASR_GGUF=~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf \
    SK_TEST_ASR_STREAM_GGUF=~/.cache/sokuji-native-tests/moonshine-streaming-tiny-Q8_0.gguf \
    ctest --test-dir native/build/cpu --output-on-failure -R 'test_asr'

`SK_TEST_SAMPLE_WAV` is set by CMake to transcribe.cpp's vendored `samples/jfk.wav` (11 s,
"ask not what your country…"); it is not meant to be overridden by hand.

## Translation (slice 3)

**Translation** — four entry points, one loaded GGUF chat model per handle: `sk_translate_load`
opens a GGUF on a device (`NULL` = llama's own default placement); `sk_translate_chat` and
`sk_translate_complete` both funnel into one stateless greedy-decode loop that clears the KV
memory before every call, so a handle carries no conversation state between requests. Both
entry points stream UTF-8 token pieces through `sk_text_cb` as they are decoded (a piece may
split a multibyte character — concatenate before display) and cancel on the callback returning
false (`SK_ERR_CANCELLED`, stopped before the next decode step); `sk_translate_unload` frees the
sampler chain, context and model.

`sk_translate_chat` renders `sk_message[]` through the GGUF's own chat template
(`llama_chat_apply_template`, `add_ass=true`) and then appends `sk_gen_options.assistant_prefill`
verbatim — the mechanism for forcing an empty `<think></think>` block on Qwen3-family models to
kill their default thinking mode. A GGUF whose template the legacy (non-Jinja) formatter does
not recognise — `llama_model_chat_template` returns `NULL`, or `llama_chat_apply_template`
reports failure — fails with `SK_ERR_INVALID_ARGUMENT` ("chat template not supported by the
legacy formatter; render the prompt and use sk_translate_complete"); callers fall back to
`sk_translate_complete` with a self-rendered prompt. Python: `sokuji_native.translate_load()`
returns a `Translator` (`.chat()`, `.complete()`, `.unload()`).

CTest needs a real chat GGUF for `test_translate` (skips with exit code 77 when absent):

    curl -L -o ~/.cache/sokuji-native-tests/Qwen3-0.6B-Q8_0.gguf https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf

    SK_TEST_TRANSLATE_GGUF=~/.cache/sokuji-native-tests/Qwen3-0.6B-Q8_0.gguf \
    ctest --test-dir native/build/cpu --output-on-failure -R 'test_translate'

## Bumping a pin

1. Change the commit SHA (and the version string beside it) in `cmake/upstreams.cmake`.
2. Rebuild; if `patch_upstream.py` fails, the anchored text in `native/patches/<upstream>.json` moved — fix the spec.
3. Run the parity suite (slice 4 onward) — a bump that fails parity is not shipped.
4. Bump `project(sokuji_native VERSION …)` in `CMakeLists.txt` — the only place a version
   is written; the wheel's comes from the staged `contract.json` — and tag `native-vX.Y.Z`.
