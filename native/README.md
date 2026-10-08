# sokuji-native

One native library for the Sokuji sidecar: **transcribe.cpp** (ASR), **llama.cpp**
(translation) and **audio.cpp** (TTS, thirty families: moss_tts_nano, qwen3_tts, omnivoice,
pocket_tts, supertonic, voxcpm1, voxcpm2, irodori_tts, index_tts2, and since native-v1.3.0
cosyvoice3, fireredtts3, moss_tts_local, vibevoice, chatterbox, chatterbox_turbo,
confucius4_tts, magpie_tts, neutts, kugelaudio, higgs_audio_tts, fish_audio, breeze_tts,
audio8_tts, soprano_tts, glm_tts, outetts, echo_tts, kitten_tts2, miotts, lfm2_audio) linked
into `libsokuji_native` behind the `sk_*` C ABI in `include/sokuji_native.h`, on top of one
pristine upstream ggml
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
  - `ggml-metal-diag-mask-inf.json` — metal lane only; see
    [Metal (Apple Silicon)](#metal-apple-silicon). `SOKUJI_GGML_PATCH_SPEC` (set in
    `cmake/ggml_options.cmake`) is a **list**: ggml can carry an always-on portability spec
    and lane-specific ones at once, and `patch_upstream.py` concatenates every spec it is given.
  - `transcribe.cpp.json` — makes transcribe.cpp reuse our ggml target instead of building its own copy
  - `audio.cpp.json` — makes audio.cpp reuse our ggml target instead of building its own copy,
    keeps its trace-log formatter off `std::to_chars(double)` (macOS 13.3+; the wheels target 11.0),
    copies the fish_dac codec's permuted quantiser input on every backend but Vulkan (CPU binary
    ops assert a contiguous src0) and its first/last-frame slices on every backend (Vulkan's
    SCALE needs a contiguous src0), does the same for audio8_tts's copy of those slices, and
    zeroes the chatterbox and chatterbox_turbo T3 KV caches once after allocation (unwritten
    slots otherwise reach the attention). Each entry's comment sits inside its `new` text, which
    `patch_upstream.py` takes as the already-applied marker, so editing one means restoring that
    upstream file in every tree's `_deps/audiocpp-src` and reconfiguring each tree.
