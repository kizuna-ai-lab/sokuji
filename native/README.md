# sokuji-native

One native library for the Sokuji sidecar: **transcribe.cpp** (ASR), **llama.cpp**
(translation) and **audio.cpp** (TTS, nine families: moss_tts_nano, qwen3_tts, omnivoice,
pocket_tts, supertonic, voxcpm1, voxcpm2, irodori_tts, index_tts2) linked into `libsokuji_native`
behind the `sk_*` C ABI in `include/sokuji_native.h`, on top of one pristine upstream ggml
with dynamically loaded backends (CPU per-ISA modules, Vulkan on Linux/Windows, Metal on
Apple Silicon). Design: `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md`.
VAD lives in the renderer (a Web Worker running Silero VAD over ONNX Runtime), not here —
see Amendment A1 in the client-VAD-unification spec.

## Build

    native/ci/build.sh vulkan manylinux_2_39_x86_64     # Linux/macOS: <none|vulkan|metal> <wheel plat tag>
    native\ci\build.ps1 -Lane vulkan -Plat win_amd64    # Windows

The plat tag above is illustrative, not a requirement: it is only baked into the wheel's
filename and the floor `check_linux_deps.py` enforces, so a local/dev build can pass
whatever `manylinux_2_<N>_*` matches its own machine (see the R37 floor note below for
what CI actually publishes).

Requires CMake ≥ 3.28, a C++17 compiler, Python 3.10+, and for the Vulkan lane a Vulkan
loader + `glslc` — on Linux that's `libvulkan-dev` (apt) plus the pinned Khronos-source
toolchain `native/ci/vulkan-toolchain.sh` builds (see below); on Windows, the LunarG SDK.
Output: a wheel in `native/python/dist/`; the staged binaries in
`native/build/<lane>/stage/` (`native/build/cpu/stage/` for `none`).

