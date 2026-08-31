# ggml-only sidecar: one native library, one ggml, one process

**Date:** 2026-08-30
**Branch:** `refactor/sidecar-ggml-only` (worktree `.claude/worktrees/sidecar-ggml-only`)
**Status:** design approved in conversation; implementation plan follows this spec.

## 1. Goal

Rebuild the local-inference sidecar's runtime layer on the ggml family only:

- **ASR** — transcribe.cpp (unchanged engine; already the only ASR runtime since 2026-07-04)
- **Translation** — llama.cpp, used **as a library** (no `llama-server` child process)
- **TTS** — audio.cpp's engine, used **as a library** (no `audiocpp_server`); VAD runs
  in the renderer, not in the native layer (Amendment A1)

All three engines are linked into **one shared library, `libsokuji_native`**, behind
**one C ABI we own**, on top of **one pristine upstream ggml**. The Python sidecar
keeps its WebSocket protocol, catalog, planner and download manager, and talks to the
native layer through a single ctypes binding.

Everything else goes: onnxruntime (CPU / CUDA / DirectML), the NVIDIA cuDNN/cuBLAS wheel
stack (~1.9 GB per SKU today), sherpa-onnx, CTranslate2, MLX, the seven ORT TTS engines
and their G2P dependency chains, and the on-demand `llama-server` binary download.

### 1.1 Premises (decided 2026-08-30)

1. **The sidecar has never shipped.** No backward compatibility is owed: no migration of
   stored model selections, no deprecated aliases for removed catalog ids, no transition
   release. Removals are one cut.
2. **ggml strategy:** both engines that matter build against **pristine upstream ggml**.
   audio.cpp's private ggml ops are bridged by a small compatibility header (§4.4); its
   fork is not carried, and no fork of our own is created.
3. **Dropped outright:** the 56 piper/VITS voices (sherpa-onnx), GPT-SoVITS, CosyVoice3
   (until audio.cpp promotes it to a supported family), the 13 Opus-MT translation cards
   (CTranslate2), and the macOS MLX lane.
4. **TTS recommendation:** Supertonic 3 and MOSS-TTS-Nano are both `recommended`; the
   language filter and the user's cloning need pick between them.
5. **Native distribution:** in-repo `native/` super-project, one `sokuji-native` wheel per
   platform, released from this repository under `native-vX.Y.Z` tags.
6. **Acceptance:** bundle size is not a gate but is measured and reported (under
   ~100 MB triggers a separate evaluation of shipping the sidecar inside the app
   installer); TTS speed is not a gate (the catalog lists what runs, users choose);
   correctness gates are in §9.