- `src/audiocpp_compat.h` — the bridge between audio.cpp's forked ggml (base 0.12.0) and the
  pristine upstream ggml we build on (0.26.0 as of native-v1.3.0). Two kinds of difference, and
  the second is the dangerous one; read the header comment before touching it.
  - the **seven symbols the fork adds** at the 0.12→0.22 gap (ruling R11), provided here. Two
    of them reproduce the fork's graph node for node rather than aliasing a nearby upstream
    call. native-v1.2.0's audio.cpp bump (0.7.1 → 0.8.2-audio8-perf-hotfix) widened the fork's
    own private surface to 28 functions and 7 enum types against ggml 0.25.3, and
    native-v1.3.0's (→ main at 54aa279) to 29 and 8 against ggml 0.26.0. The header shims the
    ones our families and `engine_core` (`src/framework/**`) actually reach — section (D), and
    since native-v1.3.0 audio8_tts's `ggml_snake_1d` (F) and the fork's 8-argument
    `ggml_ssm_scan` (G) — and section (E) stubs the rest our build names just enough to link —
    reaching one is a bug, not a fallback, the same rule the MiniMax-H3 stubs in (A) already
    used. The fork-only functions left unshimmed are named only by models we never compile
    (`vibeasr`, `reuse`); a family that names one fails to build.
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
    call site clamps a throwaway temporary, so the values are unaffected. The native-v1.2.0
    rescan against ggml 0.25.3 found 22 differing bodies (20 → 22); the two new ones are
    harmless (`ggml_nbytes` adds bytes only for the fork's own I8_S/I2_S types, and
    `ggml_permute` is upstream's `int` → `int64_t`/`size_t` widening), so section (B) itself is
    unchanged. The native-v1.3.0 rescan (audio.cpp 54aa279 against ggml 0.26.0) found 23: the
    new one, `ggml_set_input`, now asserts upstream that its tensor is a `GGML_OP_NONE` leaf —
    a robustness check that changes no value — so (B) is unchanged again.
- `src/sokuji_native.map` / `src/sokuji_native.exports` — the exported-symbol lists
  (Linux / macOS) that keep everything but `sk_*` inside the library.
- `ci/check_single_ggml.py` — run by `build.sh` on Linux and macOS, before `strip`, against the
  UNSTRIPPED staged tree (a statically linked second copy of ggml vanishes from a stripped
  `.so`'s dynamic symbol table): checks that `libsokuji_native` defines none of ggml's core
  symbols itself and that every shared library in the stage is one we ship on purpose,
  appearing exactly once — jiangzhuo's rule that no engine gets its own duplicated ggml.
  Given the lane (`build.sh` passes it), it also requires the lane's runtime to be complete:
  `libggml`, `libggml-base`, a CPU backend module, and the Vulkan/Metal module. Those backends
  are dlopen'd, so no `DT_NEEDED` check sees them, and CI runners have no GPU — a missing GPU
  module would otherwise ship green under a Vulkan/Metal wheel name. `build.ps1` is not gated.
- `ci/check_linux_deps.py` — run by `build.sh` on Linux before the wheel is built: every
  staged shared object may depend only on glibc/libstdc++/libgcc, the system Vulkan loader
  and its siblings, and may reference no glibc symbol newer than the wheel tag's floor.
  (The Vulkan loader is external by design, which is why `auditwheel` is not the gate.)
- `ci/vulkan-toolchain.sh <prefix>` — CI's Linux+Vulkan build-time toolchain (R38):
  builds pinned Vulkan-Headers/SPIRV-Headers/shaderc from source into `<prefix>` (`glslc`
  plus the headers and CMake config 22.04's own packages lack or don't ship). Point CMake
  at it with `VULKAN_SDK=<prefix>` and `CMAKE_PREFIX_PATH=<prefix>`; see the script's own
  header for the full rationale, exact pins and output layout.
- `src/sk_selftest.cpp` — `sk_audio_families()`, reporting every loader audio.cpp's registry holds: the selected families' plus `silero_vad` and `marblenet_vad`, which audio.cpp always registers. A target a family's `DEPENDS` links in (miotts's `miocodec` and `qwen3_asr`) registers no loader and is not listed; the sidecar catalog decides what is supported.
- `src/sk_internal.h` — internal-only helpers shared by the `sk_*.cpp` files (locking, the
  device table, `own_directory()`, the log sink); never installed.
- `src/sk_env.h` — the engine environment switches whose defaults sokuji chooses (echo_tts's
  adaptive window), set once per process by `sk_init`; header-only so the unit test can check it.
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

**TTS** — seven entry points, one loaded model per handle, over audio.cpp's thirty kept
families (`moss_tts_nano`, `qwen3_tts`, `omnivoice`, `pocket_tts`, `supertonic`, since
2026-09-03 `voxcpm1`, `voxcpm2`, `irodori_tts`, `index_tts2`, and since native-v1.3.0 the
twenty-one listed at the top of this file), one `kFamilies[]` row each in `src/sk_tts.cpp`:
`sk_tts_load` opens a model with a REQUIRED `family` (audio.cpp's `family_hint` — always
pass it explicitly, family auto-detection is fragile and order-dependent) and creates one
long-lived session at load time, offline or streaming depending on the family
(`sk_tts_capabilities().streaming`: `omnivoice`, `supertonic`, `voxcpm1` and `voxcpm2`
stream, every other family is offline-only); `sk_tts_capabilities` reports
streaming/clones/transcript_required (the row's, except that a `qwen3_tts` checkpoint
advertising no speaker reference, CustomVoice, reports neither clones nor transcript_required)
and the family's default sample rate (from 16000 for `voxcpm1` to 48000 for `moss_tts_nano`,
`voxcpm2`, `irodori_tts` and `moss_tts_local`; each family's is its `kFamilies[]` row — always
read the rate off each `sk_audio_cb` call too, these are technically
config-driven per checkpoint); `sk_tts_presets` lists named preset voices (supertonic's
fixed `M1`-`M5`/`F1`-`F5` style set, or pocket_tts's `embeddings/*.safetensors` — every other
family returns zero names, and a card whose engine takes presets this cannot list names them
in the sidecar card's `presets`); `sk_tts_set_voice` stores
a reference clip (+ optional transcript, mandatory where `transcript_required` is set:
`omnivoice`, `qwen3_tts` — ruling R15(s4): qwen3_tts's ICL clone mode requires it too —
`fireredtts3`, `fish_audio`, `breeze_tts`, `audio8_tts`, `glm_tts`, `outetts` and
`kitten_tts2`) and `sk_tts_set_preset`
stores a preset id — both apply to every subsequent `sk_tts_synth` call on the handle until
the other is set (each clears the other); `sk_tts_synth` runs greedy/deterministic synthesis
(a fixed seed, `do_sample=false`) for every family EXCEPT two kinds, each a `kFamilies[]` column.
The `strict_options` families (`irodori_tts`, and twelve in all since native-v1.3.0) validate
every request option against their own model spec, so `do_sample` is never sent to them —
only the seed and what the spec declares, e.g. the transcript as `reference_text` where
`strict_sends_ref_text` is set (see `sk_tts.cpp`'s `build_request`). The `sample_decode`
families run sampled decoding (`do_sample=true`): `moss_tts_nano` — Ruling R23,
`.superpowers/moss-eoc-verdict.md`: greedy
argmax decode never reaches this checkpoint's own end-of-content token for ordinary input,
running to the 300-frame/24.000s `max_new_frames` cap instead; sampling reaches real EOC in
2.6-3.7s — and, since native-v1.3.0, `moss_tts_local`, `chatterbox` and `miotts`, whose
upstream defaults sample too. Some families added at native-v1.3.0 always sample and never
read `do_sample` (`audio8_tts`, `glm_tts`, `outetts`, `lfm2_audio`), so their `sample_decode`
stays false. The seed is `0` for every family but
`chatterbox`, `chatterbox_turbo` and `kitten_tts2`, which get `1`: their engines turn seed 0
into a random draw for their flow noise (and chatterbox's for its T3 sampler too). The fixed
seed keeps output deterministic per build either way — sampling only changes argmax-vs-sample,
not run-to-run reproducibility. Either way,
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
`chatterbox_turbo`, `neutts`, `kugelaudio`, `higgs_audio_tts`, `fish_audio` and `soprano_tts`
read no language either: a code their model does not speak is synthesised anyway, so the
card's language tuple and the renderer's filter are the only fence.

Since native-v1.3.0 a non-empty `sk_tts_options.language` at load is a **forced language**:
`sk_tts_load` keeps it on the handle and every `sk_tts_synth` uses it in place of the caller's
`language`, for every family except `pocket_tts`, whose load language is its language package
(`english`, ...). A card sets it as `load_language` when its engine needs one fixed code the
app never sends (VoiceTut's Egyptian Arabic `arz`, on `omnivoice`; `auto` for LFM2.5-Audio).
The other per-family language rules added then are branches in `build_request`; read it
before changing any route.

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

Two families since native-v1.3.0 need more than that one file. `miotts` reads its MioCodec
GGUF through the `miotts.codec_model_path` session option, which `sk_tts_load` sets to the
codec's path in the sibling `MioCodec-25Hz-44.1kHz-v2-GGUF` folder (`src/sk_tts_companions.h`,
shared with the op recorder). `lfm2_audio` loads the directory holding its four per-quant
files, the backbone named by `lfm2_audio.model_gguf` (`family_load` in `src/sk_tts.cpp`). The
sidecar stages a card's `companions` at their repo-relative paths under the same staging root
as its main GGUF, so both are where the engine looks.

Test model directories: every `SK_TEST_TTS_<X>_DIR` is `~/.cache/sokuji-native-tests/tts/<card id>/`
and holds ONE quant of one card. That is its main GGUF plus any companion files the card stages
beside it (per-quant components, a codec), laid out the way the sidecar stages them. A rung that
spans two folders of its repo keeps both under the card directory, and the variable names the
main GGUF's folder: `SK_TEST_TTS_MIOTTS_DIR` is `tts/miotts-1.7b/MioTTS-1.7B-GGUF`, its codec in
the sibling `MioCodec-25Hz-44.1kHz-v2-GGUF`. Such a
directory is never handed to `sk_tts_load` as a directory: with more than one `.gguf` in it,
audio.cpp cannot tell which file is the model. The harness passes the main GGUF *file* instead, as
the sidecar does in production. The main GGUF is **the largest `.gguf` directly inside the
directory** (ties: the first name; subdirectories are not searched). There is one rule with two
copies, each pinned by a test:
- `tests/model_path.h`'s `find_gguf`, used by the op recorder and `test_ops_coverage` (pinned by
  `test_model_path`).
- `_main_gguf` in `python/tests/test_sokuji_native.py`, used by the CPU-family table and the GPU
  gate (pinned by `test_main_gguf_picks_the_largest_gguf_beside_its_companions`).

A recording's `# source:` names the main GGUF. Its weight names and `# dtypes-in-file:` come from
every `.gguf` directly in the model directory, the main one and its companions (`model_ggufs`,
`tests/model_tensors.h`); a model path that names a `.gguf` file, as the asr/translate ones in the
cache root do, stands for that file alone. `# dtypes-in-file:` holds the union of those files'
matrix-tensor dtypes (`ggml_n_dims >= 2`), which is the set `WEIGHT` expands over, as the
sidecar's post-download set (`accel.weight_dtypes`, the `matrix_types` of the rung's main and
companion GGUFs, same dimension rule) is. The recorder refuses a `WEIGHT` whose dtype is outside
that set, so a 1-D norm's dtype stays out without a `WEIGHT` going unasked (owner's ruling
2026-10-06). A companion's weights are recorded as `WEIGHT` like the main file's. A TTS recording
describes the GPU graph it was taken on and is not required to be CPU-complete; `test_common`'s CPU
sweep asserts full support for asr and translate recordings only. `test_tts`, the parity suite and
the single-family Python tests still pass their one-file directories as directories, which keeps
that form of `model_path` covered.