**Linux wheel floor (R37): `manylinux_2_35`, built on `ubuntu-22.04`/`ubuntu-22.04-arm`.**
`pip install` needs glibc ≥ 2.35 (Ubuntu 22.04+, Debian 12+) no matter which symbols are
actually used — pip enforces the manylinux tag itself, not the object's real references.
RHEL 9 (2.34, one notch under the tag but within this tree's own measured margin: no
shipped object references a glibc symbol newer than 2.34) can run this wheel only via a
bundle — files copied in, no pip tag check — never via `pip install` directly.
`check_linux_deps.py` (below) enforces both the glibc floor and a per-tag C++ runtime
ceiling (`CXX_CEILINGS`) on every staged `.so` before the wheel is built. 22.04's own apt
has no `glslc` package at all, and its `spirv-headers` package ships no CMake config
ggml-vulkan's `find_package(SPIRV-Headers CONFIG REQUIRED)` needs —
CI does **not** paper over that with an apt source (R38): LunarG's jammy repo has no
arm64 index at all, and its `libvulkan-dev` ships no headers, either of which breaks the
build outright. Instead, `native/ci/vulkan-toolchain.sh <prefix>` builds pinned
Vulkan-Headers, SPIRV-Headers and shaderc (for `glslc`) from source into a small prefix —
arch-native, cached across runs via `actions/cache` since the shaderc build is the
expensive part (several minutes uncached). Only the Vulkan **loader** (`libvulkan-dev`'s
`.so`) still comes from 22.04's own apt, so the wheel keeps linking the same system
loader every target machine already has. Full recipe, per-object glibc/GLIBCXX evidence
and the validation run: `.superpowers/linux-x64-vulkan-validation.md`.

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
  - `ggml-gguf-bulk-array-read.json` — every lane; see [GGUF array reads](#gguf-array-reads)
  - `ggml-metal-diag-mask-inf.json`, `ggml-metal-pad-leading.json` — metal lane only; see
    [Metal (Apple Silicon)](#metal-apple-silicon). `SOKUJI_GGML_PATCH_SPEC` (set in
    `cmake/ggml_options.cmake`) is a **list**: ggml can carry an always-on portability spec
    and lane-specific ones at once, and `patch_upstream.py` concatenates every spec it is given.
  - `transcribe.cpp.json` — makes transcribe.cpp reuse our ggml target instead of building its own copy
  - `audio.cpp.json` — makes audio.cpp reuse our ggml target instead of building its own copy, and
    keeps its trace-log formatter off `std::to_chars(double)` (macOS 13.3+; the wheels target 11.0)
- `src/audiocpp_compat.h` — the bridge between audio.cpp's forked ggml (base 0.12.0) and the
  pristine upstream ggml we build on. Two kinds of difference, and the second is the dangerous
  one; read the header comment before touching it.
  - the **eight symbols the fork adds**, provided here. Two of them reproduce the fork's
    graph node for node rather than aliasing a nearby upstream call.
  - **four shared symbols whose behaviour upstream changed** (`ggml_conv_1d`,
    `ggml_conv_1d_dw`, `ggml_conv_2d`, `ggml_conv_3d`, ruling R11). Upstream materialises
    the conv's im2col buffer in F16 where the fork uses the kernel's dtype — same name, same
    signature, so nothing fails to link and nothing warns, but every F32 conv silently runs
    its activations at half precision. That cost supertonic 14 samples of output length and
    two rounds of "unexplained" parity residual; the header shims all four back to the fork's
    semantics. `ggml_conv_1d_dw` is on qwen3_tts's decoder path.
  - **when bumping the ggml pin, re-run the scan the header documents** (diff the two
    `ggml.h` symbol sets both ways; then diff the `ggml.c` body of every shared symbol and
    triage the ones that differ). At the 0.12→0.22 gap that was 20 differing bodies, of which
    only the conv family changed values at a reachable call site — the rest were asserts,
    predicate refactors, training/quantization-time code, or zero-call-site ops.
    `ggml_conv_2d_dw` diverges the *other* way (upstream is equal-or-better) and is
    deliberately not shimmed; `ggml_clamp` became out-of-place upstream but every audio.cpp
    call site clamps a throwaway temporary, so the values are unaffected.
- `src/sokuji_native.map` / `src/sokuji_native.exports` — the exported-symbol lists
  (Linux / macOS) that keep everything but `sk_*` inside the library.
- `ci/check_linux_deps.py` — run by `build.sh` on Linux before the wheel is built: every
  staged shared object may depend only on glibc/libstdc++/libgcc, the system Vulkan loader
  and its siblings, and may reference no glibc symbol newer than the wheel tag's floor.
  (The Vulkan loader is external by design, which is why `auditwheel` is not the gate.)
- `ci/vulkan-toolchain.sh <prefix>` — CI's Linux+Vulkan build-time toolchain (R38):
  builds pinned Vulkan-Headers/SPIRV-Headers/shaderc from source into `<prefix>` (`glslc`
  plus the headers and CMake config 22.04's own packages lack or don't ship). Point CMake
  at it with `VULKAN_SDK=<prefix>` and `CMAKE_PREFIX_PATH=<prefix>`; see the script's own
  header for the full rationale, exact pins and output layout.
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

**TTS** — seven entry points, one loaded model per handle, over audio.cpp's nine kept
families (`moss_tts_nano`, `qwen3_tts`, `omnivoice`, `pocket_tts`, `supertonic`, and since
2026-09-03 `voxcpm1`, `voxcpm2`, `irodori_tts`, `index_tts2`):
`sk_tts_load` opens a model with a REQUIRED `family` (audio.cpp's `family_hint` — always
pass it explicitly, family auto-detection is fragile and order-dependent) and creates one
long-lived session at load time, offline or streaming depending on the family
(`sk_tts_capabilities().streaming`: `omnivoice`, `supertonic`, `voxcpm1` and `voxcpm2`
stream, the other five are offline-only); `sk_tts_capabilities` reports
streaming/clones/transcript_required
and the family's default sample rate (48000 moss+voxcpm2+irodori / 24000
qwen3+omnivoice+pocket / 44100 supertonic / 22050 index_tts2 / 16000 voxcpm1 — always read
the rate off each `sk_audio_cb` call too, these are technically
config-driven per checkpoint); `sk_tts_presets` lists named preset voices (supertonic's
fixed `M1`-`M5`/`F1`-`F5` style set, or pocket_tts's `embeddings/*.safetensors` — the other
seven families have no enumerable presets and return zero names); `sk_tts_set_voice` stores
a reference clip (+ optional transcript, mandatory for `omnivoice` and `qwen3_tts` — ruling
R15(s4): qwen3_tts's ICL clone mode requires it too) and `sk_tts_set_preset`
stores a preset id — both apply to every subsequent `sk_tts_synth` call on the handle until
the other is set (each clears the other); `sk_tts_synth` runs greedy/deterministic synthesis
(`seed=0`, `do_sample=false`) for every family EXCEPT `irodori_tts` (which validates every
request option against its own model spec and does not declare `do_sample`, so only `seed=0`
is sent — see `sk_tts.cpp`'s `build_request`) and `moss_tts_nano`, which runs sampled
decoding (`seed=0`, `do_sample=true` — Ruling R23, `.superpowers/moss-eoc-verdict.md`: greedy
argmax decode never reaches this checkpoint's own end-of-content token for ordinary input,
running to the 300-frame/24.000s `max_new_frames` cap instead; sampling reaches real EOC in
2.6-3.7s). The fixed seed keeps output deterministic per build either way — sampling only
changes argmax-vs-sample for the stop decision, not run-to-run reproducibility. Either way,
`sk_tts_synth` delivers f32 interleaved PCM through `sk_audio_cb`:
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

`language` reaches each family by whichever route that family actually reads. Most take it
on `text_input.language`; `qwen3_tts` is forced to its own `"auto"` sentinel (Ruling R14(s4));
`voxcpm1` and `voxcpm2` read no language at all (both advertise `languages = {"Auto"}`), so
theirs is a no-op; and `irodori_tts` / `index_tts2` read the `language` REQUEST OPTION
instead, so `build_request` sets that one for them — fixed `"ja"` for irodori (any other
value throws) and the caller's lowercased ISO code for index_tts2, without which its 2.5
tokenizer guesses "zh if the text has Han characters, else en" and mislabels Japanese.

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

CTest only exercises `sk_tts` in isolation, against nothing. The parity gate that compares its
output to the official `audiocpp_cli`, sample-exact on CPU, lives at
`native/tests/parity/` — see `native/tests/parity/README.md` for how to build the reference
binary and run the suite.

## GGUF array reads

`ggml-gguf-bulk-array-read.json` is the one **always-on, every-lane** ggml patch. ggml
0.22.0's GGUF reader fills an array KV one element at a time —
`gguf_reader::read(std::vector<T> &, n)` loops `read(dst[i])`, and each of those is a
`read_raw` through the reader callback, i.e. one *locked* `fread()` per element. audio.cpp
stores a model's sidecar files as a single `audiocpp.embedded_files.data` UINT8 array KV
(57 MB for supertonic-3, 11 MB for omnivoice, 59 KB for pocket-tts) and reopens the model
GGUF **14 times** during one `sk_tts_load`, so the reader pays 14 × (array bytes) one-byte
`fread`s. On the GB10 dev box that was 800 M of them for supertonic-3 = **13.7 s of its
14.0 s load** (106 % CPU, zero major faults; 12 of 14 poor-man's-profiler samples sat in
`_IO_acquire_lock_fct` under `gguf_read_emplace_helper<unsigned char>`). The patch reads the
whole array in one `read_raw`, guarded by an **inclusion** list rather than an exclusion one
—`std::is_arithmetic_v<T> && !std::is_same_v<T, bool>`, which covers exactly the ten types
`gguf_read_emplace_helper` instantiates besides `bool` and `std::string`. Anything else keeps
the per-element loop, so a future pin that adds an element type with a *converting* `read()`
overload (as `bool`, `ggml_type` and `gguf_type` already have) cannot silently start getting
raw bytes instead. Same bytes, same order, same `data_offset`/`nbytes_remain` — a read-*shape*
change only, which is why the sample-exact parity gate is the proof it is inert.

Measured on the GB10 (cpu lane, `tts_load` only, `n_threads=12`):

| family | embedded sidecar KV | load before | load after |
|---|---|---|---|
| supertonic-3   | 57.06 MB | 13.85 s | **1.50 s** |
| omnivoice      | 11.46 MB |  3.85 s | **1.42 s** |
| qwen3-tts      |  4.47 MB |  2.35 s | **1.21 s** |
| moss-tts-nano  |  3.44 MB |  0.93 s | **0.19 s** |
| pocket-tts-en  |  0.06 MB |  0.16 s | **0.14 s** |

The 14 reopens are audio.cpp's own doing and are still there; they now cost mmap'd
page-cache reads instead of 57 M stdio calls each, so they no longer dominate.

## Metal (Apple Silicon)

The metal lane patches **two op kernels back into our vendored upstream ggml**, through the
same `native/patches/*.json` mechanism the SME drops use, and only when
`SOKUJI_GPU_RESOLVED` is `metal` (both specs touch `src/ggml-metal/`, which no other lane
compiles):

- **`ggml-metal-diag-mask-inf.json`** — ggml 0.22.0's Metal backend implements
  `GGML_OP_DIAG_MASK_INF` *not at all*: no `supports_op` case, no kernel. ggml-cpu,
  ggml-vulkan and ggml-cuda all have it; Metal is the only backend that dropped it, because
  llama.cpp itself moved to masked `soft_max_ext` and stopped needing it. audio.cpp did not:
  every attention block it reaches without an explicit mask builds the op — **16 call sites
  across 13 files** under audio.cpp 0.7.0's `src/` (`external/` excluded), of which the live
  ones for our five families are `moss_tts_nano`'s global transformer and local frame decoder
  and `qwen3_tts`'s `qwen_decoder`. The spec restores the kernel Metal used to carry — it is
  still in audio.cpp's own fork — so it puts back an op every other backend has rather than
  inventing one.
- **`ggml-metal-pad-leading.json`** — ggml 0.22.0's Metal `GGML_OP_PAD` pads only at the END
  of an axis (`supports_op` rejects any non-zero leading pad), while ggml-cpu and ggml-vulkan
  implement the full lp/rp form `ggml_pad_ext` builds. `qwen3_tts`'s speech-tokenizer decoder
  pads *causally* (`left_pad = kernel_extent - stride`, `tokenizer_speech_decoder.cpp`'s
  `causal_conv1d`), so every one of its depthwise convs is a leading pad. The spec teaches
  `kernel_pad_impl` the leading pads with exactly ggml-cpu's non-circular semantics —
  including walking `src0` through `nb00` instead of assuming an element stride of
  `sizeof(T)`, which a permuted `src0` really does reach here; circular padding stays
  unimplemented, as upstream leaves it. Both kernels were checked against the CPU reference
  with ggml's own `test-backend-ops` — DIAG_MASK_INF 3/3, PAD 21/21 non-circular (the 6
  `circular=1` cases report "not supported", as they do upstream). Those runs were made
  during the experiment phase on an Apple M4, from a ggml tree patched with the
  diag-mask-inf spec **byte for byte as it ships here** and the pad spec differing only by a
  later-added `GGML_ASSERT(args.lp0 % 4 == 0)` inside the `pipeline.c4` branch, which ggml
  0.22.0 never enters (`is_c4` is hard-coded `false`) — so the kernels measured are the
  kernels built. They are not re-run per build: treat them as evidence about the kernels,
  not as a gate that runs in CI.

**Why a single missing kernel is fatal here and nowhere else.** transcribe.cpp and llama.cpp
drive ggml through `ggml_backend_sched`, which splits an unsupported node onto CPU. audio.cpp
0.7.0 has **zero** references to it: every runtime pins weights plus its `ggml_gallocr`
compute buffer to one backend and calls `ggml_backend_graph_compute` directly, so
`ggml_metal_op_encode_impl` logs `unsupported op '<OP>'` and calls `GGML_ABORT` — SIGABRT of
the whole process, not a catchable `NativeError`. That structural gap is not closed by these
patches; they close the two holes our five families actually hit.

Two supporting changes ride along: `sokuji_ggml_sub` (in `src/audiocpp_compat.h`) now
`ggml_cont`s **`src1`** as well as `src0` — Metal's `supports_op` demands
`ggml_is_contiguous_rows` of both operands where the CPU kernel strides `src1` through
`nb10`, which is why `omnivoice`'s RVQ loop aborted on Metal and nowhere else — and
`log_line` (in `src/sk_common.cpp`) now forwards warn/error to stderr when the caller
registered no log sink, which is the only reason an abort names its op in a CI log.

**Which Macs this is proved on.** All five families were proved on an Apple **M4**
(`MTLGPUFamilyApple9`). That is the only real Apple-silicon data point, and **CI cannot add
one**: GitHub's `macos-14` arm64 runners are VMs whose Metal device reports as *"Apple
Paravirtual device"* — a virtualization shim, not a downlevel real GPU. It lacks
`has_simdgroup_reduction` (`ggml-metal-device.m` wants `MTLGPUFamilyApple7` or Metal3), and
ggml gates `GGML_OP_NORM`/`RMS_NORM`/`ARGMAX` on that capability, so **every** family that
normalizes — all five — aborts there with `unsupported op 'NORM'` no matter what the code
under test does. (An earlier note here guessed the runner was a real M1 without bfloat; both
halves were wrong. Real Apple silicon from the M1 on is `Apple7` with Metal bfloat support,
which is `Apple6`-level, so the BF16 tensors three of the checkpoints carry are fine there —
and BF16 rungs are separately validated, see below.)

The capability gates our kernels and shims actually consult are `Apple7` (simdgroup
reduction / simdgroup matmul) and `Apple6` (bfloat); every Mac from the M1 onward satisfies
both, which is the architectural argument ruling **R36** relies on to ship `gpu-metal` tiers
for all five families (`sidecar/sokuji_sidecar/catalog.py`, `_TTS_TIER_OVERRIDES`). What is
*not* covered: no real **M1, M2 or M3** has ever run this suite. If one aborts on a kernel
despite reporting `Apple7`, the fix is scoped — drop that family's `gpu-metal` row.

Every "five families" claim in this GPU section means the **original** five. The four added
on 2026-09-03 (`voxcpm1`, `voxcpm2`, `irodori_tts`, `index_tts2`) are deliberately absent
from `_TTS_TIER_OVERRIDES`, i.e. **cpu-only**, and no GPU claim above extends to them; they
earn `gpu-vulkan`/`gpu-metal` rows only after the fleet validates each one the same way.

The gate itself is `test_tts_synthesises_on_a_gpu_device` in
`python/tests/test_sokuji_native.py`: gated on `SK_TEST_TTS_GPU=1`, it places each family
whose model dir is set on the **first non-CPU device** and synthesizes there, one subprocess
per case so an abort is a named per-case failure instead of a dead pytest run. It asserts the
child really ran off-CPU, a duration inside the family's bound, and a non-silent peak. Each
family runs twice where a second rung exists: once at the catalog's default quant and once at
**bf16** (`SK_TEST_TTS_<FAMILY>_BF16_DIR`), because a GPU machine's `auto` plan resolves the
largest quant that fits — bf16 — not the q8_0 the earlier fleet runs all loaded. It skips
itself where `devices()` reports no non-CPU device **and** where that device's description
matches `/paravirtual/i`, so CI's Metal lane reports *skipped* rather than a pass that would
misrepresent a VM shim; `planner._tier_available` refuses the same description in production.
`.github/workflows/native-build.yml` sets `SK_TEST_TTS_GPU` on the **metal lane only**,
because a Linux runner carrying a software rasterizer (llvmpipe/lavapipe) would advertise a
non-CPU Vulkan device and the test would then run whole TTS families on a CPU emulator.
Locally, point it at whatever GPU you have. Nothing before this test ever put a TTS session on
a GPU device, which is exactly how the slice-4 metal lane went green while three of five
families aborted on Metal.

**BF16 rungs, validated 2026-09-02.** 4/4 families that ship one (moss_tts_nano, pocket_tts,
qwen3_tts, omnivoice) synthesize cleanly at bf16 on both GB10/Vulkan and M4/Metal;
`supertonic` ships no bf16 (F16 is its only working rung). Table in
`.superpowers/sdd/2026-09-02-sidecar-ggml-only-slice5b-debt/final-fixwave-report.md`.

Background and measurements: `.superpowers/metal-tts-validation.md` (diagnosis) and
`.superpowers/metal-fix-experiments.md` (the fixes, `test-backend-ops` runs, CPU
bit-identity A/B, per-family timings). One caveat carried from there:
`moss_tts_nano` is the one family that samples its stop decision (R23), so its Metal wording
can differ from its CPU wording while both are correct — the GPU test asserts duration and
non-emptiness, never a transcript.

## Bumping a pin

1. Change the commit SHA (and the version string beside it) in `cmake/upstreams.cmake`.
2. Rebuild; if `patch_upstream.py` fails, the anchored text in `native/patches/<upstream>.json` moved — fix the spec.
3. Run the parity suite (slice 4 onward) — a bump that fails parity is not shipped.
4. Bump the version in the **two** places that hard-code it (plus `SK_ABI_VERSION_NUM` in
   `CMakeLists.txt` and `_ffi.py` when the ABI changes) — `project(sokuji_native VERSION …)`
   in `CMakeLists.txt` and the `sk_version()` assertion in `tests/test_common.cpp` (the CTest
   fails on the old string otherwise) — then tag `native-vX.Y.Z`. Nothing else needs editing:
   the staged `contract.json` and the wheel version are both generated from the CMake project
   version, and the tag/version match is checked by `native-build.yml`.

## Release

Tagging `native-vX.Y.Z` (a `workflow_dispatch` dry run first, verifying all five wheel
names and a green build across every SKU) makes `native-build.yml`'s `release` job publish
the five wheels — one per SKU, `py3-none-<platform>` — as a **prerelease** GitHub Release
(never the repo's "latest", so electron-updater's app-update lookup can't land on it). The
tag-vs-version guard reads `project(sokuji_native VERSION …)` straight out of
`CMakeLists.txt`, so a mismatched tag fails fast instead of shipping a mislabeled wheel.
`native-v1.0.0` is the first release built under the R37 floor above: the two Linux wheels
carry `manylinux_2_35_*` instead of the earlier `manylinux_2_39_*`, everything else
(win-x64, mac-arm64, mac-x64) is unchanged. Downstream, these wheel URLs are what
`sidecar/requirements.txt` pins — bumping that pin to the new release tag is the next step
in the sidecar's own release, not part of this workflow. `native-v1.0.1` follows
immediately: a Python-binding-only fix (R41) for streamed translation tokens that split a
multibyte UTF-8 character across pieces being decoded independently instead of
incrementally, corrupting CJK output with U+FFFD — see `python/sokuji_native/__init__.py`'s
`Translator._make_cb`. `sidecar/requirements.txt` pinned straight to 1.0.1, so no sidecar
bundle ever shipped with 1.0.0 inside. `native-v1.0.2` (2026-09-03) moved the engine pins
to transcribe.cpp 0.2.3 and audio.cpp 0.7.1 and added four TTS families to the build set
(voxcpm1, voxcpm2, irodori_tts, index_tts2), taking it to nine. Current native version is
1.1.0 (ABI 2: device profile and op coverage — spec
docs/superpowers/specs/2026-09-04-native-device-profile-design.md).
