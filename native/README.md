# sokuji-native

One native library for the Sokuji sidecar: **transcribe.cpp** (ASR), **llama.cpp**
(translation) and **audio.cpp** (TTS, five families: moss_tts_nano, qwen3_tts, omnivoice,
pocket_tts, supertonic) linked into `libsokuji_native`
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
- `src/sk_tts.cpp` — `sk_tts_load/capabilities/presets/set_voice/set_preset/synth/unload`
  over audio.cpp.
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

## TTS (slice 4)

**TTS** — seven entry points, one loaded model per handle, over audio.cpp's five kept
families (`moss_tts_nano`, `qwen3_tts`, `omnivoice`, `pocket_tts`, `supertonic`):
`sk_tts_load` opens a model with a REQUIRED `family` (audio.cpp's `family_hint` — always
pass it explicitly, family auto-detection is fragile and order-dependent) and creates one
long-lived session at load time, offline or streaming depending on the family
(`sk_tts_capabilities().streaming`: only `omnivoice` and `supertonic` stream, the other
three are offline-only); `sk_tts_capabilities` reports streaming/clones/transcript_required
and the family's default sample rate (48000 moss / 24000 qwen3+omnivoice+pocket / 44100
supertonic — always read the rate off each `sk_audio_cb` call too, these are technically
config-driven per checkpoint); `sk_tts_presets` lists named preset voices (supertonic's
fixed `M1`-`M5`/`F1`-`F5` style set, or pocket_tts's `embeddings/*.safetensors` — the other
three families have no enumerable presets and return zero names); `sk_tts_set_voice` stores
a reference clip (+ optional transcript, mandatory for `omnivoice`) and `sk_tts_set_preset`
stores a preset id — both apply to every subsequent `sk_tts_synth` call on the handle until
the other is set (each clears the other); `sk_tts_synth` runs greedy/deterministic synthesis
(`seed=0`, `do_sample=false`, always) and delivers f32 interleaved PCM through `sk_audio_cb`:
offline families call it exactly once with the whole buffer, streaming families call it once
per pulled chunk (audio.cpp's streaming is "pull text-chunks, not push audio-frames" — one
event per ~300-codepoint text chunk, not low-latency frame streaming); the callback
returning `false` cancels between chunks for streaming families (`SK_ERR_CANCELLED`, the
session resets and is ready for the next request) or discards an already-complete result for
offline families, which cannot be interrupted mid-run. `speed` only affects `supertonic`
(mapped to its `speaking_rate` request option when != 1.0); every other family ignores it.
`sk_tts_unload` frees the session and model. Python: `sokuji_native.tts_load()` returns a
`TtsModel` (`.capabilities`, `.presets()`, `.set_voice()`, `.set_preset()`, `.synth()`,
`.unload()`).

Model directories: `sk_tts_load`'s `model_path` may be a `.gguf` file directly, or a
directory holding exactly one. Self-sufficiency is a **per-file** property, not a per-family
one: a GGUF built with `audiocpp.embedded_files.*` metadata carries its own config/voice-style
sidecars, and on first load audio.cpp materializes them into
`$TMPDIR/audiocpp-gguf/<fingerprint>/` (re-verified, not re-extracted, on every later load;
`TMPDIR` must be writable) — `prepare_model_directory` / `materialize_gguf_sidecars`,
`src/framework/assets/tensor_source.cpp`. Every GGUF downloaded from `audio-cpp/audio.cpp-gguf`
on Hugging Face for `supertonic`, `moss_tts_nano`, `omnivoice` and `qwen3_tts` carries this
metadata, so **a single downloaded `.gguf` is self-sufficient for those four families**
(supertonic's materialized snapshot is ~57MB); nothing else needs to live alongside it. This is
**not** true for `pocket_tts`: its GGUF embeds only `tokenizer.model`, and its voice presets
resolve against `embeddings/*.safetensors` living NEXT TO THE GGUF FILE ON DISK, never
materialized (`pocket_tts/assets.cpp`'s `voice_asset_root =
tensor_source->source_path().parent_path()`, consumed at `session.cpp:347`) — the `english`
package ships `embeddings/alba.safetensors` beside its `.gguf`, while `de`/`it`/`pt`/`es`
package no embeddings at all (clone-only for those languages; `sk_tts_presets` correctly
reports zero names). This also means the snapshot-symlink note from ASR/translation applies
unchanged here: pass the HF cache's `snapshots/.../*.gguf` symlink path as given (it has the
right `.gguf` extension and audio.cpp's existence check follows symlinks) — never resolve it
down to the extension-less `blobs/<hash>` file.

CTest needs two real model directories for `test_tts` (skips with exit code 77 when absent).
Note: supertonic's Q8_0 GGUF is not currently viable (audio.cpp `docs/gguf.md`: "Q8 blockers
unresolved" in the text/vector graph paths) — F16 is the smallest quant with a passing test
status, so that is what CI and this recipe use, not Q8_0:

    mkdir -p ~/.cache/sokuji-native-tests/tts/supertonic-3 ~/.cache/sokuji-native-tests/tts/moss-tts-nano
    curl -L -o ~/.cache/sokuji-native-tests/tts/supertonic-3/supertonic-3-f16.gguf https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/Supertonic-3-GGUF/supertonic-3-f16.gguf
    curl -L -o ~/.cache/sokuji-native-tests/tts/moss-tts-nano/moss-tts-nano-100m-q8_0.gguf https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf

    SK_TEST_TTS_SUPERTONIC_DIR=~/.cache/sokuji-native-tests/tts/supertonic-3 \
    SK_TEST_TTS_MOSS_DIR=~/.cache/sokuji-native-tests/tts/moss-tts-nano \
    ctest --test-dir native/build/cpu --output-on-failure -R 'test_tts'

## Bumping a pin

1. Change the commit SHA (and the version string beside it) in `cmake/upstreams.cmake`.
2. Rebuild; if `patch_upstream.py` fails, the anchored text in `native/patches/<upstream>.json` moved — fix the spec.
3. Run the parity suite (slice 4 onward) — a bump that fails parity is not shipped.
4. Bump `project(sokuji_native VERSION …)` in `CMakeLists.txt` — the only place a version
   is written; the wheel's comes from the staged `contract.json` — and tag `native-vX.Y.Z`.