A TTS recording is the union of the synths a user can reach, run on one loaded handle inside one
recording window (`synth_reachable_paths`, `tests/record_common.h`; owner's ruling 2026-10-07). A
voice-required family runs the clip synth only; the list is `kVoiceRequiredFamilies`: the
sidecar's `VOICE_REQUIRED_FAMILIES` plus each family whose every card sets `voice_required=True`
(breeze_tts), a union `sidecar/tests/test_catalog.py` computes from the catalog and holds the
list to. A family that clones without needing a clip runs the bare synth, with the preset the
sidecar sets at load where it sets one (pocket_tts's `alba`), then the clip synth, so its
recording holds the clone path's encoders as well as the bare graph. A family that does not
clone (`sk_tts_capabilities`) runs the bare synth. The clip is supertonic's preset M1 speaking
the recording's sentence, which is also its transcript. Whether a family clones is known only
once it is loaded, inside the window, so the clip is made for every TTS family before the window
opens.

The gate asks about the dtype a device runs, which for a TTS weight is not always the file's.
audio.cpp's `BackendWeightStore` loads a tensor with `Native` storage whose file dtype is BF16 as
F16 when its backend is Vulkan or Metal (`backend_safe_loaded_storage_type`,
`include/engine/framework/core/backend_weight_store.h:273-286` at the pinned commit); on CPU it
keeps the file's dtype. The only weight-type option Sokuji passes is `moss_tts_local.weight_type`,
set to `native`, so every family loads at its own default storage, `Native` wherever a family
does not choose another. llama.cpp and transcribe.cpp load the file's dtype as is. So for stage
`tts` on `vulkan` or `metal`, `bf16` is asked as `f16`; every other dtype, stage and target is
unchanged. The exception is a family with a raw-typed device weight path, one that builds a
device weight past that conversion: the file's own type handed to `make_tensor` (qwen3_tts's
speech-decoder `output_proj`, kugelaudio's `lm_head`), a derived tensor stored at the file's
dtype (index_tts2), or a non-Native default storage (moss_voicegen). For those a `bf16` is
asked both as `bf16` and as `f16`. The list, each entry with its audio.cpp source lines, is
`kRawTypedWeightFamilies` in `src/sk_ops_format.cpp`; it comes from reading every loader under
audio.cpp's `src/models` and `src/community_models`, not from the recordings, and a pin bump
re-reads them.

One helper, `sk_ops_loaded_weight_dtypes` (`src/sk_ops.h`), holds the rule and its exceptions, and
`sk_ops_asked_weight_dtypes` applies it to a set, deduplicating after mapping, so `{bf16, f16}`
asks f16 once. `sk_device_supports_ops` expands WEIGHT over that set. `sk_record_end_to_file`
takes `# dtypes-in-file:` through it for the device that ran each live WEIGHT before the guard
checks it. A device WEIGHT ran on the recording's `# recorded-on:` device, so on Vulkan a live
f16 is covered by a file's bf16 and a live bf16 is refused unless the family is on the list. A
WEIGHT tagged `host` ran on the CPU and is checked against the file's set unmapped. The guard
sees a raw-typed path only when the recorded file holds bf16 there: qwen3_tts is recorded from a
0.6B file whose `output_proj` is f32, while the 1.7B q8_0_v2 and bf16 rungs hold it in bf16. The
header itself, the cards' `rung_dtypes` and the sidecar's `accel.weight_dtypes` stay the files'
own dtypes: the native side maps (ruling 2026-10-07).

A TTS weight can also run in f32 whatever the file holds. audio.cpp builds some weights as F32 on
every backend: `make_f32`, and a tensor derived at `Native` storage (`type_for_derived_storage`),
`include/engine/framework/core/backend_weight_store.h:133-142` and `246-251` at the pinned commit.
Such a weight is a `WEIGHT` when it is the src0 of a `MUL_MAT`, `MUL_MAT_ID` or `GET_ROWS`:
qwen3_tts's normalized codebook table (`make_f32`,
`src/models/qwen3_tts/tokenizer_speech_decoder.cpp:656`) is the src0 of a `GET_ROWS`, f32 even in
a bf16 rung whose file holds no f32 matrix. A convolution kernel is not one: `ggml_conv_1d`
(and its shim in `src/audiocpp_compat.h`) makes it `IM2COL`'s src0 and the `MUL_MAT`'s src1, so
higgs_audio_tts's f32 positional conv is recorded as a literal f32 and asked as such. So for
stage `tts`, on every device, `sk_ops_asked_weight_dtypes` adds f32 to the set when it lacks it,
a safeguard for every such path: the query asks every WEIGHT node in f32 as well, and the guard
accepts a live f32 WEIGHT. asr and translate are unchanged, and `# dtypes-in-file:` stays the
files' own dtypes (owner's ruling 2026-10-07). f32 `MUL_MAT` and `GET_ROWS` are supported on
every device, so this lengthens the query without changing an answer today.