7. **Stage vocabulary:** modules, classes, backend names and C-API prefixes use the stage
   names `asr` / `translate` / `tts` — never the implementing technology. (VAD left the
   sidecar in Amendment A1; segmentation is the renderer's job.)
8. The sidecar itself stays Python. Moving the WebSocket server out of Python is a
   possible later step that this design deliberately keeps open (§3.2), not part of it.

### 1.2 Non-goals

- The browser/extension WebGPU lane (`src/lib/local-inference/workers/*`,
  `modelManifest.ts`, `scripts/download-sherpa-wasm.sh`, `copy-ort-wasm.sh`) is untouched.
- CUDA, ROCm/HIP and DirectML execution providers. Vulkan covers NVIDIA/AMD/Intel;
  Metal covers Apple Silicon; CPU is the floor everywhere.
- Windows-on-ARM. Not in the initial SKU matrix; it is one CI matrix row when wanted.
- Self-hosted ONNX / CTranslate2 model repositories on Hugging Face are left as they are.

## 2. Why (evidence gathered 2026-08-30, GB10 dev box)

- **Duplicate ggml is not a rounding error.** transcribe-cpp-native's x86_64 wheel is
  69 MB uncompressed (53 MB of it Vulkan SPIR-V); audio.cpp's official Vulkan server is
  110 MB. Two engines each carrying ggml + shaders ≈ 120 MB uncompressed against a
  post-cleanup sidecar body of ~100 MB compressed.
- **Both projects vendor ggml.** transcribe.cpp's in-tree ggml is a pristine 0.20.2
  snapshot; audio.cpp's is a fork of 0.12.0 (32 files, 3,360 lines, 6 new ops). Their
  GGUF files are not interchangeable either (different converters/repos).
- **The fork's ops do not touch our families.** `sage_attn2*` and `convrot_linear`
  serve MiniMax-H3 (CUDA-only kernels); `flash_attn_ext_with_bias_mask` serves
  Parakeet-TDT; `conv_1d_fast_1d_im2col` serves BigVGAN vocoders / Citrinet / MarbleNet;
  `mul_mat_pack4` is taken only when `backend == Cuda`; `col2im_1d` is upstream since
  0.20.2 with an identical signature; `graph_set_n_nodes` is a 3-line setter. For
  moss_tts_nano / qwen3_tts / omnivoice / pocket_tts / supertonic / silero_vad on
  Vulkan, Metal or CPU the dependency is link-time only.
- **transcribe.cpp builds against another ggml.** Verified: v0.2.2 with
  `TRANSCRIBE_BUILD_SHARED=ON TRANSCRIBE_GGML_BACKEND_DL=ON` configures and builds
  against audio.cpp's ggml tree and transcribes correctly.
- **Embedding audio.cpp is the designed use.** The engine is `engine_core` +
  `engine_model_*` + `engine_runtime` library targets; CLI and server are shells;
  `examples/xcode/.../MiniTTSDemoBridge.mm` (189 lines) drives load → session → run
  through the public runtime API; `AUDIOCPP_MODEL_SET=custom` builds a family subset.
  Its server exposes no VAD endpoint at all, which settles "library, not server" for
  VAD by itself.
- **llama.cpp as a library is the easy one.** `llama.h` is a 209-function C API,
  `LLAMA_USE_SYSTEM_GGML=ON` links an external ggml, and the translate backends use only
  greedy chat completion with `max_tokens 512` (plus Qwen3's `enable_thinking=false`
  and TranslateGemma's self-rendered prompt).
- **ASR stays on transcribe.cpp** (20 families / 70 GGUF repos vs 12; no Whisper or
  Cohere in audio.cpp). Same model, same quant, 58 s clip, RTF median of 3:

  | model (Q8_0) | transcribe.cpp CPU | audio.cpp CPU (20 thr) | transcribe.cpp Vulkan |
  |---|---|---|---|
  | Parakeet-TDT-0.6B-v3 | 0.064 | 0.076 | 0.005 |
  | Qwen3-ASR-1.7B | 0.188 | 0.493 | 0.045 |
  | Voxtral-Mini-4B-Realtime | 0.824 | 2.640 | 0.291 |
  | whisper-large-v3-turbo | 0.346 | — | 0.013 |
  | Cohere Transcribe (Q4_K_M) | 0.190 | — | 0.009 |

  Vulkan figures are warm; a cold first run (shader compile + graph build) is up to
  50× slower, so every RTF measurement in this project warms up first.

## 3. Architecture

### 3.1 One process

```
sokuji_sidecar (Python: ws server · catalog · planner · downloads · engines)
        │  one ctypes binding: sokuji_native
        ▼
libsokuji_native.so          ← our C ABI (sk_*), our code, ~1,000 lines C++
  ├─ transcribe.cpp (static) ← sk_asr_*
  ├─ llama.cpp      (static) ← sk_translate_*
  └─ audio.cpp      (static, 6 families + compat header) ← sk_tts_*
        │  dynamic
        ▼
libggml / libggml-base + backend modules (ggml-cpu-<isa>, ggml-vulkan | ggml-metal)
```

Every stage sees one ggml backend registry, one device table and one view of device
memory, so the cross-stage memory ledger in `accel.py` becomes a measurement instead of an
estimate. There are no child processes and no localhost HTTP.

### 3.2 Why a unified C ABI (approach B)

Two alternatives were weighed: (A) per-engine bindings — keep the upstream
`transcribe_cpp` PyPI binding via its provider entry point, write thin ctypes for
`llama.h`, and a C shim only for audio.cpp; (B) one C ABI over all three. A owns less
code (~300 lines of C); B owns ~1,000 but yields one error model, one cancellation
model, one thread policy, one device table — and a boundary that Electron (koffi/N-API)
or a C++ host can call directly if the Python sidecar is ever removed. B was chosen
because the ~100 MB bundle target makes "ship the sidecar inside the app" plausible,
and that path needs B's boundary anyway.

## 4. Native layer

### 4.1 Repository layout

```
native/
  CMakeLists.txt                 super-project; FetchContent, pinned tags + sha256
  cmake/                         toolchain helpers (Vulkan SDK lookup, CPU variants)
  include/sokuji_native.h        the only public header
  src/
    sk_common.cpp                sk_init, devices, memory, logging, errors, threads
    sk_asr.cpp                   over transcribe.cpp
    sk_translate.cpp             over llama.cpp
    sk_tts.cpp                   over audio.cpp TTS sessions
    audiocpp_compat.h            fork-op → upstream-ggml bridge (§4.4)
  python/sokuji_native/
    __init__.py, _ffi.py         ctypes binding (~500 lines), contract check
    _native/                     binaries land here at wheel build time
  tests/                         CTest smoke per engine; parity/ (§9.2)
```

Upstream sources are **not** vendored; the super-project fetches them by tag. Initial
pins: ggml `v0.22.0`; transcribe.cpp `v0.2.2`; llama.cpp — the release tag whose
in-tree ggml matches the pinned ggml (llama.cpp and ggml are co-developed, so the
llama.cpp tag effectively selects the ggml version and the other two follow);
audio.cpp `v0.7.0`. Bumping any pin is a `native-v` release.

### 4.2 Build

- ggml: `BUILD_SHARED_LIBS=ON`, `GGML_BACKEND_DL=ON`, `GGML_CPU_ALL_VARIANTS=ON` on
  x86_64 (per-ISA CPU modules), `GGML_VULKAN=ON` on Linux/Windows, `GGML_METAL=ON` on
  macOS arm64, CPU only on macOS x86_64.
- transcribe.cpp: `TRANSCRIBE_BUILD_SHARED=OFF` (static into our library),
  `TRANSCRIBE_GGML_BACKEND_DL=ON`, pointed at the shared ggml tree.
- llama.cpp: `LLAMA_USE_SYSTEM_GGML=ON`, static library target only (no examples,
  server or tools).
- audio.cpp: `AUDIOCPP_GGML_SOURCE_DIR=<shared ggml>`, `AUDIOCPP_MODEL_SET=custom`,
  `AUDIOCPP_MODELS=moss_tts_nano;qwen3_tts;omnivoice;pocket_tts;supertonic;silero_vad`,
  `ENGINE_ENABLE_CPU_ALL_VARIANTS` semantics reproduced by our own flags; no CLI, no
  server, no embedded WebUI or demo voices; `audiocpp_compat.h` force-included.
- `libsokuji_native` links the three engines statically and `ggml`/`ggml-base`
  dynamically, rpath `$ORIGIN` (Linux), `@loader_path` (macOS); on Windows the DLLs sit
  in the same directory. Windows has no rpath, so the module directory is added to the
  DLL search path by the Python loader (`os.add_dll_directory` in `sokuji_native._load`,
  before `CDLL`) rather than by `sk_init` — by the time `sk_init` runs, the DLL and its
  dependencies have already been resolved.
- Only `sk_*` is exported: a version script on Linux (`src/sokuji_native.map`) plus
  `-Wl,--exclude-libs,ALL`, an exported-symbols list on macOS
  (`src/sokuji_native.exports`), `__declspec(dllexport)` on Windows. The three engines
  are static archives compiled with default visibility, so without this their symbols
  would leak into the host process. Linux also links `-static-libstdc++ -static-libgcc`
  with `-Wl,--no-undefined`, and macOS pins `CMAKE_OSX_DEPLOYMENT_TARGET=11.0` to match
  the `macosx_11_0_*` wheel tags.
- Release builds with symbols stripped; a separate debug-symbol artifact is kept per
  release for crash triage.

### 4.3 C ABI

Conventions, applied uniformly:

- Every object is an opaque handle; every call returns `sk_status` (0 = ok, negative =
  error class); `sk_last_error()` returns a thread-local UTF-8 message.
- Every callback receives `void * user` and **returns `bool`; `false` cancels** — the
  one cancellation mechanism for ASR streaming, translation token streaming and TTS chunk
  streaming.
- PCM is `float32`; ASR input is 16 kHz mono; TTS output carries its own sample
  rate. Strings are UTF-8. Memory allocated by the library is released with `sk_free`.
- Threads are configured once in `sk_init` (audio.cpp's engine defaults to 1 thread when
  unconfigured — this is why the setting is mandatory).
- `SK_ABI_VERSION` (integer) and `sk_version()` (string) are checked by the Python side at
  import.

Surface (final names may gain arguments during implementation, not lose these):

```c
sk_status sk_init(const sk_init_options *);                 // threads, log callback, module dir
int       sk_devices(sk_device *out, int cap);             // kind cpu|vulkan|metal, name, mem_total, mem_free
                                                           // CPU + GPU devices only; ggml accelerators (macOS BLAS) are not listed
sk_status sk_device_free_mem(int device, uint64_t *bytes);
const char *sk_version(void);  const char *sk_last_error(void);  void sk_free(void *);

/* ASR (transcribe.cpp) */
sk_status sk_asr_load(const char *gguf, const sk_device *, sk_asr_model **);
sk_status sk_asr_capabilities(sk_asr_model *, sk_asr_caps *);       // languages, supports_streaming
sk_status sk_asr_run(sk_asr_model *, const float *pcm, size_t n, const char *lang, sk_text_cb, void *);
sk_status sk_asr_stream_open(sk_asr_model *, const char *lang, sk_asr_stream **);
sk_status sk_asr_stream_feed(sk_asr_stream *, const float *pcm, size_t n, sk_stream_text *out); // committed + tentative
sk_status sk_asr_stream_finalize(sk_asr_stream *, sk_text_cb, void *);
void      sk_asr_stream_close(sk_asr_stream *);
void      sk_asr_unload(sk_asr_model *);

/* Translation (llama.cpp) */
sk_status sk_translate_load(const char *gguf, const sk_device *, const sk_translate_options *, sk_translate **);
sk_status sk_translate_chat(sk_translate *, const sk_message *msgs, int n, const sk_gen_options *, sk_token_cb, void *);
sk_status sk_translate_complete(sk_translate *, const char *prompt, const sk_gen_options *, sk_token_cb, void *);
void      sk_translate_unload(sk_translate *);

/* TTS (audio.cpp) */
sk_status sk_tts_load(const char *family, const char *path, const sk_device *, sk_tts **);
sk_status sk_tts_capabilities(sk_tts *, sk_tts_caps *);    // sample_rate, streaming, clones, transcript_required (mirrors sk_asr_capabilities)
int       sk_tts_presets(sk_tts *, sk_string *out, int cap);
sk_status sk_tts_set_voice(sk_tts *, const float *ref, size_t n, int sr, const char *ref_text);
sk_status sk_tts_set_preset(sk_tts *, const char *name);
sk_status sk_tts_synth(sk_tts *, const char *text, const char *lang, float speed, sk_audio_cb, void *);
void      sk_tts_unload(sk_tts *);
```

`sk_tts_synth` delivers audio through the callback in both modes: streaming families
(supertonic, omnivoice) call it per chunk from the engine's stream-event sink; one-shot
families call it once with the whole buffer. `sk_translate_chat` applies the GGUF's chat
template via `llama_chat_apply_template`; `sk_translate_complete` takes a caller-rendered
prompt (TranslateGemma). Sampling is greedy; `sk_gen_options` carries `max_tokens`.

### 4.4 audio.cpp compatibility header

`audiocpp_compat.h` is force-included into audio.cpp's translation units and provides the
eight symbols its framework references but upstream ggml lacks, without touching ggml:

| fork symbol | provided as |
|---|---|
| `ggml_col2im_1d` | upstream (0.20.2+), no shim |
| `ggml_conv_1d_fast_1d_im2col` | the fork's own `im2col` → `mul_mat` → `reshape_3d` graph, spelled out with upstream ops (not `ggml_conv_1d`, which materialises im2col in F16 where the fork uses the kernel dtype) |
| `ggml_mul_mat_pack4` | `ggml_mul_mat` (only reachable on CUDA upstream; never on our backends) |
| `ggml_flash_attn_ext_with_bias_mask` | `ggml_flash_attn_ext` over an effective mask built as the fork builds it: `scale(bias, scale)`, plus the F32-promoted mask broadcast to its shape, cast to F16 |
| `ggml_graph_set_n_nodes` | inline setter over `ggml_cgraph` (needs `ggml-impl.h`) |
| `ggml_sage_attn2`, `ggml_sage_attn2_i8`, `ggml_convrot_linear` | `GGML_ABORT("not built")` — MiniMax-H3 only, family not compiled |

The one fork change we keep as a build-time patch on ggml: "vulkan: disable integer dot
product on AMD proprietary driver without native dot4" (audio.cpp #193, 21 lines), a
correctness fix that belongs upstream; proposing it to ggml-org is a separate,
explicitly-approved outward act.

### 4.5 Python package

`sokuji_native` is pure Python plus a `_native/` directory. `_ffi.py` declares the
ctypes surface; `__init__.py` reads `_native/contract.json`
(`{abi, ggml, transcribe, llama, audiocpp, backends, lane}`), refuses a mismatched ABI,
locates the module directory, and calls `sk_init`. The wheel is `py3-none-<platform>`
(same posture as transcribe-cpp-native), so the sidecar's Python version is not coupled
to it.

### 4.6 Platforms and CI

| SKU | runner | GPU lane | wheel tag |
|---|---|---|---|
| linux-x64 | `ubuntu-24.04` | Vulkan | `manylinux_2_39_x86_64` |
| linux-arm64 | `ubuntu-24.04-arm` (fallback: self-hosted GB10) | Vulkan | `manylinux_2_39_aarch64` |
| win-x64 | `windows-2022` (MSVC) | Vulkan | `win_amd64` |
| mac-arm64 | `macos-14` | Metal | `macosx_11_0_arm64` |
| mac-x64 | `macos-15-intel` | CPU only (ggml Metal does not support Intel Macs) | `macosx_11_0_x86_64` |

Linux builds on 24.04, not 22.04: `glslc` is only packaged from 24.04 on, and
`sidecar-bundles.yml` already builds the Linux sidecar on 24.04 runners — so the glibc
2.39 floor the `manylinux_2_39_*` tags declare is the floor Sokuji users already have.

`native-build.yml` runs on `native-v*` tags: build, strip, run CTest, run the parity
suite on CPU, assemble five wheels + `contract.json`, publish as release assets. Linux
runners install `libvulkan-dev` + `glslc` from apt; Windows installs the LunarG SDK.
Wheel URLs are pinned in `sidecar/requirements.txt` with `sys_platform` /
`platform_machine` markers — the two Linux markers point at the `manylinux_2_39_*`
wheels above. The wheel version is not written in `pyproject.toml`: `setup.py` reads it
from the staged `contract.json`, so `project(sokuji_native VERSION …)` in
`native/CMakeLists.txt` is the one place a release version is edited.

Expected uncompressed size per wheel: ggml core + CPU variants ~20 MB, Vulkan shaders
~50 MB (none on macOS), engines ~30 MB; zstd ~35–45 MB.

## 5. Sidecar layer

### 5.1 Naming

| | ASR | Translation | TTS |
|---|---|---|---|
| backend module | `asr_backend.py` | `translate_backend.py` | `tts_backend.py` |
| backend classes | `NativeAsrBackend`, `NativeAsrStreamBackend` | `NativeTranslateBackend` (+ Qwen / Hunyuan / Gemma prompt strategies) | `NativeTtsBackend` |
| backend `NAME` | `native_asr`, `native_asr_stream` | `native_translate` | `native_tts` |
| C prefix | `sk_asr_*` | `sk_translate_*` | `sk_tts_*` |
| engine | `asr_engine.py` | `translate_engine.py` | `tts_engine.py` |

VAD is not a sidecar capability: segmentation happens in the renderer's vad-web worker
and reaches the ASR stage as `vad_mark` wire events (Amendment A1).

### 5.2 Entry point and accel

`sokuji_sidecar/native.py` lazily imports `sokuji_native`, calls `sk_init` (thread count
from the existing `SOKUJI_*_THREADS` policy, log callback into `logging`) and is the only
module that touches ctypes. `accel.probe()` takes device truth from `sk_devices()`;
`device_free_bytes()` from `sk_device_free_mem()`. The `_installed` backend→wheel map
collapses to "`sokuji_native` importable". Tier vocabulary is `cpu` / `gpu-vulkan` /
`gpu-metal`; `gpu-cuda` and `gpu-dml` and every branch that reasons about them
(`has_nvidia`, `dml_adapters`, `ort_cuda`, the aarch64 ORT-CUDA special case) are
deleted from `planner.py`, `accel.py` and `catalog.py`.

### 5.3 Backends and engines

- **ASR:** the two classes in today's `transcribe_backend.py` move to `asr_backend.py`
  over `sk_asr_*`; `_match_language` and the committed-delta stream adapter
  (`_TcStream`) keep their logic. `asr_engine.py` drops its VAD entirely: segment
  edges arrive from the renderer as `vad_mark` events (Amendment A1) — the offline
  path buffers between marks over a pre-roll ring; the streaming path keeps the
  always-stream/degrade architecture with marks replacing the local VAD edges.
- **Translation:** `translate_backend.py` keeps the three prompt-strategy classes and
  swaps `LlamaServerProc.chat()` for `sk_translate_chat()`; tokens stream to the
  renderer as they are produced; cancellation is the callback returning `false`.
  `llama_runtime.py` (binary acquisition, checksums, process management) and
  `ct2_opus.py` are deleted.
- **TTS:** one `NativeTtsBackend` replaces nine classes. The family comes from the
  catalog row; `STREAMING` / `CLONES` / native sample rate come from `sk_tts_capabilities`;
  `set_voice` → `sk_tts_set_voice` (reference text passed for Qwen3/MOSS),
  `set_builtin_voice` → `sk_tts_set_preset`, `list_tts_voices` → `sk_tts_presets`.
  `set_style_voice` and `set_speaker` are removed with their wire variants.
- **`tts_engine.py` fixes three known defects while it is open:** one-shot `generate`,
  `init` and `set_voice` run in the executor instead of on the event loop (today every
  non-streaming synthesis stalls the ASR connection); `tts_cancel` works for every family
  and a new `tts_generate` sets the previous request's cancel flag before superseding it;
  output resampling uses `soxr` instead of the un-antialiased linear interpolator.

### 5.4 Catalog and downloads

- ASR: 67 rows, backend names only.
- Translation: the 13 `ct2_opus_translate` rows are removed; 9 llama.cpp rows remain,
  backend `native_translate`.
- TTS: 68 rows become 10 (correction 2026-08-31: both "11"s in this spec were an
  arithmetic slip — the enumerated list below is and was authoritative) — `moss-tts-nano`, `qwen3-tts-0.6b`, `qwen3-tts-1.7b`,
  `omnivoice-0.6b`, `supertonic-3`, `pocket-tts-{en,de,es,it,pt}` — each with a single-file
  artifact `audio-cpp/audio.cpp-gguf/<dir>/<file>.gguf` and a quant ladder (`q8_0`
  default rank 2.0; `f16`/`bf16` listed-only rank 0.5), exactly the ASR row shape.
  `TtsModel` loses `style_voices` and `num_speakers`; keeps `clones`, `streaming`,
  `named_voices`, `transcript_required`, `license` (OmniVoice's CC-BY-NC gate keeps
  working). `Deployment.requires_apple_silicon` goes with the MLX lane.
- Downloads (corrected 2026-08-31 after reading the vendored source): audio.cpp's
  `is_gguf_file` checks the extension on the path AS GIVEN (no realpath), so the HF
  snapshot's `.gguf` symlink is loadable directly — no hard-link staging is needed.
  What IS needed: each TTS model is a `.gguf` plus small sibling assets in the same
  directory (`config.json`, tokenizer files; supertonic's `voice_styles/*.json`;
  pocket's `embeddings/*.safetensors`), so a TTS download is a SCOPED snapshot of the
  artifact's directory (`allow_patterns=["<dir>/*"]`, quant ladder ggufs sharing the
  siblings), and `sk_tts_load` receives the snapshot's `.gguf` symlink path. The
  whole-repo multi-variant snapshot machinery and `hf_symlinks.py` still go.

### 5.5 Wire protocol

Unchanged except: the `styleVoice` variant of `set_voice` is removed; `ready` gains
`family`. `list_tts_voices` returns preset names. The asr leg is v2 (Amendment A1):
`asr_init` loses the three `vad*` fields, the client sends
`{"type": "vad_mark", "event": "start" | "end" | "cancel"}` control messages
interleaved with the binary PCM, and the sidecar's `speech_start` push is removed.
Errors keep the `BackendLoadError` → resolver-fallback rule and the diagnostics
policy in `CLAUDE.md`.

## 6. Removal list

**Sidecar source (~12k lines):** packages `qwen3_tts/`, `cosyvoice3/`, `omnivoice/`,
`moss_tts/`, `gpt_sovits/` (incl. three G2P stacks); modules `tts_backends.py`,
`sherpa_tts.py`, `supertonic_frontend.py`, `pocket_inference.py`, `pocket_bundle.py`,
`pocket_tokenizer.py`, `qwen_tokenizer.py`, `mlx_tts.py`, `ct2_opus.py`,
`llama_runtime.py`, `hf_symlinks.py`; `tts_voices.py` rewritten to ~30 lines;
`__main__._preload_cuda_dlls`; the ORT/CUDA/DML/jetson/sbsa logic in `accel.py`,
`planner.py`, `setup.sh`; 57 TTS rows, 13 Opus rows and the dropped `TtsModel` fields in
`catalog.py`.

**Tests (~6k lines):** the 37 TTS/engine test files, `test_ct2_opus.py`,
`test_llama_runtime.py`, `test_llama_server_proc.py`, `test_mlx_tts.py`;
`test_torch_free_gate.py` becomes `test_runtime_gate.py` (§9.3);
`test_characterization.py` snapshots are re-recorded against the new contract.

**Dependencies:** removed — `onnxruntime`, `onnxruntime-gpu`, `onnxruntime-directml`,
`sherpa-onnx`, `ctranslate2`, `sentencepiece`, `tokenizers`, `jieba`, `pypinyin`, `g2pM`,
`nltk`, `pyopenjtalk-plus`, `mlx-audio`, `transcribe-cpp`. Added — `sokuji-native`.
Remaining — `numpy`, `websockets`, `huggingface_hub`, `psutil`, `zstandard`, `soundfile`,
`soxr`. The four per-SKU requirements files are deleted.

**Scripts:** `convert-opus-ct2.py`, `convert-qwen3-tts-{bf16,fp16}.py`,
`quantize-qwen3-tts-nbits.py`, `validate-qwen3-tts-int8.py`, `repack-qwen3-tts-onnx.py`,
`dynamize-qwen3-tts-codec.py`, `build-qwen3-tts-variant-repos.py`,
`build-gpt-sovits-repo.sh`, `cosyvoice3/`, `reexport-omnivoice/`, `mirror_pocket_tts.py`,
`extract-tts-metadata.py`, `record_llama_checksums.py`.

**Kept:** everything under the browser/extension lane (§1.2); the self-hosted HF model
repositories.

## 7. Packaging, SKUs, Electron, CI

- **SKUs (5):** `linux-x64`, `linux-arm64`, `win-x64`, `mac-arm64`, `mac-x64`. Names
  carry platform, not GPU vendor. `win-arm64` is a later matrix row.
- **Bundle:** python-build-standalone + the seven remaining wheels + `sokuji_native` +
  `sokuji_sidecar`. One `requirements.txt`. `build-sidecar-bundle.py`'s SKU table becomes
  a platform table; the 1.9 GiB part-splitting stays but is not expected to trigger.
  `sidecar-bundles.yml` prints each SKU's zst size in the job summary and records it in
  `manifest.json`; above 100 MB it warns, never fails.
- **Electron:** `sidecar-sku.js` selects on `process.platform` + `process.arch` only;
  the `hasNvidia` probe is removed from `native-host-manager.js` and `main.js`;
  `nativeModelStore.ts` SKU strings are renamed. `prefetch_models.py` no longer fetches
  `silero_vad.onnx` (no silero artifact ships in the sidecar or the wheel at all —
  Amendment A1; the renderer's `public/wasm/vad/silero_vad_v5.onnx` already ships in
  both the Electron and extension builds).
- **CI:** `native-build.yml` (new, §4.6); `sidecar-bundles.yml` matrix becomes the five
  runners with only `pip install -r requirements.txt`; every CUDA / DirectML / sbsa step
  is deleted. Release flow is unchanged: `package.json.sidecarVersion` →
  `sidecar-vX.Y.Z` tag → automatic prerelease.
- **Developer setup:** `setup.sh` is venv + `pip install -r requirements.txt pytest`.

## 8. Renderer touchpoints

- `nativeProtocol.ts`, `NativeTtsClient.ts`: drop the `styleVoice` message variant and
  `setStyleVoice()`.
- `nativeCatalog.ts`: backend display-name map gains `native_asr` / `native_translate` /
  `native_tts`, loses the ORT / sherpa / MLX / CTranslate2 entries; tier labels and
  `TierIcon.tsx` lose `gpu-cuda` and `gpu-dml`; `variantIds` logic stays (it drives the
  TTS quant ladder).
- `nativeModelStore.ts`: SKU strings.
- Voice components (`VoiceLibrarySection.tsx`, `NativeVoiceSection.tsx`,
  `LocalInferenceVoiceSection.tsx`, `voiceStorage.ts`): remove the Supertonic style-vector
  upload/storage path; `transcriptRequired` keeps driving the reference-text form; presets
  come from `list_tts_voices` in the same shape.
- `LicenseConsentModal.tsx`: unchanged.
- Locales: no per-model keys exist; help text mentioning sherpa / piper / DirectML is
  cleaned up (grep during implementation).
- Tests: fixtures in `nativeCatalog.test.ts`, `useNativeEngineAdapter.test.ts`,
  `StoragePage.test.tsx`, `candidates.native.test.ts`, `nativeModelStore.test.ts`,
  `participantConfig.test.ts` are renamed accordingly.

## 9. Testing and correctness gates

### 9.1 Native layer (CTest, runs in `native-build.yml`)

Per-engine CPU smoke with small models cached via `actions/cache`: `sk_asr_run` on
whisper-tiny Q8, `sk_translate_chat` on Qwen3-0.6B, `sk_tts_synth` on Supertonic and
MOSS-Nano. Plus: ABI/contract consistency; a
cancellation test asserting that all three streaming paths stop before the next chunk once
the callback returns `false`.

### 9.2 Compatibility-header parity (gate)

Same GGUF, seed and text through (a) the official audio.cpp binary (fork ggml) and
(b) `libsokuji_native` (upstream ggml + compat header). CPU: sample-exact. Vulkan:
SNR ≥ 60 dB. One case per family, plus the cloning path for Qwen3 and MOSS. Lives in
`native/tests/parity/` and runs on every audio.cpp or ggml bump.

### 9.3 Sidecar unit tests (pytest)

A stub `sokuji_native` (pure-Python fake of the ctypes surface) replaces today's
monkeypatching of `transcribe_cpp` / `onnxruntime`, so the suite needs no binaries.
`test_runtime_gate.py` statically asserts that `sokuji_sidecar/` imports none of
`onnxruntime`, `torch`, `sherpa_onnx`, `ctranslate2`, `transcribe_cpp`, `mlx*`, and that
`requirements.txt` contains only the eight allowed packages. Planner / accel / catalog
tests follow the tier and backend renames.

### 9.4 Live smoke matrix (per SKU, before a release; optional CI job)

Existing ASR loopback; one translation per prompt family; TTS→ASR loopback for the six
families. RTF is measured after a warm-up, always. (The VAD-vs-sherpa comparison gate
is void — Amendment A1 removed the sidecar VAD.)

### 9.5 Renderer

vitest with renamed fixtures; the `descriptorRegistry` / `nativeCatalog` invariant tests
must keep passing.

### 9.6 Reproducible benchmark

The harness used for §2 becomes `sidecar/bench/native_bench.py` (warm-up, 3 runs,
median, short and long clips, RTF and transcript head) so upstream bumps can be compared
against recorded numbers.

## 10. Rollout

| # | slice | delivers | gate |
|---|---|---|---|
| 0 | transcribe-cpp 0.2.2 + 3 ASR cards | done (`7aaadc07`) | — |
| 1 | native skeleton | `native/` super-project, `libsokuji_native` with `sk_init` / `sk_devices` / `sk_version`, CTest, `native-build.yml` for 5 platforms, `native-v0.1.0`, parity scaffold | 5 wheels green; `sk_devices` lists Vulkan + CPU on GB10 |
| 2 | ASR + client VAD | `sk_asr_*`, `asr_backend.py`, wire v2 (`vad_mark`), `native-vad.worker.ts`, requirements drop transcribe-cpp | ASR loopback; RTF on par with the PyPI wheel; both engine paths driven by marks under test fakes (Amendment A1) |
| 3 | translation | `sk_translate_*`, `translate_backend.py`, delete `llama_runtime.py` / `ct2_opus.py` / Opus rows / CTranslate2 | one sentence per prompt family; token streaming and cancel work |
| 4 | TTS | `sk_tts_*`, `tts_backend.py`, `tts_engine.py` fixes, catalog 68→10, scoped-snapshot downloads, parity suite, delete the nine backends / five packages / conversion scripts | parity (CPU exact, Vulkan ≥ 60 dB); TTS→ASR loopback |
| 5 | cleanup | tiers, one requirements file, `setup.sh`, SKU table, `sidecar-sku.js`, `nativeModelStore`, renderer touchpoints, workflows, `test_runtime_gate.py` | pytest + vitest green; five bundles built with sizes printed |
| 6 | release | `native-v1.0.0`, `sidecar-vX.Y.0`, CHANGELOG, CLAUDE.md sidecar section, memory | five-SKU live smoke matrix |

Slice 1 first; 2 → 3 → 4 serially (they share `sk_common` and `native.py`, each adding
functions and bumping `native-v0.x`); 5 after 2–4; 6 last. Estimate: 1 ≈ 3–4 days,
2 ≈ 2, 3 ≈ 1–2, 4 ≈ 4–5, 5 ≈ 2–3, 6 ≈ 1 — about three weeks. Net code change roughly
−18k / +4k lines across sidecar, native and tests.

Every PR into `main` and every push is confirmed by jiangzhuo individually (house rule);
nothing here pre-approves an outward act.

### 10.1 Risks

| risk | mitigation |
|---|---|
| ggml version alignment across three upstreams | the llama.cpp tag selects the version; transcribe.cpp tracks upstream closely; audio.cpp is bridged by the compat header. Verified on day one of slice 1. |
| a family fails parity on upstream ggml | port that one op into the compat header (kernel from the fork), not the whole fork |
| MSVC build of audio.cpp | upstream ships Windows build scripts; low |
| Vulkan SDK on the arm64 runner | fall back to a self-hosted GB10 runner |
| in-process crash takes the sidecar down | already true for transcribe.cpp today; the renderer's reconnect path covers it; debug symbols are archived per release |

## 11. Acceptance

1. `sokuji_sidecar/` has no import of onnxruntime, torch, sherpa_onnx, ctranslate2,
   transcribe_cpp or mlx; `requirements.txt` is the eight-package allowlist (§9.3).
2. One ggml on disk per bundle (`libggml*` appears once); no child inference processes.
3. Parity and loopback gates in §9 pass on the five SKUs.
4. Bundle sizes are reported per SKU; the number, not a threshold, is the deliverable.
5. The catalog lists 67 ASR, 9 translation and 10 TTS cards; Supertonic 3 and
   MOSS-TTS-Nano are recommended.

## Amendment A1 (2026-08-31) — VAD moves to the renderer

Decided by jiangzhuo on 2026-08-31, after slice 2's implementation measured audio.cpp's
streaming silero against sherpa-onnx and missed the ≤1-frame gate for algorithmic
reasons (its streaming path applies no min-speech gating to live start edges and
ignores `max_speech_duration_s`; on top of that its bundled safetensors weights drift
from the official onnx export).

**The deciding fact:** the renderer already carries a complete client-side VAD stack
that cannot be removed — `@ricky0123/vad-web`'s FrameProcessor over the official
`silero_vad_v5.onnx` via onnxruntime-web WASM, shared by the whisper-webgpu,
voxtral-webgpu and zoom-vad workers (the browser/extension lane §1.2 leaves untouched,
plus the Zoom cascade provider on every platform). A second silero in the sidecar
(different weights AND different edge semantics) means the desktop lane and the
browser lane segment speech differently forever. local_native's user-facing VAD
defaults (0.3 / 1.4 s / 0.4 s in `LocalNativeProviderConfig`) were already copied
from the vad-web lane for settings-UI parity; feeding them into a sherpa-tuned engine
(0.5 / 0.5 s / 0.25 s native defaults) was a semantic mismatch from day one.

**Consequences (authoritative over the amended sections above):**

- **One VAD product-wide.** Segmentation for the local_native provider runs in the
  renderer: `native-vad.worker.ts` mirrors `zoom-vad.worker.ts`'s ORT + FrameProcessor
  loop but emits edge events only (`speech_start` / `speech_end` / `speech_cancel`,
  no utterance audio transfer). The user's three VAD knobs configure this worker
  (threshold → `resolveVadThresholds`; minSilence → `redemptionMs`;
  minSpeech → `minSpeechMs`), exactly as the voxtral worker maps them. The 20 s
  max-speech cap lives in the worker (`endSegment`), as it does for Zoom.
- **Wire protocol (asr leg) v2.** Binary PCM stays continuous Int16@24k in both
  modes. `asr_init` loses `vadThreshold` / `vadMinSilenceDuration` /
  `vadMinSpeechDuration`. New client→sidecar control message
  `{"type": "vad_mark", "event": "start" | "end" | "cancel"}` — fire-and-forget,
  no `id`, no reply; its ordering against the binary frames is the WS connection's
  ordering. `cancel` is vad-web's VADMisfire (a start that never reached
  min-speech). The sidecar's `speech_start` push is removed — the renderer knew
  first; `partial` / `result` / `asr_flush` are unchanged.
- **`asr_engine.py`.** Offline path: a ~0.7 s pre-roll ring, a segment buffer opened
  at `start` (seeded with the ring), transcribed at `end` or flush, dropped at
  `cancel`. Streaming path: keeps the always-stream/degrade architecture; marks are
  enqueued into the audio queue as sentinels (order-exact with the audio the feeder
  saw) and replace `_vad_state` / `_vad_events`; the 20 s run-on cap stays as a
  sample-counting backstop against lost marks. `vad.py` (`NativeVad`) is deleted.
- **Native layer.** `sk_vad_*` leaves the ABI: `sk_vad.cpp`, the header block, the
  ctypes surface, `test_vad`, and the bundled `silero_vad_16k.safetensors` are all
  removed; audio.cpp remains for TTS only. `project(sokuji_native VERSION)` bumps
  0.2.0 → 0.3.0 (nothing has been released; version numbers are cheap).
- **Skew tolerance.** Marks trail the audio they refer to by worker latency plus
  silero's threshold ramp (~100–300 ms): the pre-roll ring absorbs the start skew,
  and a late `end` only appends trailing silence, which transcription tolerates.
  This is the same lag the sidecar VAD itself had.

## Appendix A — measured facts referenced above

- transcribe-cpp-native 0.2.2 wheels: linux x86_64 24.3 MB / aarch64 20.6 MB / win 20.4 MB
  (cpu-vulkan lane), macOS arm64 1.5 MB (metal), macOS x86_64 1.5 MB (cpu).
- audio.cpp v0.7.0 official Ubuntu Vulkan tarball: `audiocpp_server` 109.7 MB,
  `audiocpp_cli` 75.4 MB. Our aarch64 CPU-only server build: 535 MB unstripped, 25 MB
  stripped. No official Linux aarch64 binaries exist.
- audio.cpp ggml fork vs upstream v0.12.0 (whitespace-insensitive): 32 files,
  3,360 lines; Metal ≈ 1,600, CUDA ≈ 800 (+ new sage-attn2 / convrot / col2im files),
  ggml.c 314, CPU ≈ 340, Vulkan ≈ 135 (+ 3 shaders). Its `external/ggml` has 19 commits
  since 2026-06-25, last upstream sync 2026-06-30.
- transcribe.cpp v0.2.2 built on audio.cpp's ggml fork (CPU, Release): Parakeet-v3 RTF
  0.049, Qwen3-ASR-1.7B 0.242 — correct output, ~25% slower on the LLM-style model than
  the PyPI wheel's ggml 0.20.2. Not chosen; recorded for reference.
- Current sidecar release bundles (v0.1.5, zst): linux-arm64 192 MB, mac 156 MB,
  win-directml 121 MB, linux-nvidia 1,743 MB, win-nvidia 1,481 MB.