A recording keeps one line per node identity (op, op params, dtypes, each tensor's `ne[0]` and
layout, host side). The sequence axes `ne[1..3]` and a strided view's `nb` merge as per-axis
maxima, and the query rebuilds each node from them, so it is asked at least as large as the
graph held it. When one identity occurs in two orientations, those maxima describe a tensor that
never existed: Echo-TTS's codec holds REPEAT `[1,1024]→[1280,1024]` and
`[1,1,1024]→[1280,1,1024]`, 5.2 MB each, whose maxima rebuild a 5.37 GB tensor that ggml-vulkan
refuses past its buffer limit. So where the maxima rebuild a src0, src1 or dst larger than the
line's `maxbytes`, the line also carries the identity's largest real occurrence, the one
`maxbytes` was measured on: `real0=`, `real1=` and `reald=`, plus `realnb0=`/`realnb1=`/`realnbd=`
for a strided layout. The query rebuilds that occurrence instead (`sk_op_uses_largest`,
`src/sk_ops.h`; ruling 2026-10-07). Every other line is written as before. `test_ops_format`
rebuilds every node of every shipped recording and fails on one whose rebuilt dst, or a src0 or
src1 that is not a `WEIGHT`, is larger than its `maxbytes`, so a recording taken before the rule
cannot ship with such a node; a `WEIGHT` takes the query's dtype, so its size is not compared.
The occurrence is not the identity's least contiguous shape, as the maxima are (an extent-1 axis
counts as contiguous), so the same test also rebuilds each such node from its maxima and fails a
layout predicate that differs, unless the op's `supports_op` reads none on Vulkan, Metal and CPU
(its allowlist cites the pinned source lines).

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
0.26.0's GGUF reader still fills an array KV one element at a time (re-verified at the
native-v1.3.0 bump; 0.26.0's faster GGUF loading replaced the duplicate-key and
duplicate-tensor-name scans, not this loop) —
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

The metal lane patches **one op kernel back into our vendored upstream ggml**, through the
same `native/patches/*.json` mechanism the SME drops use, and only when
`SOKUJI_GPU_RESOLVED` is `metal` (the spec touches `src/ggml-metal/`, which no other lane
compiles):

- **`ggml-metal-diag-mask-inf.json`** — ggml 0.26.0's Metal backend still implements
  `GGML_OP_DIAG_MASK_INF` *not at all* (re-verified at the native-v1.3.0 bump): no
  `supports_op` case, no kernel. ggml-cpu,
  ggml-vulkan and ggml-cuda all have it; Metal is the only backend that dropped it, because
  llama.cpp itself moved to masked `soft_max_ext` and stopped needing it. audio.cpp did not:
  every attention block it reaches without an explicit mask builds the op — **16 call sites
  across 13 files** under audio.cpp 0.7.0's `src/` (`external/` excluded), of which the live
  ones for our five families are `moss_tts_nano`'s global transformer and local frame decoder
  and `qwen3_tts`'s `qwen_decoder`. The spec restores the kernel Metal used to carry — it is
  still in audio.cpp's own fork — so it puts back an op every other backend has rather than
  inventing one. At audio.cpp 54aa279 the framework's attention and decoder modules still
  build it, and so do six of the families added at native-v1.3.0 (`vibevoice`,
  `confucius4_tts`, `chatterbox`, `chatterbox_turbo`, `miotts`, `lfm2_audio`). It was checked
  against the CPU reference with ggml's own `test-backend-ops` (DIAG_MASK_INF 3/3), on an
  Apple M4 during the experiment phase, from a ggml 0.22.0 tree patched with the spec **byte
  for byte as it ships here**; that run is evidence about the kernel, not a gate that runs in CI.

The second gap the same families hit, a leading-edge `GGML_OP_PAD` (`qwen3_tts`'s
speech-tokenizer decoder pads causally, so every one of its depthwise convs is a leading pad),
is upstream since ggml 0.26.0 (46fc5b3b, "metal: support left and circular padding in
GGML_OP_PAD", which also reads a permuted source through `nb00`), so the spec that carried it
is gone. Upstream's own `test-backend-ops` gained the leading-pad case; it is the check to run
on an M4 if `qwen3_tts` misbehaves on Metal.

**Why a single missing kernel is fatal here and nowhere else.** transcribe.cpp and llama.cpp
drive ggml through `ggml_backend_sched`, which splits an unsupported node onto CPU. audio.cpp
0.7.0 has **zero** references to it: every runtime pins weights plus its `ggml_gallocr`
compute buffer to one backend and calls `ggml_backend_graph_compute` directly, so
`ggml_metal_op_encode_impl` logs `unsupported op '<OP>'` and calls `GGML_ABORT` — SIGABRT of
the whole process, not a catchable `NativeError`. That structural gap is not closed by this
patch; it and upstream's leading-edge PAD close the two holes our five original families hit.

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

Every "five families" claim in this GPU section is the **original** five as measured on
2026-09-02. The four added on 2026-09-03 (`voxcpm1`, `voxcpm2`, `irodori_tts`, `index_tts2`)
arrived cpu-only and earned their `gpu-vulkan`/`gpu-metal` rows the same evening (commit
2f2b28bc) the same way — one fleet run per family per lane — so those nine are in
`_TTS_TIER_OVERRIDES` (the measured RTF table sits beside that dict). The twenty-one families
added at native-v1.3.0 arrived cpu-only too and earn a lane's row only from their own fleet
run on it; that dict, not this file, says where each may run.

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

## The op-coverage cap

`sk_op_coverage` carries at most `SK_OP_COVERAGE_MAX` (2048) entries. A recording's worst case
is fixed at build time: its `op=` lines, with every `WEIGHT` line expanded over the widest
fallback dtype set (`WIDEST_FALLBACK` in `cmake/gen_ops_data.py`, 7, which is
`len(RUNG_FALLBACK_DTYPES["q4_k_m"])` in the sidecar's catalog), plus, for a tts recording, the
two dtypes a tts query can add to the set it is given (`TTS_ADDED_DTYPES`): f32, and f16 beside
a raw-typed family's bf16. `gen_ops_data.py` emits one
`static_assert` per recording, so a recording past the cap **fails the build on every lane**
(`"<file>: N expanded entries exceed SK_OP_COVERAGE_MAX"`). A recording fits while
7 (asr, translate) or 9 (tts) × `WEIGHT` lines + other `op=` lines ≤ 2048. The widest shipped
one, `tts-index_tts2.ops`, is at 1040 (504 op lines, 67 `WEIGHT`). Check a new recording before
committing it:

    python3 native/cmake/gen_ops_data.py --report native/src/ops native/include/sokuji_native.h

This prints one line per recording, and `OVER` with exit status 1 for any recording that does
not fit. `test_sokuji_native.py` runs the same report over the shipped set.

A recording that does not fit is not committed. Raising the cap resizes `sk_op_coverage`, a
struct the C ABI hands to the caller, so it is an ABI change: `SK_ABI_VERSION`,
`SK_ABI_VERSION_NUM`, and `_ffi.py`'s `SK_ABI_VERSION` and `SK_OP_COVERAGE_MAX` all move
together. That is the owner's decision. Stop and report the family's counts instead.

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
5. Op recordings (`src/ops/*.ops`, spec A §3.2): configure `build/record` with
   `-DSOKUJI_RECORD_OPS=ON`, run `bash ci/ops-env.sh ctest --test-dir build/record -R test_ops_coverage`
   with every cached model present. The gate compares each node's spelling (op, params,
   dtypes), its src0 `ne[0]` and its host side, so a DIFF means one of those moved: the
   engine's graph changed, or, when the "now uses" and "no longer uses" lines differ only in
   shapes, the run did (a seed the family turns into a random draw, or an intended seed or LM
   change). Re-record that family with `build/record/lib/record_ops` (see tests/record_ops.cpp
   for the argument order), twice more into scratch files, and commit the new .ops file with the
   bump only when all three are byte-identical (`cmp`). **TTS re-recording happens on a GPU box**:
   every tts recording is taken with the model on a real non-host device, because audio.cpp
   builds a different graph for a host backend than for a device one (`uses_host_graph_plan` /
   `is_host_backend`: f16 conv kernels and bf16→f16 casts on host, f32 on a device). Configure
   `build/record-vk` with `-DSOKUJI_GPU=vulkan -DSOKUJI_RECORD_OPS=ON` (or `metal` on macOS)
   and run the gate there; a CPU-only runner prints `SKIPPED (no device)` for every tts family
   and gates **asr/translate drift only**, which is what CI's CPU lanes do. A tts .ops file
   whose `# recorded-on:` says `cpu` is rejected by the gate. The `# engine:` header line is
   provenance only — the gate never compares it — but every recording, asr and translate
   included, is re-recorded on every bump (2026-10-06 ruling), so each file's `# engine:` line
   names the engines it was last checked against; a re-recording that did not drift changes
   only that line.
   Every TTS family's test model is cached under
   `~/.cache/sokuji-native-tests/tts/<card-id>/` — `ci/ops-env.sh` reads that root from
   `$SOKUJI_NATIVE_TEST_CACHE`, defaulting to `$HOME/.cache/sokuji-native-tests`, so set the
   variable if the cache lives elsewhere — and every family MUST be re-recorded on every bump,
   so each family's model has to be present when a pin moves.
   `test_ops_coverage` gates every family whose `SK_TEST_*` model is set — on a CPU-only tree
   that is asr/translate — and a family with a model but no `.ops` file FAILS the gate;
   asr/translate families are recorded as their models become available, and the sidecar-side
   pass-through for an unrecorded family (`accel._OK_TO_MISS`) is a separate runtime fact, not
   this gate's. A new .ops file needs a
   build/record reconfigure to be picked up by the generator — CMakeLists.txt's `file(GLOB …)`
   for src/ops carries CONFIGURE_DEPENDS, so an ordinary `cmake --build build/record` re-checks
   the glob on its own; no manual `cmake -S ... -B build/record` re-run is required.
6. Re-run `ci/check_single_ggml.py` (it runs on its own inside `build.sh`, before `strip`) and
   compare the new wheels' file lists and sizes against the previous release — a second ggml
   or an unexpectedly larger/smaller `.so` is a sign the reuse patch stopped applying. A pin
   must also stay reachable: if the upstream re-points its release tag after you pin to it (as
   transcribe.cpp did to v0.2.4 on 2026-09-25), pin the release **commit** instead of the tag
   and drop `GIT_SHALLOW` for that one upstream, so a shallow fetch does not go looking for a
   commit the tag no longer names.
7. Re-read what no test re-derives, against the new sources:
   - `kRawTypedWeightFamilies` (`src/sk_ops_format.cpp`), against every loader under audio.cpp's
     `src/models` and `src/community_models`;
   - the layout allowlist in `tests/test_ops_format.cpp` (`reads_no_layout_predicate`), against
     the CPU, Vulkan and Metal `supports_op` branches it cites;
   - `src/audiocpp_compat.h`'s rescan (its header says how), including that upstream
     `ggml_ssm_scan` with K = 1 still means the fork's single-state scan (G), and that
     `ggml_snake_1d` is still fork-only and its caller's non-fused fallback still the body (F)
     copies;
   - `moss_tts_local.weight_type=native`, which `sk_tts_load` sets so a CPU load keeps the file's
     weights instead of expanding them to f32: that the option and its `native` value still exist
     (`src/models/moss/moss_tts_local/session.cpp`). No test checks the CPU memory, and "auto"
     resolves to native only on Vulkan and Metal (CUDA, which this build leaves off, picks bf16).

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
(voxcpm1, voxcpm2, irodori_tts, index_tts2), taking it to nine. `native-v1.1.0` followed
(ABI 2: device profile and op coverage — spec
docs/superpowers/specs/2026-09-04-native-device-profile-design.md). `native-v1.2.0`
(2026-09-25) moves ggml to 0.25.3, transcribe.cpp to 0.2.4, llama.cpp to v0.5.0 and
audio.cpp to 0.8.2-audio8-perf-hotfix; `audiocpp_compat.h` gains sections (D)/(E).
transcribe.cpp's v0.2.4 tag was re-pointed twice upstream on 2026-09-25 (CI/packaging-only
commits), so that pin alone is the release commit `7d37cea2` fetched WITHOUT
`GIT_SHALLOW`; the other three pins stay shallow. `sk_asr` leaves PnC/ITN at `DEFAULT`
(unchanged); transcribe.cpp 0.2.4 turns `DEFAULT` on for sensevoice/canary (#157), so those
two now output cased, punctuated text by default. `native-v1.3.0` moves ggml to 0.26.0,
transcribe.cpp to 0.3.1, llama.cpp to v0.6.0 and audio.cpp to main at 54aa279 (version string
`0.9.0+54aa279`; no tag names that commit, so it is fetched without `GIT_SHALLOW`, like
transcribe.cpp), and compiles twenty-one more TTS families, thirty in all. Engine side:
`transcribe.cpp.json` gains a third hunk dropping transcribe.cpp's backend-registration filter
(handy-computer/transcribe.cpp#186; its hook exists only in transcribe's own patched ggml);
`sk_asr` keeps the transcript of a run transcribe.cpp 0.3's repetition guard cut short
(`TRANSCRIBE_ERR_OUTPUT_REPETITION`) instead of failing it; `audiocpp_compat.h` gains the fork's
`GGML_MUL_MAT_LOWERING_VULKAN_F32_INPUTS`, an aborting 7-argument `ggml_gated_delta_net`
(reached only by models we do not build), audio8_tts's `ggml_snake_1d` and the fork's
8-argument `ggml_ssm_scan`; `audio.cpp.json` gains the fish_dac, audio8_tts and chatterbox
entries; the Metal leading-pad patch is gone, upstream since ggml 0.26.0; `sk_tts` gains three
`kFamilies[]` columns (`strict_sends_ref_text`, `task`, `preset_option`) and a forced load
language; and every op recording was re-recorded at the bump. Current native version is 1.3.0
(ABI unchanged at 2).
